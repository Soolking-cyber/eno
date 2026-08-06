'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel'
import { useLanguage } from '@/context/language-context'
import { PROMO_SLIDES, type PromoSlide } from '@/lib/promo-slides'
import { cn } from '@/lib/utils'

/**
 * THE HOME PROMO BANNER — the Shopee-shaped advertising slot at the top of the feed.
 *
 * Geometry follows the reference the owner sent: a wide carousel with a column of static tiles
 * beside it on desktop. Copy and destinations live in src/lib/promo-slides.ts.
 *
 * ⚠️ IT IS COMPOSED FROM TOKENS AND REAL TEXT, NOT FROM ARTWORK, AND THAT IS LOAD-BEARING RATHER
 * THAN A SHORTCUT. Three reasons, in the order they would bite:
 *   1. A baked JPEG cannot be bilingual. Every string in this app switches EN/VI at RUNTIME, so
 *      text burned into an image would be permanently monolingual on a site whose whole audience
 *      premise is that it serves both.
 *   2. It sits above the fold, so a raster here becomes the LCP element — and the homepage LCP was
 *      dragged from 5.4s to 1.57s at real cost. A gradient plus text paints with the document.
 *   3. There is no artwork and no designer, so the honest alternative was a stock photo.
 * The known cost, flagged by BOTH external reviewers at plan time: this can read as an oversized UI
 * card rather than art direction. That is what the display type, the fixed dark panel and the
 * oversized watermark glyph below are defending against — if this is ever restyled, keep the
 * contrast HIGH. A timid version of this component is a worse answer than not having it.
 *
 * ⚠️ AUTOPLAY IS ON BY OWNER DECISION (2026-08-05), OVERRIDING BOTH EXTERNAL REVIEWERS. They each
 * independently said to drop it — slides past the first get little engagement, and movement nobody
 * asked for is an accessibility problem. The owner asked for it anyway, at "3-5 seconds or industry
 * standard". That is their call and it is recorded here so nobody silently "fixes" it back.
 *
 * ⚠️ WHAT IS NOT NEGOTIABLE IS THE FOUR PAUSE CONDITIONS, because they are what keeps autoplay from
 * being hostile: it stops on hover, on keyboard focus inside the carousel, when the tab is hidden,
 * and entirely under prefers-reduced-motion. Dropping any one of them reintroduces exactly the
 * accessibility objection the reviewers raised — a control that moves out from under the pointer, or
 * a page that animates forever in a background tab.
 */
export function PromoBanner() {
  const { tr } = useLanguage()
  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)

  const paused = useRef(false)
  const hold = useCallback((v: boolean) => { paused.current = v }, [])

  useEffect(() => {
    if (!api) return
    const sync = () => setSelected(api.selectedScrollSnap())
    sync()
    api.on('select', sync)
    api.on('reInit', sync)
    return () => {
      api.off('select', sync)
      api.off('reInit', sync)
    }
  }, [api])

  // ── Autoplay ──────────────────────────────────────────────────────────────────────────────────
  // 5s: the owner asked for "3-5 seconds or industry standard", and 5s is what the large carousels
  // (Shopee, Amazon, Booking) settle on. Below ~4s a slower reader cannot finish the headline before
  // it moves, which is the specific way an auto-carousel becomes worse than no carousel.
  //
  // ⚠️ A REF, NOT STATE, FOR THE PAUSE FLAG. Pausing must not re-render — a state flip here would
  // tear down and rebuild the interval on every pointer enter/leave, and the timer would restart
  // from zero each time, so a visitor sweeping the pointer across the banner would freeze it
  // indefinitely without ever meaning to.
  useEffect(() => {
    if (!api) return
    // Reduced motion is a hard opt-out, not a slower interval: the whole point is no unrequested
    // movement. Checked once here rather than per tick — a visitor who changes the OS setting
    // mid-session gets it on the next mount, which is a fair trade for not re-subscribing.
    const rm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (rm) return

    const id = setInterval(() => {
      // ⚠️ document.hidden is checked INSIDE the tick, not via a visibilitychange listener. A
      // background tab throttles timers but does not stop them, so without this the carousel
      // silently advances through every slide while nobody is looking and the visitor returns to a
      // position they never chose.
      if (paused.current || document.hidden) return
      api.scrollNext()
    }, 5000)
    return () => clearInterval(id)
  }, [api])

  // ⚠️ NO MARGIN OF ITS OWN. The landing wrapper in listings-explorer.tsx owns vertical rhythm via
  // `space-y-8 sm:space-y-12`; an `mb-*` here ADDS to that gap rather than replacing it, and the
  // first draft shipped 56px under the banner where the rest of the page uses 32px.
  return (
    <section aria-label={tr('Highlights', 'Nổi bật')}>
      {/* ⚠️ ONE FULL-WIDTH UNIT (owner, 2026-08-05: "make this one large banner"). It was a 2:1 grid
          with two static tiles beside the carousel; those tiles are gone, and with them the /safety
          and /?category=vehicles entry points they carried — both still reachable from the category
          grid and the footer, which is why removing them was safe. */}
      <div>
        {/* ⚠️ NO aria-label HERE. The primitive already sets role="region" +
            aria-roledescription="carousel", so labelling it "Highlights" too — the same words as the
            wrapping <section> — produced two nested landmarks a screen reader announces one after
            the other with nothing to tell them apart. Both external reviewers flagged it
            independently. The <section> owns the name; the carousel owns the role. */}
        {/* The pause surface. onFocus/onBlur use the REACT synthetic events, which bubble from any
            descendant — so tabbing to a dot or the CTA inside a slide stops the rotation, which is
            the keyboard equivalent of hovering. Plain DOM focus/blur do not bubble; these do. */}
        <Carousel
          opts={{ loop: true }}
          setApi={setApi}
          className="group/carousel"
          onMouseEnter={() => hold(true)}
          onMouseLeave={() => hold(false)}
          onFocus={() => hold(true)}
          onBlur={() => hold(false)}
        >
          {/* ⚠️ THE PRIMITIVE'S GUTTER IS CANCELLED HERE, ON BOTH HALVES TOGETHER. ui/carousel pairs
              a -ml-4 on the track with a pl-4 on every item, which is right for a multi-card shelf
              and wrong for one full-width panel: measured, it left the track starting 16px left of
              the clip box and the neighbouring slide showed as a dark strip down the banner's left
              edge. Cancel BOTH or neither — killing only one makes every slide a gutter-width too
              wide and clips the last one. */}
          <CarouselContent className="ml-0">
            {PROMO_SLIDES.map((slide, i) => {
              const current = i === selected
              return (
                <CarouselItem
                  key={slide.key}
                  // ⚠️ OFF-SCREEN SLIDES MUST BE INERT, and `overflow-hidden` does NOT do this.
                  // Measured on a 390px phone: slides 2 and 3 sit at x=378 and x=760 — invisible,
                  // but their <Link>s were still in the tab order, so a keyboard user tabbed from
                  // the banner into content nobody can see. Both external reviewers found this
                  // independently and it is the one defect they agreed on.
                  // `inert` removes them from focus AND from the accessibility tree; aria-hidden is
                  // belt-and-braces for engines that do not implement inert yet. Embla translates
                  // real slides rather than cloning them (verified: 3 DOM items for 3 slides), so
                  // `selected` is the whole truth about which one is showing.
                  className="pl-0"
                  inert={!current}
                  aria-hidden={!current}
                  aria-label={tr(`Slide ${i + 1} of ${PROMO_SLIDES.length}`, `Trang ${i + 1} trên ${PROMO_SLIDES.length}`)}
                >
                  <SlidePanel slide={slide} />
                </CarouselItem>
              )
            })}
          </CarouselContent>

          {/* Arrows live INSIDE the panel (the primitive parks them at -left-12/-right-12, which on
              a full-bleed banner would sit outside the page gutter and be invisible). The override
              goes on the primitive's own className, where cn()/tailwind-merge resolves it against
              the base — a collision like this on a render-child would merely concatenate and lose
              to stylesheet order. Pointer-only: on touch the swipe is the gesture. */}
          <CarouselPrevious
            variant="bare"
            className="left-3 hidden size-9 border-0 bg-black/25 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/40 group-hover/carousel:opacity-100 focus-visible:opacity-100 pc:flex"
          />
          <CarouselNext
            variant="bare"
            className="right-3 hidden size-9 border-0 bg-black/25 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/40 group-hover/carousel:opacity-100 focus-visible:opacity-100 pc:flex"
          />

          {/* Dots. Real <Button>s with labels, not decorative spans: they are the only slide control
              a touch visitor has besides the swipe itself.
              ⚠️ THE HIT AREA IS THE BUTTON; THE BAR IS AN INNER SPAN. Measured on a 390px phone, the
              first draft's dots were 6×6 CSS px — a quarter of the 24×24 WCAG 2.5.8 minimum. The bar
              has to stay small to look right, so the target is bought with the button's own height
              and padding instead of by growing the bar.
              ⚠️ AND THEY ARE RIGHT-ALIGNED BECAUSE OF THAT, NOT FOR LOOKS. The CTA is bottom-LEFT and
              its underside sat 6px above the old dot row; a 24px-tall target centred in the same
              place overlaps it and silently steals taps meant for "Post an ad" — the failure mode
              where a tap target covers a control it merely sits near. Moving them to the opposite
              corner separates the two horizontally, so no vertical overlap can matter. Verified with
              elementFromPoint over both controls; if this row is ever re-centred, re-verify that. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-end gap-1 pr-3 sm:pr-5">
            {PROMO_SLIDES.map((slide, i) => (
              <Button
                key={slide.key}
                variant="bare"
                size="none"
                onClick={() => api?.scrollTo(i)}
                aria-label={tr(`Go to slide ${i + 1}`, `Đến trang ${i + 1}`)}
                aria-current={i === selected}
                className="pointer-events-auto flex h-6 min-w-6 items-center justify-center px-1"
              >
                <span
                  aria-hidden
                  className={cn(
                    'block h-1.5 rounded-full transition-all duration-200',
                    i === selected ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80',
                  )}
                />
              </Button>
            ))}
          </div>
        </Carousel>
      </div>
    </section>
  )
}

/**
 * ⚠️ MIN-HEIGHT, NOT A FIXED ASPECT BOX — and this is the one geometry decision here that was
 * changed by review rather than chosen. Both reviewers named the same phone failure: Vietnamese
 * copy overflowing a locked box. Measured across 816 real tr() pairs in this repo, Vietnamese runs
 * longer than English in 42% of strings (median ratio 0.99, p90 ≈1.33×) — so roughly one slide in
 * ten would have clipped or overlapped in a hard `aspect-[2/1]`.
 *
 * min-h keeps both properties that matter: the height is reserved before hydration so the block
 * never collapses-then-fills (the CLS bug that cost this page 0.142 once already), and a long
 * Vietnamese line grows the panel instead of being cut off.
 */
function SlidePanel({ slide }: { slide: PromoSlide }) {
  const { tr } = useLanguage()
  const Icon = slide.icon

  return (
    <Link
      href={slide.href}
      // ⚠️ AN EXPLICIT NAME, because the whole panel is the link. Without this the accessible name
      // is every text node inside it concatenated — measured at 140 characters, read aloud in one
      // breath ("Đăng tin miễn phíBán trong 60 giây…"). Naming it after the headline and the action
      // keeps the one-big-target behaviour (which is right on a phone) without the recital.
      aria-label={`${tr(slide.titleEn, slide.titleVi)} — ${tr(slide.ctaEn, slide.ctaVi)}`}
      className={cn(
        // ⚠️ lg:px-14 IS THE ARROW GUTTER, not a taste choice. The hover arrows are absolutely
        // positioned at left-3/right-3, so they occupy 12→48px inside the panel; at the previous
        // lg:px-9 (36px) the left arrow sat ON the body text and clipped its first letter —
        // measured, arrow 124→160 against text starting at 148. 56px clears it by 8px.
        // It is `lg:` rather than `pc:` deliberately: `pc:` and `lg:` are different variants that
        // both match on a desktop, and which one wins would come down to stylesheet order, which is
        // exactly the fragile thing this codebase has been bitten by before.
        // Taller at lg now that the banner spans the full width rather than two thirds of it —
        // a 1400px-wide panel only 248px tall reads as a strip, not a banner.
        // Padding halved (owner, 2026-08-05): px-5/py-6/sm:px-7/lg:px-14 -> px-3/py-3/sm:px-4/lg:px-7.
        // ⚠️ This tightens the INSET, not the height. The panel is sized by min-h + justify-center,
        // so the vertical padding is slack the min-height already absorbs — halving py alone moves
        // nothing until the content outgrows the panel. Shortening the banner means lowering the
        // min-h values below, which is a separate decision and deliberately left alone.
        'relative flex min-h-[188px] flex-col justify-center overflow-hidden rounded-2xl px-3 py-3 text-white sm:min-h-[212px] sm:px-4 lg:min-h-[300px] lg:px-7',
        slide.surface,
      )}
    >
      {/* ⚠️ THE ARTWORK IS A BACKGROUND LAYER, NOT AN <img>, AND IT IS DECORATIVE. Three consequences
          worth keeping: the gradient in `surface` stays visible beneath it, so a slow or failed load
          shows a finished panel instead of a white hole above the fold; there is no alt text to
          maintain because the meaning lives in the DOM text on top; and swapping in real artwork
          later is a one-line data change in promo-slides.ts.
          It is deliberately NOT next/image: these are SVGs, which next/image refuses without
          `dangerouslyAllowSVG`, and a config flag that permits arbitrary SVG rendering is a bad
          trade for three decorative files that are ~1KB each and need no resizing. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${slide.image})` }}
      />
      {/* Depth without a second palette: one blurred highlight and one oversized glyph, both pure
          white at low alpha, so the panel reads as art-directed while every colour still comes from
          the two sanctioned marketing tokens. */}
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-44 rounded-full bg-white/10 blur-2xl" />
      <Icon aria-hidden className="pointer-events-none absolute -bottom-6 -right-4 size-40 text-white/10 sm:size-48" />

      <div className="relative max-w-[86%] sm:max-w-[76%]">
        <p className="text-2xs font-bold uppercase tracking-wider text-white/75 sm:text-xs">
          {tr(slide.eyebrowEn, slide.eyebrowVi)}
        </p>
        {/* h2, NOT h3. This panel sits directly under the page's (sr-only) h1, so an h3 here skipped
            a level and broke the document outline — a screen reader jumped h1 → h3 with nothing
            between. It also contradicted the outline listings-explorer.tsx documents for this page:
            h1 → section h2 → card h3s. Keep it h2 so the card titles below stay the h3 tier. */}
        <h2 className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight text-balance sm:text-2xl lg:text-3xl">
          {tr(slide.titleEn, slide.titleVi)}
        </h2>
        {/* Clamped rather than hidden on phones. It was `hidden sm:block` in the first draft, which
            left the panel visibly empty at 390px — and this is the line that actually sells. Two
            lines is the budget: Vietnamese runs longer than English in 42% of this app's strings
            (measured over 816 tr() pairs), so the clamp is what stops a long translation from
            growing the panel and shoving the category scroller down the page. */}
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/85 sm:line-clamp-none">
          {tr(slide.bodyEn, slide.bodyVi)}
        </p>
        {/* Not a nested <button> — the whole panel is the link, so this is a styled span that only
            LOOKS like the CTA. A real <Button> inside an <a> is invalid HTML and swallows the tap
            target it sits on. */}
        <span className="mt-4 inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-bold text-brand shadow-sm">
          {tr(slide.ctaEn, slide.ctaVi)}
        </span>
      </div>
    </Link>
  )
}
