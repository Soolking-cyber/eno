# ENO — Master Native Full-Parity Build List

**Owner mandate:** every web feature must be built **natively in BOTH apps** — iOS (`apps/ios/Eno`, SwiftUI) and Android (`apps/android/app/src/main/java/vn/eno/native_`, Jetpack Compose). **No web redirects, no "More options → web", no `WebSheet(path:)`/`WebTabView` (iOS) or `WebTab()`/`WebScreen()` (Android) fallbacks.** Any surviving redirect primitive is a shortcut to eliminate.

Web source of truth = `src/**` (Next.js). This list covers every catalogued feature whose native status is **redirect**, **partial**, or **missing**. Fully-native items are summarized at the bottom (no action).

Status legend per platform: **native** / **partial** (built but incomplete) / **redirect** (opens web) / **missing** (absent).

---

## Still redirects to web / missing (BUILD THESE)

Ordered by priority: owner-flagged redirects + irreversible/transactional flows first, then core missing marketplace mechanics, then browse/PDP enrichment, then polish.

| # | Feature | Domain | iOS status | Android status | Endpoint(s) | New server? | Effort | Notes |
|---|---------|--------|-----------|----------------|-------------|-------------|--------|-------|
| 1 | **Phone OTP sign-in** (send/verify, escalating resend cooldown, channel hint, change number) | Auth | redirect (`AccountView.swift:33` WebSheet `/signin`; also `InboxView.swift:45`, `ListingDetailView.swift:124`) | redirect (`account/Account.kt:79` WebTab `/signin`) | Supabase `signInWithOtp(phone)`+`verifyOtp`; `POST /api/auth/send-sms`; `GET /api/auth/otp-channel` | no | L | **BIGGEST GAP.** enoAuth JS bridge posts tokens back today. Native rebuild: +84 normalization, REST OTP send/verify, server-tracked cooldown (60/300/900/1800s), channel inbox hint (sms/telegram/whatsapp/zalo), Android SMS autofill, Turnstile mint (row 24). |
| 2 | **Full edit of a listing** (all fields) | Post/Edit | redirect (`EditListingView.swift:77` WebSheet `/listings/{id}/edit`) | redirect (`account/MyListings.kt:88` WebTab) | `PATCH /api/listings/[id]` | no | L | **THE key shortcut.** Native quick-edit covers only title/price/negotiable/description; photos, category/subcat, brand/model, condition, facets, location, urgent all fall to web. Reuse `PostModel`/`PostViewModel` prefilled from `ListingEditData`. Depends on Android reaching Post parity (rows 25–36). |
| 3 | **AI Concierge — native chat** (bubbles, greeting, 30-turn persistence) + entry from feed | Messages/Feed | redirect (`InboxView.swift:125` WebSheet; `FeedView.swift:59`) | redirect (`Messages.kt:182` WebTab; `MainActivity.kt:172` WebScreen) | `POST /api/ai/concierge` (401→sign-in, 429→hourly limit) | no | L | Owner-flagged. AI row is pinned native but destination is web. Build native thread. |
| 4 | AI Concierge — inline listing result cards in reply | Messages | redirect | redirect | `POST /api/ai/concierge` (returns `listings[]`) | no | M | Reuse native `ListingCard`; each taps to native PDP. |
| 5 | AI Concierge — photo/image search button in composer | Messages | redirect | redirect | `POST /api/ai/visual-search` → `/api/ai/concierge` | no | M | Native camera/photo picker + multipart visual-search. |
| 6 | **Make an offer from PDP** (always-open −% slider + message) | Messages/PDP | missing (`ListingDetailView.swift:406` chat CTA only) | missing (`detail/Detail.kt:230` chat CTA only) | `POST /api/conversations {message, offerAmount}` | no | L | **CORE ritual missing both.** Default 5% / 1% on ≥1 tỷ, max 50%, server 409 on fixed-price. Native only find-or-creates an empty thread. |
| 7 | **Thread: buyer make-offer control** (Tag toggle → −% slider or amount field + ×1000 chip) | Messages | missing | missing | `POST /api/conversations/[id]/messages {offerAmount}` | no | M | **MAJOR GAP.** Buyers can only Counter incoming offers; cannot initiate an offer in-thread. |
| 8 | **Thread: request contact reveal** (seller phone + Zalo, gated after reply) | Messages | missing | missing | `POST /api/listings/[id]/contact` | no | M | **MAJOR GAP — core lead mechanic.** Rate-limited, logs a lead, reveals tel:/Zalo deep links; error copy no_contact/reply_required/rate_limited. |
| 9 | **Seller storefront screen** (public seller profile) — from PDP tap-through | PDP | redirect (`ListingDetailView.swift:130` WebSheet `/sellers/id`) | redirect (`detail/Detail.kt:182` external browser) | `GET /api/sellers/[id]` | no | L | No native storefront exists. Shared with row 55 (own "View storefront"). |
| 10 | **Dispute case room** — evidence timeline + filed→evidence→review→decision stepper + countdown | Disputes | redirect (`DisputesView.swift:44` WebSheet `/disputes/[id]`) | missing (no disputes surface) | `GET /api/disputes/[id]` | no | L | Owner "no shortcuts". Include reporter/respondent identity shielding, appeal link. |
| 11 | Dispute case room — submit one-shot statement + ≤6 evidence photos | Disputes | redirect | missing | `POST /api/disputes/[id]/evidence` (multipart), `POST /api/disputes/[id]/messages` | no | M | Handles already_submitted/window_closed/rate_limited. |
| 12 | Dispute case room — withdraw case (reporter) | Disputes | redirect | missing | `POST /api/disputes/[id]/withdraw` | no | S | Reporter-only, confirm step. |
| 13 | **Report success → dispute case room** deep-link | Trust | redirect (`DisputesView.swift:44` WebSheet) | missing | `POST /api/report` (returns caseId) + dispute endpoints | no | L | Native report submits, but the resulting case room is web. Rebuild room natively (see 10). |
| 14 | Disputes — my cases list (both roles) | Disputes | partial (`DisputesView.swift:7`, omits stage/countdown chips) | missing (no disputes entry in `Account.kt`) | `GET /api/disputes` | no | M | Build Android list; add stage/evidence-countdown chips both. |
| 15 | Dispute appeal (respondent, after upheld) | Disputes | missing | missing | appeal route under `/appeal/[id]` | no | M | Reachable only from redirected case room today. |
| 16 | **Start conversation with initial message + offer from PDP** | Messages | missing (`ListingDetailView.swift:406` message-less) | missing (`detail/Detail.kt:230`) | `POST /api/conversations {message, offerAmount}` | no | M | Native "Chat with seller" creates empty thread — no canned opener, no offer. |
| 17 | **Email OTP sign-in** (6-digit in-app, resend, "check email" state) | Auth | redirect (`AccountView.swift:33` WebSheet `/signin`) | redirect (`Account.kt:79` WebTab) | Supabase `signInWithOtp(email)` + `verifyOtp` type='email' | no | M | Switch email path to 6-digit OTP (not magic link) so code is entered in-app. |
| 18 | **Onboarding account-type gate** (individual/business, name, business name, phone) | Onboarding | missing | missing | `POST /api/profile/account-type` | no | M | Native Google sign-ups never hit web gate → stay un-onboarded. Prefill name from OAuth, phone from OTP; errors business_name_required/phone_taken. |
| 19 | **Account settings — native surface** (display name, verified phone, locale, digest/reminder prefs, business profile) | Settings | redirect (`SettingsView.swift:106` WebSheet; some native fields fall back) | redirect (`Account.kt:171` WebTab `/dashboard/settings`) | `PATCH /api/profile` + `/api/profile/{locale,digest-prefs,reminder-prefs}` | no | M | Android has NO native settings at all. Umbrella for rows 40–52. |
| 20 | Trust explainer (/trust bands, scoring, penalties) | Trust/PDP | redirect (`ListingDetailView.swift:125` WebSheet `/trust`) | missing (chip onTap hook, no destination) | static content | no | M | Static copy → native scroll screen both. Keep numbers synced to `src/lib/trust-math.ts`. |
| 21 | Business storefront — LOGO upload | Storefront | redirect (`BusinessProfileView.swift:68` "Edit logo on web") | missing | `POST /api/upload (kind=avatar)` → `PATCH /api/seller {avatarUrl}` | no | M | Same picker+compress+upload as avatar. |
| 22 | Handle / @username editor (live availability) | Settings | redirect (More-settings WebSheet) | missing | `GET /api/handle/check?h=`, `POST /api/handle`, `GET /api/me` | no | M | Debounced availability + save. |
| 23 | Change email | Settings | redirect (More-settings WebSheet) | missing | Supabase GoTrue `auth.updateUser({email})` (or new thin `/api/account/change-email` wrapper) | no | M | Design choice: call GoTrue REST with session token vs. new wrapper route. |
| 24 | Turnstile CAPTCHA on OTP send | Auth | redirect (only inside web `/signin`) | redirect | Supabase Auth CAPTCHA (`captchaToken`) | no | M | Dormant (no-op) today; required once CAPTCHA enforced for native OTP. Turnstile has iOS/Android SDKs. |
| 25 | **Sale⇄Rent quick toggle** (Vehicles/Property ⇄ Rentals remap) | Post | missing | missing | client logic (category/subcat remap) | no | S | Neither native has the category-flipping toggle. |
| 26 | Reorder photos & set cover (drag) | Post | missing | missing | `POST /api/upload` (order) | no | M | Both render fixed strip; cover = first pick. iOS `.onMove`/draggable, Android reorderable list. |
| 27 | AI Polish / rephrase description | Post | missing | missing | `POST /api/ai/rephrase` | no | S | ✨ button both. |
| 28 | Take photo with camera | Post | partial (`PostView.swift:160` CameraPicker) | missing (`PostScreen.kt:42` library only) | `POST /api/upload` | no | M | Android needs `TakePicture` contract. |
| 29 | Record video with camera | Post | partial (`PostView.swift:166`) | missing (library only) | `POST /api/upload/video/sign` | no | M | Android needs `CaptureVideo` contract. |
| 30 | Video client-side compression / HEVC normalize | Post | partial (`PostModel.swift:324` `exportMP4` 720p) | missing (`Post.kt:158` refuses >50MB) | `POST /api/upload/video/complete` | no | M | Android needs media3-transformer transcode. |
| 31 | AI auto-fill from cover photo | Post | native (full apply) | partial (`Post.kt:73` only cat/condition/title) | `POST /api/ai/classify` | no | S | Android drops subcat/type/brand/model/attrs the server returns (`Post.kt:92-94`). |
| 32 | Pick subcategory | Post | native (`PostView.swift:220`) | missing (no field) | `GET /api/categories` (meta.subcategories) | no | S | Add Android dropdown from taxonomy meta. |
| 33 | Listing type / intent (sell·rent·service·job·wanted) | Post | native (`PostView.swift:233`) | missing (never sends listingType) | `GET /api/categories` (meta.types) | no | S | Android defaults server-side to sell. |
| 34 | Brand input (+ suggestions) | Post | partial (`PostView.swift:243`, no autocomplete) | missing | `GET /api/brands?limit=120` | no | S | Add Android field; optional `/api/brands` autocomplete both. |
| 35 | Model input | Post | native (`PostView.swift:246`) | missing | — | no | S | Add Android field. |
| 36 | Per-category chip facets (attributes) | Post | native (`PostView.swift:289`) | missing (sends no attributes) | `GET /api/categories` (meta.facets) | no | M | Add Android facet UI + required-fill. |
| 37 | Per-category range facets (year/mileage/engine) | Post | native (`PostView.swift:300`) | missing | `GET /api/categories` (meta.facets kind=range) | no | M | Map to columns w/ clamping (mirror `PostModel.swift:404`). |
| 38 | Urgent ("Bán gấp") toggle + negotiable coupling | Post | partial (`PostView.swift:338`) | missing (never sends urgent) | `POST /api/listings` (urgent, server quota/cooldown) | no | S | Add Android toggle + coupling. |
| 39 | Contact name field (business name posting) | Post | partial (`PostView.swift:381`) | missing (phone only) | `GET /api/me` | no | S | Android has no contactName/business-name. |
| 40 | Price-unit label (/month, /service, /job) | Post/PDP | missing | missing | — | no | S | Derive from listingType; both show only "đ". Also verify PDP `priceUnit` render. |
| 41 | Market-price guidance band on price step | Post | missing | missing | `GET /api/price-guidance?brand&model&condition&year` | no | M | p25/median/p75, n≥5. Depends on Android brand/model (34/35). |
| 42 | Geolocate — "use my current location" (reverse-geocode) | Post | missing | missing | `GET /api/reverse-geocode?lat&lng`, `GET /api/geo` | no | M | CoreLocation/FusedLocation + set lat/lng + province/ward. |
| 43 | Draft autosave (crash-insurance restore, 15-min TTL) | Post | missing | missing | — | no | M | UserDefaults / DataStore. |
| 44 | Missing-field checklist / "what's still needed" | Post | partial (`PostView.swift:87` scattered footers) | partial (`Post.kt:102`) | — | no | S | Neither shows consolidated "what's left". |
| 45 | Success screen enrichment (first-listing celebration, view-live link, share) | Post | partial (`PostView.swift:422`) | partial (`PostScreen.kt:274`) | — | no | S | Basic confirmation only. |
| 46 | First-listing celebration + post-listing analytics (`trackPostListing`) | Post | missing | missing | Meta CAPI via analytics | no | S | Needs native analytics hook. |
| 47 | Client-side phone/contact/banned-word pre-flight | Post | missing | missing | — (server also enforces) | no | S | UX nicety; server codes contact_in_text/banned_words already caught. |
| 48 | **View-count increment** (server view tracking) | PDP | missing (`ListingDetailView.swift:147` local RecentStore only) | missing (`detail/Detail.kt:67`) | `POST /api/listings/[id]/view` | no | S | Native PDP opens never increment server views nor fire view_item. |
| 49 | **Area / location filter** (province→ward→near-you radius) | Filters | missing | missing | `GET /api/geo?type=provinces\|wards`, `/api/reverse-geocode`, `/api/listings?province&ward&lat&lng&radius` | no | L | Biggest filter gap. Two-tier geo picker + geolocation. Endpoints exist. |
| 50 | Verified-sellers-only filter | Filters | missing | missing | `GET /api/listings?verified=1` (confirm param) | no | S | Small server add if param absent. |
| 51 | Listing-type / intent filter (Buy/Rent/Free/Wanted/Swap) | Filters | missing | missing | `GET /api/listings?type=` (confirm) | no | M | FeedModel has no listingType param. |
| 52 | Per-category custom/range facets (engine cc, bedrooms, size, year…) | Filters | missing | missing | `GET /api/listings?<facetKey>=` (taxonomy-driven) | no | L | Generic facet renderer from `/api/categories` defs. |
| 53 | Compact / list view toggle | View-modes | missing | missing | `GET /api/listings` (same data) | no | M | Needs `CompactListingRow` + view-mode control. |
| 54 | Map view (pins, radius, cluster, pin→PDP) | View-modes | missing | missing | `GET /api/listings` + bbox/viewport endpoint | **yes** | L | MapKit / Maps Compose. Viewport endpoint for panning. |
| 55 | Video view (vertical video feed of clips) | View-modes | missing | missing | `GET /api/listings?hasVideo` | **yes** | L | AVPlayer/ExoPlayer autoplay rail. |
| 56 | Locate-a-card-on-map ("Xem trên bản đồ") | View-modes | missing | missing | client | no | S | Depends on map view (54). |
| 57 | Visual / photo search (camera/library → Gemini Vision → query) | Search | missing | missing | `POST /api/ai/visual-search` | no | M | Camera icon in every web search bar. Feed result query into existing search. |
| 58 | Zero-results recovery (remove-chips, clear-all, create-alert, post-Wanted, browse cats) | Search | partial ("No results" text only) | partial ("No results" text only) | `POST /api/saved-searches`, `/post` | no | M | Native dead-ends. |
| 59 | Typeahead — add brand suggestion row | Search | partial (listings+categories only) | partial (same) | `GET /api/search/suggest?q=` | no | S | Native `SuggestResponse` drops brands. Confirm endpoint returns brands. |
| 60 | Category landing screen (subcat bar + sort + filters over grid) | Browse | native (`CategoryFeedView.swift`) | missing (only QuickFind filter-in-place) | `GET /api/listings?category` + `/api/categories` | no | M | Build Android twin. |
| 61 | Category deep-link route (push/universal link → /c/[slug]) | Browse | redirect (`FeedView.swift:72` WebTabView) | missing (no route) | `GET /api/listings?category` | no | S | iOS already HAS `CategoryFeedView` — repoint deep-link; add Android route. |
| 62 | Category + district landing (/c/[category]/[district]) | Browse | missing | missing | `GET /api/listings?category&province/ward` | no | M | Depends on area filter (49). |
| 63 | Brand directory (/brands index) | Browse | missing | missing | global active-brands list (`/api/brands` is category-scoped) | **yes** | M | Needs new global directory endpoint. |
| 64 | Brand landing (/brands/[slug]) | Browse | redirect (`FeedView.swift:73` WebTabView) | missing (no route) | `GET /api/listings?brand=<slug>` | no | M | FeedModel already supports brand param — cheap native build. |
| 65 | Saved searches — list | Saved | missing | missing | `GET /api/saved-searches` | no | M | Auth-gated section absent both. |
| 66 | Saved search — run (apply query natively) | Saved | missing | missing | client URL-param → FeedModel parser | no | S | Needed to run without opening web. |
| 67 | Saved search — toggle alert on/off | Saved | missing | missing | `PATCH /api/saved-searches/[id] {notify}` | no | S | Optimistic w/ rollback. |
| 68 | Saved search — delete | Saved | missing | missing | `DELETE /api/saved-searches/[id]` | no | S | — |
| 69 | Create saved search / alert from current search | Saved | missing | missing | `POST /api/saved-searches` | no | M | Tie into results + zero-results recovery (58). |
| 70 | **Thread: mark-as-sold prompt after seller accepts offer** | Messages | missing | missing | `POST /api/listings/[id]/status` | no | S | Seller-only anchored prompt under offer card. Endpoint already used by My Listings. |
| 71 | Thread: post-deal review prompt (buyer star + note) | Messages | missing | missing | `POST /api/sellers/[id]/reviews` | no | M | Add hasReviewed/listing.status fields to ChatThread (no new endpoint). |
| 72 | Thread: quick-reply chips (seller/buyer canned + auto-send) | Messages | missing | missing | messages endpoint | no | M | Big daily-driver seller UX. |
| 73 | Thread: quick-reply "Can meet in…" geolocate auto-fill | Messages | missing | missing | `GET /api/reverse-geocode` | no | M | Part of chips (72). |
| 74 | Thread: buyer availability answered inline from fresh 7-day confirm | Messages | missing | missing | `GET /api/conversations/[id]` (availabilityConfirmedAt) | no | S | Add field to ThreadListing model (server returns it). |
| 75 | Thread: realtime new-message delivery (Supabase broadcast) | Messages | partial (`ThreadView.swift:158` 12s poll) | partial (`Thread.kt:59` 12s poll) | Supabase Realtime private channel `convo:{id}` | no | M | Native lags up to 12s; needs native Realtime client. |
| 76 | Thread: off-platform / scam warning under suspicious message | Messages | missing | missing | client regex (safe-hosts excluded) | no | S | — |
| 77 | Thread: trust header on counterpart (score/tier/member-since/isNew) | Messages | missing | missing | `GET /api/conversations/[id]` (counterpart.trust) | no | S | Add trust object to ThreadCounterpart (server returns it). |
| 78 | Thread: tap counterpart name → seller profile | Messages | missing | missing | — (sellerId in payload, unused) | no | S | Depends on native storefront (9). |
| 79 | Thread: tap listing title/image → native PDP | Messages | missing | missing | — | no | S | Listing bar not tappable. |
| 80 | Thread: report conversation — wire entry point | Messages | partial (ReportSheet accepts conversationId, no thread entry) | partial (same) | `POST /api/reports` | no | S | Just add overflow/flag action in ThreadView/ThreadScreen. |
| 81 | Thread: "New messages" pill (arrival below fold) | Messages | missing | missing | — | no | S | Native auto-scrolls, can yank from history. |
| 82 | Inbox: delete conversation — 5s Undo + confirm | Messages | partial (swipe, immediate) | partial (long-press, immediate) | `DELETE /api/conversations/[id]` | no | S | Native deletes irreversibly, no undo/confirm. |
| 83 | Inbox: search / filter conversations | Messages | missing | missing | client filter | no | S | No search field either app. |
| 84 | Availability review — daily batch flow (tick-sold, bump rest, 2-skip gate, once/day auto-open) | Listings | partial (per-listing confirm only) | partial (`MyListings.kt:160`) | `POST /api/listings/[id]/confirm` | no | M | Batch UX is web-only. |
| 85 | Notifications — deep-link url routing to NATIVE screens (saved-search filter, reminder, dispute, price_drop, generic) | Notifications | partial (url → WebSheet fallback) | partial (only conversation/listing; url rows are dead taps) | notification.url/conversationId/listingId | no | M | Owner forbids WebSheet fallback. Extend DeepLinkRouter both. |
| 86 | Notifications — delete single (swipe/X) | Notifications | native (`NotificationsView.swift:52`) | missing (clear-all only) | `DELETE /api/notifications/[id]` | no | S | Add Android swipe/long-press. |
| 87 | Notifications — mark single read (per-row) | Notifications | partial (marks all on open) | partial (marks all on open) | `POST /api/notifications/read {ids:[id]}` | no | S | Endpoint already accepts ids. |
| 88 | Notifications — clear-all 2-tap confirm | Notifications | partial (immediate) | partial (immediate) | `DELETE /api/notifications` | no | S | Add confirm step. |
| 89 | **Push notifications** — device registration + tap routing (APNs/FCM) | Notifications | partial (`PushManager.swift` built, `enabled=false`) | missing (no FCM service) | `POST /api/push/native-subscribe` | no | L | Flip iOS on (aps-environment entitlement + APNS_* env); build Android FCM half. Server ready. |
| 90 | Notification / push preferences screen | Settings | redirect (More-settings WebSheet) | missing | `POST /api/push/subscribe`, `/api/profile/reminder-prefs` | no | M | No native prefs screen; system-permission prompt + reminder toggles. |
| 91 | Weekly digest email opt-in toggle | Settings | redirect (More-settings WebSheet) | missing | `GET/POST /api/profile/digest-prefs` | no | S | Trivial native Switch. |
| 92 | Edit profile — display name | Settings | partial (`SettingsView.swift:45`) | missing (WebTab) | `PATCH /api/profile` | no | S | Build Android settings form. |
| 93 | Edit profile — contact phone / Zalo | Settings | partial (`SettingsView.swift:47`) | missing | `PATCH /api/profile` (409 phone_taken, bad_phone) | no | S | — |
| 94 | Edit profile — avatar/photo upload | Settings | missing | missing | `POST /api/upload (kind=avatar)` → `PATCH /api/profile {avatarUrl}` | no | M | Picker + client compress; send only when changed (else 400). |
| 95 | Account-type switch (individual ↔ business) | Settings | partial (`SettingsView.swift:57`) | missing | `POST /api/profile/account-type` | no | S | Handles business_name_required. |
| 96 | Business storefront editor — name/about/location/contact + ward picker + geolocate + rep name | Storefront | partial (`BusinessProfileView.swift:9`, omits ward/geolocate/rep name) | missing | `GET /api/dashboard` → `PATCH /api/seller`; `/api/reverse-geocode`; rep name via `PATCH /api/profile` | no | M | Android absent; iOS partial. |
| 97 | Business storefront — legal identity (legalName/legalAddress/idNumber/taxCode) | Storefront | partial (`BusinessProfileView.swift:48`) | missing | `PATCH /api/seller` (bad_id_number/bad_tax_code) | no | S | Đ.29 legal duty. |
| 98 | Delete account (typed DELETE confirm + identity re-check) | Settings | partial (`SettingsView.swift:93`) | missing | `POST /api/account/delete {confirm:'DELETE'}` | no | S | iOS re-fetches `/api/me`, aborts on bearer switch — port pattern. |
| 99 | Data export (download all my data, PDPL) | Settings | redirect (More-settings WebSheet) | missing | `GET /api/account/export` | no | S | Bearer GET → share/save sheet. |
| 100 | Language selector (in-app EN/VI override + persist) | Settings | missing (device-locale only) | missing (device-locale only) | `POST /api/profile/locale` | no | L | Making L10n settable touches every `tr()` call site. |
| 101 | Display-currency selector | Settings | missing (hardcoded VND) | missing | — (likely needs FX source) | no | M | — |
| 102 | Theme (light/dark) selector | Settings | missing (OS-only) | missing | — | no | M | Persisted override → Tokens/colorScheme. |
| 103 | Cookie-consent withdrawal (PDPL) | Settings | missing | missing | — (client) | no | S | Add native privacy/consent screen or document N/A. |
| 104 | Legal — 18+ consent + Terms/Privacy links at sign-in | Auth | redirect (inside web /signin) | redirect | account-type snapshots TOS_VERSION | no | S | Reproduce on native sign-in when OTP goes native. App Store expects in-app Terms/Privacy. |
| 105 | **Sign in — Apple** (App Store Guideline 4.8) | Auth | missing | missing (n/a) | Supabase `?provider=apple` (not configured) | **yes** | M | Not a web-parity gap but required for App Store when Google offered. ASAuthorizationAppleIDProvider + Supabase Apple config. |
| 106 | View own storefront (from account) | Storefront | missing | missing | `GET /api/sellers/[id]` | no | M | Shares screen with row 9. |
| 107 | Help center | Help | missing | missing | — (static FAQ) | no | M | Native static screen both. |
| 108 | Bulk CSV upload (business) | Listings | missing | missing | `GET /api/categories`, `POST /api/listings/bulk` | no | L | File-picker + CSV parse/preview + category mapping. |
| 109 | Developers — API keys + webhooks + MCP (business) | Developers | missing | missing | `GET/POST /api/keys`, `DELETE /api/keys/[id]`, `/api/webhooks`, `/api/mcp` | no | M | Secret/signing-secret shown once. |
| 110 | Appeal a report outcome / enforcement action + supplement | Trust | missing | missing | `POST /api/report/appeal`, `/api/enforcement/appeal`, `/api/reports/[id]/supplement` | no | M | Also needs a native "my reports/enforcement" view. |
| 111 | Business analytics stats strip — Saves + combined views/leads + tappable unread | Analytics | partial (`MyListingsView.swift:30`) | partial (`MyListings.kt:148`) | `GET /api/dashboard` (stats) | no | S | Native shows lighter subset. |
| 112 | Reviews preview on PDP (avg + ≤2 verified snippets + "See all") | PDP | missing | missing | `GET /api/sellers/[id]/reviews` | no | M | — |
| 113 | More-from-this-seller shelf (PDP) | PDP | missing | missing | `GET /api/listings?sellerId=` | **yes** | M | No public seller-scoped listings API confirmed. |
| 114 | More-like-this (same-category) rail | PDP | native (`ListingDetailView.swift:369`) | missing | `GET /api/listings?category=&limit=9` | no | M | Build Android. |
| 115 | Recently-viewed rail on PDP | PDP | missing | missing | local RecentStore (already records ids) | no | M | Both record views, neither renders the rail on PDP. |
| 116 | Buyer-protections row + explainer sheet | PDP | missing | missing | static | no | M | — |
| 117 | Map / location on map (PDP) | PDP | missing | missing | `GET /api/listings/[id]` (district/location) | no | L | MapKit / Maps Compose. |
| 118 | Sold / unavailable state (rich Sold page vs generic 404) | PDP | partial (generic "no longer available") | partial (same) | `GET /api/listings/[id]` — must return sold detail, not 404 | **yes** | M | API 404s sold; needs sold-detail envelope for native sold screen. |
| 119 | Enforcement caution banner (throttled/held seller warning) | PDP | missing | missing | `GET /api/listings/[id]` — add ownerEnforcement.state | **yes** | M | Envelope doesn't carry enforcement state. |
| 120 | Previous-price drop % badge + drop countdown timer | PDP | partial (strikethrough only) | partial (strikethrough only) | `GET /api/listings/[id]` (prevPrice, dropExpiresAt) | no | M | No −X% counter/timer; dropExpiresAt likely missing in native model. |
| 121 | Description light-markdown formatting (bullets/bold/headings/paragraphs) | PDP | partial (plain Text `ListingDetailView.swift:59`) | partial (plain Text `Detail.kt:174`) | `GET /api/listings/[id]` (description) | no | M | Native shows raw markers literally. |
| 122 | Localized/translated title + description body | PDP | partial (server displayTitle only) | partial | `GET /api/listings/[id]`; `POST /api/translate` | no | M | Native doesn't translate free-text body per UI language. |
| 123 | Brand chip (logo + name → brand feed) | PDP | missing | missing | `GET /api/listings/[id]` (brandSlug) + `/api/listings?brand=` | no | M | Depends on brand landing (64). |
| 124 | Social-proof counters (saved/views/contacted, ≥3/≥20 floor) | PDP | partial (full row, no floor) | partial (views only) | `GET /api/listings/[id]` (views, savedCount, contactCount) | no | S | Android shows only views; neither applies credibility floor. |
| 125 | Safety strip (category-aware) + Safe-trading guide link | PDP | missing | partial (categoryKey hardcoded 'default') | static | no | S | iOS has none; Android generic; no guide link either. |
| 126 | Bottom safety note ("Meet in a public place…") | PDP | missing | partial (folded into strip) | static | no | S | iOS omits entirely. |
| 127 | Report seller (distinct action) | PDP | native (menu item) | partial (only "Report this listing"; sellerId passed) | `POST /api/report` | no | S | Add Android seller-report entry. |
| 128 | Photo index counter overlay ("3 / 12", "View all photos") | PDP | partial (dots only) | partial (no counter) | — | no | S | Numeric counter/label missing. |
| 129 | Fixed-price badge (non-negotiable) | PDP | missing | missing | `GET /api/listings/[id]` (negotiable) | no | S | Neither surfaces the chip. |
| 130 | Breadcrumb nav (Home › Category › Listing) | PDP | missing | missing | — | no | S | Nav-bar back only. |
| 131 | Chat find-or-create — remove web fallback on API refusal | Messages/PDP | native w/ web fallback | native w/ web fallback | `POST /api/conversations` | no | S | On own-listing/caps refusal both fall back to web listing page — replace with native error. |

---

## New server endpoints needed (`needsNewServer=true`)

- **Sold-state detail** — `GET /api/listings/[id]` must return **sold listing detail** (name, seller's other stock, category) instead of 404, so native can render a rich Sold screen. *(row 118)*
- **Enforcement state in listing envelope** — add `ownerEnforcement.state` (throttled/held/suspended) to `GET /api/listings/[id]` for the pre-contact caution banner. *(row 119)*
- **Seller-scoped public listings** — `GET /api/listings?sellerId=` (or equivalent) for the "More from this seller" shelf; no public seller-scoped listings API is confirmed. *(row 113)*
- **Global active-brands directory** — a JSON list endpoint (current `/api/brands` is category-scoped) to build the native `/brands` grid. *(row 63)*
- **Map viewport/bbox listings** — a bounding-box query so map panning (`onMove`) doesn't page the whole feed. *(row 54)*
- **Video-filtered feed** — confirm/build `GET /api/listings?hasVideo` for the native Video view. *(row 55)*
- **Supabase Apple provider config** — enable `provider=apple` for Sign in with Apple (App Store 4.8). *(row 105)*
- *(Confirm, small-add-if-missing, not counted above)* `?verified=1` and `?type=` params on `/api/listings` if not already accepted. *(rows 50, 51)*

---

## Already fully native (no action)

- **Posting core:** library multi-photo add, remove photo, retry upload, add library video, category pick, title, description (20-char rule), condition, price, negotiable, province/ward pickers, contact phone, publish/submit, quick-edit (title/price/negotiable/description).
- **PDP display:** swipeable gallery, video-first page, fullscreen lightbox, price block, market-price gauge, urgent badge, condition chip, numeric spec chips, location + posted-ago meta, details/attributes table, seller-card identity, trust mini badge, trust tier chip/verified badge display, report listing, share, save/favorite, chat-only contact (by design — no phone/Zalo reveal on web).
- **Messages:** inbox list, unread badge, offer-aware preview, thread bubbles/day-separators, send text (optimistic + clientId), tap-to-retry, accept/decline/counter offer, offer-card rendering, first-contact safety note, start conversation from listing.
- **Feed/Browse:** latest feed (infinite scroll), For-You rail, outstanding-businesses rail, category rails, recently-viewed rail, pull-to-refresh, quick-find category/subcategory/brand+model, sort tabs, price-range filter, condition filter, grid view, text search, trending searches, recent searches, category-scoped search.
- **Saved:** saved listings grid, save/unsave heart.
- **Auth/Account:** Google OAuth (native PKCE both), sign out (with WebView cookie-jar clear), signed-in profile.
- **Notifications:** bell + unread badge, list screen, mark-all-read on open.
- **Trust/Report:** report sheet (listing/seller/conversation reasons, 401/429 handling).

---

## Suggested build order & lane split

Lanes: **Murat** = Post / Messages / Auth. **Kyle** = Feed / Listing(PDP) / Browse / Settings / Server.

### Wave 0 — Server unblocks (Kyle, do first; several native builds depend on these)
- Sold-state detail envelope (118), enforcement state in envelope (119), seller-scoped listings (113), global brand directory (63), map bbox endpoint (54), video-filter param (55), confirm `verified`/`type` params (50/51), Supabase Apple provider (105). *These gate rows 9, 54–55, 60–64, 112–113, 118–119.*

### Wave 1 — Kill the highest-traffic / transactional redirects
- **Murat:** Phone OTP native (1) + Email OTP native (17) + Turnstile mint (24) + legal consent copy (104) + onboarding gate (18); AI Concierge native chat + cards + photo search (3/4/5).
- **Kyle:** Full native listing edit (2) — after Android Post parity lands (Wave 2) it can complete; start the shared **native seller storefront** screen (9/106) and **/trust** explainer (20).

### Wave 2 — Core marketplace mechanics + Android Post parity
- **Murat:** PDP make-offer slider (6/16), thread buyer make-offer (7), request-contact-reveal (8), mark-as-sold prompt (70), review prompt (71), quick-reply chips + geolocate (72/73), realtime delivery (75). **Android Post parity block:** camera photo/video (28/29), video transcode (30), full AI autofill (31), subcategory (32), listing type (33), brand/model (34/35), chip+range facets (36/37), urgent (38), contact name (39). Then full-edit (2) completes.
- **Kyle:** Dispute case room native (10/11/12/13/14/15) + report→room; native settings surface for Android + iOS gaps (19, 90–99), logo upload (21), handle editor (22), change email (23), data export (99).

### Wave 3 — Filters, browse depth, saved searches, view-count
- **Kyle:** Area/location filter (49), listing-type filter (51), verified filter (50), custom/range facets (52), Android category landing (60) + deep-link repoint (61), brand landing (64) + directory (63), category+district (62), compact/list view (53), map view (54) + locate-card (56), video view (55). Server view-count wiring reachable by Murat via PDP.
- **Murat:** saved searches full CRUD + create-alert (65–69), visual search (57), zero-results recovery (58), typeahead brand row (59), view-count POST (48), start-chat web-fallback removal (131).

### Wave 4 — Push + PDP enrichment + polish
- **Murat (push):** flip iOS push on (89) + build Android FCM half; notification deep-link native routing (85), per-item read/delete/confirm (86/87/88).
- **Kyle (PDP enrichment):** reviews preview (112), more-from-seller shelf (113), Android more-like-this (114), recently-viewed PDP rail (115), buyer-protections row (116), PDP map (117), drop %/countdown (120), markdown description (121), translation (122), brand chip (123), social-proof counters (124), safety strip + note (125/126), Android report-seller (127), photo counter (128), fixed-price badge (129), breadcrumb (130), price-unit label (40), market-price guidance (41).
- **Messages polish (Murat):** off-platform warning (76), trust header (77), tap name/listing nav (78/79), report-conversation wiring (80), new-messages pill (81), delete undo/confirm (82), inbox search (83), availability inline (74), realtime finish (75).
- **Remaining (Kyle):** availability batch flow (84), analytics strip (111), bulk CSV (108), developers panel (109), help center (107), appeals (110), language/currency/theme/cookie settings (100–103), Post niceties: reorder+cover (26), AI polish (27), sale/rent toggle (25), draft autosave (43), checklist (44), success enrichment (45/46), client-side guard (47), geolocate (42).

**Critical-path dependencies:** Full native edit (2) ⟵ Android Post parity (28–39). Brand chip/landing (64/123) ⟵ brand directory endpoint (63) + Android brand field (34). PDP map/area filters (49/117) ⟵ geo pickers + geolocation. Everything OTP (1/17/24/104) should ship together so no auth path touches web. All `WebSheet`/`WebTabView`/`WebTab`/`WebScreen` call sites listed above are the concrete removal targets.