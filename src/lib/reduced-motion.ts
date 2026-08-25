/**
 * Reduced-motion, for movement CSS cannot reach.
 *
 * ⛔ WHY THIS EXISTS: `scroll-behavior: auto !important` IN THE REDUCED-MOTION BLOCK DOES NOT STOP
 * A JS SMOOTH SCROLL. The CSSOM spec is explicit — an explicit `behavior: 'smooth'` in a
 * `scrollTo`/`scrollIntoView`/`scrollBy` options bag WINS over the `scroll-behavior` property;
 * only `behavior: 'auto'` defers to CSS. So globals.css looks like it covers this and covers
 * nothing: 20 call sites animated the viewport for a user who had explicitly asked not to be moved,
 * and the kill switch sat right there in the stylesheet reading as if it were doing the job.
 *
 * A programmatic scroll is the purest case of what the preference is for — movement the user did
 * not initiate, at a speed they did not choose. The destination is never in question here, only
 * whether the trip is animated, so honouring it costs nothing.
 *
 * ⚠️ READ AT CALL TIME, NEVER CACHED AT MODULE LOAD. The setting is toggled from the OS while the
 * tab is open (that is how anyone actually uses it), and a value captured at import would pin the
 * whole session to whatever was true when the bundle evaluated.
 */
export function prefersReducedMotion(): boolean {
  // `matchMedia` is missing in SSR and optional in jsdom, so this must degrade rather than throw.
  // Defaulting to `false` there is right: server-rendered HTML never scrolls, and the first real
  // call happens in a handler or an effect, where the window exists.
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * The `behavior` for any programmatic scroll. Use this instead of a literal `'smooth'`:
 *
 *   el.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
 *
 * `scripts/design-lint.mjs` fails the build on a literal `behavior: 'smooth'` outside this file,
 * because the whole failure mode is that the bypass is invisible — the stylesheet says the
 * preference is handled, so nobody looks at the call site.
 */
export function scrollBehavior(): ScrollBehavior {
  /**
   * ⚠️ `'instant'`, NOT `'auto'` — and two reviewers had to point this out. `'auto'` does not mean
   * "jump"; it means "defer to the element's computed `scroll-behavior`". Today that resolves to
   * instant only because the reduced-motion block in globals.css is universal (`*, *::before,
   * *::after`) — narrow that selector to `html`, or let one scroll container carry `scroll-smooth`,
   * and every one of these calls quietly animates again for the exact user who asked it not to.
   * `'instant'` says what is meant and depends on nothing outside this function.
   */
  return prefersReducedMotion() ? 'instant' : 'smooth'
}
