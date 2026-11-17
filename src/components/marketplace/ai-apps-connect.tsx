'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, Check, Copy } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { CHAT_APPS } from '@/lib/ai-chat-connect'
import { fillTemplate } from '@/lib/i18n/placeholders'

/** Settings › Developers: connect this shop to an AI chat app — src/lib/ai-chat-connect.ts says which app connects how. */
export function AiAppsConnect() {
  const { tr } = useLanguage()
  const [pasting, setPasting] = useState<string | null>(null)
  const paste = CHAT_APPS.find((a) => a.how === 'paste' && a.app === pasting)

  return (
    <div>
      <h2 className="h-section text-foreground">{tr('Connect an AI app', 'Kết nối ứng dụng AI')}</h2>
      <p className="mt-1 text-sm leading-relaxed text-body">
        {tr('Manage this shop from your AI chat: sign in with eno.vn there and press Allow.', 'Quản lý gian hàng ngay trong ứng dụng AI: đăng nhập eno.vn ở đó và nhấn Cho phép.')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHAT_APPS.map((a) =>
          a.how === 'link' ? (
            <Button key={a.app} variant="outline" asChild>
              <a href={a.href} target="_blank" rel="noopener noreferrer">
                {a.app}
                <ArrowUpRight className="size-4" aria-hidden />
                <span className="sr-only">{tr(' (opens in a new tab)', ' (mở trong thẻ mới)')}</span>
              </a>
            </Button>
          ) : a.how === 'soon' ? (
            <Button key={a.app} variant="outline" disabled>
              {a.app} · {tr('soon', 'sắp có')}
            </Button>
          ) : (
            <Button key={a.app} variant="outline" aria-expanded={pasting === a.app} onClick={() => setPasting((p) => (p === a.app ? null : a.app))}>
              {a.app}
            </Button>
          ),
        )}
      </div>
      {paste && paste.how === 'paste' && (
        <div className="mt-3 space-y-2 rounded-2xl border border-line-strong p-4 text-sm text-body">
          <p>
            <a href={paste.open} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-foreground hover:underline">
              {fillTemplate(tr('Open {app} connectors', 'Mở connectors của {app}'), 'Open {app} connectors', { app: paste.app })}
              <span className="sr-only">{tr(' (opens in a new tab)', ' (mở trong thẻ mới)')}</span>
            </a>
            {' '}
            {tr('→ New connector → Custom. Paste these, then sign in and press Allow:', '→ New connector → Custom. Dán hai mục này, rồi đăng nhập và nhấn Cho phép:')}
          </p>
          {paste.values.map((v) => <CopyRow key={v.label} label={v.label} value={v.value} />)}
        </div>
      )}
    </div>
  )
}

/**
 * One value to paste into the app, with Copy. `label` is the app's own field name ("URL", "Client ID" — Grok's form is in English).
 * ⛔ NEVER UNREADABLE (commit gate, opus): the value wraps in full and selects on a tap, and where the clipboard is refused (an app's
 * built-in browser, a page not served securely) Copy selects it instead, for the phone's own copy.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const selectIt = () => {
    const el = ref.current
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!el || !sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  const copy = () => {
    const done = () => {
      if (timer.current) clearTimeout(timer.current)
      setCopied(true)
      timer.current = setTimeout(() => setCopied(false), 1500)
    }
    if (!navigator.clipboard?.writeText) { selectIt(); return }
    navigator.clipboard.writeText(value).then(done).catch(selectIt)
  }
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-2 text-t-meta font-semibold text-foreground">{label}</span>
      <code ref={ref} className="min-w-0 flex-1 select-all break-all rounded-lg border border-line-strong bg-card px-3 py-2 font-mono text-t-meta text-foreground">{value}</code>
      <Button variant="outline" size="sm" onClick={copy} aria-label={`${tr('Copy', 'Chép')} ${label}`}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
      </Button>
      <span className="sr-only" aria-live="polite">{copied ? tr('Copied', 'Đã chép') : ''}</span>
    </div>
  )
}
