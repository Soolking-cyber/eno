import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { bumpBrandCount } from '@/lib/brand'
import { fold } from '@/lib/fold'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { partitionByIdentityGate, settleHolds } from '@/lib/compliance/seller-publish-gate'
import { appendAudit } from '@/lib/compliance/audit'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'
import { tombstoneListingsTx } from '@/lib/core/listing-tombstone'
import { licenceBlockedIds } from '@/lib/core/licence-check'
import { deskSellerIds } from '@/lib/edition-scope'
import { LISTING_REMOVED, NOT_REMOVED } from '@/lib/listing-removed'
import { notifyDispute } from '@/lib/dispute'
import { removalClosedBy } from '@/lib/trust-math'
import { logError } from '@/lib/log'
import { REACTIVATION_SALE_RESET } from '@/lib/trade-loop'
import { withdrawSaleQuestions } from '@/lib/core/sale-withdraw'
import { attributeBag, isLicenceCheckSlot, LICENCE_CHECK_SUBCATEGORIES, VISA_CATEGORY_SLUG } from '@/lib/taxonomy'
import { checkProviderLicence, isEnterpriseCodeForm, providerLicenceFromInput, providerLicenceOf } from '@/lib/provider-licence'
import { LICENCE_HELD_NOTE, LICENCE_STAMP_CLEARED, LICENCE_STAMP_PREFIX, isLicenceWhitelisted, licenceClearedWhere, licenceWhitelistWhere, licenceStampFor, licenceStateOf } from '@/lib/licence-stamp'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'

export const dynamic = 'force-dynamic'

/** Report states that keep a licence approval from publishing (R4): a case still open, or one upheld against the row. */
const OPEN_CASE = ['open', 'confirmed']
/** Owner enforcement states under which an approval publishes nothing — the hold pulled the account's listings. */
const OWNER_PULLED = ['held', 'suspended']

/**
 * ⚖️ PUBLISH — "verify", and the publish half of 'licence-approve' (owner, 2026-10-14). The verify body, moved here
 * unchanged but for the licence check:
 *   · ⛔ UNCLEARED LICENCE-AISLE ROWS ARE LEFT OUT FIRST (licenceBlockedIds — a non-desk e-Visa or Legal & permits
 *     listing whose provider values eno has not approved as they stand) and counted as `licenceCheck`: they go live only
 *     through Catalogue › Licence checks. Not parked either — an identity hold on one would be a publish the moment its
 *     seller verifies (releaseIdentityHolds), the licence aside;
 *   · both writes AND licenceClearedWhere(desk), the necessary condition that closes the race with an edit clearing the
 *     stamp between the pre-filter and the write. Spelled in the call, where public-state-writes.test.ts looks for it;
 *   · `onlyIf` is ANDed into both writes as well — 'licence-approve' passes "no open or confirmed report, owner not held
 *     or suspended, not Restricted, still carrying the licence hold's mark" (R4, plan review 2026-10-14; commit gate), so
 *     a report filed, a hold applied or an Unverify landing after its read cannot be published over. "verify" passes
 *     nothing: Publish has always been the admin's own call on those;
 *   · the publish write drops the licence hold's mark (licence-stamp.ts LICENCE_HELD_NOTE), as every publish of an
 *     existing row does (compliance/public-state-writes.test.ts): a public row is nobody's hold. The park keeps it.
 * Everything else — the identity gate's partition, the park, the re-check (settleHolds) and the counts — is the verify
 * branch's, and its comments below say why.
 */
async function publishListings(
  ids: string[], desk: string[], onlyIf?: Prisma.ListingWhereInput,
): Promise<{ affected: number; held: number; alreadyHeld: number; licenceCheck: number }> {
  const blocked = await licenceBlockedIds(ids, desk)
  const eligible = blocked.size ? ids.filter((id) => !blocked.has(id)) : ids
  // ⚖️ For an owner the identity gate refuses, the admin's approval is recorded as a HOLD (identityHold) and becomes a
  // publish the moment they verify. Never a silent no-op. A gated row that is ALREADY verified is left exactly as it is
  // (counted, not rewritten): the gate governs entering public state, and re-verifying must not turn into a takedown.
  const { allowed, held: gated } = await partitionByIdentityGate(eligible)
  // `identityHold: false` rides the publish: a row parked earlier (the gate was on and has since
  // been switched off, or the owner verified and the release missed it) must not go live still
  // carrying a hold. Only the response is pinned byte-identical with the gate off — this column
  // is already false on every row the gate never touched.
  let affected = allowed.length ? (await db.listing.updateMany({ where: { id: { in: allowed }, ...NOT_REMOVED, AND: [licenceClearedWhere(desk), ...(onlyIf ? [onlyIf] : [])] }, data: { verified: true, identityHold: false, verificationNotes: null } })).count : 0
  let held = 0
  let alreadyHeld = 0
  if (gated.length) {
    // Read BEFORE the park and the re-check: afterwards a parked row and a pre-existing hold look
    // the same, and a pre-existing hold the re-check released would look "already verified".
    const before = await db.listing.findMany({ where: { id: { in: gated }, ...NOT_REMOVED }, select: { verified: true, identityHold: true } })
    alreadyHeld = before.filter((r) => !r.verified && r.identityHold).length
    // `identityHold: false` in the WHERE: an already-parked row is not parked again, so it can
    // never be counted as held by this request.
    const parked = (await db.listing.updateManyAndReturn({ where: { id: { in: gated }, verified: false, identityHold: false, ...NOT_REMOVED, AND: [licenceClearedWhere(desk), ...(onlyIf ? [onlyIf] : [])] }, data: { identityHold: true }, select: { id: true } })).map((r) => r.id)
    const released = parked.length ? await settleHolds(parked) : 0
    held = parked.length - released
    // Already verified (left as asked, as the allowed path counts it) + parked-then-released here.
    affected += before.filter((r) => r.verified).length + released
  }
  return { affected, held, alreadyHeld, licenceCheck: blocked.size }
}

/** The `seen` map 'licence-approve' sends — id → the stamp the admin's screen showed. Anything else reads as empty. */
function seenStamps(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

// Admin listings tool — browse + batch-act on listings. Every action re-checks
// getAdmin(). GET lists (search/status/verified filters, paginated); POST runs a
// batch action over selected ids.

// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, ON BOTH METHODS. `auth: 'admin'` emits exactly the
// `{"error":"Forbidden"}` 403 both `if (!(await getAdmin()))` lines emitted, capital F included.
// Neither method used the admin's email, so nothing is destructured from ctx beyond `req`.
//
// ⚠️ NO `body:` SCHEMA ON POST, AND THE REASON IS THE HAND-COERCION. Today `{"ids":"abc"}` and
// `{"ids":[1,2]}` both survive `Array.isArray(...) ? filter(typeof x === 'string') : []` and land on
// `{"error":"no_ids"}` 400; a zod schema would answer `bad_request` 400 instead. Same status, a
// different code on the wire — so the tolerant parse stays. Malformed JSON already answers
// `bad_request` 400 and keeps doing so from the same try/catch.
//
// ⚠️ NO `rateLimit:` — there was none. GET's query-string coercion also stays put: route() has no
// searchParams option and this migration adds no validation it did not have.
//
// GET branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · any q/status/verified/limit/
// offset combination → 200 `{listings,total}` (limit clamped 1..100, offset ≥ 0, unchanged). Each row
// carries `subcategory`, and a non-desk e-Visa / Legal & permits row also `licence: {state, legalName,
// licenceNo, enterpriseCode}` (2026-10-14 — licence-stamp.ts licenceStateOf; the values verbatim, even when
// invalid, so the console can say what is wrong).
// POST actions: delete · hide · activate · feature · unfeature · verify · unverify · licence-approve ·
// licence-revoke (the last two since 2026-10-14 — Catalogue › Licence checks).
// POST branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · malformed JSON → 400
// `{"error":"bad_request"}` · no usable ids → 400 `{"error":"no_ids"}` · unrecognised action → 400
// `{"error":"bad_action"}` · success → 200 `{"ok":true,"affected":n}` (+ `"held":h` when the seller identity
// gate parked any in this request, + `"alreadyHeld":k` when the batch included rows it had parked before
// — neither ever appears while IDENTITY_GATE_ENFORCED is off, so the off-state body is unchanged; + on
// "activate" / "verify", `"licenceCheck":n` when n e-Visa / Legal & permits rows were left out for the licence
// check — absent when the batch held none, so its body is unchanged; + on "delete" only, `"resolved":r` when
// the removal closed r open reports — absent when it closed none). "licence-approve" answers
// `{"ok":true,"affected":published,"approved":a}` + `held` / `alreadyHeld` (identity gate) / `stillHeld`
// (approved but still unpublished: an open or confirmed report, the owner held or suspended, or a row that was
// already approved — a second approval publishes nothing) / `stale` (changed since the admin's screen —
// reload) / `invalid` (not an approvable aisle row), each only when non-zero.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL, ON EACH METHOD: neither had a try/catch around its Prisma
// calls, so a DB rejection (GET's findMany/count, POST's deleteMany/updateMany, or bumpBrandCount)
// used to reach Next's default 500 HTML and now returns `{"error":"internal_error"}` 500, logged
// with an `op`. Accepted improvement, declared rather than claimed away.
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const status = searchParams.get('status') // active | hidden | sold | removed | all
  const verified = searchParams.get('verified') // true | false | all
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)
  // Keyset paging for the console's "Load more": `before=<createdAt ISO>~<id>` — rows after that one in this order. An
  // offset shifts when a row is added to or leaves the filter between pages (a duplicate, or a held row never shown).
  const before = /^([^~]+)~(.+)$/.exec(searchParams.get('before') ?? '')
  const beforeAt = before ? new Date(before[1]) : null

  const AND: Record<string, unknown>[] = []
  if (q) AND.push({ searchText: { contains: fold(q) } })
  if (status && status !== 'all') AND.push({ status })
  if (verified === 'true') AND.push({ verified: true })
  else if (verified === 'false') AND.push({ verified: false })
  const filterWhere = AND.length ? { AND } : {}
  const where = beforeAt && !Number.isNaN(beforeAt.getTime())
    ? { AND: [...AND, { OR: [{ createdAt: { lt: beforeAt } }, { createdAt: beforeAt, id: { lt: before![2] } }] }] }
    : filterWhere

  // ⚠️ CARD serializer + CARD select, matched ON PURPOSE. This handler used to feed
  // serializeListing (the FULL-listing serializer) a seller narrowed to {name,
  // trustScore} behind an `as never` — the serializer's `seller.memberSince
  // .toISOString()` then threw on EVERY request, a deterministic 500 the cast had
  // silenced since the two shipped together. Nothing e2e-opens this queue, so it
  // surfaced only when the desk did (prod 5xx alert, 2026-07-23). The card
  // projection carries everything this table renders; the admin extras ride the row.
  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      select: {
        ...LISTING_CARD_SELECT,
        status: true,
        featured: true,
        createdAt: true,
        // The licence stamp (licence-stamp.ts) — read to say where an aisle row stands, never put on the wire.
        verificationMethod: true,
        seller: { select: { name: true, trustScore: true, officialPartner: true, ownerId: true, owner: { select: { accountType: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    }),
    // The filter's whole count, whatever page this is.
    db.listing.count({ where: filterWhere }),
  ])

  // ⛔ A LICENCE HOLD IS NOT A TAKEDOWN (Opus #9, plan review 2026-10-14): a held e-Visa / Legal & permits row reads
  // "Licence check" or "Licence details missing" in the console, not the generic held, and its values ride the row so
  // the operator sees what the seller typed. eno's desk is resolved once, and only for a page that holds an aisle row.
  const desk = rows.some((r) => isLicenceCheckSlot(r.category.slug, r.subcategorySlug)) ? await deskSellerIds() : []
  const listings = rows.map((r) => {
    const l = serializeListingCard(r)
    const row = { id: l.id, title: l.titleVi || l.title, price: l.price, currency: l.currency, image: l.images[0] ?? null, status: r.status, verified: r.verified, featured: r.featured, sellerName: r.seller.name, category: l.category.name, subcategory: r.subcategorySlug, createdAt: r.createdAt.toISOString() }
    const state = licenceStateOf({ categorySlug: r.category.slug, subcategorySlug: r.subcategorySlug, sellerId: r.sellerId, attributes: r.attributes, verificationMethod: r.verificationMethod, verified: r.verified }, { desk: desk.includes(r.sellerId) })
    if (state === 'not_aisle' || state === 'exempt') return row
    // Both halves as stored, even one alone or one the rules refuse: providerLicenceOf answers null unless both are
    // there, which would hide exactly what the operator needs to see on a 'missing' row.
    const v = providerLicenceFromInput(attributeBag(r.attributes)) ?? { legalName: '', licenceNo: '' }
    return { ...row, licence: { state, legalName: v.legalName, licenceNo: v.licenceNo, enterpriseCode: isEnterpriseCodeForm(v.licenceNo) } }
  })
  return NextResponse.json({ listings, total })
})

export const POST = route({ auth: 'admin' }, async ({ req, admin }) => {
  // `seen` ('licence-approve' only): listing id → the stamp of the values the admin's screen showed (licence-stamp.ts).
  let body: { action?: string; ids?: string[]; seen?: Record<string, string> }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 500) : []
  if (!ids.length) return NextResponse.json({ error: 'no_ids' }, { status: 400 })

  let affected = 0
  // Listings the seller identity gate PARKED instead of publishing (activate/verify/licence-approve, gate
  // on only). Reported so the console can say "published 8 · 2 held until the seller verifies" rather
  // than letting an operator believe all ten went live. Always 0 while the gate is off.
  // ⚠️ `held` IS WHAT THIS REQUEST PARKED — the ids the park write itself returned, less any the
  // re-check released — never a count derived from the decision set. Deriving it from the set
  // counted rows the WHERE guard skipped, and handing that set to settleHolds let a PRE-EXISTING
  // hold released by the re-check cancel out one parked here: "2 activated, 0 held", with the
  // parked row visible nowhere.
  let held = 0
  // Rows in the batch that were ALREADY parked (verified=false, identityHold=true) before this
  // request. They are neither "activated/published" (they are not public, and this request did not
  // make them so) nor "held" (this request did not park them) — so they get their own count, and the
  // console says they are still waiting on the seller. Always 0 while the gate is off.
  let alreadyHeld = 0
  // "delete" only: the open reports on the listings this request removed, closed with them.
  let resolvedReports = 0
  // "activate" / "verify": e-Visa / Legal & permits rows left out because eno has not approved their provider's licence
  // (licence-stamp.ts) — they go live only through Catalogue › Licence checks. 0 for every batch without one.
  let licenceCheck = 0
  // "licence-approve" only: its own answer (see the header) — the batch actions' fields mean other things.
  let approval: Record<string, number> | null = null
  /**
   * ⛔ A TOMBSTONE IS NOT ACTIONABLE FROM HERE — EVERY NON-REMOVE WRITE BELOW ANDs `NOT_REMOVED`
   * (2026-10-01, review). The console's "Removed" filter makes selecting tombstones one click away, and
   * without the guard "Hide" turned a removed row into the SELLER state 'hidden' (back in the seller's
   * dashboard, relistable by the seller), "Activate" + "Publish" republished a moderator's removal, and
   * none of it wrote a compliance_audit row — contradicting the console's own "the seller cannot relist
   * it" and src/lib/listing-removed.ts. The guard is in each WHERE (atomic with the write), so a row
   * removed between the console's read and this request is skipped too, and `affected` never counts one.
   * There is deliberately no "restore" action: undoing a removal is an audited decision nobody has
   * specified yet, not a bulk toggle.
   * ⚠️ SPREAD INTO THE `where` LITERAL, NOT WRAPPED IN A HELPER CALL: public-state-writes.test.ts audits
   * this file's publishing writes by reading the literal, and a `where: helper({...})` reads to it as
   * a second `status: 'active'` write.
   */
  switch (body.action) {
    case 'delete': {
      // ⛔ "DELETE" IS A TOMBSTONE (2026-10-01 — src/lib/listing-removed.ts). This was `deleteMany`,
      // which cascaded every report and buyer conversation on up to 500 listings at a click; Law
      // 122/2025 Art 17.1(e) keeps posted information for at least a year. The action keeps its wire
      // name (the console sends 'delete'); what it does is status 'removed' + unpublished, one
      // compliance_audit row per listing naming this admin. `affected` counts the rows THIS request
      // removed (already-removed ones are skipped), and only those decrement their brand's count.
      // ⚠️ 500 audit appends serialise on one advisory lock — hence the longer transaction timeout.
      //
      // ⛔ AND THE REMOVED LISTINGS' OPEN CASES CLOSE WITH THEM — exactly as the moderation queue's
      // "Remove listing" does (api/admin/moderate 'reject'; 2026-10-01, review). The old deleteMany
      // CASCADED the reports, which is what used to take the cases out of the queue. Kept rows stayed
      // OPEN: the case sat in the moderation queue after the removal (sections/reports-inbox.tsx reads
      // status 'open'), every report also names the seller (targetSellerId), so deleteHoldReason
      // (core/listings.ts) turned each later seller delete of ANY of their listings into a hide, and the
      // retention scrub skips a tombstone with an open report (core/listing-tombstone-retention.ts).
      // Resolved in the SAME transaction as the tombstones: 'confirmed' (the listing was removed — the
      // reporter's case room says "upheld, action taken"), by this admin, one stamp for the batch.
      // ⚠️ WITH NO TRUST CHARGE, as in 'reject': a charge is a report_confirmed TrustEvent (the
      // Confirm button's job), not the status. Only the rows THIS request removed: a listing that was
      // already a tombstone keeps its reports as they are (re-clicking Remove decides nothing new).
      // Labelled `listing-removed:<admin>` (trust-math.ts) — an uncharged confirm. Its respondent may still
      // appeal, and denying that appeal charges nothing either (api/admin/moderate confirm-report).
      const stamp = new Date()
      const closedBy = removalClosedBy(admin)
      const { removed, resolved } = await db.$transaction(async (tx) => {
        const removed = await tombstoneListingsTx(tx, ids, { actor: { kind: 'admin', email: admin }, reason: 'admin_removed' })
        if (!removed.length) return { removed, resolved: 0 }
        const upd = await tx.report.updateMany({
          where: { listingId: { in: removed.map((r) => r.id) }, status: 'open' },
          data: { status: 'confirmed', resolvedBy: closedBy, resolvedAt: stamp },
        })
        return { removed, resolved: upd.count }
      }, { timeout: 60_000 })
      affected = removed.length
      resolvedReports = resolved
      const byBrand = new Map<string, number>()
      for (const r of removed) if (r.brandSlug) byBrand.set(r.brandSlug, (byBrand.get(r.brandSlug) ?? 0) + 1)
      await Promise.all([...byBrand].map(([slug, n]) => bumpBrandCount(slug, -n)))
      // The reporters' case rooms survive the removal, so tell them how it ended — only the rows THIS
      // request resolved (matched by the resolve stamp). Best-effort: the decision has landed.
      if (resolved) {
        try {
          const rows = await db.report.findMany({
            where: { listingId: { in: removed.map((r) => r.id) }, status: 'confirmed', resolvedBy: closedBy, resolvedAt: stamp },
            select: { id: true, reporterProfileId: true },
          })
          // ⛔ ONE REPORTER'S FAILED NOTICE MUST NOT ABANDON THE REST — each is its own best effort.
          for (const r of rows) {
            if (!r.reporterProfileId) continue
            try {
              await notifyDispute(r.reporterProfileId, r.id, 'decided_upheld_reporter')
            } catch (e) {
              logError(e, { op: 'admin.listings.removeNotifyReporters', reportId: r.id })
            }
          }
        } catch (e) {
          logError(e, { op: 'admin.listings.removeNotifyReporters' })
        }
      }
      break
    }
    // ⛔ HIDE IS A MODERATION TAKEDOWN, NOT A SELLER'S OWN HIDE (security review 2026-10-22, item 9). It used to set
    // status:'hidden' only, leaving verified:true — so the seller's one-tap Relist (setStatusCore: hidden → active)
    // put a listing a moderator had just pulled straight back on sale, verified intact. Public = verified AND
    // status='active', so this now also writes the documented takedown idiom (verified:false + identityHold:false,
    // schema.prisma): a relisted row flips to active but stays non-public until an admin re-verifies (the 'verify' or
    // 'activate' action). Same columns as 'unverify', plus the hidden status.
    case 'hide': affected = (await db.listing.updateMany({ where: { id: { in: ids }, ...NOT_REMOVED }, data: { status: 'hidden', verified: false, identityHold: false } })).count; break
    case 'activate': {
      // ⚖️ Activating a VERIFIED row that is not live yet publishes it, so for an owner the identity
      // gate refuses that row is parked instead: the status the admin asked for is applied, with
      // verified→false + identityHold→true until they verify. Two kinds of gated row are NOT parked:
      //   · already unverified — not public either way; giving it identityHold would turn a
      //     moderator's takedown into something verifying undoes.
      //   · already active AND verified — already public. The gate governs ENTERING public state; an
      //     "activate" that changes nothing must not quietly become a takedown.
      //
      // ⛔ EVERY "→ active" WRITE BELOW ALSO CLEARS THE SALE (REACTIVATION_SALE_RESET, src/lib/trade-loop.ts):
      // activating a sold row is a relist, and the seller's relist (setStatusCore) and revive (confirmCore)
      // already clear it. Without it an admin-activated listing kept its buyer, agreed price and pending
      // "did you buy this?" question — answerable while the item was back on sale.
      //
      // ⛔ A STATUS CHANGE ALONE CAN PUBLISH (R1, plan review 2026-10-14): a VERIFIED hidden or sold row goes public
      // the moment it is active again. So an e-Visa / Legal & permits row eno has not approved (licenceBlockedIds — a
      // grandfathered VietKite row the seller hid, or one the daily sweep has not reached yet) is LEFT OUT of every
      // write here, whatever its flags, and counted as `licenceCheck` like Publish does; each write also ANDs
      // licenceClearedWhere(desk) against an edit landing between that read and the write. The grandfather is never
      // consulted: no path may put a row back live on it once it is down (licence-stamp.ts LICENCE_GRANDFATHER).
      const desk = await deskSellerIds()
      const blocked = await licenceBlockedIds(ids, desk)
      licenceCheck = blocked.size
      const eligible = blocked.size ? ids.filter((id) => !blocked.has(id)) : ids
      const { allowed, held: gated } = await partitionByIdentityGate(eligible)
      // The ids each write really activated — the sale questions below are withdrawn for those only (commit gate): a row
      // the licence guard made a write miss is not back on sale.
      const activatedIds: string[] = []
      const activated = allowed.length ? await db.listing.updateManyAndReturn({ where: { id: { in: allowed }, ...NOT_REMOVED, AND: [licenceClearedWhere(desk)] }, data: { status: 'active', ...REACTIVATION_SALE_RESET }, select: { id: true } }) : []
      activatedIds.push(...activated.map((r) => r.id))
      affected = activated.length
      if (gated.length) {
        // ⚠️ THE UNPARKED ROWS FIRST: once a row is parked it is itself `verified: false`, and running
        // this second would match it again and double-count. The two WHEREs are disjoint as ordered.
        // An ALREADY-parked row lands here too (it is unverified): its status is applied, so it goes
        // live as the admin asked once the seller verifies — but it is counted as `alreadyHeld`, not
        // as affected. The returned flags are the rows' own, untouched by this status-only write.
        const rest = await db.listing.updateManyAndReturn({ where: { id: { in: gated }, OR: [{ verified: false }, { status: 'active' }], ...NOT_REMOVED, AND: [licenceClearedWhere(desk)] }, data: { status: 'active', ...REACTIVATION_SALE_RESET }, select: { id: true, verified: true, identityHold: true } })
        activatedIds.push(...rest.map((r) => r.id))
        const parked = (await db.listing.updateManyAndReturn({ where: { id: { in: gated }, verified: true, status: { notIn: ['active', LISTING_REMOVED] }, AND: [licenceClearedWhere(desk)] }, data: { status: 'active', verified: false, identityHold: true, ...REACTIVATION_SALE_RESET }, select: { id: true } })).map((r) => r.id)
        activatedIds.push(...parked)
        // A verification that landed between the decision and the park is released here (see
        // settleHolds); those rows went live after all, so they count as affected, not held. Only
        // the ids parked HERE are re-checked, so only they can be counted as released.
        const released = parked.length ? await settleHolds(parked) : 0
        held = parked.length - released
        alreadyHeld = rest.filter((r) => !r.verified && r.identityHold).length
        // ⚠️ `affected` NEVER INCLUDES A PARKED ROW — in both gated actions. It means "took effect as
        // asked", exactly as it does for an owner the gate allows; parked rows are reported as `held`
        // alongside, so "activate · 8 · 2 held" and "verify · 8 · 2 held" mean the same thing for the
        // same ten ids. Of the rows the gate intercepted, only the ones this request parked AND then
        // itself released went public because of it, so only those join `affected`.
        affected += rest.length - alreadyHeld + released
      }
      // …and the "did you buy this?" those sales put to their buyers goes with them, in this request: every
      // row for these listings, whoever was asked (withdrawSaleQuestions — best-effort, never fails the
      // activate). Without it a buyer kept an unread question in the bell for a listing back on sale.
      // Not for a row the licence check left out, nor one a guard made a write miss: it is not back on sale.
      await withdrawSaleQuestions(activatedIds)
      break
    }
    case 'feature': affected = (await db.listing.updateMany({ where: { id: { in: ids }, ...NOT_REMOVED }, data: { featured: true } })).count; break
    case 'unfeature': affected = (await db.listing.updateMany({ where: { id: { in: ids }, ...NOT_REMOVED }, data: { featured: false } })).count; break
    case 'verify': {
      // ⚖️ "Publish" — publishListings above: the identity gate as it always was, and since 2026-10-14 every
      // e-Visa / Legal & permits row eno has not approved left out and counted (`licenceCheck`).
      ;({ affected, held, alreadyHeld, licenceCheck } = await publishListings(ids, await deskSellerIds()))
      break
    }
    case 'licence-approve': {
      // ⛔ THE ONE STAMP WRITER (owner, 2026-10-14 — "Anyone posts, live after check"; licence-stamp.ts). Catalogue ›
      // Licence checks sends the ids of one group and `seen`: id → the stamp of the values the admin compared with the
      // copies the provider emailed. A row is approved only for EXACTLY those values:
      //   · invalid — not an e-Visa / Legal & permits row, eno's own desk (exempt — nothing to approve), or values
      //     missing or unacceptable (provider-licence.ts): nothing to approve until the seller fixes them;
      //   · stale — gone, removed, or its values, aisle or seller no longer stamp to what the screen showed;
      //   · ALREADY APPROVED for these values — idempotent (R4, plan review 2026-10-14): no write, no audit row; published
      //     only while it is still a PURE LICENCE HOLD (below — the mark, no report, owner and tier fine): the publish that
      //     should have followed its approval failed, or was refused for a reason since settled (commit gate). A second
      //     click still cannot republish what moderation took down since: that dropped the mark or filed a report.
      // Each stamp is a COMPARE-AND-SET on everything this read decided on, `verificationMethod`, `verified` and
      // `updatedAt` included (R4): a revoke, an edit or another approval landing between the read and the write makes it
      // match nothing (stale) — a concurrent revoke wins. Every Prisma write bumps @updatedAt, which is what makes the
      // revoke of a row still waiting (whose stamp and flag it does not change) visible here. One audit row per stamp,
      // naming this admin; the stamp itself never names anyone (licence-stamp.ts).
      const seen = seenStamps(body.seen)
      const desk = await deskSellerIds()
      const wanted = [...new Set(ids)]
      const rows = await db.listing.findMany({
        where: { id: { in: wanted }, ...NOT_REMOVED },
        select: {
          id: true, sellerId: true, subcategorySlug: true, attributes: true, verificationMethod: true, verified: true, updatedAt: true,
          verificationNotes: true, identityHold: true,
          category: { select: { slug: true } },
          seller: { select: { trustTier: true, owner: { select: { enforcementState: true } } } },
          _count: { select: { reports: { where: { status: { in: OPEN_CASE } } } } },
        },
      })
      const found = new Set(rows.map((r) => r.id))
      let stale = wanted.filter((id) => !found.has(id)).length
      let invalid = 0
      const toStamp: Array<{ r: (typeof rows)[number]; stamp: string }> = []
      const already: Array<(typeof rows)[number]> = []
      for (const r of rows) {
        const v = providerLicenceOf(r.attributes)
        // A whitelisted storefront is exempt like the desk (licence-stamp.ts LICENCE_WHITELIST): nothing to approve.
        if (!isLicenceCheckSlot(r.category.slug, r.subcategorySlug) || desk.includes(r.sellerId) || isLicenceWhitelisted(r.sellerId, r.subcategorySlug) || !v || checkProviderLicence(v, r.subcategorySlug)) { invalid++; continue }
        const stamp = licenceStampFor(r, v)
        if (seen[r.id] !== stamp) { stale++; continue }
        if (r.verificationMethod === stamp) already.push(r)
        else toStamp.push({ r, stamp })
      }
      const now = new Date()
      const stamped = toStamp.length ? await db.$transaction(async (tx) => {
        const done: typeof toStamp = []
        for (const a of toStamp) {
          const { r, stamp } = a
          const { count } = await tx.listing.updateMany({
            where: { id: r.id, ...NOT_REMOVED, sellerId: r.sellerId, subcategorySlug: r.subcategorySlug, attributes: r.attributes, verificationMethod: r.verificationMethod, verified: r.verified, updatedAt: r.updatedAt, verificationNotes: r.verificationNotes },
            // The licence hold's mark is NOT touched here: the publish below drops it in the write that makes the row
            // public (commit gate) — a row this approval cannot publish keeps it (licence-stamp.ts LICENCE_HELD_NOTE).
            data: { verificationMethod: stamp, verifiedAt: now, verifiedBy: null },
          })
          if (count !== 1) continue
          await appendAudit(tx, {
            actorType: 'admin',
            actorId: admin,
            action: 'listing.licence_approved',
            subjectType: 'listing',
            subjectId: r.id,
            detail: { subcategory: r.subcategorySlug, sellerId: r.sellerId, stamp: stamp.slice(LICENCE_STAMP_PREFIX.length) },
            legalBasis: 'ecommerceLaw',
          })
          done.push(a)
        }
        return done
      }, { timeout: 60_000 }) : []
      stale += toStamp.length - stamped.length
      // Publish what was a pure licence hold: unpublished BY THE LICENCE CHECK (it carried LICENCE_HELD_NOTE — commit gate:
      // `verified: false` is also an admin Unverify or a moderation Unpublish, which an approval of the licence must not
      // undo), no open or confirmed report, owner not held or suspended (a pulled account's listings come back with its
      // lift, never with an approval), and not a Restricted storefront (the trust floor that bars its posting). Everything
      // else stays as it is, approved — `stillHeld`, which the Licence checks tab shows with "Publish (Listings tab) makes
      // it live". A row that was already live (VietKite's, inside the grandfather) simply stays live.
      const approvedNow = stamped.map((a) => a.r)
      const publish = [...approvedNow, ...already]
        .filter((r) => !r.verified && r.verificationNotes === LICENCE_HELD_NOTE && r._count.reports === 0 && !OWNER_PULLED.includes(r.seller.owner?.enforcementState ?? '') && r.seller.trustTier !== 'restricted')
        .map((r) => r.id)
      // An ALREADY-approved row the identity gate parked and this request does not re-publish is waiting on its owner, not
      // "still unpublished" for a reason the console lists: counted as alreadyHeld, as a publish of it would be (gate).
      const parkedAlready = already.filter((r) => !r.verified && r.identityHold && !publish.includes(r.id)).length
      let stillHeld = [...approvedNow, ...already].filter((r) => !r.verified).length - publish.length - parkedAlready
      let notLive = 0
      if (publish.length) {
        // The same conditions IN the publish's WHERE (R4): a report filed, a hold applied, a Restricted tier or an Unverify
        // (it drops the mark) since the read above keeps the row unpublished rather than racing it live. Profile.
        // enforcementState is NOT NULL (default good_standing), so NOT IN needs no NULL branch. The publish write itself
        // drops the mark, as every publish does: the row is public, no longer the licence check's hold.
        const owner = { OR: [{ ownerId: null }, { owner: { enforcementState: { notIn: OWNER_PULLED } } }], trustTier: { not: 'restricted' } }
        const r = await publishListings(publish, desk, { reports: { none: { status: { in: OPEN_CASE } } }, seller: owner, verificationNotes: LICENCE_HELD_NOTE })
        ;({ affected, held, alreadyHeld } = r)
        // Re-held by an edit after the stamp (licenceCheck) → stale; excluded by the publish's own WHERE → still held.
        stale += r.licenceCheck
        stillHeld += Math.max(0, publish.length - r.affected - r.held - r.alreadyHeld - r.licenceCheck)
        // A held row its seller had hidden (or marked sold) is cleared now, but on sale only once relisted: counted apart
        // (commit gate), so the console's "published" is what buyers can see. Read after the write — what it did.
        if (r.affected) notLive = await db.listing.count({ where: { id: { in: publish }, verified: true, status: { notIn: ['active', LISTING_REMOVED] } } })
      }
      alreadyHeld += parkedAlready
      approval = {
        approved: approvedNow.length + already.length,
        ...(held ? { held } : {}),
        ...(alreadyHeld ? { alreadyHeld } : {}),
        ...(stillHeld ? { stillHeld } : {}),
        ...(notLive ? { notLive } : {}),
        ...(stale ? { stale } : {}),
        ...(invalid ? { invalid } : {}),
      }
      break
    }
    case 'licence-revoke': {
      // ⛔ QUY CHẾ ARTICLE 5 — AN EXPIRED, REVOKED OR CHANGED LICENCE (owner, 2026-10-14). The provider (or anyone) tells
      // eno the licence no longer holds: the stamp is cleared and the row unpublished until its values are checked again.
      // identityHold goes with it, as on every takedown, so no release can republish it. eno's own desk is never touched
      // (it has no stamp to revoke); a tombstone neither. One audit row per row revoked, naming this admin; `wasPublic`
      // says whether buyers could see it a moment before. Per row, so the audit names exactly what was written — and the
      // write bumps @updatedAt, which is what makes a 'licence-approve' racing this one miss (R4).
      const desk = await deskSellerIds()
      // An unresolved desk refuses (commit gate): with no desk ids, eno's own e-Visa rows would read as anyone's and be
      // revoked — the sweep refuses in the same state.
      if (!desk.length) return NextResponse.json({ error: 'desk_unresolved' }, { status: 500 })
      // …and never a whitelisted row (licence-stamp.ts LICENCE_WHITELIST): exempt like the desk, no stamp to revoke.
      const notExempt = { sellerId: { notIn: desk }, NOT: licenceWhitelistWhere() }
      affected = await db.$transaction(async (tx) => {
        const rows = await tx.listing.findMany({
          where: { id: { in: [...new Set(ids)] }, ...NOT_REMOVED, category: { slug: VISA_CATEGORY_SLUG }, subcategorySlug: { in: [...LICENCE_CHECK_SUBCATEGORIES] }, ...notExempt },
          select: { id: true, subcategorySlug: true },
        })
        let revoked = 0
        for (const r of rows) {
          // The licence hold's mark (licence-stamp.ts licenceHeldMark) and the audit's `wasPublic` are decided by the WRITE,
          // not by the read above (commit gate): an Unverify landing in between must not come back as a mark an approval
          // would publish by, nor as "it was public" in the record. Three conditional writes, first match wins: the row
          // PUBLIC now; else live in another status, parked or marked — both go down for their licence, so approving
          // corrected values puts them back; else any other — already down for another reason, it stays down after that.
          const target = { id: r.id, ...NOT_REMOVED, subcategorySlug: r.subcategorySlug, ...notExempt }
          const marked = { ...LICENCE_STAMP_CLEARED, verificationNotes: LICENCE_HELD_NOTE, verified: false, identityHold: false }
          const wasPublic = (await tx.listing.updateMany({ where: { ...target, verified: true, status: 'active' }, data: marked })).count === 1
          let count = wasPublic ? 1 : (await tx.listing.updateMany({ where: { ...target, OR: [{ verified: true }, { identityHold: true }, { verificationNotes: LICENCE_HELD_NOTE }] }, data: marked })).count
          if (count !== 1) count = (await tx.listing.updateMany({ where: target, data: { ...LICENCE_STAMP_CLEARED, verified: false, identityHold: false } })).count
          if (count !== 1) continue
          await appendAudit(tx, {
            actorType: 'admin',
            actorId: admin,
            action: 'listing.licence_revoked',
            subjectType: 'listing',
            subjectId: r.id,
            detail: { subcategory: r.subcategorySlug, wasPublic },
            legalBasis: 'ecommerceLaw',
          })
          revoked++
        }
        return revoked
      }, { timeout: 60_000 })
      break
    }
    // ⛔ A TAKEDOWN CLEARS identityHold TOO — otherwise a listing parked by the identity gate and then
    // pulled here would be republished by releaseIdentityHolds() the day its seller verifies.
    // …and the licence hold's mark (licence-stamp.ts LICENCE_HELD_NOTE): this takedown leaves no report, so an approval of
    // the listing's licence must have another way to know it may not publish it.
    case 'unverify': affected = (await db.listing.updateMany({ where: { id: { in: ids }, ...NOT_REMOVED }, data: { verified: false, identityHold: false, verificationNotes: null } })).count; break
    default: return NextResponse.json({ error: 'bad_action' }, { status: 400 })
  }

  revalidatePublicPath('/')
  // ⛔ …AND /c/teachers (2026-10-20): its 6h-ISR HTML names every live teacher profile — the grid's cards and the "More
  // teachers" list under them (c/[category]/teacher-links.tsx) — so a profile this console hid, removed or unverified
  // stayed named and linked there for up to six hours. Every action, as '/' is: the batch arrives as ids, and reading
  // their categories for this alone is not worth one regeneration.
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  // ⛔ EACH LISTING'S OWN PAGE TOO. This purged only "/", so a bulk hide/delete/unverify of scam or
  // illegal stock kept every PDP serving for up to the 30-day ISR window — and a bulk verify/activate
  // kept serving the cached 404/sold page. The helper also re-syncs AI search (upsert if still
  // public, else drop), which is what the after(reindex) here used to do on its own.
  refreshListingSurfaces(ids, 'admin.listings')
  if (approval) return NextResponse.json({ ok: true, affected, ...approval })
  // `held` / `alreadyHeld` / `licenceCheck` / `resolved` only when non-zero, so with the gate off (and no report
  // closed, and no licence-aisle row in the batch) the body is byte-for-byte what it always was.
  return NextResponse.json({ ok: true, affected, ...(held ? { held } : {}), ...(alreadyHeld ? { alreadyHeld } : {}), ...(licenceCheck ? { licenceCheck } : {}), ...(resolvedReports ? { resolved: resolvedReports } : {}) })
})
