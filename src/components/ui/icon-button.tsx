'use client'

import { cn } from '@/lib/utils'

// Shared GHOST icon-button SHELL — the round, centered, 44px-tap-target box that's hand-rolled
// across the app (header, notifications, share, close ✕, overflow…). It bakes in ONLY the
// structural boilerplate every one of them repeats — `relative flex items-center justify-center
// rounded-full shrink-0 cursor-pointer tap-44` + the size box — and NOTHING else, so migrating
// is a faithful, zero-visual-change swap: each site keeps its own tone (text-*, hover:bg-*,
// transition, any active:scale) via className. `size` sets the box; the icon child sizes itself.
// NOT for: over-image hearts (drop-shadow), badge/decorative spans, fill-state toggles, nav
// tabs, or brand-filled FABs — those stay bespoke.
const SIZES = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
} as const

export function IconButton({
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: { size?: keyof typeof SIZES } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'relative flex shrink-0 cursor-pointer items-center justify-center rounded-full tap-44',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
