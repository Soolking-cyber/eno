'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Link2, Mail, MoreHorizontal, MessageCircle } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'

// Brand glyphs (single-path, 24² viewBox). Rendered white on a brand-colour chip.
function WhatsAppIcon(props: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>)
}
function FacebookIcon(props: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>)
}
function TelegramIcon(props: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.061 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>)
}
function XIcon(props: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>)
}

/**
 * Curated, on-brand share popover for the listing detail. Instead of the cluttered
 * OS share sheet (Reading List, Freeform, Simulator…), this shows only the channels
 * that matter for the audience, plus Copy link. Native share is offered as a "More"
 * fallback where available (phones).
 */
export function ShareButton({ url, title, price, currency, className }: { url: string; title: string; price?: number; currency?: string; className?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Lead with the price — it's the part people share for. Falls back to the bare
  // title when no price is supplied.
  const shareText = price != null && currency ? `${title} — ${formatMoneyFull(price, currency)}` : title
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(shareText)
  const channels = [
    // Zalo first — the dominant messenger in Vietnam. Its share plugin scrapes the
    // listing page's Open Graph tags (title/image) for the preview.
    { key: 'zalo', label: 'Zalo', href: `https://sp.zalo.me/plugins/share?url=${u}`, bg: 'bg-[#0068FF]', Icon: MessageCircle },
    { key: 'wa', label: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}`, bg: 'bg-[#25D366]', Icon: WhatsAppIcon },
    { key: 'fb', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, bg: 'bg-[#1877F2]', Icon: FacebookIcon },
    { key: 'tg', label: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${t}`, bg: 'bg-[#26A5E4]', Icon: TelegramIcon },
    { key: 'x', label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`, bg: 'bg-black', Icon: XIcon },
    { key: 'mail', label: tr('Email', 'Email'), href: `mailto:?subject=${t}&body=${u}`, bg: 'bg-[#0a66c2]', Icon: Mail },
  ]

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* blocked */ }
  }
  const nativeShare = async () => {
    setOpen(false)
    try { await navigator.share?.({ title: shareText, url }) } catch { /* dismissed */ }
  }
  const hasNative = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={tr('Share', 'Chia sẻ')}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer active:scale-95',
          open ? 'border-[#0a66c2] bg-accent text-accent-foreground' : 'border-border text-body hover:border-[#0a66c2] hover:text-accent-foreground',
          className,
        )}
      >
        <Share2 className="h-4 w-4" />
        <span className="hidden sm:inline">{tr('Share', 'Chia sẻ')}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl bg-card p-3 shadow-pop animate-in fade-in zoom-in-95 origin-top-right duration-150">
          <p className="px-1 pb-2 text-xs font-bold text-foreground">{tr('Share this listing', 'Chia sẻ tin này')}</p>
          <div className="grid grid-cols-3 gap-1">
            {channels.map(({ key, label, href, bg, Icon }) => (
              // Buttons (not <a href="share-url">) so ad/social blockers (EasyList
              // "Social", Brave, Safari content blockers) can't hide these — they
              // match on anchor hrefs pointing at share URLs.
              <button
                key={key}
                type="button"
                onClick={() => { window.open(href, '_blank', 'noopener,noreferrer'); setOpen(false) }}
                className="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors hover:bg-muted cursor-pointer"
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-white', bg)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[10px] font-medium text-body">{label}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 border-t border-border pt-2">
            <button onClick={copy} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tint">
                {copied ? <Check className="h-4 w-4 text-accent-foreground" /> : <Link2 className="h-4 w-4" />}
              </span>
              {copied ? tr('Link copied', 'Đã sao chép') : tr('Copy link', 'Sao chép liên kết')}
            </button>
            {hasNative && (
              <button onClick={nativeShare} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tint"><MoreHorizontal className="h-4 w-4" /></span>
                {tr('More…', 'Thêm…')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
