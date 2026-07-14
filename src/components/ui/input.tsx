import { cn } from '@/lib/utils'

// Shared text input — the app's dominant field idiom (sign-in, search, forms):
// FILLED tint box, rounded-xl, no border, brand focus ring. `variant="outline"`
// is the bordered-on-card form style. Both are zero-visual-change targets for
// the hand-rolled inputs across forms; pass sizing/spacing overrides via
// className (cn/tailwind-merge lets callers win).
//
// `variant="unstyled"` is for the ~nine fields that live INSIDE a caller-owned
// box (header search shell, hero pill, chat composer, filter fields): the WRAPPER
// owns the background, the radius and the focus-within ring, so the field itself
// must paint NO box — no bg, border, radius, padding, focus ring, or width — or it
// double-boxes and fights the wrapper's focus-within. It keeps only what isn't
// decoration: the placeholder token colour, the text colour, the killed UA outline
// and the disabled state. Everything box-shaped therefore lives in the VARIANTS,
// not in BASE.
//
// ⚠️ Deliberately NO text size on `unstyled`. Several of these fields carry
// `text-base` (16px) because iOS zooms the viewport when focusing any field under
// 16px — a baked `text-sm` here would be a mobile regression. Sizing (w-full /
// flex-1 / text-base) is the caller's business.
const BOX = 'w-full rounded-xl px-4 py-3 text-sm'

const VARIANTS = {
  filled: `${BOX} bg-tint focus:ring-2 focus:ring-ring/30`,
  outline: `${BOX} border border-line-strong bg-card focus:border-brand focus:ring-2 focus:ring-ring/30`,
  unstyled: 'bg-transparent',
} as const

export function Input({
  variant = 'filled',
  className,
  ...props
}: { variant?: keyof typeof VARIANTS } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'text-foreground outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
