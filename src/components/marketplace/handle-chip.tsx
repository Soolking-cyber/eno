'use client'

import { useState } from 'react'
import { AtSign, Check } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'

/** Compact public-handle chip (storefront header): shows @name, tap to copy the
 *  shareable eno.vn/name URL (no "@" in the link) — the whole point of handles is
 *  pasting that clean link into Zalo/Facebook/anywhere. */
export function HandleChip({ handle }: { handle: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://eno.vn/${handle}`)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <Tooltip content={tr('Copy shop link', 'Sao chép liên kết gian hàng')} side="top">
      <Button
        variant="bare"
        size="none"
        type="button"
        onClick={copy}
        className="gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent cursor-pointer"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <AtSign className="h-3.5 w-3.5" aria-hidden />}
        {copied ? tr('Link copied', 'Đã chép liên kết') : handle}
      </Button>
    </Tooltip>
  )
}
