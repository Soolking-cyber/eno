/* eslint-disable react/jsx-no-literals -- error boundary renders OUTSIDE providers (no language context); deliberately bilingual EN·VI */
'use client'

import { useEffect } from 'react'

// Root error boundary: replaces the WHOLE document (layout + providers) when the
// root layout itself throws, so it must be fully self-contained — no context,
// no shared components, inline styles only. Text is bilingual inline.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Root error:', error) }, [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: '#fafafa', color: '#1a202c' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ maxWidth: 420, background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong · Đã xảy ra lỗi</h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#475569', margin: '0 0 20px' }}>
              Please try again. · Vui lòng thử lại.
            </p>
            <button
              onClick={() => reset()}
              style={{ background: '#0a66c2', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Try again · Thử lại
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
