import { cn } from '@/lib/utils'

// Shared chip/badge/status-pill — the rounded-full label span hand-rolled ~86×
// across the app (trust chips, status pills, counts, filter tags). Variants map
// to the token palette (docs/design-language.md §5); sizes map to the sanctioned
// micro type steps. For NEW chips use this instead of re-rolling the span; legacy
// chips migrate opportunistically (zero-visual-change swaps only).
// NOT for: interactive filter pills with selected-state logic (those are buttons —
// keep bespoke or use <Button>), over-image overlays with drop-shadows, or the
// notification counter dot (positioning is bespoke; reuse `variant="counter"` tone).
const VARIANTS = {
  neutral: 'bg-tint text-ink-4',
  brand: 'bg-accent text-accent-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border border-line-strong text-body',
  counter: 'bg-destructive text-white',
} as const

const SIZES = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-1 text-xs',
} as const

export function Badge({
  variant = 'neutral',
  size = 'sm',
  className,
  ...props
}: {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-bold',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
