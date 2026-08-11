# eno.vn icon language — the law for every glyph

This document governs every icon in the app. It extends `docs/design-language.md`
(the canon) — nothing here overrides the canon; where the canon is silent on icons,
this file decides. Constants live in `src/lib/icon-tokens.ts`; import them instead
of restating numbers. `scripts/design-lint.mjs` enforces the color rules on every
`.tsx` edit.

## 0. The signature — one line, washed in blue

> **Every eno glyph is a single ink line over a soft brand-blue wash.**

That is the whole trick, and it is deliberately simple. The glyph's *line* is
`currentColor` (inherits the surface's ink); its *interior* is filled with the
brand tint (`fill-brand-100` for artwork, `fill-brand-50` for chrome coins). The
wash is what makes a screen of eno icons read as one branded set at a glance,
without a single raster tile, gradient, or second hue. Active states are the same
idea turned up: **more wash, same line** — and the fully-saturated `fill-brand` is
reserved for *user-state* (saved, unread), never for mere location.

**⚠️ THE WASH IS A STATE, NOT A STYLE — OUTLINE-IDLE / FILLED-ACTIVE IS THE LAW**
(owner, 2026-08-07: *"use icons filling only when selected, not as default"*). Every
artwork/nav glyph renders as a PURE INK LINE at rest and takes its fill only when it
is the selected one. The always-on duotone that shipped earlier the same day is
HISTORY — see the §0/§6/§7 addendum at the foot of this file for what was on screen
and why it was reversed. Read that addendum before implementing anything from the
table below; it is the authority, and this table is its summary.

**How much of the glyph the fill covers then depends on the tier:**

| Tier | Fill | Why |
|---|---|---|
| **Category artwork** — tiles, chips, pickers, card placeholders (everything through `CategoryIcon`) | **nothing at rest; the whole silhouette when SELECTED** — a tinted body layer under the ink line | a grid is read as a SET. One curated region per glyph made neighbours disagree — some tinted, some hollow, some tinted in half their body — and side by side that reads as a rendering bug, not restraint. So when it fills, it fills completely |
| **Location-active nav + rail glyphs** | the same grammar: **pure line at rest, full duotone on selection** | owner ruling 2026-08-07 — "vehicle icon all should be filled in dashboard too", "help icon, storefront icons on select should be filled". A rail row is a selection, and a half-tinted selected row read as a rendering fault. It stays distinguishable from user-state because user-state is SOLID `fill-brand` (§5) while this is the pale `brand-100` body under the ink line |
| **Chrome + inline marks** — the seal's chief, EmptyState badges | **one closed region, always on** (`SEAL_CHIEF`) | the only tier with no idle/active grammar, because these are marks, not artwork: the chief IS the seal's design, and a mark has no "selected" state to earn a fill with |

Why this wins the A/B: Chợ Tốt's grid is playful 3D raster tiles — loud, busy,
un-themable. Carousell/Vinted win on restraint. eno takes the restraint (one line
weight per tier, true-neutral ink, generous whitespace) and adds *one* warm move —
the blue wash — that neither competitor has. Do not add a second move.

**DO** let the wash be the only color inside an icon.
**DON'T** introduce per-category rainbow fills, gradients, shadows, or raster
category art. One blue. The canon's 60/30/10 stands inside the icon too.

The one glyph BUILT from these moves — and owned outright — is the eno seal
(§0b). The wash is the family resemblance; the seal is the signature.

## 0b. The eno seal — the one proprietary glyph

> **One mark is ours alone: the app icon's rounded square melting into a
> shield keel, with a check inside it under a washed chief.**

Everything else we draw is lucide; the seal is authored. **The OWNABLE part is
the SILHOUETTE** — a flat 2.2-radius top falling into a keel, which no stock
shield has — and **the CHECK is what the mark MEANS**:

- the **flat top with 2.2-radius corners** is the eno app icon's rounded square,
- the sides fall into a **shield keel** — the mascots' silhouette family,
- the **check** is the meaning: verified. It is drawn to the shield's OPTICAL
  centre (apex y≈8.6, vertex y≈14.2), because the keel drags visual weight down,
- the **chief** (the closed band under the flat top) takes the §0 wash.

⚠️ **THE INTERIOR WAS A BARE HORIZONTAL BAR UNTIL 2026-08-07 AND IT IS NOT COMING
BACK.** The bar was meant to quote the crossbar of the wordmark's lowercase "e",
but with no letterform around it a viewer sees a MINUS SIGN inside a shield —
at 6x it reads "no entry", the opposite of trust (owner: "the new trust icons are
not good"). A check is unambiguous in every market and at every size, and the
identity never lived in the bar anyway. Any doc, comment or ticket still saying
"bar"/"e-bar" of the seal's interior is stale — it means the check.

Geometry lives ONCE, in `src/components/marketplace/eno-seal.tsx` — three
exported paths (`SEAL_OUTLINE`, `SEAL_CHECK`, `SEAL_CHIEF`) plus the `<EnoSeal>`
renderer (variants `wash` | `line`, stroke via an icon-tokens constant). The
`SEAL_BAR` deprecated alias is GONE (deleted 2026-08-11 with its last importer,
safety-strip.tsx) — import `SEAL_CHECK`. Never redraw or trace the seal locally:
a seal that drifts is a counterfeit, and the whole point of a signature is that
it is identical everywhere it appears.

⚠️ **A HAND-ROLLED SEAL MUST CARRY `strokeLinejoin="round"` ON THE CHECK.** The
check has an interior vertex; the bar had none, so the call sites that predate it
set only `strokeLinecap` and inherited SVG's default MITER join — a sharp spike
where §3 requires a round one. `<EnoSeal>` gets this right; copies must too.

**Meaning is reserved.** The seal marks *first-party trust*: trust score,
protections, fee safety, verification. It is not decoration — a seal stamped on
random chrome devalues every real one.

**The echo ladder** (the Vinted move — one mark, every scale):

| Scale | Where | Form |
|---|---|---|
| micro 10–12 | trust chips on cards / seller strips (`TrustScore` mini) | tinted chief + line + check |
| inline 14–16 | beside price/fee lines, safety bullets — `<EnoSeal className={ICON_SIZE.sm}>` | wash |
| chip 16–20 | fee/protection pills (safety strip, protections row) | wash |
| **any scale, inside a uniform SET** | a row/grid where every neighbour is the same ink at the same size and stroke: /guide's feature grid, /safety's TipGrids, the home page's WhyEno band | **`variant="line"`** |
| **any scale, on a NON-NEUTRAL surface** | a tinted or coloured panel where the ink already carries the meaning: disputes' "under review" in warning ink, a selected brand pill | **`variant="line"`** — a brand-100 chief over amber or red puts the invitation blue on the one panel that is not an invitation. (`safety-strip` is the third option: hand-rolled so the chief takes the STRIP's own ink at low opacity.) |
| badge 28–48 | the `TrustScore` seal (tier gradients keep their fills; the chief becomes the gloss, and the SCORE renders in the tier's text ink) | bespoke, in trust-score.tsx, from the same paths |
| display | the shield mascots — already this silhouette family, same line language | currentColor mask |

⚠️ **THE SET ROW IS NOT AN EXCEPTION TO THE WASH — IT IS THE §0 LAW APPLIED.** A single
filled glyph in a row of otherwise-line glyphs is the "some tinted, some hollow → reads as
a rendering bug" failure the outline-idle law was written to stop, and the seal is not
exempt from it just because the seal is ours. Judge by the NEIGHBOURS, not by the size:
`protections-row.tsx` is the contrasting sanctioned wash — a short mixed sheet where the
seal is deliberately the one accent — while `why-eno.tsx`, `/guide` and `/safety` are
uniform sets and take the line. In a set the mark still stands out, by being a SILHOUETTE
no other app has; that is the entire reason the silhouette, not the fill, is the ownable
part.

⚠️ **THE BADGE TIER DRAWS NO CHECK, DELIBERATELY.** The check and the numeral both
want the shield's optical centre, and drawn together they overlap into an
unreadable smudge (owner, 2026-08-07: "maybe not tickmark here"). In the badge the
NUMBER is the content and the silhouette + chief carry the identity; the check
belongs to the seal wherever it stands alone.

**Law:** in any first-party trust/safety/verification moment, the seal replaces
lucide `Shield` / `ShieldCheck` / `ShieldAlert` / `ShieldQuestion`. New code
starts on `<EnoSeal>`; existing call sites migrate inside their own pieces
(nav/header badges → nav-chrome; price-line inline → cards/PDP; fee + safety
chips → trust-safety). Lucide shields remain acceptable only for concepts that
are genuinely not eno trust (e.g. an admin quarantine state) — when in doubt,
it is the seal.

⚠️ **THE CARVE-OUT IS BIGGER THAN "ADMIN", AND THE TEST IS THE CHECK, NOT THE VOICE
(ruling, 2026-08-11).** "Is eno speaking?" is the WRONG test — eno speaks in a
suspension notice too. The right test is: **would "verified" be true here?** The seal's
interior is a check and the check means verified (§0b), so a seal leading *"your account
is held/suspended"* asserts trusted and untrusted with one mark, separated only by ink —
which does not survive being read without colour. An ENFORCEMENT / quarantine state is
therefore the carve-out whether the reader is an admin or the penalised seller
(`enforcement-banner`'s severe lead, `admin-denied`, the admin enforcement + moderation
rails). It shipped as a seal for one draft and two independent reviewers caught it.

**But the carve-out is not a licence to reach for `ShieldAlert` either** — a stock shield
standing exactly where ours would stand is a counterfeit silhouette beside the real one.
Escalate the surface's own glyph family instead: `enforcement-banner` goes
`AlertTriangle` → `OctagonAlert` (caution → stop), which claims nothing about trust.
Reserve `Shield*` for surfaces that already use it and are unambiguously admin
(`admin-denied`, the admin enforcement + moderation empties, the `/admin/enforcement`
rail row).

**Still owed the seal** (consumer/seller surfaces holding a lucide `Shield*` as of
2026-08-11, listed so the sweep can be finished rather than re-discovered):
`dashboard/visa/cases-client.tsx` (the APPLICANT's "Approve for official prefill" — the
consent copy around it is second-person, so this is not an admin screen),
`developers-panel.tsx` ×2 (the API key security notes) and `visa-cards.tsx` (the
success-ink check on a visa card). Each lives in a file owned by another piece.

## 1. Base set and rendering

- The base set is **lucide-react on the 24-grid**, imported per call-site. No new
  icon dependency, ever. Bespoke SVG is allowed only for first-party marks
  (BrandLogo, Mascot, the eno seal §0b — which TrustScore renders) and category
  artwork inside `category-icons.tsx`.
- Icons render as `stroke: currentColor`, `fill: none` unless a rule below says
  otherwise. Color always via tokens (`text-brand`, `text-body`, `fill-brand-100`,
  …) — raw hex and raw palette classes fail design-lint.
- **DO** size icons with the ladder classes (§4) on the icon itself.
- **DON'T** wrap an icon in transforms/scale to fake a size, and don't use
  `absoluteStrokeWidth` (it reads the `size` prop, which we never pass — it is a
  silent no-op here).

## 2. Stroke geometry — five tiers, no freelancing

Stroke width is *meaning*, not taste. The tiers (constants in `icon-tokens.ts`):

| Tier | Width | Where | Constant |
|---|---|---|---|
| UI default | **2** | body-copy icons: meta rows, buttons, list rows, baked ui/* glyphs (dialog/sheet ✕, carets, breadcrumb, otp) | `STROKE_UI` |
| Nav chrome | **2.25** | THE PLATFORM WEIGHT (owner-mandated): header, bottom nav, section-header back, dashboard rail — every h-6/h-7 chrome glyph | `STROKE_NAV` |
| Floating chevrons | **2.5–2.75** | bare chevrons floating over content: back-to-top (2.5), rail scroll arrows (2.75) | `STROKE_FLOAT` / `STROKE_FLOAT_MAX` |
| Marks in boxes | **3** | Check/Minus inside small filled boxes (checkbox, otp caret dashes) — a 2-weight mark vanishes at 10px | `STROKE_MARK` |
| Display / data | **1.5** | category-tile artwork (via `CategoryIcon` only) and data/illustration SVGs — big glyphs carry thick-looking lines, so the display tier thins them to stay elegant at h-11+ | `STROKE_DISPLAY` |

The display tier is the premium move: a 24-grid line scales with the viewBox, so
stroke 2 at 44px renders ~3.7px and looks rubber-stamped. 1.5 at 44px renders
~2.75px — the Carousell/Vinted weight.

**DO** pick the tier by *surface role*, then import the constant.
**DON'T** invent 1.75 / 2.1 / "looks right" values, and don't hand-type `2.25` —
if a file needs the number, it imports `STROKE_NAV`.

## 3. Corners, terminals, optical grid

- lucide's geometry is the law: **round caps, round joins, 2px corner radii on
  the 24-grid**. Never restyle `stroke-linecap`/`linejoin`.
- Choose glyph variants that agree with the canon's radius tiers: prefer the
  soft-cornered lucide variant when two exist (`House` over sharp roofs,
  `TvMinimal` over `Tv`). Boxy, square-terminal glyphs read off-brand.
- Optical alignment: an icon beside text sits on the text's cap-height center —
  use flex `items-center` and, for inline chips, `align-[-2px]`. Never nudge with
  margins on the svg itself.

## 4. Size ladder

From the canon, with 16px dominant. Constants: `ICON_SIZE` in `icon-tokens.ts`.

| Class | px | Use |
|---|---|---|
| `h-3 w-3` | 12 | micro-meta inside 2xs/3xs labels |
| `h-3.5 w-3.5` | 14 | chip glyphs, dense meta |
| `h-4 w-4` | 16 | **the default** — buttons, rows, menus (ui/button injects it via a zero-specificity `:where` rule; any class on the icon wins) |
| `h-5 w-5` | 20 | inputs, list leads, PDP action row |
| `h-6 w-6` | 24 | header search/map/✕ |
| `h-7 w-7` | 28 | bottom-nav tabs, bell, header account |
| `h-11 w-11`+ | 44+ | category tiles — display tier ONLY, always through `CategoryIcon` |

**DO** put the size class on the svg. **DON'T** use arbitrary `h-[19px]` sizes or
rely on lucide's default 24px attribute (an unsized icon inside `<Button>` gets
size-4; outside it renders 24px and that is almost never what you meant).
Icon-only buttons are `<IconButton>` (rounded-full, tap-44) — a raw `<button>`
fails lint.

## 5. ACTIVE / filled-state policy — location vs state

Two different things light up, and they must not share a treatment:

1. **Location** ("you are here" — bottom-nav active tab, rail section):
   **soft duotone** — the stack turns `text-accent-foreground` AND the glyph gains
   the wash `fill-brand-100`. Line + light-blue interior. Implemented once in
   `mobile-nav.tsx`'s `TabBody`; reuse the same classes anywhere location state
   appears.
2. **User-state** ("something is yours/waiting" — saved heart, unread bell, unread
   messages, active offer tag): **solid `fill-brand`** + `text-brand` stroke. This
   is the loudest mark in the system, so it is *only* for state the user owns.

The two compose: an active Saved tab with saved items keeps the solid heart (the
state fill wins over the location wash — the nav's selector excludes any icon that
already carries a `fill-*` class).

**DO** keep the top active-tab indicator bar (2px, `bg-accent-foreground`).
**DON'T** solid-fill a tab just because it is active, and never use warning/red
fills for counts — the counter Badge carries the number.

## 6. Accent & duotone policy — when blue appears inside an icon

- The wash (`fill-brand-100`) appears **inside artwork tiers only, and only when
  that glyph is SELECTED** (§0): category glyphs (baked into `CategoryIcon` —
  call-sites get it for free) and location-active nav/rail glyphs. When it does
  appear it fills the **WHOLE silhouette**, for BOTH (§7). At rest both are pure
  ink line.
  ⚠️ **NAV/RAIL IS NO LONGER A ONE-REGION EXCEPTION — this bullet said so until
  2026-08-11 and the code had already moved.** Measured: `mobile-nav.tsx`'s
  `TabBody` fills at the SVG level (`[&_svg:not([class*=fill-])]:fill-brand-100`,
  which inherits into every child), and its Compass tab plus every dashboard rail
  row render through `<CategoryGlyphArt selected>` — the same two-layer duotone the
  tiles use. `WASH_ACTIVE` / `WASH_ACTIVE_TWIN` survive only for one-off chrome
  mounts that are NOT location (onboarding step glyphs, the help feedback
  mode toggle, the concierge sparkle), where washing one region is the design.
- ⛔ **There is no per-key wash map any more, and re-introducing one is a
  regression.** `WASH_MAP` in `category-icons.tsx` (35 curated selectors against
  ~100 keys) was deleted on 2026-08-07. Every selector was a guess about lucide's
  child ORDER, keys with no separable region rendered pure line, and the result
  was three densities in one row.
- **There are exactly TWO sanctioned coins** (a `rounded-full` span behind a
  glyph, where the component owns a real container — EmptyState's badge, the
  bottom-nav Post chip, the enforcement banner's report lead). Never behind inline
  icons, and never a third recipe:
  | Coin | Recipe | When |
  |---|---|---|
  | **chrome** | `bg-brand-50` disc + `text-brand` glyph | the ordinary case: an empty list, a "nothing here yet", the Post chip |
  | **fault** | `bg-secondary` (NEUTRAL) disc + the fault ink on the glyph — `text-destructive` for a failure, `text-warning` for a caution | something went wrong or needs the user's attention |

  The two inks are NOT a per-call-site choice: `<EmptyState variant="fault">` only ever
  renders a failure, so it fixes its ink at `text-destructive` and exposes no tone prop —
  a caution never reaches that primitive. `text-warning` on the same neutral disc belongs
  to banner-scale coins (`enforcement-banner`'s buyer-report lead). If you find yourself
  wanting a warning EmptyState, the copy is probably a caution banner, not an empty state.
  ⚠️ **WHY A SECOND COIN EXISTS (amendment, 2026-08-11).** The chrome coin is the
  foundation's *warm-empty* move, and an error painted on it renders the failure in
  the brand's own invitation blue — a fetch that just failed looks like a cheerful
  nothing. But the disc stays NEUTRAL rather than going `bg-destructive/10`: the
  ink is what carries the fault, and a red halo behind a retryable network error
  shouts louder than the error deserves. One disc shape, two inks, no third recipe.
  ⚠️ **THE FAULT DISC IS `--secondary`, AND `--tint` WAS TRIED AND MEASURED FIRST.** The
  first draft used `bg-tint`; a reviewer called it low-contrast and was right. Light
  `--tint #f5f5f5` against `--card`/`--background #fafafa` is a ~2% step, so on a card —
  or on a row that hovers to solid card, which is exactly enforcement-banner's report
  lead — the disc BECOMES the surface and the coin stops being a container. `--secondary`
  is #e5e5e5 light / #303030 dark: a firm step against canvas AND card, in both themes,
  and already an established filled-surface token (the account rail's active pill, the
  secondary button). A fault should read as a definite object, not a whisper.
  The INK on that disc was measured too, because a reviewer estimated it at ~3:1 and that
  estimate was wrong: `--warning` on `--secondary` is **5.63:1** light (#92400e on #e5e5e5)
  and **7.91:1** dark (#fbbf24 on #303030); `--destructive` is **5.14:1** light (#b91c1c)
  and **4.17:1** dark (#f0616b). All clear the 3:1 that WCAG 1.4.11 asks of a non-text
  graphic. Re-measure if either token moves — do not re-estimate.
  **And no mascot on a fault** — the mascots are the warm-empty voice; on a failure
  they read as the product being pleased with itself.
- `fill-brand` solid = user-state only (§5). `text-brand` line-only = links,
  interactive affordances. Everything else inherits surface ink (`currentColor`).
- Multicolor stays reserved for allowlisted third-party marks (Google, Zalo,
  WhatsApp, Maps pin). First-party marks render as currentColor/bespoke per canon.

**DO** let a glyph sit unfilled — that is the RESTING state for artwork and nav
alike (§0), and a nav glyph with no closed body renders pure line in both states
and still belongs to the family.
**DON'T** wash chrome (header/nav idle icons, carets, ✕) — chrome is line-only, or
the fill stops meaning "selected".
**DON'T** half-fill an artwork glyph that IS selected — when it fills, it fills
completely (§7).

## 7. Category-tile art direction

- All category/subcategory glyphs resolve through `CategoryIcon` (registry keys =
  DB `Category.icon` rows — **keys and taxonomy name strings are immutable**;
  change artwork under existing keys only, aliasing internally). A glyph with no
  key — a slug-keyed artwork fix, the browse rail's "All" — goes through
  `CategoryGlyphArt`, the same renderer minus the lookup. **Nothing draws
  category artwork as a bare lucide svg**; that is how a tile ends up rendering a
  different density from the tile beside it.
- **THE TILE GLYPH IS A PURE INK LINE AT REST, AND A FULL DUOTONE WHEN SELECTED —
  outline-idle / filled-active (§0). Fill is a STATE, not a style.** The always-on
  duotone shipped and was reversed the same day (owner, 2026-08-07: *"use icons
  filling only when selected, not as default"*); a filled magnifier or filled
  cutlery is defensible as a deliberate "you are here" and never as a resting
  state. Mechanically, `CategoryIcon`/`CategoryGlyphArt` take a `selected` prop
  (default `false`) and draw the glyph twice inside one box — a body layer
  (`fill-brand-100 stroke-brand-100`), rendered ONLY when `selected`, and the ink
  line on top at the display tier (1.5), which is the only layer at rest.
  ⚠️ **The tint stroke matches the ink stroke EXACTLY — it must never be fatter.**
  A fattened underlay (the deleted `WASH_UNDERLAY_BLEED`) painted tint OUTSIDE the
  ink line, so every glyph wore a pale halo and read as an OUTLINED icon rather
  than a filled one (owner: "make sure icons dont have outline, fill only inside").
  At equal width the opaque ink line covers the tint stroke completely. Ordering is
  the rest of the design: the tint can never paint over the line or over interior
  detail, so lucide's arbitrary child order stops mattering, and the FILL is what
  welds open-path glyphs (a bolt, three dots, a sofa back) into one body — SVG
  implicitly closes a filled subpath — which is what makes every key read at the
  same density when it lights up. The exception is a child `FILL_EXCLUDE` names as
  decoration, where that same implicit close would turn a line into a blob: those
  stay hollow ON PURPOSE even when the glyph is selected (UtensilsCrossed fills its
  knife blade and not its fork tines — the owner asked for exactly that, twice).
- The one per-key table that survives is `FILL_EXCLUDE` in `category-icons.tsx`,
  and it is the INVERSE of the deleted `WASH_MAP`: it names children that are
  DECORATION, where a fill would close an open line into a blob (Layers' lower
  sheets, UtensilsCrossed' fork tines, UsersRound's rear figure). Add an entry ONLY
  from a rendered screenshot, never from reading the path data — "fill only the
  subpaths that close" was tried and left half of every glyph hollow.
- Small mounts re-tier the INK line with the `stroke` prop
  (`<CategoryIcon stroke={STROKE_UI}>`), never with a `stroke-width` class: the
  glyph is two layers now, and a class would either miss them or flatten the tint
  into the line.
- Tiles: label `font-bold`, glyph inherits tile ink (`text-body`) and takes the
  category hover color from the call-site. No tile backgrounds, no borders — the
  flat canon's "lines, not boxes" holds; the INK carries the color at rest, the
  fill carries it on selection, and the canvas carries the tile.
- The fill is *always brand blue*, even where a category has an accent hue —
  hover/active text may go `var(--cat)`, the interior stays brand. One blue. On a
  selected brand pill the glyph goes pure line by redefining the variable
  (`[--color-brand-100:transparent]`), which inherits into both layers.
- New key? Register the lucide component. That is the entire procedure — the
  duotone is a rule, not a per-key decision. Check both light and dark, idle
  and selected.

**DON'T** clone Chợ Tốt: no 3D tiles, no colored circles behind every glyph, no
per-category fill hues.

## 8. Micro-motion

**Motion confirms an action. It never decorates, never fires on scroll-past, and
never repeats idly.** That is the whole policy — Carousell and Vinted read premium
because their motion is scarce, not because it is clever. Budget: **120–260ms**,
spring easing from the canon's `--ease-spring` / `--ease-spring-snappy` tokens,
**transform / opacity only** (the one exception is documented below), every move
one-shot and every move dead under `prefers-reduced-motion` (globals.css has a
global kill switch — do not hand-roll a second one).

Reuse the canon's machinery first — icons get almost no machinery of their own:

- Press: the owning control's `.press` / ui/button `active:scale-[0.97]`. Never a
  second scale on the svg. `.press` on a `<Button>` presses exactly once (the
  base utility wins the depth; `.press` supplies the spring release), so it is
  safe — and preferred — on tiles, save buttons and the send FAB.
- Entrance / state confirmed: `.bubble-in` when a confirmation glyph swaps in
  (copy → ✓ in share-button and handle-chip). `.reveal-on-scroll` for tiles.
- Save (user-state, §5): `.animate-heart-pop` — the 420ms bounce is the canon's
  sanctioned success moment and is the ONE move outside the 260ms budget. Fires
  on save only, never on unsave, via a `key` remount. Every save surface has it:
  grid card, list row, PDP button, PDP overlay.
- Hover (desktop): color transition `transition-colors duration-200`, optional
  `group-hover:scale-110` on tile glyphs only (exists today — keep).

Three moves ARE icon-owned, because what changes is the glyph's own ink and no
existing utility can say that (all three live in globals.css beside `.press`):

| Utility | Moment | Shape |
|---|---|---|
| `.wash-in` | bottom-nav tab activation | the duotone interior fades up (`fill-opacity` 0→1, 180ms `--ease-spring`) behind an ink flip that is instant. **The wash ARRIVING, not a bounce** — the tab does not jump. Selector mirrors `WASH_ACTIVE` including `:not([class*='fill-'])`, so a user-state glyph never flashes |
| `.bar-in` | the same tab's 2px indicator | `scaleX(0.25)→1` + fade, 200ms snappy, so bar and wash read as one move |
| `.send-lift` | chat send tap | the plane leans into its travel and settles (220ms snappy). Keyed off the click and cleared on `animationend` — a thread you are only reading sits still |

`fill-opacity` is the single non-compositor property in the set, and it is
deliberate: a wash arriving cannot be expressed as a transform, and it animates
one 28px glyph.

- State flip (outline→fill): instant fill + `transition-colors` on the stroke.
  No morphing paths, no keyframe imports, no animation library. **Never** add a
  dependency for motion.

## 9. Do-not-touch inventory

- The CSS-ring `<Spinner>` vs `Loader2` split in ui/* is intentional — keep both.
- Checkbox/OTP marks stay `STROKE_MARK` (3).
- The mobile nav is PERMANENT (hides only for keyboard); STROKE_NAV on all five
  tabs; the Post chip is a flat coin (`bg-brand-50 text-brand`) — no FAB, no
  shadow, no solid fill.
- Mascot + the eno seal (eno-seal.tsx, consumed by trust-score.tsx) are bespoke
  first-party art on the "one line + wash" language; do not lucide-ify them,
  and never fork the seal's paths (§0b).
- Brand logo assets are frozen (`public/logo*.svg`, icon.svg, bimi, watermark).

## 10. Checklist for any new icon moment

1. Which tier (§2)? Import the constant.
2. Which size step (§4)? Class on the svg.
3. Is it artwork or chrome (§6)? Artwork → through `CategoryIcon`; chrome → line
   only. Either way it is a PURE LINE at rest — fill is a state, not a style (§0).
4. Does it have an active state? Location → fill on selection; user-state → solid (§5).
   Is it a first-party trust/safety/verification moment? → `<EnoSeal>`, not a
   lucide `Shield*` (§0b).
   Does it sit on a coin? → chrome or fault, and nothing else (§6).
5. Icon-only tap target → `<IconButton>`. Popup from an icon → ui/popover family.
6. Copy near it → `tr(en, vi)`. Colors → tokens. Then run the design-lint hook.

### §0b addendum — earned-tier vividness is law, not drift (lead ruling, 2026-08-07)
The micro seal chip has two sanctioned states: BUILDING tiers = tinted chief + line + check;
EARNED tiers (Trusted/Exceptional/Elite) = vivid tier-gradient chief on the same seal geometry
(owner decision 2026-07-13, preserved through the foundation restyle). A vivid earned chip beside
tinted building chips on one card row is correct rendering of real rank data — do not "fix" it,
and critics should read mixed vividness on one surface as information, not inconsistency.

### ⛔ §0/§6/§7 REVERSAL — category artwork is a FULL duotone, ON SELECTION ONLY (owner, 2026-08-07)
**THIS ADDENDUM IS THE AUTHORITY ON FILL. §0, §6 and §7 are its summary — if any of them ever
disagrees, this wins and that section is stale.** It landed in two owner rulings on one day, and
BOTH have to be read together or you will implement the half that was superseded:

**Ruling 1 — when a glyph fills, it fills COMPLETELY.** The owner looked at the live category grid
and said: _"make sure your icons are fully filled, i see some are half filled in categories."_
They were right, and this OVERRIDES the one-closed-region law FOR CATEGORY TILE ARTWORK **and for
location-active nav/rail glyphs**. Only the seal's chief and EmptyState badges keep the one-region
rule — they are marks whose design IS the region, not artwork being filled.

**Ruling 2 (the same day, and it supersedes the always-on tint Ruling 1 first shipped) — FILL IS A
STATE, NOT A STYLE** (owner: *"use icons filling only when selected, not as default"*). Every glyph
in this family renders as a PURE INK LINE at rest; the duotone appears only on the selected/active
one. That is the outline-idle / filled-active grammar iOS and Carousell use, and it is why the
always-on tint had to go: a filled magnifier, filled brackets and filled cutlery are defensible as a
deliberate "you are here" and never as a resting state.

⚠️ **HISTORY, so nobody re-implements it from an old paragraph:** for a few hours on 2026-08-07 the
duotone was unconditional — the body layer rendered on every mount, so a resting category grid was
a wall of tinted glyphs. That build is DEAD. There is no glyph-level opt-out list either: no
`NO_FILL` set exists (it never shipped), and a glyph with no fillable body simply resolves no tint
layer and stays line in both states, letting ink colour plus the pill carry selection.

What was actually on screen: `WASH_MAP` tinted one curated region per key, so a single row showed
tinted glyphs (House), hollow ones (Plane, Users, Ellipsis — no separable closed region, the old
"graceful degrade") and glyphs tinted in only part of their body. Each was defensible alone; as a
SET they read as a rendering bug. A rule nobody can state by looking at the screen is not
restraint.

What ships instead: `<CategoryIcon selected>` draws the glyph twice — a `fill-brand-100
stroke-brand-100` body layer at the SAME stroke width as the ink, then the ink line on top; without
`selected` only the ink line renders. One rule, ~100 keys, zero per-key entries. `WASH_MAP`,
`CHIP_CATEGORY_ICON_STROKE` and `WASH_UNDERLAY_BLEED` (the fat underlay that haloed every glyph)
are ALL DELETED and must not return — the only per-key table left is `FILL_EXCLUDE`, which names
decoration children a selected glyph must not fill. Every key was walked at 3x in both themes
(`eno-icons-gauntlet/scripts/fv2-glyph-sheet.mjs` renders the whole registry from the source of
truth) — no hollow glyph, no half-filled glyph, uniform density from h-3.5 to h-12.

The twin-pair ruling below is now MOOT for category artwork (the whole silhouette fills, so twins
are trivially both filled). It still governs chrome: the dashboard rail's Scale row.

### §0/§6 addendum — symmetric twin regions count as ONE wash move (lead ruling, 2026-08-07)
Glyphs whose closed body is a mirrored pair (dumbbell plates, binocular barrels, scale pans)
wash BOTH twins: the pair reads as a single visual move, and washing one side reads as a
rendering error, not restraint. The one-region law counts moves, not paths.

### §6 addendum — rating stars are genre semantics, not a wash violation (lead ruling, 2026-08-07)
Solid amber rating stars are the marketplace genre's shared vocabulary (both reference apps use
them); they carry the `rating` token, never brand blue, and are exempt from the one-wash law the
same way third-party brand marks are. Do not wash or blue-shift a star.

### §5 addendum — the rail pill is the third sanctioned location treatment (lead ruling, 2026-08-07)
An icon-only collapsed rail (72px dashboard/admin) marks location with a neutral bg-accent
rounded pill BEHIND the washed glyph — the wash + accent ink are TabBody's, the pill replaces the
tab's 2px bar (there is no edge to hang a bar on in a centered rail slot). Tabs keep the bar;
rails keep the pill; nothing else gets either.

### §6 addendum — EmptyState glyphs are brand-toned by design (lead ruling, 2026-08-07)
The EmptyState badge renders its glyph in text-brand on the brand-50 coin deliberately (the
foundation's warm-empty move) — this is a sanctioned exception to "brand-line = interactive";
it applies ONLY inside ui/empty-state's badge, and ONLY for the empty case (see below).

### §6 AMENDMENT — the fault coin: an ERROR is not an empty (2026-08-11)
**§6 sanctioned exactly ONE coin and that was a bug in the canon, not just in the code.**
`ui/empty-state.tsx` hardcoded `bg-brand-50` + `text-brand`, and EmptyState is the shared
primitive for BOTH "nothing here yet" AND "this failed, retry" — so a failed fetch rendered in
the brand's warm invitation blue, at the one moment the product had let the user down. §6 now
sanctions TWO coins, and no third:

- **chrome coin** — `bg-brand-50` disc + `text-brand` glyph. The empty case. Unchanged.
- **fault coin** — **NEUTRAL** `bg-secondary` disc + the fault ink on the glyph
  (`text-destructive` for a failure, `text-warning` for a caution). ⚠️ NOT `bg-tint`: that
  was the first draft and it measured as a ~2% step against `--card`, i.e. invisible on a
  card or a hovered row. See the measurement note in §6.

Two decisions inside that, both deliberate:
1. **The disc is neutral, not `bg-destructive/10`.** The INK carries the fault; the disc only
   gives the glyph a home. A red halo behind a retryable network error shouts louder than the
   error deserves, and the canon's flat "lines, not boxes" rule already distrusts tinted boxes.
2. **No mascot on a fault.** The mascots are the warm-empty voice; on a failure they read as the
   product being pleased with itself. `<EmptyState variant="fault">` therefore renders the coin
   even if a caller passes `media`.

Surface: `<EmptyState variant="fault" icon={…}>` — `icon` is REQUIRED there by the props union,
because the fault branch refuses `media` and would otherwise have nothing to draw. The
pre-existing non-brand coin in `enforcement-banner.tsx` (the buyer-report lead) was the only other
coin in the app and it used a third recipe — `bg-warning/15` + `text-warning`. It now takes the
fault coin at its own scale (neutral disc, warning ink), so there is one coin shape and two inks
app-wide.

⚠️ **ADOPTION IS OPT-IN AND STILL PENDING — the law is ahead of the call sites, deliberately.**
`variant` defaults to `'empty'`, so every existing failed-fetch EmptyState still renders the
chrome coin until its owning file migrates. This section describes what a fault state MUST look
like, not what every screen looks like today. Migrating them is follow-up work (they live across
~20 files owned by other pieces); do not read a brand-blue error on some screen as evidence that
this rule is optional.
