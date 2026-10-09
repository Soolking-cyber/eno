# eno.vn design language — the canon

This is the single source of truth for UI styling. `scripts/design-lint.mjs`
(runs in `npm run lint` and at the head of `npm run build`) enforces the banned patterns
below — a violation fails the build. When a rule here conflicts with older code,
this document wins.

Some rules are **ratchets** rather than bans: the lint counts a pattern the canon has moved
past (hand-built button spinners, hand-sized ✕ glyphs, off-ladder icon sizes, page `<h1>`s off
the heading ramp, the arbitrary `var()` spelling of a house easing curve) and fails only when
the count **rises**. The existing sites are debt with a number on it; migrate one when you are
in its file, then lower the baseline in `RATCHETS` in the same change.

Identity in one line: **flat single-canvas marketplace — one brand blue
(#0a66c2), a 58同城-style commerce orange (#d64000 fill / #c73c00 ink) used ONLY
for price, the Post button and the commerce badges, true-neutral grays, one #f8fbfe
blue-wash canvas (`--wash-tail`) on every surface, generous radii, spring motion.**

---

## 1. Type scale

**Typeface: Open Runde, for English AND Vietnamese** (confirmed against `src/app/globals.css`
and `src/app/[lang]/layout.tsx`, 2026-09-30 — owner decision O-01). It is self-hosted as four
static cuts behind `--font-open-runde`; `html[lang="vi"] body` keeps the same family because
Open Runde draws every Vietnamese glyph (verified per-glyph). Inter and Be Vietnam Pro are
**retired** — any brief, plan or DESIGN.md that names them is stale. One family, both languages.

Six working sizes for UI markup. Nothing in between.

| Utility | px | Use for |
|---|---|---|
| `text-3xs` | 10 | micro badge/counter labels (notification dots, image counters) |
| `text-2xs` | 11 | dense card meta **from `sm` up**, chip labels, trust-chip text |
| `text-xs` | 12 | standard meta, captions, secondary labels |
| `text-sm` | 14 | UI default — buttons, inputs, labels, list rows |
| `text-base` | 16 | body copy on content pages, PDP description |
| `text-lg`+ | 18+ | headings — use `lg / xl / 2xl / 3xl` steps only |

**Banned:** arbitrary font sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`,
`text-[12px]`, `text-[13px]`, `text-[15px]`, …). Mappings used in the 2026-07
normalization: 9→`3xs`, 10→`3xs`, 11→`2xs`, 12→`xs`, 13→`sm` (or `xs` when it
was meta), 15→`base`.

**D-TYPE — two size rules (owner, 2026-09-30: "do what's recommended", plan row O-39):**

- **Card meta is 12px on phones.** `<ListingCard>`'s metadata row is `text-xs sm:text-2xs`:
  12px below `sm`, 11px from `sm` up, where the row carries four facts instead of two. It is a
  single truncating line, so it never wraps — measured on the dev feed at 360/390, 0 wrapped rows
  in EN and VI, light and dark. Truncation does rise (home at 390: 4 → 21 of 28 rows;
  `/c/rentals` at 390: 19 → 27 of 48; 360 was already truncating 22/28 and moved by one); what
  gets clipped is the city tail (", Hồ Chí Minh"), not the ward. Buy width back with a shorter
  location string, not by shrinking the type again.
- **A section heading is always larger than the card price.** `SECTION_TITLE` (shelf.tsx —
  shared by every Shelf, category-rails and the home feed heading) is `text-lg sm:text-xl`,
  against the card `<Price>`'s `text-base sm:text-lg`: 18 > 16 on phones, 20 > 18 from `sm`
  (measured at 360/390/1440). Both steps have a 28px line box, so skeletons do not move. Raise
  the price and you raise the heading in the same change.
  ⚠️ Open follow-up: the PDP page's own section `<h2>`s (Description, Details, Location) and
  `reviews-preview` still hand-type `text-lg`, so from `sm` up they sit one step below the
  "More like this" / "More from this seller" shelves on the same page.

**Page titles sit on the heading ramp.** A page's `<h1>` is `.h-display` (28→40px — landing,
category, SEO, /post) or `.h-title` (20→24px — app screens) — `.h-greeting` for the dashboard's
display-size greeting — or `sr-only` where a mobile SectionHeader carries the visible title. Reach for `<PageHeader>` (ui/page-header: title +
meta line + actions) rather than hand-typing `text-xl font-bold`; that is how eight different
h1 styles happened. The PDP headline is the one owner exception (price-first). design-lint
ratchets the rest (`h1-off-ramp`).

**No kicker eyebrows.** A small uppercase label that restates the heading under it ("Error
404", "New") is retired (owner, 2026-08-05). The survivors are the SEO *topic · place* lines
("Housing · Vietnam"), which carry the place the heading does not; design-lint allowlists
those files (`EYEBROW_ALLOW`) and refuses the class anywhere else.

The `:root` vars `--text-display/title/section/body/small/caption` are the
**prose scale** for long-form content pages (guide/terms/privacy). They are
consumed by CSS rules in `globals.css` only — never as utilities in markup
(`text-body` in markup is the *color* utility, neutral-600).

## 2. Radius

Four tiers. Pick by element role, not by taste.

| Utility | Value | Use for |
|---|---|---|
| `rounded-full` | pill | circles, pills, chips, badges, avatars, icon buttons |
| `rounded-2xl` | 18px | cards, panels, dialogs, popovers, menus, **and all media ≥ ~96px, including `<ListingCard>`'s image container** |
| `rounded-xl` | 12px | buttons, inputs, selects, textareas, medium controls, **and media between ~64px and ~96px** |
| `rounded-lg` | 10px | small thumbnails/media ≤ ~64px, tiny nested boxes, and compact controls ≤ ~28px tall in dense surfaces (admin tables, menu items) |

**Banned:** bare `rounded`, `rounded-sm`, `rounded-md` (map: tiny element →
`lg`, control → `xl`). Directional variants (`rounded-t-*` for sheets/drawers)
follow the same tiers.

⚠️ **This table contradicted itself until 2026-08-09** and the contradiction had a
consequence, so it is worth naming. `2xl` said "images ≥ ~96px" while `xl` carved out
"listing-card media" by name — and the card image is 179px, so the two rules gave
opposite answers about the single most-repeated surface in the product. The carve-out
won in code, which is how the app's most-seen photo ended up at the same 9px corner as a
menu item. **The size rule is the rule; there is no per-component exception.** If a
component ever needs one, it needs a reason written next to it, not a second row here.

⚠️ **The values are authored, not derived, and `xl` has a measured ceiling.** They were
`--radius ± 1/2/4/8` (5/6/7/9/11/15px) until 2026-08-09 — a scale 10px wide that shipped
as two shapes. `xl` cannot simply be raised: it is the overloaded tier (113 live
elements, from a 24×24 icon button to full-width panels), and CSS clamps a radius to a
pill once 2R passes the shorter side. Measured on `/`: 12px pills 4 elements, 14px pills
7, 18px pills 13. Re-measure before changing it — see the note in `globals.css @theme`.

## 3. Color

Tokens only — never raw hex in `className` or `style`. The palette is 60/30/10:
the `#f8fbfe` canvas (`--wash-tail`), true-neutral grays, ONE brand blue (plus the commerce orange on price/Post).
A colour class must name a real token: Tailwind emits nothing for an unknown one (`text-danger`,
`bg-surface`), silently, so design-lint refuses it.

- Brand: `brand`, `brand-dark` (hover), `brand-light`, `brand-50`, `brand-100`,
  `brand-deep(er)` (fixed dark marketing panels)
- Semantic: `primary`, `accent` (+`-foreground`), `muted`, `card`, `popover`,
  `background`, `foreground`, `border`, `input`, `ring`, `destructive`,
  `success`, `warning`, `info`
- Neutral ramp: `ink` (headings) · `ink-2` · `ink-3` · `ink-4`
  (placeholder/meta — AA on tint) · `body` (neutral-600 secondary text) ·
  `tint` (neutral-100 surfaces/chips) · `line-strong` (neutral-300 borders)
- **D-GREYS — the text greys are ONE monotonic ramp, in the same order in both themes** (owner,
  2026-09-30: "do what's recommended", plan row O-39). Strongest to quietest:
  **`ink` > `ink-2` > `ink-3` > `body` > `ink-4` > `muted-foreground`**. A higher number is
  always quieter; `body` sits between `ink-3` and `ink-4` because it is running text, and
  placeholder/meta must never out-shout it. Measured contrast (WCAG):

  | Token | Light | canvas / white / tint | Dark | canvas / tint / popover |
  |---|---|---|---|---|
  | `ink` | `#171717` | 17.26 / 17.93 / 16.44 | `#f0f0f0` | 14.80 / 13.28 / 12.60 |
  | `ink-2` | `#262626` | 14.57 / 15.13 / 13.88 | `#e0e0e0` | 12.78 / 11.46 / 10.87 |
  | `ink-3` | `#404040` | 9.98 / 10.37 / 9.51 | `#d4d4d4` | 11.38 / 10.21 / 9.68 |
  | `body` | `#525252` | 7.52 / 7.81 / 7.17 | `#cccccc` | 10.50 / 9.42 / 8.94 |
  | `ink-4` | `#616161` | 5.96 / 6.19 / 5.68 | `#a0a0a0` | 6.45 / 5.79 / 5.49 |
  | `muted-foreground` | `#737373` | 4.57 / 4.74 / 4.35 | `#b8b8b8` | 8.50 / 7.63 / 7.24 |

  What moved: light `ink-3` `#737373` → `#404040` (it was LIGHTER than `ink-4`, identical to
  `muted-foreground`, and 4.35:1 on tint where it inks icons — under AA); dark `ink-2` `#d6d6d6`
  → `#e0e0e0` and `ink-3` `#b8b8b8` → `#d4d4d4` (dark `ink-3` sat BELOW `body` while light put it
  above). Every stop from `ink-4` up clears AA 4.5:1 on canvas, white/popover and tint.
  ⚠️ Two known exceptions, recorded rather than hidden: light `muted-foreground` is 4.35:1 on
  `tint` (use `ink-4` for text on a tint well); and in dark `muted-foreground` (#b8b8b8) is
  brighter than `ink-4` (#a0a0a0), the one inversion left — 418 call sites, not moved in this
  change. Move a stop and you re-measure and keep the order.
- Money: `price` — prices, and only prices, wear it. It is NOT the palette's only red:
  `destructive` is red in both themes and globals.css spends a paragraph keeping the two
  apart (OKLab dE 0.076 in light). Never let hue alone carry that distinction — an error
  keeps its icon or label. Tune it against `accent` (the buy-box tint), not just the canvas.
- `destructive` is tuned against the surface it is hardest on, not the canvas: dark
  `#f7737b` is set by the PDP safety strip (`bg-warning/10` over the canvas, 5.02:1). Text on a
  solid destructive fill is `destructive-foreground` (white light / near-black dark) — never
  `text-white`, which is 2.73:1 on the dark red. That includes the white ink a variant carries:
  a red delete is `<Button variant="destructive">`, not `variant="cta"` repainted `bg-destructive`.
  design-lint refuses both shapes (class string or Button/Badge tag).
- `popover` MATCHES the canvas in light (it is `var(--wash-tail)`; owner, 2026-07-13) and lifts
  to `#2a2a2a` in dark. A floating surface's edge is its border + `shadow-pop`/`shadow-overlay`.
- Trust ladder: `verified`, `pending` + the tier colors on `/trust`

Every token has a `.dark` counterpart — using tokens is what keeps dark mode
free. **Allowlisted raw hex:** third-party brand marks (Google logo, payment
logos), map/canvas drawing code, `theme-color`/OG meta, email templates. The
allowlist lives in `scripts/design-lint.mjs`.

## 3b. Flat surfaces — lines, not boxes

Owner, 2026-07-24: *"minimal boxes as much as open borders with lines between elements … adapt
it to all pages … background color as uniform as possible almost no boxes."* Planned and
CONFIRMED by both external reviewers; migration plan in `docs/flat-surface-plan.md`.

**ONE canvas.** `--card` is deliberately IDENTICAL to `--background` in both themes. A panel is
not a lighter rectangle — it is content on the same surface, separated by a hairline.

- Related rows → `divide-y divide-border` (use the `ui/rows` primitive).
- Sections → a single `border-t border-border` + vertical rhythm (`RowsSection`).
- Wells and chips that genuinely need to sit apart → `tint`, never a restored card.
- ⚠️ **Never add a second general-purpose panel colour** to get depth back. A fill that is
  nearly the canvas colour is precisely the faint-box look this replaced.

**Elevation must mean something.** Surface + shadow survive ONLY where the element floats above
the page and the boundary carries information: dialog, popover/menu, toast, sticky bar, media
lightbox, the floating mobile tab bar. Those use `popover`, not `card`. Everything in normal flow is flat.

- **The mobile tab bar is a floating, icon-only pill** (owner, 2026-09-26: *"minimal and sleek pill
  shaped"*): `rounded-full`, inset 12px from the sides and `max(12px, safe area)` from the bottom,
  `bg-popover/95` + `material` blur, `shadow-pop` and a 1px `border-foreground/10` edge. Labels are
  visual only — each tab keeps its `aria-label`. Location = a tinted `bg-accent` capsule behind the
  washed brand glyph (the Post coin instead goes solid, with no capsule). Its footprint stays
  4.5rem + safe area, which every bottom-anchored surface clears.
- ⚠️ **Edge a floating surface with `border`, not `ring-1`, when it also wears `shadow-pop`/
  `shadow-overlay`.** Those are unlayered `box-shadow` rules and a Tailwind ring is a box-shadow,
  so the ring is silently overwritten (measured on the tab bar: no line in either theme).

**Forced colors (Windows High Contrast) drop fills and box-shadows**, so a state carried only by
those vanishes. globals.css restates selection in system colours under
`@media (forced-colors: active)`: a selected tab gets a `Highlight` underline and bold weight, a
pressed/checked/selected control a `Highlight` fill with `HighlightText` ink, and every Button a
`ButtonText` border. A new selected state rides `aria-selected` / `aria-pressed` / `aria-checked`
and inherits this for free; one expressed only in a class does not.

**Structure has to be real, not painted.** Removing a fill removes a *visual* group, so the
semantic one must exist: headings, `<section>`, list markup. Hairlines that identify a control
keep non-text contrast (WCAG 1.4.11), and focus rings must stay obvious on the flat canvas.

⚠️ **The marketplace GRID is not flattened yet — deliberately.** The two reviewers split on it:
a product card's boundary is what says *this is one item*, and getting that wrong in a feed
costs conversions. It stays a separate, owner-reviewed decision.

## 4. Spacing & layout

- 8pt rhythm: prefer `1 / 2 / 3 / 4 / 6 / 8 / 12` steps (4–48px).
- Arbitrary px values are acceptable for **geometry** (safe-area calc, precise
  overlay offsets, media aspect boxes) — never for font size, radius, or color.
- Page frame: `max-w-7xl px-3 sm:px-6 lg:px-8` (header/footer edge-aligned);
  explorer fills parent `main` — no double containers.

**Layers — the z ladder.** One ordered scale, named by role (`@theme { --z-index-* }` in
globals.css, so `z-overlay` etc. are real utilities and tailwind-merge knows them):

| Utility | z | Who |
|---|---|---|
| `z-raised` | 10 | a sibling lifted inside its own section |
| `z-sticky` | 30 | in-flow sticky chrome (facet/sort toolbar, PDP action bar) |
| `z-nav` | 40 | header, floating tab bar (popup scrims also sit at 40) |
| `z-fab` | 45 | the back-to-top / support cluster — over the page, **under every overlay** |
| `z-overlay` | 50 | dialog, sheet, drawer, alert-dialog, every popup positioner |
| `z-tooltip` | 70 | a hint over the overlay that owns its trigger |
| `z-splash` / `z-consent` | 90 / 200 | the app splash; the cookie bar |
| `z-map-overlay` / `z-nested-popover` | 1100 / 1201 | inside a map (panes top out near 1000) |

A new floating thing picks its row; it does not invent a number between two.

## 5. Primitives — reuse, don't re-roll

All in `src/components/ui/` unless noted. Hand-rolling one of these in a page
component is a defect.

**Library policy (owner, 2026-07-15): Base UI is the primary UI library, in a fixed
order of preference.** For any new interactive/structural element: **(1)** a Base UI
component (`@base-ui/react`); **(2)** if Base UI has no equivalent, the best purpose-built
library (embla for carousel, `input-otp`, `sonner` — Base UI ships no carousel/OTP/toast);
**(3)** hand-rolled only as a last resort, with a comment naming which of (1)/(2) was ruled
out and why. Check `node_modules/@base-ui/react/` before hand-rolling anything — a widget
built from `<Button>`s + `createPortal` is still a hand-roll (and `design-lint` fails the
build on `createPortal` outside `ui/`). When a call site seems to need a hand-roll, suspect
the primitive first. The one deliberate opt-out is `ui/avatar` (Base UI hides the `<img>`
until load → strips it from SSR → costs the LCP; reason in the file).

| Need | Use |
|---|---|
| Any button | `<Button>` — `variant="cta"` is THE brand CTA; `size="none"` preserves bespoke sizing during migration; `loading` for an async action (label kept at opacity 0 so the width holds, spinner centred, `aria-busy`, focus kept) — never a hand-built `<Loader2>` |
| Icon-only button | `<IconButton>` (44px tap target) |
| Close / dismiss / remove ✕ | `<CloseButton>` (ui/close-button) — sizes `2xs`–`lg`, `variant="overlay"` over media; the glyph is derived from the button (`CLOSE_GLYPH`), never hand-typed; `label` when the action is not "Close" |
| Static chip / badge / status pill | `<Badge>` — variants: `neutral` (tint), `brand`, `success`, `warning`, `destructive`, `outline`; sizes `sm` (2xs) / `md` (xs) |
| Interactive chip | `<Chip>` (ui/chip) — an action chip, or a filter toggle when `pressed` is passed (Base UI Toggle, `aria-pressed`); sizes `xs` 28 / `sm` 32 / `md` 36, tones `ghost` / `neutral` / `warning`; `chipVariants()` on a `<Link>` |
| Page title row | `<PageHeader>` (ui/page-header) — the h1 on the ramp + meta line + actions |
| Text input | `<Input>` — filled tint idiom (`rounded-xl bg-tint px-4 py-3 text-sm`); `variant="outline"` for bordered forms |
| Multiline | `<Textarea>` — same idioms as Input |
| Checkbox | `<Checkbox>` |
| On/off toggle | `<Switch>` (has haptics); `<SwitchRow>` (ui/switch) when its words must be in view — a VISIBLE label plus a description (a consent notice) that is read with it and is not a tap target |
| Chips answering one question | `<ToggleGroup>` + `<ToggleGroupItem>` (ui/toggle-group, Base UI ToggleGroup — one tab stop, arrow keys) — several choices (`multiple`), or one choice that clears on a second tap (what a radio cannot do) |
| A question answered by a group of controls | `<Fieldset>` (ui/fieldset, Base UI Fieldset) — a visible legend names the group; the hint and the error join its `aria-describedby`; the error is `role="alert"` and the group carries `data-invalid` for a form's error reveal |
| Avatar | `<Avatar>` |
| Empty / error states | `<EmptyState>` (mascot or coin + title + hint + action) — flat (`tone="bare"`) by default; `variant="fault"` for a failure (neutral coin, destructive ink, no mascot); `titleAs="h1"` when the state IS the page (the route error screen) |
| Horizontal shelf | `<Shelf>` (marketplace) |
| Loading | `<Skeleton>` / `<Spinner>` |
| Modal | `ui/dialog` (Base UI); destructive confirms → `ui/alert-dialog` |
| Menus | `ui/dropdown-menu` (never a hand-rolled absolute-positioned div) |
| Floating panels | `ui/popover` |
| Hover/focus hint | `ui/tooltip` (Base UI; `TooltipProvider` in layout — never native `title=`) |
| Side panels / mobile filters | `ui/sheet` (side) / `ui/drawer` (bottom, Base UI Drawer) |
| Select (desktop/admin) | `ui/select` — native `<select>` stays fine on mobile consumer surfaces |
| Tabs | `ui/tabs` — every tab strip, including the explorer's 4-tab sort model, the dashboard's listing filters and the sign-in phone/email switch. A strip of `<Button>`s is NOT a tab strip: it reports no `role="tablist"`, no `aria-selected`, and the arrow keys do nothing. |
| Tables (dashboard/admin) | `ui/table` + TanStack `@tanstack/react-table` (data-table pattern); mobile gets stacked cards or an `overflow-x-auto` container |
| Content panel | `ui/card` (rounded-2xl surface tier) |
| Callouts | `ui/alert` |
| Listing display | `<ListingCard>` (marketplace) — never a bespoke card |
| Seller identity | `<SellerCard>` (marketplace) |

shadcn components arrive with `rounded-md`/`rounded-sm`/`rounded-xs` stock
classes — restyle to the tiers above on arrival (design-lint enforces): floating
content panels → `2xl`, input-like triggers/controls → `xl`, menu items and
compact sidebar controls → `lg`.

**The table above is the whole layer — there is no shelf of spare parts behind it.**
`chart` (+`recharts`), `command` (+`cmdk`), `sidebar`, `collapsible`,
`pagination`, `scroll-area`, `toggle`, `toggle-group` and `input-group` were deleted on
2026-07-14: they were shadcn defaults that shipped with the scaffold and that nothing ever
imported. An unused primitive is not free — it is a decoy. `ui/alert` sat here with ZERO
importers while ten hand-rolled callouts existed elsewhere in the app, because nobody knew
to look for it. If you need one of these back, `npx shadcn@latest add <name>` takes
seconds — but add it *with* its first real call site, never ahead of one. (`toggle` and
`toggle-group` have since come back that way — ui/toggle with the chip filters, ui/toggle-group
with the teacher form's chip questions, 2026-10-08 — and `collapsible` with the feed's ladder.)

## 6. Motion

- Springs: `--ease-spring` (default, 220–340ms), `--ease-spring-snappy`
  (toggles/chips/press, 160–220ms), `--ease-bounce` (success moments only), and
  `--ease-out-strong` for the overlay family. They are theme tokens, so write the named
  utility — `ease-spring-snappy`, not the arbitrary `var()` form (design-lint ratchets it).
- `.press` utility for press feedback; `hapticTap` / `hapticConfirm` /
  `hapticError` (`src/lib/haptics.ts`) on key taps; `.bubble-in`,
  `.reveal-on-scroll` for entrances.
- Everything respects `prefers-reduced-motion` via the global kill switch.
  Haptics deliberately do **not** — reduced *motion* is an animation preference,
  and the OS already owns the haptic setting (reasoning in `haptics.ts`).

**The press-scale contract.** `.press` shrinks to `0.96` using the standalone
`scale` property, emitted from `@layer components`. Two consequences that decide
how you write a call site:

- **One scale wins, they never compound.** Tailwind v4's `scale-*` utilities set
  `scale` too (not `transform`), and utilities outrank the components layer — so
  any `active:scale-*` on the element simply replaces the `.press` value.
  `active:scale-100` is therefore a real opt-out: it removes the press entirely.
  Until 2026-07-21 `.press` used `transform: scale()`, an *independent* property
  that multiplied with `scale` instead of losing to it — `.press` +
  `active:scale-90` pressed to 0.864, and four call sites shipped an
  `active:scale-100` that did nothing at all.
- **`<Button className="press">` presses once, at ui/button's own `0.97`.** Don't
  add `active:scale-100` to "stop the double-scale" — there is no double-scale,
  and the class now genuinely kills the press feel. Only pass `active:scale-100`
  when you actually want a control that does not move: a popover *anchor*
  (floating-ui reads its rect mid-press), or a button wrapping media.

Only `.press`'s `scale` is layered; its `transition` is not, so it keeps the
spring even on a call site that also carries `transition-colors`.

## 7. Copy & formatting

- Every user-facing string through `t()` / `tr(en, vi)` / `<Tr>`; regenerate
  `src/generated/ui-strings.ts` after adding copy.
- Money: locale-aware via `src/lib/vnd.ts` formatters — vi renders
  `12.000.000 đ`. Never hand-format numbers.
