# Shipping the iOS app to the App Store

The Capacitor app at the repo root (`capacitor.config.ts`, `ios/`) — the same shell as the Android app
on Google Play, rendering the live **https://www.eno.forum** in a WebView. Written 2026-10-04 against a
built and archived binary. Every command in §2–§3 was run and its output is quoted where it matters;
§4 (bucket 2) needs the paid account and is a plan, not a record.

⛔ **THIS IS NOT `apps/ios`.** That SwiftUI app is shelved (owner: "only through Capacitor; native we do
later"); `docs/ios-appstore-readiness.md` describes it and is history for this release.

⛔ **MOST CHANGES ARE NOT APP STORE RELEASES.** The WebView loads the live site, so a product change
reaches installed apps the moment the site deploys. A new binary is needed only when the NATIVE shell
changes — a plugin, an Info.plist key, the privacy manifest, an entitlement, an icon. The flip side:
every web deploy changes the iOS app WITHOUT review (Guideline 2.3.1) — never switch on payments, the
wallet or a hidden surface after approval without a new submission that discloses it.

---

## State as of 2026-10-04

| | |
|---|---|
| Bundle id | `vn.eno.app` (pbxproj, app target only; first choice of decision D3) — ⚠️ UNPROVEN: a free team could not register it, which may mean it is taken; the first paid-team registration (P2) settles it, the fallback touches `APPLE_BUNDLE_ID`, APNs and Supabase (§7) |
| Version | `MARKETING_VERSION` **1.0.2** (matches Android), `CURRENT_PROJECT_VERSION` **1** |
| Devices | **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`, D6); iPads run it in compatibility mode |
| Minimum iOS | 15.0 |
| Toolchain | Xcode 26.5 / iOS SDK 26.5, Capacitor 8.4 (CLI 8.5.0), 14 plugins via SPM |
| Origin | `server.url` = `https://www.eno.forum`, `allowNavigation` = the two forum hosts |
| Signing | **none possible yet** — the project carries the owner's FREE team `S4VCY6N8QR`; no paid team |
| App Store Connect | **no record exists** |
| Android | LIVE on Play production, package `eno.vn`, versionCode 4 / 1.0.2 — nothing to upload |

Branch `build/ios-appstore-prep` (pushed, not merged, not deployed) carries:

| Commit | What |
|---|---|
| `04ceb0907` | iOS shell — privacy manifest (FileTimestamp + full data types), forum-origin deep links, iPhone-only, 1.0.2, localized Info.plist strings, dormant entitlements template |
| `a7bd3e02b` | Web — App Store review gates (all OFF), push flag per platform |
| `52c17e4d8` | Web — block users (Guideline 1.2) behind the `ugc-safety` gate (OFF) |
| `f361c7c8a` | App Store screenshot pipeline from the simulator (6/6 certified 2026-10-04 on the final scripts) |
| (this doc's commit) | this runbook; `docs/ios-appstore-readiness.md` marked as the shelved app |
| `32e6e0895` | Web — chat translation asks before it sends (`app-ai-notice`, R8/D14, OFF) — branch `build/ios-appstore-prep-b` |
| `23ca17e31` | Web — no e-Visa application or ID capture in the iOS app (`ios-hide-visa`, D5 = b, OFF) — branch `build/ios-appstore-prep-b` |

⚠️ **THE BRANCH IS NOT ON main.** Merge it (and, for the web half, deploy on the owner's word) before the
first signed archive, or the archive will not carry the shell fixes.
⚠️ **`build/ios-appstore-prep-b` (R8, D5) too.** Until it is merged, `app-ai-notice` and `ios-hide-visa` are
unknown tokens, and a build with either in `NEXT_PUBLIC_APP_REVIEW_GATES` fails (`next.config.ts` refuses them).

---

## 1. What bucket 1 changed, and why

### Native shell (`ios/`) — reaches users only through an App Store binary

- **ITMS-91053 blocker fixed.** IONCameraLib (`ion-ios-camera`, via `@capacitor/camera`) reads
  `NSURLCreationDateKey`, and its own `PrivacyInfo.xcprivacy` is never bundled (its `Package.swift`
  declares no resources for the library target). `ios/App/App/PrivacyInfo.xcprivacy` now declares
  `NSPrivacyAccessedAPICategoryFileTimestamp` with the library's reasons `C617.1` + `3B52.1`.
- **Privacy manifest = the live site's collection inside the app** — 17 linked types, none tracking,
  plus CSP violation reports as not-linked diagnostics. It mirrors Appendix B; change both together.
  `SensitiveInfo` carries a note: remove it in the release that hides visa + eKYC (D5 — the `ios-hide-visa` gate).
- **Quick actions no longer open Safari.** `AppDelegate.swift` built Post / Messages / Saved on
  `https://eno.vn`, which is not in `allowNavigation` since the app moved to the forum, so Capacitor
  handed it to Safari — onto the edition with the "not yet launched" banner. It now mirrors Android
  (`MainActivity`, commit `11f430d12`): on the app's own origin every link shape goes to
  `native-bootstrap.tsx`; anywhere else (offline page, about:blank) the WebView is loaded natively, with
  eno.vn and forum-apex links rebuilt onto `https://www.eno.forum` from validated components. The push
  token callbacks (`didRegisterForRemoteNotificationsWithDeviceToken` / `…didFailToRegister…`) are intact.
- **iPhone-only, 1.0.2 (1), display name "eno"** (D6, D15, D10).
- **Info.plist strings localized like Android** — `en.lproj` / `vi.lproj` `InfoPlist.strings` for the five
  usage descriptions and the three quick-action titles. The camera string now also names identity
  verification (`/dashboard/account/verify` uses the camera for the ID document and selfie).
- **Dormant:** `ios/App/App/App.entitlements.template` — Associated Domains (`www.eno.forum`,
  `eno.forum`, `eno.vn`, as on Android) and `aps-environment`. Not wired: a free team cannot provision
  them. Step P4 wires it.

### Web (`src/`) — every change behind an owner switch, all OFF

`NEXT_PUBLIC_APP_REVIEW_GATES` is a comma list read by `src/lib/app-review-gates.ts`. Unset ⇒ nothing
changes on either site or in either app. A misspelled token fails the build (`next.config.ts`).

| Token | Plan | Effect when on | Decision |
|---|---|---|---|
| `ios-hide-google` | R2 | no "Continue with Google" in the iOS app (Guideline 4.8) | D2 = b |
| `ios-hide-wallet` | R6 | no Payments row in the iOS app; `/dashboard/payments` (and `/wallet`, `/payout`, which redirect there) → `/dashboard` | D7 |
| `app-signin-tidy` | R7, R13 | both apps: no disabled "Phone · soon" strip; Terms / Quy chế / Privacy open in the in-app browser sheet | — |
| `app-no-gtm` | R11 | both apps: no Google Tag Manager container | — |
| `site-brand-copy` | R7 | eno.forum names itself where copy hard-codes eno.vn; English /privacy stops quoting the Vietnamese placeholder | — |
| `ugc-safety` | R3 | both sites + apps: Block beside Report (chat header, a person's storefront), unblock in Settings → Privacy; a block refuses new threads, messages, offer accepts, the phone reveal and teacher contact shares both ways, hides the threads from the blocker's inbox and badge, and tells moderators via `/admin/feedback` | — |
| `app-ai-notice` | R8 | both apps: the first time a chat has something to translate, a one-time notice — "To translate your chats, messages are sent to Microsoft (Azure AI Translator)…" — with "Turn off translation" / "OK"; ONE answer for all chats on that account and device. NOTHING is requested until it is answered; "off" stops every CHAT translation request that person's app makes (no strip, no request — interface and listing text still translate as before); Settings → Preferences → Chat translation shows OFF until permission is given and turns it back on. The notification bell stops machine-translating an offer's note until "OK". Kept on the device (`chat-tr:consent:<profile>`) — no server-side translation preference exists (§6), so what a person SENDS still follows the other person's setting, and the notice says so. ⚠️ Keys on `EnoNativeApp`, so it also changes the live Android app (P10a) | D14 |
| `ios-hide-visa` | D5 | iOS app only: no e-Visa application and no identity/business-document capture. `/dashboard/visa` → Services (no e-Visa tab), `/dashboard/account/verify` → the verification hub (status kept, "Verify yourself" replaced); an e-Visa product page — the desk's or a partner's (visa slot + an e-Visa chip) — hides "Apply in chat" / the chat box; the `/vietnam-evisa` family loses its CTA and listing grid (information only; `/services-for-expats-vietnam` keeps its grid — it is every service, and its e-Visa cards lead to gated product pages); an e-Visa chat thread — the desk's, or one about a partner's e-Visa product — is read-only for the applicant (the seller side keeps its composer; each desk card that takes a step becomes one line, a finished e-Visa stays downloadable, no composer, nothing posted on open); the camera never opens for KYC; the business panel takes no upload. Each place says the step is available at www.eno.forum in a web browser (plain text — a link would reopen it in the app). Backstop: the proxy refuses iOS-app writes (not DELETE) to `/api/visa/applications/**`, `/api/visa/cards/**`, `/api/seller/identity/**`, `/api/seller/verification/**`; `POST /api/conversations` refuses an e-Visa product and the send route refuses the applicant's message into an e-Visa thread (403 `ios_app_unavailable`) | D5 = b |

Push is gated per platform now: `NEXT_PUBLIC_NATIVE_PUSH_IOS` / `NEXT_PUBLIC_NATIVE_PUSH_ANDROID`
(`src/lib/native-push-flags.ts`). The old shared `NEXT_PUBLIC_NATIVE_PUSH` is no longer read — it was
measured unset on both box env files.

**To switch gates on (OWNER-APPROVED prod write, both sites):** add the line to
`/opt/eno/secrets/eno-forum.env` AND `eno-vn.env` on the box — `infra/vn-node/eno-build.sh` passes those
files to the image build as the `buildenv` secret, which is what inlines a `NEXT_PUBLIC_*` value — then
deploy with `infra/vn-node/eno-deploy.sh` on the owner's "deploy". Recommended for the first submission,
in TWO steps. ⚠️ Prerequisite: the gated build verified below is the SERVICES edition; before the line goes
into `eno-vn.env`, build the MARKETPLACE edition with it and confirm eno.vn's `/privacy` and sign-in render
as before (`site-brand-copy` is meant to change eno.forum's copy only). Step 1 — touches only the iOS app
and the sites' own copy:

```
NEXT_PUBLIC_APP_REVIEW_GATES=ios-hide-google,ios-hide-wallet,site-brand-copy
```

Step 2 — only after the Android emulator pass **P10a** (§4): append `,app-signin-tidy,app-no-gtm`, giving
`ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy` (the full set, verified in
the iOS app — see below). ⛔ Those two key on the `EnoNativeApp` user agent, so they ALSO change the
Android app that is live on Google Play, and the verification below covered only the iOS simulator and
desktop Chromium.

…and append `,ugc-safety` once the follow-ups in §6 are settled (Guideline 1.2 expects blocking, so it
should be on before submission).

⚠️ Set the SAME line in both env files (after the marketplace-edition check in the prerequisite above) — the two editions share one database, so a block made on one
site and not enforced on the other would break the promise the Block dialog makes. Before
`ugc-safety` goes on, settle the follow-ups listed in §6.

**The two newer tokens (built 2026-10-05, branch `build/ios-appstore-prep-b`; NOT in the local verification
below):** append `,ios-hide-visa` in Step 1 when D5 = b — it changes only the iOS app. Order matters: the gate
goes live by a WEB deploy, the privacy manifest only with a binary, so switch the gate on FIRST, then submit the
binary whose `PrivacyInfo.xcprivacy` drops `SensitiveInfo` with App Privacy answered without "Sensitive Info"
(Appendix B) — and never switch the gate off afterwards without a new submission (the shipped declarations would
be false). Append `,app-ai-notice` with Step 2: like `app-signin-tidy` it keys on `EnoNativeApp`, so it also
changes the Android app on Google Play — check its notice in the P10a pass. The same line in both env files is
safe: no e-Visa copy can render on eno.vn (it lives in the aliased visa module, a stub there), and the iOS app
loads only eno.forum.

Verify each one in the TestFlight build (P10), and on the web that nothing moved (desktop Chrome on
`/signin` still shows "Continue with Google"; the form renders client-side, so curl cannot see it).

**Already verified locally, 2026-10-04 — the five non-UGC gates ON (not `ugc-safety`), in the iOS app.** The services edition was built
with the full five-token line (+ a dummy `NEXT_PUBLIC_GTM_ID`) against a scratch Postgres seeded by
`scripts/ci-fixtures.ts` (the CI recipe; no production data), served on :3210, and loaded by a
throwaway copy of the simulator app whose `capacitor.config.json` pointed at it (never committed). In
the app: `getPlatform()` = ios, `html.native-ios`, **no GTM script and no `dataLayer`**, **no "Continue
with Google"** (the Join prompt shows only the email form), **no "Phone · soon" strip**, and on `/signin`
**Terms opened in the in-app browser sheet** with the form left intact underneath. ⚠️ Inside the
60-second Join prompt the same link navigated the WebView to `/terms` instead (the prompt closed) —
harmless, but not the sheet; look at it before switching `app-signin-tidy` on. The same gated build in
desktop Chromium (Playwright) was unchanged: the GTM container requested, "Continue with Google"
present, the Phone strip visible, Terms with `target=_blank`. The marketplace edition was also built
with the gates OFF (the CI recipe) — see §2.

### Measured facts this release depends on (read-only, 2026-10-04)

- Crossmint keys ARE set on eno.forum (`CROSSMINT_SERVER_SIDE_API_KEY`, `CROSSMINT_SIGNER_SECRET`
  non-empty): the wallet is live in the app until `ios-hide-wallet` is on. App Privacy cannot answer
  "no financial / payment data" while it shows.
- `NEXT_PUBLIC_GTM_ID` is set on eno.forum and the container loads inside the app today
  (`!!document.querySelector('script[src*=googletagmanager]')` = `true` in the simulator).
- `APPLE_TEAM_ID` is unset: `/.well-known/apple-app-site-association` answers 404 on every host (by
  design until P7).
- `NEXT_PUBLIC_NATIVE_PUSH*` unset on both editions.
- `ForumUserBlock` exists in prod with **0 rows** (`supabase-db`, read-only transaction): no legacy
  block switches on with `ugc-safety`. The `Feedback` table exists.

### Not built in bucket 1, and why

- **R5 report + word filter on help comments and reviews** — see §6. These are
  product features with owner-level choices in them, not switches. (R3, blocking, IS built — §1.)
- **R8 translation notice and D5 = hide visa + eKYC — built since, both OFF** (`app-ai-notice`, `ios-hide-visa`,
  table above). The open question this bullet used to carry — an iOS seller the publish gate asks to verify —
  is answered in the app: the verification hub says the check is done at www.eno.forum in a web browser. The
  publish-time identity gate is marketplace-only today (`identityGateEnforced`, account-state.ts), so on
  eno.forum nothing asks yet. If it is ever enforced there, an iOS seller has to verify in a browser before
  publishing — part of D5 = b's cost, to weigh then.

---

## 2. Build, archive and verify (no Apple account needed)

```bash
# 0. ENO_LOCAL_SHELL must be UNSET — with it the app boots the local shell instead of server.url
env | grep ENO_LOCAL_SHELL            # prints nothing
npx cap sync ios                      # 14 plugins; git status shows no tracked change
plutil -p ios/App/App/capacitor.config.json | grep '"url"'   # "url" => "https://www.eno.forum"

# 1. Debug build for the simulator
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath <dd> CODE_SIGNING_ALLOWED=NO build
# → ** BUILD SUCCEEDED **, 0 compiler warnings

# 2. Unsigned Release archive
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath <out>/App-unsigned.xcarchive \
  -derivedDataPath <dd-rel> CODE_SIGNING_ALLOWED=NO archive
# → ** ARCHIVE SUCCEEDED **, 0 compiler warnings
```

⚠️ The one line containing `warning:` in both logs is `appintentsmetadataprocessor … Metadata
extraction skipped. No AppIntents.framework dependency found.` — an informational notice, present in
every build of this project. Count real ones with `grep -cE '^[^ ].*: (warning|error):' <log>` (= 0).

⛔ **Never pass `PRODUCT_BUNDLE_IDENTIFIER` on the xcodebuild command line.** It renames
`IONCameraLib.framework` too and the install fails with `DuplicateIdentifier`. Set it in pbxproj on the
App target only.

**Archive checks (run 2026-10-04, outputs quoted):**

```bash
A=<out>/App-unsigned.xcarchive/Products/Applications/App.app
plutil -p $A/Info.plist | grep -E 'UIDeviceFamily|ShortVersion|CFBundleVersion"|DisplayName|NonExempt' -A1
#   "CFBundleDisplayName" => "eno"        "CFBundleShortVersionString" => "1.0.2"
#   "CFBundleVersion" => "1"              "ITSAppUsesNonExemptEncryption" => false
#   "UIDeviceFamily" => [ 0 => 1 ]        (no UISupportedInterfaceOrientations~ipad)
plutil -p $A/capacitor.config.json | grep '"url"'      # "https://www.eno.forum"
```

**Required-reason API scan** — every Mach-O in the bundle, undefined symbols only. Re-run after any
plugin bump; each symbol found must have a category in `PrivacyInfo.xcprivacy`:

```bash
find "$A" -type f | while read -r f; do file "$f" | grep -q Mach-O || continue
  echo "${f#$A/}: $(nm -u "$f" | grep -E 'UserDefaults|CreationDate|ModificationDate|_stat$|_fstat$|_lstat$|getattrlist|systemUptime|mach_absolute_time|VolumeAvailableCapacity|_statfs|_statvfs|FileSystemFreeSize|activeInputModes' | sort -u | tr '\n' ' ')"
done
# App: _OBJC_CLASS_$_NSUserDefaults                          → UserDefaults CA92.1
# Frameworks/IONCameraLib.framework/IONCameraLib: _NSURLCreationDateKey → FileTimestamp C617.1, 3B52.1
# Frameworks/Capacitor.framework/Capacitor: (none)   Frameworks/Cordova.framework/Cordova: (none)
```

### Simulator smoke (iOS 18.4 runtime — the 26.5 simulator cannot decode AVIF)

```bash
xcrun simctl boot <udid>                 # headless — do NOT open Simulator.app (see the traps below)
xcrun simctl install <udid> <dd>/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch <udid> vn.eno.app
python3 scripts/ios-sim-inspect.py <udid> "JSON.stringify({href: location.href, p: Capacitor.getPlatform(), cls: document.documentElement.className, ua: navigator.userAgent.slice(-14), iw: innerWidth, sw: document.documentElement.scrollWidth})"
# {"href":"https://www.eno.forum/","p":"ios","cls":"… native native-ios","ua":"EnoNativeApp/1","iw":440,"sw":440}
```

Run 2026-10-04 on an iPhone 16 Pro Max (18.4): home, a listing
(`/listings/cmtsglhxu04v3rvq4ocnmwb2f`), `/signin` and the offline page all render, `innerWidth ===
scrollWidth` on each (no zoom-out, 440 = 440). Re-run on the last commit that touches `src/` (`52c17e4d8`) on an iPhone SE
(3rd generation, 18.4): home, `/listings/cmtzgayju00fi0jrs1klz68ac` and `/signin` at 375 = 375, html
carries `native native-ios`. The Debug build and the unsigned archive above were rebuilt from that same
head after a clean `npx cap sync ios` (no tracked file changed): both succeeded with 0 compiler
warnings, and the archive scan was identical. The offline page was produced with a throwaway copy of the built
`.app` whose `capacitor.config.json` pointed at an unreachable host — never committed.

**Deep links (R4)** — fired from inside the WebView (`location.href = 'enovn://…'`, which Capacitor
hands to `UIApplication.open`, i.e. the app's own `open url` path) and with `xcrun simctl openurl`:

| Case | Warm | Cold |
|---|---|---|
| `enovn://open?path=%2Fsaved` | `https://www.eno.forum/saved` | `https://www.eno.forum/saved` |
| `enovn://open?path=%2Fpost`, `%2Fmessages` | both in-app on the forum origin | `/messages` tested: in-app (`/post` not run cold) |
| `enovn://open?url=https%3A%2F%2Feno.vn%2Fc%2Frentals` | `https://www.eno.forum/c/rentals` | `https://www.eno.forum/c/rentals` |
| `?path=/saved` while the offline page shows | loaded natively → `https://www.eno.forum/saved` | — |
| eno.vn `?url=` with query + fragment, offline page | `https://www.eno.forum/c/rentals?q=x#top` | — |

Before the fix the same `?path=` link bounced to Safari on eno.vn (seen in the 2026-10-04 audit's
simulator log; that log is gone — the session scratchpad is wiped on restart). A
real home-screen long-press could not be driven headlessly; quick actions call the same `deliver()`
path — verify them on TestFlight (P10). A swiftc harness over the resolver refused every hostile shape
(auth/signin, dot segments, `//`, `/\`, tab, userinfo, port, foreign host, enovn nesting).

### Web builds (both editions, the CI recipe)

GitHub Actions runs only for `main` (`.github/workflows/ci.yml`), so this branch's web half was built
locally the way CI builds it — a scratch Postgres seeded by `scripts/ci-fixtures.ts`, placeholder
secrets, `npm run build`: the **services edition with every review gate ON** and the **marketplace
edition with the gates OFF** both finished `build=0`. Full vitest, tsc and `npm run lint` (eslint,
design-, edition-, docs-lint) are green on `52c17e4d8`, the last commit that touches `src/`; `f361c7c8a`
adds only `scripts/` (lint re-run green) and the docs commit only `docs/`. CI will run again on the merge.

### Simulator traps (not bugs)

- **Blank WebView on relaunch (`-1005`) or the offline page on a full reload** — the simulator's HTTP/3
  stack. `xcrun simctl uninstall` then reinstall. Devices are fine.
- **Do not open Simulator.app while driving the simulator from the CLI.** Measured 2026-10-04: with the
  GUI open the device took stray input (the page navigated by itself) and was shut down mid-run, twice.
- **`simctl openurl` to a custom scheme can show "Open in eno?"** — a springboard prompt with no headless
  way to tap it; reboot the simulator to clear it, or fire the link from inside the WebView.
- QUIC image timeouts: verify images on a device (TestFlight).

---

## 3. Screenshots (6.9-inch, 1320×2868)

```bash
xcrun simctl boot <iphone-16-pro-max-18.4-udid> && xcrun simctl bootstatus <udid> -b   # headless; the script refuses an unbooted device
scripts/appstore-capture.sh <iphone-16-pro-max-18.4-udid> <dd>/Build/Products/Debug-iphonesimulator/App.app
node scripts/appstore-frames.mjs
# → play-store-assets/ios/raw/0N-*.png + manifest.json, play-store-assets/ios/en/0N-*.png
#   (`/play-store-assets/` is already in the root .gitignore, like the Play assets)
```

The capture runs the real app on the simulator against the live site, reaches each screen by an
in-app deep link (the quick-action route), answers consent, quiets the 60-second sign-up prompt (and
closes it — Escape, then its own Close button, retried past the dialog's 400 ms press guard — if a slow
first attach under load let it open), blanks
live counts, and REFUSES a shot with regulated copy (visa, itinerary, PayPal, CellphoneS, "official
partner"), a broken image, a page wider than the viewport, an open dialog, or a BLANK frame (the page
area's gray spread under 0.02 — a WebView that had not painted passed every DOM check once and was
certified as a white image; measured spreads: home 0.30, the light map 0.096, the blank 0.00006). The framing adds a
caption and an iPhone bezel on the brand blue; both outputs are 24-bit PNG, no alpha.

| File | Screen | Caption |
|---|---|---|
| `01-home` | home feed | Rentals, jobs and second-hand deals / In English and Tiếng Việt |
| `02-rentals-map` | Rentals › Apartment, map view | Apartments and houses to rent / Filter by district, see them on a map |
| `03-motorbike` | `/motorbike-rental-ho-chi-minh-city`, "available now" grid | Rent a motorbike or a car / From local shops, by the day or the month |
| `04-jobs` | `/c/jobs` | Jobs, including English teaching / Roles across Vietnam, in one place |
| `05-item` | used Samsung Galaxy Z Fold7 (Minh Tuấn Mobile) | Every detail before you buy / Price in đồng with dollars alongside |
| `06-shop` | Minh Tuấn Mobile storefront ("Linked shop") | Second-hand shops in one place / Used phones, laptops and cameras |

⚠️ **RE-CAPTURE AFTER THE GATES ARE DEPLOYED** — the store images must match what the reviewer sees.
⚠️ **Two edits are made before the shutter, deliberately:** live counts ("N listings") are blanked so the
image does not date itself, and the Help/Support bubble is hidden. Everything else is the screen as it
renders (Guideline 2.3.3 asks for the app in use; neither edit adds or removes a feature).
⛔ **A HUMAN LOOKS AT EVERY IMAGE BEFORE UPLOAD.** The scans read the DOM: text inside an iframe, a canvas
or an image, and anything shown only in the second before the shutter, are not scanned. The pixel check
catches a blank frame, not a wrong one.
⚠️ Publishing the framed set is one rename, not crash-atomic: a kill between "old set aside" and "new set
in" leaves `play-store-assets/ios/en.staging-*.old` holding the previous set. Re-run the framing; nothing
is lost (the raw set and its manifest are untouched).
⚠️ The rentals grid was replaced by the map on purpose: several imported rental photos carry the source
site's watermark (Chợ Tốt, muaban, Rever). Every listing photo also carries the eno.vn mark — the
brand overlay, not a defect.
⚠️ Items 5 and 6 are linked (imported) listings — there is no first-party used listing on the site to
show instead (measured: the non-imported rows are new goods from one partner seller). This is the 4.2.2
"collection of links" risk in §7.

---

## 4. Bucket 2 — needs the paid account, in this order

**P1. Enrol (owner; needs D1).** Individual or Organization (an Organization needs the entity's D-U-N-S
number — request it now if that is the choice, it takes days to weeks).
✔ developer.apple.com/account → Membership details shows "Apple Developer Program", a Team ID and an
expiry date. Write the Team ID down.

**P2. Signing on this Mac (owner, once).** Xcode → Settings → Accounts → add the Apple ID (GUI only).
Then, with the Mac password, once:
`security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db`
— without it a headless `xcodebuild` hangs at CodeSign on a keychain prompt.
✔ After the first signed build, `security find-identity -v -p codesigning` lists the new team.

**P3. Register the App ID** (owner, or let Xcode do it): Identifiers → + → App IDs → App → Explicit →
the D3 bundle id, with **Associated Domains, Push Notifications, Sign in with Apple**.
✔ The identifier is listed with the three capabilities. If Apple says the id is unavailable, use the D3
fallback — the choice is permanent once a build is uploaded.

**P4. Repo commit [NATIVE]** (second-opinion gate, literal-pathspec commit):
- `DEVELOPMENT_TEAM` = the paid Team ID in all four places in `ios/App/App.xcodeproj/project.pbxproj`.
- `PRODUCT_BUNDLE_IDENTIFIER` = the D3 id on the **App target only** (two lines; never on the command line).
- `cp ios/App/App/App.entitlements.template ios/App/App/App.entitlements`; add the file reference to the
  App group by hand (not a synchronized group, no build phase); `CODE_SIGN_ENTITLEMENTS =
  App/App.entitlements` in both target configurations. Uncomment the Sign in with Apple key only if D2 = a.
  ⛔ **Delete the `applinks:eno.vn` line unless D1/D3 said yes to eno.vn opening this app** (see P7) — a
  claim in a signed, submitted binary can only be removed by another submission.
✔ `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination
'generic/platform=iOS' -archivePath <out>/App.xcarchive -allowProvisioningUpdates archive` succeeds, and
`codesign -d --entitlements :- <out>/App.xcarchive/Products/Applications/App.app` shows the entitlements.

**P5. App Store Connect record (owner).** My Apps → + → New App: iOS, name **Eno Marketplace**
(fallback Eno Marketplace Vietnam), primary language English (U.S.), the P3 bundle id, SKU `eno-ios-1`.
Business → EU DSA trader status, or exclude EU storefronts (D11). Untick **"Make this app available on
Mac"** unless the Mac build has been looked at — the same binary runs there, and the gates treat it as
iOS (`src/lib/app-review-gates.ts`).
✔ The record shows under My Apps with the right bundle id.

**P6. First upload → TestFlight.** Bump `CURRENT_PROJECT_VERSION` (every upload, rejected ones too),
`npx cap sync ios` with `ENO_LOCAL_SHELL` unset, archive, then Organizer → Distribute App → App Store
Connect → Upload, or `xcodebuild -exportArchive -archivePath <out>/App.xcarchive -exportOptionsPlist
<plist: method=app-store-connect, destination=upload> -allowProvisioningUpdates`.
✔ The "has completed processing" email, with **no ITMS-91053** (R1) and **no ITMS-90078** (push
entitlement present); the build appears under TestFlight; export compliance answered automatically by
`ITSAppUsesNonExemptEncryption = false`. ⚠️ If ITMS-91053 still names IONCameraLib, Apple wants the
manifest inside the framework: vendor the package with a `resources: [.process("PrivacyInfo.xcprivacy")]`
target, or move to a version that ships one.

**P7. Universal links (OWNER-APPROVED prod env write).** `APPLE_TEAM_ID=<team>` (and
`APPLE_BUNDLE_ID=<id>` if it is not `vn.eno.app`) in `/opt/eno/secrets/eno-forum.env`, then recreate the
container. ⛔ **eno.vn is a separate decision (D1/D3):** setting the same key in `eno-vn.env` makes the
licensed marketplace's domain vouch for an app that renders the e-Visa desk, and every shared eno.vn link
then opens it. Do it only with the owner's (and counsel's) yes; without it, drop `applinks:eno.vn` from
the entitlements in P4 and the eno.vn row from the check below.
✔ `for h in www.eno.forum eno.forum; do curl -s -o /dev/null -w "$h %{http_code} %{content_type}\n" https://$h/.well-known/apple-app-site-association; done`
(add `eno.vn` to the loop only if it was approved)
→ `200 application/json` on each host checked, `appIDs` = `<team>.<bundle>`. A lingering 404 is a Cloudflare
cache (purge) or a prerendered route (deploy). Then
`curl -s https://app-site-association.cdn-apple.com/a/v1/www.eno.forum` serves the same JSON (Apple's
CDN can lag hours).

**P8. Push via APNs** — follow `NATIVE_PUSH_SETUP.md` (OWNER-APPROVED env + DDL): `.p8` key (one
download only), `APNS_*` in both box env files (base64 the key), `NativePushToken` table via the safe
DDL flow in CLAUDE.md, then `NEXT_PUBLIC_NATIVE_PUSH_IOS=1` **last**, in BOTH `eno-forum.env` and `eno-vn.env` like every other
`NEXT_PUBLIC_*` line (build + deploy). Android stays off.
✔ On TestFlight, the owner's own device: sign in → permission prompt → a `NativePushToken` row → a test
message notifies → tapping it opens the right page.

**P9. Sign in with Apple — only if D2 = a** (else v1.1). Native id-token flow:
`@capacitor-community/apple-sign-in` (confirm SPM + Capacitor 8 support, or a small local
`ASAuthorizationController` plugin — an auth bridge, not a re-implemented surface) →
`supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })` behind a native-ios button. Must
haves: a new Apple user goes through the same provisioning/onboarding as `/auth/callback`; register the
sending domains with Apple's private email relay; revoke the Apple token in `eraseAccount`.
✔ New Hide-My-Email user gets a profile and an email; a returning user signs in; deleting the account
removes it from Settings → Apple ID → Sign in with Apple.

**P10a. Android pass BEFORE `app-signin-tidy` / `app-no-gtm` go live (no Apple account needed).** On the
Android emulator with the Play build (or `android/` debug) against a preview built with those two gates:
`/signin` has no "Phone · soon"; Terms / Quy chế / Privacy open in the in-app sheet and close back onto
the form, also from inside the 60-second "Join eno" prompt (it must survive); no `googletagmanager.com`
request (chrome://inspect → Network); Google sign-in still completes (Android keeps Google).
✅ **RUN 2026-10-05 against a scratch services preview with all five step-1+2 gates (throwaway debug app on
the `eno_pixel` emulator; evidence `~/eno-ios-prep/p10a/evidence-index.txt`):** no "Phone · soon" (EN/VI);
Terms / Operating regulations / Privacy / Quy chế open the Custom Tab and close back onto the form with the
typed email (and a half-typed code) intact; from inside the "Join eno" prompt too — the prompt survives
(the iOS note in §1 does not reproduce on Android); 0 of 1,381 WebView requests to googletagmanager /
google-analytics / doubleclick while desktop Chromium on the same build requested `gtm.js?id=GTM-TEST000`;
"Continue with Google" still on Android; `/dashboard/payments` redirects only for the iOS app UA. Not
runnable locally: the real email-code and Google round trips (placeholder auth backend).
⛔ **Found by that pass and fixed (`app_sheet` marker):** the sheet is NOT the app's WebView — it runs with
the browser's own UA and storage — so a legal page opened there was the ordinary web site, consent prompt
offering analytics and ads included, while the apps declare "no tracking". The app now opens those pages
with `?app_sheet=1`, and for THAT ONE DOCUMENT (only with `app-signin-tidy` on): consent forces analytics
and ads off, the GTM container is skipped (`app-no-gtm`), the consent prompt is not shown (its footer
re-open does nothing on that page), and the consent cleanup leaves the shared cookie jar alone (an Android
Custom Tab shares Chrome's); a personalization refusal still clears view history. Tracking-only and one
page only, by design: anyone can put the marker on a link, so it may never do more than switch tracking
off for the page that carries it. An earlier version also hid the site chrome and carried the mark through
sessionStorage — reviewers showed a crafted link could then strip a tab's navigation and the footer's
legally required operator details, so that was removed. Pages reached from inside the sheet are the web
site, as in any browser (server-side consent-gated events there follow the browser's stored consent). The
system-browser fallback gets the plain URL (src/lib/app-review-gates.ts `IN_APP_SHEET_PARAM`).
⚠️ Not yet re-run on a device: on the P10/P10a pass, open Terms from `/signin` and confirm no consent prompt
and no `googletagmanager.com` request on that page.

**P10. TestFlight device pass (the owner's device; the owner installs it).** Images load; Google sign-in
round trip (Android, and iOS if D2 keeps Google there — never yet run end to end on iOS); a universal link
tapped in Notes opens the right page, `/signin` and `/auth*` stay in Safari; quick actions warm AND cold;
camera + photo picker; push (P8). With the gates on: no Google on `/signin`, no Payments row, no "Phone ·
soon", Terms opens in the sheet and closes back onto the form, no `googletagmanager.com` request (Safari →
Develop → the device → Network); with `ugc-safety`: Block from a chat header and a storefront, the other
account can no longer send there, the thread leaves the inbox and badge, the note appears in
`/admin/feedback`, Unblock in Settings → Privacy restores it. ⚠️ A Google-created account must be able to sign in with an emailed code
on iOS (`ios-hide-google`) — try one before submitting.

With `app-ai-notice` (iOS AND Android, two accounts whose app languages differ): opening the chat shows the
notice and Safari → Develop → Network shows NO `/api/messages/translate` request until OK, and an offer's note
in the notification bell is shown as written (no `/api/translate` request for it); "Turn off translation"
removes the strip and sends nothing; Settings → Preferences → Chat translation turns it back on. With
`ios-hide-visa` (iOS only): Services has no e-Visa tab; `/dashboard/account/verify` lands on
`/dashboard/verification`, which says verification is done at www.eno.forum and opens no camera; an e-Visa product page (VietKite's or the desk's) shows the line instead of
"Apply in chat" / the chat box; `/vietnam-evisa` shows no CTA or grid; an existing e-Visa chat is read-only for
the applicant (the partner's own account keeps its composer); the same screens on the Android app are unchanged.

**P11. Reviewer account (OWNER-APPROVED prod write).** Reuse `play-review@eno.forum` after a read-only
check that it is still partner-flagged (password sign-in is partner-gated), else add `--for=apple` to
`scripts/register-play-reviewer.mjs`. Seed one listing and one conversation. The owner pastes the
credentials into App Store Connect → App Review Information — never into git.
✔ In the TestFlight build: Sign in → email → "Use a password" works; note whether Turnstile challenges.

**P12. Metadata (owner pastes from the appendices).** 6.9-inch screenshots (§3); name, subtitle,
promotional text, keywords, description (Appendix A); support URL `https://www.eno.forum/contact`,
marketing URL `https://www.eno.forum/about`, privacy URL `https://www.eno.forum/privacy`; category (D4);
price Free; availability (D11); copyright `2026 <legal name on the account>`; App Privacy (Appendix B);
age rating (Appendix C, override to 18+); content rights (D9); review notes + demo account; version
release **Manual**.
✔ No missing-field warnings; "Add for Review" is enabled.

**P13. Submit — only after BOTH gate steps are deployed and verified (all five tokens of §1, incl. `app-no-gtm` after P10a; P10), `ugc-safety` is live once the §6 follow-ups are settled (Guideline 1.2 expects blocking), and D5 is settled.** Before pasting the review notes, confirm `support@eno.forum` receives mail (Play lists the same address). If the account
is an Individual (D1's fallback), the visa application and eKYC must not show in the iOS app (5.1.1(ix)) —
that is `ios-hide-visa` (built, OFF; §1), and with it on, App Privacy "Sensitive Info" and the binary's
`PrivacyInfo.xcprivacy` `SensitiveInfo` entry go in the SAME release (Appendix B). The "five tokens" above
predate R8 and D5: `app-ai-notice` (D14, the 5.1.2(i) prompt) must be live and checked in P10 too, and with
D5 = b so must `ios-hide-visa` and `ios-hide-wallet` (D7). The App Privacy answers
("no tracking", Payment Info = payout account only) and the screenshots describe the app WITH the gates
on; today GTM loads in the app and the wallet shows, so submitting first would put false answers in
front of the reviewer. On rejection, answer in Resolution Center with the native-feature list and the fix per
cited guideline — never build native screens in reply (the phase-2 rule); take it to the owner. Every
re-upload bumps `CURRENT_PROJECT_VERSION`. After approval release manually and check the VN and US
storefront listings.

---

## 5. Bucket 3 — owner decisions (recommendation in bold)

- **D1 Apple ID, account type, legal entity (blocks P1).** Individual is fast, but with passport/ID/face
  collection it risks 5.1.1(ix), and under 3.1.5(i) only an organisation may offer a wallet. The forum
  operator is unregistered; Công ty TNHH ENO is registered but may not offer e-Visa. The entity also sets
  the seller name, the copyright line and EU trader status — and an app named "eno" that claims eno.vn
  links while rendering the visa desk puts the licensed company's brand on it (a reviewer of the shell
  commit raised this; the Android app already does the same). **Organization under the entity the lawyer
  approves; if moving before it exists, Individual with D5 = hide.**
- **D2 Guideline 4.8.** (a) Sign in with Apple (P9, ~1–2 days once the account exists) or (b) hide Google
  on iOS (`ios-hide-google`, ready now). **(b) for v1, (a) in v1.1 with Google restored.** No Apple
  button on the web for now (Services ID + a secret rotated every 6 months).
- **D3 Bundle id (permanent after the first upload).** **`vn.eno.app`** (every default already uses it);
  fallback `forum.eno.app` or `vn.eno.marketplace`. Not `eno.vn` (not reverse-DNS), not `vn.eno.ios`
  (reserved for the shelved app). Any other id also needs `APPLE_BUNDLE_ID`, `APNS_BUNDLE_ID`, Supabase.
- **D4 Category: Shopping, secondary Lifestyle** (Travel only if e-Visa leads).
- **D5 Services / e-Visa surface in the iOS app.** (a) ship as on Android (needs D1 = an eligible
  Organization + review notes naming VietKite) or (b) hide the visa application, eKYC and wallet on
  native-ios, keep the information pages. **(b) unless D1 produces an eligible Organization.** (b) is
  BUILT, OFF: visa + eKYC as `ios-hide-visa` (§1), the wallet as `ios-hide-wallet` (D7) — both must be on. An
  iOS seller asked to verify is told it is done at www.eno.forum in a web browser. It also closes a PARTNER's e-Visa product to in-app chat (VietKite: 14 active `visa-legal`
  listings on eno.forum, measured 2026-10-05 — its chat is where it takes the application); the listings
  stay visible in browse — hiding them too is the owner's call. Never re-enable server-side after approval.
- **D6 iPhone-only for v1: yes** (done; iPad support can be added later, never removed).
- **D7 Wallet: hide in the iOS app for v1** (`ios-hide-wallet`). The "Test environment / Add 10 test USD"
  button must never reach a reviewer either way.
- **D8 Terms.** Ask the lawyer for a zero-tolerance clause on objectionable content and abusive users and
  a 24-hour response commitment (today: 3 working days). The Terms need 5 days' notice — **start now**.
- **D9 Content rights (5.2.2).** Written permission exists only for Mioto and BonbonCar; rentals,
  electronics and furniture are 98–100% linked third-party listings. (a) get permission, (b) exclude
  unlicensed sources in the iOS app, (c) accept the risk. **Owner's call; (c) is a real exposure** — and
  the App Store Connect content-rights answer must be truthful.
- **D10 Home-screen name: keep "eno"** (store name "Eno Marketplace").
- **D11 EU storefronts: exclude for v1** unless a DSA trader address/phone/email can be published.
- **D12 Age rating: Advertising Yes, Social Media No, override to 18+.**
- **D13 Linked listings lead the feed (4.2.2).** **Lead with first-party content in screenshots and notes,
  keep the feed for v1**, revisit if 4.2.2 is cited.
- **D14 Chat auto-translation (5.1.2(i)): a one-time notice with an opt-out** (R8, built as `app-ai-notice`,
  OFF — §1, §6). Both apps, not only iOS (the token's `app-` prefix; Play's disclosure duty is the same).
- **D15 Version 1.0.2** (done). **D16 One iOS app only** — never a second near-identical eno.vn app (4.3(a)).
- **NEW — which gates to switch on, and when.** The table in §1 is ready; switching is a prod env write
  plus a deploy, and the screenshots are re-captured after it.

---

## 6. Bucket 1: what is left, and the follow-ups on what was built

**R3 blocking — built (`52c17e4d8`), OFF.** Design choices worth knowing:
- Moderators are told through the **Feedback queue** (`/admin/feedback`), not a `Report`: an open
  Report against a profile makes `eraseAccount` refuse that user's OWN deletion (`under_review`), so
  being blocked would have cost them their deletion right until an admin acted.
- The eno team (ADMIN_EMAILS) can neither be blocked nor block — it owns the e-Visa desk and imported
  shops; any such row is void.
- Reviews are deliberately NOT gated by a block: that would let a seller veto a buyer's post-sale
  rating. The transaction rule and Report bound reviews.

Settle before switching `ugc-safety` on (reviewer findings recorded in the commit):
1. Copy for a `blocked` 403 on offer accept and on the phone reveal (today: the generic error).
2. The blocked party keeps a thread whose sends are refused, with a toast — enough for Apple; a
   "conversation closed" banner would be kinder.
3. `GET /api/blocks` returns the blocked profiles' ids to the blocker; an opaque handle would be tighter.
4. A block → unblock loop files a moderator note each time (bounded by the 30/h bucket); dedupe per pair.
5. The moderator note links `/messages/<id>`; admins read non-desk threads through the dispute tools.

**Still not built:**
- **R5 — Report on help-centre comments and on seller reviews; a word filter on chat, reviews and
  help comments.** The report half is mechanical (`/api/forum/reports` exists; reviews need a report
  target). The filter changes what every user can send on both sites — owner sets how strict and what
  happens to a hit (refuse, hold, or flag). Ship behind a new token.
- (R8 is built — see "R8 and D5 — built" below.)
- ⚠️ Until R5 ships, the USER-GENERATED CONTENT paragraph of the review notes must not claim a word
  filter or reporting on reviews and help comments.

**R8 and D5 — built (branch `build/ios-appstore-prep-b`), OFF.** Tokens `app-ai-notice` and `ios-hide-visa`
(§1 table; `src/lib/chat-translation-consent.ts`, `src/lib/ios-hide-visa.ts`). Choices worth knowing:
- **R8 asks in BOTH apps.** Chat messages go to Microsoft Azure AI Translator (`translateBatch` asks it
  first for chat; the self-hosted box model is the fallback). The gate stops the REQUEST, not just the
  result: `useChatTranslation` is the only caller of `POST /api/messages/translate`, and it sends nothing
  until "OK". The answer lives on the DEVICE (`chat-tr:consent:<profile>`), because no server-side
  translation preference exists — per-user prefs are Profile columns, and a new column needs the DDL flow
  in CLAUDE.md before any deploy (a Prisma column ahead of its DDL breaks every Profile read). So a new
  device asks again; a Profile column + route is the follow-up if the owner wants it to follow the account.
  "Turn off translation" stops THIS user's requests; the other person's own setting still decides whether
  what this user sends is translated for them — the notice and the Settings row say so (codex + opus, review:
  a promise to stop more would be false). Making the opt-out cover a person's OWN messages needs the server to
  know it: a Profile column (DDL flow first, CLAUDE.md), read by `POST /api/messages/translate` to skip an
  opted-out sender's rows — the follow-up if the owner wants it.
- **One answer for every chat in the app** (this account on this device — the web and another phone do not
  know it, and the notice says "in this app"), shown the first time a chat has an incoming message to
  translate; before that the "Translate messages" strip is not shown ticked. A change in Settings applies to a
  thread that is already open. Settings shows OFF until permission is given (a switch that said ON before anyone
  was asked claimed a consent that did not exist). With the gate on, eno.forum's /privacy adds that the apps
  ask before chats are first translated. The notification bell renders an offer's note through `<Tr>`, i.e.
  machine-translates it via `/api/translate`; under the gate it shows the note as written until "OK".
  ⚠️ Pre-existing, with the gate
  OFF and on the web: that `<Tr>` path sends offer notes (private chat text) to Microsoft and stores the
  result in the SHARED translation cache — worth fixing for everyone (render user-authored notification text
  without `<Tr>`, or through the private chat endpoint).
- **D5 hides the APPLICATION, not the topic.** Kept in the iOS app: `/vietnam-evisa/official-process`,
  `/moving-to-vietnam`, `/first-month-in-vietnam`, the non-government disclosure on every e-Visa page, the
  verification hub's status, a read-only view of an existing e-Visa chat. Gone: every start/continue/pay
  step, the KYC camera, the business-document upload (its "Business / ID document" takes a person's ID).
- **Partner e-Visa products count.** An e-Visa product = the visa slot (`services/visa-legal`) plus an
  e-Visa chip (`visaEntryType`/`visaSpeed`; `src/lib/evisa-listing.ts`) — VietKite's 14 live listings
  carry both. Work-permit / tax / legal listings in the same slot are untouched. The listings still show in
  browse and search in the iOS app; only contacting them is closed there (owner's call to hide them too).
- **A partner thread begun on the web** is read-only for the applicant in the iOS app too: the thread payload
  carries `eVisaProduct` for the applicant in the iOS app with the gate on, and the page treats it like a desk
  thread.
- **The send route enforces the read-only thread:** `POST /api/conversations/[id]/messages` refuses the
  APPLICANT's write from the iOS app into an e-Visa thread (bound to an application, a desk product, or a
  partner's e-Visa product), failing closed if it cannot classify the thread. The SELLER side — the partner
  answering, or the desk — keeps an ordinary thread and composer in the app.
- The backstop lets DELETE through (removing one's own draft or document captures nothing). Its route list is
  `src/lib/ios-hide-visa-api.ts`, imported only by the proxy and empty on the marketplace build, so no e-Visa
  route name enters a client chunk; the send route's thread check is `src/lib/ios-hide-visa-server.ts`.
- `/services-for-expats-vietnam` keeps its CTA and grid in the app: they are every service, not only
  e-Visa, and its e-Visa cards lead to product pages that are gated.

---

## 7. Risks the prep cannot remove

- **4.2 / 4.2.2 — a WebView of the live site, much of it linked listings.** Mitigate: push + universal
  links live before submission (P7/P8), quick actions fixed (done), native features in the notes,
  first-party flows first in the screenshots. If 4.2 is still cited, the owner decides — the phase-2
  rule forbids rebuilding screens natively.
- **2.3.1 / 2.5.2 — every web deploy changes the reviewed app.** No payments, wallet or hidden surfaces
  switched on by server flag after approval without a new submission.
- **5.2.2** — see D9. **Bundle id** — whether a paid team can register `vn.eno.app` is unproven.
- **Google sign-in on iOS** (if kept) has never run end to end; SFSafariViewController shows "Open in
  eno?" when the custom-scheme return fires.
- **Reviewer path** — Turnstile may challenge the password step; the demo account is erased if the
  reviewer tests deletion (the notes ask them not to).
- **SDK drift** — UIScene support (`SceneDelegate`) and Capacitor 8.5.x are needed before building with
  the next major SDK (TN3187); Xcode 26.5 is fine for v1.

---

## Appendix A — store text (re-count after any edit)

**Name (30):** `Eno Marketplace` (15). Fallback `Eno Marketplace Vietnam` (23).

**Subtitle (30):** `Rentals, jobs & second-hand VN` (30). Alternative `Vietnam rentals, jobs & used` (28).
Optional Vietnamese: `Thuê nhà, việc làm, đồ cũ` (25).

**Promotional text (170):** `Apartments and motorbikes to rent, English-teaching jobs, and used phones and laptops from local second-hand shops. Chat with sellers in English or Vietnamese.` (159)

**Keywords (100 bytes):** en-US
`vietnam,expat,apartment,motorbike,scooter,teacher,english,saigon,hcmc,hanoi,used,phone,laptop,rental`
(100; `esim` is left out on purpose — it advertises a partner service, so it may only replace `rental`
once D1 names an entity allowed to offer it). Optional vi: `căn hộ,thuê nhà,xe máy,đồ cũ,việc làm,giáo viên,điện thoại,laptop,nước ngoài` (100 —
exactly the limit, and only in NFC; paste from a source that keeps precomposed letters).
Re-count with `python3 -c "print(len('…'.encode()))"`.

**Description** — re-check every claim against the live site. The block below is safe to paste as it
stands; the two add-ons after it are services the licensed marketplace (Công ty TNHH ENO) may not offer,
so add each only when its decision allows it.

```
eno is the app for expats, newcomers and locals in Vietnam: find a place to rent, a motorbike for the month, a job, or a good second-hand deal, and talk to the other side directly.

RENT
• Apartments, houses, rooms and offices, with photos, size, bedrooms and the ward on a map
• Motorbike, scooter and self-drive car rentals from local shops

WORK
• Jobs in Vietnam, including English-teaching roles across the country

BUY AND SELL USED
• Second-hand phones, laptops and cameras from local shops and individual sellers
• Furniture, home appliances, fashion and baby gear
• Post a listing with photos from your phone in a minute. No listing fees.

BUILT FOR TRUST
Every seller has a public trust score built from real evidence, not stars alone. Business sellers can verify their registration. Every listing and profile has a Report button, and reports are reviewed by a person. Trust scores can't be bought, and sponsored items are labelled Ad.

CLEAR PRICES
Prices are in Vietnamese đồng with a US dollar reference. Make an offer in the chat and agree the deal directly with the seller. eno never takes payment for marketplace items.

YOUR LANGUAGE
The whole app works in English and Tiếng Việt, and listings can be read in nine more languages.

Search by city and district, see listings on a map, and save favourites for later.

You must be 18 or older to use eno. Terms: https://www.eno.forum/terms · Privacy: https://www.eno.forum/privacy
```

Add-on — only if D1 names an entity allowed to offer these (insert after BUY AND SELL USED):

```
SERVICES FOR NEWCOMERS
• Travel eSIMs, company set-up and other services, each provided by a named, licensed partner
• Free trip planning: build an itinerary, save the places you like, and ask for help with bookings
```

Add-on — only if D5 = a (the visa desk ships in the iOS app; insert after SERVICES FOR NEWCOMERS):

```
VIETNAM e-VISA HELP (INDEPENDENT, NOT GOVERNMENT)
eno is not a government agency and is not affiliated with, endorsed by or acting for the Government of Vietnam, the Ministry of Public Security or the Immigration Department. e-Visa assistance in the app is provided by VietKite, a licensed Vietnamese travel company; eno passes your request on. Official source: the Immigration Department's e-Visa portal, https://evisa.gov.vn, is the only place a Vietnam e-Visa is issued, and you can always apply there yourself. Approval, refusal and processing time are decided only by the Vietnamese authorities.
```

**App Review notes** — the base block states only what is live today; append each add-on below it only
when its condition is true at submission (§6 lists what is built, what is gated, and what is not built).
⛔ Not before D5 is settled: today the app shows the visa desk, which the base block does not mention. With
D5 = a add the e-VISA add-on; with D5 = b the notes are truthful only once `ios-hide-visa` (built, OFF) is live.

```
WHAT THE APP IS
eno is a classifieds marketplace for Vietnam (rentals, jobs, second-hand goods). The app renders our service www.eno.forum inside a native shell.

SIGN-IN
Browsing needs no account. Posting, chat and saved items need one. Use the demo account below: on the Account tab tap Sign in, enter the demo email, then tap "Use a password". (Ordinary users get an emailed one-time code; the demo account has a password so review does not depend on an inbox.) To test account deletion, please create a separate account with any email address rather than deleting the demo account.

NATIVE FEATURES
Camera and photo library for listing photos and videos; location for "near me" search; home-screen quick actions (Post, Messages, Saved); share sheet; haptics; pull to refresh; offline page with retry; Dynamic Type text size.

ACCOUNT DELETION
Account > Settings > Danger zone > Delete my account. Also documented at https://www.eno.forum/account-deletion.

USER-GENERATED CONTENT
Every listing, seller profile and conversation has a Report control; reports go to a human moderator. A publish gate holds listings with banned content. Contact: support@eno.forum.

PAYMENTS
The app sells no digital content. Marketplace deals are agreed and paid directly between buyer and seller.
```

Add-ons, each only when true:

```
[D2 = b, ios-hide-google live] The iOS app offers only eno's own sign-in (email code / password); no third-party login is offered on iOS.
[D2 = a] Sign in with Apple is offered alongside Google.
[P7/P8 live] Push notifications for messages and offers; universal links for eno.forum listing links (and eno.vn, if approved).
[ugc-safety live] Users can block any other user from the chat header or their storefront; blocking also notifies our moderators.
[R5 built and live] Reviews and help-centre comments have a Report control, and a word filter holds messages, reviews and comments with banned content.
[D8 — only once the Terms say so] We act on objectionable content within 24 hours.
[D1 allows partner services] Partner services (eSIMs, company set-up) are real-world services fulfilled outside the app; payment is arranged with the partner in chat.
[D5 = a] e-VISA: eno is not a government service. The e-Visa page names VietKite as the licensed provider (e-Visa assistance is a real-world service fulfilled outside the app) and links the official portal https://evisa.gov.vn.
```

## Appendix B — App Privacy answers (mirror of `PrivacyInfo.xcprivacy`)

All "Linked to the user" except Diagnostics; none "Used to track you" (no ATT prompt: analytics and
advertising are forced off for the `EnoNativeApp` user agent in `src/lib/consent-value.ts`; switch on
`app-no-gtm` so the GTM container stops loading too).

| Category | Types | Purposes |
|---|---|---|
| Contact Info | Name, Email Address, Phone Number, Physical Address | App Functionality |
| Financial Info | **Payment Info** (a seller's payout bank account number) | App Functionality |
| Location | Precise (map, "near me", lat/lng at 3 decimals), Coarse | App Functionality |
| Sensitive Info | religion (visa form), biometric (eKYC face) — **only while visa/eKYC show (D5)**; the binary's `PrivacyInfo.xcprivacy` declares it too, so drop BOTH in the same release that switches `ios-hide-visa` on | App Functionality |
| User Content | Emails or Text Messages (chat), Photos or Videos, Customer Support, Other User Content (listings, reviews, help posts) | App Functionality |
| Search History | Search History | App Functionality, Analytics (first-party) |
| Identifiers | User ID | App Functionality |
| Purchases | Purchase History (service and e-Visa orders) | App Functionality |
| Usage Data | Product Interaction | App Functionality, Analytics, Product Personalization |
| Other Data | passport / government-ID details, date of birth | App Functionality |
| Diagnostics | Other Diagnostic Data (CSP violation reports) — **Not linked** | App Functionality |

Deviations from the 2026-10-04 plan, each from review or measurement: the payout bank account is
**Payment Info**, not Other Financial Info (Apple's definition names bank account numbers); chat is
declared as **Emails or Text Messages**; CSP reports are declared. ⚠️ The plan's "Payment Info = No"
does not hold: the payout form collects an account number, and Crossmint is configured on eno.forum.

## Appendix C — Age rating

| Question | Answer |
|---|---|
| Parental controls / age assurance | No / No |
| User-generated content | Yes |
| Messaging and chat | Yes |
| Advertising | Yes (partner promos and AccessTrade items labelled "Ad") |
| Social media | No (D12) |
| Unrestricted web access | No (allowNavigation is first-party only; external links open Safari; the in-app Safari sheet opens only Google sign-in (where Google is offered) and, with `app-signin-tidy`, the first-party Terms / Privacy pages — it has no address bar; re-check this answer if anything else ever opens in it) |
| Mature, medical, sexual, violence, gambling, contests, loot boxes | None / No |
| Alcohol, tobacco, drugs | None, unless food-drink listings carry alcohol — then "Infrequent" |

Then **Override to Higher Age Rating → 18+**: Apple requires the override when the EULA's minimum age
(18 in the Terms) is above the calculated rating; it also matches Play's 18+ audience.
