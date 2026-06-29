# eno.vn API Reference

REST API for the eno.vn marketplace. All routes live under `/api`. Unless noted, request/response bodies are JSON.

## Auth legend

| Class | Meaning | Caller context |
|---|---|---|
| `none` | No authentication. Safe for anonymous browsers. | **public-browser** |
| `login` | Signed-in user (Supabase session). | **public-browser** (authenticated) |
| `owner` | Signed-in **and** must own the target listing/storefront (`checkListingOwner`). | **owner-scoped** |
| `business` | Signed-in with a **business-tier** Seller storefront. | **owner-scoped** |
| `admin` | Platform admin only. | **owner-scoped** (privileged) |
| `cron-bearer` | `Authorization: Bearer CRON_SECRET`, timing-safe compare. Vercel Cron only. | **server-to-server** |
| `supabase-hmac` | Standard-Webhooks HMAC signature from Supabase auth hook. | **server-to-server** |
| `basic-auth` | HTTP Basic (feed user/password). Open until creds configured. | **server-to-server** |

### Caller-context map

- **public-browser** — `none` / `login` routes called from the web app or anonymous clients.
- **owner-scoped** — mutations restricted to the resource owner: `owner`, `business`, `admin`, plus `login` message/notification/saved-search routes that filter by the caller's id (no cross-user 404 oracle).
- **server-to-server** — `cron-bearer`, `supabase-hmac`, `basic-auth`.
- **edge-pinned** — most routes require ingress through the pinned Cloudflare edge. **EDGE-PIN EXEMPT** routes (must accept off-edge callers): `/api/auth/send-sms`, `/api/cron/daily-reminders`, `/api/cron/saved-search-alerts`, `/api/feeds/facebook-catalog`, `/api/feeds/google-shopping`.

### Rate-limit modes

- **strict / fail-closed** — request is rejected if the limiter (Upstash) is unavailable. Used on abuse-sensitive or billable paths.
- **open / fail-open** — request proceeds if the limiter is unavailable. Used on UX-critical paths.

---

## Listings

### `GET, POST /api/listings`
- **Auth:** none
- **Rate limit:** GET none (CDN 15s / s-maxage 60 / swr 300); POST 15/h per-IP, open
- **Purpose:** GET public feed/search (verified + active only): facets, histogram, Vertex semantic ranking, `?ids` fast-path. POST guest-or-login create with instant auto-publish gate.
- **Request:** GET `?category,subcategory,district,province,ward,condition,q,sort,priceMin,priceMax,brand,model,attr_*,range_*,limit,offset,histogram,ids`; POST listing fields incl. `contactPhone`
- **Response:** GET `{ listings[], total, subcategoryCounts, categoryTotal }`; POST `{ id, verified }` (201)
- **Security:** `?verified` is ignored (always verified-only); phone-in-text blocked.

### `PATCH, DELETE /api/listings/[id]`
- **Auth:** owner · **Rate limit:** none
- **Purpose:** Seller edits/deletes their own listing (`checkListingOwner`); same guards as create — phone-block, image allowlist, `searchText` rebuild, republish-on-photo.
- **Request:** PATCH `{ title, description, price, district, condition, images, subcategorySlug, listingType, attributes, brand, model, <range cols> }`
- **Response:** `{ ok }`; 401 / 403 / 404

### `POST /api/listings/[id]/status`
- **Auth:** owner · **Rate limit:** none
- **Purpose:** Seller sets availability (active/sold/hidden); revalidates page, reindexes/removes from AI search.
- **Request:** `{ status: 'active' | 'sold' | 'hidden' }`
- **Response:** `{ ok, status }`; 400 `invalid_status`, 401 / 403

### `POST /api/listings/[id]/confirm`
- **Auth:** owner · **Rate limit:** none (in-handler bump cooldown via `canBump`)
- **Purpose:** "Still available?" confirm — Carousell-style bump (refreshes `postedAt` within cooldown), stamps availability, rewards trust.
- **Request:** path `id` · **Response:** `{ ok }`; 401 / 403

### `POST /api/listings/availability`
- **Auth:** owner · **Rate limit:** none (bump cooldown enforced)
- **Purpose:** Batch daily availability review scoped to caller's storefront: bump confirmed, mark rest sold (two `updateMany`).
- **Request:** `{ confirm: [ids ≤500], sold: [ids ≤500] }`
- **Response:** `{ ok, confirmed, markedSold }`; 401, 403 `no_storefront`

### `POST /api/listings/bulk`
- **Auth:** business · **Rate limit:** 10/h per-account, open
- **Purpose:** Business-tier bulk import (≤200 rows): server-revalidates each row, SSRF-guarded image re-hosting to Storage, own storefront, auto-publish gate.
- **Request:** `{ rows: [{ category_slug, title, description, price, district, condition, image_urls }] }`
- **Response:** `{ created, failed, results[], imageBudgetReached }`; 401, 403 `business_only` / `no_storefront`

---

## Search

| Path | Methods | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| `/api/search/resolve` | GET | none | 120/min per-IP, open (CDN 120s/swr600) | Intent resolver: does query name a brand/model? Returns facets to open, typo-tolerant, read-only. |
| `/api/search/suggest` | GET | none | 120/min per-IP, open (CDN 10s/swr30) | Instant typeahead over folded `searchText` (verified+active) + matching categories, trust-first. |
| `/api/recommendations` | GET | none | none (private max-age 30) | "For You" recs from client-passed signals (cats/brands/terms), trust-ranked, trending fallback. |
| `/api/category-rails` | GET | none | none (CDN 120s/swr300) | Home "browse by category" rails — demand-ranked, trust-first. |
| `/api/businesses/top` | GET | none | none (CDN 120s/swr300) | "Outstanding businesses" rail — one flagship listing per high-trust storefront. |
| `/api/brands` | GET | none | none (CDN 60s/swr300) | Brand catalogue read; `iconPath` resolved server-side. |
| `/api/brands/[slug]/models` | GET | none | none (CDN 60s/swr300) | Distinct models of a brand in live catalogue, demand-ranked; optional category scope. |

**`GET /api/search/resolve`** — Req `?q` (2–40 chars, ≤5 words) · Resp `{ brand, model?, category? }` | `{ brand: null }`
**`GET /api/search/suggest`** — Req `?q` (≥2 chars) · Resp `{ q, listings[≤6], categories[≤4] }`
**`GET /api/recommendations`** — Req `?cats&brands&terms` (csv, ≤6 each) · Resp `{ listings[], personalized }`
**`GET /api/category-rails`** — Resp `{ rails: [{ slug, listings[] }] }` (≤10 rails, 8 each, skips <4)
**`GET /api/businesses/top`** — Resp `{ listings[] }` (one card per seller, trust-ordered)
**`GET /api/brands`** — Req `?q&category&limit(≤200)` · Resp `{ brands: [{ slug, name, count, iconPath }] }`
**`GET /api/brands/[slug]/models`** — Req `?category` · Resp `{ models: [{ model, count }] }`

---

## AI

All AI routes require `login` and are **strict / fail-closed**. They draw on the Gemini / Vertex GenAI credit and return `503 ai_unavailable` (or `vertex_not_configured`) when unconfigured.

### `POST /api/ai/classify`
- **Rate limit:** 40/h per-account, strict
- **Purpose:** AI autofill — classify a product photo into taxonomy + suggest title/brand/specs (validated against taxonomy).
- **Request:** multipart `file` (≤12MB) + `lang`; downscaled to 512px
- **Response:** `{ categorySlug, subcategorySlug, listingType, condition, title, brand, brandUncertain, model, description, attributes }` | `{ unclear: true }`; 401 `auth_required`, 503 `ai_unavailable`

### `POST /api/ai/concierge`
- **Rate limit:** 10/h per-account, strict; + global daily breakers (Gemini 5k/day, Vertex 20k/day, both strict)
- **Purpose:** AI shopping concierge chat — NL query → grounded reply + matching listing cards (Vertex AI Search, Postgres keyword fallback).
- **Request:** `{ messages[], lang }`
- **Response:** `{ reply, listings[], source: 'vertex' | 'fallback' }`

### `POST /api/ai/rephrase`
- **Rate limit:** 60/h per-account, strict
- **Purpose:** AI "Polish" — rewrite a rough listing description into clean copy without inventing facts; strips phone numbers.
- **Request:** `{ text (≤5000), lang }`
- **Response:** `{ text }` (falls back to original if a phone slips in); 401, 503 `ai_unavailable`

### `POST /api/ai/visual-search`
- **Rate limit:** 10/h per-account, strict
- **Purpose:** Photo → text search query (+ best-guess category/brand) via Gemini Vision; caller runs normal keyword search.
- **Request:** multipart `file` (≤12MB)
- **Response:** `{ query, category, brand }` | `{ query: '', unclear: true }`; 401, 503

---

## Messaging / Contact

### `GET, POST /api/conversations`
- **Auth:** login · **Rate limit:** none
- **Purpose:** GET inbox (participant conversations); POST ensure-thread for `{ listingId }` (idempotent, optional first message/offer). Can't message own storefront.
- **Request:** POST `{ listingId, message?, offerAmount? }`
- **Response:** GET `{ conversations[] }`; POST `{ id, created, message }`; 400 `own_listing`, 404 `not_found` / `unverified`

### `GET, DELETE /api/conversations/[id]`
- **Auth:** login · **Rate limit:** none
- **Purpose:** GET one conversation + messages (participant-only, marks my side read); DELETE = per-user soft hide (reappears on new msg).
- **Response:** GET `{ id, me, listing, counterpart, messages[] }`; DELETE 204; 403 non-participant

### `POST /api/conversations/[id]/messages`
- **Auth:** login · **Rate limit:** 20/min per-account, open (fail-open)
- **Purpose:** Send a message (or structured offer); participant-only; Prisma insert + denormalized unread bump.
- **Request:** `{ body }` or `{ offerAmount }`
- **Response:** `SerializedMessage`; 403 forbidden (non-participant), 404

### `DELETE /api/conversations/[id]/messages/[mid]`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Delete your own message in a conversation you're part of; recomputes last-message preview.
- **Response:** 204; 403 forbidden (not sender), 404 (wrong convo)

### `POST /api/conversations/[id]/offer`
- **Auth:** login · **Rate limit:** 30/min per-account, open
- **Purpose:** Accept/decline a pending offer; actor must be the offer recipient (`actOnOffer`).
- **Request:** `{ messageId, action: 'accept' | 'decline' }`
- **Response:** `{ ok }` | 409 `not_actionable`; 403 forbidden

### `POST /api/conversations/[id]/typing`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Ephemeral typing signal via SECURITY DEFINER `broadcast_typing` (re-checks participation server-side; no client broadcast).
- **Response:** 204 (best-effort, never errors); 401

### `GET /api/conversations/unread`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Total unread across user's conversations (header/nav badge) via summed denormalized counters.
- **Response:** `{ unread }` (0 if signed out)

### `POST /api/listings/[id]/contact`
- **Auth:** login · **Rate limit:** 30/h per-user + 60/h per-IP, both strict (fail-closed)
- **Purpose:** Reveal seller phone — login (JWT-revalidated) **and requires** an existing convo where the seller has replied; logs lead + Meta CAPI Contact.
- **Response:** `{ phone, telHref, zaloHref }`; 401, 403 `reply_required`, 404

---

## Trust / Reports

### `POST /api/report`
- **Auth:** login · **Rate limit:** 10/h per-account, open + false-report cooldown (429 `report_cooldown`)
- **Purpose:** Report a listing/storefront (attributable, anti-abuse). `sellerId` always derived from listing; one open report per target identity.
- **Request:** `{ listingId?, sellerId?, reason, detail? }`
- **Response:** `{ ok }` (201 on create); 401, 400 `cannot_report_self`, 429

### `POST, PATCH /api/feedback`
- **Auth:** none (PATCH is admin-only) · **Rate limit:** POST 8/h per-account-or-IP, open; PATCH none
- **Purpose:** POST submit feedback/technical report (anonymous-friendly); PATCH resolve/reopen (admin).
- **Request:** POST `{ kind, message, email?, url? }`; PATCH `{ id, status }`
- **Response:** POST `{ ok }` (201) | 503 if Feedback table unmigrated; PATCH `{ ok }` / 403

### `POST /api/admin/moderate`
- **Auth:** admin · **Rate limit:** none
- **Purpose:** Moderation queue — approve/reject/unpublish listings and confirm/dismiss/abusive reports (moves trust scores).
- **Request:** `{ action, id, severity? }`
- **Response:** `{ ok }` — idempotent open→state transitions; penalties via trust events

---

## Feeds

Both feed routes are **EDGE-PIN EXEMPT**, `no-store`, `Vary: Authorization`. Basic-Auth is **open** until `FEED_USER` / `FEED_PASSWORD` are set.

### `GET /api/feeds/facebook-catalog`
- **Auth:** basic-auth · **Rate limit:** none
- **Purpose:** Meta commerce catalog CSV (sell-intent physical products only).
- **Request:** `?exclude_mock=1`; optional Basic auth
- **Response:** `text/csv` attachment; 401 when protected + wrong creds

### `GET /api/feeds/google-shopping`
- **Auth:** basic-auth · **Rate limit:** none
- **Purpose:** Google Merchant RSS/XML product feed (sell-intent physical products).
- **Request:** `?exclude_mock=1`; optional Basic auth
- **Response:** `application/xml`; 401 when protected + wrong creds

---

## Auth / Profile

### `POST /api/auth/send-sms`
- **Auth:** supabase-hmac · **Rate limit:** none (Supabase rate-limits OTP upstream) · **EDGE-PIN EXEMPT**
- **Purpose:** Supabase Send-SMS auth hook — delivers phone OTP via Zalo ZNS→SMS (eSMS) with SpeedSMS fallback.
- **Request:** Standard-Webhooks signed body `{ user.phone, sms.otp }`; `webhook-*` headers
- **Response:** `{}` 200 even on delivery hiccup (never aborts login); 401 invalid signature, never logs OTP

### `GET /api/account`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Signed-in user's account view: profile + storefront + own listings (localStorage-cached; this revalidates).
- **Response:** `{ account: { profile, seller|null, listings[] } }` — `account: null` (200) if signed out

### `GET /api/me`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Lightweight identity for account dropdown — who am I + do I own a storefront (post-as prefill).
- **Response:** `{ user: { displayName, email, phone, accountType, businessName, sellerId, seller } }` | `{ user: null }`

### `GET /api/dashboard`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Seller CRM dashboard payload — profile, storefront, stats (views/leads/stale/unread), listings; tier gates business sections.
- **Response:** `{ dashboard: { tier, profile, seller|null, stats, listings } }`; 401 `dashboard: null`

### `PATCH /api/profile`
- **Auth:** login · **Rate limit:** 20/h per-account, open
- **Purpose:** Edit own account profile (displayName/avatar/phone). Phone uniqueness enforced; rate-limited because `409 phone_taken` is an existence oracle.
- **Request:** `{ displayName?, avatarUrl?, phone? }` · **Response:** `{ ok }`; 400, 409 `phone_taken`, 429

### `POST /api/profile/account-type`
- **Auth:** login · **Rate limit:** none
- **Purpose:** One-time onboarding — set individual/business; business creates/claims a Seller storefront; first-touch attribution + Meta CAPI CompleteRegistration.
- **Request:** `{ accountType, businessName?, displayName?, phone? }`
- **Response:** `{ ok, accountType }`; 400 `invalid` / `business_name_required`, 409 `phone_taken`

### `GET, POST /api/profile/reminder-prefs`
- **Auth:** login · **Rate limit:** none
- **Purpose:** Get/set the daily availability-reminder opt-in.
- **Request:** POST `{ dailyReminderOptIn: boolean }`
- **Response:** `{ dailyReminderOptIn }` / `{ ok, dailyReminderOptIn }`; 401

### `PATCH /api/seller`
- **Auth:** owner · **Rate limit:** none
- **Purpose:** Seller edits their own storefront (name/bio/location/avatar/phone); phone-uniqueness + phone-in-text guards; one-time profile-complete trust bonus.
- **Request:** `{ name?, bio?, location?, avatarUrl?, phone? }`
- **Response:** `{ ok }`; 401, 403 `no_storefront`, 409 `phone_taken`

### Notifications

| Path | Methods | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| `/api/notifications` | GET, DELETE | login | none | GET recent notifications + unread count; DELETE clears all mine. |
| `/api/notifications/read` | POST | login | none | Mark read: `{ ids }` marks those; empty body marks all my unread. |
| `/api/notifications/[id]` | DELETE | login | none | Delete one of my notifications (`deleteMany` by recipientId — cross-user id no-ops, no 404 oracle). |

`GET /api/notifications` → `{ notifications[], unread }`; DELETE 204; 401 · `POST /read` → `{ ok }`; 401 · `DELETE /[id]` → 204; 401

### Saved searches

| Path | Methods | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| `/api/saved-searches` | GET, POST | login | none (cap 20/user) | List / save the current filter set (idempotent on identical params; ready-to-run URL; notify defaults on). |
| `/api/saved-searches/[id]` | DELETE, PATCH | login | none | Delete or toggle alerts on one saved search (owner-scoped `*Many` by profileId). |

`GET` → `{ searches[] }`; `POST { label?, params }` → `{ id, label, url }` (201); 409 `limit_reached` · `PATCH { notify: boolean }` → `{ ok }`; 401

### Web Push

| Path | Methods | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| `/api/push/subscribe` | POST | login | none | Store/refresh a Web Push subscription; endpoint SSRF-validated; upserts by endpoint. |
| `/api/push/unsubscribe` | POST | login | none | Remove a browser's push subscription (owner-scoped `deleteMany` by endpoint + profileId). |

`POST /subscribe { endpoint, keys: { p256dh, auth } }` → `{ ok }`; 400 `invalid_subscription`, 401 · `POST /unsubscribe { endpoint }` → `{ ok }`; 401

---

## Cron

Both cron routes are **server-to-server**, `cron-bearer` auth (`Authorization: Bearer CRON_SECRET`, timing-safe), `maxDuration 60s`, and **EDGE-PIN EXEMPT**. Invalid auth → 401.

### `GET /api/cron/daily-reminders`
- **Rate limit:** none (~1/day per recipient dedupe)
- **Purpose:** Vercel Cron — nudge sellers with stale live listings (in-app notif + Web Push) + run trust maintenance.
- **Response:** `{ ok, sellersWithStale, notified, pushed, trust }`; 401

### `GET /api/cron/saved-search-alerts`
- **Rate limit:** none
- **Purpose:** Vercel Cron — for each notify-on saved search, alert on new matches since `lastNotifiedAt` (notif + push).
- **Response:** `{ ok, searches, notified, pushed }`; 401

---

## Tracking

### `POST /api/track/view`
- **Auth:** none · **Rate limit:** 240/min per-IP, open
- **Purpose:** Server-side Meta CAPI ViewContent relay (Pixel backstop, consent-gated client beacon, dedup via shared `eventId`). Only for verified + active items.
- **Request:** `{ id, eventId }` · **Response:** 204 always (no-ops if CAPI unconfigured)

---

## Ops / Other

### `POST /api/upload`
- **Auth:** none · **Rate limit:** authed 120/h per-account open; anon 30/h per-IP strict (fail-closed)
- **Purpose:** Image upload (guest-allowed) — decode/validate via sharp (raster only, no SVG), strip EXIF/GPS, downscale → WebP, store in Supabase bucket.
- **Request:** multipart `files[]` (≤8, ≤12MB each; jpeg/png/webp) · **Response:** `{ urls[], failed }`; 429

### `POST /api/translate`
- **Auth:** none · **Rate limit:** 60/min per-IP, strict — applied ONLY to uncached/billable requests
- **Purpose:** Batch translate; cache hits are free and always served (even on Redis outage); only new/billable strings are bounded + limited.
- **Request:** `{ texts: string[] ≤1500, target: Lang }` (≤250 new / ≤30k new chars) · **Response:** `{ translations[] }`; 400 size, 429

### `GET /api/fx`
- **Auth:** none · **Rate limit:** none (revalidate 6h, CDN cached)
- **Purpose:** Live FX rates per 1 VND for display-currency conversion (free upstream, fails soft to VND).
- **Response:** `{ base: 'VND', rates{}, updated }`

### `GET /api/geo`
- **Auth:** none · **Rate limit:** none (CDN cached hard)
- **Purpose:** Static VN 2025 administrative reference data (provinces / wards), HCMC first.
- **Request:** `?type=provinces|wards&province=<code>` · **Response:** `{ provinces[] }` | `{ wards[] }`

### `GET /api/reverse-geocode`
- **Auth:** none · **Rate limit:** 30/min per-IP, strict (fail-closed)
- **Purpose:** Reverse-geocode lat/lng → address + HCMC district (Google Geocoding paid, Nominatim free fallback).
- **Request:** `?lat&lng&lang` · **Response:** `{ address, district, province, ward, wardCandidates }`; 400 `missing_coords`, 429, 502

### `POST /api/csp-report`
- **Auth:** none · **Rate limit:** 60/min per-IP, open
- **Purpose:** CSP violation collector (report-uri + Reporting API shapes); logs one line per violation, always 204, size-capped.
- **Request:** CSP report JSON (≤16KB) · **Response:** 204 (no feedback to probers)

### Admin tools

All admin routes require `admin` auth and have no rate limit.

| Path | Methods | Purpose | Request | Response |
|---|---|---|---|---|
| `/api/admin/listings` | GET, POST | Search/filter/paginate + batch actions over selected ids. | GET `?q&status&verified&limit&offset`; POST `{ action: delete\|hide\|activate\|feature\|unfeature\|verify\|unverify, ids[≤500] }` | GET `{ listings[], total }`; POST `{ ok, affected }` (reindexes AI search in `after()`) |
| `/api/admin/brands` | GET, PATCH, POST | Brand catalogue admin: list, edit, merge. | PATCH `{ id, ... }`; POST `{ action: 'merge', sourceId, targetId }` | GET `{ brands[] }`; PATCH/POST `{ ok: true }` (logoPath SVG-sanitized server-side) |
| `/api/admin/brands/ai` | POST | Gemini-assisted brand curation: canonical name + validated simple-icons slug. | `{ name }` | `{ name, iconSlug, iconPath, note }`; 503 if Gemini unconfigured |
| `/api/admin/backfill-brand-logos` | POST | Backfill monotone brand logos from theSVG (paced 150ms/brand, maxDuration 60s). | `?force=1`, `?limit=1..100` (default 40) | `{ processed, updated, found[], matchingTotal, note }` |
| `/api/admin/vertex-backfill` | POST | Re-runnable backfill pushing every public listing into Vertex AI Search (maxDuration 300s, cursor-paged). | `?max=1..20000` (default 5000) | `{ ok, indexed }`; 503 `vertex_not_configured` |
