import Image from 'next/image'
import { ImageMark } from './image-mark'
import { isMockImageUrl } from '@/lib/listing-image'
import { collageLayout, COLLAGE_MAX } from '@/lib/photo-collage'
import { cn } from '@/lib/utils'

/**
 * THE WIDE RENTAL CARD'S PHOTO COLLAGE, ON A PHONE (owner, 2026-11-24, hub round 17 — src/lib/photo-collage.ts has the layout
 * rules). Up to four photos, each in a tile of its own shape, 2px apart, "+N" on the last when the listing has more. It sits
 * in the card's media box beside the swipe strip and replaces it below `sm` only (`sm:hidden` here, the strip `max-sm:hidden`);
 * from `sm` a wide card is an ordinary grid card again (listing-grid.ts).
 *
 * The frame's height comes from the layout (`aspect-ratio`), so the card's height is known at render: no load-time jump.
 * Nothing here is a control: the media box's own click opens the listing, as it does for the strip.
 * ⚡ The FIRST tile asks for the strip's first photo at the strip's `sizes`, so on the page's LCP card it is the very request
 * the strip's preload already made (same URL), not a second one. The other tiles are lazy.
 */
export function CardCollage({ images, title, sizes, firstEager }: {
  images: readonly string[]
  title: string
  /** The strip's own `sizes` (WIDE_CARD_SIZES), used by the first tile so its request is the strip's. */
  sizes: string
  /** The first tile loads at once (the card is above the fold); otherwise lazy like every other tile. */
  firstEager: boolean
}) {
  const layout = collageLayout(images)
  if (!layout) return null
  const shown = Math.min(COLLAGE_MAX, images.length)
  const more = images.length - shown
  const last = layout.tiles.length - 1
  return (
    <div
      data-card-collage={layout.name}
      className="relative w-full sm:hidden"
      style={{ aspectRatio: `1 / ${layout.height.toFixed(4)}` }}
    >
      {layout.tiles.map((t, k) => {
        const src = images[t.i]
        return (
          <div
            key={t.i}
            className="absolute overflow-hidden bg-tint"
            style={{
              left: `${(t.x * 100).toFixed(3)}%`,
              top: `${((t.y / layout.height) * 100).toFixed(3)}%`,
              width: `${(t.w * 100).toFixed(3)}%`,
              height: `${((t.h / layout.height) * 100).toFixed(3)}%`,
            }}
          >
            <Image
              src={src}
              // One described photo, as the strip's first slide is ("title — 1/N"); the rest are the same listing's, decorative.
              alt={k === 0 ? (images.length > 1 ? `${title} — 1/${images.length}` : title) : ''}
              fill
              sizes={k === 0 ? sizes : `${Math.ceil(t.w * 100)}vw`}
              className="object-cover"
              quality={60}
              unoptimized={isMockImageUrl(src)}
              loading={k === 0 && firstEager ? 'eager' : 'lazy'}
            />
            <ImageMark src={src} />
            {k === last && more > 0 && (
              <div aria-hidden="true" className={cn('absolute inset-0 grid place-items-center bg-black/35 text-2xl font-bold text-white tabular-nums')}>
                +{more}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
