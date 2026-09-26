'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Copy } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { copyText } from '@/lib/copy-text'

/**
 * "Cite this data" — THE BACKLINK MECHANISM of /hcmc-rent-index (owner, 2026-09-27), so it is built to
 * be copied, not read: a ready-to-paste HTML link and a plain-text citation, each with its own button.
 *
 * ⚠️ NOT AN OPEN LICENCE. The terms are "free to cite and quote, credit eno.vn with a link" — the page
 * no longer claims CC BY, and neither does the Dataset JSON-LD. `id="cite"` is the anchor the JSON-LD
 * `usageInfo` points at, so the terms have one home.
 *
 * ⚠️ THE SNIPPET IS ENGLISH ON BOTH LANGUAGES. It is pasted into somebody else's article, where the
 * dataset's English name and an English month are the stable form; the chrome around it translates.
 * `copyText` (src/lib/copy-text.ts) because navigator.clipboard is absent in the Android WebView; the
 * text stays selectable either way, so a failed copy costs the shortcut and never shows "Copied".
 */
export function CiteBox({ url, htmlSnippet, citation }: { url: string; htmlSnippet: string; citation: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState<'html' | 'text' | null>(null)

  const copy = async (which: 'html' | 'text') => {
    if (await copyText(which === 'html' ? htmlSnippet : citation)) {
      setCopied(which)
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800)
    }
  }

  const copyButton = (which: 'html' | 'text', label: string) => (
    <Button variant="outline" size="sm" onClick={() => copy(which)} className="shrink-0 gap-1.5">
      {copied === which ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied === which ? tr('Copied', 'Đã sao chép') : label}
    </Button>
  )

  return (
    <section id="cite" className="mt-12 max-w-3xl scroll-mt-24 rounded-2xl border-2 border-accent-foreground/30 bg-card p-5" aria-labelledby="cite-heading">
      <h2 id="cite-heading" className="h-section text-foreground mb-2">{tr('Cite this data', 'Trích dẫn dữ liệu này')}</h2>
      <p className="text-sm text-body">
        {tr('Free to cite and quote. Please credit eno.vn with a link to', 'Được tự do trích dẫn. Vui lòng ghi nguồn eno.vn kèm liên kết đến')}{' '}
        <a href={url} className="break-words font-semibold text-accent-foreground hover:underline">{url}</a>
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{tr('Link to this page (HTML)', 'Liên kết đến trang này (HTML)')}</h3>
        {copyButton('html', tr('Copy HTML', 'Sao chép HTML'))}
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-tint p-3 font-mono text-xs text-foreground">
        <code>{htmlSnippet}</code>
      </pre>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{tr('Plain-text citation', 'Trích dẫn dạng văn bản')}</h3>
        {copyButton('text', tr('Copy citation', 'Sao chép trích dẫn'))}
      </div>
      <p className="mt-2 rounded-xl bg-tint p-3 text-sm text-foreground">{citation}</p>

      <p className="sr-only" aria-live="polite">{copied ? tr('Copied', 'Đã sao chép') : ''}</p>
    </section>
  )
}
