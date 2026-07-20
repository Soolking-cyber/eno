<!-- Generated 2026-07-20 by the ios-parity-gap-hunt workflow (13 agents, 59 verified gaps). Source of truth for finishing #124/#126/#127. -->

# Native iOS Parity â Definition of Done (#124, #126, #127)

## 1. Counts

| Task | Screen(s) | Blocker | Major | Minor | Total |
|---|---|---|---|---|---|
| 124 | home | 0 | 4 | 3 | 7 |
| 126 | pdp | 1 | 2 | 6 | 9 |
| 127 | saved/post/messages/account | 0 | 24 | 19 | 43 |
| **All** | | **1** | **30** | **28** | **59** |

127 breakdown: saved 3M/3m Â· post 3M/7m Â· messages 10M/5m Â· account 8M/4m.

---

## 2. Per-task checklists (web-redirect + visual-bug first within each severity)

### Task 124 â Home  â ï¸ every item is in `FeedView.swift` (other session is actively editing this file â coordinate/serialize)

**Major**
- [ ] web-redirect `FeedView.swift:64` â kill `aiSheet` WebSheet(`/messages/ai`); native AI concierge thread â POST `/api/ai/concierge`, replies as native `ListingCard`, handle 401 sign-in + 429 hourly-limit.
- [ ] web-redirect `FeedView.swift:67` â kill `mapSheet` WebSheet(`/?view=map`); native MapKit fed by `/api/listings` (bbox/viewport), cardâPDP nav.
- [ ] web-redirect `FeedView.swift:80` â repoint `.category` deep-link to existing native `CategoryFeedView(category:)`; build native brand feed via `FeedModel` brand param; delete `WebTabView` (`/c/[slug]`, `/brands/[slug]`).
- [ ] function `FeedView.swift:165` â add `listingType` param to `FeedModel.fetchPage` (`?type=free|wanted`); append 2 `INTENT_SHORTCUTS` tiles after the category ForEach â type-filtered feed.

**Minor**
- [ ] data `FeedView.swift:176` â fetch demand-ordered categories+counts; render `verifiedCount` subtitle under each tile behind `>=20` gate; order tiles by demand (drop static `Categories.all`).
- [ ] data `FeedView.swift:34` â gate recently-viewed rail on `recentlyViewed.count >= 2`.
- [ ] function `FeedView.swift:252` â insert native capture/sign-up card at grid index 8, signed-out only.

### Task 126 â PDP  â ï¸ `ListingDetailView.swift` is actively edited by other session (Models.swift edits are safe/independent)

**Blocker**
- [ ] function `ListingDetailView.swift:645` â native offer control in buy box: `EnoSlider` 0â50% (default 5%, **1% when price â¥ 1_000_000_000**), live `offerPrice = round(price*(1-d/100))`; on negotiable+priced split bottom bar 70/30 â `Send offer Â· {vnd}` + `Chat now`, POST `api/conversations` `["listingId":id,"offerAmount":offerPrice]`; keep single Chat-now bar for fixed-price/signed-out.

**Major**
- [ ] function `ListingDetailView.swift:682` â include localized opener in POST body: `["listingId":card.id,"message": tr("Hi! Is this still available?","ChÃ o báº¡n! MÃ³n nÃ y cÃ²n khÃ´ng?")]`.
- [ ] function `ListingDetailView.swift:79` â add `lat/lng: Double?` to `ListingDetail` (**Models.swift**); render MapKit "Location" section after details table.

**Minor** (visual-bug first)
- [ ] visual-bug `ListingDetailView.swift:75` â parse markdown subset (`**bold**`, `*`/`-`/`â¢` bullets, `1.`/`1)` numbered, `#` headings, blank-line paragraphs) into styled runs; mirror `formatDescription`.
- [ ] visual-bug `ListingDetailView.swift:716` â padded gauge bounds `lo=min(p25,price)*0.92`, `hi=max(p75,price)*1.08`; shade p25âp75 sub-segment; position marker in padded range so out-of-band sits outside the band.
- [ ] data `ListingDetailView.swift:165` â fire-and-forget POST `api/listings/{id}/view` alongside `RecentStore.recordViewed`.
- [ ] data `ListingDetailView.swift:229` â add `dropExpiresAt: String?` to Models; render `Â· cÃ²n N ngÃ y` / `Â· N days left` when `ceil((expires-now)/86400) > 0`.
- [ ] function `ListingDetailView.swift:97` â recently-viewed rail below `moreRail` from `RecentStore` ids (exclude `card.id`).
- [ ] function `ListingDetailView.swift:75` â translate title/description/location via `/api/translate` (cache per session) when source script differs from UI language.

### Task 127 â Saved / Post / Messages / Account

**Saved** (`SavedView.swift`)
- [ ] major visual-bug `:47-49` â add `@State failed`; set `failed=false` at load() start; in guard-else set `loaded=true; failed=true; return`; render error state (icon + "Couldn't load listings."/"KhÃ´ng táº£i ÄÆ°á»£c tin ÄÄng." + "Try again"/"Thá»­ láº¡i" â `Task{await load()}`).
- [ ] major function `:13-31` â native Saved-searches section above grid (signed-in + non-empty): GET `/api/saved-searches`; row = run / Bell toggle (PATCH `{notify}` optimistic+rollback) / trash (DELETE).
- [ ] major interaction `:55-70` â add brand CTA "Browse listings"/"KhÃ¡m phÃ¡ tin ÄÄng" to empty state â switch to Feed tab.
- [ ] minor data `:33` â saved-count subtitle (`favs.count` + EN singular/plural, VI "tin ÄÃ£ lÆ°u"); align VI title to "Tin ÄÃ£ lÆ°u".
- [ ] minor visual-bug `:57-66` â use bundled `saved` mascot asset over SF heart; align title/body copy to web.
- [ ] minor data `:26` â skeleton cap `min(max(favs.count,2),24)`.

**Post** (`PostView.swift` / `PostModel.swift`)
- [ ] major interaction `PostView.swift:174` â per-thumb "Make cover"/"Äáº·t lÃ m bÃ¬a" (`model.moveToFront(id)`) or drag reorder + "Cover"/"BÃ¬a" badge on photos[0].
- [ ] major function `PostView.swift:422` â success sheet: "View your listing"/"Xem tin cá»§a báº¡n" â native PDP for `model.createdId` + Share (UIActivityViewController) of listing URL; fix stale line-8 comment.
- [ ] major function `PostView.swift:353` â CoreLocation "use my location" (reverse-geocode â province/ward); include `lat/lng` in submit body (`PostModel.swift:421-425`).
- [ ] minor data `PostView.swift:332` â price unit from `listingType` (`/ thÃ¡ng` rent|job, `/ dá»ch vá»¥` service) beside `Ä` + in preview.
- [ ] minor function `PostView.swift:255` â â¨ "Polish with AI"/"Chá»nh báº±ng AI" â `/api/ai/rephrase` (sign-in gated) â back into `descriptionText`.
- [ ] minor function `PostView.swift:327` â market-price band: GET `/api/price-guidance` on brand+model â P25âP75 band + nudge (nâ¥5 gate).
- [ ] minor data `PostModel.swift:239` â photo cap 8â6 in `add()`, `addCameraImage()` (`:252`) and picker `maxSelectionCount` (`PostView.swift:143`); update hint.
- [ ] minor interaction `PostView.swift:411` â keep publish enabled; on tap-while-incomplete show "CÃ²n thiáº¿u / Still needed" summary + scroll to first gap.
- [ ] minor function `PostModel.swift:99` â draft autosave (all but photos) to UserDefaults, 15-min TTL, rehydrate in start()/.task.
- [ ] minor function `PostView.swift:209` â BÃ¡n/Cho thuÃª segmented control on rentable categories remapping category+subcategory (`switchIntent` semantics).

**Messages** (`ThreadView.swift` / `InboxView.swift` / `ChatModels.swift`)
- [ ] major web-redirect `InboxView.swift:125` â native AI concierge thread (bubbles + greeting + inline ListingCard) â POST `/api/ai/concierge`; route pinned "eno AI" row to it (drop WebSheet).
- [ ] major function `ThreadView.swift:186` â contact-reveal bar below listingBar (hidden when `t.iAmSeller`), gated on `messages.contains{!$0.mine}`; POST `api/listings/{id}/contact` â `{phone,telHref,zaloHref}`; map error codes to web toasts.
- [ ] major function `ThreadView.swift:387` â Tag toggle offer composer (amount + x1,000 chip + â% slider when price>0) â `counter/deliver` with `offerAmount`; gate on `negotiable != false`.
- [ ] major data `ChatModels.swift:52` â add `trust` (score/tier/memberSinceYear/isNew) to `ThreadCounterpart`; native header row w/ Avatar + trust meta.
- [ ] major function `ThreadView.swift:245` â off-platform warning: port OFF_PLATFORM/SAFE_HOSTS regex, find first `!mine` match, render destructive Alert bubble beneath it.
- [ ] major function `ThreadView.swift:95` â track `justAcceptedId` after accept; when seller render mark-sold prompt under that offer card â POST listing status.
- [ ] major function `ChatModels.swift:36` â add `hasReviewed: Bool?`; compute `showReviewPrompt` (buyer + closed deal/accepted) â star+note prompt POST `api/sellers/{sellerId}/reviews`.
- [ ] major function `ThreadView.swift:218` â quick-reply chip row above composer (auto-send complete replies, insert partials to draft); add `availabilityConfirmedAt` to `ThreadListing`.
- [ ] major interaction `ThreadView.swift:213` â only auto-scroll when newest msg is mine or near bottom; else "New messages" pill â scroll on tap.
- [ ] major function `ThreadView.swift:156` â toolbar flag action â existing native `ReportSheet(conversationId:)`.
- [ ] minor function `InboxView.swift:73` â `.searchable` over convos filtering counterpart.name + listingTitle + lastMessageText.
- [ ] minor data `InboxView.swift:131` â AsyncImage from `counterpart.avatarUrl`, fall back to initial+color.
- [ ] minor interaction `ThreadView.swift:222` â listingBar â native PDP; header name â native seller storefront (`counterpart.sellerId`).
- [ ] minor visual-bug `ThreadView.swift:320` â append `(formatMoneyFull(price))` to the "% of asking" line.
- [ ] minor web-redirect `InboxView.swift:45` â route guest hero to native OTP sign-in once built (swap destination only).

**Account** (`MyListingsView.swift` / `SettingsView.swift` / `AccountView.swift` / `EditListingView.swift`)
- [ ] major web-redirect `EditListingView.swift:77` â native full-edit form (reuse PostModel/PostView prefilled) covering photos/category/facets/brand/model/condition/location/urgent; delete WebSheet fallback.
- [ ] major function `MyListingsView.swift:93` â availability-review: last-reviewed pill + overdue (3+ day) red state + batch tick-sold/bump over POST `/api/listings/[id]/confirm`.
- [ ] major data `MyListingsView.swift:34` â add `saves` + `unreadMessages` to `Stats`; render Saves card + NavigationLink "Unread messages" â Inbox.
- [ ] major function `SettingsView.swift:50` â Change-email section (GoTrue `updateUser({email})` w/ bearer, or `/api/account/change-email` wrapper) + "check your new email" state.
- [ ] major function `SettingsView.swift:50` â Handle/@username editor: debounced GET `/api/handle/check?h=` + POST `/api/handle`, seeded from `/api/me`.
- [ ] major function `SettingsView.swift:52` â avatar upload: compress â POST `/api/upload(kind=avatar)` â PATCH `/api/profile {avatarUrl}` (only when changed).
- [ ] major function `SettingsView.swift:101` â Privacy section w/ cookie/consent-withdrawal screen (PDPL â footer link hidden in app).
- [ ] major data `AccountView.swift:114` â decode `avatarUrl` in `MeResponse.User`; AsyncImage in header, fall back to initial+color.
- [ ] minor web-redirect `SettingsView.swift:129` â native static help/safety screen; route "Help & safety" to it (drop WebSheet).
- [ ] minor function `MyListingsView.swift:182` â show `savedCount` in row meta + demand nudge (Edit-price action) when active/0-contacts and savesâ¥5 or views>50.
- [ ] minor function `MyListingsView.swift:188` â Share menu item / ShareLink to `/listings/{id}` for active+verified.
- [ ] minor function `MyListingsView.swift:104` â "Post a listing" CTA in empty state â native post flow.

---

## 3. Quick wins (<10 lines, and NOT in FeedView.swift / ListingDetailView.swift)

- `SavedView.swift:26` â skeleton cap 6â24 (1 line).
- `SavedView.swift:33` â saved-count subtitle + VI title fix.
- `ThreadView.swift:320` â append asking price to "% of asking" (1 line).
- `InboxView.swift:131` â AsyncImage avatar with initial fallback.
- `PostModel.swift:239` (+`:252`, `PostView.swift:143`) â photo cap 8â6 + hint.
- `PostView.swift:332` â price-unit suffix from `listingType`.
- `MyListingsView.swift:188` â ShareLink row for active+verified.
- `MyListingsView.swift:104` â "Post a listing" empty-state CTA.
- `AccountView.swift:114` â decode+render `avatarUrl` (payload already returns it).
- `SavedView.swift:55-70` â "Browse listings" CTA in empty state (small).

Note: the PDP `dropExpiresAt`/`lat`/`lng` decode edits are trivial but live in `Models.swift` paired with `ListingDetailView.swift` render code â do the Models.swift half now, defer the render half to the PDP session.

---

## 4. Server endpoint work (new / changed / verify)

**Already exist â client-only, no server change:** `/api/ai/concierge`, `/api/translate`, `/api/price-guidance`, `/api/ai/rephrase`, `/api/saved-searches` (+PATCH/DELETE), `/api/listings/{id}/contact`, `/api/listings/{id}/view`, `/api/listings/[id]/confirm`, `/api/handle/check` + `/api/handle`, `/api/upload` + PATCH `/api/profile`, `api/sellers/{sellerId}/reviews`. Serialized PDP payload already returns `lat/lng` (serialize.ts:57-58) and `dropExpiresAt` (:49) â decode only. `/api/me` already returns `avatarUrl` (route.ts:25) â decode only.

**Verify payload already includes fields (change only if absent):**
- Dashboard/Stats response â confirm it emits `saves` + `unreadMessages` (MyListingsView:34). If not, add to the dashboard route.
- Thread payload â `ThreadCounterpart.trust`, `ChatThread.hasReviewed`, `ThreadListing.availabilityConfirmedAt` must be present in the conversation API; add if the native decoders find them missing.

**Likely new/changed endpoints:**
- **Map viewport** â `/api/listings` needs bbox/viewport filter params for the native MapKit map (124/FeedView:67) if not already supported.
- **Demand-ordered categories + counts** â a native-consumable endpoint (or param) returning category order + `verifiedCount` (124/FeedView:176); web currently computes this server-side without a JSON surface.
- **Feed `?type=free|wanted`** â confirm the listings endpoint accepts a `type` filter param (124/FeedView:165); add if web does this at page level only.
- **Change-email** â either call GoTrue `auth.updateUser({email})` directly with the bearer session (no new endpoint) or add a thin `/api/account/change-email` wrapper (account/SettingsView:50).

**Cross-task dependency:** native OTP sign-in (parity row 1, not in this batch) blocks the final swap of `InboxView.swift:45` guest hero and the Messages guest states â build the WebSheet-removal last.
