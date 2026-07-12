import { cn } from '@/lib/utils'

// Shared text input — the app's dominant field idiom (sign-in, search, forms):
// FILLED tint box, rounded-xl, no border, brand focus ring. `variant="outline"`
// is the bordered-on-card form style. Both are zero-visual-change targets for
// the hand-rolled inputs across forms; pass sizing/spacing overrides via
// className (cn/tailwind-merge lets callers win).
const VARIANTS = {
  filled: 'bg-tint focus:ring-2 focus:ring-ring/30',
  outline:
    'border border-line-strong bg-card focus:border-brand focus:ring-2 focus:ring-ring/30',
} as const

export function Input({
  variant = 'filled',
  className,
  ...props
}: { variant?: keyof typeof VARIANTS } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
