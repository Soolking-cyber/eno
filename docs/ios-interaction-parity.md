# iOS Interaction / "Feel" Parity — web mobile → native

Behaviors (not pixels) the native iOS app must reproduce from the web mobile app.
Each: web source · exact logic · native status · how to wire. Pixel values are in
`docs/ios-pixel-parity-fixes.md`; this file is about **motion & interaction feel**.

## 1. Scroll-hide chrome (owner-flagged) — top header/search + bottom nav
- **Web:** `src/hooks/use-hide-on-scroll.ts`, used by BOTH `header.tsx:48` and
  `mobile-nav.tsx:99`. One shared signal: scroll **down** → header/search AND
  bottom nav retract off-screen; scroll **up** or near the top → they slide back.
- **Exact logic:** clamp `y = max(0, scrollY)`. If `y < 80` → always shown. Else if
  `|y − lastY| > 6` → `hidden = (delta > 0)`; update `lastY`.
- **Native status:** ❌ not implemented. `FeedView` just does `.toolbar(.hidden)`.
- **Wire:** helper shipped — `apps/ios/Eno/Core/ScrollHideChrome.swift` (`ChromeState.shared`
  is the exact port + `.tracksChromeHide()` modifier).
  1. Feed/list scroll container → `.tracksChromeHide()`.
  2. Header/search overlay → `.offset(y: ChromeState.shared.hidden ? -H : 0).animation(.easeOut(0.2), value: hidden)`.
  3. ⚠️ **Bottom nav: the system `TabView` bar (RootView.swift:14) CANNOT be offset.**
     To match the web, replace it with a **custom bottom bar** (an HStack pinned via
     `.safeAreaInset(edge: .bottom)`) and `.offset(y: hidden ? barH : 0)`. This is a
     RootView architecture change — the tab-bar owner's call.
- **Owner:** Kyle-NATIVE (FeedView + RootView).

## 2. Search focus → morph dropdown with quick chips (owner-flagged)
- **Web:** `header.tsx` — focusing the search opens a panel: recent searches +
  recent locations + trending chips (empty query), or instant results (≥2 chars).
  A "morph window" animates the pill into the panel.
- **Native status:** ✅ mostly present — `SearchView.swift` shows recents + trending
  on focus and streams `/api/search/suggest` at ≥2 chars. **Gaps to match:** the
  morph/expand transition, recent-LOCATION chips, and the exact chip styling
  (see pixel doc: 11px uppercase tracking-wider muted labels; term chips rounded-lg).
- **Owner:** Kyle-NATIVE (SearchView).

## 3. Pull-to-refresh
- **Web:** native browser / SWR revalidate on focus.
- **Native status:** ✅ present on Android feed/saved (`PullToRefreshBox`). iOS: verify
  `.refreshable` is on the feed/saved/account/my-listings scrolls. Add where missing.

## 4. Card entrance + tap feedback
- **Web:** `.reveal-on-scroll` fade-up as cards enter; `.press` = `active:scale-[0.985]`
  spring on cards/chips/CTAs (listing-card.tsx:139).
- **Native status:** ⚠️ partial. Add a `.press` ButtonStyle (scale 0.98, spring) on every
  card/chip/CTA, and a reveal-on-appear for feed cards (reduced-motion aware). (#7/#8 — Murat.)

## 5. Haptics on key taps
- **Web:** n/a (native affordance). **Native:** `UIImpactFeedbackGenerator` on
  favorite, send, publish, offer, sort-chip, tab switch. Partly done (FavoritesStore
  toggles a light impact). Extend to the rest. (#8 — Murat.)

## 6. Infinite scroll / pagination
- **Native status:** ✅ feed + search paginate via near-tail triggers. Verify parity.

## 7. Bottom-sheet filters + sort
- **Web:** filters open a bottom sheet; sort is an **underline** tab strip (not pills).
- **Native status:** ⚠️ sort tabs are pills (pixel doc high-sev). Filters: verify the
  sheet detents + the price/condition/area controls match. (Kyle-NATIVE.)

## 8. Card image carousel (swipe + dots)
- **Web:** the card image is a swipeable carousel with dots/arrows.
- **Native status:** ❌ single image. (#91 — later.)

---
**Coordination:** items 1/2/6/7/8 are Feed/Search/Listing (Kyle-NATIVE). 4/5 are the
shared `.press`+haptics foundation (Murat). The `ChromeState` helper is ready to
import — no new dependency. Verify each on the iPhone SE / iOS 18.4 sim (renders AVIF).
