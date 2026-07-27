# T336 — verdict: reported cause DISPROVEN, a different live cause named

**No code change.** This was a reproduce-first task and it ends at the diagnosis: the fix is
outside its owned paths (`sign-in-form.tsx`, `turnstile.tsx`, `native-auth.ts`,
`capacitor.config.ts`).

## 1. The sign-in outage was real, and it IS fixed
Production logs, not inference: `[turnstile] rejected [ 'invalid-input-secret' ]` on every
attempt until 03:07:57Z, then `POST /api/auth/email-link 200` at 03:29:53Z and 03:30:55Z.
Zero 403s since. The app has been browsing authenticated ever since (`/api/me`,
`/dashboard/account`, `/messages` all 200 under `EnoNativeApp/1`).

## 2. It is NOT Turnstile-in-WebView, NOT CSP, NOT a wrong origin
- The built app loads `https://eno.vn` (`ios/App/App/capacitor.config.json`) — the exact
  hostname on the allowlist. Wrong-origin refusal is ruled out.
- The live sitekey fires `before-interactive-callback` with NO `error-callback`. Controls on the
  real origin: a nonexistent sitekey → `400020`, Cloudflare's always-blocks key → `600010`,
  always-passes-invisible → token. **Config faults are LOUD**; this one is accepted-and-silent.
- The 15s→120s interactive extension IS on main (`turnstile.tsx:197`), so production does not
  give WebView users 15 seconds.
- ⚠️ **Turnstile inside a real WebView remains UNTESTED, not disproven** — no `EnoNativeApp`
  request has ever reached `/api/auth/email-link`. It is also moot for this report.

## 3. THE ACTUAL BUG, still live: `POST /api/conversations` → 500 (P2002)
```
Invalid `prisma.conversation.update()` invocation:
Unique constraint failed on the fields: (`listingId`, `buyerProfileId`)   // P2002
```
`src/app/api/conversations/route.ts:116`. **12 occurrences in 24h**, 10 from
`EnoNativeApp/1` (iPhone OS 18_7), latest **2026-07-27T05:32:05Z**, plus 2 from desktop Mac
Chrome on 07-26 — so it is **not native-specific**; the app is just where it was hit.

Mechanism: the route enforces "one thread per buyer↔seller" by RETARGETING the newest existing
thread's `listingId`. Visa and trips share ONE seller (`Seller.ownerId` is `@unique`) and both
create threads directly (`src/lib/trips/dm-thread.ts:170`), so a buyer holding a visa thread AND
a trip thread has two rows; retargeting one onto the other's listing violates
`@@unique([listingId, buyerProfileId])` (schema.prisma:608). Line 116 sits OUTSIDE the P2002
catch that begins at :156, so it escapes as a 500. The user sees "Could not send. Try again."
— an ERROR on both surfaces, which matches "cannot apply for a visa nor itinerary error".

Confirmed against the production DB: 5 desk threads across 4 buyers, and exactly **1 buyer** in
the colliding state (has both, newest is not the anchor).

**Suggested fix:** wrap the retarget in its own P2002 recovery — on collision, reuse the
existing thread for the requested listing instead of moving the other one onto it.

## 4. A SEPARATE live defect (itinerary half)
Three CTAs still point at `/dashboard/trips/plan`, which has been a bare `redirect()` since T316
(`itinerary/page.tsx:128`, `:203`, `trip-detail-client.tsx:278`). The trips LIST has no planner
entry once `trips.length > 0` (`trips-client.tsx:129-149`). Production shows
`/dashboard/trips/plan` hit 6 times.
⚠️ Correction to a stronger earlier claim: this is **not** a total dead end. `AssistancePanel`
gives a route back to the desk chat — but only on the trip DETAIL page and only inside the
`hasStops` branch, so it does not rescue the list, and a legacy trip with NO stops is genuinely
circular.

## Simulator evidence
Built the app for iOS 18.4 (`BUILD SUCCEEDED`), installed and launched on iPhone 16 — it loads
live eno.vn and renders. Full tap-through was not possible: `idb` is installed but
`idb_companion` is not, and the deep link raises a native "Open in eno?" confirm. The decisive
evidence came from production logs instead, which is stronger than a simulator repro.
