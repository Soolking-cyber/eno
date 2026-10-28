import 'server-only'
import { randomBytes } from 'node:crypto'
import { kv } from '@/lib/ratelimit'
import { isStaffProfile } from '@/lib/user-blocks'
import { logError } from '@/lib/log'
import { IS_SERVICES } from '@/lib/edition'

/**
 * The voice concierge's RUNTIME SWITCH and its SESSIONS (plan v2 §10). Owner, 2026-10-27: "access only for support@eno.forum
 * admin account" — `staff` = ADMIN_EMAILS, which on production is that account alone.
 *
 *   off    nobody (the default — and what a missing, unreadable or unknown value means)
 *   staff  the eno team only (ADMIN_EMAILS)
 *   all    every signed-in account on eno.vn's website (owner, 2026-10-28: "open up new concierge for everyone") — never
 *          signed-out visitors (every route needs an account), the native apps (host: no microphone in their webview, no
 *          AI question asked there) or eno.forum. ⛔ Written only after /privacy names the guide's recipients (Soniox,
 *          OpenAI, Google): the owner runs scripts/concierge-mode.mjs all.
 *
 * ⚠️ A kv KEY, NOT A TABLE (no DDL for a staff test). kv_store is UNLOGGED — an unclean Postgres shutdown empties it — and
 * that is safe HERE ONLY because every reading of it fails closed: an emptied key reads `off`, an emptied session ends.
 * A crash can switch the concierge off; nothing can switch it on but a write of `staff` or `all` (scripts/concierge-mode.mjs).
 * ⛔ eno.vn only for the MVP: eno.forum's concierge would need its own knowledge (its desk), which is the owner's call.
 */
export type ConciergeMode = 'off' | 'staff' | 'all'

export const MODE_KEY = 'concierge:mode'

/**
 * ⛔ THE LEGAL PREREQUISITE OF `all`, IN CODE (commit review, codex + opus: a comment alone does not hold it): /privacy must
 * name the voice guide's recipients — Soniox, OpenAI, Google — before every account may use it. False until that /privacy
 * change ships (its commit flips this; config.test.ts checks the page names them whenever it is true). Until then `all`
 * admits the staff, like `staff`.
 */
export const VOICE_GUIDE_IN_PRIVACY = false
/** How long one process trusts its read of the switch; a session start reads it fresh. */
const MODE_CACHE_MS = 30_000
let cached: { at: number; mode: ConciergeMode } | null = null

export async function readConciergeMode(opts: { fresh?: boolean } = {}, now = Date.now()): Promise<ConciergeMode> {
  if (!opts.fresh && cached && now - cached.at < MODE_CACHE_MS) return cached.mode
  let mode: ConciergeMode = 'off'
  try {
    const v = await kv.get<string>(MODE_KEY)
    mode = v === 'staff' || v === 'all' ? v : 'off'
  } catch (e) {
    logError(e, { op: 'concierge.mode' })
  }
  cached = { at: now, mode }
  return mode
}

/** Forget the cached switch (tests). */
export function resetConciergeModeCache(): void {
  cached = null
}

/** May this account use the concierge now? Fails closed. */
export async function conciergeOpenFor(profileId: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (IS_SERVICES) return false
  const mode = await readConciergeMode(opts)
  if (mode === 'all' && VOICE_GUIDE_IN_PRIVACY) return true
  if (mode !== 'staff' && mode !== 'all') return false
  return isStaffProfile(profileId).catch(() => false)
}

/**
 * ONE CONCIERGE SESSION — from the Start tap to its hard end, at most SESSION_MINUTES. Every turn, live-listening key and
 * face token checks it, and the face token's own expiry is the session's end, so Spatius (which bills connected minutes,
 * idle included) cannot outlive it. A new session, or the face reconnecting after the idle pause, needs a tap.
 */
export const SESSION_MINUTES = 15
/**
 * Sessions a day (ICT), per account and across the site — the spend's ceiling (Soniox listens and speaks, OpenAI answers;
 * the face costs nothing since it is drawn in the browser). The site's day was 80 for the staff test; `all` needs room,
 * and past it the window hands the person to the text assistant (the frame's "busy").
 */
export const SESSIONS_PER_DAY = 8
export const SITE_SESSIONS_PER_DAY = 600

export type ConciergeSession = { id: string; profileId: string; deadline: number }

const sessionKey = (id: string) => `concierge:session:${id}`
/** Vietnam's day (ICT = UTC+7), as the classroom counts its days. */
const ictDay = (now: number) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)

/** Start a session: the day's caps, then the session row. Null = a cap is reached (`out.cap` says which). Throws on a kv
 *  failure (the caller refuses — fail closed). */
export async function startSession(profileId: string, now = Date.now(), out: { cap?: 'account' | 'site' } = {}): Promise<ConciergeSession | null> {
  const day = ictDay(now)
  const mineKey = `concierge:starts:${day}:${profileId}`
  const siteKey = `concierge:starts:${day}`
  const ttl = 2 * 24 * 3600
  const giveBack = (...keys: string[]) => Promise.all(keys.map((k) => kv.incrby(k, -1, ttl).catch(() => 0)))
  // The account's cap first: a start it refuses never takes a site-wide slot (test review — one capped account tapping
  // Start could otherwise use up the site's day).
  // A refusal gives its increment back too (review round 3, codex: two racing starts at the cap — one refused, one whose
  // row failed — left the count one above the sessions made).
  if ((await kv.incrby(mineKey, 1, ttl)) > SESSIONS_PER_DAY) {
    await giveBack(mineKey)
    out.cap = 'account'
    return null
  }
  // ⛔ From here a start that fails gives back what it took (commit review, codex: eight kv errors used up the account's
  // day without one session).
  const site = await kv.incrby(siteKey, 1, ttl).catch(async (e: unknown) => {
    await giveBack(mineKey)
    throw e
  })
  if (site > SITE_SESSIONS_PER_DAY) {
    // Both increments go back (review round 4, codex: a refused start racing a failed one left the site count above the
    // sessions made, and the site stayed shut for the day).
    await giveBack(mineKey, siteKey)
    out.cap = 'site'
    return null
  }
  const s: ConciergeSession = { id: randomBytes(16).toString('base64url'), profileId, deadline: now + SESSION_MINUTES * 60_000 }
  try {
    await kv.set(sessionKey(s.id), s, { ex: SESSION_MINUTES * 60 + 60 })
  } catch (e) {
    await giveBack(mineKey, siteKey)
    throw e
  }
  return s
}

/** The caller's live session, or null (unknown, someone else's, past its end, or unreadable). */
export async function liveSession(id: unknown, profileId: string, now = Date.now()): Promise<ConciergeSession | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,32}$/.test(id)) return null
  try {
    const s = await kv.get<ConciergeSession>(sessionKey(id))
    if (!s || s.profileId !== profileId || typeof s.deadline !== 'number' || s.deadline <= now) return null
    return s
  } catch (e) {
    logError(e, { op: 'concierge.session' })
    return null
  }
}

/** End a session now (✕, the page going away). */
export async function endSession(id: string): Promise<void> {
  await kv.del(sessionKey(id)).catch(() => undefined)
}

/**
 * An offer the concierge made that a plain "yes" accepts — today only the fixed line's "open the licensed-providers aisle"
 * (guards.ts fixedLineFor): the model never opens that aisle itself. Kept two minutes on the session.
 */
const offerKey = (id: string) => `concierge:offer:${id}`
export async function rememberOffer(sessionId: string, offer: 'evisa'): Promise<void> {
  try {
    // A fresh offer: its own "taken" mark starts again (a second visa question in the same session may be answered).
    await kv.del(`${offerKey(sessionId)}:taken`)
    await kv.set(offerKey(sessionId), offer, { ex: 120 })
  } catch {
    // no offer stored: the next "yes" is an ordinary turn
  }
}
/**
 * The offer, taken ONCE (commit review, codex): a get-then-delete let two concurrent "yes" turns both take it, and a
 * failed delete left it takeable again. The atomic counter decides — only its first increment takes the offer.
 */
export async function takeOffer(sessionId: string): Promise<'evisa' | null> {
  try {
    const o = await kv.get<string>(offerKey(sessionId))
    if (o !== 'evisa') return null
    if ((await kv.incrby(`${offerKey(sessionId)}:taken`, 1, 120)) !== 1) return null
    await kv.del(offerKey(sessionId)).catch(() => undefined)
    return 'evisa'
  } catch {
    return null
  }
}
