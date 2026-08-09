import { getInitials, cn, BRAND_BLUE } from '@/lib/utils'
import { AvatarImage } from './avatar-image'

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
  // ⚠️ THE INITIALS ARE ALWAYS RENDERED, AND THE PHOTO SITS ON TOP OF THEM.
  // This used to be an either/or: a url meant an `<img>` and nothing else, so a photo that
  // failed to load left a blank hole where a face should be — no initials, no colour, just the
  // edit affordance floating in space (owner, 2026-08-09). Photos fail for ordinary reasons
  // (a rotated Google account photo, a deleted storage object, a flaky network), and an avatar
  // is identity: the fallback has to be the DEFAULT layer, not a branch that a load error can
  // skip past. Now the coloured initials are the substrate and the photo covers them when it
  // arrives — so the failure mode is "this person's initials" instead of a void.
  // The photo layer removes itself on error; see AvatarImage for why that needs a client leaf.
  const bg = color || BRAND_BLUE
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: bg }}
    >
      {getInitials(name)}
      {/* keyed on the url so a freshly uploaded photo clears a previous failure instead of
          inheriting the old element's `failed` state and staying invisible. The colour is
          handed down so the photo can paint itself opaque over the initials — see AvatarImage. */}
      {url && <AvatarImage key={url} src={url} color={bg} />}
    </span>
  )
}
