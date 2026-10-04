import { navigationStarted, type NavigationType } from '@/lib/nav-progress'

/**
 * Client instrumentation — Next's `instrumentation-client` file convention: it runs before hydration on
 * every page of both editions, and it is in every page's first JavaScript, so it stays TINY.
 *
 * It carries one hook: the start of an App Router navigation, which the app-wide progress bar listens for
 * (FAST-2 — src/lib/nav-progress.ts says why this hook and not a click listener). Next isolates a hook that
 * throws, so a failure here can never break a navigation.
 */
export function onRouterTransitionStart(_url: string, navigationType: NavigationType): void {
  navigationStarted(navigationType)
}
