import type { ApiErrorCode } from '@/lib/api/errors'

/**
 * ⛔ A DELAYED WRITE IS SENT AS THE ACCOUNT THAT TAPPED IT, OR NOT AT ALL.
 *
 * Three writes wait out a 5s undo window before they reach the server (src/hooks/use-undo-window.tsx):
 * deleting a conversation, deleting a listing, answering an offer. The cookie is read when the request
 * goes out, not when the user tapped — so if the browser changed account inside the window (a sign-out
 * and a sign-in in another tab), the write would land as the OTHER account. For the conversation that is
 * a real write: if both accounts are in the thread, the second one's inbox loses it. For the listing and
 * the offer the server refuses anyway (403, 409 not_actionable), but the refusal lands on a screen that
 * still shows the first account, as "try again".
 *
 * So the client names the account it tapped as, and each of those three routes, on its first line,
 * answers 409 `account_changed` when the cookie belongs to someone else. Nothing is written and nothing
 * else is read first. A sign-out in the SAME tab does not get here: it sends every open window first
 * (BEFORE_SIGN_OUT_EVENT, below), with the cookie still in place.
 *
 * ⚠️ ABSENT IS NOT A MISMATCH. The native dashboards and any page loaded before this shipped send no
 * header, and they keep today's behaviour. The header only ever narrows what a request may do.
 */
export const ACTING_ACCOUNT_HEADER = 'x-eno-acting-account'

/** The refusal, for the clients to branch on. A TYPE import of the vocabulary, so no page bundle carries all of it. */
export const ACCOUNT_CHANGED = 'account_changed' satisfies ApiErrorCode

/**
 * Dispatched on `window` by `signOut()` (auth-context.tsx) BEFORE it does anything else. Every undo
 * window open in this tab sends its write at once, while the session cookie is still this account's,
 * and hands it to `waitFor` — signOut() then waits for those writes (at most SIGN_OUT_FLUSH_WAIT_MS)
 * before it removes the session. Starting a fetch is not enough: the listing DELETE's owner check asks
 * the auth server, which would race the logout; and the writes' own success handlers (the inbox
 * re-pull, the dashboard refetch) should still read as this account.
 */
export const BEFORE_SIGN_OUT_EVENT = 'eno:before-sign-out'
export type BeforeSignOutDetail = { waitFor: (write: Promise<unknown>) => void }
/** The most signOut() waits for the writes it flushed: past it, signing out is not held hostage by a slow network. */
export const SIGN_OUT_FLUSH_WAIT_MS = 2500

/**
 * signOut()'s first step, as a function with its state: announce the sign-out (synchronously — every undo
 * window sends before anything awaits) and resolve once the writes handed over have answered, or after
 * SIGN_OUT_FLUSH_WAIT_MS. ⚠️ THE WAIT IS SHARED: a second sign-out while the first is still waiting finds no
 * undo window left to flush, and must wait for the FIRST one's writes rather than run ahead to the logout.
 * One per tab (auth-context.tsx holds it at module scope).
 */
export function createSignOutFlush(): () => Promise<void> {
  let pending: Promise<unknown> | null = null
  return async () => {
    const flushed: Promise<unknown>[] = []
    window.dispatchEvent(new CustomEvent<BeforeSignOutDetail>(BEFORE_SIGN_OUT_EVENT, { detail: { waitFor: (write) => { flushed.push(write) } } }))
    if (flushed.length) {
      const wait = Promise.race([Promise.allSettled(flushed), new Promise((resolve) => setTimeout(resolve, SIGN_OUT_FLUSH_WAIT_MS))])
      pending = wait
      void wait.then(() => { if (pending === wait) pending = null })
    }
    if (pending) await pending
  }
}

/**
 * The header for a delayed write. Pass the id of the account signed in AT THE TAP, captured then —
 * never read it again when the request goes out, which is the whole point. `null` (no account known
 * at the tap) sends no header, so the server keeps its old behaviour.
 */
export function actingAccountHeaders(accountId: string | null): Record<string, string> {
  return accountId ? { [ACTING_ACCOUNT_HEADER]: accountId } : {}
}

/**
 * True when the request names an account and the session belongs to a DIFFERENT one. A signed-out
 * caller (`callerId` null) is not a mismatch: the route's own 401 answers it.
 */
export function actingAccountMismatch(req: Request, callerId: string | null): boolean {
  const named = req.headers.get(ACTING_ACCOUNT_HEADER)
  return !!named && callerId !== null && named !== callerId
}
