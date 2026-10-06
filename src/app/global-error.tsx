/* Renders OUTSIDE every provider (no language context): its copy is the static table below, never tr(). */
'use client'

import { useEffect, useState, useTransition } from 'react'

/**
 * The three strings this page has, written out for every supported language.
 *
 * ⚠️ A STATIC TABLE, NOT tr(). This boundary replaces the WHOLE document when the root layout throws, so
 * the language provider, the machine-translation layer and every shared component are gone with it —
 * the only thing left to read is the visitor's stored choice. Three short sentences do not justify a
 * fetch from a page that exists because something already failed.
 * ⚠️ THE FIRST RENDER IS THE BILINGUAL EN · VI LINE IT ALWAYS WAS: the server (and hydration) cannot know
 * the visitor's language, so the switch happens after mount, and only for the nine other languages —
 * an English or Vietnamese reader sees exactly what they saw before.
 */
const COPY: Record<string, [title: string, body: string, retry: string]> = {
  'zh-Hans': ['出错了', '请重试。', '重试'],
  ko: ['문제가 발생했습니다', '다시 시도해 주세요.', '다시 시도'],
  ja: ['エラーが発生しました', 'もう一度お試しください。', '再試行'],
  ru: ['Что-то пошло не так', 'Пожалуйста, попробуйте ещё раз.', 'Попробовать снова'],
  km: ['មានបញ្ហាកើតឡើង', 'សូមព្យាយាមម្តងទៀត។', 'ព្យាយាមម្តងទៀត'],
  ms: ['Ralat telah berlaku', 'Sila cuba lagi.', 'Cuba lagi'],
  th: ['เกิดข้อผิดพลาด', 'โปรดลองอีกครั้ง', 'ลองอีกครั้ง'],
  fr: ['Une erreur s’est produite', 'Veuillez réessayer.', 'Réessayer'],
  hi: ['कुछ गलत हो गया', 'कृपया फिर से प्रयास करें।', 'फिर से प्रयास करें'],
}
const BILINGUAL: [string, string, string] = ['Something went wrong · Đã xảy ra lỗi', 'Please try again. · Vui lòng thử lại.', 'Try again · Thử lại']

/** The stored choice (localStorage, then the `lang` cookie) — the same two places the provider reads. A
 *  value that is not a site language ("bogus", a stale code) is skipped, so a valid cookie behind it
 *  still counts; en and vi are site languages that keep the bilingual line. */
const SITE_LANG = (v: string | null | undefined): string | null =>
  v && (v === 'en' || v === 'vi' || Object.prototype.hasOwnProperty.call(COPY, v)) ? v : null
function storedLang(): string | null {
  try { const v = SITE_LANG(localStorage.getItem('lang')); if (v) return v } catch { /* storage blocked */ }
  try {
    const m = document.cookie.match(/(?:^|; )lang=([^;]*)/)
    return SITE_LANG(m ? decodeURIComponent(m[1]) : null)
  } catch { return null } // a malformed cookie must not throw inside the last-resort error page
}
/** Own keys only — a stored "constructor" must not resolve to Object.prototype's function. */
const copyFor = (lang: string | null) => (lang && Object.prototype.hasOwnProperty.call(COPY, lang) ? COPY[lang] : null)

// Root error boundary: replaces the WHOLE document (layout + providers) when the
// root layout itself throws, so it must be fully self-contained — no context,
// no shared components, inline styles only.
export default function GlobalError({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  useEffect(() => { console.error('Root error:', error) }, [error])
  const [lang, setLang] = useState<string | null>(null)
  useEffect(() => { setLang(storedLang()) }, [])
  const [title, body, retryLabel] = copyFor(lang) ?? BILINGUAL
  // ⛔ `retry`, NOT `reset` (Emil-skills audit, 2026-10-06): reset re-rendered the same failed payload, so Try
  // again did nothing; retry (Next 16.3.6) refreshes the route and resets in one transition — this boundary sits
  // inside the router (app-router.js) — with `reset` as the fallback should a Next ever stop passing it. Busy
  // while pending — aria-busy, the progress cursor and an ellipsis on the label — but NEVER disabled: this is the
  // only control on the page, so a refresh that hangs must still leave it pressable. And never dimmed: a control
  // that can still be pressed keeps its contrast (dimmed to 0.6 it read 2.66:1 — branch review, 2026-10-06).
  const [retrying, startRetry] = useTransition()
  return (
    <html lang={copyFor(lang) ? (lang as string) : 'en'}>
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: '#fafafa', color: '#1a202c' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ maxWidth: 420, background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>{title}</h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#475569', margin: '0 0 20px' }}>
              {body}
            </p>
            <button
              onClick={() => startRetry(() => (retry ?? reset)())}
              aria-busy={retrying || undefined}
              style={{ background: '#0a66c2', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: retrying ? 'progress' : 'pointer' }}
            >
              {retryLabel}{retrying ? '…' : ''}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
