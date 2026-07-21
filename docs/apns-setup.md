# Turning on native push (and the app-icon badge)

The app-icon badge — the red circle counting unread notifications + messages — is **built and
deployed**, but it is inert until APNs credentials exist. Nothing in the app needs rebuilding:
iOS applies `aps.badge` to the icon itself on delivery, so the counter starts working on the
build that is already installed the moment these environment values are set.

Same for native push in general. `src/lib/native-push.ts` no-ops entirely when the credentials
are absent, which is why the app has been quiet rather than broken.

Check the current state at any time:

```bash
set -a; . ./.env; set +a
node scripts/push-test.mjs
```

---

## 1. Create the APNs auth key (Apple, ~2 minutes)

One key works for **every** app on the team, for both sandbox and production, and does not
expire. Apple allows two at a time.

1. <https://developer.apple.com/account/resources/authkeys/list> → **＋**
2. Name it something like `eno push`, tick **Apple Push Notifications service (APNs)**,
   Continue → Register.
3. **Download the `.p8`.** Apple lets you download it exactly once — losing it means revoking
   and starting over.
4. Note the **Key ID** (10 chars, also in the filename `AuthKey_XXXXXXXXXX.p8`).
5. Team ID is top-right of the developer portal, or under Membership (10 chars).

## 2. Encode the key

The `.p8` is a multi-line PEM. It is stored **base64-encoded** because the deploy pipeline
loads secrets through a dotenv file, and a raw multi-line value with newlines is not shell-safe
— the same rule that already applies to the Google service-account JSON. `native-push.ts`
decodes it automatically (`decodeMaybeB64`).

```bash
base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
```

## 3. Set the values

| Variable | Value | Notes |
|---|---|---|
| `APNS_KEY` | the base64 string from step 2 | not the file path, not the raw PEM |
| `APNS_KEY_ID` | the 10-char Key ID | |
| `APNS_TEAM_ID` | the 10-char Team ID | |
| `APNS_BUNDLE_ID` | `vn.eno.app` | must match the installed app exactly |
| `APNS_PRODUCTION` | `true` or omit | **see below — this is the one that bites** |

### ⚠️ `APNS_PRODUCTION` must match how the build was signed

This is the most common silent failure, and it looks identical to "push is broken": every send
returns `BadDeviceToken` and nothing arrives.

- **TestFlight or App Store build** → `APNS_PRODUCTION=true` (`api.push.apple.com`)
- **Xcode / debug build on a cabled device** → leave it unset (sandbox)

A device token is only valid on the environment its build was signed for. If you test with a
debug build and later ship through TestFlight, this value has to change with it.

### Where they go

Production reads a single dotenv secret. Append the five lines to a **new version** of it and
redeploy — Cloud Run picks up the new version on the next revision:

```bash
gcloud secrets versions access latest --secret=eno-root-env > /tmp/env
# append the APNS_* lines to /tmp/env, then:
gcloud secrets versions add eno-root-env --data-file=/tmp/env
shred -u /tmp/env    # or: rm -P /tmp/env
```

Then redeploy (`gcloud builds submit --config cloudbuild.yaml`). Add the same lines to your
local `.env` to test from a laptop.

## 4. Verify

```bash
set -a; . ./.env; set +a
node scripts/push-test.mjs                       # config only
node scripts/push-test.mjs --send you@email.com  # real push + badge to your devices
```

The script builds the auth JWT, prints the resolved host, and decodes every APNs rejection into
what actually causes it — `BadDeviceToken` (sandbox/production or bundle mismatch),
`InvalidProviderToken` (key/team mismatch or revoked), `TopicDisallowed` (bundle id isn't this
key's app), `Unregistered` (app deleted).

If it reports **0 registered iOS devices**, open the app once while signed in: registration
happens in `src/components/native/native-push.tsx` and POSTs the token to
`/api/push/native-subscribe`.

---

## How the badge behaves once this is on

- **Goes up**: every push carries the profile's true unread total (notifications + unread chat
  messages, `src/lib/unread.ts`). The value is *absolute*, not a delta, so it also repairs a
  badge that drifted while the app was closed.
- **Goes down**: `syncBadgeToProfile()` sends a badge-only push (no alert, no sound) when
  notifications are marked read and when a conversation is opened — the two moments the count
  drops with no ordinary push to carry it.
- **Fails soft**: if the count can't be read the badge is *omitted* rather than set to 0,
  because clearing a badge we couldn't measure is worse than leaving it. A missed sync
  self-heals on the next real push.

### Android

`FCM_PROJECT_ID` + `FCM_CREDENTIALS` (service-account JSON, base64) enable Android push. The
badge there is best-effort by nature: FCM `notificationCount` is sent, but the badge is drawn by
the launcher — Samsung and Xiaomi render the number, stock Android shows only a dot — and there
is no server-side clear, since the badge is tied to a visible notification. Treat iOS as the
guarantee.

### Still worth doing later

When a native build ships for other reasons, adding a Capacitor badge plugin would let the count
also sync on app *resume*, rather than only when a push arrives. Not worth a build on its own.
