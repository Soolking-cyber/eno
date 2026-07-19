# iOS Swift stack — verified review findings (2026-07-20, Murat's fan-out)

The owed dual-external review of `apps/ios/Eno`: **Gemini 3.1 Pro + GPT-5.6 + 2 Opus
dimensions, every claim adversarially verified** against committed HEAD (≈55d347bb) by
independent xhigh verifiers — only walkable failure paths survived. 11 confirmed,
7 refuted (incl. several that v10's hardening already fixed). Fix recipes below are the
verifiers' own, checked against the actual code. Owner: **Kyle's lane** (Auth/Messages/
Core) — Murat is NOT touching these files; claim here when picking them up.

## Critical

1. **`enoAuth` bridge adopts a session from ANY frame/origin — session hijack**
   `Features/Shared/WebViews.swift` — the script-message handler is exposed to every
   frame of every page the WebView ever loads (cross-origin iframes, ad scripts,
   any link the user follows inside a sheet) and adopts `access_token`/`refresh_token`
   from `message.body` with zero trust checks → an attacker page can plant ITS session
   (or steal-by-confusion). FIX: gate before adopting —
   `guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
   message.frameInfo.securityOrigin.host == "eno.vn" else { return }`
   (use `securityOrigin`, not `request.url` which can be nil/about:blank).

2. **`refresh()` vs `adopt()` race → unprompted sign-outs** `Features/Auth/AuthModel.swift`
   refresh() captures the OLD refresh token, suspends at its await; the web sheet
   adopts a fresh session mid-flight; Supabase 400s the old token; the 400 branch
   calls `signOut()` unconditionally → wipes the just-adopted VALID session. FIX:
   `private var sessionGen = 0`, incremented in adopt() and in refresh()'s success
   branch; refresh() snapshots `let gen = sessionGen` before its await and bails in
   BOTH resume branches when `sessionGen != gen`. (Closes the sibling 200-branch
   lost-update too.)

## Major

3. **Zombie session: `signOut()` doesn't cancel the in-flight refresh** (AuthModel) —
   a 200 landing after sign-out unconditionally reassigns `session` + rewrites the
   Keychain → user silently signed back in. FIX: in signOut(): `refreshTask?.cancel();
   refreshTask = nil; authEpoch += 1` before clearing; refresh() guards its resume on
   `!Task.isCancelled && session != nil && epoch == authEpoch`. (Folds into #2's
   generation counter — one mechanism covers both.)

4. **Authed API responses persist in the shared disk `URLCache`** (`Core/APIClient.swift`)
   — REPRODUCED with a real Swift 6.3 client against eno.vn's live headers: Bearer
   responses (profile, inbox…) land in the 256MB on-disk cache and can be re-served.
   FIX: session delegate `willCacheResponse` → return nil when the request carried
   `Authorization` (or bluntly `req.cachePolicy = .reloadIgnoringLocalCacheData` on
   Bearer requests); also `URLCache.removeAllCachedResponses()` on signOut.

5. **Access token is never refreshed during ACTIVE use** (APIClient/AuthModel) —
   refreshIfNeeded runs only on restore/foreground; after ~1h in-app every call 401s
   until backgrounding. FIX: `APIClient.shared.ensureFreshToken: (@Sendable () async -> Void)?`
   set to `{ await AuthModel.shared.refreshIfNeeded() }` at startup; await it at the
   top of get/post/send/uploadImages (single-flight + 60s headroom already exist).

6. **Offer accept/decline failures are swallowed** (`Features/Messages/ThreadView.swift`)
   — `act()` ignores `send()`'s status (send() doesn't throw on non-2xx) → optimistic
   accepted/declined state persists on failure. FIX: guard `(200..<300)` else throw;
   `actionError` observable + alert; reload on success only.

7. **Failed counter-offer renders as a live pending offer** (ThreadView) — offerCard
   ignores `m.failed`; a network-failed counter shows "Waiting for a response…" with
   no retry. FIX: mirror bubble()/meta()'s failed branch — "Not sent — tap to retry"
   in `Tokens.danger` → `model.retry(m)`.

## Minor / hygiene

8. **Keychain tokens not `ThisDeviceOnly`** (`Features/Auth/Keychain.swift:18`) —
   `kSecAttrAccessibleAfterFirstUnlock` migrates via backup/iCloud Keychain. FIX: switch
   to `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (delete-then-add already in
   place, no migration needed).
9. **`SecItemAdd` OSStatus discarded** (Keychain.swift:19) — persistence failures are
   silent → surprise logout on next cold launch. FIX: check status, log loudly.
10. **`FeedModel.reload()` has no latest-wins guard** — rapid filter changes can let a
    stale response overwrite a newer one. FIX: `reloadGeneration` counter, commit only
    when still current.
11. **`FavoritesStore.resetDeltas()` clears GLOBALLY on every feed reload** — wipes
    optimistic saves still displayed on other surfaces. FIX: scoped
    `clearDeltas(for: page.listings.map(\.id))`.
    Plus: FeedModel's disk-cache read/decode + encode/write run on the MainActor —
    move to `Task.detached` (APIClient.decode itself is fine — nonisolated).

## Refuted (don't re-raise)

UIHostingController retain in ZoomableRemoteImage (scrollview keeps the view alive) ·
favorites ids-hydration truncation (ids path has no limit) · ChatMsg.body decode crash
(server always serializes a string) · WebTabView navigation hijack (dead code since v10)
· VND formatter nil under US region (repro'd fine) · APIClient token torn reads (v10's
NSLock) · refresh single-flight missing (v10 added refreshTask).
