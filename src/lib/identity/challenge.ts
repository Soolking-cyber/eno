import 'server-only'
import { createHash, randomInt } from 'node:crypto'
import { kv } from '@/lib/ratelimit'

// ── THE ON-THE-SPOT PROOF, AND THE ONLY PART OF IT THAT IS REAL ─────────────────────────────────
//
// The seller is asked to photograph their passport and then photograph themselves holding it. The
// obvious way to require "on the spot" is the HTML `capture` attribute — and it does nothing.
// src/components/marketplace/visa-cards.tsx:1640 already says so in as many words: "This is only a
// picker hint and never a check." A desktop browser, devtools, or a client that ignores it defeats
// it in seconds, and the server cannot tell.
//
// What CANNOT be forged is a number the server invented after the seller asked for it. The seller
// writes the code on paper and holds it in the selfie, so the photograph cannot predate the
// request. That is the whole mechanism.
//
// ⛔ WHAT THIS DEFEATS: a stock photo, a stolen selfie, a picture taken weeks ago, the same image
//    resubmitted on a second account, and an image bought from someone else — all of them predate
//    a code that did not exist until now.
// ⛔ WHAT IT DOES NOT DEFEAT: a real person, present, holding someone ELSE'S passport and a freshly
//    written code. That is a presentation attack, and no arrangement of photographs closes it — it
//    needs the document's chip or a state database. Do not describe this as liveness.
//
// ⚠️ IT IS EVIDENCE FOR A HUMAN, NOT AN AUTOMATED PASS. Nothing here reads the code out of the
// image; the reviewer does, against `expectedCode`. An OCR check would be a nice-to-have and a
// terrible gate — the failure mode is rejecting real sellers whose handwriting the OCR dislikes.

/**
 * ⚠️ THE ALPHABET IS CHOSEN FOR HANDWRITING, NOT FOR ENTROPY. The code is written by hand, on
 * paper, by someone who may not use the Latin alphabet daily, and then read back off a photograph
 * by a reviewer. Every pair that collides under those conditions is removed:
 *   0/O/Q · 1/I/J/L/7 · 2/Z · 5/S · 6/G · 8/B · U/V
 * A rejected verification because a 5 was read as an S is a real seller lost and a support ticket,
 * which costs more than the ~5 bits this trims.
 */
const ALPHABET = '34679ACDEFHKMNPRTWXY'
const CODE_LENGTH = 6

/** 10 minutes: long enough to find a pen, short enough that a leaked code is worthless. */
export const CHALLENGE_TTL_SECONDS = 10 * 60

/**
 * ⚠️ A COOLDOWN ON ISSUANCE, NOT ONLY ON SUBMISSION. Without it an attacker requests codes until
 * one matches a photo they already hold — 20^6 is large, but a farm of cheap requests against a
 * 6-character space is exactly the shape of attack that a submission-only limit misses, because no
 * submission ever happens until the match is found.
 */
export const ISSUE_COOLDOWN_SECONDS = 60

const key = (profileId: string) => `idv:challenge:${profileId}`
const cooldownKey = (profileId: string) => `idv:challenge:cool:${profileId}`

type StoredChallenge = {
  /** ⛔ The HASH, never the code — see issueChallenge. */
  h: string
  /** Epoch ms, so an expired record is legible in the store even before the TTL sweeps it. */
  exp: number
  issuedAt: number
  /**
   * ⛔ THE DECLARATION THE PERSON AFFIRMED TO GET THIS CHALLENGE — AND IT IS HERE BECAUSE OF THE
   * ORDER, NOT FOR CONVENIENCE. The four `declaration*` columns live on `IdentityVerification`, a
   * row that does not exist until SUBMIT — but `KycCapture` uploads each image the moment it is
   * taken, well before that. Both plan reviewers refused the obvious design for exactly this: a
   * person who photographs their passport and closes the tab would leave identity documents in our
   * private bucket with no recorded consent for collecting them. Consent must precede the
   * COLLECTION, not the submission.
   * The challenge already IS the session for one capture attempt, it is issued at the moment of
   * acceptance, and `/documents` refuses without a live one — so carrying the affirmation here
   * makes "documents may be uploaded" and "consent was given" the same fact. `submitKycForReview`
   * copies it onto the verification row when that row is finally created.
   */
  decl: { v: string; h: string; at: number; ip: string | null }
}

/** Non-reversible, and salted by profile so two sellers holding the same code hash differently. */
function hashCode(profileId: string, code: string): string {
  return createHash('sha256').update(`idv:v1:${profileId}:${code.toUpperCase()}`).digest('hex')
}

/** Uniform over ALPHABET — `randomInt` rejects modulo bias, which `% length` would not. */
function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export type IssueResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: 'cooldown'; retryAfterSeconds: number }

/**
 * Mint a challenge for one seller. The plaintext is returned ONCE, to be shown to that seller and
 * never stored.
 *
 * ⛔ ONLY THE HASH IS PERSISTED. A challenge sitting in the store in plaintext is a credential: it
 * is the one secret that ties a photograph to a moment, and anyone who reads the store could mint a
 * matching image. Hashing costs nothing here because verification is an equality check on a value
 * the reviewer types, not a search.
 *
 * ⚠️ Re-issuing REPLACES the outstanding code rather than adding one. Two live codes would mean a
 * photo matching EITHER is accepted, which doubles the attacker's odds for free.
 */
export async function issueChallenge(
  profileId: string,
  /**
   * ⛔ REQUIRED, NOT OPTIONAL. Making the declaration an optional argument would let a caller issue
   * a challenge — and therefore unlock document upload — without one, which is precisely the hole
   * this parameter exists to close. There is no default.
   */
  declaration: { version: string; hash: string; declaredAt: Date; ip: string | null },
  now: Date = new Date(),
): Promise<IssueResult> {
  // ⚠️ DEV-ONLY COOLDOWN BYPASS. The 60s issuance cooldown is an anti-abuse control; in `next dev` it
  // just walls off repeated walk-throughs of the verify wizard. Gated STRICTLY on
  // NODE_ENV === 'development' — the ONLY env where that is true is a developer's local `next dev`.
  // A deployed build (`next start`, both editions) runs as 'production' and vitest runs as 'test', so
  // BOTH keep the cooldown (the 'test' case is why this is `!== 'development'`, not `=== 'production'`
  // — the cooldown test must still see it fire). The hourly route limiter (20/h) is unaffected.
  if (process.env.NODE_ENV !== 'development') {
    const cooling = await kv.get<number>(cooldownKey(profileId))
    if (cooling) {
      const remaining = Math.max(1, Math.ceil((cooling - now.getTime()) / 1000))
      return { ok: false, reason: 'cooldown', retryAfterSeconds: remaining }
    }
  }

  const code = generateCode()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000)
  const record: StoredChallenge = {
    h: hashCode(profileId, code),
    exp: expiresAt.getTime(),
    issuedAt: now.getTime(),
    decl: {
      v: declaration.version,
      h: declaration.hash,
      at: declaration.declaredAt.getTime(),
      ip: declaration.ip,
    },
  }

  // No `nx`: re-issuing must overwrite, per the note above.
  await kv.set(key(profileId), record, { ex: CHALLENGE_TTL_SECONDS })
  await kv.set(cooldownKey(profileId), now.getTime() + ISSUE_COOLDOWN_SECONDS * 1000, { ex: ISSUE_COOLDOWN_SECONDS })
  return { ok: true, code, expiresAt }
}

export type ConsumeResult =
  /**
   * ⛔ THE NORMALISED PLAINTEXT COMES BACK, and the caller MUST persist it. See below.
   * ⚠️ AND SO DOES THE DECLARATION, so `submitKycForReview` can stamp the verification row with the
   * affirmation that authorised the upload rather than re-deriving one at submit time. Re-deriving
   * would record the version current NOW, which may not be the one the person actually read.
   */
  | { ok: true; code: string; declaration: { version: string; hash: string; declaredAt: Date; ip: string | null } | null }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'mismatch' }

/**
 * Check a code and BURN it, whatever the answer.
 *
 * ⛔ THE CHALLENGE IS DESTROYED ON A WRONG ANSWER TOO, AND THAT IS THE POINT. Leaving it alive
 * would turn a 20^6 space into unlimited guesses against a code the attacker can retry for free.
 * Burning it costs an honest seller one extra request — they ask for a new code — and costs an
 * attacker the whole attack.
 *
 * ⚠️ GET-THEN-DEL IS NOT ATOMIC, AND THE RATE LIMIT — NOT THIS FUNCTION — IS WHAT BOUNDS IT. Two
 * external reviewers flagged the race: concurrent submissions can both read the record before
 * either deletes it, so one code can be guessed against more than once. The KV exposes no
 * take-and-return primitive, and adding one means DDL on a shared database for a race whose real
 * exposure is already small: /api/seller/identity/submit is `limit: 5, window: '1 d', strict: true`,
 * so an attacker gets five attempts a day against a 20^6 space regardless of how they are
 * interleaved. Measured, not assumed — the bound is in the route, so DO NOT LOOSEN THAT LIMIT
 * without giving this function an atomic consume first.
 *
 * ⚠️ EXPIRY IS CHECKED AGAINST THE STORED INSTANT, not left to the TTL. The store is an UNLOGGED
 * table swept on its own schedule, so "the key is still there" does not mean "it is still valid".
 */
export async function consumeChallenge(
  profileId: string,
  submitted: string,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const rec = await kv.get<StoredChallenge>(key(profileId))
  if (!rec) return { ok: false, reason: 'no_challenge' }
  await kv.del(key(profileId))

  if (rec.exp <= now.getTime()) return { ok: false, reason: 'expired' }

  const normalised = String(submitted || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (normalised.length !== CODE_LENGTH) return { ok: false, reason: 'mismatch' }
  // Both sides are fixed-length hex digests of the same length, so a plain comparison leaks no
  // useful timing signal — and the reviewer types this by hand, so a timing oracle is not the
  // threat here anyway.
  if (hashCode(profileId, normalised) !== rec.h) return { ok: false, reason: 'mismatch' }
  // ⛔ RETURNED SO THE REVIEWER CAN ACTUALLY COMPARE IT TO THE PHOTO, and this was the hole that
  // made the whole mechanism decorative. The original design hashed the code, burned it, and told
  // the reviewer to look for "a handwritten code" — ANY handwritten code. So an attacker could hold
  // up a selfie taken last year with any string on the paper, request a fresh code, and submit it
  // in the JSON: the server saw a valid code, the reviewer saw handwriting, and nothing ever
  // compared the two. Caught by external review.
  //
  // ⚠️ Persisting it is safe BECAUSE IT IS ALREADY SPENT. Secrecy mattered only up to submission —
  // the record was destroyed one line above, so this value can never authorise anything again. It
  // is now evidence, not a credential.
  return {
    ok: true,
    code: normalised,
    // ⚠️ READ OFF THE BURNED RECORD, so the affirmation returned is the one that authorised THIS
    // capture attempt. A record written before this field existed has no `decl`; that is treated as
    // absent rather than fabricated — `submitKycForReview` simply stores nothing, which is what the
    // schema's own comment calls for ("absent is NOT the same as refused").
    // ⚠️ NULL, NOT A ZEROED PLACEHOLDER. A record written before this field existed has no `decl`,
    // and inventing `{version:'', declaredAt: epoch}` would put a fabricated affirmation into a
    // legal record. The schema says it plainly: "absent is NOT the same as refused."
    declaration: rec.decl
      ? { version: rec.decl.v, hash: rec.decl.h, declaredAt: new Date(rec.decl.at), ip: rec.decl.ip }
      : null,
  }
}

/** What the seller is told to do. Bilingual, because the copy lives server-side. */
export function challengeInstruction(code: string): { vi: string; en: string } {
  return {
    vi: `Viết mã ${code} lên một tờ giấy và cầm cùng hộ chiếu trong ảnh chụp.`,
    en: `Write the code ${code} on a piece of paper and hold it together with your passport in the photo.`,
  }
}

/**
 * Is there a live challenge for this profile — i.e. has this person affirmed the declaration and
 * not yet finished (or abandoned past the TTL) the capture it authorised?
 *
 * ⛔ THIS IS THE GATE ON `/api/seller/identity/documents`, AND IT IS WHY CONSENT NOW PRECEDES
 * COLLECTION. Before it, that route accepted identity documents from anyone with a session and
 * stored them in the private bucket; a person who photographed their passport and closed the tab
 * left documents behind with no record of permission to hold them. Both plan reviewers found the
 * same defect independently.
 *
 * ⚠️ IT DOES NOT CONSUME. Peeking must not burn the challenge — the code is still needed for the
 * submit, and each capture calls `/documents` separately (document, then selfie). Burning here
 * would make the second upload fail and the submit impossible.
 */
export async function hasLiveChallenge(profileId: string, now: Date = new Date()): Promise<boolean> {
  const rec = await kv.get<StoredChallenge>(key(profileId))
  if (!rec) return false
  // ⚠️ THE TTL IS CHECKED HERE TOO, not left to the store. `kv.get` sweeps on read in production but
  // the record carries its own `exp` precisely so expiry does not depend on the store's timing.
  if (rec.exp <= now.getTime()) return false
  /**
   * ⛔ AND IT MUST CARRY A DECLARATION — BOTH DIFF REVIEWERS FOUND THIS HOLE INDEPENDENTLY. Checking
   * only `exp` left a ten-minute window across a DEPLOY: a challenge issued by the previous build
   * has no `decl`, stays live, and would have authorised document upload with no recorded consent —
   * the exact thing this gate exists to prevent, reintroduced by the upgrade itself.
   * ⚠️ NOTE THE ASYMMETRY WITH `consumeChallenge`, AND IT IS DELIBERATE. There, a missing `decl` is
   * reported as `null` and stored as null, because fabricating an affirmation nobody made would put
   * a false record into a compliance log. HERE the same absence must REFUSE: not knowing whether
   * someone consented is a reason not to collect, and not a reason to invent that they did.
   */
  return Boolean(rec.decl)
}
