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
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { PROMO_SLIDES, type PromoSlide } from '@/lib/promo-slides'
import { SERVICES_PROMO_SLIDES } from '@/lib/promo-slides-services'
import { IS_SERVICES } from '@/lib/edition'

import { cn } from '@/lib/utils'

/**
 * WHICH BANNER THIS DEPLOYMENT SHOWS.
 *
 * ⛔ THE EDITIONS PROMOTE DIFFERENT THINGS AND THE OVERLAP IS EXACTLY ONE SLIDE.
 *   · eno.vn      — VietKite + GMBR + VinWonders (licensed partners it may surface)
 *   · eno.forum   — its own visa/booking desk + VinWonders
 * eno.forum keeps promoting its own storefront because PayPal checkout lives there (owner,
 * 2026-08-24). VinWonders is in BOTH arrays as one shared object, VINWONDERS_SLIDE, so the two
 * cannot drift; everything else stays edition-specific.
 *
 * ⚠️ THIS WAS BRIEFLY COLLAPSED TO ONE SHARED LIST EARLIER THE SAME DAY AND REVERTED WITHIN HOURS.
 * If a merge is proposed again, the blocker to check first is PayPal: eno.vn may not serve it, so
 * eno.forum cannot stop promoting the desk that does.
 *
 * ⚠️ `IS_SERVICES` FOLDS AT BUILD TIME, and the services module is aliased to an empty stub on the
 * marketplace build — so eno.vn's bundle contains neither the branch nor the words. The flag alone
 * would only decide what renders.
 */
const SLIDES: PromoSlide[] = IS_SERVICES ? SERVICES_PROMO_SLIDES : PROMO_SLIDES

/**
 * ⛔ DO NOT ADD `preload(PROMO_SLIDES[0].image)` HERE — IT WAS TRIED AND IT LEAKS.
 *
 * The problem is real and still open. Measured at 390×844 / 4× CPU / 1.6 Mbps / 150 ms RTT: the
 * browser picks `/banners/promo-1.svg` as this page's LCP element, and nothing preloads it — the
 * only image preload on the page is `/logo-mark.svg`. The file is 1.1 KB, so this is NOT a payload
 * problem, it is a DISCOVERY problem: the artwork is a CSS `background-image` (see the note on the
 * layer below for why that is right for a decorative SVG), and the preload scanner cannot see
 * inside a style attribute. The URL is learned only after CSS parses and the element lays out.
 *
 * ⚠️ `preload()` FROM react-dom DOES NOT FIX IT, and the reason is worth keeping. It was added on
 * the reasoning that a call inside this CLIENT component would live and die with the banner, which
 * only the landing page renders — unlike the Server Component version whose failure
 * `(home)/page.tsx` already documents. That reasoning is wrong: React hoists the <link> to <head>
 * and does NOT remove it on unmount. Verified rather than assumed, on a marketplace production
 * build: soft-navigated `/` → `/signin` and `link[rel=preload][href*="promo-1"]` was STILL in the
 * head. Same leak as before, moved one file.
 *
 * The likely correct fix is to stop hiding the image from the scanner — render it as a real
 * `<img aria-hidden fetchpriority="high">` positioned like the current background layer, so it is
 * in the SSR HTML where the scanner can see it and it unmounts with the component. That is a
 * change to how the banner paints, not a one-liner, so it is left for a pass that can measure it
 * properly rather than bolted on here.
 */

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

  /**
   * ONE "the page has finished loading" SIGNAL, SERVING TWO PURPOSES: it releases the off-screen
   * slides' artwork, and it starts autoplay. They are deliberately the same flag — art must never
   * arrive later than the movement that reveals it, and coupling them makes that impossible to get
   * wrong by editing one of them.
   *
   * ⚠️ readyState FIRST, NOT A BARE addEventListener. On a soft navigation back into `/` the load
   * event fired long ago and will never fire again, so a listener alone would leave the carousel
   * frozen with three slides showing no artwork — the owner's autoplay silently dead on every
   * route change into the home page, and only there, which is the kind of bug that survives a
   * hard-refresh spot check.
   */
  const [artReady, setArtReady] = useState(false)
  useEffect(() => {
    if (document.readyState === 'complete') { setArtReady(true); return }
    const on = () => setArtReady(true)
    window.addEventListener('load', on, { once: true })
    return () => window.removeEventListener('load', on)
  }, [])

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
  //
  // ⚠️ A FIFTH PAUSE CONDITION, AND IT IS A PERFORMANCE ONE: NOTHING MOVES UNTIL THE PAGE HAS
  // LOADED. This banner is the home page's LCP element, and the timer used to start on mount — so
  // on a mid-range phone the first advance landed while the page was still loading. Two things go
  // wrong at once, and Lighthouse against production showed both: Speed Index was 6.9s because
  // Speed Index scores how quickly the viewport stops CHANGING, and a carousel that swaps a
  // full-width raster every 5s never lets it settle (this is invisible to CLS, which was 0.001 —
  // nothing is moving, the pixels are simply being replaced). And LCP does not stop updating at
  // `load`: both external reviewers confirmed it runs until the first user interaction, so every
  // slide that paints before a tap is a fresh LCP candidate, each one later than the last.
  //
  // Waiting for `load` costs the visitor nothing — the first slide is the one they are reading —
  // and it lets the metric settle on the paint that actually matters. The owner's decision to keep
  // autoplay (2026-08-05, over both reviewers) is untouched: this changes when the timer starts,
  // never whether it runs.
  useEffect(() => {
    if (!api) return
    // Reduced motion is a hard opt-out, not a slower interval: the whole point is no unrequested
    // movement. Checked once here rather than per tick — a visitor who changes the OS setting
    // mid-session gets it on the next mount, which is a fair trade for not re-subscribing.
    const rm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (rm) return

    if (!artReady) return // `artReady` IS the "page has loaded" signal — see the effect that sets it.

    const id = setInterval(() => {
      // ⚠️ document.hidden is checked INSIDE the tick, not via a visibilitychange listener. A
      // background tab throttles timers but does not stop them, so without this the carousel
      // silently advances through every slide while nobody is looking and the visitor returns to a
      // position they never chose.
      if (paused.current || document.hidden) return
      api.scrollNext()
    }, 5000)
    return () => clearInterval(id)
  }, [api, artReady])

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
        {/* ⚠️ A SECOND WAY TO RELEASE THE ARTWORK, AND IT CLOSES THE ONE HOLE IN GATING ON `load`.
            Holding the off-screen rasters until load is safe against AUTOPLAY, because the same flag
            starts it — but it is not safe against a HAND. A visitor who swipes (or arrows, or tabs
            to a dot) in the second before load would land on a partner slide whose <img> had not
            been rendered yet: the panel keeps its height, so nothing jumps, but the artwork IS the
            slide, so they would arrive at an empty box. Capture-phase, so it runs before embla's own
            pointer handling begins the drag, which means the <img> is already in the DOM by the time
            the slide travels. onKeyDownCapture covers the arrows and the dots for keyboard users,
            who would otherwise be the only people who could still hit it. */}
        <Carousel
          opts={{ loop: true }}
          setApi={setApi}
          className="group/carousel"
          onMouseEnter={() => hold(true)}
          onMouseLeave={() => hold(false)}
          onFocus={() => hold(true)}
          onBlur={() => hold(false)}
          onPointerDownCapture={() => setArtReady(true)}
          onKeyDownCapture={() => setArtReady(true)}
        >
          {/* ⚠️ THE PRIMITIVE'S GUTTER IS CANCELLED HERE, ON BOTH HALVES TOGETHER. ui/carousel pairs
              a -ml-4 on the track with a pl-4 on every item, which is right for a multi-card shelf
              and wrong for one full-width panel: measured, it left the track starting 16px left of
              the clip box and the neighbouring slide showed as a dark strip down the banner's left
              edge. Cancel BOTH or neither — killing only one makes every slide a gutter-width too
              wide and clips the last one. */}
          <CarouselContent className="ml-0" viewportClassName="rounded-2xl">
            {SLIDES.map((slide, i) => {
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
                  aria-label={tr(`Slide ${i + 1} of ${SLIDES.length}`, `Trang ${i + 1} trên ${SLIDES.length}`)}
                >
                  {/* ⚠️ `artReady` HOLDS BACK THE OFF-SCREEN ARTWORK UNTIL THE PAGE HAS LOADED, and
                      it is a bandwidth fix rather than a bytes-total one. Measured on production:
                      the second slide's raster (gmbr-mobile.webp, 45 KB — the LARGEST image on the
                      home page) was being fetched at priority HIGH, ahead of listing thumbnails and
                      alongside the LCP element it sits behind. The markup was already correct —
                      `loading="lazy" fetchPriority="auto"` — so this is not a bug being fixed:
                      Chrome loads a lazy image once it is within the viewport's lazy threshold, and
                      an off-screen carousel slide sits well inside it, after which the in-viewport
                      priority boost promotes it. An attribute cannot argue with that; not rendering
                      the <img> can. It comes back on `load`, i.e. before the same gate lets autoplay
                      move anything, so no slide can ever be reached while its art is still absent. */}
                  <SlidePanel slide={slide} first={i === 0} artReady={i === 0 || artReady} />
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
            className="left-2 hidden text-white/80 opacity-0 transition-[opacity,color,scale] hover:text-white active:scale-[0.96] group-hover/carousel:opacity-100 focus-visible:opacity-100 pc:flex"
          />
          <CarouselNext
            variant="bare"
            className="right-2 hidden text-white/80 opacity-0 transition-[opacity,color,scale] hover:text-white active:scale-[0.96] group-hover/carousel:opacity-100 focus-visible:opacity-100 pc:flex"
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
            {SLIDES.map((slide, i) => (
              <Button
                key={slide.key}
                variant="bare"
                size="none"
                onClick={() => api?.scrollTo(i)}
                aria-label={tr(`Go to slide ${i + 1}`, `Đến trang ${i + 1}`)}
                aria-current={i === selected}
                className="pointer-events-auto flex h-6 min-w-6 items-center justify-center px-1"
              >
                {/* ⚠️ NOT `transition-all` — the property list is deliberate and load-bearing.
                    The active dot swaps `w-1.5` → `w-5`, so `transition-all` put `width` on the
                    transition list, and width cannot be composited: measured on production
                    2026-08-23 via CDP with Chrome's own compositing-failure bitmask, these dots
                    reported `compositeFailed=8224` (bit 1<<13, unsupportedCSSProperty) with
                    `unsupportedProperties=["width"]`. They were 2 of the 3 elements PageSpeed
                    flagged as non-composited animations on the mobile homepage — each one a
                    main-thread layout+paint tick every frame for 200ms on every slide change,
                    while the carousel itself is already animating.

                    Naming background-color explicitly keeps the colour fade (measured
                    `compositeFailed=0` on the same nodes) and lets the width snap instead. A 6px→20px
                    step on a 6px-tall dot reads as a state change, not a broken animation.

                    ⛔ DO NOT "fix" this back into a compositable animation with `transform: scaleX()`.
                    That requires every dot to occupy 20px of layout and scale the inactive ones down,
                    which widens every dot to 20px of layout and visibly changes the control. The
                    composited version costs more than the thing it saves.
                    (⚠️ The row is as long as `SLIDES`, which is edition-dependent: two on eno.vn
                    since the three generic slides were dropped 2026-08-17, see promo-slides.ts —
                    an earlier draft of this comment said "3×" and was wrong on the marketplace.) */}
                <span
                  aria-hidden
                  className={cn(
                    'block h-1.5 rounded-full transition-[background-color,opacity] duration-200',
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
 *
 * ⚠️ THE lg STEP IS 232px AND THAT NUMBER IS A MEASURED FLOOR, NOT A TASTE CHOICE — DO NOT LOWER IT.
 * It was 300px. The home-page wireframe asked for ~112px so the first grid row clears the fold at
 * 1080p (listings-explorer.tsx records the companion measurement: first product at y=983 on a 900px
 * viewport). 112px is NOT REACHABLE with the artwork the partner supplied, and the arithmetic is
 * worth keeping because the next person will be asked for it again.
 *
 * ⚠️ AND STATE THE RESULT HONESTLY: THIS DOES NOT, ON ITS OWN, CLEAR THE FOLD. 983 - 900 = 83px of
 * overshoot; 300→232 removes 68 of it and leaves the first grid row at y≈915, still ~15px under a
 * 900px viewport. It clears on a taller one (a 1080p screen with less browser chrome, ≥950px), and
 * the remaining ~15px had to come from the blocks BELOW this one or from a shorter partner cut —
 * not from this ladder, which is already at its floor. An earlier draft of this comment asserted
 * the fold was cleared; it was not, and three reviewers caught it.
 * ⚠️ THE TWO BLOCKS THAT SENTENCE NAMED ARE BOTH GONE (owner, 2026-08-12): the <WhyEno /> strip
 * was deleted and the two-row category tile grid became a one-line rail, which together took far
 * more than the 15px this was still looking for. The arithmetic above is kept as the record of how
 * this banner's own floor was derived; do not read it as a live shortfall.
 *
 * The binding case is the WIDEST panel: max-w-7xl caps at 1280px, so from a 1344px viewport up the
 * art slide paints /banners/vietkite-desktop.webp (1280x300) at scale 1.0 and `object-cover` crops
 * PURELY VERTICALLY, symmetric about the centre line. The visible source band is exactly
 * [150 - H/2, 150 + H/2]. Measured against the real file by cropping it at candidate heights:
 *   H=300 → band [0,300]   the native cut, nothing cropped
 *   H=232 → band [34,266]  ✅ everything survives: the VietKite lockup, "Travel & Visa /
 *                          VISA 24 GIỜ", the headline, the subline, the VIEW E-VISA OPTIONS
 *                          button and BOTH entry cards down to their "+ MORE OPTIONS" row.
 *                          Only the decorative landscape strip along the bottom is lost.
 *   H=224 → band [38,262]  ❌ already too tight: "Travel & Visa" loses its ascenders and the
 *                          "+ MORE OPTIONS" rows touch the bottom edge.
 *   H=216 → band [42,258]  ❌ the lockup is sliced through; the option rows clip.
 *   H=112 → band [94,206]  ❌ the lockup is GONE ENTIRELY and the CTA button is cut in half.
 * So 232 is the smallest height at which no partner content is lost, and it is symmetric by
 * coincidence: the topmost ink (the lockup, y≈34-38) and the bottommost (the entry cards, y≈262-266)
 * sit almost equidistant from the centre line, so nothing is bought by shifting object-position.
 *
 * ⚠️ 232 IS FLUSH, NOT COMFORTABLE — there is ~4px of margin at each edge and 224 already fails, so
 * do not shave "just a few more px". An external reviewer raised the flip side and it is worth
 * stating: a SECOND art slide added later would silently inherit this 34px top/bottom crop with no
 * failure signal, because 232 was measured against ONE file. Any new `art` slide has to be re-cropped
 * against this ladder before it ships.
 *
 * ⚠️ THE REST OF THE lg BAND WAS CHECKED TOO, because the crop FLIPS DIRECTION inside it and the
 * 1280 measurement above does not cover that. The flip happens where the box stops being wider than
 * the asset: W/232 < 4.267, i.e. W < 990px. The panel only reaches that at the very bottom of lg
 * (viewport 1024 → W=960, the narrowest lg panel), so the horizontal case spans roughly viewport
 * 1024-1054 and nothing else. Worst case, at W=960: cover scales by height (s = 232/300 = 0.773),
 * the asset paints 990px wide into a 960px box, so 30px of RENDERED width is lost = 15px per side =
 * ~19px per side in SOURCE pixels. The lockup begins near x=85, so it survives with ~66px to spare;
 * this is verified a fortiori by a much harsher test — cropping the source to its middle 1152px
 * (64px off EACH side, >3x the real loss) still leaves the lockup completely intact, taking only the
 * outer edge of the "UNLIMITED ENTRIES" ribbon. Quote the units when repeating this: rendered and
 * source pixels differ by the 0.773 scale and a reviewer mixed them up comparing 15 with 20.
 *
 * ⛔ SHIPPING 112px WOULD BE THE SAME DEFECT THIS FILE FIXED ONE COMMIT AGO. The "Advertisement ·
 * VietKite" chip was removed because covering a partner's lockup is not ours to do; cropping that
 * same lockup off the top of the frame destroys it just as completely, and more quietly. A 112px
 * banner needs a NEW PARTNER CUT — roughly 1280x112 (11.4:1) with the lockup, headline, CTA and
 * entry chips re-laid out for that band — which is a promo-slides.ts + public/banners change, not a
 * CSS one.
 *
 * The DOM slides are not what holds the floor up: measured at the 1280px panel their tallest
 * composition (1-line h2 at text-3xl + 2-line body + CTA + py-3) is ~182px, so 232 is real slack for
 * them and the cap actually applies rather than being silently overridden by content.
 *
 * ⚠️ min-h IS A FLOOR, SO "CAP" ONLY HOLDS WHILE THE CONTENT FITS — and because the carousel takes
 * the MAX across slides, one slide outgrowing 232 re-lengthens the banner for ALL of them. Two
 * things bound it, one solid and one not:
 *   SOLID — panel width does NOT change the body's line count. The <p> is `max-w-xl` (576px), which
 *   is narrower than the text column at every lg width (76% of a 960px panel is 687px, of a 1280px
 *   panel 930px), so it wraps to the same 2 lines at 1024 as at 1920. A reviewer argued the narrower
 *   1024 panel would force extra lines and grow the box; checked, and it does not.
 *   NOT SOLID — the headroom is only ~50px, and en/vi is NOT the whole language set. `tr(en, vi)`
 *   falls through to TR_OVERRIDES and then to machine translation (see language-context.tsx), so
 *   these slides render in every language the app offers, and a longer MT string is not bounded by
 *   the 92-char bodyVi or the ≤33-char titles this was measured against. At a 1024 viewport an MT
 *   title can take a 2nd line (687px column) and an MT body a 3rd, which together reach ~246px and
 *   breach 232.
 * ⚠️ THAT BREACH IS GRACEFUL, WHICH IS WHY 232 IS STILL THE RIGHT NUMBER: the banner simply
 * re-lengthens, so the cost is the fold win, NOT the artwork — a taller panel crops the partner cut
 * LESS, never more. So this degrades toward the old 300px behaviour rather than toward a defect. It
 * is a real reduction in slack though (300 left ~118px, 232 leaves ~50px), so re-measure when slide
 * copy changes rather than assuming the fit still holds.
 *
 * ⚠️ THIS LADDER IS MIRRORED IN src/app/(home)/loading.tsx (the instant skeleton reserves the same
 * min-h so the block does not resize when real content replaces it). THE TWO MUST MOVE TOGETHER —
 * a skeleton reserving 300 for a 232 banner is a 68px collapse, i.e. exactly the CLS bug this
 * component's min-h exists to prevent. That file is owned by another stream in this wave; if it
 * still reads lg:min-h-[300px], this cap has shipped a regression and that is the fix.
 */
function SlidePanel({ slide, first = false, artReady = true }: { slide: PromoSlide; first?: boolean; /** False while an off-screen slide's raster is still held back — see the call site. Defaults true so any other caller renders art as before. */ artReady?: boolean }) {
  const { tr } = useLanguage()
  const Icon = slide.icon

  /**
   * ⚠️ PARTNER ARTWORK PATH — a real <img>, not a CSS background, and that is a performance fix as
   * much as a rendering one. The decorative slides paint their art via `background-image`, which
   * the browser's preload scanner CANNOT see: it is discovered only after CSS parses and the
   * element lays out. Measured on the home page, the banner IS the LCP element (1816ms) while the
   * only preloaded image was the logo — so the LCP element was the one thing nobody told the
   * browser about. An <img> in the SSR markup is visible to the scanner immediately, and
   * fetchPriority="high" on the FIRST slide tells it this is the one that matters.
   * ⚠️ Only the first slide gets the hint. Marking all four "high" is the same as marking none.
   */
  if (slide.art) {
    /**
     * ⚠️ AN AD THAT DOES NOT SAY IT IS AN AD IS WHAT THIS LABEL EXISTS TO PREVENT, and this is the
     * only slide shape that needs it. The artwork replaces eno's own copy with a third party's paid
     * message, in the one position above the fold every visitor sees, and it is the FIRST slide by
     * owner decision — so it reads as editorial unless it says otherwise. The decorative slides
     * below are eno's own and get no chip; that difference is exactly why `partner` lives inside
     * `art` in promo-slides.ts, where the type makes it impossible to have one without the other.
     *
     * The wording is lifted verbatim from /regulations Article 14 — "Quảng cáo" / "Advertisement" —
     * where the operator has already published, in both languages, that a paid position is labelled
     * where it appears. Two different words for one concept is how a published commitment quietly
     * stops matching the product; if that Article is ever reworded, reword this with it.
     *
     * ⚠️ THE DISCLOSURE ALSO HAS TO REACH ASSISTIVE TECH, AND PAINTING IT IS NOT ENOUGH. The <a>
     * carries an explicit aria-label, which REPLACES its contents for the accessible name — so a
     * chip rendered inside it is invisible to a screen reader however prominent it looks. The word
     * is therefore prepended to that label as well: disclosure first, pitch second, in both
     * channels.
     *
     * ⚠️ BUT ONLY THE WORD GOES IN THE aria-label — THE PARTNER NAME MUST NOT BE PREPENDED THERE.
     * A reviewer caught this and it was measured: the label read "Advertisement · VietKite —
     * VietKite — Vietnam E-Visa, your way…", i.e. a screen reader said the partner twice, because
     * `alt` opens with the partner's own lockup. The attribution is already in `alt`, and
     * promo-slides.test.ts ASSERTS it is in both languages — that test is what makes dropping the
     * name here safe, so do not delete it and then "fix" this line back.
     *
     * The visible chip keeps the name, because a sighted visitor never receives `alt` — they get
     * the artwork, and the chip is the only text tying the word "Advertisement" to an advertiser.
     */
    /**
     * ⛔ THE WORD IS CONDITIONAL SINCE 2026-08-18, BECAUSE eno.forum'S BANNER IS NOT AN AD. The
     * visible chip is long gone (see the note further down), so this aria-label is the ONLY place
     * the disclosure still lives — which means an unconditional prefix would announce
     * "Advertisement — Vietnam e-Visa, made simple…" over eno's own service, to exactly the users
     * who cannot see the artwork and check. A false disclosure is a worse failure than a missing
     * one: it tells a screen-reader user this page is selling them someone else's product.
     *
     * `art.partner === null` is the explicit "this is ours" the type now forces every art slide to
     * declare, so the branch keys off a decision rather than off a falsy value.
     */
    const isAd = slide.art.partner !== null
    const adWord = tr('Advertisement', 'Quảng cáo')
    return (
      <Link
        href={slide.href}
        prefetch={false}
        aria-label={isAd ? `${adWord} — ${tr(slide.art.alt, slide.art.altVi)}` : tr(slide.art.alt, slide.art.altVi)}
        // ⚠️ THE SAME min-h LADDER AS THE DECORATIVE PANELS BELOW, and it is not cosmetic: the
        // carousel sizes its viewport to the tallest slide, so an art slide that computed its own
        // height from the image aspect made the panel change height between slides. Sharing the
        // ladder means every slide is exactly as tall as every other one.
        // ⚠️ THE TWO LADDERS MUST STAY CHARACTER-IDENTICAL. Because the carousel takes the MAX, a
        // ladder that drifts on one branch does not misalign that slide — it silently raises the
        // floor for ALL of them, and the cap below stops applying with nothing failing loudly.
        // ⚠️ THE HEIGHT IS NOW THE PRODUCT IMAGE'S HEIGHT (owner, 2026-08-12: "make banner the same
        // height as product image heights"), which is why it is an ASPECT RATIO and not the old
        // min-h ladder of 188/212/232.
        //
        // A listing card's image is `aspect-square w-full`, so its height IS one feed column:
        // (W − (N−1)·gap) / N, for the grid `grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4
        // lg:grid-cols-4`. That tracks the viewport continuously, so no fixed pixel ladder can
        // follow it — measured on the live page, the card was 179 / 229 / 228 / 292 px at
        // 390 / 768 / 1024 / 1440 while the banner sat at a flat 188 / 212 / 232.
        //
        // The banner spans the FULL container, so matching one column means an aspect ratio of
        // N·W/(W − (N−1)·gap): 2.04 at 2 columns, 3.14 at 3, 4.16 at 4. Those are constants while
        // the true ratio drifts a little across a breakpoint's range — measured worst case ~3px,
        // and it is EXACT above 1344px where max-w-7xl caps the container.
        // `min-h-[150px]` is a content floor, not a design value: it is what the heading, the
        // subline and the CTA need before they start colliding at the narrowest phone.
        /* ⛔ THE FOCUS RING IS AN `::after`, NOT THE GLOBAL OUTLINE, AND THIS CONTROL HAD NO
           VISIBLE RING AT ALL. The app-wide `:focus-visible` rule sits at `outline-offset: 2px`,
           i.e. entirely OUTSIDE the border box — and this slide is flush inside the carousel's
           `overflow-hidden` viewport, so 100% of the ring was clipped. Measured two ways: tabbing
           to it changed 0 pixels, and an 8px red probe outline painted 0 red pixels, while 63 of
           65 other tabbables on the page changed >=20px.
           ⛔ AN INSET OUTLINE (or an inset box-shadow) IS NOT THE FIX — it paints UNDER an
           absolutely-positioned child, and this slide's artwork is exactly that. `::after` with a
           z-index above the image is what actually shows.
           ⚠️ It is always in the DOM at `opacity-0` rather than created on focus, so the ring does
           not trigger a paint-time layout on the first Tab. */
        className="group relative block aspect-[2.04] min-h-[150px] sm:aspect-[3.14] lg:aspect-[4.16] overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[inherit] after:border-2 after:border-ring after:opacity-0 after:content-[''] focus-visible:outline-none focus-visible:after:opacity-100"
      >
        {/* ⚠️ CLS IS UNAFFECTED BY THE HOLD, AND THAT IS STRUCTURAL RATHER THAN LUCKY. The box above
            owns its height through `aspect-[…]` + `min-h`, and the <img> is `absolute inset-0` — it
            fills the box, it never defines it. So the panel is exactly as tall with the art missing
            as with it present, which is the same reason this component already measured CLS 0 while
            the bytes were in flight. Rendering nothing here for a moment is a no-op on layout. */}
        {artReady && <picture>
          {/* ⚠️ THE SWITCH IS AT lg (1024), NOT sm. The two cuts are 4.27:1 (desktop) and 1.95:1
              (mobile). Serving the wide cut from 640px put a 4.27:1 image into a ~2.8:1 box, which
              `object-cover` then had to crop by a third — taking the lockup off the left and the
              entry chips off the right. The mobile cut is the safer of the two below lg.
              ⚠️ "SAFER" IS NOT "SAFE", AND THIS IS A KNOWN OPEN DEFECT — MEASURED, NOT SUSPECTED.
              A fixed min-height cannot serve a fixed-aspect image across a FLUID width range: the
              box ratio is W/H, so the wider the viewport the more vertical crop the same height
              buys. The mobile cut only fits where the panel is ~1.95:1, which is true at exactly
              one place on the ladder — a 390px phone, where 366/188 = 1.947 and nothing is lost.
              Everywhere else below lg it already loses partner content, at TODAY's heights:
                640px viewport → panel 592x212 → visible source band [57,319] of 376: the VietKite
                                 mark is decapitated and "Travel & Visa" is gone entirely.
                1023px         → panel 975x212 → band [108,267]: the lockup AND both entry cards
                                 are gone; only the headline and half the CTA survive.
              This predates the 300→232 cap below and is untouched by it — the cap only moves the lg
              step, and lg is the one range that was already correct. It is NOT fixable by nudging
              these numbers: dropping the wide cut to md trades the crop for illegibility (a 1280px
              asset painted into a 720px box shrinks the partner's 18px type to ~11px, which is why
              they supplied a separate mobile cut at all), and making the art slide aspect-ratio'd
              instead of min-h'd breaks the shared-ladder invariant documented above. The real fix
              is a third cut sized for the 600-1023 band, i.e. a promo-slides.ts change. */}
          {/* ⛔ AVIF FIRST, AND ORDER IS THE WHOLE MECHANISM — a browser takes the FIRST <source>
              it can decode, so these must precede the WebP ones or they are dead markup. Measured
              2026-08-14: the desktop cut falls 70,222 -> 31,913 B and the mobile 32,324 -> 18,018 B
              at q50, on the element the home page picks as its LCP.
              ⚠️ THE PAIR IS ALL-OR-NOTHING BY TYPE (promo-slides.ts), and these two lines are why:
              the mobile source carries NO `media` — it is the catch-all, mirroring the <img>
              fallback below — so a desktop-cut-less pair would serve a desktop browser the 732px
              mobile art. `slide.art.avif &&` guards both together; never split it back into two
              independent checks. A slide with no AVIF at all skips both and serves the WebP. */}
          {slide.art.avif && (
            <>
              <source media="(min-width: 1024px)" type="image/avif" srcSet={slide.art.avif.desktop} width={1280} height={300} />
              <source type="image/avif" srcSet={slide.art.avif.mobile} width={732} height={376} />
            </>
          )}
          <source media="(min-width: 1024px)" srcSet={slide.art.desktop} width={1280} height={300} />
          {/* A plain <img>, deliberately: next/image defers discovery behind its own runtime and
              this element is the LCP, so what the preload scanner can act on at parse time is
              exactly the point. (No eslint-disable needed — no-img-element does not fire inside
              a <picture>; the directive that sat here was reported unused.) */}
          <img
            src={slide.art.mobile}
            alt={tr(slide.art.alt, slide.art.altVi)}
            // ⚠️ 732x376 — the mobile cut is a 2x asset. The RATIO is what reserves the box and it
            // is unchanged (1.947:1), so CLS is unaffected; these just describe the real file.
            width={732}
            height={376}
            // ⚠️ FILL THE PANEL — owner, 2026-08-10 ("height adjust to fit all into banner, cut
            // from sides"). `h-auto` let the artwork dictate the height, which left a short slide
            // sitting in a taller viewport. Now the panel owns the height and the image covers it.
            // ⚠️ WHICH EDGES THE CROP TAKES FROM IS NOT A CHOICE, IT IS W/H vs THE ASSET RATIO, and
            // an earlier version of this comment claimed the loss is always left/right. It is not,
            // and believing that is how the lockup gets cropped off without anyone noticing:
            //   box ratio  <  asset ratio → the asset is the wider one → crop is LEFT/RIGHT
            //   box ratio  >  asset ratio → the box is the wider one   → crop is TOP/BOTTOM
            // Both happen here. At lg the panel runs 960x232 (4.14:1, narrower than the desktop
            // cut's 4.27 → ~20px off each side) up to 1280x232 (5.52:1, wider → 34px off the top
            // and bottom). Below lg the panel is wider than the mobile cut everywhere except a
            // 390px phone, so the loss there is top/bottom too — see the <source> note above.
            // object-center is right for BOTH directions on this artwork: the message is centred
            // horizontally between the lockup and the entry cards, and vertically between them and
            // the decorative landscape. Shifting object-position buys nothing (measured) and would
            // help one breakpoint by hurting another.
            // Absolute + inset-0 so the image fills the min-h box rather than defining it — that
            // is what keeps the height stable and CLS at 0 while the bytes are still arriving.
            className="absolute inset-0 h-full w-full object-cover object-center"
            fetchPriority={first ? 'high' : 'auto'}
            loading={first ? 'eager' : 'lazy'}
            decoding={first ? 'sync' : 'async'}
          />
        </picture>}
        {/* ⛔ NO VISIBLE "Advertisement" CHIP — REMOVED BY THE OWNER, 2026-08-11, AND NOT AN OVERSIGHT.
            A pill reading "Quảng cáo · <partner>" was rendered over this artwork and taken out on the
            owner's instruction. Whether a paid placement is labelled on its face is a commercial and
            compliance decision that belongs to them, not a styling one, so do not "restore" it as a
            polish item.
            ⚠️ THE ATTRIBUTION SURVIVES WHERE IT COSTS NOTHING: the link's accessible name still opens
            with that word (see the aria-label above), so a screen-reader user is still told this is an
            ad before they are told what it says — but ONLY when there is an advertiser (see `isAd`
            above; eno.forum's own e-visa banner is `partner: null` and is not announced as an ad).
            And `art.partner` stays REQUIRED at the type level, now as `string | null`, with its
            vitest — the point of that guard was never the chip, it was that a slide which deletes
            both languages must still state who bought it, or state that nobody did. */}
      </Link>
    )
  }

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
        // ⚠️ THE lg STEP WAS 300px AND IS NOW 232px, CAPPED SO THE FIRST GRID ROW CLEARS THE FOLD
        // AT 1080p. It is NOT a free aesthetic knob in either direction: the number is set by what
        // the partner artwork on the sibling branch can lose without losing its lockup (the crop
        // arithmetic is in the SlidePanel doc comment), and the carousel takes the MAX of the two
        // branches, so raising it here re-lengthens the banner for every slide including that one.
        // The older note this replaces read "a 1400px-wide panel only 248px tall reads as a strip,
        // not a banner" — that judgement still stands on its own terms and was overridden
        // deliberately, because a banner nobody scrolls past is worth more than a taller one.
        // Padding halved (owner, 2026-08-05): px-5/py-6/sm:px-7/lg:px-14 -> px-3/py-3/sm:px-4/lg:px-7.
        // ⚠️ This tightens the INSET, not the height. The panel is sized by min-h + justify-center,
        // so the vertical padding is slack the min-height already absorbs — halving py alone moves
        // nothing until the content outgrows the panel. Shortening the banner therefore means
        // lowering the min-h values below — which has now been done at the lg step (300 -> 232),
        // and the py-3 above is still slack rather than the thing that sets the height.
        // ⛔ NO `.press` HERE, AND THE REASON IS THE GESTURE, NOT THE SIZE.
        // A design review flagged this panel as the largest tap target on the home page with no
        // press feedback, and adding `.press` looked obviously right. It is not: this panel is a
        // SWIPE surface (see the carousel note below — "on touch the swipe is the gesture").
        // `:active` latches on pointer-down and holds for the whole drag, so a 0.96 scale would
        // shrink the panel under the finger for the length of every swipe — ~7px of edge travel
        // at a 366px-wide panel, ~26px at the 1280px lg one. (That travel is set by the panel's
        // WIDTH, not by the min-h ladder, so capping the lg height to 232 did not shrink it.)
        // Press feedback is sized for a tap; on a
        // drag surface it reads as the page flinching. A reviewer caught this after it shipped in
        // an earlier revision of this line.
        // If this ever needs tap feedback, it has to be gated on a real tap (pointerup without
        // movement), not on `:active`.
        'relative flex aspect-[2.04] min-h-[150px] sm:aspect-[3.14] lg:aspect-[4.16] flex-col justify-center overflow-hidden px-3 py-3 text-white sm:px-4 lg:px-7 pc:px-14',
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
      {/* The motif is composed, not scattered (wow pass, 2026-08-06). On a phone bg-cover crops
          the SVG's right-anchored geometry out of the 1200×400 frame, so the slide's own icon
          carries the corner instead: ONE oversized glyph, tucked and tilted with intent, cropped
          by the panel edge. From sm up the artwork's geometry is back in frame and the glyph
          BOWS OUT (sm:hidden) — two translucent motifs stacked at the same corner is exactly the
          muddy, generic read this replaced. The old blurred CSS circle is gone for the same
          reason: every SVG already paints that radial highlight; the CSS copy doubled it. */}
      {/* Display tier (icon-language §2): a 24-grid line scales with the box, so the
          default stroke 2 renders ~12px of ink at size-36 — rubber-stamp weight. 1.5
          keeps the oversized watermark elegant, matching the category-tile line. */}
      <Icon aria-hidden strokeWidth={STROKE_DISPLAY} className="pointer-events-none absolute -bottom-8 -right-4 size-36 -rotate-6 text-white/10 sm:hidden" />

      <div className="relative max-w-[86%] sm:max-w-[76%]">
        {/* ⚠️ NO EYEBROW. The kicker that sat here ("FREE TO POST", …) is the labelled-heading
            scaffold the craft canon bans outright — the headline carries the slide on its own,
            one step larger for it. Don't re-add a label above this h2; promo-slides.ts still
            holds the eyebrow copy solely so restoring data needs no migration, not as an
            invitation to render it. */}
        {/* h2, NOT h3. This panel sits directly under the page's (sr-only) h1, so an h3 here skipped
            a level and broke the document outline — a screen reader jumped h1 → h3 with nothing
            between. It also contradicted the outline listings-explorer.tsx documents for this page:
            h1 → section h2 → card h3s. Keep it h2 so the card titles below stay the h3 tier. */}
        <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-balance sm:text-3xl">
          {tr(slide.titleEn, slide.titleVi)}
        </h2>
        {/* Clamped rather than hidden on phones. It was `hidden sm:block` in the first draft, which
            left the panel visibly empty at 390px — and this is the line that actually sells. Two
            lines is the budget: Vietnamese runs longer than English in 42% of this app's strings
            (measured over 816 tr() pairs), so the clamp is what stops a long translation from
            growing the panel and shoving the category scroller down the page.
            max-w-xl keeps the desktop measure near the 65–75ch floor — inside a 1200px panel an
            unbounded line ran the full 76% and read as a caption, not a subline. */}
        <p className="mt-2 max-w-xl line-clamp-2 text-sm leading-relaxed text-white/85 sm:line-clamp-none sm:text-base">
          {tr(slide.bodyEn, slide.bodyVi)}
        </p>
        {/* Not a nested <button> — the whole panel is the link, so this is a styled span that only
            LOOKS like the CTA. A real <Button> inside an <a> is invalid HTML and swallows the tap
            target it sits on. `.press` still works on a span: tapping the CTA area puts it in the
            :active chain, so the one control that looks pressable also feels pressable. */}
        {/* `shadow-onmedia`, not Tailwind's `shadow-sm` (2026-08-09). This is the home page's
            primary CTA and it was the ONE element on the page wearing a foreign shadow token.
            ⚠️ It is NOT `shadow-pop`, which was the first replacement and was wrong: pop is 8%
            ink at 30px blur, authored for popovers on the near-white canvas, and it all but
            disappears against the hero's blue slide artwork. This button is white chrome on
            media — the case `--shadow-onmedia` exists for. */}
        <span className="press mt-4 inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-bold text-brand shadow-onmedia sm:mt-6">
          {tr(slide.ctaEn, slide.ctaVi)}
        </span>
      </div>
    </Link>
  )
}
