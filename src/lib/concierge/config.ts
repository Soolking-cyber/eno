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
 * name the voice guide's recipients — Soniox, OpenAI, Google — before every account may use it. TRUE since the /privacy
 * change of 2026-10-29 (owner, 2026-10-28: "processor not important add to privacy" — the OpenAI and Soniox rows, Google's
 * backup line and the "Voice guide" paragraph; config.test.ts checks the page names them whenever this is true). `all` still
 * waits for the switch itself (scripts/concierge-mode.mjs all — the owner's).
 */
export const VOICE_GUIDE_IN_PRIVACY = true
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
 * WHO MAY TALK HOW LONG (owner, 2026-10-28: "unlimited for admin and 10 minutes per user per day"):
 *   · the eno team (isStaffProfile — ADMIN_EMAILS): no day counter at all; a session still ends at SESSION_MINUTES and a
 *     new tap starts another;
 *   · everyone else: DAILY_SECONDS of live session a Vietnam day, ONE SESSION AT A TIME (an atomic hold per account,
 *     `concierge:live:<id>` — commit review: a second tab, or a start racing midnight, can never run beside the first).
 *     THE NEWEST WINDOW WINS (commit review, opus: a reload or a swiped-away tab often loses its end beacon): a start that
 *     finds the account's hold ends the session behind it — its unused time handed back as any end does — and takes over.
 *     A start takes the account's remaining time; its end hands back what it did not use, less MIN_CHARGE_SECONDS — the
 *     least a session costs. That minimum is the brake on a start-✕ loop: at most DAILY_SECONDS / MIN_CHARGE_SECONDS starts
 *     a day, so the listening keys one account can mint (stt-token: each lasts to its session's deadline) add up to under
 *     an hour a day. A session that is never ended (the tab killed without its beacon) keeps its whole reservation —
 *     never more time. A session ends at ICT midnight at the latest, so a day's time is spent on that day — except one
 *     started in the day's last MIN_SESSION_SECONDS, which counts wholly on the next day (accepted, codex: at most that
 *     many seconds of the next day's time spent before midnight).
 *   · SITE_SESSIONS_PER_DAY starts across the site — the spend's ceiling (Soniox listens and speaks, OpenAI answers; the
 *     face costs nothing, it is drawn in the browser); past it the window hands the person to the text assistant (the
 *     frame's "busy"). The eno team never takes one.
 * ⚠️ ACCEPTED (plan review): the counters live in kv_store, which is UNLOGGED — a Postgres crash empties them and every
 * account starts the day again. This is a spend limit, not a security boundary; a durable ledger would need a table.
 */
export const DAILY_SECONDS = 600
/** Less than this left is "today's time is used" — a session that ends as it begins helps no one. */
export const MIN_SESSION_SECONDS = 30
/** The least a session costs, however soon it is closed. */
export const MIN_CHARGE_SECONDS = 60
export const SITE_SESSIONS_PER_DAY = 600

/**
 * `reserved` / `budgetKey` / `startedAt`: the seconds this session holds of `budgetKey` (an account's day), handed back
 * once at its end. Absent for the eno team, whose sessions hold nothing.
 */
export type ConciergeSession = { id: string; profileId: string; deadline: number; startedAt?: number; budgetKey?: string; reserved?: number }

const sessionKey = (id: string) => `concierge:session:${id}`
/** An account's one live session (not the eno team's — theirs hold nothing). */
const liveKey = (profileId: string) => `concierge:live:${profileId}`
/** Vietnam's day (ICT = UTC+7), as the classroom counts its days. */
const ICT_OFFSET_MS = 7 * 3600_000
const DAY_MS = 24 * 3600_000
const ictDay = (now: number) => new Date(now + ICT_OFFSET_MS).toISOString().slice(0, 10)
const DAY_TTL = 2 * 24 * 3600

type Hold = { id: string; at: number }
/** A hold younger than this with no session row yet is a start still on its way — waited for, never taken over. */
const HOLD_SETTLE_MS = 10_000
/** How long a start waits for another start of the same account to land (two tabs at once), polling. */
const HOLD_WAIT_MS = 3_000
const HOLD_POLL_MS = 250

/**
 * Take the account's one-session hold: free → taken; held by a session → that session is ended (endSession: refunded,
 * its hold handed back) and the hold taken; held by a start still on its way → waited for, then that session is taken
 * over in turn (commit review, opus: two tabs at once must not read "today's time is used"); held with no session behind
 * it for HOLD_SETTLE_MS — a start that failed half-way — taken. Every pass waits HOLD_POLL_MS and the whole try is bounded
 * by HOLD_WAIT_MS (commit review, codex + opus: an end that cannot delete its row must not spin the start forever).
 * Returns how long it waited (the session's clock starts after it), or null = refused.
 * ⚠️ ONE AT A TIME IS BEST EFFORT, THE TIME IS NOT (commit review, codex + opus, accepted): the hold's writes are not
 * compare-and-set, so a start that stalls past HOLD_SETTLE_MS, or an end racing a takeover, can let two sessions run side
 * by side for a while — each still holds only what the day's counter gave it, so the account never gets more time.
 */
async function takeHold(profileId: string, id: string, now: number): Promise<number | null> {
  const key = liveKey(profileId)
  for (let waited = 0; waited <= HOLD_WAIT_MS; waited += HOLD_POLL_MS) {
    const at = now + waited
    if ((await kv.set(key, { id, at } satisfies Hold, { nx: true, ex: SESSION_MINUTES * 60 + 60 })) === 'OK') return waited
    const held = await kv.get<Hold>(key)
    const behind = held && typeof held.id === 'string' ? await kv.get<ConciergeSession>(sessionKey(held.id)) : null
    if (behind && behind.profileId === profileId) await endSession(behind, at)
    else if (held && (typeof held.id !== 'string' || typeof held.at !== 'number' || at - held.at >= HOLD_SETTLE_MS)) {
      if ((await kv.get<Hold>(key))?.id === held.id) await kv.del(key)
    }
    await new Promise((r) => setTimeout(r, HOLD_POLL_MS))
  }
  return null
}

/** Start a session: the day's caps, then the session row. Null = a cap is reached (`out.cap` says which). Throws on a kv
 *  failure (the caller refuses — fail closed). */
export async function startSession(profileId: string, now = Date.now(), out: { cap?: 'account' | 'site' } = {}): Promise<ConciergeSession | null> {
  const id = randomBytes(16).toString('base64url')
  // ⛔ An unreadable staff check is NOT staff: the account gets the everyone-else limits (fail closed).
  if (await isStaffProfile(profileId).catch(() => false)) {
    const s: ConciergeSession = { id, profileId, deadline: now + SESSION_MINUTES * 60_000, startedAt: now }
    await kv.set(sessionKey(id), s, { ex: SESSION_MINUTES * 60 + 60 })
    return s
  }
  // The day the time comes out of, and how long is left of it: a start in its last seconds counts on the next day.
  const toMidnight = (t: number) => Math.floor((DAY_MS - ((t + ICT_OFFSET_MS) % DAY_MS)) / 1000)
  const late = toMidnight(now) < MIN_SESSION_SECONDS
  const day = ictDay(late ? now + MIN_SESSION_SECONDS * 1000 : now)
  const dayLeft = late ? DAY_MS / 1000 : toMidnight(now)
  const siteKey = `concierge:starts:${day}`
  const budgetKey = `concierge:seconds:${day}:${profileId}`
  const holdKey = liveKey(profileId)
  // What this start has taken so far — each give-back undoes exactly that, never anyone else's.
  const taken: Array<[string, number]> = []
  let holding = false
  const take = async (key: string, by: number) => {
    const n = await kv.incrby(key, by, DAY_TTL)
    taken.push([key, by])
    return n
  }
  const giveBack = async () => {
    await Promise.all(taken.splice(0).map(([k, by]) => kv.incrby(k, -by, DAY_TTL).catch(() => 0)))
    // Only while it is still this start's (commit review, codex: a start that stalled past HOLD_SETTLE_MS may have been
    // taken over — its give-back must not drop the newer session's hold).
    if (holding) {
      try {
        if ((await kv.get<Hold>(holdKey))?.id === id) await kv.del(holdKey)
      } catch {
        // it ends with its TTL
      }
    }
    holding = false
  }
  try {
    // The site's day FIRST (commit review, codex): a start the site refuses must never have ended the account's live
    // session on its way. Every refusal below hands the slot back.
    if ((await take(siteKey, 1)) > SITE_SESSIONS_PER_DAY) {
      // Everything goes back (review round 4, codex: a refused start racing a failed one left the site shut for the day).
      await giveBack()
      out.cap = 'site'
      return null
    }
    // ONE SESSION AT A TIME: the hold is taken before the time is counted.
    const waited = await takeHold(profileId, id, now)
    if (waited === null) {
      await giveBack()
      out.cap = 'account'
      return null
    }
    holding = true
    now += waited
    // THE TIME: hold everything left of the day.
    const held = await take(budgetKey, DAILY_SECONDS)
    let used = held - DAILY_SECONDS
    if (used < 0) {
      // ⛔ A NEGATIVE DAY IS MENDED, NEVER SPENT (plan review, codex + opus): a refund that landed on a key the crash had
      // emptied leaves it below zero, and "the time left" would read more than DAILY_SECONDS. Brought back to zero used.
      await kv.incrby(budgetKey, -used, DAY_TTL)
      used = 0
    }
    const reserved = Math.min(DAILY_SECONDS - used, SESSION_MINUTES * 60, dayLeft - Math.ceil(waited / 1000))
    if (reserved < MIN_SESSION_SECONDS) {
      await giveBack()
      out.cap = 'account'
      return null
    }
    if (reserved < DAILY_SECONDS) {
      await kv.incrby(budgetKey, -(DAILY_SECONDS - reserved), DAY_TTL)
      taken.push([budgetKey, -(DAILY_SECONDS - reserved)])
    }
    // The hold lasts exactly as long as the session.
    await kv.set(holdKey, { id, at: now } satisfies Hold, { ex: reserved })
    const s: ConciergeSession = { id, profileId, deadline: now + reserved * 1000, startedAt: now, budgetKey, reserved }
    await kv.set(sessionKey(id), s, { ex: SESSION_MINUTES * 60 + 60 })
    return s
  } catch (e) {
    // ⛔ A start that fails gives back what it took (commit review, codex: eight kv errors used up the account's day
    // without one session).
    await giveBack()
    throw e
  }
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

/**
 * End a session now (✕, the page going away) and hand back the time it did not use — ONCE: ✕ and the page-away beacon can
 * both arrive, so an atomic mark decides (takeOffer's rule; it outlives the row), and only its first increment refunds.
 * ⛔ THE ROW GOES FIRST (plan review, opus): time is handed back only for a session that can no longer be used — a delete
 * that failed would leave its turns running on time already refunded. (A listening key minted before the end lives to its
 * own expiry — the start-✕ loop's bound, above.) Any failure leaves the account charged its whole reservation (fail
 * closed — never more time).
 */
export async function endSession(s: ConciergeSession, now = Date.now()): Promise<void> {
  try {
    await kv.del(sessionKey(s.id))
  } catch {
    return
  }
  if (!s.budgetKey || typeof s.reserved !== 'number' || s.reserved <= 0) return
  try {
    if ((await kv.incrby(`${sessionKey(s.id)}:ended`, 1, SESSION_MINUTES * 60 + 120)) !== 1) return
    const unused = Math.min(Math.max(Math.floor((s.deadline - now) / 1000), 0), s.reserved - MIN_CHARGE_SECONDS)
    if (unused > 0) await kv.incrby(s.budgetKey, -unused, DAY_TTL)
  } catch (e) {
    logError(e, { op: 'concierge.refund' })
  }
  // The hold goes LAST — after the refund — so the next start reads the day as it is; and only while it is this
  // session's. ⚠️ ACCEPTED (commit review, codex): read-then-delete is not atomic — a hold that expires in between and is
  // retaken by a new start would be dropped, letting one more start run beside it; it needs that TTL to end inside a few
  // milliseconds of an end.
  try {
    if ((await kv.get<Hold>(liveKey(s.profileId)))?.id === s.id) await kv.del(liveKey(s.profileId))
  } catch {
    // it ends with its TTL — the session's own end
  }
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
