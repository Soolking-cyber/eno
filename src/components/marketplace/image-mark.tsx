import { overlayMarkFromUrl } from '@/lib/image-mark-url'
import { cn } from '@/lib/utils'

/** The wordmark's own sprite — ONE cached file, referenced by every card (see eno-mark.svg). */
export const IMAGE_MARK_SPRITE = '/brand/eno-mark.svg#m'
/** The mark's ink box, copied from watermark-mark.ts MARK_W/MARK_H rather than imported: that module
 *  also carries the 3KB path string, which has no business in the client bundle. Pinned equal by
 *  watermark-mark.test.ts. */
export const IMAGE_MARK_BOX = { w: 9132.3, h: 1588.3 }

/**
 * ⛔ THE MARK IS NOT DRAWN ON SCREEN ANY MORE (owner, 2026-11-10: "1-6 1 by one go", item 6 of the decision scorecard).
 * Blind A/B against today's pages, both judges for no mark (codex 7.09 to 7.20, Fable 7.43 to 7.55): on a partner's rental the
 * photo carried two marks, GoPlus's and ours; on a linked shop's product ours sat on a photo the page itself says eno.vn did
 * not verify; and on every tile it was one more thing between the buyer and the photo. The owner took the stated cost: a
 * screenshot of a listing photo no longer carries the eno.vn name.
 * ONE SWITCH FOR EVERY SURFACE (cards, map cards, SEO rails, the listing's photo, the full-screen viewer), so the 2026-09-13
 * rule below holds either way: when it is drawn, it is one size and one corner everywhere.
 * ⚠️ TURNING IT BACK ON IS TWO STEPS, NOT ONE. `true` here draws the mark again on every IMPORTED photo, exactly as before
 * (their names carry what the renderer needs, image-mark-url.ts). A MEMBER's photo uploaded since the same day is stored
 * clean with the same facts in its name (core/media.ts), but `overlayMarkFromUrl` reads only `affiliate/m/` names: it has
 * to learn the member shape as well, or those photos stay unmarked. No stored file needs touching either way.
 * ⚠️ What is NOT this switch: the `.img-watermark` shield (image-shield.tsx) still flashes over a photo on a save, copy or
 * drag attempt; and a photo uploaded before 2026-11-10 keeps the mark baked into its pixels, which nothing can take out.
 */
export const ON_SCREEN_MARK: boolean = false

// ⚠️ THE OWNER'S RULE IS ONE SIZE AND ONE CORNER (below), NOT THIS STRENGTH. At white/85 and black/40 the mark out-shouted the
// card's own title on every photo (UI climb 2026-11-05). A save or copy still gets the full-strength `.img-watermark`
// (image-shield.tsx); a screenshot carries this mark at the lighter ink, and that is the trade.
const INK = { dark: 'text-black/25', light: 'text-white/60' } as const

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
 * ⚠️ BOTH EDITIONS, BY THE OWNER'S CHOICE (2026-09-13): eno.forum is an exact copy of eno.vn and shows
 * the same eno.vn mark. This is a deliberate exception to edition.ts's rule that a domain-spelling
 * wordmark needs an edition gate — it applies to this image mark only.
 * ⚠️ The parent must be `relative` and clip. ⚠️ Ink travels as `currentColor` through `<use>` — a class
 * cannot style inside a `<use>` shadow tree, but inherited `color` crosses it.
 */
export function ImageMark({ src, fit = 'cover', className }: { src: string | null | undefined; fit?: 'cover' | 'contain'; className?: string }) {
  if (!ON_SCREEN_MARK) return null
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
