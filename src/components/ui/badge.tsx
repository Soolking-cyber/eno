import * as React from 'react'
import { cn } from '@/lib/utils'

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
//  · COUNT BUBBLES — `size="count" variant="counter"` is the notification counter.
//    It is on the destructive TOKEN, so it adapts in dark mode. The 4 bubbles still
//    hand-rolled on raw `bg-red-500` (header ×2, mobile-nav ×2) are geometrically
//    identical to it and should migrate; POSITIONING stays on the caller (the
//    primitive owns no `absolute`). The 2 raw `bg-red-600` pills on the PDP are
//    wider chips, not bubbles — they want `variant="counter"` at `size="sm"`.
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
  counter: 'bg-destructive text-white',
} as const

const SIZES = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-1 text-xs',
  // Notification-count bubble: fixed 16px box that grows for 2–3 digits.
  count: 'h-4 min-w-4 justify-center px-1 text-3xs tabular-nums',
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
    /* eslint-disable @typescript-eslint/no-explicit-any */
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
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  return <span className={cn(own, className)} {...props} />
}
