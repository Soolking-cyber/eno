import { getInitials, cn, BRAND_BLUE } from '@/lib/utils'

// Shared user/seller avatar: a photo when there is one, otherwise the app-wide initials
// on the account's `avatarColor` (brand blue fallback). Consolidates the image-or-initials
// block that was hand-rolled in ~6 places (seller card, conversation list, dashboard,
// profile editor, storefront, chat header), each with its own `slice(0,2)` — which drifted
// from the canonical getInitials() rule. No 'use client' / no hooks, so it renders in both
// server and client components.

const SIZES = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-xl',    // profile editor
  '2xl': 'h-24 w-24 text-3xl', // storefront header
} as const

export function Avatar({
  name,
  url,
  color,
  size = 'md',
  className,
}: {
  name?: string | null
  url?: string | null
  color?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const base = cn('shrink-0 overflow-hidden rounded-full', SIZES[size], className)
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cn(base, 'object-cover')} />
  }
  return (
    <span
      className={cn(base, 'flex items-center justify-center font-bold text-white')}
      style={{ backgroundColor: color || BRAND_BLUE }}
    >
      {getInitials(name)}
    </span>
  )
}
