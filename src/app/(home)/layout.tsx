import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

/**
 * The home route's frame — page chrome that is IDENTICAL whether the feed has loaded or not.
 *
 * ⚠️ THIS EXISTS FOR A PERFORMANCE REASON, NOT A TIDINESS ONE. `loading.tsx` is the fallback for
 * this route's Suspense boundary, and everything inside that boundary is streamed TWICE: once as
 * the skeleton and again as the real page, both in the same document. Because page.tsx and
 * loading.tsx each rendered their own <Header/> and <Footer/>, the prerendered homepage shipped
 * two complete headers and two complete footers — 183 duplicate elements and ~20 KB of markup
 * that exists only to be thrown away, plus a second element carrying `id="app-header"`, which is
 * invalid and which several selectors resolve by id.
 *
 * Hoisting the chrome ABOVE the boundary means it is sent once, painted immediately, and never
 * replaced — which is also the better experience: the header and footer no longer flicker through
 * a swap when the feed arrives.
 *
 * ⚠️ `<main>` LIVES HERE TOO, and its classes must stay byte-identical to what page.tsx and
 * loading.tsx used (`flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4`) — that is the
 * canonical page frame (docs/design-language.md §4), and the facet bar's `-mx-3` is coupled to
 * the `px-3` in it. Changing either without the other reopens a bug that has been fixed twice.
 * `id="main"` is the skip-link target and `tabIndex={-1}` is what lets it receive focus.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        {children}
      </main>
      <Footer />
    </div>
  )
}
