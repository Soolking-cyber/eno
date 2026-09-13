import { overlayMarkFromUrl } from '@/lib/image-mark-url'
import { IS_MARKETPLACE } from '@/lib/edition'
import { cn } from '@/lib/utils'

/** The wordmark's own sprite — ONE cached file, referenced by every card (see eno-mark.svg). */
export const IMAGE_MARK_SPRITE = '/brand/eno-mark.svg#m'
/** The mark's ink box, copied from watermark-mark.ts MARK_W/MARK_H rather than imported: that module
 *  also carries the 3KB path string, which has no business in the client bundle. Pinned equal by
 *  watermark-mark.test.ts. */
export const IMAGE_MARK_BOX = { w: 9132.3, h: 1588.3 }

const INK = { dark: 'text-black/40', light: 'text-white/85' } as const

/**
 * THE APP-DRAWN eno.vn MARK over a listing photo — one size and one corner on every image.
 *
 * Owner, 2026-09-13: "consistent sizing and placement of eno.vn watermark on all images … one has big
 * small other missing". A burned mark could not deliver that: it was sized off each file's own width
 * and anchored to each file's own corner, and the square card crop then cut it off (landscape), hid it
 * (portrait) or shrank it. Drawn by the app it is 28% of the width, inset 3% of the short edge,
 * bottom-right — the proportions the burned rule used, measured against what the viewer actually sees:
 *
 *   fit="cover"   (cards, map popup, SEO cards — square frames that crop): the FRAME's corner, which is
 *                 the corner of the photo's visible centre square.
 *   fit="contain" (PDP gallery, lightbox — the whole photo inside a letterbox): the PHOTO's own corner.
 *                 Positioned by an SVG whose viewBox is the stored W×H with `meet`, so its coordinate
 *                 system IS the contained photo's rectangle — no JS, no load wait, no layout read. A
 *                 frame-corner mark there would sit on the blur-fill or the lightbox backdrop, in ink
 *                 chosen for a different patch (a reviewer's catch).
 *
 * ⛔ RENDERS NOTHING FOR AN IMAGE THAT ALREADY CARRIES A BURNED MARK. Only a clean import in our bucket
 * gets one — see image-mark-url.ts. Everything stored before keeps its single burned mark until it is
 * re-fetched; nothing is ever marked twice. (`.img-watermark` beside it is a different thing: opacity 0
 * until a save/copy attempt, see image-shield.tsx.)
 * ⛔ MARKETPLACE ONLY. The wordmark SPELLS the licensed company's domain, and edition.ts forbids any new
 * call site of it on eno.forum.
 * ⚠️ The parent must be `relative` and clip. ⚠️ Ink travels as `currentColor` through `<use>` — a class
 * cannot style inside a `<use>` shadow tree, but inherited `color` crosses it.
 */
export function ImageMark({ src, fit = 'cover', className }: { src: string | null | undefined; fit?: 'cover' | 'contain'; className?: string }) {
  if (!IS_MARKETPLACE) return null
  const mark = overlayMarkFromUrl(src)
  if (!mark) return null

  if (fit === 'cover') {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${IMAGE_MARK_BOX.w} ${IMAGE_MARK_BOX.h}`}
        className={cn('pointer-events-none absolute bottom-[3%] right-[3%] z-[1] h-auto w-[28%] select-none', INK[mark.cover], className)}
      >
        <use href={IMAGE_MARK_SPRITE} width="100%" height="100%" />
      </svg>
    )
  }

  const { width: W, height: H } = mark
  const pad = Math.min(W, H) * 0.03
  // Same clamp as watermarkPlacement: 28% of the width, but never taller than the photo allows.
  const mw = Math.max(1, Math.min(W * 0.28, W - 2 * pad, ((H - 2 * pad) * IMAGE_MARK_BOX.w) / IMAGE_MARK_BOX.h))
  const mh = (mw * IMAGE_MARK_BOX.h) / IMAGE_MARK_BOX.w
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn('pointer-events-none absolute inset-0 z-[1] h-full w-full select-none', INK[mark.contain], className)}
    >
      <svg x={W - mw - pad} y={H - mh - pad} width={mw} height={mh} viewBox={`0 0 ${IMAGE_MARK_BOX.w} ${IMAGE_MARK_BOX.h}`}>
        <use href={IMAGE_MARK_SPRITE} width="100%" height="100%" />
      </svg>
    </svg>
  )
}
