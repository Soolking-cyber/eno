# Shipping the Android app to Google Play

The Capacitor Android app — Play package `eno.vn` (`applicationId`; the Java namespace stays `vn.eno.app`, see
android/app/build.gradle). Written 2026-09-06 against a verified signed build; every command here was run.
Brought to v5 on eno.vn on 2026-10-06.

⛔⛔ **v5 RENDERS eno.vn — OWNER DECISION D18, 2026-10-06 ("ship both with eno.vn") — AND IT NEEDS A PLAY UPLOAD:
versionCode 5 / 1.0.3.** The app renders the licensed company's marketplace (eno.vn, Công ty TNHH ENO), so it never
renders eno.forum, where eno's own e-Visa desk, itinerary and services pages live: `server.url` = `https://eno.vn`,
`allowNavigation` = `eno.vn` + `www.eno.vn`, and every forum link opens in the system browser. The 2026-09-08 reason
for the forum — eno.vn's statutory "not yet officially launched" banner — is void: off since 2026-09-16
(`src/lib/site-legal.ts` `PRELAUNCH_BANNER = false`). ⚠️ e-Visa stays in the app (D19) as the seller VietKite's
photos-only chat — see Data safety. Decisions and the owner's open questions: docs/ios-appstore-release.md §5.
⛔ **Deploy the web half of the 2026-10-06 change BEFORE the 1.0.3 upload** (docs/ios-appstore-release.md, step W):
v5 renders eno.vn, and eno.vn without it lacks the photos-only e-Visa flow and its photo-check question.

⚠️ **THE ORIGIN IS THE APEX, `https://eno.vn`, NO www.** `www.eno.vn` answers 308 to the apex on every path, so
there is one live origin and it carries the Capacitor bridge — the opposite of eno.forum, whose two hosts both
answer 200 (which is why the forum-era origin carried the www). See the note in `capacitor.config.ts`.

⚠️ **EXISTING v4 USERS ARE SIGNED OUT ONCE AND LOSE THE SAVED LIST — SAY SO IN THE RELEASE NOTES (§8).** The update
is an ORIGIN change: cookies and localStorage are per-origin, so the first launch of 1.0.3 starts signed out, and the
Saved list — device-local, localStorage `eno:favorites` — starts EMPTY. Accounts, listings and chats are server-side
and carry over. Installs below versionCode 5 keep rendering `https://www.eno.forum` until the user updates —
`server.url` is baked into the bundle. ⏳ Later, once v5 is at 100%: an "update the app" wall on the services build
for `EnoNativeApp`.

⛔ **Most releases of this app are NOT Play releases.** Capacitor runs in remote-server mode: the
WebView loads the live site, so a product change reaches installed apps the moment the site
deploys, with no store review at all. A new bundle is needed only when the NATIVE shell changes —
a plugin, a permission, the manifest, an icon, `targetSdk`. Expect a handful of uploads a year.

---

## State (2026-10-06)

| | |
|---|---|
| Package | `eno.vn` on Play (`applicationId`, android/app/build.gradle); Java namespace `vn.eno.app` |
| Version | LIVE: versionCode 4 / 1.0.2 (renders `https://www.eno.forum`). NEXT: **versionCode 5 / 1.0.3**, rendering `https://eno.vn` — not yet uploaded |
| Origin | `server.url` = `https://eno.vn`, `allowNavigation` = `eno.vn`, `www.eno.vn` (capacitor.config.ts); forum links open the browser |
| App Links | `eno.vn` only, paths `/listings`, `/c`, `/brands` (not `www.eno.vn`: its assetlinks.json 308s) |
| SDK | min 24, target 36, compile 36 |
| Signed bundle | 7.0 MB, verifies, certificate valid to 2054 (the 2026-09-06 build) |
| Upload key | `~/eno-vault/android/eno-upload.jks`, alias `eno-upload`, RSA 4096 |
| Toolchain | AGP 9.4.0, Gradle 9.7.1 |
| Push | dormant: no `google-services.json` (NATIVE_PUSH_SETUP.md §2), so 1.0.3 cannot register for FCM |

Already correct and needing nothing: branded adaptive launcher icons with a monochrome layer for
Android 13 themed icons; `allowBackup=false` so session cookies never ride a cloud backup;
portrait lock; App Links scoped to `/listings`, `/c`, `/brands` with `/auth` deliberately excluded
so a link can never intercept the OAuth callback.

## The upload key

Generated 2026-09-06 with a 40-character random password. **The keystore and its password are not
in git and never can be** — the repository is public, so `*.jks`, `*.keystore` and
`android/keystore.properties` are all ignored at the repo root. `android/.gitignore` ships with its
own keystore lines commented out, which is exactly why the root file states them.

```
~/eno-vault/android/eno-upload.jks      the key
android/keystore.properties             the paths and passwords Gradle reads
```

⚠️ **Back up both, off this machine.** Losing the upload key is recoverable — Google can reset an
upload key on request, because with Play App Signing they hold the real app signing key — but the
reset takes days. Losing it with no backup and no Play App Signing enrolment would mean the app can
never be updated again.

To change the password, run `keytool -storepasswd` and `keytool -keypasswd` on the .jks and edit
`android/keystore.properties` to match.

## Build and upload — 1.0.3

```bash
# from the repo root, ENO_LOCAL_SHELL unset
node scripts/play-api.mjs tracks         # read-only: confirm 4 is the highest versionCode on every track
npx cap sync android                     # regenerates the GITIGNORED assets (server.url = https://eno.vn)
cd android
./gradlew :app:verifyReleaseSigning clean :app:bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
unzip -p app/build/outputs/bundle/release/app-release.aab base/assets/capacitor.config.json | grep '"url"'   # "https://eno.vn"
cd ..
node scripts/play-api.mjs release android/app/build/outputs/bundle/release/app-release.aab \
  --track internal --notes <notes-file>        # dry run: prints the plan ("listing untouched"), writes nothing
# then the same line + --apply — ⛔ THE OWNER'S CALL: it publishes the bundle to that track. Without --with-listing
#   the app-wide store listing and phone screenshots are untouched — they go at the production promotion (§8)
```

`verifyReleaseSigning` fails with the reason if the key is missing. `<notes-file>` holds the §8 release notes —
`release` refuses its built-in notes for any versionCode but 3, and anything over 500 characters. With `--apply`,
`release` writes `status: completed` (a full rollout of the named track), refuses a track that already carries
anything but a single completed release, and refuses an unnamed track.

⛔ **THE STORE LISTING AND THE PHONE SCREENSHOTS ARE APP-WIDE, NOT PER TRACK.** They are the public store page: once
Play reviews a change to them it is live for every production user — who still runs v4 / 1.0.2 on www.eno.forum, with
eno's own e-Visa desk. A listing that describes VietKite's service and "eno takes no payment" for an app that does
something else is the Misleading-Claims class behind the 2026-09-10 rejection. The Data safety answers, the privacy
policy URL and the contact details (`details --apply`) are app-wide too (§6, §7). So since 2026-10-06 `release`
touches the listing and the screenshots ONLY with `--with-listing` (which also demands an explicit `--shots <dir>`);
without it, it uploads the bundle and writes the track release, nothing else — except `--track production --apply`,
which refuses unless it names `--with-listing --shots <dir>` or `--keep-listing`. Internal upload =
`release <aab> --track internal --notes <file> --apply`; all the app-wide changes go at the production promotion
(§8) — earlier only if the owner explicitly accepts that window (recorded in docs/ios-appstore-release.md §5).

⛔ **SCREENSHOTS — A REQUIRED STEP AFTER W, BEFORE ANY DRY RUN THAT NAMES `--shots`:**
`node scripts/play-capture.mjs && node scripts/play-frames.mjs` on https://eno.vn (the default; `play-frames.mjs`
refuses a manifest from another base) → a fresh `play-store-assets/phone/en/`; then a person looks at every image.
⛔ **The 2026-09-14 set must never be uploaded again.** `play-store-assets/` is gitignored, so a worktree has none and
the only set found (2026-10-06) is `~/eno.vn/play-store-assets/phone/en`, captured 2026-09-14: its `03-product.png` is
"iPhone 17 Pro Max 2TB | Genuine — New — Buy on CellphoneS", a new-goods store hidden on eno.vn since the 2026-10-03/04
second-hand focus (`play-capture.mjs`: that listing now 404s; the iOS capture refuses "CellphoneS" as regulated copy).
`--with-listing --apply` deletes every phone screenshot and uploads whatever is in the folder it is given.

⛔ **`android/app/src/main/assets/` IS GENERATED AND GITIGNORED, AND GRADLE BUILDS WITHOUT IT.**
`cap sync` writes `capacitor.config.json` (from `capacitor.config.ts` — the `server.url` the app
loads), `capacitor.plugins.json` and `public/` (the offline page). A fresh worktree has none of
them; a stale checkout carries whatever it was last synced with — on 2026-10-06 the main checkout's
copy still said `https://www.eno.forum`. Check the bundle, not the source (the `unzip` line above).

Without `keystore.properties` the release build still succeeds and is UNSIGNED, exactly as before
the signing config existed — CI and fresh clones are unaffected. Play refuses an unsigned bundle
with a generic error, which is what `verifyReleaseSigning` exists to pre-empt.

Confirm before uploading:
```bash
jarsigner -verify android/app/build/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab | grep SHA256
```

⚠️ **Close Android Studio first, or check `git status` after.** On 2026-09-06 an open IDE rewrote
`android/build.gradle` and `gradle-wrapper.properties` to AGP 9.4.0 / Gradle 9.6.0 on its own,
minutes before a release build. A store artifact must not carry an unattributed toolchain bump, so
that one was reverted and the bundle rebuilt on the committed versions.

✅ **The bump that IS committed was asked for and re-verified.** Owner, 2026-09-06: *"upgrade
android studio and its packages to latest"*. AGP is now **9.4.0**, the newest STABLE — 9.5.0 exists
only as an alpha and an alpha has no place under a store release — and Gradle is **9.7.1**. Both the
debug APK and the signed release bundle were rebuilt on them and the bundle still verifies. The SDK
needed nothing: emulator 37.1.11 and API 36 are the newest on every channel, stable through canary.

---

## Play Console, in order

### 0. ✅ DEVELOPER ACCOUNT — DONE (owner, 2026-09-08: "the dev account is verified ready")
The account exists and is verified, so everything below is unblocked. The paragraphs that follow
are kept because they record WHY the organization path was chosen and what it cost.

⚠️ **THE ENTITY QUESTION, NARROWED 2026-10-06 (D18/D19) — ONE LAWYER QUESTION LEFT (B1).** The only registered entity
is Công ty TNHH ENO (ERC 0319679107), the licensed marketplace, which by this codebase's own edition rules may not
offer e-visa, itinerary or PayPal — and eno.forum has no incorporated entity at all (`site-legal.ts`
PENDING_SERVICES_ENTITY, `registered: false`). From 2026-09-08 to 1.0.3 the app rendered eno.forum and offered exactly
those services. 1.0.3 renders eno.vn, which has no e-Visa desk, itinerary or PayPal of eno's own; what remains is a
PARTNER's service — VietKite's e-Visa chat (D19), and GMBR's trip-planning listings — and the owner + lawyer question
B1: the legal boundary and every new e-Visa text (docs/ios-appstore-release.md §5).

### 0b. The original step zero, for the record
Checked 2026-09-06 in the browser: `play.google.com/console` redirects **both**
`shanazar15071994@gmail.com` and `support@eno.forum` to `/signup`. No Play developer account existed
on either AT THAT TIME. ⚠️ SUPERSEDED — see step 0 above: the account now exists and is verified.
This paragraph is kept only for the reasoning that follows it.

Choose **An organization → A company or business**, signed in as `support@eno.forum` (the account
that owns the rest of eno's Google surface). Two reasons, and the second one is a fortnight:

- eno.vn is registering as a licensed Vietnamese marketplace. A personal account would list an
  individual rather than the company as the developer of a sàn TMĐT that runs KYC and payments.
- A **personal** account opened today must run a closed test with **12 testers for 14 continuous
  days** before it may even apply for production access. Organizations are exempt.

The cost of the organization path is verification: Google asks for a **D-U-N-S number** and
matching legal name, address and phone. If eno does not have a D-U-N-S yet, request one from
Dun & Bradstreet first — it is free and takes roughly a week or two, and it gates everything after.

### 1. Create the app
All apps → Create app. Name **eno**, default language English (United States), app not game, free.

### 2. App access — this one blocks review if skipped

⛔ **AND THE REVIEWER CANNOT USE THE ORDINARY SIGN-IN.** Password auth is partner-gated
(`src/app/api/auth/password/route.ts`), so the normal path is an emailed code — which a reviewer
cannot wait for you to relay, because review is asynchronous. The seat exists:
`play-review@eno.forum` (scripts/register-play-reviewer.mjs; it signs in on eno.vn too) — re-seeding it is an
OWNER-APPROVED prod write. Give Play those credentials. Verify it signs in on a clean device BEFORE submitting:
this is the single most common cause of a rejection that costs a week.
Most of the marketplace is behind a sign-in. Under **App access**, choose "All or some
functionality is restricted" and give the reviewer a working account. A reviewer who cannot get past
the sign-in wall rejects the app.

⚠️ **AND AN EMAILED CODE IS NOT A WORKABLE REVIEWER CREDENTIAL, WHICH IS WHY THE PASSWORD ACCOUNT
BELOW IS THE ANSWER.** Review is asynchronous — nobody is standing by to relay a code — so "supply
an account whose code you can relay", which this section used to say, is not a procedure that
survives contact with a real review queue.

✅ **AND ORDINARY USERS ARE FINE — THIS WAS CHECKED, BECAUSE IT IS THE OBVIOUS WORRY.** A reviewer
asked whether passwordless sign-in is broken in the app: the App Links filter deliberately excludes
`/auth`, so an emailed magic LINK opens in Chrome, lands the session in the browser's cookie jar,
and leaves the WebView signed out. It does not happen. `sign-in-form.tsx` auto-detects native /
in-app-browser / PWA contexts and FORCES the email CODE instead of the link — the toggle is
one-way there — for exactly that reason, and Google OAuth in the Capacitor app goes through
`native=1` → `enovn://auth-callback`, a scheme the manifest registers. (`native=2` →
`enoforum://` belongs to the shelved SwiftUI app, not this one.)

### 3. Content rating
Questionnaire: user-generated content **yes**, user-to-user communication **yes** (in-app chat),
no violence, no sexual content, no gambling, no drugs. Declare that reporting exists — it does:
per-surface report dedup, chat reports, admin one-way messaging, the dispute centre. ⚠️ User-to-user BLOCKING is the
`ugc-safety` gate (OFF until the gate line deploys — docs/ios-appstore-release.md §1): declare blocking only once it
is live.

### 4. Target audience
18 and over. Not designed for children, so no Families policy obligations.

### 5. Ads
**No ads.** The app serves no ad network. Meta Conversions API is server-side attribution for our
own campaigns, not advertising shown inside the app.
⚠️ OPEN (owner): the store text says "listings that earn eno a commission are labelled Ad", and the App Store age rating answers
Advertising = Yes (partner promos, AccessTrade items) — reconcile this answer with both before submitting.

### 6. Data safety — RE-ANSWER FOR 1.0.3 (2026-10-06)

⛔⛔ **1.0.3 renders eno.vn (D18) and carries VietKite's photos-only e-Visa chat (D19).** From 2026-09-08 the app
rendered eno.forum, which sells e-Visas and ships the payments path, and the forum-era answers were written for
that. Under-declaring is the mismatch that gets an app suspended after the fact — declare the capability the app
ships with, not today's env values (the same rule as Meta CAPI below).
⛔ **App-wide, like the listing:** these answers describe every install, and production runs v4 on www.eno.forum until
the promotion — submit them with the production promotion (§8), not with the internal upload (Build and upload),
unless the owner accepts that window (docs/ios-appstore-release.md §5).

| Play category → type | 1.0.3 answer | Where, in the code |
|---|---|---|
| Photos and videos → Photos | **collected, optional; SHARED with the e-Visa seller when the user taps Send** | listing photos; the passport data page + 3x4 portrait sent in the e-Visa chat (`src/lib/visa/dm-flow.ts`, `visa-cards.tsx`); on Android also the eKYC ID photo and selfie (`ios-hide-kyc` is iOS-only) |
| Personal info → Name | collected | the account / seller name; the name on the passport page the photo check reads |
| Personal info → Other info | collected | the passport fields the check reads (date and place of birth, sex, nationality, passport number and dates, personal ID number, passport type and issuing authority — `extract/route.svc.ts`); the CCCD / business-registration (ERC) number on the switch-to-business form; the KYC document number |
| Financial info → Purchase history | collected | the sale loop's record of what an account bought (`Listing.soldToProfileId` / `saleConfirmedAt`); nothing is paid in the app |
| Financial info → Payment info, Other financial info (wallet) | **no, from 1.0.3** | forum-only: the payments path (`src/lib/payments/**`) is a stub on eno.vn, `crossmint.stub.ts` replaces the wallet adapter, and `/dashboard/wallet`, `/dashboard/payout`, `/api/seller/payout` are `.forum.svc.` (404 on eno.vn, measured 2026-10-06) |
| ~~Government ID — passport image and MRZ, read on-device~~ | **DELETE these rows** | Play has no such type, and eno.vn's check reads the passport on the server (Gemini) — the fields are Personal info → Other info above, the images Photos |

**Government apps declaration** (App content): **No**. The store text and every e-Visa product page say eno is not
a government agency and name https://evisa.gov.vn.
The photo check: Google (Gemini) processes the two images for eno, asked first in the app under the AI family
`document_check` once `app-ai-notice` is on; "Not now" sends them to the seller unchecked.
⚠️ OPEN (with B1's lawyer): whether Name / Other info — read off the photos the seller receives — also count as
shared with the seller.

⛔ **PLAY'S "FINANCIAL FEATURES" DECLARATION IS A SEPARATE FORM AND THE OLD CHECKLIST HAD NONE.**
The forum edition (versionCode 1–4) shipped a payments path and a wallet adapter; eno.vn (1.0.3) ships neither.
Re-answer it for 1.0.3, and answer it before someone notices it was skipped.

### 6b. The original marketplace table (2026-09-06), with the 1.0.3 changes folded in
Answer from what the app actually does. Collected, linked to the user unless the row says otherwise, not sold:

| Category | Collected | Purpose |
|---|---|---|
| Name, email address | yes | account, seller identity |
| Phone number | yes | account, seller contact |
| User IDs | yes | account |
| Photos | yes | listing images, identity verification captures, the e-Visa photos (§6) |
| ~~Government ID~~ | — | no such Play type: the KYC images are Photos, the document number Personal info → Other info (§6) |
| Approximate + precise location | optional | "use my location" in search and posting |
| Messages | yes | in-app buyer/seller chat |
| App interactions | yes | analytics |
| In-app search history (App activity) | yes | app functionality (saved searches), analytics (first-party) — what iOS declares as Search History |
| Crash logs | no | none shipped |
| Diagnostics (App info and performance) | yes | app functionality: CSP violation reports via `/api/csp-report`, tied to no account — what iOS declares as Other Diagnostic Data, not linked (PrivacyInfo, Appendix B) |

Declarations that go with it: **data is encrypted in transit** (HTTPS only, `cleartext: false`);
**users can request deletion** (self-service account erasure exists, with a durable erasure queue
behind it); **data is not sold**.

⛔ **"SHARED" MUST BE ANSWERED YES FOR ADVERTISING, NOT NO — CHECK THIS BEFORE YOU SUBMIT.** The
consent banner offers an "Ad personalization" tier described in the app as *"Ad-network signals
(Meta/Google) for retargeting"*, and `src/lib/meta-capi.ts` sends conversion events server-side to
Meta with the user's hashed email, hashed phone, hashed stable id, IP address and user agent. That
is a transfer to a third party for advertising, which Play's Data Safety form calls **shared**. It
is inert only while `META_PIXEL_ID` and `META_CAPI_TOKEN` are unset. Under-declaring here is the
kind of mismatch that gets an app suspended after the fact, so declare the capability the app
ships with rather than today's env values, unless you intend to remove it.

✅ **THE SHARING IS OPT-IN, AND THAT IS MEASURED, NOT ASSUMED.** `sendMetaCapiEvent` returns early
unless the request carried the `all`-tier consent cookie, and it fails closed: no cookie, the
middle tier, the legacy `accepted` value and a hand-built payload that never read the cookie all
send nothing. All five call sites build their payload through `metaUserDataFromHeaders`, which is
what reads it. `src/lib/meta-capi.test.ts` pins every one of those cases, including the shape a
future sixth call site would get wrong. So the form can say sharing happens only with consent.

Analytics is Google Analytics 4 and that one is gated the same way: it loads only after the "all"
tier is chosen, because Vietnam's PDP Law 91/2025 treats behavioural data as sensitive. There is no browser
pixel. In 1.0.3 neither loads, for two different reasons: Google Tag Manager is forum-only (`analytics-tags.tsx`
renders the container only under `IS_SERVICES`), while GA4's gtag.js renders on BOTH editions once analytics consent
and `GA_ID` are present — it is absent in the app only because the `EnoNativeApp` user agent forces analytics (and ad)
consent off (`src/lib/consent-value.ts`). Push is not
enabled in production, so no FCM token is collected; the plugin ships dormant, which is why the merged manifest
lists `POST_NOTIFICATIONS`, `WAKE_LOCK`, the c2dm receive permission and the Samsung badge permissions. Nothing
requests them at runtime, and 1.0.3 has no `google-services.json`, so it cannot register for FCM at all.

### 7. Store listing

⛔ **THE SINGLE SOURCE IS `PLAY_LISTING` IN `scripts/play-api.mjs` — DO NOT PASTE THE COPY BELOW.** Since 2026-10-06:
title "Eno Marketplace", marketplace-first, with the seller's e-Visa section "VIETNAM e-VISA HELP FROM A SELLER — NOT
A GOVERNMENT SERVICE" (the App Store description copies it — docs/ios-appstore-release.md Appendix A).
`assertGovernmentDisclosure` refuses any listing that mentions an e-Visa without "not a government agency" and
https://evisa.gov.vn — the two things Play's 2026-09-10 rejection (Misleading Claims) found missing. ⛔ No "licensed"
until VietKite's licence and agreement are on file (B3). It reaches Play with `node scripts/play-api.mjs listing
--apply`, or inside `release … --with-listing --shots <fresh set> --apply` with a bundle — the OWNER'S call, after the
owner approves the copy. It is APP-WIDE: it goes at the production promotion (§8), not with the internal upload.
The blocks below are the 2026-09-08 FORUM listing, kept for the record (that rewrite replaced a marketplace-only copy
whose short description was 86 characters against an 80 limit).

**App name (30 max)** — 25
```
eno: Marketplace & e-Visa
```

**Short description (80 max)** — 75
```
Buy, sell and rent in Vietnam. Plus Vietnam e-Visas and free trip planning.
```

**Full description (4000 max)**
```
eno is the app for expats and internationals living in or travelling to Vietnam. One place to buy
and sell, sort your visa, and plan the trip.

BUY AND SELL
• Housing and rentals, from studios to serviced apartments
• Motorbikes, bicycles and cars
• Furniture and appliances, including whole moving sales
• Electronics, phones and laptops — new, used and refurbished
• Jobs and local services

Post a listing with photos from your phone, set a price in VND, and reply to buyers in the app.
No listing fees.

VIETNAM e-VISA
Apply for a Vietnam e-Visa without deciphering a government form. Choose standard or express
processing, see the price and the timeline before you commit, and ask a human first if you are not
sure which option fits. Your documents are handled securely and you are told what happens at each
step.

PLAN THE TRIP
Build an itinerary, save the places you like, and get help with bookings — free.

BUILT FOR TRUST
Every seller carries a public trust score built from real evidence, not stars alone. Business
sellers can verify their registration. Listings that break the rules get reported by the community
and reviewed. Prices are shown in Vietnamese đồng with a US dollar reference, so you always know
what you are paying. Nobody can pay to rank higher.

YOUR LANGUAGE
The whole app works in English and Tiếng Việt, with nine more languages for listing content.

MADE FOR VIETNAM
Search by city and district, see listings on a map, and message sellers directly. Offers are built
in, so you can negotiate without leaving the app.
```

⚠️ **WHAT THE DESCRIPTION DELIBERATELY DOES NOT SAY.** It does not name a processing time or a
price for the e-Visa (both live in the listing and change), does not promise approval, and does not
call the trip planner a booking agency. A store description is a publication by the developer
entity — see the entity note in step 0. (The rule still holds for `PLAY_LISTING`'s seller section.)

**Graphics.** ⛔ SUPERSEDED — never upload the set below again (it is e-Visa-led, from the forum app). The phone
screenshots come from eno.vn: `node scripts/play-capture.mjs && node scripts/play-frames.mjs` →
`play-store-assets/phone/en/`, RE-CAPTURED before every upload and looked at by a person, image by image (Build and
upload — ⛔ the 2026-09-14 eno.vn set must never be uploaded again either: its product frame is a CellphoneS new
iPhone); uploaded at the production promotion (§8) by `release … --with-listing --shots <fresh set>` or in Play
Console.
For the record, the 2026-09-08 set was captured from the SIGNED RELEASE BUILD on the `eno_pixel` emulator at
1080×2400, in `play-store-assets/forum/`:

| File | Shows |
|---|---|
| `01-marketplace.png` | a real imported listing — HONOR 400 5G, 7,990,000 VND ≈ $312, Used, Hồ Chí Minh, "Buy on Minh Tuấn Mobile" |
| `02-evisa.png` | the Vietnam e-Visa landing page |
| `03-evisa-detail.png` | the e-Visa explainer and the product cards |
| `04-evisa-pdp.png` | an e-Visa product: fixed price in VND + USD, "Apply in chat", seller trust score |

(For the record, also superseded by the eno.vn set: the forum set lacked a browse/grid screenshot of the marketplace
— the deep links that worked reliably from `adb` reached the e-Visa pages; the browse screen needed taps past the
consent banner and the six-step Quick Tour. Play wants at least two and takes up to eight.)

The product images carry the `eno.vn` watermark — a contradiction only while the app rendered eno.forum; from 1.0.3
the app is eno.vn again. The watermark is applied at import/upload time, so changing it is a re-watermark of
existing images, not a config flip.

**Icon and feature graphic.** `play-store-assets/play-icon-512.png` (512×512) and
`play-feature-graphic-1024x500.png` (1024×500, no alpha) already exist and meet spec. The feature graphic promises a
marketplace only — **keep it that way** (the store text is marketplace-first, 2026-10-06); the forum-era advice to
re-cut it for the e-Visa is void.

**Privacy policy URL:** `https://eno.vn/privacy` from 1.0.3 (2026-10-06). Play expects the policy of the app it
is reviewing, and the app is the eno.vn edition again; it was `https://www.eno.forum/privacy` while the app rendered
the forum (versionCode 1–4). Console only (App content → Privacy policy) — APP-WIDE: change it at the 1.0.3
production promotion (§8), not with the internal upload.

**Account deletion URL:** `https://eno.vn/account-deletion` from 1.0.3 (200, measured 2026-10-06; it was
`https://www.eno.forum/account-deletion` from 2026-09-08 — Play's Data safety form requires a URL reachable
WITHOUT installing the app or signing in). Part of Data safety, so it changes with it, at the promotion (§6).

**Contact details** — required Console fields the old draft omitted entirely: a public support
email, and optionally a website and phone. Use the address the app's edition itself publishes — since 2026-10-06
eno.vn's `support@eno.vn` and `https://eno.vn` (`PLAY_DETAILS` in scripts/play-api.mjs, written by
`node scripts/play-api.mjs details --apply` — the owner's call; APP-WIDE, so at the production promotion, §8). It was
`support@eno.forum` while the app rendered the forum.

**Category and tags** — also absent from the old draft. **`Shopping`** — the store text is marketplace-first and
the marketplace is the bulk of the app (`Travel & Local` only if the e-Visa were to lead, which D18/D19 rule out for
the listing). It changes who the app is shown to.

### 8. Release
Start with **Internal testing** (`release … --track internal`, above — the bundle and the track release only), install
from the Play link on a real device, and only then — THE OWNER'S CALL: it publishes to every production install, with the app-wide changes below —
promote to Production in Play Console (the internal release →
Promote): re-running `release … --track production` would upload versionCode 5 a second time, and a versionCode is
never reused. The first production review can take several days.

⛔ **The app-wide changes go WITH the promotion** — and only once the Ads answer (§5, 6b) agrees with the store text's
"labelled Ad" line and the iOS Advertising = Yes (Build and upload): the listing (`node scripts/play-api.mjs listing
--apply`), the FRESH phone screenshots (re-captured on https://eno.vn after W and checked by a person, image by image —
uploaded in Play Console, since `release` cannot re-send versionCode 5), the Data safety answers and the
account-deletion URL (§6), the privacy policy URL and the contact details (`details --apply`, §7).
`release … --track production --notes <file> --with-listing --shots <fresh set> --apply` does the bundle, the listing
and the screenshots in one edit — but it uploads its bundle, so only for a versionCode Play has not received yet.
The owner's call, like every `--apply`.
⛔ Never the 2026-09-14 screenshot set.

**Release notes for 1.0.3** — en-US, the `--notes` file; 500 characters at most (this is 322), and they cannot be
changed without a new release. The owner approves them with the listing copy:

```
The eno app now opens eno.vn, our marketplace.
• This update signs you out once — sign in again and your account, listings and chats are all still there.
• Saved items were stored on this phone and don't carry over, so Saved starts empty: save your favourites again.
• Links to our other websites now open in your browser.
```
(Not "eno.forum" by name: D18 — the licensed company's store page sends no one to the forum. Owner approves, B1.)

✅ **App Links need no edit and no deploy for 1.0.3.** `public/.well-known/assetlinks.json` already carries both
fingerprints for package `eno.vn` — the Play app-signing key (`7B:5B…`, from `signing 1`) and the upload key — and the
app-signing key does not change per versionCode. On the internal-track install, check that
`adb shell pm get-app-links eno.vn` shows `eno.vn: verified`, then promote (the owner's call).

---

## After the first upload — the App Links step that is easy to miss

✅ The DEBUG fingerprint that used to sit in `public/.well-known/assetlinks.json` is gone. It was
byte-identical to `~/.android/debug.keystore` on this machine, which both authorised any local
debug build to claim eno.vn links and guaranteed that a Play-signed build would fail verification.
The file now carries the **upload key**:

```
3E:71:F7:BA:92:E1:85:60:5A:19:43:08:33:5C:BC:62:68:44:72:3B:0C:73:A0:75:86:56:9B:1E:0F:27:04:4F
```

⛔ **THAT ALONE IS NOT ENOUGH FOR PLAY USERS, AND THIS IS THE STEP PEOPLE MISS.** With Play App
Signing, Google re-signs the bundle with *their* key, so the certificate on a downloaded app is
neither the debug key nor the upload key. Until the app signing fingerprint is added, a shared
`eno.vn/listings/…` link keeps opening in the browser. Nothing errors; the feature is just absent.

✅ **YOU DO NOT HAVE TO HUNT FOR IT IN THE CONSOLE — IT IS ON THE API.** `generatedApks` reports the
Play app-signing certificate per version code, so this is one command rather than a click path that
moves between Console redesigns:

```bash
node scripts/play-api.mjs signing 1
# 7B:5B:57:78:21:69:58:5D:89:FB:3C:A8:69:06:C8:AF:DE:0F:8D:08:FC:B5:65:8D:72:BB:CE:5B:C2:EC:F5:8D
```

(The Console path still exists if the API is unavailable: Test and release → Setup → **App
integrity** → App signing key certificate → SHA-256.) Then pass **both**, because the second
argument replaces the file rather than appending to it:

```bash
node scripts/android-assetlinks.mjs <APP_SIGNING_SHA256> 3E:71:F7:BA:92:E1:85:60:5A:19:43:08:33:5C:BC:62:68:44:72:3B:0C:73:A0:75:86:56:9B:1E:0F:27:04:4F
```

Keeping the upload key in the list is what lets a locally-built release APK verify while testing.
The script refuses a debug fingerprint and refuses anything that is not 32 colon-separated hex
bytes. (Both fingerprints are in the file today, under `package_name` `eno.vn`.)

Then, on the owner's "deploy", **deploy the site** — the file reaches users only through
`infra/vn-node/eno-deploy.sh` (not needed for 1.0.3: both fingerprints are live, §8) — and
verify:

```bash
curl -s https://eno.vn/.well-known/assetlinks.json   # package_name "eno.vn" + both fingerprints (measured 2026-10-06)
adb shell pm verify-app-links --re-verify eno.vn
adb shell pm get-app-links eno.vn      # from 1.0.3: eno.vn alone, "verified"; no forum host
```

One file serves both editions: eno.vn and eno.forum are the same root built twice and share
`public/`. Verified 2026-09-08 by md5: the live bytes on eno.vn, eno.forum and www.eno.forum are
all the repo-root `public/.well-known/assetlinks.json`. The debug-key copy in
`apps/forum/public/` is DEAD CODE — that tree is dormant and nothing deploys it — but it is
git-tracked in a public repo and should be deleted or corrected as hygiene.

✅ **VERIFIED END TO END ON THE EMULATOR, 2026-09-08**, with the upload-key build installed (⚠️ a forum-era record —
before the `eno.vn` applicationId and the 2026-10-06 move; for 1.0.3 expect `eno.vn: verified` and no forum host):

```
$ adb shell pm get-app-links vn.eno.app
    Signatures: [3E:71:F7:BA:…:04:4F]
    Domain verification state:
      eno.vn: verified
      www.eno.forum: verified
      eno.forum: verified
```

⛔ **ONLY eno.vn IS CLAIMED FROM versionCode 5 (2026-10-06).** The app renders eno.vn, so it claims
that domain's links and nothing else. eno.forum and www.eno.forum are NOT claimed: the licensed
company's app may not show the services edition (D18), and a verified claim would also loop — the WebView
hands a forum link to the system because allowNavigation excludes it, and the system would route it
straight back into the app. `www.eno.vn` is NOT claimed either: its assetlinks.json answers 308, the
Android verifier does not follow redirects, and on Android 11 and lower one unverifiable host fails
verification for every host the app claims.

⚠️ **A BARE `https://eno.vn/` LINK OPENS THE BROWSER, NOT THE APP, AND THAT IS BY DESIGN.**
The filter is a path-prefix allowlist (`/listings`, `/c`, `/brands`) because an Android
intent-filter cannot express an exclusion, and `/auth` must never be captured — a PKCE code is
single-use, so an intercepted callback lands on an error. Widening to `/` would capture it.

---

## The one policy risk worth knowing about

Play's **Minimum Functionality** policy rejects apps that are only a wrapper around a website. This
app is more than that and the listing should say so if asked: native camera capture for listing
photos and identity verification, verified App Links, home-screen shortcuts, an offline page with
retry, native splash and status-bar handling, hardware back navigation, haptics, native share, and
system-level text-size support. The dormant push plugin is wired but not enabled.

If a rejection cites minimum functionality, the answer is to point at those, not to add features.
