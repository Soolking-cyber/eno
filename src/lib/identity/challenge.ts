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
export async function issueChallenge(profileId: string, now: Date = new Date()): Promise<IssueResult> {
  const cooling = await kv.get<number>(cooldownKey(profileId))
  if (cooling) {
    const remaining = Math.max(1, Math.ceil((cooling - now.getTime()) / 1000))
    return { ok: false, reason: 'cooldown', retryAfterSeconds: remaining }
  }

  const code = generateCode()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000)
  const record: StoredChallenge = { h: hashCode(profileId, code), exp: expiresAt.getTime(), issuedAt: now.getTime() }

  // No `nx`: re-issuing must overwrite, per the note above.
  await kv.set(key(profileId), record, { ex: CHALLENGE_TTL_SECONDS })
  await kv.set(cooldownKey(profileId), now.getTime() + ISSUE_COOLDOWN_SECONDS * 1000, { ex: ISSUE_COOLDOWN_SECONDS })
  return { ok: true, code, expiresAt }
}

export type ConsumeResult =
  /** ⛔ THE NORMALISED PLAINTEXT COMES BACK, and the caller MUST persist it. See below. */
  | { ok: true; code: string }
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
  return { ok: true, code: normalised }
}

/** What the seller is told to do. Bilingual, because the copy lives server-side. */
export function challengeInstruction(code: string): { vi: string; en: string } {
  return {
    vi: `Viết mã ${code} lên một tờ giấy và cầm cùng hộ chiếu trong ảnh chụp.`,
    en: `Write the code ${code} on a piece of paper and hold it together with your passport in the photo.`,
  }
}
