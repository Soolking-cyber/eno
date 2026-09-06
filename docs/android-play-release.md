# Shipping the Android app to Google Play

The Capacitor Android app for **eno.vn**, package `vn.eno.app`. Written 2026-09-06 against a
verified signed build; every command here was run.

⛔ **Most releases of this app are NOT Play releases.** Capacitor runs in remote-server mode: the
WebView loads `https://eno.vn`, so a product change reaches installed apps the moment the site
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

### 0. There is no developer account yet — this is step zero
Checked 2026-09-06 in the browser: `play.google.com/console` redirects **both**
`shanazar15071994@gmail.com` and `support@eno.forum` to `/signup`. No Play developer account exists
on either. Everything below is blocked until one is created, and creating it is an owner action:
it takes a $25 registration fee and identity verification, neither of which can be delegated.

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
Most of the marketplace is behind a sign-in. Under **App access**, choose "All or some
functionality is restricted" and give the reviewer a working account: email, password, and the note
that sign-in is by email code so the reviewer needs an inbox they control, or supply a seeded
account whose code you can relay. A reviewer who cannot get past the sign-in wall rejects the app.

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

**App name (30 max)**
```
eno — Vietnam Expat Market
```

**Short description (80 max)**
```
Buy, sell and rent in Vietnam. Trusted sellers, real listings, English and Tiếng Việt.
```

**Full description (4000 max)**
```
eno is the marketplace for expats and internationals living in Vietnam.

Find what you need
• Housing and rentals, from studios to serviced apartments
• Motorbikes, bicycles and cars
• Furniture and appliances, including whole moving sales
• Electronics and phones
• Jobs and local services

Sell in minutes
Post a listing with photos from your phone, set a price in VND, and reply to buyers in the app.
No listing fees.

Built for trust
Every seller carries a public trust score built from real evidence, not stars alone. Business
sellers can verify their registration. Listings that break the rules get reported by the community
and reviewed. Prices are shown in Vietnamese đồng with a US dollar reference, so you always know
what you are paying.

Your language
The whole app works in English and Tiếng Việt, with nine more languages for listing content.

Made for Vietnam
Search by city and district, see listings on a map, and message sellers directly. Offers are built
in, so you can negotiate without leaving the app.
```

Graphics: three phone screenshots are already captured from the **signed release build** running
on a Pixel emulator at 1080×2400, in `play-store-assets/`:

| File | Shows |
|---|---|
| `01-explore.png` | header search, partner banner, category rail, facets, "10,046 listings", grid |
| `02-listing.png` | price in VND with a USD reference, trust score, seller, safety notice |
| `03-saved.png` | the saved-listings tab |

Still to make: app icon 512×512 PNG and feature graphic 1024×500. Both need a designer or an export
from the brand mark; they are the only listing assets not covered.

Privacy policy URL: `https://eno.vn/privacy` (live, verified 200).

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

Once the bundle is uploaded, Play Console → Test and release → Setup → **App integrity** → App
signing key certificate → copy the SHA-256, then pass **both**, because the second argument replaces
the file rather than appending to it:

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
`public/`.

---

## The one policy risk worth knowing about

Play's **Minimum Functionality** policy rejects apps that are only a wrapper around a website. This
app is more than that and the listing should say so if asked: native camera capture for listing
photos and identity verification, verified App Links, home-screen shortcuts, an offline page with
retry, native splash and status-bar handling, hardware back navigation, haptics, native share, and
system-level text-size support. The dormant push plugin is wired but not enabled.

If a rejection cites minimum functionality, the answer is to point at those, not to add features.
