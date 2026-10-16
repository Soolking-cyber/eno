import { navigationStarted, type NavigationType } from '@/lib/nav-progress'
import { rumNavStart, startRum } from '@/lib/rum/early'
import { loadViOverrides } from '@/lib/i18n/mt-client'

/**
 * Client instrumentation — Next's `instrumentation-client` file convention: it runs before hydration on
 * every page of both editions, and it is in every page's first JavaScript, so it stays TINY.
 *
 * It carries one hook: the start of an App Router navigation, which the app-wide progress bar listens for
 * (FAST-2 — src/lib/nav-progress.ts says why this hook and not a click listener). Next isolates a hook that
 * throws, so a failure here can never break a navigation.
 *
 * And the page-speed totals (speed plan item 5, src/lib/rum/early.ts): started here, before hydration, so a visitor
 * who leaves before the page is usable is still measured; the same hook times soft navigations. And, on a Vietnamese
 * document, the dictionary download (item 7, below). mt-client is already in every page's first JavaScript (tr() is).
 */
startRum()

/**
 * ⛔ A VIETNAMESE DOCUMENT STARTS ITS DICTIONARY NOW (speed plan item 7). LanguageProvider's gate (ViDictGate, `use()`)
 * holds hydration until the lazily-imported VI_OVERRIDES chunk (171 KB raw / 53 KB gz) has landed — and until now the
 * gate was also what ASKED for it, so the request only left once the ~50 first-load chunks had run: a queue behind
 * them, measured as the +1.2 s /vi hydrates after /. Asked here, it downloads beside those chunks instead. The loader
 * memoizes its promise, so the gate later gets this same request, never a second one; a failure here is the gate's
 * failure (it renders without the dictionary — mt-client.ts viDictForHydration), so nothing new can break.
 * `<html lang>` is server-rendered, so it already says `vi` for exactly the documents whose HTML is Vietnamese.
 */
try {
  if (typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('vi')) {
    // Swallowed on purpose: the gate reports a failed chunk itself (viDictForHydration) when it asks.
    loadViOverrides().catch(() => {})
  }
} catch { /* the gate will ask on its own */ }

export function onRouterTransitionStart(url: string, navigationType: NavigationType): void {
  navigationStarted(navigationType)
  rumNavStart(url, navigationType)
}
