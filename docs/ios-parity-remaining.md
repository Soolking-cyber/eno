<!-- Generated 2026-07-20 by the ios-parity-gap-hunt workflow (13 agents, 59 verified gaps). Server section VERIFIED by Kyle-SERVER. -->

# Native iOS Parity — Definition of Done (#124, #126, #127)

## 1. Counts

| Task | Screen(s) | Blocker | Major | Minor | Total |
|---|---|---|---|---|---|
| 124 | home | 0 | 4 | 3 | 7 |
| 126 | pdp | 1 | 2 | 6 | 9 |
| 127 | saved/post/messages/account | 0 | 24 | 19 | 43 |
| **All** | | **1** | **30** | **28** | **59** |

127 breakdown: saved 3M/3m · post 3M/7m · messages 10M/5m · account 8M/4m.

---

## 2. Per-task checklists (web-redirect + visual-bug first within each severity)

### Task 124 — Home  ⚠️ every item is in `FeedView.swift` (other session is actively editing this file — coordinate/serialize)

**Major**
- [ ] web-redirect `FeedView.swift:64` — kill `aiSheet` WebSheet(`/messages/ai`); native AI concierge thread → POST `/api/ai/concierge`, replies as native `ListingCard`, handle 401 sign-in + 429 hourly-limit.
- [ ] web-redirect `FeedView.swift:67` — kill `mapSheet` WebSheet(`/?view=map`); native MapKit fed by `/api/listings` (bbox/viewport), card→PDP nav.
- [ ] web-redirect `FeedView.swift:80` — repoint `.category` deep-link to existing native `CategoryFeedView(category:)`; build native brand feed via `FeedModel` brand param; delete `WebTabView` (`/c/[slug]`, `/brands/[slug]`).
- [ ] function `FeedView.swift:165` — add `listingType` param to `FeedModel.fetchPage` (`?type=free|wanted`); append 2 `INTENT_SHORTCUTS` tiles after the category ForEach → type-filtered feed.

**Minor**
- [ ] data `FeedView.swift:176` — fetch demand-ordered categories+counts; render `verifiedCount` subtitle under each tile behind `>=20` gate; order tiles by demand (drop static `Categories.all`).
- [ ] data `FeedView.swift:34` — gate recently-viewed rail on `recentlyViewed.count >= 2`.
- [ ] function `FeedView.swift:252` — insert native capture/sign-up card at grid index 8, signed-out only.

### Task 126 — PDP  ⚠️ `ListingDetailView.swift` is actively edited by other session (Models.swift edits are safe/independent)

**Blocker**
- [ ] function `ListingDetailView.swift:645` — native offer control in buy box: `EnoSlider` 0–50% (default 5%, **1% when price ≥ 1_000_000_000**), live `offerPrice = round(price*(1-d/100))`; on negotiable+priced split bottom bar 70/30 → `Send offer · {vnd}` + `Chat now`, POST `api/conversations` `["listingId":id,"offerAmount":offerPrice]`; keep single Chat-now bar for fixed-price/signed-out.

**Major**
- [ ] function `ListingDetailView.swift:682` — include localized opener in POST body: `["listingId":card.id,"message": tr("Hi! Is this still available?","Chào bạn! Món này còn không?")]`.
- [ ] function `ListingDetailView.swift:79` — add `lat/lng: Double?` to `ListingDetail` (**Models.swift**); render MapKit "Location" section after details table.

**Minor** (visual-bug first)
- [ ] visual-bug `ListingDetailView.swift:75` — parse markdown subset (`**bold**`, `*`/`-`/`•` bullets, `1.`/`1)` numbered, `#` headings, blank-line paragraphs) into styled runs; mirror `formatDescription`.
- [ ] visual-bug `ListingDetailView.swift:716` — padded gauge bounds `lo=min(p25,price)*0.92`, `hi=max(p75,price)*1.08`; shade p25–p75 sub-segment; position marker in padded range so out-of-band sits outside the band.
- [ ] data `ListingDetailView.swift:165` — fire-and-forget POST `api/listings/{id}/view` alongside `RecentStore.recordViewed`.
- [ ] data `ListingDetailView.swift:229` — add `dropExpiresAt: String?` to Models; render `· còn N ngày` / `· N days left` when `ceil((expires-now)/86400) > 0`.
- [ ] function `ListingDetailView.swift:97` — recently-viewed rail below `moreRail` from `RecentStore` ids (exclude `card.id`).
- [ ] function `ListingDetailView.swift:75` — translate title/description/location via `/api/translate` (cache per session) when source script differs from UI language.

### Task 127 — Saved / Post / Messages / Account

**Saved** (`SavedView.swift`)
- [ ] major visual-bug `:47-49` — add `@State failed`; set `failed=false` at load() start; in guard-else set `loaded=true; failed=true; return`; render error state (icon + "Couldn't load listings."/"Không tải được tin đăng." + "Try again"/"Thử lại" → `Task{await load()}`).
- [ ] major function `:13-31` — native Saved-searches section above grid (signed-in + non-empty): GET `/api/saved-searches`; row = run / Bell toggle (PATCH `{notify}` optimistic+rollback) / trash (DELETE).
- [ ] major interaction `:55-70` — add brand CTA "Browse listings"/"Khám phá tin đăng" to empty state → switch to Feed tab.
- [ ] minor data `:33` — saved-count subtitle (`favs.count` + EN singular/plural, VI "tin đã lưu"); align VI title to "Tin đã lưu".
- [ ] minor visual-bug `:57-66` — use bundled `saved` mascot asset over SF heart; align title/body copy to web.
- [ ] minor data `:26` — skeleton cap `min(max(favs.count,2),24)`.

**Post** (`PostView.swift` / `PostModel.swift`)
- [ ] major interaction `PostView.swift:174` — per-thumb "Make cover"/"Đặt làm bìa" (`model.moveToFront(id)`) or drag reorder + "Cover"/"Bìa" badge on photos[0].
- [ ] major function `PostView.swift:422` — success sheet: "View your listing"/"Xem tin của bạn" → native PDP for `model.createdId` + Share (UIActivityViewController) of listing URL; fix stale line-8 comment.
- [ ] major function `PostView.swift:353` — CoreLocation "use my location" (reverse-geocode → province/ward); include `lat/lng` in submit body (`PostModel.swift:421-425`).
- [ ] minor data `PostView.swift:332` — price unit from `listingType` (`/ tháng` rent|job, `/ dịch vụ` service) beside `đ` + in preview.
- [ ] minor function `PostView.swift:255` — ✨ "Polish with AI"/"Chỉnh bằng AI" → `/api/ai/rephrase` (sign-in gated) → back into `descriptionText`.
- [ ] minor function `PostView.swift:327` — market-price band: GET `/api/price-guidance` on brand+model → P25–P75 band + nudge (n≥5 gate).
- [ ] minor data `PostModel.swift:239` — photo cap 8→6 in `add()`, `addCameraImage()` (`:252`) and picker `maxSelectionCount` (`PostView.swift:143`); update hint.
- [ ] minor interaction `PostView.swift:411` — keep publish enabled; on tap-while-incomplete show "Còn thiếu / Still needed" summary + scroll to first gap.
- [ ] minor function `PostModel.swift:99` — draft autosave (all but photos) to UserDefaults, 15-min TTL, rehydrate in start()/.task.
- [ ] minor function `PostView.swift:209` — Bán/Cho thuê segmented control on rentable categories remapping category+subcategory (`switchIntent` semantics).

**Messages** (`ThreadView.swift` / `InboxView.swift` / `ChatModels.swift`)
- [ ] major web-redirect `InboxView.swift:125` — native AI concierge thread (bubbles + greeting + inline ListingCard) → POST `/api/ai/concierge`; route pinned "eno AI" row to it (drop WebSheet).
- [ ] major function `ThreadView.swift:186` — contact-reveal bar below listingBar (hidden when `t.iAmSeller`), gated on `messages.contains{!$0.mine}`; POST `api/listings/{id}/contact` → `{phone,telHref,zaloHref}`; map error codes to web toasts.
- [ ] major function `ThreadView.swift:387` — Tag toggle offer composer (amount + x1,000 chip + −% slider when price>0) → `counter/deliver` with `offerAmount`; gate on `negotiable != false`.
- [ ] major data `ChatModels.swift:52` — add `trust` (score/tier/memberSinceYear/isNew) to `ThreadCounterpart`; native header row w/ Avatar + trust meta.
- [ ] major function `ThreadView.swift:245` — off-platform warning: port OFF_PLATFORM/SAFE_HOSTS regex, find first `!mine` match, render destructive Alert bubble beneath it.
- [ ] major function `ThreadView.swift:95` — track `justAcceptedId` after accept; when seller render mark-sold prompt under that offer card → POST listing status.
- [ ] major function `ChatModels.swift:36` — add `hasReviewed: Bool?`; compute `showReviewPrompt` (buyer + closed deal/accepted) → star+note prompt POST `api/sellers/{sellerId}/reviews`.
- [ ] major function `ThreadView.swift:218` — quick-reply chip row above composer (auto-send complete replies, insert partials to draft); add `availabilityConfirmedAt` to `ThreadListing`.
- [ ] major interaction `ThreadView.swift:213` — only auto-scroll when newest msg is mine or near bottom; else "New messages" pill → scroll on tap.
- [ ] major function `ThreadView.swift:156` — toolbar flag action → existing native `ReportSheet(conversationId:)`.
- [ ] minor function `InboxView.swift:73` — `.searchable` over convos filtering counterpart.name + listingTitle + lastMessageText.
- [ ] minor data `InboxView.swift:131` — AsyncImage from `counterpart.avatarUrl`, fall back to initial+color.
- [ ] minor interaction `ThreadView.swift:222` — listingBar → native PDP; header name → native seller storefront (`counterpart.sellerId`).
- [ ] minor visual-bug `ThreadView.swift:320` — append `(formatMoneyFull(price))` to the "% of asking" line.
- [ ] minor web-redirect `InboxView.swift:45` — route guest hero to native OTP sign-in once built (swap destination only).

**Account** (`MyListingsView.swift` / `SettingsView.swift` / `AccountView.swift` / `EditListingView.swift`)
- [ ] major web-redirect `EditListingView.swift:77` — native full-edit form (reuse PostModel/PostView prefilled) covering photos/category/facets/brand/model/condition/location/urgent; delete WebSheet fallback.
- [ ] major function `MyListingsView.swift:93` — availability-review: last-reviewed pill + overdue (3+ day) red state + batch tick-sold/bump over POST `/api/listings/[id]/confirm`.
- [ ] major data `MyListingsView.swift:34` — add `saves` + `unreadMessages` to `Stats`; render Saves card + NavigationLink "Unread messages" → Inbox.
- [ ] major function `SettingsView.swift:50` — Change-email section (GoTrue `updateUser({email})` w/ bearer, or `/api/account/change-email` wrapper) + "check your new email" state.
- [ ] major function `SettingsView.swift:50` — Handle/@username editor: debounced GET `/api/handle/check?h=` + POST `/api/handle`, seeded from `/api/me`.
- [ ] major function `SettingsView.swift:52` — avatar upload: compress → POST `/api/upload(kind=avatar)` → PATCH `/api/profile {avatarUrl}` (only when changed).
- [ ] major function `SettingsView.swift:101` — Privacy section w/ cookie/consent-withdrawal screen (PDPL — footer link hidden in app).
- [ ] major data `AccountView.swift:114` — decode `avatarUrl` in `MeResponse.User`; AsyncImage in header, fall back to initial+color.
- [ ] minor web-redirect `SettingsView.swift:129` — native static help/safety screen; route "Help & safety" to it (drop WebSheet).
- [ ] minor function `MyListingsView.swift:182` — show `savedCount` in row meta + demand nudge (Edit-price action) when active/0-contacts and saves≥5 or views>50.
- [ ] minor function `MyListingsView.swift:188` — Share menu item / ShareLink to `/listings/{id}` for active+verified.
- [ ] minor function `MyListingsView.swift:104` — "Post a listing" CTA in empty state → native post flow.

---

## 3. Quick wins (<10 lines, and NOT in FeedView.swift / ListingDetailView.swift)

- `SavedView.swift:26` — skeleton cap 6→24 (1 line).
- `SavedView.swift:33` — saved-count subtitle + VI title fix.
- `ThreadView.swift:320` — append asking price to "% of asking" (1 line).
- `InboxView.swift:131` — AsyncImage avatar with initial fallback.
- `PostModel.swift:239` (+`:252`, `PostView.swift:143`) — photo cap 8→6 + hint.
- `PostView.swift:332` — price-unit suffix from `listingType`.
- `MyListingsView.swift:188` — ShareLink row for active+verified.
- `MyListingsView.swift:104` — "Post a listing" empty-state CTA.
- `AccountView.swift:114` — decode+render `avatarUrl` (payload already returns it).
- `SavedView.swift:55-70` — "Browse listings" CTA in empty state (small).

Note: the PDP `dropExpiresAt`/`lat`/`lng` decode edits are trivial but live in `Models.swift` paired with `ListingDetailView.swift` render code — do the Models.swift half now, defer the render half to the PDP session.

---

## 4. Server endpoint work — VERIFIED 2026-07-20 (Kyle-SERVER)

**The server is already fully ready for every native feature below — all remaining work is CLIENT-SIDE Swift decode/render. Do NOT re-add these server-side.**

Confirmed present in the committed API:
- Dashboard `stats.saves` + `stats.unreadMessages` — PRESENT (src/lib/core/dashboard.ts:41-42). Client: add both to the Swift `Stats` struct + render.
- Thread payload `counterpart.trust {trustScore,trustTier,memberSinceYear,isNew}`, `hasReviewed`, `listing.availabilityConfirmedAt` — ALL PRESENT (src/app/api/conversations/[id]/route.ts:66-100). Client: extend `ThreadCounterpart`/`ChatThread`/`ThreadListing` decoders + render.
- `/api/listings?type=free|wanted` intent filter — PRESENT (feed-query.ts:154-156, indexed on `listingType`). Client: just pass `?type=` from the home intent shortcuts.
- PDP `lat/lng` (serialize.ts:57-58), `dropExpiresAt` (:49), `/api/me` `avatarUrl` (route.ts:25) — PRESENT. Decode only.
- Client-only, no server change: `/api/ai/concierge`, `/api/translate`, `/api/price-guidance`, `/api/ai/rephrase`, `/api/saved-searches` (+PATCH/DELETE), `/api/listings/{id}/{contact,view,confirm}`, `/api/handle/check` + `/api/handle`, `/api/upload` + PATCH `/api/profile`, `api/sellers/{sellerId}/reviews`.

Genuinely NEW server work (only if the owning session builds the client for it):
- **Map viewport** — `/api/listings` has NO bbox/lat-lng viewport filter yet; the native MapKit map (124/FeedView) would need one added. Listing carries lat/lng so it's a straightforward additive filter. (Owner: whoever builds the native map, coordinate with Kyle-SERVER for the endpoint.)
- **Demand-ordered categories + counts** — no JSON surface returns category order + `verifiedCount` for the home tiles (124/FeedView:176); web computes it server-side inline. New lightweight endpoint if the native home wants it.
- **Change-email** — no `/api/account/change-email`; client can call GoTrue `auth.updateUser({email})` directly with the bearer (no endpoint needed), or add a thin wrapper.

**Cross-task dependency:** native OTP sign-in (parity row 1, not in this batch) blocks the final swap of `InboxView.swift:45` guest hero and the Messages guest states — build the WebSheet-removal last.
