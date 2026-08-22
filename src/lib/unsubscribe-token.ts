import 'server-only'
import crypto from 'node:crypto'

/**
 * One-click unsubscribe tokens, derived rather than stored.
 *
 * ⛔ WHY NOT "HASH THE STORED TOKEN", WHICH IS THE OBVIOUS FIX. Profile carries
 * `unsubscribeToken String @unique @default(cuid())` and the route looked it up in
 * plaintext, so hashing the column looks like a drop-in. It is not: the weekly digest
 * SELECTs that column on every send to build `?token=…`, so the plaintext has to be
 * recoverable from the database forever. Store only a hash and every unsubscribe link
 * stops being generatable; store the plaintext and hashing bought nothing. The two
 * requirements cannot both hold while the link is rebuilt from storage.
 *
 * Deriving the token removes the dilemma. Nothing sensitive is stored at all, the
 * link is reproducible at send time from the profile id, and a database read — a
 * backup, a leaked dump, an injection — yields nothing usable, which was the whole
 * point of hashing.
 *
 * ⚠️ NOT A CAPABILITY WORTH GUARDING HEAVILY, AND THE DESIGN REFLECTS THAT. The token
 * only toggles a marketing preference for one profile. It is deliberately long-lived
 * and un-expiring, because an unsubscribe link must work months after the email was
 * sent — a expired one is a compliance problem, not a security win.
 *
 * Same construction as src/lib/api/oauth.ts: HKDF-SHA256 to a purpose-specific key so
 * this token can never be confused with, or forged from, a partner-API access token.
 *
 * ⚠️ ROTATING THE BASE SECRET INVALIDATES EVERY LINK ALREADY IN AN INBOX. That is a
 * real cost and it is accepted deliberately: SUPABASE_SECRET_KEY was rotated once in
 * August 2026, so this is not hypothetical. The alternative — versioning tokens and
 * keeping old keys — buys durability for a capability that only flips a marketing
 * preference, and the legacy stored-token path below still answers those links until
 * it is removed. If the secret is rotated after that removal, expect unsubscribe
 * links from before the rotation to 404, and re-send rather than re-key.
 */

let cachedKey: Buffer | null = null
function signingKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  // ⛔ FAIL CLOSED. No base secret → no token can be minted and none can verify.
  // Returning a constant here would make every signature forgeable by anyone who
  // noticed the secret was unset.
  if (!ikm) return null
  cachedKey = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-unsub-v1'), Buffer.from('email-unsubscribe'), 32),
  )
  return cachedKey
}

const sign = (input: string, key: Buffer) =>
  crypto.createHmac('sha256', key).update(input).digest('base64url')

/** `<profileId>.<sig>`, or null when no secret is configured. */
export function mintUnsubscribeToken(profileId: string): string | null {
  const key = signingKey()
  if (!key || !profileId) return null
  return `${profileId}.${sign(profileId, key)}`
}

/**
 * The profile id this token authorises, or null.
 *
 * ⚠️ CONSTANT-TIME, AND LENGTH-CHECKED FIRST — timingSafeEqual THROWS on a length
 * mismatch, so an attacker choosing the signature length would otherwise turn a
 * rejection into a 500.
 */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const key = signingKey()
  // ⚠️ typeof, not just falsy. `token` arrives from a query string or a JSON body, so
  // a caller can send a number, an array or an object — and `.lastIndexOf` on those
  // either throws or silently does something else. A malformed token must be a
  // rejection, never a 500.
  if (!key || typeof token !== 'string' || !token) return null
  // A cuid contains no dot, so the LAST dot separates id from signature.
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const profileId = token.slice(0, dot)
  const provided = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(profileId, key))
  if (provided.length !== expected.length) return null
  return crypto.timingSafeEqual(provided, expected) ? profileId : null
}
