import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { decodeHandoff, encodeHandoff } from '@/components/teachers/teacher-form-rules'

// ── A teacher's step-1 answers, carried from an app's built-in browser to the phone's own ───────────
//
// Google refuses to sign in inside Facebook's, Zalo's and the other apps' browsers. The pairing hand-off
// (handoff.ts) got 2 of 62 visitors signed in (measured 2026-10-25: 41 finished Google in their real
// browser, 2 typed the code back) — so inside those browsers "Continue with Google" now opens the page in
// the phone's own browser and the visitor signs in THERE (sign-in-form.tsx continueGoogleInBrowser). An
// Android intent cannot carry a URL fragment, so the teacher form's `#d=` answers cannot ride along: they
// wait here under a token that the address carries instead (good for 30 minutes).
//
// ⛔ WHAT IT HOLDS: the teacher join form's `#d=` value (teacher-form-rules.ts encodeHandoff — step 1 only:
// where they live, the kinds of work, whether they would move; never a name, a consent, a phone or an
// upload), and nothing else — no destination (it is always /teachers/join), no account, no IP.
// ⛔ READ, THEN DROPPED ON THE PAGE'S WORD — NOT A DESTRUCTIVE READ (commit gate, three rounds): a read that deletes lost the
// answers to every dropped response, reload or navigation that came after it. readCarry is repeatable; the page that has
// put the answers in its form says so (dropCarry), and the 30-minute TTL + kv_store's 15-minute sweep end anything it
// never confirms — /privacy says "deleted once picked up, or otherwise within an hour".
// ⛔ KEYED BY A HASH of the token, so a database read never yields a working link. Written NX: never overwritten — and the
// drop of a live carry leaves a tombstone (`false`) for the token's life, so nothing is written under it again. Accepted:
// a POST that lands only AFTER a drop found no row lives out its 30 minutes unread (the TTL and sweep end it).
// ⛔ STEP 1, BY CONSTRUCTION: what is stored is re-encoded here from what decodeHandoff keeps (canonicalCarry) — an
// anonymous caller cannot park a name, a phone or any other text under a token (commit gate, codex).

export const CARRY_TTL_S = 30 * 60
/** The token: 32 random bytes, base64url (handoff-client.ts handoffNonce) — the hand-off nonce's shape. */
export const CARRY_TOKEN_RE = /^[A-Za-z0-9_-]{40,90}$/
/** The value: a `#d=` string — base64url, bounded. The page that takes it decodes it (decodeHandoff: step 1 only). */
export const CARRY_VALUE_RE = /^[A-Za-z0-9_-]{1,4096}$/
const isCarryValue = (v: unknown): v is string => typeof v === 'string' && CARRY_VALUE_RE.test(v)

/** The value as the form would encode it from its step-1 answers alone — null when it does not decode as a hand-off. */
export function canonicalCarry(value: string): string | null {
  const t = CARRY_VALUE_RE.test(value) ? decodeHandoff(value) : null
  if (!t) return null
  const canonical = encodeHandoff(t)
  return CARRY_VALUE_RE.test(canonical) ? canonical : null
}

const keyOf = (token: string) => `carry:${createHash('sha256').update(`carry:${token}`).digest('hex')}`

/** Stored once per token (NX): false when the token was already used for a carry. */
export async function putCarry(token: string, value: string): Promise<boolean> {
  return (await kv.set(keyOf(token), value, { nx: true, ex: CARRY_TTL_S })) === 'OK'
}

/** The carry for this token — null when absent or expired. Repeatable until dropped or expired. */
export async function readCarry(token: string): Promise<string | null> {
  const v = await kv.get<unknown>(keyOf(token))
  return isCarryValue(v) ? v : null
}

/**
 * Picked up and in the form: the answers go now, replaced by a tombstone for the rest of the token's life (the TTL ends
 * it, and any the page never confirms). ⛔ Only a carry that EXISTS is replaced — never a row written for a token nobody
 * stored, so this anonymous call cannot be used to fill the table (commit gate, opus).
 */
export async function dropCarry(token: string): Promise<void> {
  await db.$executeRaw`
    UPDATE kv_store SET value = 'false'::jsonb WHERE key = ${keyOf(token)} AND (expires_at IS NULL OR expires_at > now())`
}
