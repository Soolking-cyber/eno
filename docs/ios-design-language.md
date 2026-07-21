# eno.vn iOS — design language & EnoUI plan (the canon)

Status: **APPROVED (owner, 2026-07-21) — direction: "diverge: brand + native chrome".**
Authored by Murat, synthesized from a dual external review (codex GPT-5.6 · Gemini 3.1 Pro) +
a measured survey of `apps/ios`. This is the single source of truth; where it conflicts with
older feature code, **this document and `EnoUI` win**. The earlier "page-by-page web copy"
rule is now explicitly relaxed for **chrome** (nav/tabs/sheets/menus/icons go native); the
**brand** (color, content hierarchy, radius, listing/seller identity) stays shared with web.

---

## 0. Why (the diagnosis, measured)

The iOS app grew as a **page-by-page copy of the web app**, so it inherited the *look* but
never a *system*. Today (65 `.swift` files):

| Layer | Web has | iOS has today |
|---|---|---|
| Color / radius tokens | ✅ | ✅ `Tokens` (color ramp + 3 radii) |
| **Type scale** | ✅ semantic | ❌ **272 raw `.font(.system)`** + half-used `scaledFont` |
| **Spacing / elevation** | ✅ | ❌ none |
| **Motion / haptics** | ✅ 3 springs, `.press`, pops | ❌ **none** |
| **Component library** | ✅ Base UI via `ui/*` | ❌ **none — the same primary button is drawn 10 ways across 15 files** (RoundedRectangle ×8, Capsule ×5, Circle ×2, radius 14/18/card…) |
| **Documented canon + lint** | ✅ `design-language.md` + `design-lint` | ❌ nothing |
| **Brand mark** | ✅ | ❌ "eno" hand-typed with ad-hoc kerning |

That is the whole "inconsistent, not-premium" story in numbers. The fix is **one documented
SwiftUI component library (`EnoUI`) + a complete token system + a motion/haptics layer + an
iOS brand + a lint gate**, migrated onto screen by screen.

---

## 1. Principle — **brand parity, not chrome parity**

A unicorn iOS app respects the platform. If users wanted the website they'd use it. So we
**keep the brand and diverge the chrome** (both reviewers agreed independently):

**Keep shared with web:** brand blue `#0A66C2` + adaptive palette · radius character ·
content hierarchy & vocabulary · listing/seller identity · trust/success/warning/destructive
semantics · full feature parity.

**Go native:** `NavigationStack` + system titles/toolbars · `TabView`, `.sheet` +
`presentationDetents`, `Menu`, alerts, context menus, swipe actions · `.searchable` /
`.refreshable` · **SF Symbols** (drop the Lucide look-alikes — SF Symbols align with SF Pro &
Dynamic Type) · native focus / VoiceOver / Dynamic Type. iOS 26 **Liquid Glass belongs to
navigation & floating chrome only, never content surfaces** (Apple's own guidance).

> ⚠️ This deliberately **relaxes the earlier "page-by-page, button-by-button web copy"
> directive** — the copy got us to feature parity; native chrome is what earns the premium
> feel. Requires owner sign-off (see the decision at the bottom).

---

## 2. Tokens (extend `Tokens` → `EnoUI` token files)

**Color** — keep the existing adaptive ramp as-is (it's good).

**Typography** — semantic roles mapped to **`Font.TextStyle`** (native Dynamic Type; **drop
`scaledFont` + its `maxSize` caps** — caps hide layout defects & fail accessibility). Prices
add `.monospacedDigit()`.

| Role | Style / weight | Use |
|---|---|---|
| `titleXL` 34 · `titleL` 28 · `title` 22 | largeTitle/title/title2 · bold | hero/screen titles (rare; nav titles stay system) |
| `headline` 17 semibold | card titles, list headers |
| `body` 17 · `callout` 16 · `label` 15 semibold | body / secondary / **all buttons & fields** |
| `caption` 13 · `micro` 11 semibold | metadata & tags / badges |

**Spacing** — 4pt half-step on an 8pt rhythm: `1=4 2=8 3=12 4=16 6=24 8=32 12=48 16=64`;
`screenGutter = 16`.

**Radius** — keep `card 11 / control 9 / chip 7`.

**Elevation** — mostly flat; hierarchy comes from surface + 1pt ring, not shadows:
`flat` (ring only) · `raised` (6%/24% r3 y1) · `floating` (10%/30% r10 y4, map/filter bar) ·
`overlay` (16%/38% r24 y10, media only). System sheets/menus own their own elevation.

**Motion** — `springSnappy` `.spring(0.22, bounce:0.08)` (press, chips) · `springStandard`
`.spring(0.34, bounce:0.12)` (layout/state) · `springSuccess` `.spring(0.46, bounce:0.22)`
(rare wins) · `fadeFast` easeOut 0.16 · `standard` easeInOut 0.24. **All custom motion reads
`accessibilityReduceMotion`** (drop scale/travel, keep a short opacity change).

---

## 3. `EnoUI` — the component library

A **local Swift package** `apps/ios/Packages/EnoUI` (a real compiler boundary: **no
networking, app models, `L10n` or feature state inside** — components take strings, values and
closures only). Structure: `Tokens/ · Modifiers/ · Primitives/{Actions,Forms,Surfaces,DataDisplay,Feedback}/ · Patterns/`.

**Composition rules:** public components are **custom `View`s** (`EnoButton`, `EnoField`,
`EnoCard`…) that own semantics/accessibility/states/hit-targets. Style protocols
(`ButtonStyle`/`LabelStyle`) are **internal implementation only** — feature screens never
assemble `Button{}.buttonStyle()`. `ViewModifier` only for orthogonal behavior
(`.enoTextStyle`, `.enoElevation`, `.enoSkeleton`). **Wrap native, don't reimplement**
(segmented = `Picker(.segmented)`; sheets stay native, standardized by `EnoSheetScaffold`).
Everything is `Eno`-prefixed. **Semantic types over boolean soup** — `isPill`/`hasShadow`/
`looksLikeButton` mean two components were collapsed into one.

| Component | Contract |
|---|---|
| `EnoButton` | `.primary/.secondary/.tertiary/.destructive`; sizes compact 36 / regular 44 / large 50; loading + disabled built in; **press-scale 0.98 inside the style** |
| `EnoIconButton` | ≥44×44 target, glyph 17–20, explicit a11y label; press-scale 0.96 |
| `EnoToolbarButton` | native toolbar appearance (iOS 26 glass auto) |
| `EnoCard` / `EnoInteractiveCard` | radius 11, 16 pad, 1pt ring, no shadow / + press state + button trait |
| `EnoChip` | interactive filter/toggle/removable, ≥32h, radius 7 |
| `EnoBadge` | passive status/count only — **never tappable** |
| `EnoField` / `EnoTextArea` | label + input + helper/error + focus ring around `TextField`/`TextEditor` |
| `EnoSheetScaffold` | title, optional close, content, safe-area CTA; native detents |
| `EnoAvatar` | 24/32/40/56, image → initials fallback |
| `EnoListRow` | leading/title/subtitle/trailing, ≥56h, vertical at a11y sizes |
| `EnoSegmentedControl` | wraps native segmented `Picker` (no button strip) |
| `EnoEmptyState` / `EnoPageState` | symbol + title + guidance + one recovery action / loading·empty·error·content switch |
| `EnoSkeleton` | geometry-matched, delayed ~150ms, reduce-motion aware |
| `EnoListingCard` / `EnoSellerRow` / `EnoBottomActionBar` | the shared marketplace patterns |

---

## 4. "Unicorn feel" recipe

**Do:** press-scale in the style (content 0.98, icon 0.96, hit target unchanged) ·
`.contentTransition(.numericText())` on price/unread/saved counts · matched-geometry **only**
for the selected filter / view-mode indicator · crossfade loaded images ~160ms · skeletons
that mirror the final layout, delayed ~150ms · `.sensoryFeedback`: `.selection` when a filter
actually changes, light impact on save, `.success` on publish, `.error` on a rejected action ·
explicit loading/empty/error/recovery on **every** network surface · native context menus,
swipe actions, pull-to-refresh, sheet detents.

**Avoid:** haptics on nav/back/every CTA/keypress (cheap) · continuous bounce/pulse/parallax ·
endless shimmer · whole-screen matched-geometry · **glass on content surfaces** · custom tab/
nav bars · Lottie as a substitute for state clarity.

---

## 5. Enforcement — `apps/ios/Scripts/ios-design-lint.mjs`

Modeled on the web `design-lint`. **Outside `Packages/EnoUI/Sources/**`, fail on:** raw
`Button`/`TextField`/`SecureField`/`TextEditor`/`Toggle`/styled `Picker` · `.buttonStyle(.plain)`
· `.font(.system(size:))` / `.scaledFont` · numeric corner radii · raw `.shadow` · raw hex/RGB
· local helpers shaped like `chip`/`badge`/`primaryButton`/`cardStyle` · new public UI types
without `Eno` prefix. **Allowed** (native primitives, not hand-rolls): `PhotosPicker`,
`ShareLink`, `Menu`, `NavigationLink`, `Map`.

**Shrinking baseline:** key by `rule + file + normalized source` (not line numbers); fail on
every *new* violation from day one; delete a file's baseline entries the moment it's migrated;
delete the baseline when it hits zero. Runs as an xcodegen build phase + in CI.

---

## 6. Documentation — three layers, lint is the gate

1. **This markdown = policy canon.** Principles, tokens, component-choice table, exceptions.
2. **`EnoUI` source = executable canon.** Values & APIs live only here, with `///` + one usage example.
3. **`EnoCatalogView` = rendered canon.** Live `#Preview` + a Debug-only Settings route;
   matrices for light/dark, enabled/disabled/loading, default/accessibility type, long
   Vietnamese copy. Previews are required *documentation*; **lint + the compiler boundary are
   the enforcement.** (No DocC site yet.)

---

## 7. Migration — two engineers, no collisions

**Ownership** (one owner per primitive & per feature dir — never both edit shared infra):

| Owner | Library | Feature lane |
|---|---|---|
| **Murat** (built Phase 0) | Tokens, typography, `EnoButton`/`EnoIconButton`, `EnoCard`, `EnoChip`/`EnoBadge`, **lint**, package + `project.yml` integration | `Feed`, `Listing`, `Search`, `Saved` |
| **Kyle** | `EnoField`/`EnoTextArea`, `EnoAvatar`, `EnoListRow`, `EnoSegmentedControl`, `EnoSheetScaffold`, `EnoEmptyState`/`EnoSkeleton`/`EnoPageState` | `Post`, `Messages`, `Dashboard`, `Notifications`, `Shared` |

Murat exclusively owns the conflict hotspots during migration: `project.yml`, `RootView.swift`,
legacy `DesignTokens.swift`/`ScaledFont.swift`, the lint baseline, the catalog, this doc.
Kyle *requests* primitive changes rather than editing Murat-owned component files.

**Waves:** (1) **Contract freeze** — agree names/variants/token values, scaffold the package,
install the baseline, no restyling yet. (2) **Reference slices in parallel** — Murat: listing
card + feed filter/view selector; Kyle: post form + one sheet → fix & freeze the primitive
APIs against two demanding flows. (3) **Lane migration** — migrate *whole files*, drop each
from the baseline immediately, never mix behavioral refactors with visual migration. (4)
**Convergence** — remove remaining raw controls, delete `scaledFont` + legacy token aliases,
**remove the root `.buttonStyle(.plain)` (only now, at zero raw buttons)**, flip lint to
zero-tolerance. (5) **Polish** — restrained motion/haptics *after* consistency + accessibility.

**Definition of done (per screen):** zero lint exemptions · all controls from `EnoUI` or an
approved native API · no raw fonts/radii/shadows/colors/`.plain` · loading+empty+error+disabled
states exist · VoiceOver labels/traits/order correct · ≥44pt targets · EN + VI · light/dark +
Reduce Motion + Reduce Transparency + Increased Contrast · default → largest Dynamic Type
without losing primary info · previews compile · build + lint pass. **Globally done** when the
baseline, `ScaledFont.swift`, the legacy `DesignTokens` aliases and the root `.plain` are gone.

---

## 8. Branding

One iOS brand kit: the **`eno` wordmark as an `EnoWordmark` component** (retire the ad-hoc
`Text("eno")` + hand kerning) · a refined **app icon** · a single **SF Symbols set** (one
weight/rendering policy) · the blue as the sole accent in both themes · price/number
formatting via the existing VN formatter. No second accent color, no gradients on content.

---

## 9. Top risks

Remove the global `.plain` too early → unmigrated CTAs regress on iOS 26 (**remove last**) ·
web-shaped `EnoUI` (a button strip is not a segmented control) · God components (15 booleans +
`AnyView`) · a permanent lint baseline (must shrink) · Dynamic Type caps (hide defects) ·
glass/shadows on content · feature deps inside the package · scattered iOS 26 availability
checks (centralize in `EnoUI`) · parallel ownership overlap on shared infra.
