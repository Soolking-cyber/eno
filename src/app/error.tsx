'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'

// Segment error boundary: catches any uncaught render/runtime throw in a page and
// shows a branded recovery card instead of an unstyled 500. Rendered inside the
// root layout (providers available), so i18n works here.
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
    <div className="flex min-h-screen flex-col items-center justify-center blob-bg px-4 py-16 text-center">
      <div className="w-full max-w-md rounded-2xl bg-popover p-8 shadow-pop">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-brand">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <h1 className="mt-5 text-xl font-bold text-foreground">{tr('Something went wrong', 'Đã xảy ra lỗi')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-body">
          {tr('We hit a snag loading this page. Try again, or head back home.', 'Đã có sự cố khi tải trang này. Hãy thử lại hoặc quay về trang chủ.')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="cta" size="none" onClick={reset} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm transition-colors">
            <RotateCw className="h-4 w-4" /> {tr('Try again', 'Thử lại')}
          </Button>
          {/* gap-1.5 + font-semibold ride on the BUTTON: asChild composes via Base UI's
              render prop, which CONCATENATES classNames — only the Button's own className
              is twMerged, so on the child they'd lose to the base gap-2 / font-medium. */}
          <Button asChild variant="ghost" size="none" className="gap-1.5 font-semibold">
            <Link href="/" className="inline-flex cursor-pointer items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Home className="h-4 w-4" /> {tr('Go home', 'Về trang chủ')}
            </Link>
          </Button>
        </div>
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
      </div>
    </div>
  )
}
