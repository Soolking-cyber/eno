import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * ⚠️ SINCE 2026-11-14 ONLY THE COMPACT 56px ROW USES THIS (compact-listing-row.tsx). The grid card and the SEO tile cover
 * their square again (owner-approved 2026-11-14, cook r05: "photo fills its square (cover)"; it reverses the 2026-11-12
 * ruling below for those two surfaces). The notes about a card below are its history; the LCP one no longer applies.
 *
 * The blurred copy of a listing photo that fills its square box around the photo itself, which is shown WHOLE (`object-contain`).
 * ⛔ A CARD SHOWS THE WHOLE PHOTO (owner, 2026-11-12: "do not crop but fit in so nothing from original image misses", then yes to cards
 * fitting the whole photo "with a blurred fill around it, like the listing page"). Until then every card `object-cover`ed its photo, so a
 * wide banner lost its sides on every card. The listing page's gallery has had this fill for a long time (listing-gallery.tsx).
 * ⚠️ THE SAME URL AS THE PHOTO, NOT THE GALLERY'S 64px COPY: give it the photo's own `src`, `sizes`, `quality` and `unoptimized`, so
 * next/image writes the same srcset, the browser picks the same file for both, and a card costs no second request. Give it the photo's
 * loading props too, WITHOUT `priority`/`fetchPriority` (one preload, the photo's): a lazy photo's fill loads with it, and a held photo's
 * fill carries HELD_PHOTO_ATTR and is held with it (image-hold.ts), so it never fetches ahead of the photo it sits under.
 * ⚠️ On the LCP card pass `loading="eager"`: the fill is the larger painted image (scale-150), so Chrome may report IT as the LCP element,
 * and a lazy fill there would wait for hydration (the gallery's own finding).
 * A square photo covers its fill completely; nothing shows.
 * ⚠️ THE OVERSCALE MUST OUTRUN THE BLUR. CSS blur() samples transparency past the element's edge, so a blurred layer fades to see-through
 * over about twice its radius. The gallery gets away with scale-110 + blur-2xl on a ~800px box (40px of overscan); on a 180px card that was
 * 9px against a 40px blur, and every fill wore a pale bg-tint halo (commit review, 2026-11-12; seen on a dark photo in a harness).
 * scale-150 puts the edge 25% of the box outside it, at least twice the blur on every surface: ~42px on a 170px phone card against
 * blur-lg (16px), 14px on the 56px row thumbnail against blur-xs (4px).
 */
export function PhotoFill({
  src,
  sizes,
  quality,
  unoptimized,
  blur = 'large',
  className,
  ...load
}: {
  src: string
  sizes: string
  quality?: number
  unoptimized?: boolean
  /** 'large' for a grid card, 'small' for a thumbnail a few dozen pixels wide. */
  blur?: 'large' | 'small'
  className?: string
  loading?: 'eager' | 'lazy'
} & Record<`data-${string}`, string>) {
  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      fill
      sizes={sizes}
      quality={quality}
      unoptimized={unoptimized}
      {...load}
      className={cn('scale-150 object-cover dark:brightness-[0.92]', blur === 'large' ? 'blur-lg' : 'blur-xs', className)}
    />
  )
}
