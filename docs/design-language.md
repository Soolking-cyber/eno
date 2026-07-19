# eno.vn design language — the canon

This is the single source of truth for UI styling. `scripts/design-lint.mjs`
(runs in `npm run lint` and on every Vercel build) enforces the banned patterns
below — a violation fails the build. When a rule here conflicts with older code,
this document wins.

Identity in one line: **flat single-canvas marketplace — one brand blue
(#0a66c2), true-neutral grays, #fafafa canvas, generous radii, spring motion.**

---

## 1. Type scale

Six working sizes for UI markup. Nothing in between.

| Utility | px | Use for |
|---|---|---|
| `text-3xs` | 10 | micro badge/counter labels (notification dots, image counters) |
| `text-2xs` | 11 | dense card meta, chip labels, trust-chip text |
| `text-xs` | 12 | standard meta, captions, secondary labels |
| `text-sm` | 14 | UI default — buttons, inputs, labels, list rows |
| `text-base` | 16 | body copy on content pages, PDP description |
| `text-lg`+ | 18+ | headings — use `lg / xl / 2xl / 3xl` steps only |

**Banned:** arbitrary font sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`,
`text-[12px]`, `text-[13px]`, `text-[15px]`, …). Mappings used in the 2026-07
normalization: 9→`3xs`, 10→`3xs`, 11→`2xs`, 12→`xs`, 13→`sm` (or `xs` when it
was meta), 15→`base`.

The `:root` vars `--text-display/title/section/body/small/caption` are the
**prose scale** for long-form content pages (guide/terms/privacy). They are
consumed by CSS rules in `globals.css` only — never as utilities in markup
(`text-body` in markup is the *color* utility, neutral-600).

## 2. Radius

Four tiers. Pick by element role, not by taste.

| Utility | Use for |
|---|---|
| `rounded-full` | circles, pills, chips, badges, avatars, icon buttons |
| `rounded-2xl` | cards, panels, dialogs, popovers, menus, images ≥ ~96px |
| `rounded-xl` | buttons, inputs, selects, textareas, medium controls, listing-card media (the shipped `<ListingCard>` image container) |
| `rounded-lg` | small thumbnails/media ≤ ~64px, tiny nested boxes, and compact controls ≤ ~28px tall in dense surfaces (admin tables, menu items) |

**Banned:** bare `rounded`, `rounded-sm`, `rounded-md` (map: tiny element →
`lg`, control → `xl`). Directional variants (`rounded-t-*` for sheets/drawers)
follow the same tiers.

## 3. Color

Tokens only — never raw hex in `className` or `style`. The palette is 60/30/10:
white/`#fafafa` canvas, true-neutral grays, ONE brand blue.

- Brand: `brand`, `brand-dark` (hover), `brand-light`, `brand-50`, `brand-100`,
  `brand-deep(er)` (fixed dark marketing panels)
- Semantic: `primary`, `accent` (+`-foreground`), `muted`, `card`, `popover`,
  `background`, `foreground`, `border`, `input`, `ring`, `destructive`,
  `success`, `warning`, `info`
- Neutral ramp: `ink` (headings) · `ink-2` · `ink-3` · `ink-4`
  (placeholder/meta — AA on tint) · `body` (neutral-600 secondary text) ·
  `tint` (neutral-100 surfaces/chips) · `line-strong` (neutral-300 borders)
- Trust ladder: `verified`, `pending` + the tier colors on `/trust`

Every token has a `.dark` counterpart — using tokens is what keeps dark mode
free. **Allowlisted raw hex:** third-party brand marks (Google logo, payment
logos), map/canvas drawing code, `theme-color`/OG meta, email templates. The
allowlist lives in `scripts/design-lint.mjs`.

## 4. Spacing & layout

- 8pt rhythm: prefer `1 / 2 / 3 / 4 / 6 / 8 / 12` steps (4–48px).
- Arbitrary px values are acceptable for **geometry** (safe-area calc, precise
  overlay offsets, media aspect boxes) — never for font size, radius, or color.
- Page frame: `max-w-7xl px-3 sm:px-6 lg:px-8` (header/footer edge-aligned);
  explorer fills parent `main` — no double containers.

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
| Any button | `<Button>` — `variant="cta"` is THE brand CTA; `size="none"` preserves bespoke sizing during migration |
| Icon-only button | `<IconButton>` (44px tap target) |
| Chip / badge / status pill | `<Badge>` — variants: `neutral` (tint), `brand`, `success`, `warning`, `destructive`, `outline`; sizes `sm` (2xs) / `md` (xs) |
| Text input | `<Input>` — filled tint idiom (`rounded-xl bg-tint px-4 py-3 text-sm`); `variant="outline"` for bordered forms |
| Multiline | `<Textarea>` — same idioms as Input |
| Checkbox | `<Checkbox>` |
| On/off toggle | `<Switch>` (has haptics) |
| Avatar | `<Avatar>` |
| Empty states | `<EmptyState>` (mascot + title + hint + action) |
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
seconds — but add it *with* its first real call site, never ahead of one.

## 6. Motion

- Springs: `--ease-spring` (default, 220–340ms), `--ease-spring-snappy`
  (toggles/chips/press, 160–220ms), `--ease-bounce` (success moments only).
- `.press` utility for press feedback; `hapticTap`/`attachHaptic` on key taps;
  `.bubble-in`, `.reveal-on-scroll` for entrances.
- Everything respects `prefers-reduced-motion` via the global kill switch.

## 7. Copy & formatting

- Every user-facing string through `t()` / `tr(en, vi)` / `<Tr>`; regenerate
  `src/generated/ui-strings.ts` after adding copy.
- Money: locale-aware via `src/lib/vnd.ts` formatters — vi renders
  `12.000.000 đ`. Never hand-format numbers.
