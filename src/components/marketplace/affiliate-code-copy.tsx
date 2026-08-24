'use client'

import { useState } from 'react'
import { Check, Copy } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'

/**
 * The one-tap copy for a partner's checkout discount code.
 *
 * ⚠️ THE CODE IS REDEEMED ON THE PARTNER'S SITE, NOT HERE. Copying is the whole interaction: eno
 * never validates the code and never discounts anything, so this must not look like an input that
 * applies to a cart on this page.
 */
export function AffiliateCodeCopy({ code }: { code: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is permission-gated and absent over plain http. The code is selectable text
      // either way, so a failure costs the shortcut, not the discount.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? tr('Discount code copied') : tr('Copy discount code')}
      className="tap-44 group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/30"
    >
      <span className="font-mono text-base font-semibold tracking-[0.18em] text-foreground">{code}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-body">
        {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? tr('Copied') : tr('Copy')}
      </span>
    </button>
  )
}
