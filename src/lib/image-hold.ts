/**
 * ⛔ OFF-SCREEN CARD PHOTOS WAIT FOR THE PAGE'S SCRIPTS, ON A PHONE (speed audit, 2026-11-02). `loading="lazy"` defers nothing here: Chrome's lazy
 * range is 1,250 px and more, so a phone fetched ~20 off-screen photos (~240 KB) alongside the JavaScript. Measured on a mid phone (1.6 Mbps, 4x CPU),
 * Vietnamese, production build: the time to a tappable page fell from 7.3 to 6.3 s on /c/rentals and from 7.5 to ~6.5 s on /c/teachers, with first
 * paint and LCP unchanged; /vi holds too few to matter. Code ran for little of those seconds: the wait is the network.
 *
 * ⚠️ WHY A STYLESHEET RULE AND NOT A WITHHELD `src`: a browser does not fetch a lazy image that has no box, while the HTML keeps `src`,
 * `srcset` and `alt`, so a crawler that never hydrates still finds every photo. No script, no attribute, no hold: a visitor without
 * JavaScript gets today's page. The boxes are `fill` images in a sized frame, so nothing moves when they appear.
 * ⚠️ RELEASED AT `load`, NOT AT HYDRATION: every script of the page has arrived by then, so the photos compete with nothing, and a reader who
 * scrolls right after hydration does not wait for them from zero (released at hydration: ~2 s, against ~0.1 s for today's page). `scroll` releases it
 * sooner, in any scroller (capture: a rail's own scroll does not bubble). The timer covers a `load` that never comes.
 * ⛔ OPT-IN, FROM THE SEVENTH CARD OF A MAIN GRID, NEVER "EVERY LAZY PHOTO". The home grid's card 2 is lazy AND on the first screen (top 390 px at
 * 390x844), so holding every lazy photo left it blank until hydration: a reviewer's catch, measured. A rail or a shelf can sit anywhere on a page:
 * never held. Six cards are three rows at two columns (`HELD_FROM_CARD`): the first held frame starts at 1,148 px or lower on /c/rentals, /c/teachers,
 * /vi and /?category=rentals, from 320x568 to 600x960.
 * ⛔ NEVER ON A RELOAD OR A BACK/FORWARD (2026-11-03): those photos come from the browser's cache, so they compete with nothing, and a reader restored to the middle
 * of the page got grey boxes first, photos popping in after them.
 * ⚠️ ONLY ON A SCREEN THAT CANNOT REACH IT (globals.css): under `sm`, where LISTING_GRID has two columns, and no taller than 1,100 px, so an iPad's
 * Slide Over or a tall narrow window keeps today's page.
 */
export const HELD_FROM_CARD = 6
export const IMAGE_HOLD_TIMEOUT_MS = 10_000
/** On <html>, from the first byte of the document until `load`, the first scroll or the timer. */
export const IMAGES_HELD_ATTR = 'data-images-held'
/** On the first photo of a grid card from HELD_FROM_CARD on. */
export const HELD_PHOTO_ATTR = 'data-held-photo'

/** The head script: its own try, so a throw means no hold, which is today's page. Whatever ends the hold takes the other two with it. */
export const IMAGE_HOLD_JS = `(function(){try{var n=performance.getEntriesByType('navigation')[0];if(n&&n.type!=='navigate')return;var d=document.documentElement,o={capture:true,passive:true},t;var off=function(){d.removeAttribute('${IMAGES_HELD_ATTR}');clearTimeout(t);window.removeEventListener('scroll',off,o);window.removeEventListener('load',off)};d.setAttribute('${IMAGES_HELD_ATTR}','');window.addEventListener('scroll',off,o);window.addEventListener('load',off);t=setTimeout(off,${IMAGE_HOLD_TIMEOUT_MS})}catch(e){}})()`
