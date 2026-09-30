'use client'

import { Component, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, Home } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

/**
 * ⚠️ THE CHROME CANNOT BE WHAT TAKES THE ERROR PAGE DOWN. Header and Footer are big client trees
 * (auth, search, notifications), and this boundary is what renders when SOMETHING threw — if that
 * something was in the header, rendering it again here would throw again, and the next boundary up is
 * global-error: no stylesheet, no chrome, no language. So each piece of chrome gets its own tiny
 * boundary that renders NOTHING on a throw, and the recovery card below always paints.
 */
class ChromeGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

// Segment error boundary: catches any uncaught render/runtime throw in a page and shows the recovery
// state instead of an unstyled 500. Rendered inside the root layout (providers available), so i18n
// works here.
//
// ⚠️ A FLAT PAGE WITH ITS CHROME, NOT A FLOATING CARD (D-STATES, 2026-09-29). It was a `blob-bg` field
// with a `bg-popover shadow-pop` card and no header or footer — the pre-flat look, and a dead end: the
// only ways out were the two buttons. The 404 has rendered Header and Footer all along; an error is
// the same moment (the page you wanted is not here) and now looks like it. The body is the shared
// EmptyState on its FAULT coin (neutral disc, destructive ink — icon-language §6: the product let the
// reader down, so no mascot and not the brand's warm "nothing here yet" disc), with the title as the
// page's h1.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { tr } = useLanguage()
  useEffect(() => {
    /**
     * ⚠️ THIS REACHES THE USER'S BROWSER CONSOLE AND NOWHERE ELSE — the comment here used to say
     * "Surfaces in Vercel runtime logs for triage", which was false in two ways: the app has not
     * run on Vercel since 2026-07, and this is a CLIENT component, so its output was never going to
     * a server log on any platform. Nobody was being told about these.
     *
     * What IS reported: the server-side throw that produced this boundary is captured by
     * `src/instrumentation.ts`'s `onRequestError` and reaches Cloud Logging with the route and
     * request context. So a failure during render is visible; what stays invisible is an error
     * thrown purely in the browser after hydration.
     *
     * Closing that half needs an endpoint to POST to — an unauthenticated write surface with its
     * own rate-limit and payload questions — so it is a deliberate open item rather than an
     * oversight. `error.digest` is the id that ties this screen to the server log entry, which is
     * why it is shown to the user below.
     */
    console.error('Route error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col">
      <ChromeGuard>
        <Header />
      </ChromeGuard>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-3 py-16 sm:px-6 lg:px-8">
        <EmptyState
          variant="fault"
          size="lg"
          titleAs="h1"
          // The page frame owns the vertical rhythm; the primitive's own py-14 would double it.
          className="py-0"
          icon={AlertTriangle}
          title={tr('Something went wrong', 'Đã xảy ra lỗi')}
          subtitle={tr('We hit a snag loading this page. Try again, or head back home.', 'Đã có sự cố khi tải trang này. Hãy thử lại hoặc quay về trang chủ.')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="cta" onClick={reset}>
                <RotateCw className="h-4 w-4" /> {tr('Try again', 'Thử lại')}
              </Button>
              <Button asChild variant="outline">
                <Link href="/">
                  <Home className="h-4 w-4" /> {tr('Go home', 'Về trang chủ')}
                </Link>
              </Button>
            </div>
          }
        />
        {/* The one string that makes a support message actionable: `digest` is Next's id for the
            server-side throw, and the SAME id appears on the Cloud Logging entry that
            src/instrumentation.ts wrote. Without it a report is "a page broke"; with it the exact
            stack is one query away. Rendered small and muted — it is for the rare person who reads
            it, not part of the apology. */}
        {error.digest ? (
          <p className="mt-5 text-2xs text-body/70">
            {tr('Reference', 'Mã tham chiếu')}
            {': '}
            <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </main>
      <ChromeGuard>
        <Footer />
      </ChromeGuard>
    </div>
  )
}
