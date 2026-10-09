/**
 * ⛔ A WEB PUSH SUBSCRIPTION THAT IS NOT THE SIGNED-IN ACCOUNT'S IS DROPPED (F7 — found by the F5/F6 verification).
 *
 * A browser keeps its subscription across accounts, and only signOut() tore it down. After a switch with no sign-out
 * between (a sign-in from the "session ended" card, one in another tab, or the previous session expiring while the
 * page was closed and the next account signing in after a reload), the endpoint stayed registered to the previous
 * account: its offers (amounts, notes), answers and alerts kept showing on the device, and the service worker set
 * that account's badge. So on every sign-in this asks the server whether the browser's subscription is the caller's
 * (POST /api/push/subscription) and, on a definite "no", unsubscribes it here. The push service then refuses the
 * previous account's next push (410), and push.ts prunes that row. The next account sees the opt-in card again and can
 * subscribe itself — the subscription is never re-homed silently: it did not consent on this device.
 *
 * Fails safe toward KEEPING a subscription: an error, a non-200, an answer made for another account, an account that
 * moved on, a subscription replaced meanwhile, or an unsubscribe the push service refused → nothing is dropped (the
 * next auth event or load asks again; a failure is never remembered). Only a "yes" is remembered, per tab, for this
 * account and endpoint, so a re-check costs nothing.
 * It drops only a subscription the server holds for ANOTHER account (`known && !mine`): one with no row receives nothing,
 * and is often this account's own — an opt-in still being posted (in this tab or another), or one whose post failed
 * and is kept for a retry. So a fresh opt-in at the moment of a sign-in is not undone. One narrow case remains: a tap
 * that RE-POSTS the previous account's subscription for this one (subscribeToPush reuses it) while the guard asks; the
 * drop is announced to every tab, and the Settings row offers the button again — one more tap. Closing even that was
 * tried three ways and each drew a new edge in review (a client-side mark, a 10s second ask, a cross-tab Web Lock).
 * The remaining window: a push that arrives between a sign-in and the answer — one round trip on a live switch; after a
 * reload or a sign-in redirect, also the page's own boot (seconds on a slow phone).
 * Web push only: the native shell registers its own token to the current account on every change (native-push.tsx).
 */
import { isNativeShell } from './native-browser'
import { PUSH_SUBSCRIPTION_CHANGED, announcePushSubscriptionChanged } from './push-subscribe'

const MEMO_KEY = 'eno:push-owner-checked'
/** The longest the guard waits for the server: a stalled ask is a doubt like any other, and keeps the subscription. */
export const PUSH_GUARD_ASK_TIMEOUT_MS = 8000
export { PUSH_SUBSCRIPTION_CHANGED }

export type GuardOutcome = 'none' | 'kept' | 'dropped' | 'unknown'

type Sub = { endpoint: string; unsubscribe: () => Promise<boolean> }

/**
 * The server's word on `endpoint` for `account`: 'mine', 'other' (another account's row — the only case pushes for
 * someone else reach this device), 'none' (no row: nothing is pushed to it), or null when it gave none worth acting on.
 */
async function ownerOf(account: string, endpoint: string): Promise<'mine' | 'other' | 'none' | null> {
  // Bounded: a request that stalls (a dead cell, a deploy's swap) must not hold the lock — and with it a tap's opt-in,
  // in any tab — for good (review). Timed out, it is a doubt like any other: nothing is dropped.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PUSH_GUARD_ASK_TIMEOUT_MS)
  try {
    const res = await fetch('/api/push/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }), signal: abort.signal })
    if (!res.ok) return null
    const answer = (await res.json().catch(() => null)) as { me?: unknown; mine?: unknown; known?: unknown } | null
    // Only an answer made for the account that asked.
    if (!answer || answer.me !== account || typeof answer.mine !== 'boolean' || typeof answer.known !== 'boolean') return null
    return answer.mine ? 'mine' : answer.known ? 'other' : 'none'
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function dropForeignPushSubscription(account: string, stillCurrent: () => boolean): Promise<GuardOutcome> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'none'
    if (isNativeShell()) return 'none'
    return await decide(account, stillCurrent)
  } catch {
    return 'unknown'
  }
}

async function decide(account: string, stillCurrent: () => boolean): Promise<GuardOutcome> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = (await reg?.pushManager?.getSubscription()) as Sub | null | undefined
  if (!reg || !sub) return 'none'
  const memo = `${account}|${sub.endpoint}`
  try { if (sessionStorage.getItem(MEMO_KEY) === memo) return 'kept' } catch { /* no storage: ask */ }
  const owner = await ownerOf(account, sub.endpoint)
  if (owner === 'mine') {
    try { sessionStorage.setItem(MEMO_KEY, memo) } catch { /* the next load just asks again */ }
    return 'kept'
  }
  // No row at all: nothing is pushed to it — an opt-in of this account still being posted (from any tab), or one whose
  // post failed and is kept for a retry (subscribeToPush). Kept; only another account's row is a leak.
  if (owner !== 'other') return 'unknown'
  // Still the subscription asked about, and the account still the one signed in here?
  const now = (await reg.pushManager.getSubscription()) as Sub | null
  if (!now || now.endpoint !== sub.endpoint || !stillCurrent()) return 'unknown'
  // `unsubscribe()` resolves false when the push service did not let go: then nothing was dropped.
  if (!(await now.unsubscribe())) return 'unknown'
  // What that account's pushes already put on this device goes with it: the notifications still listed by the system
  // (offer amounts, notes — this registration shows notifications only from a push, public/sw.js:24, so every one came
  // to that subscription) and the badge they set.
  try { for (const shown of await reg.getNotifications()) shown.close() } catch { /* not supported */ }
  try { await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.() } catch { /* no badge API */ }
  announcePushSubscriptionChanged()
  return 'dropped'
}
