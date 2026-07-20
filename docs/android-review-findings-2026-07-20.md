# Android native stack — verified review findings (2026-07-20, Kyle's fan-out)

Dual-external + Opus-dimension adversarial review of `apps/android/**` (the same
harness that reviewed iOS): **3 Opus dims + GPT-5.6 (codex) + Gemini 3.1 Pro
(agy)** found 18 raw; **each independently verified** against the live code by an
xhigh refuter; **14 CONFIRMED, 4 refuted.** Notably the verifiers correctly
REFUTED the "plaintext token on Keystore failure" (Auth.kt now `.getOrNull()`
fail-closed) and a refresh-race claim (Auth.kt now serializes the write on
`Dispatchers.Main.immediate`) — i.e. they account for Murat's in-flight
hardening. Do NOT re-raise those.

Lane split (both sessions were live in these files — claim on the board before editing):

## Kyle (Core/Auth/Feed/Favorites) — FIXING NOW
1. **[MAJOR/security] Auth.kt signOut() never clears the WebView cookie/storage
   jar → re-adopt after sign-out.** signOut wipes EncryptedSharedPreferences +
   Api.accessToken + POSTs Supabase logout, but the embedded eno.vn page keeps
   its Supabase cookies + localStorage. Tap Sign out → Sign in loads
   WebTab("/signin"): getSession() restores the still-valid access-token JWT,
   onAuthStateChange fires INITIAL_SESSION, the bridge posts tokens → adopt()
   re-signs-in the PREVIOUS account with no credentials. Shared-device account
   leak. FIX: on signOut clear the global jar — `CookieManager.getInstance()
   .removeAllCookies(null); .flush(); WebStorage.getInstance().deleteAllData()`.
2. **[MAJOR] Feed.kt no latest-wins guard on filter/sort** (3 finders converged).
   Setter clears _items + load(reset=true), but `if (loading) return` drops the
   newer request; the in-flight stale response fills the grid under the newly
   selected chip; offset/exhausted corrupt; loadMore appends mismatched pages.
   FIX: request-generation counter — reset always supersedes; stale gen drops
   its result; pagination (reset=false) still coalesces.
11. **[MINOR] Favorites.kt save/unsave POSTs race unordered** → savedCount
    inflation when base=0 (GREATEST clamp swallows the decrement). FIX: debounce
    per-id and send the net final state, cancelling superseded sends.

## Murat (messages/*, account/{Notifications,MyListings}) — HANDOFF
3. **[MAJOR] Thread.kt retry() mints a fresh clientId → duplicate message/offer.**
   send()/counter() mint a new UUID each call and never store it on ChatMsg;
   retry() re-invokes them → new clientId → server's msgid NX ledger sees a new
   key → inserts AGAIN. Defeats the exact idempotency guard. FIX: store clientId
   on the local ChatMsg at deliver(); retry() REUSES it. (iOS ThreadView has the
   same shape — fix both.)
4. **[MAJOR] Thread.kt load() keeps a failed local unconditionally → permanent
   phantom "Not sent" beside the delivered message.** The `m.failed -> true`
   keep-branch (line ~89) skips the `!recentMineKeys.contains(key)`
   reconciliation the m.pending branch has. FIX: reconcile the failed branch by
   content key too (drop the phantom once the server copy arrives).
6. **[MAJOR] Thread.kt 12s pollers leak & accumulate.** MessagesScreen renders
   ThreadScreen internally (openThread state), so each keyed ThreadViewModel
   stays in the persistent "messages" NavBackStackEntry store; no onCleared /
   DisposableEffect / poller.cancel(). Visiting N threads leaves N concurrent
   12s authed pollers for the session (battery/data/server drain). FIX: stop the
   poll when the thread leaves composition (DisposableEffect + a cancellable
   poll job, or route threads through the NavHost thread/{id} path which clears).
9. **[MINOR] Thread.kt Accept/Decline no in-flight gating** → double-tap → second
   POST 409s → spurious "offer can't be updated" dialog after a successful
   accept. FIX: a busy flag (like Detail.kt's chatBusy) disabling the buttons.
10. **[MINOR] Thread.kt load() no sequence guard** → a stale poller load resolving
    after act()'s post-accept load reverts the offer card Accepted→pending for
    ~12s. FIX: generation guard on the thread assignment (same pattern as Feed).
14. **[MINOR] Thread.kt identical sequential messages deduped/dropped.**
    recentMineKeys keys purely by content ("Hello|-1"), so a second identical
    message is dropped from the UI until the next poll. FIX: incorporate clientId
    into the merge identity.
8. **[MINOR] account/MyListings.kt act() ignores Api.send status** → failed
    sold/hide/delete (403/409/429/500) fail silently; seller thinks it worked.
    (Api.send does NOT throw on non-2xx.) FIX: check 2xx, surface an error.
12. **[MINOR] messages/Messages.kt InboxViewModel.delete swallows non-2xx** →
    optimistic row removal stands; conversation reappears on next load. FIX:
    check status, restore the row + surface error on failure.
13. **[MINOR] account/Notifications.kt clearAll + openedList mark-read optimistic
    on failure** → cleared UI / zeroed badge re-inflate on next refresh. FIX:
    only apply on 2xx (or roll back on failure).

## Refuted (do NOT re-raise)
Plaintext token on Keystore failure (Auth now fail-closed .getOrNull), refresh()
write-on-IO race (now Main.immediate serialized), + 2 others dropped by verify.
