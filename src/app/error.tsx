'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

// Segment error boundary: catches any uncaught render/runtime throw in a page and
// shows a branded recovery card instead of an unstyled 500. Rendered inside the
// root layout (providers available), so i18n works here.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { tr } = useLanguage()
  useEffect(() => {
    // Surfaces in Vercel runtime logs for triage.
    console.error('Route error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center blob-bg px-4 py-16 text-center">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-pop">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-brand">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <h1 className="mt-5 text-xl font-bold text-foreground">{tr('Something went wrong', 'Đã xảy ra lỗi')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-body">
          {tr('We hit a snag loading this page. Try again, or head back home.', 'Đã có sự cố khi tải trang này. Hãy thử lại hoặc quay về trang chủ.')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
            <RotateCw className="h-4 w-4" /> {tr('Try again', 'Thử lại')}
          </button>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
            <Home className="h-4 w-4" /> {tr('Go home', 'Về trang chủ')}
          </Link>
        </div>
      </div>
    </div>
  )
}
