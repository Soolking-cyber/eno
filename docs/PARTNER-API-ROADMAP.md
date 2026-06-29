# PARTNER-API-ROADMAP.md

> A concrete path to let shops manage their eno.vn storefront programmatically — from their own backends and from AI agents — built on the marketplace's current reality (Supabase Auth + 1:1 `Profile`, RLS-bypassed app-code authz, denormalized trust, instant-publish listings, Upstash rate limits, `after()` side-effects). Every proposal below is tagged **REUSE-EXISTING** (wrap/expose code that already ships) or **BUILD-NEW** (net-new code).

---

## 1. Goals & Use Cases

The partner surface exists so a **shop** (a `business`-tier `Seller` storefront) can run its eno.vn presence from its own systems, and so an **AI agent** can do the same in natural language on the shop's behalf. Concretely:

| # | Use case | Backing reality today |
|---|---|---|
| U1 | Create listings from an external PIM/ERP | `POST /api/listings` create path + `/api/listings/bulk` (business-tier, ≤200 rows, SSRF-guarded re-host) **REUSE-EXISTING** |
| U2 | Update price/description/specs/photos | `PATCH /api/listings/[id]` (sparse, owner-gated, re-publish-on-photo) **REUSE-EXISTING** |
| U3 | Manage availability (active/sold/hidden, daily "still available?" bump) | `POST /api/listings/[id]/status`, `/confirm`, `/availability` **REUSE-EXISTING** |
| U4 | Upload media programmatically | `POST /api/upload` (sharp re-encode, EXIF strip, pinned bucket) **REUSE-EXISTING** |
| U5 | Bulk-sync an entire catalogue (upsert + retire) | `/api/listings/bulk` covers create; **upsert-by-external-id + retire-missing is BUILD-NEW** |
| U6 | Read storefront analytics (views, leads, stale, unread, per-listing) | `GET /api/dashboard` already computes stats **REUSE-EXISTING**; per-listing time series **BUILD-NEW** |
| U7 | React to events (new lead/message, report, listing held, offer) | No push surface today → **webhooks BUILD-NEW** |
| U8 | Do all of U1–U7 conversationally via Claude/an agent | **MCP server BUILD-NEW** wrapping the v1 API |

**Non-goals (v1):** reading buyers' PII in bulk (the feed already hard-nulls `seller.phone`; contact stays gated behind `/api/listings/[id]/contact`'s reply-required rule), acting as a buyer (messaging/offers/contact-reveal stay human+session-only), and any write to trust/moderation (admin-only forever).

---

## 2. Machine AuthN / AuthZ

### 2.1 The constraint that shapes everything

eno.vn has **no RLS** — "app code is the only guard," and every ownership decision today runs through `getCurrentProfile()` (JWT-revalidating) or `getCurrentProfileId()` (local JWKS verify). A partner API cannot reuse browser session cookies, so it needs a **third identity helper** that resolves a credential → `profileId` → owned `Seller`, then funnels into the *exact same* ownership checks (`checkListingOwner`, `phoneTakenByOther`, the bulk route's `ownerId === profileId` rule). The credential layer is new; the authz it feeds is **REUSE-EXISTING**.

### 2.2 Recommendation: API keys now, OAuth2 client-credentials later

**Phase 1–3 — per-shop API keys (BUILD-NEW).** Simplest correct thing for first-party shops and our own MCP server:

- A new `ApiKey` model: `{ id, sellerId, profileId, name, prefix, hash, scopes[], lastUsedAt, expiresAt?, revokedAt?, createdByIp }`. Store only a **SHA-256 hash**; show the secret once. Key format `eno_sk_live_<prefix>.<secret>` (prefix is indexed plaintext for O(1) lookup + display; secret is hashed). This mirrors the project's existing "show-once, store-hash" instincts (cf. `CRON_SECRET`/`SEND_SMS_HOOK_SECRET` timing-safe compares — **reuse the `crypto.timingSafeEqual` pattern** already in `daily-reminders` and `send-sms`).
- Keys are **minted only by a business-tier owner** of a `Seller`, in the dashboard (`/dashboard` settings → "Developers"). `accountType` and storefront ownership are already established at `/api/profile/account-type`; a key inherits that storefront's `sellerId`/`ownerId` — there is no way to mint a key for a storefront you don't own.

**Phase 4+ — OAuth2 client-credentials (BUILD-NEW, optional).** For third-party SaaS integrators (Shopify-style apps acting for many shops), add a token endpoint issuing short-lived (~1h) JWTs. We already run **asymmetric ES256 signing** via Supabase JWKS and `getCurrentProfileId()` verifies tokens locally — a partner JWT can reuse that verification posture (own issuer, own JWKS, `sub = profileId`, `scope` claim). Don't build this until a real third-party integrator exists; API keys cover U1–U8.

### 2.3 Scopes

Coarse, capability-based, checked in the auth middleware before the handler runs:

| Scope | Grants | Maps to existing route(s) |
|---|---|---|
| `listings:read` | read own listings + analytics rows | `/api/account`, `/api/dashboard` (filtered to seller) |
| `listings:write` | create / edit / delete / status / bulk | `POST/PATCH/DELETE /api/listings*`, `/availability`, `/confirm`, `/bulk` |
| `media:write` | upload images | `/api/upload` |
| `analytics:read` | stats + per-listing series | `/api/dashboard` stats + new series endpoint |
| `webhooks:manage` | register/rotate webhook endpoints | new |

Default a new key to `listings:read` + `analytics:read` (least privilege); writes are opt-in. **No scope** ever grants buyer messaging, contact reveal, trust, moderation, or another shop's data.

### 2.4 How it maps to ownership + RLS-bypass

The new `resolveApiKey(req)` helper (BUILD-NEW, `src/lib/partner-auth.ts`, `'server-only'`):

1. Parse `Authorization: Bearer eno_sk_live_<prefix>.<secret>`.
2. Look up by `prefix`, `timingSafeEqual(sha256(secret), row.hash)`, reject if `revokedAt`/`expiresAt` passed → `401 invalid_key`.
3. Check requested scope ⊆ `row.scopes` → `403 insufficient_scope`.
4. Return `{ profileId, sellerId, scopes }`. **Every downstream query is scoped by `sellerId`/`profileId`**, exactly like `checkListingOwner` does today (`listing.sellerId === seller.id`). Because Prisma bypasses RLS, this scoping *is* the security boundary — the same invariant the docs call out: "A route that forgets to scope a query by the caller's profile id is a real vulnerability." Partner routes get the same lint/review discipline.

Crucially, API-key auth is on the **instant-revocation** model (DB lookup every request, like `getCurrentProfile()`), so `revokedAt` takes effect immediately — unlike the ~1h-stale `getCurrentProfileId()` path. Good: a leaked key must die on revoke.

---

## 3. Resource Model & Endpoints (`/api/v1`)

All partner routes live under `/api/v1/*`, separate from the session-based internal routes (which stay as-is — no breaking changes). Internal handlers are refactored to share a core function that both the session route and the v1 route call, so logic isn't duplicated.

### 3.1 Shop / storefront

| Method | Path | Scope | Backing |
|---|---|---|---|
| `GET` | `/api/v1/shop` | `listings:read` | **REUSE** `/api/dashboard` + `/api/seller` shape: returns the caller's `Seller` (name, bio, location, trustScore, trustTier, tier). |
| `PATCH` | `/api/v1/shop` | `listings:write` | **REUSE** `PATCH /api/seller` core (name/bio/location/avatar/phone, phone-uniqueness + phone-in-text guards, one-time profile-complete trust bonus). |

### 3.2 Listings CRUD

| Method | Path | Scope | Backing |
|---|---|---|---|
| `GET` | `/api/v1/listings` | `listings:read` | **BUILD-NEW thin wrapper** over the seller-scoped query behind `/api/account`/`/api/dashboard` — returns the caller's listings **including held (`verified:false`) and sold/hidden**, which the public `GET /api/listings` deliberately never exposes. Keyset paginated. |
| `POST` | `/api/v1/listings` | `listings:write` | **REUSE** `POST /api/listings` create core (taxonomy normalize, phone-in-text block, image allowlist, autoPublish gate, `after()` syndication/CAPI/reindex). Identity comes from the key's `sellerId`, not guest-phone resolution. |
| `GET` | `/api/v1/listings/{id}` | `listings:read` | **REUSE** serialize; owner-scoped (404 if not yours — no cross-shop oracle). |
| `PATCH` | `/api/v1/listings/{id}` | `listings:write` | **REUSE** `PATCH /api/listings/[id]` core + `checkListingOwner`. |
| `DELETE` | `/api/v1/listings/{id}` | `listings:write` | **REUSE** `DELETE /api/listings/[id]` core. |
| `POST` | `/api/v1/listings/{id}/status` | `listings:write` | **REUSE** `/status` (active/sold/hidden). |
| `POST` | `/api/v1/listings/{id}/confirm` | `listings:write` | **REUSE** `/confirm` (bump w/ 7-day cooldown). |
| `POST` | `/api/v1/listings/availability` | `listings:write` | **REUSE** `/api/listings/availability` (batch confirm/sold). |

### 3.3 Media

| Method | Path | Scope | Backing |
|---|---|---|---|
| `POST` | `/api/v1/media` | `media:write` | **REUSE** `/api/upload` core (sharp decode/validate, EXIF strip, WebP q82, pinned `LISTINGS_BUCKET`). Returns `{ urls }` that are already valid against `isListingImageUrl`, so they slot straight into `POST/PATCH /api/v1/listings`. |

Partners may also pass remote `image_urls` in bulk and let the **bulk route's existing SSRF-guarded re-host** fetch + sharp-process them (**REUSE** `/api/listings/bulk`).

### 3.4 Bulk sync

| Method | Path | Scope | Backing |
|---|---|---|---|
| `POST` | `/api/v1/listings/bulk` | `listings:write` | **REUSE** `/api/listings/bulk` (≤200 rows, business-only, per-row revalidate, image budget). |
| `POST` | `/api/v1/listings/sync` | `listings:write` | **BUILD-NEW.** True upsert+retire keyed on a partner-supplied `externalId`. Needs a new nullable `Listing.externalId` column (unique per `sellerId`). Rows with a known `externalId` → PATCH core; unknown → create core; `externalId`s absent from the payload (when `mode:"full"`) → set `status:'sold'` (never hard-delete on sync). Returns `{ created, updated, retired, failed, results[] }`. |

`externalId` is the one schema change that unlocks idempotent catalogue mirroring — without it, an ERP that re-posts its catalogue nightly would duplicate every item.

### 3.5 Analytics

| Method | Path | Scope | Backing |
|---|---|---|---|
| `GET` | `/api/v1/analytics/summary` | `analytics:read` | **REUSE** `/api/dashboard` stats block (views/leads/stale/unread) scoped to the shop. |
| `GET` | `/api/v1/analytics/listings` | `analytics:read` | **BUILD-NEW.** Per-listing views/leads. Today views come via `/api/track/view` (CAPI relay, fire-and-forget, **not persisted per-listing in a queryable series**) and leads via the `contactReveals`/lead log. v1 needs a lightweight `ListingDailyStat {listingId, day, views, leads}` rollup table populated in the existing daily cron. **Do not** invent a real-time analytics pipeline; a daily rollup matches the rest of the system's eventual-consistency posture. |

---

## 4. Cross-Cutting Concerns

### 4.1 Rate limits & quotas (REUSE Upstash, BUILD-NEW keying)

The project already has a fail-open/fail-closed `rateLimit(bucket, key, n, window)` helper (Upstash). Partner routes **reuse it, keyed by `apiKeyId`** instead of IP/account:

- `listings:read` / `analytics:read` → generous, **fail-open** (read outages mustn't block a partner dashboard), e.g. 600/min.
- `listings:write` → **fail-closed strict**, e.g. 120/min + a daily create quota tied to tier (mirrors the spirit of `listing-create` 15/h-per-IP and bulk 10/h). Writes fan out to paid translation + syndication + CAPI in `after()`, so the existing per-create cost rationale carries over.
- `media:write` → reuse `/api/upload`'s 120/h shape, keyed per-key.
- Surface limits as `X-RateLimit-Limit / -Remaining / -Reset` headers (BUILD-NEW, trivial).

Because partner traffic hits `*.vercel.app` or `eno.vn`, the **edge-ingress guard** (`EDGE_SECRET` / `x-eno-edge`) matters: either (a) **EDGE-PIN EXEMPT** `/api/v1/*` like crons/feeds/send-sms (they carry their own bearer auth and aren't IP-rate-limited), or (b) require partners through Cloudflare. **Recommendation: exempt `/api/v1/*`** in `src/middleware.ts` (one line, matching the existing exemption list) since key-keyed limits don't depend on `cf-connecting-ip`.

### 4.2 Idempotency keys (BUILD-NEW)

Writes accept an `Idempotency-Key` header. Store `{ key, apiKeyId, requestHash, responseJson, status, createdAt }` in Redis (Upstash, already present) with a 24h TTL. Same key + same body → replay the stored response; same key + different body → `409 idempotency_conflict`. This makes `POST /api/v1/listings` and `/sync` safe to retry — essential for agents and flaky partner networks. The create path's `after()` side-effects must run **only on first execution**, not on replay.

### 4.3 Pagination (BUILD-NEW, keyset)

List endpoints use **keyset (cursor) pagination**, not offset — consistent with the feed's stable tiebreak chain `[{sellerTrustScore:'desc'},{featured:'desc'},{postedAt:'desc'},{id:'desc'}]`. Cursor encodes the last `(postedAt,id)`; response: `{ data[], next_cursor|null }`, `?limit` ≤100 default 25. Offset pagination on a denormalized, constantly-reordered feed drifts; keyset doesn't.

### 4.4 Error format (BUILD-NEW, unify existing codes)

The internal routes already return string codes (`no_phone_in_listing`, `phone_taken`, `reply_required`, `business_only`, `invalid_status`, `title_too_short`, `invalid_price`). v1 wraps these in a stable envelope:

```json
{ "error": { "code": "no_phone_in_listing",
             "message": "Contact numbers aren't allowed in listing text.",
             "field": "description",
             "request_id": "req_..." } }
```

Reuse the existing codes verbatim so internal and partner semantics never diverge. Always emit `request_id` (a generated id logged server-side) for support.

### 4.5 Versioning

Path-versioned `/api/v1`. Additive changes (new fields, new endpoints) stay in v1; breaking changes mint `/api/v2`. Deprecations announced via a `Sunset` header + the webhook `api.deprecation` event. Internal session routes are explicitly **unversioned and private** — partners never touch them.

### 4.6 Webhooks (BUILD-NEW)

There is **no outbound event surface today** — the system pushes to users via in-app notifications + Web Push, never to third parties. Add:

- `WebhookEndpoint { id, sellerId, url, secret, events[], active, failureCount, disabledAt? }`.
- **Signing reuses the inbound Standard-Webhooks HMAC pattern** the codebase already trusts for `send-sms`: sign the raw body, send `webhook-id` / `webhook-timestamp` / `webhook-signature`. Partners verify with the per-endpoint `secret`.
- **Delivery via `after()`** (the project's load-bearing post-response primitive) on a thin queue, with retry + exponential backoff; auto-disable after N consecutive failures (mirror the trust-cron's bounded, failure-isolated loop style).
- SSRF-guard the target `url` on registration with the **same allowlist/validator used for push endpoints and bulk image re-hosting** (`/api/push/subscribe` already SSRF-validates endpoints).

Initial event catalogue, all derived from existing internal moments:

| Event | Fired where today |
|---|---|
| `listing.published` / `listing.held` | create/PATCH autoPublish gate (`verified` flip) |
| `listing.updated` / `listing.deleted` | PATCH / DELETE |
| `listing.status_changed` | `/status`, `/availability` (sold/hidden) |
| `lead.created` | `/api/listings/[id]/contact` (already logs lead + CAPI `Contact`) |
| `message.received` | `POST /api/conversations/[id]/messages` |
| `offer.created` / `offer.resolved` | offer message / `/offer` accept-decline |
| `report.confirmed` | `/api/admin/moderate` confirm (listing reactively unpublished) |
| `trust.changed` | `recomputeTrust` dual-write |

Webhooks let a shop's system react without polling — the agent/automation counterpart to the human's push notifications.

---

## 5. MCP Server (AI agents manage shops in natural language)

A standalone **MCP server (BUILD-NEW)** that wraps `/api/v1` so Claude (and other MCP clients) operate a storefront conversationally. It is a *thin client of the partner API* — it holds no privileged DB access and inherits every guard (scopes, ownership scoping, rate limits, idempotency, phone-in-text block, autoPublish gate).

### 5.1 Auth

- The MCP server authenticates to `/api/v1` with a **shop-scoped API key** supplied by the operator (env / MCP config), or via OAuth client-credentials in Phase 4. One running MCP instance = one shop (or a multi-tenant deployment that selects the key per session). The agent never sees the raw key — it calls tools; the server attaches the credential.
- Default the key to a **restricted scope set** for agents: `listings:read`, `analytics:read`, and `listings:write` **without** delete. Offer a "review mode" where write tools return a **diff/preview** and require a confirm tool call before committing.

### 5.2 Proposed tools

| Tool | Wraps | Notes |
|---|---|---|
| `search_my_listings` | `GET /api/v1/listings` | filter by status/category; includes held/sold |
| `get_listing` | `GET /api/v1/listings/{id}` | |
| `create_listing` | `POST /api/v1/listings` | server enforces ≥1 photo for autoPublish; tool returns `verified` so the agent can tell the user "live" vs "held — add a photo" |
| `update_listing` | `PATCH …/{id}` | sparse; surfaces `title_too_short`/`invalid_price`/`no_phone_in_listing` as readable guidance |
| `set_availability` | `/status` + `/availability` | "mark these sold", "confirm all still available" |
| `upload_image_from_url` | `POST /api/v1/media` (or bulk re-host) | agent passes an image URL; server re-encodes + pins |
| `sync_catalogue` | `POST /api/v1/listings/sync` | idempotent via `externalId` + `Idempotency-Key` |
| `get_shop_analytics` | `/api/v1/analytics/*` | "how many views/leads this week" |
| `get_shop_profile` / `update_shop_profile` | `GET/PATCH /api/v1/shop` | |

**Deliberately excluded tools:** anything that reads buyer PII in bulk, sends buyer messages, reveals contacts, or touches trust/moderation. The agent manages *the shop's own inventory and storefront*, nothing else.

### 5.3 Guardrails

- **Server-side validation is the boundary, not the prompt.** The MCP server adds no trust; the v1 API re-validates everything (phone-in-text, image allowlist, taxonomy, ownership). An agent hallucinating a phone number in a description is caught by `containsPhoneNumber` exactly as a human post is.
- **Idempotency on every write** so a retrying/looping agent can't double-create.
- **Confirmation gates** on destructive ops (`delete_listing`, `sync_catalogue` with `mode:"full"` that would retire items): tool returns the would-affect count and requires an explicit second call.
- **Rate/quota feedback** surfaced as structured tool errors so the agent backs off rather than hammering.
- **Audit:** every MCP write carries the API key → already attributable in logs; add an `actor:"mcp"` tag for traceability.

---

## 6. Phased Roadmap

Effort is rough eng-weeks for one engineer. Each phase ships independently and is reversible.

### Phase 0 — Hardening & refactor (prereq) · ~1.5 wk

**Goal:** make internal handlers reusable and the surface partner-safe before any key exists.

- **Extract core functions** from session routes so logic isn't duplicated by v1: `createListingCore`, `updateListingCore`, `setStatusCore`, `bulkImportCore`, `uploadCore`, `dashboardStatsCore`. The route handler becomes `auth → core → serialize`. **Reuse:** all existing logic in `src/app/api/listings/*`, `/upload`, `/dashboard`, `/seller`.
- **Confirm scoping discipline:** audit that every core takes an explicit `{ profileId, sellerId }` and never reads session implicitly (since the partner caller has no cookie). This is the RLS-bypass invariant made explicit.
- **Decide edge-ingress posture** for `/api/v1/*` (recommend EXEMPT, like crons/feeds) — one line in `src/middleware.ts`.
- **Dependencies:** none. **Risk:** pure refactor; cover with the existing route behavior as the spec.

### Phase 1 — API keys + read-only v1 · ~2 wk

**Goal:** a shop can authenticate and read its own data.

- **BUILD-NEW:** `ApiKey` model + migration (remember the `db:setup` ritual: `prisma db push` then re-apply `unique-constraints.mjs`/`messaging-realtime.mjs`; partial indexes aren't Prisma-managed). Dashboard "Developers" UI to mint/rotate/revoke keys (business-tier only). `resolveApiKey()` helper. Scope-check middleware. Per-key rate limiting (**reuse** Upstash `rateLimit`, new key shape).
- **Endpoints:** `GET /api/v1/shop`, `GET /api/v1/listings` (incl. held/sold), `GET /api/v1/listings/{id}`, `GET /api/v1/analytics/summary` — all read, all **reuse** dashboard/account/serialize cores.
- **Cross-cutting:** error envelope, keyset pagination, `X-RateLimit-*` headers, `request_id` logging.
- **Dependencies:** Phase 0. **Risk:** low — read-only, owner-scoped; the main failure mode (cross-shop leakage) is caught by the same scoping audit as internal routes.

### Phase 2 — Write / CRUD · ~2 wk

**Goal:** programmatic create/update/delete/status.

- **Endpoints:** `POST/PATCH/DELETE /api/v1/listings`, `/status`, `/confirm`, `/availability`, `PATCH /api/v1/shop`, `POST /api/v1/media`. All **reuse** the Phase-0 cores + `checkListingOwner` + `phoneTakenByOther`.
- **BUILD-NEW:** `Idempotency-Key` handling (Upstash store). Ensure `after()` side-effects (syndication/CAPI/reindex/translation warm) fire once and only on autoPublish, identical to the session path.
- **Scopes:** gate on `listings:write` / `media:write`.
- **Dependencies:** Phase 1. **Risk:** medium — writes touch trust-denorm (`sellerTrustScore` at create), syndication, and the publish gate; verify parity with session behavior via shared cores so there's no second code path to drift.

### Phase 3 — Webhooks + bulk sync + per-listing analytics · ~2.5 wk

**Goal:** push-based integration and true catalogue mirroring.

- **BUILD-NEW:** `Listing.externalId` (unique per seller) + `POST /api/v1/listings/sync` (upsert+retire, `mode:full|partial`). `WebhookEndpoint` model + registration (SSRF-guarded, **reuse** push-endpoint validator) + Standard-Webhooks HMAC signing (**reuse** `send-sms` HMAC pattern) + `after()`-driven delivery with retry/auto-disable. `ListingDailyStat` rollup populated in the **existing daily cron** (`/api/cron/daily-reminders`, already runs trust maintenance — piggyback the rollup the same way `runTrustMaintenance` does) + `GET /api/v1/analytics/listings`.
- **Reuse:** `/api/listings/bulk` exposed as `/api/v1/listings/bulk`; event sources already exist at every fire point listed in §4.6.
- **Dependencies:** Phase 2 (events fire from write cores). **Risk:** medium — webhook retries + signing are the fiddly part; isolate failures so delivery never breaks a write (same discipline as `after()` today).

### Phase 4 — MCP server + partner program · ~2.5 wk

**Goal:** AI agents manage shops in NL; formalize onboarding.

- **BUILD-NEW:** MCP server (separate deploy) wrapping `/api/v1` with the tools in §5.2, restricted default scopes, confirmation gates, idempotency, and structured rate-limit feedback. Optional **OAuth2 client-credentials** issuer (reuse ES256/JWKS posture) for third-party SaaS integrators. Partner docs portal (auto-generate an OpenAPI spec from the v1 routes), key-management UX polish, quota tiers tied to `Seller` trust tier.
- **Reuse:** the entire v1 API is the MCP server's only backend — no privileged access, every guard inherited.
- **Dependencies:** Phases 1–3. **Risk:** low on the security axis (thin client), medium on UX (agent confirmation flows, preventing destructive loops).

---

### Summary of net-new schema/infra

| Item | Phase | Type |
|---|---|---|
| `ApiKey` model + mint/revoke UI + `resolveApiKey` | 1 | BUILD-NEW |
| Per-key rate limiting | 1 | REUSE Upstash, new key |
| Error envelope / keyset pagination / `request_id` | 1 | BUILD-NEW |
| Idempotency store (Upstash) | 2 | BUILD-NEW |
| `Listing.externalId` + `/v1/listings/sync` | 3 | BUILD-NEW |
| `WebhookEndpoint` + signed delivery | 3 | BUILD-NEW (reuse HMAC + SSRF guards) |
| `ListingDailyStat` rollup in daily cron | 3 | BUILD-NEW (reuse cron) |
| MCP server | 4 | BUILD-NEW |
| OAuth2 client-credentials | 4 | BUILD-NEW (reuse ES256/JWKS) |

Everything else — listing CRUD, media re-encode, bulk import, availability, storefront edit, stats, trust/publish gating, syndication, search reindex — is **REUSE-EXISTING**, exposed verbatim through the versioned surface via shared cores. The partner API is, by design, mostly a new *authentication and shape* layer over machinery the marketplace already runs in production.
