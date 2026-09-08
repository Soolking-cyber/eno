# Shipping the Android app to Google Play

The Capacitor Android app, package `vn.eno.app`. Written 2026-09-06 against a verified signed
build; every command here was run.

⛔⛔ **THE APP RENDERS eno.forum, NOT eno.vn — CHANGED 2026-09-08, AND IT IS WHY THE LAUNCH IS
POSSIBLE AT ALL.** eno.vn serves a statutory *"website is under construction and in test operation
— not yet officially launched"* banner on every page while its MoIT sàn TMĐT registration is
pending (`src/lib/site-legal.ts` PRELAUNCH). The app is a WebView of that site, so a Play reviewer
would have opened it and been told by the app itself that the service is not launched. Measured on
production the same day: eno.forum carries no such banner, serves the SAME 16,966 listings, and
adds `/vietnam-evisa`, `/itinerary` and the services pages — 200 on the forum, 404 on eno.vn. The
forum is a superset, so nothing is lost.

⚠️ **THE ORIGIN IS `https://www.eno.forum`, WITH THE www.** Both forum hosts answer 200 with no
redirect — unlike eno.vn, where www 308s to the apex — so they are two live origins and only one
can carry the Capacitor bridge. The canonical is www. See the long note in `capacitor.config.ts`.

⛔ **Most releases of this app are NOT Play releases.** Capacitor runs in remote-server mode: the
WebView loads the live site, so a product change reaches installed apps the moment the site
deploys, with no store review at all. A new bundle is needed only when the NATIVE shell changes —
a plugin, a permission, the manifest, an icon, `targetSdk`. Expect a handful of uploads a year.

---

## State as of 2026-09-06

| | |
|---|---|
| Package | `vn.eno.app` |
| Version | versionCode 1, versionName 1.0.0 |
| SDK | min 24, target 36, compile 36 |
| Signed bundle | 7.0 MB, verifies, certificate valid to 2054 |
| Upload key | `~/eno-vault/android/eno-upload.jks`, alias `eno-upload`, RSA 4096 |
| Toolchain | AGP 9.4.0, Gradle 9.7.1 |

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

## Build

```bash
cd android
./gradlew :app:verifyReleaseSigning      # fails with the reason if the key is missing
./gradlew clean :app:bundleRelease       # → app/build/outputs/bundle/release/app-release.aab
```

Without `keystore.properties` the release build still succeeds and is UNSIGNED, exactly as before
the signing config existed — CI and fresh clones are unaffected. Play refuses an unsigned bundle
with a generic error, which is what `verifyReleaseSigning` exists to pre-empt.

Confirm before uploading:
```bash
jarsigner -verify app/build/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab | grep SHA256
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

⛔ **THE ENTITY QUESTION IS STILL OPEN AND THE OWNER IS CLEARING IT** (owner, 2026-09-08: "we will
clear entity issues"). Stated here so nobody assumes it was settled: the only registered entity is
Công ty TNHH ENO (ERC 0319679107), the licensed marketplace, which by this codebase's own edition
rules may not offer e-visa, itinerary or PayPal — and eno.forum has no incorporated entity at all
(`site-legal.ts` PENDING_SERVICES_ENTITY, `registered: false`). The app now offers exactly those
services. That is a lawyer question, not a code one.

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
cannot wait for you to relay, because review is asynchronous. Seed a partner-flagged account with a
password and give Play those credentials. Verify it signs in on a clean device BEFORE submitting:
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
no violence, no sexual content, no gambling, no drugs. Declare that reporting and blocking exist —
they do: per-surface report dedup, chat reports, admin one-way messaging, the dispute centre.

### 4. Target audience
18 and over. Not designed for children, so no Families policy obligations.

### 5. Ads
**No ads.** The app serves no ad network. Meta Conversions API is server-side attribution for our
own campaigns, not advertising shown inside the app.

### 6. Data safety

⛔⛔ **THE TABLE BELOW WAS WRITTEN FOR THE MARKETPLACE AND IS NOW INCOMPLETE — READ THIS FIRST.**
The app renders eno.forum, which does everything eno.vn did AND sells e-Visas and takes payments.
Under-declaring is the mismatch that gets an app suspended after the fact, so the additions are
listed before the original table rather than after it.

| Additional category | Collected | Where, in the code |
|---|---|---|
| Government ID — passport image and MRZ | yes | the e-Visa application flow, `src/lib/visa/**`; the MRZ is read on-device (Tesseract) and the image is uploaded |
| Name, date of birth, nationality, passport number, entry dates | yes | the e-Visa dossier |
| Portrait photo | yes | the e-Visa portrait capture |
| Payment info | yes | the forum edition ships the real payments path — `src/lib/payments/**` — where eno.vn aliases it to a stub |
| Financial info (wallet) | capability ships | `src/lib/payments/crossmint.ts` is the REAL adapter on this edition (eno.vn gets `crossmint.stub.ts` via a next.config alias). Env-gated on `CROSSMINT_SERVER_SIDE_API_KEY` + `CROSSMINT_SIGNER_SECRET` |

⚠️ **DECLARE THE CAPABILITY THE APP SHIPS WITH, NOT TODAY'S ENV VALUES** — the same rule this file
already applies to Meta CAPI below. A custody wallet that is dormant because a key is unset is
still a custody wallet in the artifact.

⛔ **PLAY'S "FINANCIAL FEATURES" DECLARATION IS A SEPARATE FORM AND THE OLD CHECKLIST HAD NONE.**
This edition ships a payments path and a wallet adapter. Answer it, and answer it before someone
notices it was skipped.

⚠️ **"SHARED WITH THIRD PARTIES" — CONFIRM THE VISA RECIPIENT BEFORE SUBMITTING.** An e-Visa
dossier is fulfilled through a partner, and passport OCR may reach a cloud vision service. Both are
transfers of sensitive data and both must be named on the form. I did not verify the fulfilment
partner's identity from the code with enough confidence to write it down here; establish it and put
it in this file.

### 6b. The original marketplace table
Answer from what the app actually does. Collected, linked to the user, not sold:

| Category | Collected | Purpose |
|---|---|---|
| Name, email address | yes | account, seller identity |
| Phone number | yes | account, seller contact |
| User IDs | yes | account |
| Photos | yes | listing images, identity verification captures |
| Government ID | yes | KYC for seller verification |
| Approximate + precise location | optional | "use my location" in search and posting |
| Messages | yes | in-app buyer/seller chat |
| App interactions | yes | analytics |
| Crash logs, diagnostics | no | none shipped |

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
pixel. Push is not enabled in production, so no FCM token is collected today; the plugin ships
dormant, which is why the merged manifest lists `POST_NOTIFICATIONS`, `WAKE_LOCK`, the c2dm receive
permission and the Samsung badge permissions. Nothing requests them at runtime.

### 7. Store listing

⚠️ **REWRITTEN 2026-09-08 FOR THE FORUM APP.** The previous copy sold a marketplace and nothing
else, and its short description was 86 characters against an 80 limit — it could not have been
pasted in. Every string below is counted.

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
entity — see the entity note in step 0.

**Graphics.** Captured 2026-09-08 from the SIGNED RELEASE BUILD on the `eno_pixel` emulator at
1080×2400, in `play-store-assets/forum/`:

| File | Shows |
|---|---|
| `01-marketplace.png` | a real imported listing — HONOR 400 5G, 7,990,000 VND ≈ $312, Used, Hồ Chí Minh, "Buy on Minh Tuấn Mobile" |
| `02-evisa.png` | the Vietnam e-Visa landing page |
| `03-evisa-detail.png` | the e-Visa explainer and the product cards |
| `04-evisa-pdp.png` | an e-Visa product: fixed price in VND + USD, "Apply in chat", seller trust score |

⚠️ **STILL TO CAPTURE:** a browse/grid screenshot of the marketplace itself. The four above lean
e-Visa because the deep links that reach those pages are the ones that worked reliably from `adb`;
the browse screen needs a couple of taps past the first-run consent banner and the six-step Quick
Tour. Play wants at least two and takes up to eight.

⚠️ **THE PRODUCT IMAGES ARE WATERMARKED `eno.vn`** — visible in every screenshot, on an app that is
now eno.forum. Not a blocker and not a policy problem, but it is the app's own branding
contradicting itself in its own store listing. The watermark is applied at import/upload time, so
changing it is a re-watermark of existing images, not a config flip.

**Icon and feature graphic.** `play-store-assets/play-icon-512.png` (512×512) and
`play-feature-graphic-1024x500.png` (1024×500, no alpha) already exist and meet spec. ⚠️ The
feature graphic promises a marketplace only — worth re-cutting to say marketplace + e-Visa.

**Privacy policy URL:** `https://www.eno.forum/privacy` — ⚠️ NOT the eno.vn one the old listing
named. The app is the forum edition and Play expects the policy of the app it is reviewing.

**Account deletion URL:** `https://www.eno.forum/account-deletion` (added 2026-09-08 — Play's Data
safety form requires a URL reachable WITHOUT installing the app or signing in).

**Contact details** — required Console fields the old draft omitted entirely: a public support
email, and optionally a website and phone. Use the address the forum edition itself publishes,
`support@eno.forum`.

**Category and tags** — also absent from the old draft. `Shopping` is the honest primary category
(the marketplace is the bulk of the app); `Travel & Local` is the alternative if the e-Visa is to
lead. Pick one deliberately: it changes who the app is shown to.

### 8. Release
Start with **Internal testing**, install from the Play link on a real device, and only then promote
to Production. The first production review can take several days.

⚠️ Internal testing is also where the App Links step below gets its fingerprint, so expect to
upload once, fix assetlinks, deploy the site, and only then promote.

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
bytes.

Then **deploy the site** — the file reaches users only through `infra/vn-node/eno-deploy.sh` — and
verify:

```bash
curl -s https://eno.vn/.well-known/assetlinks.json
adb shell pm verify-app-links --re-verify vn.eno.app
adb shell pm get-app-links vn.eno.app      # every host should read "verified"
```

One file serves both editions: eno.vn and eno.forum are the same root built twice and share
`public/`. Verified 2026-09-08 by md5: the live bytes on eno.vn, eno.forum and www.eno.forum are
all the repo-root `public/.well-known/assetlinks.json`. The debug-key copy in
`apps/forum/public/` is DEAD CODE — that tree is dormant and nothing deploys it — but it is
git-tracked in a public repo and should be deleted or corrected as hygiene.

✅ **VERIFIED END TO END ON THE EMULATOR, 2026-09-08**, with the upload-key build installed:

```
$ adb shell pm get-app-links vn.eno.app
    Signatures: [3E:71:F7:BA:…:04:4F]
    Domain verification state:
      eno.vn: verified
      www.eno.forum: verified
      eno.forum: verified
```

⚠️ **eno.vn IS STILL CLAIMED, DELIBERATELY.** Every marketplace link ever shared points there;
dropping it would stop all of them opening the app. The router translates an eno.vn PATH onto the
app's own origin, which the forum can serve because it is a superset. `www.eno.vn` is NOT claimed —
its assetlinks.json answers 308 and the Android verifier does not follow redirects, so including it
would have failed verification for every host in the filter.

⚠️ **A BARE `https://www.eno.forum/` LINK OPENS THE BROWSER, NOT THE APP, AND THAT IS BY DESIGN.**
The filter is a path-prefix allowlist (`/listings`, `/c`, `/brands`, `/vietnam-evisa`, `/itinerary`)
because an Android intent-filter cannot express an exclusion, and `/auth` must never be captured —
a PKCE code is single-use, so an intercepted callback lands on an error. Widening to `/` would
capture it. Measured: a root link went to Chrome; `/listings/<id>` and `/vietnam-evisa` opened the
app and routed correctly, both cold and warm.

---

## The one policy risk worth knowing about

Play's **Minimum Functionality** policy rejects apps that are only a wrapper around a website. This
app is more than that and the listing should say so if asked: native camera capture for listing
photos and identity verification, verified App Links, home-screen shortcuts, an offline page with
retry, native splash and status-bar handling, hardware back navigation, haptics, native share, and
system-level text-size support. The dormant push plugin is wired but not enabled.

If a rejection cites minimum functionality, the answer is to point at those, not to add features.
