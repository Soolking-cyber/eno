import { cn } from '@/lib/utils'

// Shared multiline field — same idioms as <Input> (filled tint default, outline
// variant). See input.tsx.
const VARIANTS = {
  filled: 'bg-tint focus:ring-2 focus:ring-ring/30',
  outline:
    'border border-line-strong bg-card focus:border-brand focus:ring-2 focus:ring-ring/30',
} as const

// How the box gets its height. `default` keeps the historical base (a 96px floor +
// a drag handle) — it stays the default so every existing call site is untouched.
//
// The floor is the problem this API exists to solve: `min-h-24` OUTRANKS a small
// `rows`, so rows={1..3} silently rendered a 96px box and every compact swap had to
// pass `min-h-0 resize-none` by hand. Forget it once and the box grows 12-36px — in
// the AI composer that also inflates the height a ResizeObserver publishes as
// --footer-h, over-padding the whole message list. So: `compact` = rows wins.
//
// Heights are rows x line-height + padding. NOTE line-height is a UNITLESS RATIO in
// Tailwind v4 (--text-sm--line-height: calc(1.25/0.875)), and globals.css forces
// font-size:16px on textareas under (pointer: coarse) to stop iOS focus-zoom — so a
// text-sm row is 20px on desktop but 22.86px on mobile. Both are below the 24px the
// floor assumes per row, which is why the floor bites exactly the 3-row filled field.
const SIZES = {
  /** 96px floor, vertical drag handle. The historical base — unchanged. */
  default: 'min-h-24 resize-y',
  /** rows wins: no floor, no drag handle. Pass `className="resize-y"` to keep the handle. */
  compact: 'min-h-0 resize-none',
  /** rows is the STARTING height; the box then grows with its content. Pair with a
   *  `max-h-*` so it can't run away. field-sizing is Chromium-only today; where it's
   *  unsupported this degrades to exactly `compact` (rows-sized), never to the floor. */
  auto: 'min-h-0 resize-none field-sizing-content',
} as const

export function Textarea({
  variant = 'filled',
  size = 'default',
  className,
  ...props
}: {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
