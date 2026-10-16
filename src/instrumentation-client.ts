import { navigationStarted, type NavigationType } from '@/lib/nav-progress'
import { rumNavStart, startRum } from '@/lib/rum/early'

/**
 * Client instrumentation — Next's `instrumentation-client` file convention: it runs before hydration on
 * every page of both editions, and it is in every page's first JavaScript, so it stays TINY.
 *
 * It carries one hook: the start of an App Router navigation, which the app-wide progress bar listens for
 * (FAST-2 — src/lib/nav-progress.ts says why this hook and not a click listener). Next isolates a hook that
 * throws, so a failure here can never break a navigation.
 *
 * And the page-speed totals (speed plan item 5, src/lib/rum/early.ts): started here, before hydration, so a visitor
 * who leaves before the page is usable is still measured; the same hook times soft navigations.
 */
startRum()

export function onRouterTransitionStart(url: string, navigationType: NavigationType): void {
  navigationStarted(navigationType)
  rumNavStart(url, navigationType)
}
