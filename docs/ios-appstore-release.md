# Shipping the iOS app to the App Store

The Capacitor app at the repo root (`capacitor.config.ts`, `ios/`) — the same shell as the Android app
on Google Play, rendering the live **https://eno.vn** in a WebView. Written 2026-10-04 against a
built and archived binary; moved to eno.vn and the paid team on 2026-10-06. §2–§3 quote commands that were
run (each record is dated; anything before 2026-10-06 ran against the old origin); §4 is the release
checklist — ✅ done, ⏳ next, ⛔ HOLD — with the exact commands.

⛔⛔ **BOTH APPS RENDER eno.vn — OWNER DECISION D18, 2026-10-06 ("ship both with eno.vn").** iOS v1 (1.0.3) and
Android v5 (versionCode 5 / 1.0.3) load `https://eno.vn` — the apex; `www.eno.vn` 308s to it. eno.forum never
renders in either: `allowNavigation` = `eno.vn` + `www.eno.vn`, and every forum link opens the system browser. The
seller is Eno Company Limited (Công ty TNHH ENO), the licensed eno.vn company, so its apps send no one to eno.forum,
where eno's own e-Visa desk, itinerary and services pages live. The 2026-09-08 reason for the forum — eno.vn's
statutory "not yet officially launched" banner — is void: off since 2026-09-16 (`src/lib/site-legal.ts`
`PRELAUNCH_BANNER = false`).
⛔ **e-VISA STAYS IN BOTH APPS — OWNER DECISION D19, 2026-10-06** — as the seller VietKite's service, photos-only
(§1, "e-Visa in the apps"). `ios-hide-visa` stays OFF; identity verification (ID + selfie) is web-only on iOS under the
new token `ios-hide-kyc`.
⚠️ Anything below dated before 2026-10-06 that says `www.eno.forum` describes the origin the app HAD (the §2
simulator records, the deep-link table, the 2026-10-04 gate verification) — re-run it on eno.vn before relying on it.

⛔ **THIS IS NOT `apps/ios`.** That SwiftUI app is shelved (owner: "only through Capacitor; native we do
later"); `docs/ios-appstore-readiness.md` describes it and is history for this release.

⛔ **MOST CHANGES ARE NOT APP STORE RELEASES.** The WebView loads the live site, so a product change
reaches installed apps the moment the site deploys. A new binary is needed only when the NATIVE shell
changes — a plugin, an Info.plist key, the privacy manifest, an entitlement, an icon. The flip side:
every web deploy changes the iOS app WITHOUT review (Guideline 2.3.1) — never switch on payments, the
wallet or a hidden surface after approval without a new submission that discloses it.

---

## State (2026-10-06)

| | |
|---|---|
| Apple account | Organization **Eno Company Limited**, Team ID **`DTP9SKVFMQ`**, account holder Apple ID `alex@eno.vn`. Free Apps Agreement active |
| Bundle id | **`vn.eno.app`** (D3) — registered on the team by the first signed build (device "Alex" registered; dev cert "Apple Development: Babakulyyev Shanazar (7M9H4V6JQF)"). Permanent |
| App Store Connect | app **"Eno Marketplace"**, Apple ID `6819638569`, Company Name "ENO Company Limited" (permanent), SKU `eno-ios-1`, primary language English (U.S.). Price **Free**. Availability **146 countries** — all except the United States (D17), the 27 EU states (D11: no DSA trader declaration) and China mainland (no ICP). Mac and Apple Vision Pro **OFF** |
| Builds | **1.0.3 (2) uploaded 2026-10-06 21:10** by `scripts/ios-release.sh 2 --upload` (0 compiler warnings, every check passed; "Upload succeeded", App Store Connect processing) — commit "iOS 1.0.3 (2) uploaded…". The next upload must be build 3 or higher |
| Version | `MARKETING_VERSION` **1.0.3** (= Android 1.0.3 / versionCode 5); `CURRENT_PROJECT_VERSION` = the last uploaded build, written by `scripts/ios-release.sh <build>` — strictly increasing |
| Devices | **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`, D6); iPads run it in compatibility mode |
| Minimum iOS | **16.4** — the live site is Tailwind v4 = WebKit 16.4+ (was 15.0; `scripts/ios-release.sh` checks it) |
| Toolchain | **Xcode 26.x only** (26.5 / iOS SDK 26.5) — TN3187, §7; Capacitor 8.4 (CLI 8.5.0), 14 plugins via SPM |
| Origin | `server.url` = `https://eno.vn`, `allowNavigation` = `eno.vn`, `www.eno.vn` (since 2026-10-06; it was the two forum hosts), plus `MainViewController`'s exact-host navigation policy (§1). A Vietnamese user's app opens on `/vi` (the banner's rule: stored choice > `lang` cookie > first supported device language; an English choice stays English) — decided in the PRE-PAINT script (`src/lib/app-home-language.ts`), before any deep link or push tap is routed |
| Signing | team `DTP9SKVFMQ` in all four `DEVELOPMENT_TEAM` lines of project.pbxproj, automatic signing; `App.entitlements` = `aps-environment` + `applinks:eno.vn` ONLY (P4) |
| Privacy manifest | 15 linked data types + CSP reports as not-linked diagnostics; **no SensitiveInfo, no PaymentInfo** (Appendix B) |
| APNs key | "eno APNs", Key ID `BQYKUSQG43`, Sandbox & Production, team-scoped — `~/eno-vault/apple/AuthKey_BQYKUSQG43.p8` (P8) |
| Android | LIVE on Play production, versionCode 4 / 1.0.2, rendering `www.eno.forum`. **versionCode 5 / 1.0.3** renders eno.vn and reaches users only through a Play upload — docs/android-play-release.md |

### Where the code is

✅ **Bucket 1 is ON main** (landed rebased, commits dated 2026-10-04/05; every gate OFF). ⛔ **Never merge or rebase
`build/ios-appstore-prep`, `-b` or `-c`** — they carry the same work under the pre-rebase ids, so a merge would
duplicate or revert it. The ids below are main's:

| Commit (main) | What |
|---|---|
| `c7fa473f1` | iOS shell — privacy manifest (FileTimestamp + full data types), forum-origin deep links, iPhone-only, 1.0.2, localized Info.plist strings, dormant entitlements template |
| `bba26b0da` | Web — App Store review gates (all OFF), push flag per platform |
| `a0d846254` | Web — block users (Guideline 1.2) behind the `ugc-safety` gate (OFF) |
| `1f279af09` | App Store screenshot pipeline from the simulator |
| `1c2d79f5c` | this runbook; `docs/ios-appstore-readiness.md` marked as the shelved app |
| `ba0a6ead1` | Web — the blocking follow-ups settled (`ugc-safety`, OFF) |
| `66e89ceee` | Web — chat translation asks before it sends (`app-ai-notice`, R8/D14, OFF) |
| `cbbeda30e` | Web — no e-Visa application or ID capture in the iOS app (`ios-hide-visa`, OFF; split 2026-10-06) |
| `a4bfcfdc2` | this runbook — `app-ai-notice` and `ios-hide-visa` |
| `d890f620e`, `210abe4fc` | Web — the notification bell never machine-translates private text (both sites, NOT a gate) |
| `ccd83bc92` | Web — Google AI asks first in the apps (`app-ai-notice`, OFF) |
| `de8a22518` | Web — the legal page the app opens in the in-app browser sheet offers no tracking (under `app-signin-tidy`) |
| `b38f46b07` | Web — Report on seller reviews and help-centre content (`ugc-safety`, OFF) |
| `e69598d21` | Web — the severe-only word filter (`ugc-safety`, OFF) |
| `373479682` | Web — a thread closed by a block shows its banner, not the iOS e-Visa note |
| `b67cf8f67` | this runbook, rebased ids |

⏳ **This change — branch `release/apps-eno-vn`, NOT on main, NOT deployed (2026-10-06).** The native half is
committed ("Apps on eno.vn, native half": team, 1.0.3, minimum 16.4, eno.vn origin, entitlements, privacy manifest, purpose strings,
exact-host policy, `scripts/ios-release.sh`, Android versionCode 5) with the build-2 bump; the web half
(the eno.vn e-Visa photos-only flow, `ios-hide-kyc`, the `document_check` question, the eno.vn-only AASA and push
rules, the Play listing, the help-centre answers) and these docs follow. ⛔ The branch is pushed for review, never
merged into `main` before W is go (W says why).
⛔ **Deploy this change's web half BEFORE the first TestFlight install and before the Play 1.0.3 upload.** Both
binaries render eno.vn, and eno.vn without it has none of the above. ⚠️ The web half carries the new e-Visa texts —
the product-page and storefront note, the /privacy partner section (DRAFT) — so its deploy waits on B1 (texts) and B2
(/privacy dating) (§5). Every review gate stays OFF in that deploy; the gate line is a later deploy (§1).

---

## 1. What changed, and why

### Native shell (`ios/`) — reaches users only through an App Store binary

- **ITMS-91053 blocker fixed.** IONCameraLib (`ion-ios-camera`, via `@capacitor/camera`) reads
  `NSURLCreationDateKey`, and its own `PrivacyInfo.xcprivacy` is never bundled (its `Package.swift`
  declares no resources for the library target). `ios/App/App/PrivacyInfo.xcprivacy` now declares
  `NSPrivacyAccessedAPICategoryFileTimestamp` with the library's reasons `C617.1` + `3B52.1`.
- **Privacy manifest = the live site's collection inside the app** — 15 linked types, none tracking, plus CSP
  violation reports as not-linked diagnostics. **No SensitiveInfo** (eno.vn's e-Visa flow asks no form — photos only,
  no religion; the portrait is not used for face matching; eKYC is web-only on iOS) and **no PaymentInfo** (payout,
  wallet and payments routes 404 on eno.vn). PurchaseHistory stays (the sale loop's record); Email Address also
  carries Developer's Advertising (eno's weekly digest, on by default). It mirrors Appendix B; change both together.
  `scripts/ios-release.sh` refuses an archive that declares SensitiveInfo.
- **Exact-host navigation policy (security, 2026-10-06).** Capacitor treats any URL whose string merely starts with
  `server.url` as the app (`starts(with:)`), and iOS injects the native bridge into every page the WebView renders —
  so `https://eno.vn.attacker.example/…` and `https://eno.vn@attacker.example/…` would have loaded inside the app
  with every plugin callable. `MainViewController` now sends every top-level http(s) navigation to a host other
  than `eno.vn` / `www.eno.vn` to the system, before Capacitor's own check; subframes (embeds, Turnstile) and
  non-http schemes (the bundled offline page, about:blank) go to Capacitor untouched.
- **Quick actions and links land on eno.vn.** `AppDelegate.swift`: on the app's own origin every link shape goes to
  `native-bootstrap.tsx`; anywhere else (offline page, about:blank) the WebView is loaded natively on
  `https://eno.vn` (a `www.eno.vn` link keeps its path, query and fragment and moves onto the apex). eno.forum hosts
  are in neither set — a forum link opens Safari. The push token callbacks
  (`didRegisterForRemoteNotificationsWithDeviceToken` / `…didFailToRegister…`) are intact. (From 2026-10-04 to 10-06
  it rebuilt eno.vn and forum-apex links onto `https://www.eno.forum`, mirroring Android `11f430d12`.)
- **Offline page and local shell return to eno.vn** — `capacitor/www/error.html` and `index.html` carry
  `ORIGIN = 'https://eno.vn'`; `scripts/ios-release.sh` checks the bundled copies.
- **iPhone-only, 1.0.3, display name "eno"** (D6, D15, D10).
- **Info.plist strings localized like Android** — `en.lproj` / `vi.lproj` `InfoPlist.strings` for the five
  usage descriptions and the three quick-action titles. Purpose strings (2026-10-06) name what each permission
  serves and no service by name: camera and photo library — a listing, your profile or shop, a search by photo, a
  report, or a photo you send to a seller in chat (that covers the e-Visa photos; a submitted string can only be
  withdrawn by a new submission); location — listings near you, your area when you post or edit a business profile,
  a place to meet in chat. The ID/selfie wording is gone (eKYC is web-only on iOS).
- **Entitlements, wired at P4 (2026-10-06):** `ios/App/App/App.entitlements` replaced the dormant template —
  **`applinks:eno.vn` only** (no forum host: a forum link must open Safari; no `www.eno.vn`: it 308s, and Apple
  fetches the AASA without following redirects) and `aps-environment`. No Sign in with Apple (D2 = b).
- **`scripts/ios-release.sh` + `ios/ExportOptions-AppStore.plist`** — signed archive, checks, upload (P6).

### Web (`src/`) — every change behind an owner switch, all OFF

`NEXT_PUBLIC_APP_REVIEW_GATES` is a comma list read by `src/lib/app-review-gates.ts`. Unset ⇒ nothing
changes on either site or in either app. A token the code being built does not know fails the build
(`next.config.ts`) — a typo, or a token added to the env before the code that defines it is deployed.

| Token | Plan | Effect when on | Decision |
|---|---|---|---|
| `ios-hide-google` | R2 | no "Continue with Google" in the iOS app (Guideline 4.8) | D2 = b |
| `ios-hide-wallet` | R6 | no Payments row in the iOS app; `/dashboard/payments` (and `/wallet`, `/payout`, which redirect there) → `/dashboard`. ⚠️ A no-op on eno.vn (the wallet is services-only, 404) — harmless in the line | D7 |
| `app-signin-tidy` | R7, R13 | both apps: no disabled "Phone · soon" strip; Terms / Quy chế / Privacy open in the in-app browser sheet | — |
| `app-no-gtm` | R11 | both apps: no Google Tag Manager container. ⚠️ A no-op on eno.vn (only the forum sets `NEXT_PUBLIC_GTM_ID`) | — |
| `site-brand-copy` | R7 | eno.forum names itself where copy hard-codes eno.vn; English /privacy stops quoting the Vietnamese placeholder. ⚠️ A no-op on eno.vn | — |
| `ugc-safety` | R3, R5 | both sites + apps — everything Guideline 1.2 asks for, on one switch. **Block** beside Report (chat header, a person's storefront), unblock in Settings → Privacy; a block refuses new threads, messages, offer accepts, the phone reveal and teacher contact shares and reads both ways, CLOSES the thread on both sides (a "conversation closed" banner replaces the composer), hides the threads from the blocker's inbox and badge, and tells moderators via `/admin/feedback` (one note per pair per day). The eno team and the shops eno lists on a business's behalf (no owner profile) cannot be blocked. **Report** on seller reviews, help-centre replies and member help posts — into the same moderation queue (Moderation → Reports → "Reviews & help"); Confirm removes the content. **Word filter**: chat messages, offer notes, reviews and help replies/posts with a SEVERE term — slurs and hate speech, sexual content involving minors, sexual solicitation, explicit threats of violence; not profanity — are refused with a bilingual reason | — |
| `app-ai-notice` | R8 | both apps: the first time a chat has something to translate, a one-time notice — "To translate your chats, messages are sent to Microsoft (Azure AI Translator)…" — with "Turn off translation" / "OK"; ONE answer for all chats on that account and device. NOTHING is requested until it is answered; "off" stops every CHAT translation request that person's app makes (no strip, no request — interface and listing text still translate as before); Settings → Preferences → Chat translation shows OFF until permission is given and turns it back on. Kept on the device (`chat-tr:consent:<profile>`) — no server-side translation preference exists (§6), so what a person SENDS still follows the other person's setting, and the notice says so. **And Google AI** (`src/lib/ai-consent.ts`): each feature family asks once before its first request — "Use Google AI for …?" with Not now / Allow (equal weight), remembered per account on the device, changeable in Settings → Preferences → Google AI. Families: eno AI (Not now = keyword answers, `ai: false`), posting help (Autofill from photo + Polish with AI), search by photo, **the e-Visa photo check (`document_check`, 2026-10-06 — Not now sends the photos to the seller unchecked)**, and trip planning (eno.forum's own; on eno.vn a partner's, GMBR — whose question is stubbed on eno.vn, so in the apps the trip AI is simply refused). Typed search never reaches Vertex AI Search from the apps (no question needed). ⚠️ Keys on `EnoNativeApp`, so it also changes the live Android app (P10a) | D14 |
| `ios-hide-visa` | D5 | **OFF, and stays OFF — D19 (the e-Visa application is in both apps).** Built; the B5 fallback if Apple rejects under 5.1.1(ix). ⛔ It ALSO hides identity capture (everything `ios-hide-kyc` does — `src/lib/ios-hide-kyc.ts`), so an env line from before the split never reopens the camera. If ever switched on, iOS app only: no e-Visa application — `/dashboard/visa` → Services (no e-Visa tab); a VietKite e-Visa product page (visa slot + an e-Visa chip) hides "Apply in chat" / the chat box; an e-Visa chat thread is read-only for the applicant (the seller side keeps its composer; each card that takes a step becomes one line, a finished e-Visa stays downloadable, nothing posted on open). Each place says the step is available in a web browser (plain text, naming no site — D18). (On eno.forum, which no app loads, the same gate also strips the `/vietnam-evisa` family's CTA and grid; those pages 404 on eno.vn.) Backstop: the proxy refuses iOS-app writes (not DELETE) to `/api/visa/applications/**`, `/api/visa/cards/**`; `POST /api/conversations` refuses an e-Visa product and the send route refuses the applicant's message into an e-Visa thread (403 `ios_app_unavailable`). Identity capture is NOT this token since 2026-10-06 — `ios-hide-kyc` | D19 — OFF |
| `ios-hide-kyc` | D5 | iOS app only: no identity or business-document capture (split from `ios-hide-visa`, 2026-10-06). `/dashboard/account/verify` → the verification hub (status kept, "Verify yourself" replaced by "Identity verification is available on our website, in a web browser: eno.vn"); the camera never opens for KYC (`KycCapture`); the business panel takes no upload ("Business verification is available …"). Plain text, no link. Backstop: the proxy refuses iOS-app writes (not DELETE) to `/api/seller/identity/**`, `/api/seller/verification/**` (403 `ios_app_unavailable`). `src/lib/ios-hide-kyc.ts` | D5 = b (eKYC) |

Push is gated per platform: `NEXT_PUBLIC_NATIVE_PUSH_IOS` / `NEXT_PUBLIC_NATIVE_PUSH_ANDROID`
(`src/lib/native-push-flags.ts`). The old shared `NEXT_PUBLIC_NATIVE_PUSH` is no longer read — it was
measured unset on both box env files. Both flags and every `APNS_*` / `FCM_*` value go in `eno-vn.env` ONLY;
`src/lib/native-push.ts` refuses to send from the services build (P8, NATIVE_PUSH_SETUP.md).

### The submission gate line

```
NEXT_PUBLIC_APP_REVIEW_GATES=ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy,ugc-safety,app-ai-notice,ios-hide-kyc
```

- ⛔ **`ios-hide-visa` NEVER** (D19). `ios-hide-wallet`, `app-no-gtm` and `site-brand-copy` are no-ops on eno.vn but
  harmless. B5 confirms the line (§5).
- **The SAME line in BOTH `/opt/eno/secrets/eno-vn.env` AND `eno-forum.env`** (OWNER-APPROVED prod write): the
  editions share one database, so a block made on one site must hold on the other, and Android installs below
  versionCode 5 still load the forum. `infra/vn-node/eno-build.sh` passes those files to the image build as the
  `buildenv` secret, which is what inlines a `NEXT_PUBLIC_*` value — so the line goes live only with a deploy
  (`infra/vn-node/eno-deploy.sh`, on the owner's "deploy"). ⛔ BOTH FILES IN THE SAME DEPLOY, after P10a's services
  pass — never one first: `ugc-safety` is enforced by whichever server handles a send, so with it only on eno.vn a
  user blocked in the app keeps messaging into the thread from www.eno.forum (one database, one thread).
- ⚠️ **Deploy the code BEFORE adding `ios-hide-kyc`** — an unknown token fails the build, and this change's web half
  is what defines it.
- ⚠️ `ugc-safety` and `app-ai-notice` go live in the SAME deploy as the held D8 legal change (`TOS_VERSION` 3 +
  `LEGAL_AMENDMENT`, with the eno.vn /privacy app-ai-notice clause — §5 D8).
- **Order matters.** The gates go live by a WEB deploy, the privacy manifest only with a binary: switch the line on
  FIRST, then submit the binary whose `PrivacyInfo.xcprivacy` and App Privacy answers match what the app then
  collects — and never switch a gate off afterwards without a new submission (the shipped declarations would be
  false).
- **Before switching it on:** build the MARKETPLACE edition with the line against a SCRATCH database — the CI recipe
  the 2026-10-04/05 runs used (`.github/workflows/ci.yml` job `marketplace-e2e`; worked helper
  `~/eno-ios-prep/p10a/build.sh` — set its `W=` to a `.env`-free worktree at the commit under test): a scratch Postgres with the schema from `npx prisma migrate diff --from-empty
  --to-schema prisma/schema.prisma --script` + `node scripts/schools-ddl.mjs`, seeded by
  `ALLOW_FIXTURE_WRITES=1 npx tsx scripts/ci-fixtures.ts`; `npm run build` with `DATABASE_URL` / `DIRECT_URL` pointing
  at the scratch DB, `MARKETPLACE_HOSTS_SERVICES=true`, the CI job's placeholder secrets and the gate line set in the
  REAL environment (it overrides `.env` — but only for the names it sets, so build in a checkout with no `.env`, e.g. a
  worktree); serve the standalone build on a spare port.
  ⛔ **Never run `preview:vn` or `preview:forum` on the default `.env` — both are the production database.** `scripts/preview.mjs` passes
  the environment through, Next loads the checkout's `.env`, and `~/eno.vn/.env` sets `DATABASE_URL` / `DIRECT_URL`
  to 127.0.0.1:5433, the prod SSH tunnel: every sign-in, chat and e-Visa photo of the check would be an unapproved
  production write (passport images into the visa tables and storage) plus a Gemini call.
  Then re-run the 2026-10-04 in-app verification below against that preview in a throwaway simulator build whose
  `server.url` points at it — REBUILT with the preview's host added to `MainViewController.appHosts` (plus
  `allowNavigation` and `cleartext`), never committed: since 2026-10-06 the compiled exact-host policy sends any other
  host to Safari, the initial load included. Never the signed 1.0.3 build — it always loads https://eno.vn. Then P10a
  on Android (the marketplace pass, and the services pass before the line goes into `eno-forum.env`), and confirm
  eno.vn's `/privacy` and sign-in render as before in a desktop browser.
  `app-signin-tidy`, `app-no-gtm` and `app-ai-notice` key on the `EnoNativeApp` user agent, so they ALSO change the
  live Android app — that is what P10a covers.
- **Check the backstop shipped:** with `ios-hide-kyc` on, an iOS-app POST to
  `https://eno.vn/api/seller/identity/challenge` answers 403 `ios_app_unavailable` — and one to
  `/api/visa/applications/start` does NOT (401 signed out: the e-Visa flow stays). Until 2026-10-06
  `src/lib/ios-hide-visa-api.ts` emptied its route lists on the marketplace build ("no iOS app ever loads eno.vn"), so
  on eno.vn the proxy refused nothing; the lists (`IOS_HIDDEN_VISA_WRITE_PREFIXES`, `IOS_HIDDEN_KYC_WRITE_PREFIXES`)
  are the same on both builds now. eno.vn compiles the real visa module (`MARKETPLACE_HOSTS_SERVICES=true` hosts
  VietKite's e-Visa chat — `/api/visa/applications` answers 401, not 404, measured 2026-10-06) and eKYC is a
  marketplace feature, so the gate must hold THERE.

Verify each one in the device pass (P10), and on the web that nothing moved (desktop Chrome on
`/signin` still shows "Continue with Google"; the form renders client-side, so curl cannot see it).

**Already verified locally, 2026-10-04 — the five non-UGC gates ON (not `ugc-safety`), in the iOS app — ⚠️ ON THE
SERVICES EDITION, the app's origin then; not yet re-run on the marketplace edition the app renders since
2026-10-06.** The services edition was built with the full five-token line (+ a dummy `NEXT_PUBLIC_GTM_ID`) against a
scratch Postgres seeded by `scripts/ci-fixtures.ts` (the CI recipe; no production data), served on :3210, and loaded
by a throwaway copy of the simulator app whose `capacitor.config.json` pointed at it (never committed). In the app:
`getPlatform()` = ios, `html.native-ios`, **no GTM script and no `dataLayer`**, **no "Continue with Google"** (the
Join prompt shows only the email form), **no "Phone · soon" strip**, and on `/signin` **Terms opened in the in-app
browser sheet** with the form left intact underneath. ⚠️ Inside the 60-second Join prompt the same link navigated the
WebView to `/terms` instead (the prompt closed) — harmless, but not the sheet; look at it before switching
`app-signin-tidy` on. The same gated build in desktop Chromium (Playwright) was unchanged: the GTM container
requested, "Continue with Google" present, the Phone strip visible, Terms with `target=_blank`. The marketplace
edition was also built with the gates OFF (the CI recipe) — see §2.
⚠️ That method no longer works with the 2026-10-06 shell: `MainViewController.appHosts` is `["eno.vn", "www.eno.vn"]`
(compiled Swift), and its policy cancels every main-frame http(s) navigation to another host — the initial load
included — and opens Safari. Editing `capacitor.config.json` inside a built `.app` copy does not touch that, so the
preview never renders and the check never runs. The throwaway must be REBUILT with the preview's host in `appHosts`
(plus `allowNavigation` and `cleartext`), never committed (§1 "Before switching it on").

### e-Visa in the apps (D19, 2026-10-06)

- **The seller VietKite's service, photos-only.** The applicant sends two photos in the chat: the passport data page
  and a 3x4 portrait (3x4 or 4x6 accepted, normalized to 4x6). A quick check runs first — eno's own checks + Gemini,
  asked first in the apps under the AI family `document_check`; "Not now" saves the photo and sends it UNCHECKED
  (`automatic_image_check_declined`, no Google call, never blocking). Then "Send to VietKite" in the chat. No form,
  no entry-date step, no payment in the app (`src/lib/visa/dm-flow.ts`: both editions run a short flow; eno.vn's is
  photos-only).
- **VietKite** gets a chat line ("📎 … Passport photo and portrait sent") and a push — for a photos-only send only,
  and never across a block (the case still waits in its queue) — and can **Mark filed** / **Cancel** the case; the
  result upload closes it (90-day deletion), and the applicant's result push speaks as the partner ("VietKite ·
  e-Visa", `src/lib/visa/result.ts` via `visaResultBrand`; never "eno e-Visa" on eno.vn — and eno.vn's bell keeps
  `visa_result` rows out, `notification-scope.ts`: the push and the chat card deliver). `src/lib/visa-admin.ts`
  `visaAdminTransitionsFor`, `submit/route.svc.ts`.
- **Seller-named note** on every e-Visa product page and the storefront: VietKite sells and handles it, eno.vn is the
  marketplace — not a government agency — and https://evisa.gov.vn is where anyone can apply themselves.
- **eno.vn /privacy** gets a partner e-Visa section (`src/lib/privacy-partner-visa-copy.ts`) — DRAFT legal text (B1).
  ⛔ **Its dating is NOT BUILT: there is no `PRIVACY_AMENDMENT`.** `src/lib/compliance/legal-amendment.ts` has only
  `LEGAL_AMENDMENT` and `REGULATIONS_AMENDMENT`; /privacy's "Last updated" reads `LEGAL_AMENDMENT.published`
  (`privacy/page.tsx`); `infra/vn-node/legal-amendment-gate.sh` knows only those two records. As it stands, W would
  ship the section under the old date with no deploy-day gate. Once B2 is answered: a record in legal-amendment.ts,
  wired into /privacy's dates and into legal-amendment-gate.sh — all before W.
- **No Eno concierge on eno.vn** — the route answers 503 `concierge_unavailable` and the chip is not rendered (its
  prompt speaks as eno, the provider). The open-case cap applies on eno.vn too (a free submission holds passport
  images).

### Measured facts this release depends on (read-only, 2026-10-04)

- Crossmint keys ARE set on eno.forum (`CROSSMINT_SERVER_SIDE_API_KEY`, `CROSSMINT_SIGNER_SECRET`
  non-empty): the wallet was live in the forum-origin app until `ios-hide-wallet`. ⚠️ Moot in the app since
  2026-10-06: `/dashboard/payments`, `/dashboard/payout`, `/dashboard/wallet` and `/api/seller/payout` are
  `.forum.svc.` routes and answer 404 on eno.vn (measured 2026-10-06), so the app shows no wallet and takes no payout
  account whatever the gate says.
- `NEXT_PUBLIC_GTM_ID` is set on eno.forum and the container loaded inside the forum-origin app
  (`!!document.querySelector('script[src*=googletagmanager]')` = `true` in the simulator). ⚠️ Moot in the app
  since 2026-10-06: `analytics-tags.tsx` renders the container only under `IS_SERVICES`, so eno.vn carries none
  (its /privacy says so) — `app-no-gtm` no longer changes either app. Confirm once in the simulator on eno.vn.
- `APPLE_TEAM_ID` is unset: `/.well-known/apple-app-site-association` answers 404 on every host (by
  design until P7).
- `NEXT_PUBLIC_NATIVE_PUSH*` unset on both editions.
- `ForumUserBlock` exists in prod with **0 rows** (`supabase-db`, read-only transaction): no legacy
  block switches on with `ugc-safety`. The `Feedback` table exists.
- (2026-10-05, read-only) `Review` 0 rows, `ForumComment` 0 rows, `Report` 4 rows — none with every target
  NULL, so no existing report reads as an R5 content case; the severe-abuse list refuses 2 of 125,528 live
  listings' texts (both genuine uses of a listed term, no collisions) and 0 of 164 chat messages.

### Not built in bucket 1, and why

- **Nothing — every bucket-1 item is built, each OFF until its switch (table above).** R3 blocking and R5
  report + word filter are `ugc-safety`; the R8 translation notice and the Google AI questions are
  `app-ai-notice`; D5 = b (eKYC only, since the 2026-10-06 split) is `ios-hide-kyc`. The open question the D5 item
  used to carry — an iOS seller the publish gate asks to verify — is answered in the app: the verification hub says
  the check is done at the build's own host in a web browser (`IosVerifyElsewhereNote` — eno.vn on the marketplace
  build). The publish-time identity gate is marketplace-only (`identityGateEnforced`, account-state.ts:
  `IS_MARKETPLACE` and `IDENTITY_GATE_ENFORCED=1` at runtime) — and since 2026-10-06 the app IS the marketplace.
  While that env is unset nothing asks; once it is set on eno.vn, an iOS seller with `ios-hide-kyc` on can publish
  only after verifying in a browser — part of D5 = b's cost, to weigh before setting it.

---

## 2. Build, archive and verify

The signed release path is `scripts/ios-release.sh` (P6) — it runs every check below on a signed archive. The
unsigned commands here need no Apple account.

```bash
# 0. ENO_LOCAL_SHELL must be UNSET — with it the app boots the local shell instead of server.url
env | grep ENO_LOCAL_SHELL            # prints nothing
npx cap sync ios                      # 14 plugins; git status shows no tracked change
plutil -p ios/App/App/capacitor.config.json | grep '"url"'   # "url" => "https://eno.vn"   (was www.eno.forum until 2026-10-06)

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

**Archive checks** (expected since 2026-10-06; the 2026-10-04 run printed 1.0.2 and minimum 15.0):

```bash
A=<out>/App-unsigned.xcarchive/Products/Applications/App.app
plutil -p $A/Info.plist | grep -E 'UIDeviceFamily|ShortVersion|CFBundleVersion"|DisplayName|NonExempt|MinimumOS' -A1
#   "CFBundleDisplayName" => "eno"        "CFBundleShortVersionString" => "1.0.3"
#   "CFBundleVersion" => "<build>"        "ITSAppUsesNonExemptEncryption" => false
#   "MinimumOSVersion" => "16.4"          "UIDeviceFamily" => [ 0 => 1 ]   (no UISupportedInterfaceOrientations~ipad)
plutil -p $A/capacitor.config.json | grep '"url"'      # "https://eno.vn"   (was www.eno.forum until 2026-10-06)
```

**Required-reason API scan** — every Mach-O in the bundle, undefined symbols only. Re-run after any
plugin bump; each symbol found must have a category in `PrivacyInfo.xcprivacy` (`scripts/ios-release.sh` compares
the scan to this expected set and refuses a change):

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
# expect {"href":"https://eno.vn/","p":"ios","cls":"… native native-ios","ua":"EnoNativeApp/1","iw":440,"sw":440}   (the 2026-10-04 run read https://www.eno.forum/, the origin then)
```

Run 2026-10-04 on an iPhone 16 Pro Max (18.4): home, a listing
(`/listings/cmtsglhxu04v3rvq4ocnmwb2f`), `/signin` and the offline page all render, `innerWidth ===
scrollWidth` on each (no zoom-out, 440 = 440). Re-run on what was then the last bucket-1 commit to touch `src/` —
before the blocking follow-ups, the bell, Google AI, reporting, the filter and the closed-thread order, so it covers
none of them — on an iPhone SE (3rd generation, 18.4): home, `/listings/cmtzgayju00fi0jrs1klz68ac` and `/signin` at
375 = 375, html carries `native native-ios`. The Debug build and the unsigned archive above were rebuilt from that same
head after a clean `npx cap sync ios` (no tracked file changed): both succeeded with 0 compiler
warnings, and the archive scan was identical. The offline page was produced with a throwaway copy of the built
`.app` whose `capacitor.config.json` pointed at an unreachable host — never committed. ⚠️ Not repeatable on the
2026-10-06 shell: an unreachable host is not in `MainViewController.appHosts`, so the load goes to Safari and the
offline page never shows. Keep the real `server.url` and cut the network instead — Network Link Conditioner (100%
Loss; on the Mac for the simulator) or airplane mode on a device.

**Deep links (R4)** — fired from inside the WebView (`location.href = 'enovn://…'`, which Capacitor
hands to `UIApplication.open`, i.e. the app's own `open url` path) and with `xcrun simctl openurl`.
⚠️ Measured 2026-10-04, when the app origin was www.eno.forum. Since 2026-10-06 every row must land on
`https://eno.vn/…` instead, and an eno.forum `?url=` must not load in the app — re-run the table before submission:

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
path — verify them on the device (P10). A swiftc harness over the resolver refused every hostile shape
(auth/signin, dot segments, `//`, `/\`, tab, userinfo, port, foreign host, enovn nesting).

### Web builds (both editions, the CI recipe) — bucket 1, 2026-10-04/05

GitHub Actions runs only for `main` (`.github/workflows/ci.yml`), so bucket 1's web half was built
locally the way CI builds it — a scratch Postgres seeded by `scripts/ci-fixtures.ts`, placeholder
secrets, `npm run build`: the **services edition with every review gate ON** and the **marketplace
edition with the gates OFF** both finished `build=0`. Full vitest, tsc and `npm run lint` (eslint,
design-, edition-, docs-lint) were green on the branch (pre-rebase ids `52c17e4d8` and `f361c7c8a`).

**Re-run 2026-10-05 on the whole branch rebased onto main `5451fa340`** (a local copy at `cce8ef322`; the rebase that
landed is the table above): tsc clean; `npm run lint` 0 errors; full vitest 773 files / 13,716 passed, 0 failed;
`npm run build` with ALL EIGHT tokens then defined on (`ios-hide-visa` still covered eKYC; `ios-hide-kyc` is new
2026-10-06) — the services edition AND the marketplace edition (`MARKETPLACE_HOSTS_SERVICES=true`, production's
setting) — both `build=0`. A curl smoke of both builds as a browser, the Android app and the iOS app: no 5xx on any
page; on eno.forum in the iOS app `/dashboard/visa` → `/dashboard/services` and `/dashboard/account/verify` →
`/dashboard/verification`, and POST `/api/visa/applications` / `/api/seller/identity/challenge` → 403
`ios_app_unavailable` (a browser: 401). With that flag on, eno.vn's bundle carries the real visa module by design
(next.config.ts), so the iOS note's sentences ship there too — they would RENDER in the app only with `ios-hide-visa`
on (OFF, D19), and they name no site (D18). NOT yet run with the 2026-10-06 line: the device passes (P10 on iOS,
P10a on Android) — before it is switched on.

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

⛔ **THE 2026-10-04 SET (6/6 certified) WAS CAPTURED ON www.eno.forum AND CANNOT BE USED.** Since 2026-10-06 the capture
requires `https://eno.vn` and `appstore-frames.mjs` refuses a manifest whose base is anything else. Re-capture the
whole set on eno.vn — after the gate line is deployed (the store images must match what the reviewer sees).

| File | Screen | Caption |
|---|---|---|
| `01-home` | home feed | Rentals, jobs and second-hand deals / In English and Tiếng Việt |
| `02-rentals-map` | Rentals › Apartment, map view | Apartments and houses to rent / Filter by district, see them on a map |
| `03-motorbike` | `/motorbike-rental-ho-chi-minh-city`, "available now" grid | Rent a motorbike or a car / From local shops, by the day or the month |
| `04-jobs` | `/c/jobs` | Jobs, including English teaching / Roles across Vietnam, in one place |
| `05-item` | used Samsung Galaxy Z Fold7 (Minh Tuấn Mobile) | Every detail before you buy / Price in đồng with dollars alongside |
| `06-shop` | Minh Tuấn Mobile storefront ("Linked shop") | Second-hand shops in one place / Used phones, laptops and cameras |

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

## 4. The release checklist (P1–P13)

✅ = done (dated) · ⏳ = next, with its command · ⛔ HOLD = do not run until its condition clears. Every prod write
and every deploy is the owner's call.

**P1. ✅ Enrolled (2026-10-06, D1).** Organization "Eno Company Limited", Team ID `DTP9SKVFMQ`, account holder
`alex@eno.vn`.

**P2. ✅ Signing on this Mac, via Xcode (2026-10-06).** Xcode → Settings → Accounts holds the team; dev cert "Apple
Development: Babakulyyev Shanazar (7M9H4V6JQF)". If a headless `xcodebuild` ever hangs at CodeSign: click ALWAYS
ALLOW on the first "codesign wants to use key …" prompt, or once, with the Mac password:
`security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db`.
✔ `security find-identity -v -p codesigning` lists the team's identity.

**P3. ✅ App ID, via Xcode (2026-10-06).** `vn.eno.app` was registered on the team by the first signed build
(automatic signing provisions the capabilities `App.entitlements` names: Associated Domains, Push). A new team needs
ONE registered device before the first archive — done (device "Alex"), with:

```bash
xcrun devicectl list devices    # → the udid
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination id=<udid> \
  -derivedDataPath <dd> -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

**P4. ✅ Repo — this change's native half (2026-10-06; second-opinion gate, literal-pathspec commit).**
- `DEVELOPMENT_TEAM = DTP9SKVFMQ` in all four places in `ios/App/App.xcodeproj/project.pbxproj`.
- `PRODUCT_BUNDLE_IDENTIFIER = vn.eno.app` on the **App target only** (two lines; never on the command line).
- `ios/App/App/App.entitlements` (the template is gone): its file reference sits in the App group by hand (not a
  synchronized group, no build phase); `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in both target
  configurations. No Sign in with Apple (D2 = b).
  ⛔ **Associated Domains = `applinks:eno.vn` ONLY** (D18). Never `applinks:www.eno.forum` / `applinks:eno.forum` —
  a forum link must open Safari, not the licensed company's app — and never `applinks:www.eno.vn`: it 308s, and
  Apple fetches the AASA without following redirects. A claim in a signed, submitted binary can only be removed by
  another submission; `scripts/ios-release.sh` refuses an archive that gets this wrong.
- `MARKETING_VERSION = 1.0.3`; `IPHONEOS_DEPLOYMENT_TARGET = 16.4` (and the SPM package's platform `.v16`);
  `PrivacyInfo.xcprivacy` (Appendix B); the purpose strings; the exact-host navigation policy (§1).

**P5. ✅ App Store Connect record (owner, 2026-10-06).** "Eno Marketplace", Apple ID `6819638569`, Company Name "ENO
Company Limited" (permanent), bundle `vn.eno.app`, SKU `eno-ios-1`, primary language English (U.S.). Pricing: Free.
Availability: 146 countries — all except the United States (D17), the 27 EU states (D11) and China mainland (no ICP).
Mac and Apple Vision Pro availability OFF — the same binary would run there, and the gates treat a Mac as iOS
(`src/lib/app-review-gates.ts`). Free Apps Agreement active.

**P6. ✅ First upload — 1.0.3 (2), 2026-10-06 21:10. ⏳ App Store Connect's processing result.**
`scripts/ios-release.sh` is the whole path (Xcode 26.x only):

```bash
scripts/ios-release.sh <build>             # signed archive + every check; nothing leaves the Mac
scripts/ios-release.sh <build> --upload    # …then export + upload to App Store Connect (TestFlight)
```

`<build>` must be ABOVE the project's `CURRENT_PROJECT_VERSION` (the last upload — so 3 next), for every upload,
rejected ones too; the script writes it into project.pbxproj — commit the bump with the release. `--upload` refuses
uncommitted native changes (`IOS_RELEASE_ALLOW_DIRTY=1` only for a throwaway). ⚠️ The check-only run writes
`CURRENT_PROJECT_VERSION` too (before it archives), so a following `<build> --upload` with the SAME number is refused
twice — the pbxproj is now an uncommitted native change, and the build is no longer above the project's number. After
a check-only run, `git checkout -- ios/App/App.xcodeproj/project.pbxproj` before uploading that number, or go
straight to `--upload`. Output:
`~/eno-ios-prep/release-builds/<stamp>-b<build>/`. Headless signing: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`
(an App Store Connect API key, Admin role — never commit the `.p8`). The checks: `ENO_LOCAL_SHELL` unset; Xcode
26.x; team, bundle id and entitlements wiring consistent; `server.url` = `https://eno.vn` and no forum host in
`allowNavigation` (source and bundle); the offline/local-shell pages return to eno.vn; build number,
`ITSAppUsesNonExemptEncryption = false`, iPhone-only, `MinimumOSVersion` 16.4; no SensitiveInfo; the five usage
strings; the signing team; `aps-environment`; exactly `applinks:eno.vn`; the required-reason scan (§2).
✔ The "has completed processing" email, with **no ITMS-91053** (R1) and **no ITMS-90078** (push
entitlement present); the build appears under TestFlight; export compliance answered automatically by
`ITSAppUsesNonExemptEncryption = false`. ⚠️ If ITMS-91053 still names IONCameraLib, Apple wants the
manifest inside the framework: vendor the package with a `resources: [.process("PrivacyInfo.xcprivacy")]`
target, or move to a version that ships one.
⛔ **No TestFlight install before this change's web half is deployed** (State).

**W. ⏳ Deploy this change's web half (owner's "deploy"; after B1 + B2, and B2's `PRIVACY_AMENDMENT` record — not
built, §5).** The deploy builds `origin/main`, so the
branch is merged and pushed first; then, on the box: ⛔ **AND THE MERGE WAITS FOR THE SAME ANSWERS.** `main` is what
EVERY deploy ships, so merging this branch before B1 + B2 means the next unrelated, authorised deploy carries the draft
/privacy section, the e-Visa notes and the apps' eno.vn routing with it. Merge only when W itself is go.

```bash
bash /opt/eno/app/infra/vn-node/eno-deploy.sh --expect=<full sha of the reviewed commit>
```

Gates unchanged in this deploy. It must precede the first TestFlight install and the Play 1.0.3 upload.

**H. ⏳ Help-centre answers (OWNER-APPROVED prod write) — after W, before P10.** The sign-in answers were corrected in
`scripts/help-center-seed.json` (2026-10-06); they reach prod only through the sync script:

```bash
set -a; . ./.env; set +a
npx tsx scripts/sync-help-center.ts --dry-run    # prints what would change, writes nothing
npx tsx scripts/sync-help-center.ts             # the prod write
```

⚠️ **Run it from a checkout at the DEPLOYED (merged) commit, with the DB tunnel up.** `sync-help-center.ts` writes
whatever the `help-center-seed.json` beside it holds (`import.meta.dirname`), so a checkout on an older commit syncs
the OLD answers back over the new ones; and the release worktree has no `.env` for the line above to source.

**P7. ⛔ HOLD — Universal links (OWNER-APPROVED prod env write).** Hold until a device test: with the app installed,
sign in on eno.vn in Safari with an emailed code (and with Google) — if the app opens mid-redirect (the AASA's `/*`
claim can take the post-sign-in 307 that `authRedirect` in `src/lib/auth-finish.ts` issues), fix `authRedirect` first.
⚠️ OPEN: the claim acts only once eno.vn serves the AASA — which is P7 itself — so decide how that test runs before
releasing the hold. One option: the route's `APPLE_BUNDLE_ID` override (`src/app/api/well-known/aasa/route.ts`,
"overridable so a TestFlight/dev bundle can be associated") can associate a THROWAWAY dev bundle on team
`DTP9SKVFMQ` — `APPLE_TEAM_ID=DTP9SKVFMQ` + `APPLE_BUNDLE_ID=<the dev bundle>` in eno-vn.env (an owner-approved env
write + recreate) — and a development-signed build of that bundle carries `applinks:eno.vn?mode=developer` (the
device then reads the AASA from eno.vn itself, not Apple's CDN; Developer Mode and Settings → Developer → Associated
Domains Development on). The post-sign-in 307 is then tested without the production `vn.eno.app` ever claiming
eno.vn; afterwards the env goes back to unset (or to the values below) — Apple's CDN can keep serving the dev
association for hours, so finish it well before the real P7. Owner's pick: ⏳ OPEN — record it here.
When released: `APPLE_TEAM_ID=DTP9SKVFMQ` in `/opt/eno/secrets/eno-vn.env` ONLY (D18 — the app claims
`applinks:eno.vn` alone; the route answers 404 on the services edition whatever its env says, so `eno-forum.env`
gets nothing). `APPLE_BUNDLE_ID` stays unset while the bundle id is `vn.eno.app` (the route's default). The route
reads the env per request (`force-dynamic`), so no rebuild — it takes effect when the `eno-vn` container is recreated
(a brief eno.vn restart):

```bash
docker compose -f /opt/eno/app/infra/vn-node/apps.compose.yml up -d --force-recreate eno-vn
```

Do it BEFORE installing a build that should open links: the device asks Apple's CDN at install, and a 404 it was
handed lingers.
✔ `for h in eno.vn www.eno.vn www.eno.forum eno.forum; do curl -s -o /dev/null -w "$h %{http_code} %{content_type}\n" https://$h/.well-known/apple-app-site-association; done`
→ `eno.vn 200 application/json` with `appIDs` = `["DTP9SKVFMQ.vn.eno.app"]`; `www.eno.vn 308` (not
claimed — it redirects); both forum hosts `404`. A lingering 404 on eno.vn is a Cloudflare cache (purge)
or a container that was not recreated. Then `curl -s https://app-site-association.cdn-apple.com/a/v1/eno.vn`
serves the same JSON (Apple's CDN can lag hours).

**P8. ⏳ Push via APNs (OWNER-APPROVED env + DDL)** — follow `NATIVE_PUSH_SETUP.md`, IN THIS ORDER. The key exists
(✅ "eno APNs", `BQYKUSQG43`). (1) The `NativePushToken` table via the safe DDL flow in CLAUDE.md, never
`prisma db push` (decide its FK first — NATIVE_PUSH_SETUP.md step 4; if that decision edits `prisma/schema.prisma`,
the deploy in (3) is refused unless it carries `SCHEMA_OK=<full sha>`). (2) Then `APNS_*` in
`/opt/eno/secrets/eno-vn.env` **ONLY** (base64 the key — docs/apns-setup.md; `APNS_PRODUCTION=true`, never toggled)
and recreate `eno-vn` — never before the table: from that recreate on, every `sendPushToProfile` queries it
(`native-push.ts`), and a missing table throws, caught and logged on every offer or enquiry push. (3) Then
`NEXT_PUBLIC_NATIVE_PUSH_IOS=1` **last**, in `eno-vn.env` only — never in `eno-forum.env` — and deploy. Android stays
off (no `google-services.json` — NATIVE_PUSH_SETUP.md §2).
✔ On TestFlight (`APNS_PRODUCTION=true`), the owner's own device: sign in → permission prompt → a `NativePushToken`
row → **an offer** from a second account notifies (plain chat messages never push) → tapping it opens the right page.

**P9. Sign in with Apple — only if D2 = a** (else v1.1). Native id-token flow:
`@capacitor-community/apple-sign-in` (confirm SPM + Capacitor 8 support, or a small local
`ASAuthorizationController` plugin — an auth bridge, not a re-implemented surface) →
`supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })` behind a native-ios button. Must
haves: a new Apple user goes through the same provisioning/onboarding as `/auth/callback`; register the
sending domains with Apple's private email relay; revoke the Apple token in `eraseAccount`; add the capability to
`App.entitlements` (a new binary).
✔ New Hide-My-Email user gets a profile and an email; a returning user signs in; deleting the account
removes it from Settings → Apple ID → Sign in with Apple.

**P10a. ⏳ Android pass BEFORE the gate line goes live (no Apple account needed).** On the Android emulator, in a
throwaway debug app (`android/`; only generated, gitignored files change — `server.url`, `cleartext`,
`allowNavigation` → the preview, as on 2026-10-05) against a MARKETPLACE preview built with the full gate line on a
SCRATCH database — the recipe in §1 "Before switching it on". Never the signed 1.0.3 build: it always loads
https://eno.vn. ⛔ **Never `preview:vn` or `preview:forum` on the default `.env` — both are the production database:** this pass signs in,
chats between two accounts and starts an e-Visa application with photos, and every one of those would be a production
write (passport images into the visa tables and storage, a Gemini call) that nobody approved. The CI recipe's auth
and storage are placeholders: signed-in screens need a stubbed session (as on 2026-10-05), and the real email-code /
Google round trips wait for the internal-track install. Check:
`/signin` has no "Phone · soon"; Terms / Quy chế / Privacy open in the in-app sheet and close back onto
the form, also from inside the 60-second "Join eno" prompt (it must survive); no `googletagmanager.com`
request (chrome://inspect → Network); "Continue with Google" still offered (Android keeps Google); the
`app-ai-notice` questions appear (chat translation, Google AI, the e-Visa photo check).
⏳ **And a SERVICES pass, before the line goes into `eno-forum.env`.** The same eight-token line goes there (§1), and
Android v4 / 1.0.2 installs keep loading www.eno.forum until they update. The 2026-10-05 services run below covered
only the five step-1+2 gates — not `ugc-safety`, `app-ai-notice` or `ios-hide-kyc`. Re-run it on a scratch-DB
SERVICES preview with the FULL line (the same recipe, services edition — `NEXT_PUBLIC_ENO_EDITION=services`,
`NEXT_PUBLIC_APP_URL=https://www.eno.forum`, no `MARKETPLACE_HOSTS_SERVICES`, and a dummy `NEXT_PUBLIC_GTM_ID` as on
2026-10-05, or the no-GTM check passes vacuously; never `npm run preview:forum`), in a throwaway debug build of the v4 shell
pointed at it: the step-1+2 checks again, plus Block / Report / the word filter (`ugc-safety`), the `app-ai-notice`
questions, and `ios-hide-kyc` changing nothing on Android.
✅ **RUN 2026-10-05 against a scratch SERVICES preview with the five step-1+2 gates (throwaway debug app on
the `eno_pixel` emulator; evidence `~/eno-ios-prep/p10a/evidence-index.txt`):** no "Phone · soon" (EN/VI);
Terms / Operating regulations / Privacy / Quy chế open the Custom Tab and close back onto the form with the
typed email (and a half-typed code) intact; from inside the "Join eno" prompt too — the prompt survives
(the iOS note in §1 does not reproduce on Android); 0 of 1,381 WebView requests to googletagmanager /
google-analytics / doubleclick while desktop Chromium on the same build requested `gtm.js?id=GTM-TEST000`;
"Continue with Google" still on Android; `/dashboard/payments` redirects only for the iOS app UA. Not
runnable locally: the real email-code and Google round trips (placeholder auth backend). Re-run on the marketplace
edition with the full line.
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

**P10. ⏳ Device pass — after W, H and the gate line.** Two builds, because **Safari's Web Inspector cannot attach to
a TestFlight (Release) build**: Capacitor makes the WebView inspectable only in Debug (`ios/debug.xcconfig`
`CAPACITOR_DEBUG = true`).
- **TestFlight build (the owner's device; the owner installs it) — the functional checks.** Images load; an eno.vn
  universal link tapped in Notes opens the right page once P7 is live, `/signin` and `/auth*` stay in Safari, and a
  www.eno.forum link — from Notes AND from inside the app — opens Safari (the forum never renders in the app);
  quick actions warm AND cold; camera + photo picker; push (P8). With the gates on: no Google on `/signin`, no
  Payments row, no "Phone · soon", Terms opens in the sheet and closes back onto the form; with `ugc-safety` (⛔ PRODUCTION: only between the two test accounts and on content they
  wrote — the second account's storefront, plus a review and a help reply posted for this test. Confirm DELETES the
  content and notifies its author, so never Report-and-Confirm a real member's review, reply or post; delete anything
  a severe-term test manages to post): Block
  from a chat header and a storefront, the other account sees the "conversation closed" banner and can no longer send
  there, the thread leaves the inbox and badge, the note appears in `/admin/feedback` (once, even after unblock +
  block), Unblock in Settings → Privacy restores it; Report a review on a storefront and a reply in /help → both
  cases appear in Moderation → Reports → "Reviews & help", Confirm removes the content and its author gets a notice;
  a chat message, a review and a help reply containing a listed severe term (e.g. "I will kill you") are refused
  with the bilingual reason and nothing is posted. ⚠️ A Google-created account must be able to sign in with an
  emailed code on iOS (`ios-hide-google`) — try one before submitting. With `ios-hide-kyc`:
  `/dashboard/account/verify` lands on `/dashboard/verification`, which says verification is done in a web browser
  at eno.vn and opens no camera; Settings' business panel shows the line instead of its two uploads; the same
  screens on the Android app are unchanged. With `ios-hide-visa` OFF (D19) the e-Visa flow WORKS: a VietKite e-Visa
  product page offers "Apply in chat", the thread asks for the passport data page and the 3x4 portrait (camera and
  photo library), the `document_check` question comes first, the check runs (or "Not now" sends unchecked), and
  "Send to VietKite" lands a line in VietKite's inbox; Services has its e-Visa tab.
  ⛔ **On this production build "Send to VietKite" files a REAL case with a real partner:** the tester's passport
  data page and portrait go to VietKite, a chat line lands in its inbox and VietKite gets a push
  (`submit/route.svc.ts`) — and VietKite's job is to prepare the application and file it with the authorities. Agree
  the test with VietKite beforehand, or stop at the "Send to VietKite" button (Appendix A: sending is optional for
  review). If you do send, cancel the case right afterwards (an applicant cancel — the `cancel` action of
  `POST /api/visa/applications/<id>/submit`; the app shows no button for it — sets 30-day retention; VietKite's
  Cancel, 90 days). Only the tester's own documents, with consent.
- **Debug device build — the network checks.** Build and install it on the same device (same bundle id, so it
  replaces the TestFlight install — reinstall from TestFlight afterwards):

  ```bash
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination id=<udid> \
    -derivedDataPath <dd> -allowProvisioningUpdates build
  xcrun devicectl device install app --device <udid> <dd>/Build/Products/Debug-iphoneos/App.app
  ```

  Then Safari → Develop → the device → the WebView → Network: no `googletagmanager.com` request (also on the Terms
  sheet's page, with no consent prompt there); with `app-ai-notice` (two accounts whose app languages differ),
  opening the chat shows the notice and there is NO `/api/messages/translate` request until OK, and an offer's note
  in the notification bell is shown as written (no `/api/translate` request for it); "Turn off translation" removes
  the strip and sends nothing; Settings → Preferences → Chat translation turns it back on. ⚠️ A Debug build gets a
  SANDBOX push token — test push on TestFlight (P8), not here.

**P11. ⏳ Reviewer account (OWNER-APPROVED prod write).** App Review needs an **@eno.vn demo seat** (e.g.
`app-review@eno.vn`), partner-flagged so "Use a password" works — not `play-review@eno.forum` (that stays Play's
seat). ✅ BUILT 2026-10-07: `scripts/register-play-reviewer.mjs --for=apple` (seat table `scripts/review-seats.mjs`;
credentials to `.env.app-review.local`, never printed) and `scripts/seed-app-review-thread.mjs` (the demo thread).
Once it exists:

```bash
node --env-file=.env scripts/register-play-reviewer.mjs --for=apple            # dry run
node --env-file=.env scripts/register-play-reviewer.mjs --for=apple --apply
node --env-file=.env scripts/set-official-partner.mjs <sellerId printed above> --apply
```

Then `node --env-file=.env scripts/seed-app-review-thread.mjs` (dry run, read-only) and `node --env-file=.env scripts/seed-app-review-thread.mjs --apply --gate=off` (only
while production does not enforce `IDENTITY_GATE_ENFORCED` — unset on 2026-10-07): a NON-staff counterpart
`app-review-seller@eno.vn` ("Demo seller (App Review)") owning one demo listing created **SOLD** — its page opens and
the thread's Block works (Guideline 1.2: staff and eno-listed shops cannot be blocked), but browse, the sitemap and the
Google/Meta feeds never list a not-for-sale item with a price — and one conversation with the seat as buyer. The owner
pastes the password into App Store Connect → App Review Information — never into git — then
saves it in their password manager, then `rm .env.app-review.local` (macOS has no `shred`). That file is the only
copy: the script refuses an existing seat (it never re-issues a password).
✔ In the TestFlight build: Sign in → email → "Use a password" works; note whether Turnstile challenges; Block works on
the seeded conversation.

**P12. ⏳ Metadata (owner pastes from the appendices).** 6.9-inch screenshots (§3 — re-captured on eno.vn); name,
subtitle, promotional text, keywords, description (Appendix A); support URL `https://eno.vn/contact`, privacy URL
`https://eno.vn/privacy`, marketing URL **blank for v1**; category (D4); copyright `2026 Eno Company Limited`; App
Privacy (Appendix B); age rating (Appendix C — Unrestricted Web Access YES, override to 18+); content rights (D9);
review notes + the demo account (Appendix A, P11); version release **Manual**. Price and availability ✅ (P5).
✔ No missing-field warnings; "Add for Review" is enabled.

**P13. ⛔ Submit — only when ALL of these hold:**
- **D8 live** — IMMEDIATE (owner, 2026-10-07; deploy with LEGAL_AMENDMENT_IMMEDIATE=2026-10-07) — the Terms' zero-tolerance clause and 24-hour commitment, with the eno.vn /privacy app-ai-notice
  clause (`TOS_VERSION` 3 + `LEGAL_AMENDMENT`), deployed with the gate line;
- **D17 decided** (US storefront) and **B1–B5 answered** (§5);
- **the gate line live** on both env files and verified (P10, P10a), `ugc-safety` included (Guideline 1.2:
  blocking, reporting, filtering);
- ~~push live (P8)~~ — waived: owner, 2026-10-07, "Ship v1 without push" (push arrives with 1.0.4);
- H done (the help-centre answers), the reviewer seat working (P11), the screenshots re-captured (§3);
- `support@eno.vn` receives mail — the address eno.vn publishes, a Cloudflare redirect into the support@eno.forum
  mailbox (`src/lib/email-alias.ts`); Play lists it too once `node scripts/play-api.mjs details --apply` has run.

The App Privacy answers ("no tracking"; no Payment Info; no Sensitive Info) and the screenshots describe the app WITH
the gates on. On rejection, answer in Resolution Center with the native-feature list and the fix per cited guideline
— never build native screens in reply (the phase-2 rule); take it to the owner. A 5.1.1(ix) rejection has a built
fallback (B5): `ios-hide-visa` ON and a resubmission without the e-Visa declarations (Appendix A's e-Visa sections,
Appendix B's passport rows). Every re-upload takes a higher build number. After approval the OWNER releases it manually (the owner's call — it
publishes the app) and checks the VN storefront listing (the US is excluded in v1).

---

## 5. Owner decisions (recommendation in bold)

- **D1 Apple ID, account type, legal entity — DECIDED 2026-10-06: Organization, Eno Company Limited (Công ty TNHH
  ENO), team `DTP9SKVFMQ`, account holder `alex@eno.vn`.** With D18 that resolves the conflict this item used to
  carry — an app under the licensed company's name claiming eno.vn links while rendering the forum's visa desk — by
  moving the app, not the entity. What remains is a partner's e-Visa service on eno.vn (D19, B1, B3).
- **D2 Guideline 4.8.** (a) Sign in with Apple (P9, ~1–2 days) or (b) hide Google on iOS (`ios-hide-google`).
  **(b) for v1** — the binary carries no Sign in with Apple entitlement and the gate line carries the token (B5
  confirms it); **(a) in v1.1** with Google restored. No Apple button on the web for now (Services ID + a secret
  rotated every 6 months).
- **D3 Bundle id — DONE: `vn.eno.app`**, registered on team `DTP9SKVFMQ` by the first signed build and bound to the
  App Store Connect record (permanent). (Not `eno.vn` — not reverse-DNS; not `vn.eno.ios` — the shelved app's.)
- **D4 Category: Shopping, secondary Lifestyle** — the store text is marketplace-first.
- **D5 Services / e-Visa surface in the iOS app — SPLIT 2026-10-06.** The e-Visa application → **D19** (in both apps;
  `ios-hide-visa` OFF). eKYC → **(b), web-only on iOS for v1**: `ios-hide-kyc` (§1), BUILT, in the gate line. An iOS
  seller asked to verify is told it is done in a web browser at eno.vn. VietKite has 14 active `visa-legal` listings
  (measured 2026-10-05; their copy is B4). Never re-enable eKYC server-side after approval.
- **D6 iPhone-only for v1: yes** (done; iPad support can be added later, never removed).
- **D7 Wallet: hidden in the iOS app** (`ios-hide-wallet`) — moot on eno.vn, which has no wallet (404); the token
  stays in the line, harmless. The "Test environment / Add 10 test USD" button must never reach a reviewer.
- **D8 Terms — HELD FOR THE OWNER.** Zero tolerance for objectionable content and abusive users, and a 24-hour
  response commitment (today: 3 working days), with the eno.vn /privacy app-ai-notice clause: a SEPARATE legal change,
  `~/eno-ios-prep/release-v1/legal-d8.patch`. It ships with `TOS_VERSION` 3 + `LEGAL_AMENDMENT` in the deploy that
  turns `ugc-safety` / `app-ai-notice` on. OPEN: the text and its notice.
- **D9 Content rights (5.2.2).** Written permission exists only for Mioto and BonbonCar; rentals,
  electronics and furniture are 98–100% linked third-party listings. (a) get permission, (b) exclude
  unlicensed sources in the iOS app, (c) accept the risk. **Owner's call; (c) is a real exposure** — and
  the App Store Connect content-rights answer must be truthful.
- **D10 Home-screen name: keep "eno"** (store name "Eno Marketplace").
- **D11 EU storefronts: EXCLUDED for v1** (P5) — no DSA trader declaration.
- **D12 Age rating: Advertising Yes, Social Media No, Unrestricted Web Access Yes, override to 18+** (Appendix C).
- **D13 Linked listings lead the feed (4.2.2).** **Lead with first-party content in screenshots and notes,
  keep the feed for v1**, revisit if 4.2.2 is cited.
- **D14 Chat auto-translation (5.1.2(i)): a one-time notice with an opt-out** (R8, built as `app-ai-notice`,
  OFF — §1, §6), plus the Google AI questions, the e-Visa photo check among them (`document_check`). Both apps, not
  only iOS (the token's `app-` prefix; Play's disclosure duty is the same).
- **D15 Version 1.0.3** (done; = Android 1.0.3 / versionCode 5). **D16 One iOS app only** — never a second
  near-identical eno.vn app (4.3(a)).
- **D17 US storefront — EXCLUDED for v1 (P5).** Texas, Utah and Louisiana age-assurance laws; the answer is Apple's
  Declared Age Range API in v1.1. OPEN: the owner confirms.
- **D18 — DECIDED 2026-10-06: both apps render eno.vn; the licensed company's apps send no one to eno.forum**
  (owner: "ship both with eno.vn").
- **D19 — DECIDED 2026-10-06: e-Visa in both apps as VietKite's photos-only chat** (owner: "have evisa application
  flow in the app via eno.vn so when customers send to vietkite via message they can quick check and send needed
  documents only passport photo and 3x4 portrait image").

### Open — the owner answers before P13

- **B1 — legal boundary + every new e-Visa text (owner + lawyer):** the product-page and storefront note, the
  in-chat hint, the consent and AI question, the /privacy section, the store and review texts. They ship with this
  change's web half (W).
- **B2 — /privacy dating:** in force on the deploy day, or 5 days' notice. ⛔ `PRIVACY_AMENDMENT` is NOT BUILT
  (§1, "e-Visa in the apps"): whichever answer, it needs a record in `src/lib/compliance/legal-amendment.ts`, wired into
  /privacy's dates and into `infra/vn-node/legal-amendment-gate.sh` — all before W.
- **B3 — VietKite's licence and signed agreement on file?** Until then no "licensed" in any store or review text, and
  nothing to attach for 5.1.1(ix) / 5.2.2.
- **B4 — clean the 14 VietKite rows** ("official assistance"; "VISA 24 GIỜ" on a Standard product) — a prod write.
- **B5 — submission go:** the gate line (§1), and accept the 5.1.1(ix) risk (the app collects passports for a
  third-party provider); the fallback is `ios-hide-visa` ON + resubmit.
- **D17** (US storefront, excluded for v1) and **D8** (Terms text + notice).
- **Push from eno.forum (known gap, P8):** the APNs/FCM keys stay in `eno-vn.env` and native push refuses on the
  services build, so an offer or message an app user receives from someone on www.eno.forum arrives by bell and email
  only, never as a push. Accept for v1, or decide how the forum may push (it would need the keys there).
- **A sent e-Visa case has no in-app withdraw button** (applicant cancel exists as an API action only, P10): the
  applicant asks VietKite in the chat and the seller presses Cancel. A button for v1, or v1.1? And agree with
  VietKite how to treat a case an App Reviewer files despite the review note.
- **CLAUDE.md's edition table** still reads "eno.vn: visa ⛔ not even a mention". Since D19 eno.vn hosts the
  PARTNER's e-Visa flow (MARKETPLACE_HOSTS_SERVICES); update it inside the pending trim (`~/eno-claudemd-trim`).
- **The Play listing copy** (`PLAY_LISTING`, scripts/play-api.mjs — Appendix A copies it) and the 1.0.3 release
  notes (docs/android-play-release.md). ⚠️ The listing, the phone screenshots, Data safety, the privacy URL and the
  contact details are APP-WIDE — public for every production user (still v4 on www.eno.forum) once Play reviews them.
  By default they wait for the production promotion (`release` leaves the listing alone without `--with-listing`);
  sending any of them with the internal upload needs the owner's explicit acceptance of that window, recorded here:
  ⏳ not given.
- **Every deploy and prod write above:** W, the gate line (both env files), P7, P8 (env + DDL), H, P11, B4, the Play
  `--apply`.

---

## 6. Bucket 1: what is left, and the follow-ups on what was built

**R3 blocking — built (`a0d846254`, follow-ups `ba0a6ead1`), OFF.** Design choices worth knowing:
- Moderators are told through the **Feedback queue** (`/admin/feedback`), not a `Report`: an open
  Report against a profile makes `eraseAccount` refuse that user's OWN deletion (`under_review`), so
  being blocked would have cost them their deletion right until an admin acted.
- The eno team (ADMIN_EMAILS) can neither be blocked nor block — it owns the e-Visa desk and imported
  shops; any such row is void. A shop eno lists on a business's behalf has no owner profile, so there is no one to
  block (`src/lib/user-blocks.ts`: either side unknown). That is why P11's counterpart must be a non-staff account.
- Reviews are deliberately NOT gated by a block: that would let a seller veto a buyer's post-sale
  rating. The transaction rule and Report bound reviews.

The five follow-ups the block commit recorded are SETTLED (`ba0a6ead1`, 2026-10-05), still behind the gate:
1. A `blocked` 403 says so on offer accept, the phone/Zalo reveal, a new offer and the teacher share
   ("This conversation is closed …" — the conversation, never the person).
2. `GET /api/conversations/[id]` answers `closed` (`you_blocked` | `blocked`; omitted when open, one
   primary-key read per poll, none with the gate off) and the thread shows a "conversation closed" banner
   instead of the composer — the blocker gets "Manage blocked users", the other side is pointed at Report.
3. `GET /api/blocks` carries no profile id: each row has an opaque handle (HMAC of blocker + blocked under
   a key derived from `SUPABASE_SECRET_KEY`, else `CRON_SECRET` — set on both editions; without either,
   unblock answers 503); unblock takes the handle, among the caller's own blocks only.
4. One moderator note per (blocker → blocked) per day (kv claim, fails open).
5. The note links `/admin/conversation/<id>` (the read-only admin thread viewer) or, for a storefront
   block, `/admin/users/<blocked>`.
Found while settling them: `/api/teachers/contact` and `/api/teachers/cv` still served a share made
before the block — both now refuse it.

**R5 — built, inside `ugc-safety` (not a new token: one switch turns on everything 1.2 asks for).**
- **Report** (`src/lib/reported-content.ts`): a Report control on every storefront review, the PDP review
  preview, every help-centre reply and a member's help post. It files into the SAME pipeline as every report
  (`/api/report` → `/admin/moderation`, the reporter's `/disputes`) as a **content case**: no target column
  is set — the content is named by the case's server-written system row — because the usual reporter of a
  review is the reviewed shop's owner, and an open report on their storefront would make `eraseAccount` hold
  THEIR OWN deletion; targeting the author instead would let a seller freeze every critical reviewer's
  deletion. One open case per (reporter, content); the reporter's case room names only the KIND of content,
  never its text (one database serves both editions). Confirm (Moderation → Reports → "Reviews & help")
  decides the case in the same transaction that removes the content — a failed removal commits nothing
  (case still open, nobody told): a review is deleted (its full text kept in the case, the shop's rating and count re-derived, its
  listing pages purged, and the same buyer cannot review that deal again), a reply or post becomes
  `removed`; its author is told, the other open cases on the same content close as upheld, and nobody's
  trust is docked. `/api/forum/reports` wrote a `ForumReport` table nothing reads — under the gate it files
  the same content case.
- **Word filter** (`src/lib/ugc-filter.ts`; the list is `src/lib/severe-abuse-words.ts`): owner decision,
  delegated: **SEVERE ONLY** — slurs and hate speech, sexual content involving minors, sexual solicitation,
  explicit threats of violence; never general profanity. A hit is **refused** (400 `objectionable_content`,
  bilingual reason, the text handed back to edit) on chat messages, offer notes, the first message of a
  thread, reviews and help replies/posts (incl. edits) — after every eligibility rule, so those still
  answer first. How to extend the list is in its header; it is matched by publish-guard's own machinery
  (fold, whole words, the accent-aware reading; terms whose unaccented form is everyday Vietnamese — "giet
  may" is also "giết mấy", "mua dam tre em" also "mua đầm trẻ em" — match only WITH accents). The first
  list was cleared against all 125,528 live listings (2 genuine hits, no collisions); review rounds then
  added English phrases and moved collision-prone Vietnamese ones to accents-only, and the last rounds
  (7-12, 2026-10-05) REMOVED what accents cannot save — Vietnamese that is everyday WITH its accents
  ("gái bao", bare "gái gọi" and "gái qua đêm", "mày sẽ chết", "bọn mọi"), the soft verb "hurt", and a
  possessive exception that let slurs and threats through ("nigger's", "kill your wife's family").
  ⚠️ Known gaps, by design: spaced or leet spellings and free paraphrase — Report is the backstop. The
  refused text
  is never stored; an anonymous per-day count per surface and category is kept in `kv_store`
  (`ugc-filter:*`). Deliberately unfiltered: report details, dispute statements, appeals and BOTH sides of
  the support-desk thread — a victim must be able to quote what they received. Public reviews and help
  posts refuse even a quoted threat (the author can rephrase, or Report it) — kept by the owner on
  2026-10-05: a victim quotes it in a report or to the support desk, neither of which is filtered.
  ⚠️ ONE SWITCH, THREE FEATURES. If the filter refuses ordinary text, take the term out of
  `src/lib/severe-abuse-words.ts` (its header says how) and deploy on the owner's "deploy"; switching `ugc-safety` off would also
  remove blocking and reporting, which Guideline 1.2 requires — the last resort, and then the review notes'
  `[ugc-safety live]` add-on must come out too. (A separate server-side kill switch for the filter alone is
  a small change if the owner wants one.)

**Still not built:** nothing — R5 above, R8 and D5 below.
- ⚠️ R5 is built but DORMANT: until `ugc-safety` is live, the review notes must not claim blocking, the
  word filter, or reporting on reviews and help-centre content (the `[ugc-safety live]` add-on below).

**R8 and D5 — built, OFF.** Tokens `app-ai-notice`, `ios-hide-visa` and `ios-hide-kyc`
(§1 table; `src/lib/chat-translation-consent.ts`, `src/lib/ios-hide-visa.ts`, `src/lib/ios-hide-kyc.ts`; D5 split
2026-10-06 — `ios-hide-kyc` goes on, `ios-hide-visa` stays OFF, D19). Choices worth knowing:
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
  ask before chats are first translated; eno.vn's clause is part of the held D8 legal change (§5). The notification
  bell no longer machine-translates private text at all — see the bell item below.
- **Since 2026-10-06 D5 hides eKYC only (`ios-hide-kyc`).** Gone from the iOS app: the KYC camera and the
  business-document upload (its "Business / ID document" takes a person's ID); kept: the verification hub's status
  and the WHOLE e-Visa flow (D19). The bullets below on partner products, threads begun on the web, the send route and
  the e-Visa backstop describe `ios-hide-visa` — built, OFF, the B5 fallback. (On eno.forum it hid the APPLICATION,
  not the topic — the `/vietnam-evisa` information pages, `/moving-to-vietnam`, `/first-month-in-vietnam`, the
  non-government disclosure and a read-only view of an existing e-Visa chat stayed. Those pages are `.forum.svc.` and
  404 on eno.vn, so they are in neither app.)
- **Partner e-Visa products count.** An e-Visa product = the visa slot (`services/visa-legal`) plus an
  e-Visa chip (`visaEntryType`/`visaSpeed`; `src/lib/evisa-listing.ts`) — VietKite's 14 live listings
  carry both. Work-permit / tax / legal listings in the same slot are untouched. With the gate on the listings
  would still show in browse and search; only contacting them would close (hiding them too is the owner's call).
- **A partner thread begun on the web** would be read-only for the applicant in the iOS app too: the thread payload
  carries `eVisaProduct` for the applicant in the iOS app with the gate on, and the page treats it like a desk
  thread.
- **The send route enforces the read-only thread:** `POST /api/conversations/[id]/messages` refuses the
  APPLICANT's write from the iOS app into an e-Visa thread (bound to an application, a desk product, or a
  partner's e-Visa product), failing closed if it cannot classify the thread. The SELLER side — the partner
  answering, or the desk — keeps an ordinary thread and composer in the app.
- The backstop lets DELETE through (removing one's own draft or document captures nothing). Its route lists — one
  per gate, `IOS_HIDDEN_VISA_WRITE_PREFIXES` (`ios-hide-visa`) and `IOS_HIDDEN_KYC_WRITE_PREFIXES` (`ios-hide-kyc`) —
  are `src/lib/ios-hide-visa-api.ts`, imported only by the proxy, so no e-Visa route name enters a client chunk — and
  since 2026-10-06 the SAME lists on both builds (they were empty on the marketplace one, which no app loaded then);
  the send route's thread check is `src/lib/ios-hide-visa-server.ts`.
- `/services-for-expats-vietnam` is eno.forum-only (`.forum.svc.`, 404 on eno.vn — in neither app); there it keeps its
  CTA and grid under the gate: they are every service, not only e-Visa, and its e-Visa cards lead to product pages
  that are gated.
- **Notification bell — private text is never machine-translated (built `d890f620e` + `210abe4fc`, both
  sites, NOT a gate).** The bell's rows go through `<Tr>` (→ `/api/translate` → Microsoft and the shared
  Translation cache) only for an allowlist of types measured to carry eno's own copy or public text (system,
  dispute, reminder, price_drop, milestone, saved_search, forum_reply, visa_result). Offers (the offerer's own
  note), availability requests (they name the requester) and any unknown or new type render AS WRITTEN, title
  and body. KYC and business-verification outcomes are their own type, `verification` (title translated —
  eno's copy; body as written — it can be the reviewer's note naming a document number); older `system` rows
  of that kind are caught by their url (`/dashboard/verification`, `/dashboard/settings`). Cost: an offer's
  free-text note shows in its writer's language; enforcement scam-hold notices (same url) show their body as
  written. ⚠️ Owner, optional (production writes, not done): retype the older rows to `verification` (a draft
  `UPDATE` is in `210abe4fc`'s message, still to be checked against eno.vn's site name) and purge their notes
  from the Translation cache; copies Microsoft already processed cannot be recalled.
- **R8 extended to Google AI (built `ccd83bc92`, dormant behind `app-ai-notice`; `document_check` added
  2026-10-06).** What each family sends, and what "Not now" leaves:

  | family | user action → route | sent to Google | Not now |
  |---|---|---|---|
  | eno AI | /messages/ai → `/api/ai/concierge` | the last turns (Gemini), search words (Vertex AI Search) | still answers: keyword reading + Postgres (`ai: false`) |
  | posting help | Autofill from photo → `/api/ai/classify`; Polish with AI → `/api/ai/rephrase` | the cover photo; the description (Gemini) | unavailable; the seller fills the form |
  | search by photo | camera button / paste → `/api/ai/visual-search` | the photo (Gemini Vision) | unavailable; typed search works |
  | e-Visa photo check (`document_check`) | a photo added in the e-Visa chat → `/api/visa/applications/[id]/extract` | the passport data page and the portrait (Gemini; it reads the passport fields) | the photo is saved and goes to the seller UNCHECKED (`unavailable`, `automatic_image_check_declined`; no Google call, never blocking) |
  | trip (eno.forum's own; on eno.vn a partner's — GMBR) | Build my plan → `/api/itineraries/generate`; stay/stop suggestions; trip chat concierge → `/api/trips/concierge` | trip details (cities, dates, travellers, budget, interests, notes) and questions (Gemini) | unavailable; the desk's people answer in the trip chat. ⚠️ In the apps on eno.vn there is no question at all: its words (`trip-ai-consent.tsx`) are always stubbed on eno.vn, so with the gate on the trip AI is refused |
  | typed search | `/api/listings` → semanticRank | nothing from the apps: Vertex is skipped (`noAi`), the answer served private/no-store | n/a |

  Same storage limitation as chat translation (localStorage, per account per device; no server preference),
  with an in-memory fallback so blocked or full storage still holds the answer for the page. A CLIENT gate by
  design: the server cannot know a per-device answer; it enforces what it can (`ai: false` on the assistant and
  the photo check, no Vertex for app user agents). Every handler sets its busy guard before asking (no double Google
  call from a double tap); a question still open across an account switch, a sign-out or a page change is void, and
  no answer (Escape) is not "Not now" — eno AI sends nothing on it.
- **The visa AI, settled 2026-10-06** (this was the OPEN item here: `/extract` had no non-AI path, so the passport
  photos went to Gemini with no question): the photo check asks first (`document_check`, above), and "Not now" no
  longer blocks the application. The Eno visa concierge does not run on eno.vn (503 `concierge_unavailable`; the
  chip is not rendered) — it speaks as eno, the provider.
- **Not gated, on purpose — owner to confirm:**
  - Publish-time moderation (`src/lib/ai-moderation.ts`: a listing's title, description and photos → Gemini,
    after publish, for non-Trusted sellers and a 5% sample of Trusted ones) and the search index
    (`src/lib/listing-index.ts` → the Vertex AI Search datastore): eno's own processing of content a person
    chose to publish. Disclosed (Appendix B; /privacy already names "Google (Vertex AI, Gemini)"); a per-person
    opt-out of safety moderation would be an evasion route.
  - Admin AI tools.
- **Vertex AI Search status:** the box env sets `GOOGLE_VERTEX_PROJECT`, `VERTEX_SEARCH_DATASTORE_ID` /
  `ENGINE_ID` and `GOOGLE_VERTEX_ADC` (`vertexConfigured()` = true) but no credentials source (no
  `GOOGLE_APPLICATION_CREDENTIALS`, no `K_SERVICE`); code notes (`api/listings/route.ts`,
  `listings-explorer.tsx`, 2026-09-29) say it is off in production. Not re-measured.

---

## 7. Risks the prep cannot remove

- **4.2 / 4.2.2 — a WebView of the live site, much of it linked listings.** Mitigate: push (P8) and, once its hold
  clears, universal links (P7) live before submission; quick actions fixed (done); native features in the notes;
  first-party flows first in the screenshots. If 4.2 is still cited, the owner decides — the phase-2
  rule forbids rebuilding screens natively.
- **2.3.1 / 2.5.2 — every web deploy changes the reviewed app.** No payments, wallet or hidden surfaces
  switched on by server flag after approval without a new submission.
- **5.1.1(ix) — the app takes passports for a third-party provider (VietKite).** B5 accepts the risk; the built
  fallback is `ios-hide-visa` ON and a resubmission without the e-Visa declarations. B3 decides what can be attached.
- **Misleading claims** — Play rejected the app on 2026-09-10 over e-Visa copy; `assertGovernmentDisclosure`
  guards the store text, but the 14 VietKite rows still carry "official assistance" and "VISA 24 GIỜ" on a Standard
  product (B4).
- **5.2.2** — see D9.
- **Google sign-in on iOS** (if kept) has never run end to end; SFSafariViewController shows "Open in
  eno?" when the custom-scheme return fires.
- **Reviewer path** — Turnstile may challenge the password step; the demo account is erased if the
  reviewer tests deletion (the notes ask them not to); a Block test fails against a staff or ownerless counterpart
  (P11).
- **SDK drift — Xcode 27 shipped 2026-09-14.** A UIKit app built with the iOS 27 SDK and no UIScene manifest does not
  launch on iOS 27 (TN3187) — while it still launches on iOS 26, so a test phone on 26 hides it. UIScene support
  (`SceneDelegate`) and Capacitor 8.5.x come first; until then archive with Xcode 26.x (`scripts/ios-release.sh`
  refuses anything else) and keep App Store auto-update off for Xcode.

---

## Appendix A — store text and review notes (re-count after any edit)

**Name (30):** `Eno Marketplace` (15). Fallback `Eno Marketplace Vietnam` (23).

**Subtitle (30):** `Rentals, jobs & second-hand VN` (30). Alternative `Vietnam rentals, jobs & used` (28).
Optional Vietnamese: `Thuê nhà, việc làm, đồ cũ` (25).

**Promotional text (170):** `Apartments and motorbikes to rent, English-teaching jobs, and used phones and laptops from local second-hand shops. Chat with sellers in English or Vietnamese.` (159)

**Keywords (100 bytes):** en-US
`vietnam,expat,apartment,motorbike,scooter,teacher,english,saigon,hcmc,hanoi,used,phone,laptop,rental`
(100; `esim` is left out on purpose — it advertises a partner service, and the store text is marketplace-first).
Optional vi: `căn hộ,thuê nhà,xe máy,đồ cũ,việc làm,giáo viên,điện thoại,laptop,nước ngoài` (100 —
exactly the limit, and only in NFC; paste from a source that keeps precomposed letters).
Re-count with `python3 -c "print(len('…'.encode()))"`.

**Support URL** `https://eno.vn/contact` · **Privacy policy URL** `https://eno.vn/privacy` · **Marketing URL** blank
for v1 · account deletion is documented at `https://eno.vn/account-deletion` (named in the review notes).

**Description** — the SAME text in both stores. `PLAY_LISTING.fullDescription` in `scripts/play-api.mjs` is the single
source (owner approves it — §5); copy it from there, verbatim, after any edit. Marketplace first; the e-Visa section is
the seller's ("VIETNAM e-VISA HELP FROM A SELLER — NOT A GOVERNMENT SERVICE"), and `assertGovernmentDisclosure`
refuses any e-Visa mention without "not a government agency" + https://evisa.gov.vn — never trim either for length.
⛔ No "licensed" until VietKite's licence and agreement are on file (B3). As of 2026-10-06 (2,197 of 4,000):

```
eno is the app for expats, newcomers and locals in Vietnam: find a place to rent, a motorbike for the month, a job, or a good second-hand deal, and talk to the other side directly.

RENT
• Apartments, houses, rooms and offices, with photos, size, bedrooms and the ward on a map
• Motorbike and scooter rentals from local shops, and self-drive cars from car-rental platforms

WORK
• Jobs in Vietnam, including English-teaching roles in cities across the country

BUY AND SELL USED
• Second-hand phones, laptops and cameras from local shops
• Furniture and home appliances
• Post a listing with photos from your phone in a minute. No listing fees.

VIETNAM e-VISA HELP FROM A SELLER — NOT A GOVERNMENT SERVICE
eno is a marketplace run by Eno Company Limited. It is not a government agency and is not affiliated with, endorsed by or acting for the Government of Vietnam, the Ministry of Public Security or the Vietnam Immigration Department. e-Visa help in the app is sold and provided by VietKite, a Vietnamese travel company selling on eno: message them from their listing and send the two photos they need, your passport data page and a 3x4 portrait, after a quick automatic check in the app. VietKite prepares and files the application and agrees its fee with you in the chat; eno takes no payment for it.
Official source: https://evisa.gov.vn is the only place a Vietnam e-Visa is issued, and you can always apply there yourself. Approval, refusal and processing time are decided only by the Vietnamese authorities.

BUILT FOR TRUST
Trust scores are built from completed deals, reviews and confirmed reports, not stars alone. Every listing and seller has a Report button, and reports are reviewed by a person. Nobody can pay to rank higher, and listings that earn eno a commission are labelled Ad.

CLEAR PRICES
Prices are in Vietnamese đồng with a US dollar reference. On items posted directly on eno, make an offer in the chat and agree the deal with the seller. eno never takes payment for marketplace items.

YOUR LANGUAGE
The app works in English and Tiếng Việt, and listings can be read in nine more languages.

You must be 18 or older to use eno. Terms: https://eno.vn/terms · Privacy: https://eno.vn/privacy
```

Add-on — ⛔ NOT for this app (D18: the licensed company's store text is marketplace-first). Kept for the record:

```
SERVICES FOR NEWCOMERS
• Travel eSIMs, company set-up and other services, each provided by a named, licensed partner
• Free trip planning: build an itinerary, save the places you like, and ask for help with bookings
```

(The 2026-10-04 "VIETNAM e-VISA HELP (INDEPENDENT, NOT GOVERNMENT)" add-on is replaced by the seller section above —
it called VietKite "licensed", which waits on B3.)

**App Review notes** — the base block states what the app does at submission, gates on. The E-VISA section is a
draft for B1 (owner + lawyer); bracketed parts are conditions. Append each add-on below it only when its condition
is true at submission (§6 lists what is built, what is gated, and what is not built).

```
WHAT THE APP IS
eno is a classifieds marketplace for Vietnam (rentals, jobs, second-hand goods), operated by Eno Company Limited. The app renders our website https://eno.vn inside a native shell.

SIGN-IN
Browsing needs no account. Posting, chat and saved items need one. Use the demo account below: on the Account tab tap Sign in, enter the demo email, then tap "Use a password". (Ordinary users get an emailed one-time code; the demo account has a password so review does not depend on an inbox.) To test account deletion, please create a separate account with any email address rather than deleting the demo account.

NATIVE FEATURES
Camera and photo library for listing photos and videos; location for "near me" search; home-screen quick actions (Post, Messages, Saved); share sheet; haptics; pull to refresh; offline page with retry; Dynamic Type text size.

ACCOUNT DELETION
Account tab (person icon, bottom right) → tap your name or photo at the top (opens Settings) → Account tab → Danger zone → Delete my account → type DELETE → Permanently delete. Also documented at https://eno.vn/account-deletion.

USER-GENERATED CONTENT
Every listing, seller profile and conversation has a Report control; reports go to a human moderator. A publish gate holds listings with banned content. Contact: support@eno.vn.

E-VISA (A SELLER'S SERVICE, NOT A GOVERNMENT SERVICE)
eno is a marketplace operated by Eno Company Limited, not a government agency. e-Visa help is sold by a marketplace seller, VietKite [legal name, licence no. — agreement and licence attached: only if B3]. Every e-Visa product page names VietKite, says eno is not a government agency and links https://evisa.gov.vn. To test: sign in with the demo account → any "Vietnam E-Visa" listing → Apply in chat. The chat asks for two photos only (the passport data page and a portrait); before the first check the app asks permission to send them to Google (Gemini) for an automatic check — "Not now" skips it and the seller checks by hand. Please stop at the "Send to VietKite" button: everything up to it can be reviewed without submitting anything, and sending files a real case with the seller, who handles real passports. The service is fulfilled outside the app and paid to VietKite directly (3.1.3(e)). Identity verification (ID document + selfie) is not offered in the iOS app.

AI AND TRANSLATION ASK FIRST
Before a feature sends a person's text or photos to Google AI (Gemini) — the eno AI assistant, posting help, search by photo, the e-Visa photo check — the app asks "Use Google AI for …?" (Allow / Not now; changeable in Settings > Preferences > Google AI). Chat translation (Microsoft Azure AI Translator) asks once before anything is translated (Settings > Preferences > Chat translation).

PAYMENTS
The app sells no digital content. Marketplace deals are agreed and paid directly between buyer and seller.
```

Add-ons, each only when true:

```
[ios-hide-google live, D2 = b] The iOS app offers only eno's own sign-in (email code / password); no third-party login is offered on iOS.
[D2 = a, v1.1] Sign in with Apple is offered alongside Google.
[P8 live] Push notifications, including offers and counter-offers, a new enquiry on your listing, sale confirmations, price drops on a listing you asked about, saved-search alerts, reminders to confirm your listings are still available, dispute updates, rental availability requests, e-Visa case updates (a sent case to the seller, the result to the applicant) and account notices (ordinary chat messages show on the Messages badge instead).
[P7 live] Universal links: eno.vn links open in the app; sign-in pages stay in Safari.
[ugc-safety live] Users can block any other user — except the eno team and the shops eno lists on a business's behalf — from the chat header or their storefront; a blocked conversation closes for both sides and our moderators are notified. Seller reviews and help-centre replies and posts also have a Report control, and reports go to a human moderator who can remove the content. A word filter screens chat messages, reviews and help-centre posts and refuses severe language — slurs and hate speech, explicit threats of violence, sexual content involving minors and sexual solicitation; anything it misses can be reported.
[D8 live — only once the Terms say so] We act on objectionable content within 24 hours.
[owner's call — the store text omits partner services] Partner services (eSIMs, company set-up) are real-world services fulfilled outside the app; payment is arranged with the partner in chat.
```

⚠️ The "AI AND TRANSLATION ASK FIRST" section is true only with `app-ai-notice` live — it is in the base block because
P13 requires the gate line.

## Appendix B — App Privacy answers (mirror of `PrivacyInfo.xcprivacy`)

All "Linked to the user" except Diagnostics; none "Used to track you" (no ATT prompt: analytics and
advertising are forced off for the `EnoNativeApp` user agent in `src/lib/consent-value.ts`, and eno.vn renders no
Google Tag Manager container at all — `analytics-tags.tsx` loads it only on eno.forum). 15 linked types + 1 not
linked, exactly the manifest:

| Category | Types | Purposes |
|---|---|---|
| Contact Info | Name (the account and seller name; the name on the passport page the e-Visa photo check reads), Email Address — also **Developer's Advertising or Marketing** (eno's weekly digest, on by default), Phone Number, Physical Address | App Functionality (+ that one) |
| Location | Precise (map, "near me", lat/lng at 3 decimals), Coarse | App Functionality |
| User Content | Emails or Text Messages (chat), Photos or Videos (listing photos and videos; the passport data page and portrait sent to an e-Visa seller in chat), Customer Support, Other User Content (listings, reviews, help posts) | App Functionality |
| Search History | Search History | App Functionality, Analytics (first-party) |
| Identifiers | User ID | App Functionality |
| Purchases | Purchase History — the sale loop's record of what an account bought (the seller names the buyer and price; the buyer confirms "Yes, I bought it"; `Listing.soldToProfileId` / `saleConfirmedAt`). Nothing is paid in the app (eno.vn compiles no Order or checkout route) | App Functionality |
| Usage Data | Product Interaction | App Functionality, Analytics, Product Personalization |
| Other Data | nationality (teacher profile); the CCCD / business-registration number (switch-to-business form); the passport fields the e-Visa photo check reads — date and place of birth, sex, nationality, passport number and its dates, personal ID number, passport type and issuing authority | App Functionality |
| Diagnostics | Other Diagnostic Data (CSP violation reports) — **Not linked** | App Functionality |

**Sensitive Info — not declared, deliberately (2026-10-06).** eno.vn's e-Visa flow asks no form (photos only — no
religion), the portrait is not used for face matching, and eKYC's ID + selfie stay out of the iOS app (`ios-hide-kyc`
in the gate line). ⛔ Never switch `ios-hide-kyc` off, and never bring a form back to eno.vn's e-Visa flow, without a
new submission that declares Sensitive Info — `scripts/ios-release.sh` refuses SensitiveInfo, so that check changes in
the same binary.
**Payment Info / Financial Info — not declared (2026-10-06).** eno.vn has no payout form, wallet or checkout
(`.forum.svc.` routes; `/dashboard/payout`, `/dashboard/wallet`, `/api/seller/payout` answer 404, measured
2026-10-06). Re-declare in the binary that ever brings a payment surface into the app.

Deviations from the 2026-10-04 plan, each from review or measurement: chat is declared as **Emails or Text
Messages**; CSP reports are declared. (While the app rendered eno.forum the payout bank account was declared as
**Payment Info**, and Sensitive Info was planned for removal with `ios-hide-visa` — both moot on eno.vn, above.)

**Google AI, with `app-ai-notice` on** — Google is a service provider for these, used only for App
Functionality and only after the person allows the feature (§6, "R8 extended to Google AI"):
- **The e-Visa photo check (`document_check`)**: Photos or Videos (the passport data page and the portrait), Contact
  Info → Name and Other Data (the passport fields Gemini reads). Linked; not tracking. "Not now" sends nothing to
  Google.
- **User Content → Other User Content**: what a person types to eno AI (and the last few turns); a listing
  description sent to Polish with AI. Linked; not tracking. (Trip details never reach Google from the apps on eno.vn:
  the trip AI is refused there with the gate on — §6.)
- **Photos or Videos**: a listing's cover photo (Autofill from photo); a photo chosen for search by photo.
  Linked; not tracking.
- **Search History**: eno AI sends the search words to Vertex AI Search (people who allowed it); typed
  search from the apps sends nothing to Google. App Functionality; not tracking.

⚠️ **Whatever the gates say:** a published listing's text and photos go to Gemini for prohibited-item
moderation (non-Trusted sellers, plus a 5% sample of Trusted ones) — not optional, so **Photos or Videos**
and **Other User Content** are declared (App Functionality, Google as a service provider) even with
`app-ai-notice` off.

## Appendix C — Age rating

| Question | Answer |
|---|---|
| Parental controls / age assurance | No / No |
| User-generated content | Yes |
| Messaging and chat | Yes |
| Advertising | Yes (partner promos and AccessTrade items labelled "Ad") |
| Social media | No (D12) |
| Unrestricted web access | **Yes** — third-party links open in the in-app SFSafariViewController (`src/lib/native-browser.ts` → `@capacitor/browser`), a full browser inside the app. (`allowNavigation` itself is first-party only, and eno.forum leaves for Safari.) |
| Mature, medical, sexual, violence, gambling, contests, loot boxes | None / No |
| Alcohol, tobacco, drugs | None, unless food-drink listings carry alcohol — then "Infrequent" |

Then **Override to Higher Age Rating → 18+**: Apple requires the override when the EULA's minimum age
(18 in the Terms) is above the calculated rating; it also matches Play's 18+ audience.
