import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { IS_SERVICES } from '@/lib/edition'
import { deriveVerification } from '@/lib/compliance/recompute-verification'
import { availableRails, ISO_ALPHA3, type PartyIdentity, type PaymentRailId } from '@/lib/payments/eligibility'

/**
 * ONE VERIFIED IDENTITY, READ BY EVERY FEATURE THAT NEEDS ONE.
 *
 * Owner, 2026-08-30: *"we have kyc from user once and on eno.forum they can perform all future kyc
 * required features without reapplying"*. This module is that promise, expressed as the ONLY way a
 * feature is allowed to ask. Payments, the wallet, eSIM and the visa desk all call in here; none of
 * them query `IdentityVerification` directly, and none of them keep their own copy of "is this
 * person verified".
 *
 * ⛔ AND IT DOES NOT DECIDE WHO IS VERIFIED — `deriveVerification` DOES. That function is the app's
 * existing authority and it already encodes rules this module got wrong when it asked the database
 * its own way: a `revoked` row outranks everything, a still-valid verification SURVIVES a later
 * rejection, and the document clock is generous to the last calendar day. The first version of this
 * file ran `findFirst({ status: 'verified' })`, which silently ignored revocation — three reviewers
 * independently found that a user revoked for fraud kept their wallet, payments and eSIM forever.
 * ⚠️ THAT MISTAKE IS THE ONE THIS MODULE'S OWN DOCSTRING WARNS ABOUT, which is worth saying out
 * loud: a second predicate written next to the real one is exactly how "verified" comes to mean two
 * different things in two parts of an app. Projecting a shared derivation is the point; re-deriving
 * would have made this file another source of the drift it exists to prevent.
 *
 * ⚠️ IT IS A READ MODEL, NOT A NEW STORE. `IdentityVerification` remains the record of the review
 * and the retention obligation; this is the projection features are allowed to see.
 * ⚠️ AND IT IS NOT PII-FREE — it deliberately carries `fullName` and `nationality`, because an eSIM
 * registration and a visa application both need the legal name and a carrier will not take a hash.
 * What it withholds is the material the DECISION was made from: `subjectHash` (the cross-account
 * identity linker) and `evidence` (document paths, check results) never leave this module. Treat a
 * `VerifiedIdentity` as personal data and do not log it.
 */

export type IdentityCapability =
  /** May hold and be paid through a custody wallet. */
  | 'wallet'
  /** May be a party to a settled order on at least one rail. */
  | 'payments'
  /** May buy an eSIM, which carriers require a verified identity for. */
  | 'esim'
  /** May submit a visa application. */
  | 'visa'

export type VerifiedIdentity = {
  profileId: string
  /** 'A' = VNeID (citizens) | 'B' = passport + residence (expats). */
  tier: string
  fullName: string | null
  /** ISO-3166-1 alpha-3, straight from the MRZ of the document that speaks for this identity. */
  nationality: string | null
  /**
   * ⛔ EVERY NATIONALITY IN THE HISTORY, BECAUSE A VETO MUST SEE ALL OF THEM. `nationality` above is
   * one document's; a dual national has more than one, and the settlement rules veto on nationality
   * (Vietnamese, or comprehensively sanctioned) rather than merely noting it. See `partyFor`.
   */
  nationalities: string[]
  /**
   * ISO-3166-1 alpha-3 where the person lives.
   *
   * ⚠️ A VIETNAMESE RESIDENCE DOCUMENT DECIDES IT; otherwise it is what an ADDRESS-VERIFYING source
   * stored, and null when none has. Null is not "abroad" — consumers treat it as Vietnam.
   */
  residenceCountry: string | null
  /** When the identity document expires. A verification cannot outlive its document. */
  documentExpiresAt: Date | null
  verifiedAt: Date | null
}

/**
 * ⛔ THE SOURCES TRUSTED TO SAY WHERE SOMEONE LIVES. Everything else is ignored, whatever the column
 * holds. `residenceCountry` is the input to a LEGAL gate — Vietnam's DTI Law legalised holding and
 * trading digital assets but not paying with them — so a value that arrived from a self-declared
 * form field, a CSV backfill or a hopeful admin must not be able to open the stablecoin rail.
 * ⚠️ THE FIRST VERSION ENFORCED THIS IN A COMMENT AND NOWHERE ELSE, and two reviewers pointed out
 * that the first writer of the column, whoever they turn out to be, would silently become law. An
 * allow-list of provenances is the difference between a documented intention and a rule.
 */
const ADDRESS_VERIFYING_SOURCES: ReadonlySet<string> = new Set([
  /** The payment provider's own KYC/AML — it verifies an address and is the regulated party for it. */
  'provider_kyc',
])
/**
 * ⛔ AND `residence_document` WAS REMOVED FROM THAT LIST, NOT FORGOTTEN. It looked harmless — "a
 * Vietnamese residence document, which only ever yields VNM anyway" — but two reviewers noticed the
 * branch is unreachable for exactly that case: a TRC or a VNeID has already returned 'VNM' several
 * lines above, so the ONLY way to arrive here carrying that label is with a document that is not a
 * Vietnamese residence document and a country that is not Vietnam. An allow-list member whose
 * stated justification cannot occur is a hole in the shape of a comment.
 */

/**
 * ⚠️ MATCHED AS SUBSTRINGS OF THE NORMALISED LABEL, so a variant or a localised spelling still
 * vetoes. Vietnamese diacritics survive `toLowerCase()`, so the localised forms are listed as
 * written rather than transliterated.
 */
const VN_RESIDENCE_DOC_STEMS: readonly string[] = ['trc', 'cccd', 'cmnd', 'tam tru', 'tạm trú', 'thuong tru', 'thường trú']

/**
 * ⛔ AN MRZ NATIONALITY CODE IS NOT AN ISO ALPHA-3 CODE, AND THE SCHEMA SAYING "straight from the
 * MRZ" IS EXACTLY THE PROBLEM. `src/lib/visa/mrz.ts` takes ICAO 9303's field verbatim, and ICAO
 * uses `D` for Germany — so a German passport arrives as `'D'`, fails `ISO_ALPHA3`, and its holder
 * is refused settlement forever with no message saying why. A reviewer found it by reading the
 * parser rather than the tests, which only ever use codes that happen to be identical in both.
 * ⚠️ ONLY THE UNAMBIGUOUS ALIAS IS MAPPED. `GBD`/`GBN`/`GBO`/`GBP`/`GBS` are distinct British
 * nationality classes and `XXA`/`XXB`/`XXC`/`XXX` mean stateless, refugee or unspecified — whether
 * any of those may settle is a legal question for counsel, not a lookup table for me to invent. They
 * stay unmapped and therefore ineligible, which is the safe direction, and `unmappable_nationality`
 * exists so those users surface for a decision instead of disappearing.
 */
const MRZ_TO_ISO: Readonly<Record<string, string>> = { D: 'DEU' }

/** The ISO alpha-3 form of an MRZ code, or null when it is not a country this app can assess. */
export function isoNationality(raw: string | null | undefined): string | null {
  const c = (raw ?? '').normalize('NFC').trim().toUpperCase()
  if (!c) return null
  const mapped = MRZ_TO_ISO[c] ?? c
  return ISO_ALPHA3.has(mapped) ? mapped : null
}

/** ⚠️ CASE- AND WHITESPACE-INSENSITIVE, because a legal gate must not turn on `'TRC'` vs `'trc'`. */
const norm = (v: string | null | undefined): string => (v ?? '').normalize('NFC').trim().toLowerCase()

type IdentityRow = {
  id: string
  tier: string
  method: string
  status: string
  decidedAt: Date | null
  documentExpiresAt: Date | null
  assuranceLevel: string | null
  fullName: string | null
  nationality: string | null
  residenceCountry: string | null
  residenceSource: string | null
  documentType: string | null
}

/**
 * The identity behind a profile, or null when there is no LIVE verification.
 *
 * ⚠️ `cache()` IS PER-REQUEST MEMOISATION, not a cache across requests. A checkout asks this
 * question several times in one render; two requests must not share an answer, because revocation
 * has to take effect on the next one.
 */
export const verifiedIdentityFor = cache(async (profileId: string): Promise<VerifiedIdentity | null> => {
  return readVerifiedIdentity(profileId)
})

/**
 * ⛔ THE UNCACHED READ, FOR CALLERS WHO JUST CHANGED THE ANSWER. `verifiedIdentityFor` is
 * `cache()`-wrapped, which memoises for the whole REQUEST — so the approval path, which reads the
 * identity milliseconds after writing `status: 'verified'`, could be handed the pre-approval `null`
 * that an earlier call in the same request had already cached. Two reviewers walked it: provisioning
 * would silently skip every case an admin had looked at first.
 * ⚠️ USE THE CACHED ONE EVERYWHERE ELSE. Rendering asks this question several times per page and
 * should pay for it once. `on-verified.test.ts` asserts that the approval path uses THIS one — a
 * regression that switched it to the cached read would otherwise pass green, because the unit tests
 * mock `cache()` to a pass-through and so cannot see staleness at all.
 */
export async function readVerifiedIdentity(profileId: string): Promise<VerifiedIdentity | null> {
  /**
   * ⛔ EVERY ROW, NOT THE NEWEST VERIFIED ONE. `deriveVerification` needs the whole history to
   * apply the rules that matter here: a `revoked` row anywhere in it outranks every verification,
   * and a still-valid earlier verification survives a later rejection. Filtering in SQL to
   * `status: 'verified'` — which is what this did first — hides both from it.
   */
  const rows: IdentityRow[] = await db.identityVerification.findMany({
    where: { profileId },
    select: {
      id: true, tier: true, method: true, status: true, decidedAt: true,
      documentExpiresAt: true, assuranceLevel: true,
      fullName: true, nationality: true, residenceCountry: true,
      residenceSource: true, documentType: true,
    },
  })
  if (rows.length === 0) return null

  // ⛔ THE SHARED DERIVATION DECIDES. Revocation, the standing-verification rule and the document
  // clock (generous to the last calendar day) all live in there, and are deliberately not repeated.
  const { status, source } = deriveVerification(rows, new Date())
  if (status !== 'verified' || !source) return null

  const row = rows.find((r) => r.id === source.id)
  if (!row) return null

  return {
    profileId,
    tier: row.tier,
    fullName: row.fullName,
    nationality: row.nationality,
    /**
     * ⛔ FROM *VERIFIED* ROWS ONLY — the same trust boundary the foreign-residence branch got, and
     * missing here for one round. All three commit-gate families found it: this scanned every row,
     * so a REJECTED submission carrying a garbled or unlisted nationality stayed in the set
     * forever, and because `railsFor` requires every nationality to clear the gate, one bad upload
     * permanently revoked settlement for a currently-verified user with no way to recover it.
     * ⚠️ THE DUAL-NATIONAL VETO SURVIVES THIS. A Vietnamese passport still vetoes when it was
     * actually verified, which is the only case in which it is evidence of anything.
     * ⚠️ AND AN EXPIRED DOCUMENT'S NATIONALITY STILL COUNTS, WHICH IS NOT AN OVERSIGHT. A reviewer
     * asked whether these should age out with the document; they must not. A passport expires — a
     * nationality does not, and someone does not stop being Vietnamese when their passport lapses.
     * ⛔ ONE ASYMMETRY POINTS THE PERMISSIVE WAY AND IS AN OPEN QUESTION FOR COUNSEL, not a settled
     * decision: a REJECTED Vietnamese passport is dropped here, while a REJECTED TRC still vetoes
     * residence forever. So someone whose VNM passport was rejected for a blurred scan — its MRZ
     * having parsed fine — can later verify a foreign passport and address and receive a wallet.
     * Filtering to verified rows is right (a rejected upload must not lock someone out for life),
     * but whether a rejected-yet-readable Vietnamese passport should still veto is a legal call.
     * ⚠️ RAW, NOT MAPPED — `partiesFor` applies the ISO form. Keeping the recorded values here means
     * the read model still reports what the documents said.
     */
    nationalities: [...new Set(rows
      .filter((r) => r.status === 'verified')
      .map((r) => (r.nationality ?? '').normalize('NFC').trim().toUpperCase())
      .filter(Boolean))],
    residenceCountry: residenceFrom(rows),
    documentExpiresAt: row.documentExpiresAt,
    verifiedAt: row.decidedAt,
  }
}

/**
 * Residence: a Vietnamese residence document decides it, otherwise a verified source does, otherwise
 * nobody.
 *
 * ⚠️ A VNeID (tier A) and a TRC/CCCD ARE evidence of living in Vietnam. A PASSPORT is not — it says
 * where someone is FROM, never where they are — and neither is a VISA, which is permission to enter
 * rather than a statement of residence. This marketplace's audience is foreign nationals living in
 * Vietnam, so reading either as foreign residence would be wrong in the dangerous direction.
 */
function residenceFrom(rows: IdentityRow[]): string | null {
  /**
   * ⛔ A VIETNAMESE RESIDENCE DOCUMENT ANYWHERE IN THE HISTORY OVERRIDES ANYTHING STORED, AND
   * "ANYWHERE" IS THE FIX. This read one row — the one `deriveVerification` selected — and a
   * reviewer found the hole that leaves: a TRC holder who later adds a verified passport row
   * carrying `provider_kyc`/`GBR` has the newer row selected, the TRC becomes invisible, and a
   * Vietnam resident is handed a foreign residence with no untrusted source involved anywhere.
   * ⚠️ IT IS A ONE-WAY RATCHET FOR DOCUMENTS, AND THERE IS NO SELF-SERVICE WAY OUT OF IT. Say that
   * plainly rather than gesturing at an admin path that does not exist: a user who typed "TRC" by
   * mistake, was rejected, and later verifies a foreign address is vetoed until someone edits or
   * deletes that row in the database. That is a support burden this accepts on purpose — the cost
   * of a false veto is a wallet that has to be asked for, and the cost of a false clear is a
   * licensed company settling a payment Vietnamese law does not permit.
   * ⛔ WHEN THAT BURDEN SHOWS UP IN REAL SUPPORT VOLUME, THE FIX IS AN EXPLICIT `residence_override`
   * REVIEWED BY A HUMAN — not loosening the stems, which is what makes the veto worth having.
   */
  const vnEvidence = rows.some((r) => {
    if (norm(r.tier) === 'a') return true // VNeID — Vietnamese citizen scheme
    /**
     * ⚠️ SUBSTRING, NOT EXACT AND NOT MERELY A PREFIX. An exact match let `trc_renewal` through; a
     * prefix match still missed the localised labels the comment itself cited — `thẻ tạm trú` does
     * not start with `trc`. A reviewer caught both, one round apart. Matching stems anywhere in the
     * label errs toward the veto, which is the only direction that is safe to be wrong in.
     */
    const dt = norm(r.documentType)
    return VN_RESIDENCE_DOC_STEMS.some((stem) => dt.includes(stem))
  })
  /**
   * ⛔ AND A TRUSTED SOURCE SAYING "VIETNAM" DOES *NOT* RATCHET — IT COMPETES ON RECENCY INSTEAD.
   * It did ratchet for one round, and a reviewer showed what that costs: a user with an older
   * provider_kyc/VNM row and a NEWER verified provider_kyc/GBR row stayed Vietnamese forever, so a
   * genuine emigration could never be recorded by the one source trusted to record it. The
   * "newest trusted answer wins" test only covered GBR→DEU and missed exactly VNM→foreign.
   * ⚠️ SO ONLY *DOCUMENTS* ARE ONE-WAY. A TRC or VNeID is a fact about a moment that we cannot
   * un-observe and did not adjudicate; a provider's address check is a dated finding by a regulated
   * party which that same party can supersede. Treating the weaker evidence as permanent and the
   * stronger as revisable was backwards, and it is the trusted branch below that handles VNM now.
   */
  if (vnEvidence) return 'VNM'

  /**
   * ⛔ AND OTHERWISE IT IS THE NEWEST TRUSTED ANSWER IN THE HISTORY, NOT THE SELECTED ROW'S. This
   * read `residenceCountry`/`residenceSource` off the single row `deriveVerification` picked, and a
   * reviewer found the mirror image of the bug that shape had already caused once: a foreign
   * resident verified through the provider who later RENEWS THEIR PASSPORT gets a newer row with no
   * residence on it at all, the older verified address is forgotten, and their wallet is revoked
   * for nothing. A passport renewal is not a house move.
   * ⚠️ NEWEST TRUSTED, so a genuine relocation still takes effect the moment the provider re-runs
   * its address check — the history is a record, not a ratchet, in the direction that is safe.
   */
  /**
   * ⛔ AND THIS BRANCH READS ONLY *VERIFIED* ROWS, WHICH THE VNM RATCHET ABOVE DELIBERATELY DOES
   * NOT. All three commit-gate reviewers found the asymmetry missing: the ratchet scans every
   * status because a rejected TRC is still evidence of living in Vietnam, but the branch that OPENS
   * the rail was doing the same — so a live verification from one row could take its foreign
   * residence from a row REJECTED for identity mismatch, an address belonging to whoever's document
   * was misused. The closing direction may read everything; the opening direction may not.
   * ⚠️ WHICH ALSO REMOVES A NON-DETERMINISTIC SORT. A pending row has a null `decidedAt`, and
   * several of them collapsed to 0 and ordered by whatever the database returned. A verified row
   * always has one.
   */
  const trusted = rows
    .filter((r) => r.status === 'verified' && ADDRESS_VERIFYING_SOURCES.has(norm(r.residenceSource)))
    .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0]
  if (!trusted) return null

  /**
   * ⚠️ MEMBERSHIP OF THE REAL CODE LIST, NOT A THREE-LETTER SHAPE. `/^[A-Z]{3}$/` accepted `ZZZ`,
   * which is the exact mistake eligibility.ts records having made and fixed — validating a string
   * length instead of a value. Normalised to null, never left undefined: a row written before this
   * column existed hands back `undefined`, and that is not what the payments gate tests for.
   */
  /**
   * ⚠️ ISO MEMBERSHIP DIRECTLY, *NOT* `isoNationality` — a reviewer caught the reuse. That helper
   * carries the MRZ alias `D → DEU`, which belongs to passport nationality fields; a residence
   * comes from the provider's own KYC, which speaks ISO. Accepting `'D'` as a residence would have
   * honoured a code the declared contract says is not one.
   */
  const c = norm(trusted.residenceCountry).toUpperCase()
  return ISO_ALPHA3.has(c) ? c : null
}

/** Cheap boolean for a gate that does not need the details. */
export async function hasVerifiedIdentity(profileId: string): Promise<boolean> {
  return (await verifiedIdentityFor(profileId)) !== null
}

/**
 * ⚠️ THE PARTY AS THE PAYMENTS RULES SEE IT. `railAllowed` reasons about a TRADE, so asking about a
 * single person means passing them as both sides — the honest way to ask "could this party ever be
 * on this rail", and it costs nothing.
 */
export function partiesFor(identity: VerifiedIdentity): PartyIdentity[] {
  /**
   * ⛔ ONE PARTY PER NATIONALITY, AND EVERY ONE MUST PASS — BECAUSE SUMMARISING WAS THE BUG. Round
   * four fixed a dual national shedding a Vietnamese passport by picking "the most restrictive"
   * nationality to hand over. Round five showed that fix was itself a second source of truth: it
   * needed a hand-copy of eligibility.ts's sanctions list to know what "restrictive" meant, and a
   * code added there and forgotten here would silently hand over the innocent passport instead.
   * Both reviewers said the same thing — squeezing a history into one string fights the strictness
   * of the gate.
   *
   * ⚠️ SO NOTHING IS SUMMARISED AND NO RULE IS MIRRORED. eligibility.ts is asked about EVERY
   * nationality on record and the answers are intersected by `railsFor`. It already refuses an
   * absent, malformed or unlisted nationality (`ZZZ`, `VN`, `VIETNAM`, null) on its own terms, so
   * those cases are covered by the authority rather than by a second copy of its judgement here.
   * The cost is a few extra calls against a pure function; the benefit is that this file cannot
   * drift from the rules it is enforcing.
   */
  const base = { kycVerified: true, residenceCountry: identity.residenceCountry }
  // ⚠️ MAPPED ON THE FALLBACK PATH TOO — a reviewer spotted `isoNationality` applied to the list
  // below but not to this branch, so a lone MRZ `'D'` reached the gate raw and was refused.
  if (identity.nationalities.length === 0) {
    return [{ ...base, nationality: isoNationality(identity.nationality) ?? identity.nationality }]
  }
  /**
   * ⚠️ MAPPED TO ISO HERE, AND AN UNMAPPABLE CODE IS PASSED THROUGH RATHER THAN DROPPED. Dropping it
   * would delete a party from the intersection and could only ever make the answer more permissive;
   * passing the raw value through means eligibility.ts refuses it on its own terms, which is both
   * the safe direction and the one that keeps the judgement in one place.
   */
  return identity.nationalities.map((n) => ({ ...base, nationality: isoNationality(n) ?? n }))
}

/**
 * The rails open to this identity — allowed only where allowed for EVERY nationality it holds.
 *
 * ⚠️ ASKED ABOUT THE PERSON AS BOTH SIDES, because `railAllowed` reasons about a TRADE and this is
 * one person. It is the honest way to ask "could this party ever be on this rail" and costs nothing.
 */
export function railsFor(identity: VerifiedIdentity): PaymentRailId[] {
  const parties = partiesFor(identity)
  /**
   * ⛔ AN EMPTY PARTY SET GRANTS NOTHING, AND WITHOUT THIS LINE IT GRANTED EVERYTHING. `every()` on
   * an empty array is vacuously TRUE, so a future change that let `partiesFor` return `[]` would
   * hand out every rail rather than none — silently, in the worst possible direction. A reviewer
   * found the branch guarding it was itself untested.
   */
  if (parties.length === 0) return []
  /**
   * ⚠️ THE RAIL UNIVERSE COMES FROM `availableRails`, NEVER FROM A LIST HERE. The first version kept
   * a local `ALL_RAILS` to intersect against and all three reviewers flagged it as the one thing
   * this round was supposed to eliminate: a rail added in eligibility.ts and forgotten here would
   * simply never be offered. Intersecting the answers themselves means there is no second list.
   */
  const [first, ...rest] = parties.map((p) => availableRails(p, p))
  return first.filter((rail) => rest.every((rails) => rails.includes(rail)))
}

/**
 * What one verified identity unlocks.
 *
 * ⛔ EVERY CAPABILITY COMES FROM THE SAME VERIFICATION — that is the whole point. A user who passed
 * KYC for a visa application can buy an eSIM and be paid through a wallet without submitting
 * anything again, and a feature added next year gets the same treatment by adding a member to
 * `IdentityCapability` rather than by building another document flow.
 *
 * ⛔ AND THE MEMBERS ARE GATED ON WHAT THEY ARE NAMED FOR, NOT MERELY ON IDENTITY. This set said
 * "has proved who they are" while every member is named for something a person may DO, and all
 * three reviewers read it the way a future caller will: `hasCapability(p, 'wallet')` returning true
 * for a Hanoi resident is one render away from offering a stablecoin rail the DTI Law does not
 * permit. So the country rules are CONSULTED here rather than reimplemented — one predicate,
 * `availableRails`, asked wherever the question comes up, so identity and lawfulness cannot drift
 * apart into two answers.
 * ⚠️ WHICH LEAVES `esim` AS THE ONLY MEMBER NOT GATED ON A PAYMENT RAIL, and that is correct: a
 * carrier registration needs a verified legal name and is not a payment. It is still gated on
 * actually HAVING that name.
 */
export async function identityCapabilities(profileId: string): Promise<Set<IdentityCapability>> {
  const identity = await verifiedIdentityFor(profileId)
  if (!identity) return new Set()

  /**
   * ⛔ eSIM NEEDS A VERIFIED LEGAL *NAME*, NOT MERELY A VERIFIED ROW. A reviewer pointed out that
   * `fullName` is nullable and the capability was granted regardless — so a user with no recorded
   * name would be told they can buy an eSIM and then be refused by the carrier, which requires the
   * subscriber's legal name by Vietnamese regulation. Advertising a capability the next step will
   * reject is worse than not advertising it.
   * ⚠️ SAME FOR `visa`, WHICH IS AN APPLICATION IN SOMEONE'S NAME. The edition gate below is about
   * whether this build may offer it at all; this is about whether we hold what it needs.
   */
  const caps = new Set<IdentityCapability>()
  if (identity.fullName && identity.fullName.trim() !== '') caps.add('esim')

  /**
   * ⛔ SETTLEMENT IS SERVICES-ONLY, BEFORE ANY COUNTRY RULE IS EVEN CONSULTED. Owner, 2026-08-30:
   * *"eno.vn stay paymentless but eno.forum will have payment settlement layer alongside paypal"*.
   * PayPal is also one of the three surfaces the licensed sàn TMĐT may not carry at all.
   * ⚠️ THIS WAS THE ROUND-TWO DEFECT AND IT IS SUBTLE: `railAllowed('paypal', …)` returns null for
   * ANY kyc-verified pair — fiat availability is a licensing question, not a country-gate one — and
   * `partyFor` always sets `kycVerified: true`, so `availableRails` was never empty and `payments`
   * was unconditionally true for every verified identity, on the marketplace included. A reviewer
   * put it exactly right: round one's "named for an action, gated on identity" defect had simply
   * moved one member across.
   */
  if (IS_SERVICES) {
    const rails = railsFor(identity)
    if (rails.length > 0) caps.add('payments')
    if (rails.includes('crossmint')) caps.add('wallet')
  }

  /**
   * ⛔ `visa` IS EDITION-GATED AND THE OTHERS ARE NOT. eno.vn is a licensed sàn TMĐT and may not
   * surface visa services at all, so a capability set that always advertised `visa` would hand the
   * marketplace a true answer to a question it must never ask. A reviewer caught it.
   * ⚠️ THE ROUTES ARE ALREADY BUILD-TIME EXCLUDED (`.svc.`), so this is defence in depth rather
   * than the guarantee — but a capability list is exactly the sort of thing a future feature reads
   * to decide what to render.
   */
  if (IS_SERVICES && identity.fullName && identity.fullName.trim() !== '') caps.add('visa')
  return caps
}

export async function hasCapability(profileId: string, cap: IdentityCapability): Promise<boolean> {
  return (await identityCapabilities(profileId)).has(cap)
}
