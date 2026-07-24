# Native Parity Plan + Coordination Board

_Synthesized 2026-07-20 from 8 per-domain web↔native audits (home-feed, pdp, search, messages-chat, post-wizard, dashboard-account, auth-onboard-trust, design-system). Two engineers: **Kai** (Core/Feed/Listing/Search/Notifications/MyListings + server endpoints + Android generalist) and **Murat** (Auth/Messages/Post/Dashboard/Saved). Each owns their domains on **both** platforms._

## 1. State of parity

iOS is materially ahead of Android and reaches ~80–85% of web on Feed, Search, and PDP but stalls at "read-only browsing" — it cannot report, review, reveal a contact, make an offer, filter by area/condition, or edit a listing natively, and every Settings surface is a web-sheet. Android trails iOS on the same axes **plus** carries a cluster of correctness bugs (search results silently truncated at 24 and category matches dropped, urgent badge painted red so it collides with price-drop meaning, saved-count ignores the session-delta landmine, sold listings hang on an infinite spinner, one-tap deletes with no confirm, no Edit action at all). Cross-cutting, both native apps hardcode the **pre-de-blue** blue-tinted gray ramp, use only 2 gray levels vs web's 5, ship near-zero motion/haptics, and render trust/icons with emoji — so before feature work we re-sync tokens and the shared primitives that every screen inherits. Net: kill the Android P0 bugs, land the shared foundations, then close the trust/safety and transactional gaps (report, review, offer, contact-reveal, filters) that convert the apps from a catalog into a marketplace.

## 2. Prioritized gap table

Legend — **Kind**: bugfix / feature / style. **Effort**: S (<½ day) · M (~1 day) · L (multi-day). `◆` = shared foundation (do before dependent feature work). `†` = needs a **new/extended server endpoint or field** (see §5). Ordered P0→P2, then by effort.

| # | Item | Domain | Platform | Kind | Effort | Priority | Lane |
|---|------|--------|----------|------|--------|----------|------|
| 1 | Android My Listings: add Edit/View action (none exists today) | dashboard | android | bugfix | S | P0 | Kai |
| 2 | Android search suggest: render category rows (parsed then dropped) + nav to CategoryFeed | search | android | bugfix | S | P0 | Kai |
| 3 | Sold/removed/hidden listing: graceful "no longer available" state (kill infinite spinner; render from tapped card) | pdp | both | bugfix | M | P0 | Kai |
| 4 | Android search results: offset pagination / infinite scroll (one-shot 24-cap today) | search | android | bugfix | M | P0 | Kai |
| 5 | ◆ Android urgent badge: red→solid slate + ⚡ bolt glyph (collides with drop = red) | design/feed | android | bugfix | S | P1 | Kai |
| 6 | ◆ Android feed+saved: pull-to-refresh (Material3 PullToRefreshBox) | design/feed | android | feature | S | P1 | Kai |
| 7 | ◆ .press tactile scale(0.96) spring on all tappables (cards/chips/CTAs) | design | both | style | M | P1 | Murat |
| 8 | ◆ Haptics on key taps (publish/send/offer/favorite/sort-chip/tab) | design | both | feature | M | P1 | Murat |
| 9 | ◆ Android: replace emoji glyphs (🔔 ♡ ♥ 🛡 ⋮) with Lucide/Material vectors | design | android | style | M | P1 | Kai |
| 10 | ◆ Android feed+search: loading skeleton cards (exact 10:11 geometry) | design/feed | android | feature | M | P1 | Kai |
| 11 | ◆ Re-sync native tokens to de-blued true-neutral ramp (+5-level ink, radius 11/9) | design | both | style | M | P1 | Kai |
| 12 | ◆ Trust ladder: add Elite/violet tier + earned-tier gradient fills + tap→/trust | design/trust | both | style | M | P1 | Kai |
| 13 | For-You / Trending rail on Android home (`GET /api/recommendations`) | home-feed | android | feature | S | P1 | Kai |
| 14 | AI ✨ concierge entry in Android feed header (→ /messages/ai) | home-feed/search | android | feature | S | P1 | Kai |
| 15 | Android search results: sort tabs (5 sorts) | search | android | feature | S | P1 | Kai |
| 16 | Android search: price filter chip + bottom sheet (priceMin/priceMax) | search | android | feature | S | P1 | Kai |
| 17 | Android feed: offline/failed + Try-again state | home-feed | android | feature | S | P1 | Kai |
| 18 | Android PDP: market-price gauge (priceBand fetched then dropped) | pdp | android | feature | S | P1 | Kai |
| 19 | Android PDP: prevPrice strikethrough + urgent "Bán gấp" chip | pdp | android | feature | S | P1 | Kai |
| 20 | Android PDP: meta row posted-ago + condition + year/mileage chips | pdp | android | feature | S | P1 | Kai |
| 21 | Android PDP: Save (favorite) + Share controls | pdp | android | feature | S | P1 | Kai |
| 22 | Android PDP: video-first gallery page (ExoPlayer, poster=first image) | pdp | android | feature | S | P1 | Kai |
| 23 | Category-aware safety strip near the contact CTA (bilingual copy in file) | pdp | both | feature | S | P1 | Kai |
| 24 | Android My Listings: delete confirmation dialog (one-tap irreversible today) | dashboard | android | bugfix | S | P1 | Kai |
| 25 | Android My Listings: empty + loading states | dashboard | android | bugfix | S | P1 | Kai |
| 26 | Android saved-count: track session delta + clearDeltas (base+delta landmine) | home-feed | android | bugfix | M | P1 | Kai |
| 27 | Visual / photo search in the search bar (camera+upload → vision → query+category) | search | both | feature | M | P1 | Kai |
| 28 | Condition (new/used) filter in the shared filter sheet | home-feed/search | both | feature | M | P1 | Kai |
| 29 | Android PDP seller card: trust/rating/reviews/business/member-since + storefront tap-through | pdp/trust | android | feature | M | P1 | Kai |
| 30 | Description/attributes "Details" table (decode attributes/engineL, render) | pdp | both | feature | M | P1 | Kai |
| 31 | † Reviews preview on PDP (avg + ≤2 verified-first snippets) | pdp/trust | both | feature | M | P1 | Kai |
| 32 | Report sheet + listing/seller entry points (reason radio → `/api/report`) | pdp/trust | both | feature | M | P1 | Kai |
| 33 | QuickDiscount (one-tap price-drop) on My Listings rows | dashboard | both | feature | M | P1 | Kai |
| 34 | Area / location filter (province→ward→near-you radius, reverse-geocode) | home-feed/search | both | feature | L | P1 | Kai |
| 35 | Availability daily-review sheet + overdue nudge pill on My Listings | dashboard | both | feature | L | P1 | Kai |
| 36 | MarkSoldPrompt anchored under a just-accepted offer (seller only) | messages | both | feature | S | P1 | Murat |
| 37 | Off-platform scam warning under the first luring incoming message | messages | both | feature | S | P1 | Murat |
| 38 | Chat-thread report entry (reuse ReportSheet, chat reasons scam/offensive/other) | messages/trust | both | feature | S | P1 | Murat |
| 39 | Android Post: subcategory + listing-type (intent) pickers, shown when >1 | post | android | feature | S | P1 | Murat |
| 40 | Android Post: brand + model fields on brandable categories (send in submit) | post | android | feature | S | P1 | Murat |
| 41 | Android Post: gate condition on category (required only when hasCondition) | post | android | bugfix | S | P1 | Murat |
| 42 | Android Post: urgent "Bán gấp" toggle + urgent⇄negotiable coupling | post | android | feature | S | P1 | Murat |
| 43 | Android Post: contactName field (+ business "Posting as" from /api/me) | post | android | feature | S | P1 | Murat |
| 44 | Android Post: full autofill apply (subcat/brand/model/attrs/type, not just 3 fields) | post | android | feature | S | P1 | Murat |
| 45 | Account card: real avatar photo + trust-score badge (add avatarUrl/trustScore to /api/me) | dashboard/trust | both | style | S | P1 | Murat |
| 46 | Account-type switcher (individual↔business, `POST /api/profile/account-type`) | dashboard | both | feature | S | P1 | Murat |
| 47 | Contact reveal (phone + Zalo, gated to after seller replies; typed errors) | messages | both | feature | M | P1 | Murat |
| 48 | Buyer-initiated offer inside a thread (amount + −% slider, gated by negotiable) | messages | both | feature | M | P1 | Murat |
| 49 | † Quick-reply chips (seller+buyer; meet-chip reverse-geocode; availabilityConfirmedAt) | messages | both | feature | M | P1 | Murat |
| 50 | † Buyer post-deal review prompt in thread (needs hasReviewed field) | messages/trust | both | feature | M | P1 | Murat |
| 51 | Opener message + offer slider from listing detail (chat-init parity) — edits ListingDetailView/Detail.kt | messages/pdp | both | feature | M | P1 | Murat |
| 52 | Android Post: taxonomy decode — types/brandable/facets/RangeMeta on ApiCategory (unblocks #39–44,53) | post | android | feature | M | P1 | Murat |
| 53 | Android Post: per-category chip facets (required) + range facets (year/mileage/engine) | post | android | feature | M | P1 | Murat |
| 54 | Android Post: map publish errors by body `{error}` code, not HTTP status | post | android | bugfix | M | P1 | Murat |
| 55 | Post geolocate → reverse-geocode → province/ward + submit lat/lng pin | post | both | feature | M | P1 | Murat |
| 56 | Post: missing-field checklist + "Still needed" + jump/highlight first unfilled on publish | post | both | feature | M | P1 | Murat |
| 57 | Post success screen: View-listing + Share + first-listing moment (replace bare Done) | post | both | feature | M | P1 | Murat |
| 58 | Enforce account-type onboarding for new users (accountType==null → /onboard) | auth | both | feature | M | P1 | Murat |
| 59 | Native Settings: profile editor (name / photo upload / phone) | dashboard | both | feature | M | P1 | Murat |
| 60 | Native Delete Account (danger zone, right-to-delete) | dashboard | both | feature | M | P1 | Murat |
| 61 | Disputes native entry (list + case-room link; WebSheet acceptable v1) | trust/dashboard | both | feature | M | P1 | Murat |
| 62 | Post: video upload (≤60s, sign→PUT→complete→transcode-poll) | post | both | feature | L | P1 | Murat |
| 63 | Native business-profile editor (storefront name/rep/bio/ward/logo/legal) | dashboard | both | feature | L | P1 | Murat |
| 64 | Android card: business Building2 glyph in meta | home-feed | android | feature | S | P2 | Kai |
| 65 | Android card: "Good price" badge in price row | home-feed | android | feature | S | P2 | Kai |
| 66 | Android card: bottom-left video play chip | home-feed | android | feature | S | P2 | Kai |
| 67 | Verified-only toggle in the filter sheet | home-feed/search | both | feature | S | P2 | Kai |
| 68 | Compact (list) view toggle + CompactRow | home-feed | both | feature | S | P2 | Kai |
| 69 | iOS home: FilterChip on Latest heading (filters unreachable from home) | home-feed | ios | feature | S | P2 | Kai |
| 70 | Brand suggestions in typeahead → brand feed | search | both | feature | S | P2 | Kai |
| 71 | Suggest ordering: query row FIRST + accent-insensitive match bolding | search | both | style | S | P2 | Kai |
| 72 | Android search empty chips: emoji→vector icons (folds into #9) | search | android | style | S | P2 | Kai |
| 73 | Zero-results recovery (trending / clear-filters) instead of bare "No results" | search | both | feature | S | P2 | Kai |
| 74 | PDP: brand chip + logo in meta row | pdp | both | feature | S | P2 | Kai |
| 75 | PDP: price-drop % badge + countdown ("N days left") | pdp | both | feature | S | P2 | Kai |
| 76 | PDP: "Fixed price" badge when !negotiable | pdp | both | style | S | P2 | Kai |
| 77 | PDP: priceUnit suffix (/month rentals) — rentals read as one-off today | pdp | both | bugfix | S | P2 | Kai |
| 78 | PDP: ProtectionsRow explainer strip + sheet | pdp | both | feature | S | P2 | Kai |
| 79 | PDP inline gallery: photo n/N counter + "Video" badge | pdp | both | style | S | P2 | Kai |
| 80 | PDP: bottom safety note (meet-in-public copy) | pdp | both | style | S | P2 | Kai |
| 81 | Android PDP: stats row (views/saved/contacted) | pdp | android | style | S | P2 | Kai |
| 82 | PDP: recently-viewed rail + native view_item/ViewContent beacon | pdp | both | feature | S | P2 | Kai |
| 83 | My Listings row: saved count (Heart) in meta (add savedCount to Android model) | dashboard | both | style | S | P2 | Kai |
| 84 | My Listings: greeting hero "Hi {name}" | dashboard | both | style | S | P2 | Kai |
| 85 | My Listings: stats strip align (Saves + tappable Unread→Messages) | dashboard | both | style | S | P2 | Kai |
| 86 | My Listings: demand nudge line ("N saved — a price drop usually sells it" + Edit price) | dashboard | both | feature | S | P2 | Kai |
| 87 | My Listings: per-listing Share action | dashboard | both | feature | S | P2 | Kai |
| 88 | ◆ 5-level ink ramp + radius tiers 11/9 (rides with #11) | design | both | style | S | P2 | Kai |
| 89 | Recent LOCATIONS chips in search empty-focus (depends on #34) | search | both | feature | S | P2 | Kai |
| 90 | Android card: brand·model meta line (add brandSlug/model to Core.kt ListingCard) | home-feed | android | feature | M | P2 | Kai |
| 91 | Card image carousel (swipe + dots + arrows) | home-feed | both | feature | M | P2 | Kai |
| 92 | † More-from-this-seller shelf (sameSellerListings) | pdp | both | feature | M | P2 | Kai |
| 93 | PDP location map section (MapKit / Maps Compose pin) | pdp/search | both | feature | M | P2 | Kai |
| 94 | PDP inline gallery: blur-fill no-crop (object-contain over blurred backdrop) | pdp | both | style | M | P2 | Kai |
| 95 | Business analytics: 14-day view/lead sparkline under rows (`/api/dashboard/analytics`) | dashboard | both | feature | M | P2 | Kai |
| 96 | Skeleton shimmer sweep + branded wordmark overlay | design | both | style | M | P2 | Kai |
| 97 | Per-category facets in results (year/mileage/RAM ranges + attr selects) | home-feed/search | both | feature | L | P2 | Kai |
| 98 | Card video autoplay (muted, IO/visibility-gated loop) | home-feed | both | feature | L | P2 | Kai |
| 99 | Native map view with Airbnb-style price pins + info card + near-you radius | home-feed/search | both | feature | L | P2 | Kai |
| 100 | TikTok-style full-screen vertical video feed view | home-feed | both | feature | L | P2 | Kai |
| 101 | Thread header: trust meta + "New user" honesty pill + tappable seller/listing links | messages/trust | both | feature | S | P2 | Murat |
| 102 | Inbox conversation search (client-side filter) | messages | both | feature | S | P2 | Murat |
| 103 | 5-second delete-undo (defer DELETE) instead of immediate delete | messages | both | feature | S | P2 | Murat |
| 104 | Native handle (@username) + change-email settings rows | dashboard | both | feature | S | P2 | Murat |
| 105 | Account/Settings pull-to-refresh (iOS Account has none) | dashboard | both | style | S | P2 | Murat |
| 106 | heart-pop burst animation on favorite (save-not-unsave only) | design | both | style | S | P2 | Murat |
| 107 | dropPercent: round (not truncate) + emit "-50%+" (match server) | design | both | bugfix | S | P2 | Murat |
| 108 | Tabular/monospaced digits on prices/counts/rating | design | both | style | S | P2 | Murat |
| 109 | Port money/count formatters (compactPrice / formatCount / vndWords / formatRating) | design | both | feature | S | P2 | Murat |
| 110 | Post: client-side contact-info + banned-word pre-check before POST | post | both | feature | S | P2 | Murat |
| 111 | Post: priceUnit suffix (/month, /service) on the price field | post | both | feature | S | P2 | Murat |
| 112 | Post: title/description char counters (140 / 5000) + maxLength | post | both | style | S | P2 | Murat |
| 113 | "New messages" pill + preserve read position (stop yanking scroll on poll) | messages | both | bugfix | M | P2 | Murat |
| 114 | Signed-in user's own trust standing + path-to-next-tier in Account | trust/dashboard | both | feature | M | P2 | Murat |
| 115 | Account: Help / Disputes / View-storefront rows | dashboard | both | feature | M | P2 | Murat |
| 116 | Account: in-app language / theme preference control | dashboard | both | feature | M | P2 | Murat |
| 117 | Account: reminders/digest opt-in + cookie-consent withdrawal (legal parity) | dashboard | both | feature | M | P2 | Murat |
| 118 | Saved searches (run / alert-toggle / delete + save-this-search) | saved/search | both | feature | M | P2 | Murat |
| 119 | Shared EmptyState primitive (mascot + title + hint + action) | design | both | style | M | P2 | Murat |
| 120 | reveal-on-scroll entrance for feed cards (reduced-motion aware) | design | both | style | M | P2 | Murat |
| 121 | Centered toast/confirmation system (Saved / Published / Offer sent) | design | both | feature | M | P2 | Murat |
| 122 | Post: photo drag-reorder + "Make cover" | post | both | feature | M | P2 | Murat |
| 123 | Post: market price guidance band (P25–P75, n≥5, amber above) | post | both | feature | M | P2 | Murat |
| 124 | Post: "Polish with AI" description rewrite (`/api/ai/rephrase`) | post | both | feature | M | P2 | Murat |
| 125 | Post: VND live dot-thousands formatting + preset amount chips | post | both | feature | M | P2 | Murat |
| 126 | Post: category/condition chip grid + descriptive negotiable-vs-fixed chips | post | both | style | M | P2 | Murat |
| 127 | Post: cross-category sale/rent quick toggle (vehicles/property↔rentals) | post | both | feature | M | P2 | Murat |
| 128 | Post: draft autosave/restore (crash insurance) | post | both | feature | M | P2 | Murat |
| 129 | Bulk CSV upload entry (business tier; WebTab v1) | dashboard | both | feature | L | P2 | Murat |
| 130 | Native AI concierge thread (replace WebSheet; inline native cards) | messages/search | both | feature | L | P2 | Murat |
| 131 | Native edit-prefill Post form + PATCH (replace web edit sheet) | post | both | feature | L | P2 | Murat |
| 132 | Supabase realtime delivery to replace the 12s poll | messages | both | feature | L | P2 | Murat |

**Load balance:** Kai ≈ 66 items (Android bug cleanup + PDP/Feed/Search buildout + MyListings + card/trust surfacing), Murat ≈ 66 items (all of Post + Messages transactional depth + Settings/Account + Auth + Saved). Roughly even; both lists are far larger than one day — priorities and the foundations block are what gate "today."

## 3. Shared foundations first (do before dependent feature work)

These are cheap, cross-cutting, and every later item inherits them. **Land them before feature work in the same lane.**

- **#11 Re-sync design tokens** (both) — map the hardcoded pre-de-blue Tailwind grays to the true-neutral canon: `DesignTokens.swift` Tokens enum + `core/Core.kt` Palette. fg `0x171717`, body `0x525252` + muted `0x737373` (was single `sub`), tint `0xF5F5F5`, border `0xE5E5E5`, danger `0xB91C1C` (red-700). Includes **#88** (5-level ink ramp `ink/ink2/ink3/ink4/body` applied per role) and radius tiers **11px card / 9px control**. Everything reads these — do it first.
- **#12 Trust ladder** (both) — add the Elite/violet band (160+), earned-tier gradient fills, tap→/trust. Reconcile thresholds with `lib/trust-score`. Unblocks every TrustMini on cards, PDP, and chat headers.
- **#5 Android urgent badge red→slate** + **#9 emoji→vector icons** + **#6 Android PTR** + **#10 Android skeletons** — Android's baseline styling debt; do them as one Android styling sweep so card/feed work lands on correct chrome. (#72, #96 ride along.)
- **#7 .press scale** + **#8 haptics** (both, Murat) — one shared ButtonStyle (iOS) / pressed-scale modifier (Compose) + a haptics helper. Adopt in every CTA/chip/card afterwards.
- **#52 Android Post taxonomy decode** (Murat) — extend `ApiCategory`/`Taxonomy` with types/brandable/facets/RangeMeta. **Hard blocker** for Android Post items #39–44 and #53 — Murat's first Post task.
- **#119 EmptyState primitive** + **#121 toast system** + **#109 formatters** (Murat) — shared surfaces reused by Saved/Search/Messages/Post; build once.

## 4. Per-lane ordered checklists

### Kai — start here (Android bugs → Android styling sweep → tokens/trust → Feed/Search/PDP/MyListings)

**Block A — P0 bugs (ship today):**
1. `#1` Android My Listings Edit/View action — `MyListings.kt:143-152`, add DropdownMenuItem → `WebTab('/listings/{id}')` (mirror iOS `MyListingsView.swift:186`).
2. `#2` Android search category rows — `Search.kt:133-164`, render `suggest.categories` above listings + `onCategory` route to CategoryFeed.
3. `#3` Sold/removed graceful state — detect 404 from `Api.get`/`APIClient`; render from tapped card payload + a "no longer available/sold" panel (mirror web `sold-listing.tsx`). `Detail.kt:48-52`, `ListingDetailView.swift:57-59`.
4. `#4` Android search pagination — port offset paging from `Feed.kt:130` into `Search.kt` ResultsGrid.

**Block B — Android styling sweep (foundation):**
5. `#5` urgent slate + bolt · `#9` emoji→Lucide vectors (`core/LucideIcons.kt`) · `#6` PullToRefreshBox on feed+saved · `#10` skeleton cards (10:11) · `#72` search empty-chip icons · `#96` shimmer+wordmark.
6. `#11` token re-sync + `#88` ink ramp/radius (both platforms) · `#12` trust ladder Elite+gradient (both).

**Block C — Feed/Search P1:**
7. `#26` saved-count session delta (add `delta()`/`clearDeltas` to `Favorites.kt`, mirror `FavoritesStore.swift:30`) · `#13` For-You rail · `#14` AI ✨ header · `#15` search sort tabs · `#16` search price filter · `#17` offline state.
8. `#28` condition filter · `#27` visual/photo search (**AI dep — see §5**) · `#34` area/location filter (L, `/api/geo` + `/api/reverse-geocode`).

**Block D — PDP P1 (Android buildout + both-platform):**
9. Android quick wins `#18`–`#22` (market gauge, prev/urgent, meta chips, save/share, video gallery) · `#23` safety strip.
10. `#29` Android seller trust card · `#30` details table (decode attributes/engineL) · `#31` reviews preview (**† envelope field**) · `#32` report sheet + listing/seller entry.

**Block E — MyListings P1:**
11. `#24` delete confirm · `#25` empty/loading · `#33` QuickDiscount · `#35` availability review + overdue nudge (L).

**Block F — P2** (cards #64–66,90–91,98,100; search #67–73,89,99; PDP #74–82,92–94; MyListings #83–87,95). Pull by effort as time allows.

### Murat — start here (foundations → Android Post → Messages → Post both → Settings/Auth)

**Block A — foundations:**
1. `#7` .press scale (shared ButtonStyle / Compose modifier, both) · `#8` haptics helper + wire favorite/send/publish/sort.
2. `#52` **Android Post taxonomy decode** (`Core.kt:270` ApiCategory + Taxonomy) — unblocks Block B.

**Block B — Android Post catch-up (iOS already ships these):**
3. `#39` subcategory+type · `#40` brand+model · `#41` gate condition · `#42` urgent+coupling · `#43` contactName · `#44` full autofill apply · `#53` chip+range facets · `#54` errors by body code (`Post.kt:206`). Ensure `submit()` sends every new field.

**Block C — Messages transactional depth (both platforms):**
4. `#38` chat report entry (needs ReportSheet — coordinate with Kai #32; whoever lands first owns the shared component) · `#37` off-platform warning · `#36` MarkSoldPrompt.
5. `#47` contact reveal (phone/Zalo) · `#48` buyer offer in thread · `#49` quick-reply chips (**† availabilityConfirmedAt**) · `#50` review prompt (**† hasReviewed**) · `#51` opener+offer from listing detail (**edits `ListingDetailView.swift`/`Detail.kt` — coordinate with Kai**).

**Block D — Post both-platform P1:**
6. `#55` geolocate+lat/lng · `#56` missing-field checklist · `#57` success screen · `#62` video upload (L, Supabase buckets).

**Block E — Settings/Auth/Dashboard P1:**
7. `#45` avatar+trust (**† /api/me fields**) · `#46` account-type switcher · `#58` enforce onboarding (`/onboard` sheet) · `#59` profile editor · `#60` delete account · `#61` disputes entry · `#63` business-profile editor (L).

**Block F — P2** (foundations #119,#121,#109 early; then messages #101–103,#113,#132,#130; account #104,#105,#114–117,#129; post #110–112,#122–128,#131; saved #118; design #106–108,#120). Pull by effort.

## 5. Callouts — new endpoints, owner input, paid/config dependencies

**New / extended server endpoints or payload fields (Kai owns server side):**
- `#31` **PDP reviews preview** — `/api/listings/[id]` envelope currently returns only `{listing, priceBand}` (`route.ts:33`); add `reviews[]/avg/total` (from `topSellerReviews`).
- `#92` **More-from-this-seller** — add `sameSellerListings` to the envelope or a new `GET /api/sellers/[id]/listings`.
- `#49` `#50` **Chat models** — decode `listing.availabilityConfirmedAt` and `hasReviewed` (both absent from native `ChatThread`); server already has the data.
- `#45` `#114` **`/api/me`** — add `avatarUrl`, `trustScore`, `trustTier`, `handle` (currently omitted from `MeResponse`/`MeUser`).
- `#30` **PDP models** — decode `attributes`, `engineL`, `brandSlug`, `model`, `dropExpiresAt`, lat/lng (API already serializes them; native models don't decode).
- Reused as-is (no server change): `/api/recommendations` (#13), `/api/geo` + `/api/reverse-geocode` (#34,#55), `/api/report` (#32,#38), `/api/sellers/[id]/reviews` (#50), `/api/listings/[id]/contact` (#47), `/api/dashboard/analytics` (#95), `/api/listings/bulk` (#129), `/api/ai/rephrase` (#124), `/api/ai/concierge` (#130), `/api/upload/video/*` (#62).

**Paid / config dependencies (flag before starting):**
- **Maps (#93, #99)** — no map library exists in either native project. Requires **MapKit (iOS)** and a **Google Maps or osmdroid (Android)** dependency + an API-key/billing decision on Android. **Owner input needed** on which Android map SDK (billing implications). Large; ships after filters.
- **AI features (#27 visual search, #124 Polish-with-AI, #130 concierge)** — depend on the Vertex/Gemini path. Per memory, **Gemini credit is NOT covered by the GCP credit** and the global Vertex endpoint is the only working one — confirm quota/budget before scaling visual-search calls. Gated by `NEXT_PUBLIC_AI_ASSIST` on web; keep the same sign-in + 401/429 handling natively.
- **Video upload (#62)** — 50 MB is the **Supabase project ceiling**; native must do in-app compression like web, and `transcode` needs `serverExternalPackages` (already configured). No new paid dep, but confirm the listing-videos bucket signing flow.
- **Business-profile legal fields (#63)** — `legalName/legalAddress/idNumber/taxCode` (Đ.29 compliance). Confirm the exact required set with the owner before shipping the form.
- **Push/reminders (#117)** — native push is **dormant** (Capacitor path not wired); ship digest opt-in + consent withdrawal for legal parity, but push toggles stay no-op until push is enabled (owner/config).

**Trust/safety review gate:** `#32` `#38` (report) and `#37` `#50` (scam warning, reviews) are money-/safety-adjacent — per CLAUDE.md these need a **non-Opus second reviewer** before merge. Route through the cockpit reviewers.

**Coordination hotspots (avoid clobbering):**
- `#32`/`#38` share one **ReportSheet** component — first lander builds it, the other imports. Announce on the board.
- `#51` (Murat) **edits `ListingDetailView.swift`/`Detail.kt`** which are Kai's PDP files — sequence after Kai's Block D or pair up. `git add -A` remains **banned**; stage explicit paths.
