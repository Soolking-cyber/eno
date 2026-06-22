'use client'

import { useState } from 'react'
import { Share2, Check } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * Share the listing. Uses the native Web Share sheet where available (mobile),
 * otherwise copies the link to the clipboard and shows a brief "Copied" state.
 */
export function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState(false)

  const share = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — nothing more we can do */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label={tr('Share', 'Chia sẻ')}
      className={cn(
        'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer active:scale-95',
        copied ? 'border-[#0a66c2] bg-accent text-accent-foreground' : 'border-border text-body hover:border-[#0a66c2] hover:text-accent-foreground',
        className,
      )}
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      <span className="hidden sm:inline">{copied ? tr('Copied', 'Đã sao chép') : tr('Share', 'Chia sẻ')}</span>
    </button>
  )
}
