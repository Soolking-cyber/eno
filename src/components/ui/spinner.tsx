import { cn } from '@/lib/utils'

// The border-ring loading indicator used in map/explorer loading overlays — consolidates the
// hand-rolled `animate-spin rounded-full border-2 …` rings. (Inline button spinners use the
// lucide <Loader2 className="… animate-spin" /> icon — a deliberately different, idiomatic
// pattern, left as-is.) Default ring is brand-with-transparent-top; pass className to recolour
// (e.g. `border-border border-t-brand`). Decorative — aria-hidden baked in.
const SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
} as const

export function Spinner({ size = 'sm', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block animate-spin rounded-full border-2 border-brand border-t-transparent', SIZES[size], className)}
    />
  )
}
