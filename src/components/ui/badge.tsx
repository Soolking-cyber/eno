import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { IconButton } from './icon-button'

// Shared chip/badge/status-pill — the rounded-full label span hand-rolled ~86×
// across the app (trust chips, status pills, counts, filter tags). Variants map
// to the token palette (docs/design-language.md §5); sizes map to the sanctioned
// micro type steps. For NEW chips use this instead of re-rolling the span; legacy
// chips migrate opportunistically (zero-visual-change swaps only).
//
// IN scope (new):
//  · INTERACTIVE chips — pass `interactive` for the hover/active affordance, and
//    `render={<Link/>}` or `render={<button/>}` to change the element. A chip that
//    carries selected-state *logic* is still a <Button>; `interactive` is the
//    affordance, not a state machine.
//  · COUNT BUBBLES — `size="count"` is the 16px bubble (min-height, so it grows rather
//    than clips when text scales); the VARIANT picks its tone.
//    `variant="counter"` = the ALERT count (destructive token). `variant="counter-brand"`
//    = the INFORMATIONAL count (primary token) — unread messages, active-filter counts:
//    a number that is waiting for you, not warning you. Both are on tokens, so both
//    adapt in dark mode. POSITIONING stays on the caller (the primitive owns no
//    `absolute`). Wider non-bubble pills (the PDP price-drop chips) are the same
//    variants at `size="sm"`.
//    Still hand-rolled and due to migrate:
//      · facet-bar active-adv count — geometrically IDENTICAL to `counter-brand` +
//        `size="count"` (min-h-4 min-w-4 px-1 text-3xs font-bold); a drop-in swap.
//      · conversation-list unread — same tone, but a 20px bubble (h-5 min-w-5 px-1.5).
//        It is NOT a size="count" drop-in: pass the geometry on Badge's OWN className
//        (`className="h-5 min-w-5 px-1.5"`), which goes through cn() and cleanly
//        replaces h-4/min-w-4/px-1. Do not put it on a `render` child.
//  · REMOVABLE FILTER CHIPS — `variant="removable"` + `size="removable"` is the tone and
//    the box; `<RemovableBadge>` at the bottom of this file is the whole control. See its
//    header for why the ✕ is a SEPARATE control and why the label is not a remove button.
//
// NOT for: over-image overlays with drop-shadows — they need positioning and a
// shadow this primitive does not own; keep those bespoke.
//
// ⚠️ `render` CLONES the element and merges className through cn() here, so a
// className on the child does NOT lose to the base by stylesheet order (which is
// what Base UI's concatenating mergeProps would do). Precedence: base → child's
// className → Badge's own className (last wins, via twMerge).

const VARIANTS = {
  neutral: 'bg-tint text-ink-4',
  brand: 'bg-accent text-accent-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border border-line-strong text-body',
  // The alert/count TONE. Deliberately not aliased as `count`: a `count` variant that
  // shared a name with the `count` SIZE could be half-applied — variant alone gives a
  // red pill with sm padding, not the 16px bubble. Bubble = variant="counter" + size="count".
  //
  // A count bubble has two TONES, and the tone is the whole message:
  //   counter       — ALERT. Something is wrong / needs you (destructive token).
  //   counter-brand — INFORMATIONAL. Something is merely waiting (unread messages,
  //                   active filters). Nothing is wrong; it must not read as red.
  // Both foregrounds are TOKENS, never a hardcoded white, because the two tokens do
  // not behave the same across themes: --destructive-foreground FLIPS (white in light,
  // #1b1b1b in dark, because the dark --destructive is a light red), while
  // --primary-foreground is #ffffff in BOTH themes (the dark block re-declares --primary
  // as the same blue on purpose). Writing `text-white` here would be right by accident
  // for one and wrong for the other; the tokens are right by construction for both.
  counter: 'bg-destructive text-destructive-foreground',
  'counter-brand': 'bg-primary text-primary-foreground',
  // Official partner — the ONLY inverted chip in the set: gold foil on a dark ground.
  // Every other variant tints a light surface, which is precisely why this one does not;
  // see the --partner block in globals.css for why the badge must not read as a second
  // gold trust pill. The ring is a hairline of the foil at low alpha, which is what keeps
  // the pill's edge legible on the dark canvas where ground and page get close.
  partner: 'bg-partner-ground text-partner ring-1 ring-partner/25',
  // The ACTIVE-FILTER chip: brand-50 fill, brand-100 hairline, brand-dark ink. It is the
  // only variant that tints with the BRAND ramp rather than a semantic token, and that is
  // the message — an active filter is a choice the user made, not a status the system
  // assigned. All three tokens have a `.dark` counterpart (globals.css re-declares
  // --brand-50 as #17314d and --brand-dark LIGHTER at #74b3f2), so the chip inverts
  // correctly instead of going invisible; a hand-rolled bg-card chip does not.
  //
  // The border is not decoration. On the flat single canvas (§3b) a 28px pill with a fill
  // one step off the background has no edge of its own, and the chip's whole job is to be
  // countable at a glance ("I have applied three filters").
  removable: 'border border-brand-100 bg-brand-50 text-brand-dark',
} as const

const SIZES = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-1 text-xs',
  // Notification-count bubble: 16px at rest, and it GROWS instead of clipping — wider for
  // 2–3 digits (min-w-4), taller for taller text (min-h-4).
  // ⚠️ min-h-4, never h-4. text-3xs is 10px × 1.3 = 13px, so the box is 16px exactly as
  // before at the default size; but the moment OS/browser text scaling is in play the
  // label's own line-height passes 16px, and a FIXED 16px box clips the digits at exactly
  // the moment they matter most. Callers that want a bigger bubble still pass a hard
  // height on Badge's own className (`h-5 min-w-5 px-1.5`) — h-5 wins over min-h-4.
  count: 'min-h-4 min-w-4 justify-center px-1 text-3xs tabular-nums',
  // The removable filter chip's box: 28px tall, asymmetric padding (12px of breathing room
  // on the label side, 2px on the ✕ side because the ✕ carries its own 24px box).
  //
  // ⚠️ min-h-7, never h-7 — same reason as `count` above. text-xs is 12px on Tailwind v4's
  // UNITLESS line-height ratio, so the line box is 16px here and the pill renders at exactly
  // 28px at the default text size; under the OS text-size preference (which the app applies as
  // -webkit-text-size-adjust on <body>, see src/lib/native-text-zoom.ts) the line box grows past
  // 28 and a FIXED height would clip the filter value — the one word in the chip that matters.
  //
  // `max-w-full` + a truncating label (see RemovableBadge) is what stops a long chip
  // ("honda vision 2022 màu đen") pushing the page into horizontal scroll on a 360px phone.
  removable: 'max-w-full min-h-7 gap-0.5 py-0 pl-3 pr-0.5 text-xs',
} as const

// Hover/active affordance for a chip that is actually clickable. Off by default.
const INTERACTIVE =
  'cursor-pointer transition-colors hover:bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function Badge({
  variant = 'neutral',
  size = 'sm',
  interactive = false,
  render,
  className,
  ...props
}: {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  /** Adds the hover/cursor/focus-ring affordance for a clickable chip. */
  interactive?: boolean
  /** Base UI style: render AS this element (e.g. `render={<Link href="…" />}`). */
  render?: React.ReactElement<{ className?: string; children?: React.ReactNode }>
} & React.HTMLAttributes<HTMLSpanElement>) {
  const own = cn(
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-bold',
    VARIANTS[variant],
    SIZES[size],
    interactive && INTERACTIVE,
  )

  if (render) {
    const childProps = render.props as Record<string, any>
    const ownProps = props as Record<string, any>
    // Child first, Badge's own props second — but neither may silently EAT the other:
    // a colliding handler is COMPOSED (child's runs, then ours) and style objects are
    // merged. A naive spread drops whichever side loses, which is how a Badge's onClick
    // or aria-* would vanish the moment the render child happened to set the same prop.
    const merged: Record<string, any> = { ...childProps, ...ownProps }
    for (const key of Object.keys(ownProps)) {
      const mine = ownProps[key]
      const theirs = childProps[key]
      if (/^on[A-Z]/.test(key) && typeof mine === 'function' && typeof theirs === 'function') {
        merged[key] = (...args: unknown[]) => { theirs(...args); mine(...args) }
      }
    }
    if (childProps.style || ownProps.style) merged.style = { ...childProps.style, ...ownProps.style }
    // cn() — not concatenation. Child className beats the base; Badge's own className
    // beats both. (Base UI's mergeProps would concatenate and let stylesheet order decide.)
    merged.className = cn(own, childProps.className, className)
    merged.children = ownProps.children ?? childProps.children
    return React.cloneElement(render, merged)
  }

  return <span className={cn(own, className)} {...props} />
}

/**
 * THE REMOVABLE FILTER CHIP — a container holding a label plus a SEPARATE ✕ control.
 *
 * ⚠️ IT IS NOT ONE BUTTON, AND THAT IS THE ENTIRE POINT. Both hand-rolled versions in the
 * explorer (`listings-explorer.tsx`, in `renderSaveBox` and again in `renderEmptyState`) make the
 * WHOLE chip the remove button — `<Button onClick={c.onClear}>{label}<X/></Button>` — so a tap
 * anywhere on the word "Thảo Điền" silently deletes the filter. The chip is the widest, most
 * inviting thing in the results bar and its most likely tap is a curious one; wiring the
 * destructive action to it means the accidental tap is the destructive tap. Here the ✕ owns
 * removal and nothing else does.
 *
 * ⚠️ WHAT TAPPING THE LABEL DOES: NOTHING by default; RE-OPENS that filter when the caller
 * passes `onReopen`. It deliberately never removes. Removal is destructive and irreversible from
 * the chip's own UI (the value is gone, and re-applying it means walking the ladder again), so it
 * belongs on the small, explicit, unambiguous target. Re-opening is non-destructive and is what
 * the user usually wants anyway ("Thảo Điền, actually make that Thủ Đức") — it is safe under the
 * big target. The primitive cannot invent the panel to re-open, so it cannot require `onReopen`;
 * without it the label is plain text and the chip has exactly one control.
 *
 * ⚠️ `tapTarget={false}` ON THE ✕ IS DELIBERATE AND MUST STAY. IconButton's default `tap-44`
 * grows an INVISIBLE 44×44 ::before that OVERFLOWS the visual box. On a 28px chip that is 8px of
 * invisible hit area past the top and bottom edges and ~12px past the right edge — and these
 * chips sit in a wrapped row 6px apart, so each ✕'s phantom target would reach into the NEXT
 * chip's label and into the row above. A tap on chip N+1's label would remove chip N: exactly the
 * "fires the WRONG button" failure IconButton's own header documents for dense clusters. The
 * mitigation is to make the REAL box as large as the chip allows instead — `size-6` (24px) fills
 * the 28px pill with 2px to spare, entirely inside the chip, overlapping nothing.
 *
 * ⚠️ THIS FILE STILL HAS NO `'use client'`, AND MUST NOT GAIN ONE. RemovableBadge takes
 * callbacks, so it is client-only by construction and only a client module can render it — but
 * `Badge` itself is rendered from ~86 call sites, many of them server components, and a
 * directive here would drag every one of them into the client bundle. Importing the client
 * primitives below from an un-directived module is the normal RSC pattern and is what
 * `ui/breadcrumb.tsx` already does (it imports `<Tr>` out of the client language context).
 * Measured: neither `./button` nor `./icon-button` imports `./badge`, so there is no cycle.
 *
 * `removeLabel` is REQUIRED and must NAME the thing ("Remove Thảo Điền"). A screen-reader user
 * arriving at a row of chips hears the accessible names in sequence, and five buttons all called
 * "Remove" is five indistinguishable destructive choices. Composing the name is the CALLER's job
 * because it needs tr() and the chip's own words — see `removeFilterLabel()` in
 * src/components/marketplace/result-line.tsx for the one that ships.
 */
export function RemovableBadge({
  label,
  removeLabel,
  onRemove,
  onReopen,
  reopenLabel,
  className,
  ...props
}: {
  /** The visible chip text. Already localised by the caller (chip labels are data, not copy). */
  label: React.ReactNode
  /** Accessible name of the ✕. Must name what it removes — never a bare "Remove". */
  removeLabel: string
  onRemove: () => void
  /** Optional: makes the LABEL a control that re-opens this filter. Never removes. */
  onReopen?: () => void
  /** Accessible name for the label control. Defaults to the visible label, which is correct
   *  (WCAG 2.5.3); pass this only to say more, and keep the visible text inside it. */
  reopenLabel?: string
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <Badge variant="removable" size="removable" data-slot="removable-badge" className={className} {...props}>
      {onReopen ? (
        <Button
          type="button"
          variant="bare"
          size="none"
          onClick={onReopen}
          aria-label={reopenLabel}
          // `block` over the primitive's inline-flex: text-overflow only ellipsises text in an
          // inline/block formatting context, so a truncating flex container hides the overflow
          // with no ellipsis and the label just stops mid-word.
          //
          // ⚠️ `shrink` UNDOES ui/button's BAKED `shrink-0`, AND WITHOUT IT NOTHING TRUNCATES.
          // Measured, not assumed: `buttonVariants({variant:'bare',size:'none'})` contains
          // `shrink-0`, so this flex item was pinned at its full nowrap text width and the
          // `truncate` beside it could never fire — the reopen-able chip would blow the row out
          // on a 360px phone while the inert one (a plain span, default flex-shrink: 1)
          // truncated correctly. twMerge resolves the flex-shrink group in favour of this class.
          className="block min-w-0 shrink truncate rounded-full text-left underline-offset-2 hover:underline"
        >
          {label}
        </Button>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      <IconButton
        size="xs"
        tapTarget={false}
        onClick={onRemove}
        aria-label={removeLabel}
        data-slot="removable-badge-remove"
        className="size-6 text-brand-dark transition-colors hover:bg-brand-100"
      >
        {/* 14px, the chip-glyph step (docs/icon-language.md §4). Written as `size-3.5` rather
            than `h-3.5 w-3.5`: identical geometry, but it also satisfies the `[class*='size-']`
            escape in the OLD icon-inflation rule, so this glyph stays 14px whichever shape of
            that rule a primitive happens to carry. (Measured: ui/icon-button ships NO svg rule
            at all today — it wraps Base UI's Button, not ui/button — so this is insurance
            against a future recomposition, not a live fix.) */}
        <X className="size-3.5" />
      </IconButton>
    </Badge>
  )
}
