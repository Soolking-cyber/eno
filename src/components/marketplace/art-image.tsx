import { avifOf } from '@/lib/category-art'
import { cn } from '@/lib/utils'

/**
 * ONE GENERATED ICON, IN THE BEST FORMAT THE BROWSER CAN READ.
 *
 * Owner, 2026-08-29: "make thos icons larger and crisper with maximum compression, also all png
 * icons find the way to make them even smaller by KB size without loosing quality crisp sharp loads
 * fast". Measured over five icons from the pack, comparing each encode with the source resampled to
 * a real 3x device size and composited over the page's own background:
 *     webp q50 (what shipped)   3.69 KB   error 1.222
 *     webp LOSSLESS            15.73 KB   error 0.625
 *     avif q50                  3.35 KB   error 0.464
 * AVIF is smaller than the WebP that shipped AND more accurate than WebP lossless at a fifth of the
 * bytes. Across all 35 icons that is 126 KB where it was 140 KB — 10% fewer, visibly crisper.
 *
 * ⛔ THE `<picture>` IS NOT DECORATION, IT IS THE FLOOR. `browserslist` says `safari >= 16` and AVIF
 * decoding landed in Safari 16.4, so 16.0–16.3 must be handed the WebP or it renders a BROKEN
 * IMAGE — which is far worse than a slightly soft one. The browser picks exactly one and downloads
 * exactly one, so per-visitor bytes fall even though the repo now carries both.
 *
 * ⚠️ THE `<img>` KEEPS EVERY ATTRIBUTE IT HAD, and that matters more than it looks: `<source>` only
 * proposes a URL — sizing, `alt`, `aria-hidden`, `decoding` and `fetchPriority` all still come from
 * the `<img>`, which is the element that actually renders. A `<picture>` wrapper is `display:inline`
 * by default and would add a stray inline box inside a flex row, so it carries `contents`.
 */
export function ArtImage({
  src,
  className,
  ...rest
}: {
  /** The WEBP path — `avifOf` derives the twin. Keeping webp as the argument means every caller's
   *  existing `*ArtPath()` result works unchanged and the fallback is the thing that cannot be
   *  forgotten. */
  src: string
  className?: string
} & Omit<React.ComponentProps<'img'>, 'src' | 'className'>) {
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={avifOf(src)} />
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size static assets from our own
          origin; next/image would add a proxy hop and a layout wrapper, and cannot emit this
          AVIF-with-WebP-fallback pair for a non-responsive 20px glyph. */}
      <img src={src} className={cn(className)} {...rest} />
    </picture>
  )
}
