'use client'

import { useState } from 'react'
import { Share2, Check, Link2, Mail, MoreHorizontal, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { copyText } from '@/lib/copy-text'
import { hapticTap } from '@/lib/haptics'
import { isNativeShell, openExternal } from '@/lib/native-browser'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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

// @capacitor/share rejects on a normal dismissal too, so the plugin's own hardcoded reject
// messages are what separates "the user saw the sheet and backed out" from "the sheet never
// appeared". Both literals are identical on iOS and Android (SharePlugin.swift / SharePlugin.java)
// and are NOT localised.
const SHEET_WAS_PRESENTED = /share canceled|sharing is in progress/i

/**
 * Share, with a deliberately split personality.
 *
 * WEB (desktop + mobile browsers): a curated, on-brand popover. The OS sheet in a browser is
 * the cluttered one (Reading List, Freeform, Simulator…), so we show only the channels that
 * matter for this audience plus Copy link, and offer the system sheet as a "More…" row where
 * navigator.share exists.
 *
 * NATIVE (Capacitor shell): the trigger opens the OS share sheet DIRECTLY — see onOpenChange.
 * In an installed app the system sheet is the expected affordance and the better one: it holds
 * the user's real targets (pinned Zalo/Messenger threads, AirDrop, every installed app), which
 * a fixed six-icon grid cannot. The popover is kept only as the fallback for a shell where the
 * sheet can't be presented.
 */
export function ShareButton({ url, title, price, currency, className, compact = false }: { url: string; title: string; price?: number; currency?: string; className?: string; compact?: boolean }) {
  const { lang, tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Lead with the price — it's the part people share for. Falls back to the bare
  // title when no price is supplied.
  const shareText = price != null && currency ? `${title} — ${formatMoneyFull(price, currency, moneyLocale(lang))}` : title
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(shareText)
  const channels = [
    // Zalo first — the dominant messenger in Vietnam. Its share plugin scrapes the
    // listing page's Open Graph tags (title/image) for the preview.
    { key: 'zalo', label: 'Zalo', href: `https://sp.zalo.me/plugins/share?url=${u}`, Icon: MessageCircle },
    { key: 'wa', label: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}`, Icon: WhatsAppIcon },
    { key: 'fb', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, Icon: FacebookIcon },
    { key: 'tg', label: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${t}`, Icon: TelegramIcon },
    { key: 'x', label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`, Icon: XIcon },
    { key: 'mail', label: tr('Email', 'Email'), href: `mailto:?subject=${t}&body=${u}`, Icon: Mail },
  ]

  const copy = async () => {
    // copyText falls back to execCommand where navigator.clipboard is absent (Android WebView).
    // "Link copied" only on a copy that actually landed — a failed copy says so instead.
    if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1800) }
    else toast.error(tr("Couldn't copy the link", 'Không sao chép được liên kết'))
  }
  // The Capacitor shell's WebView (Android especially) ships WITHOUT navigator.share, but the
  // @capacitor/share plugin is synced on both platforms — route the OS sheet through it there.
  const native = isNativeShell()

  /**
   * The OS share sheet. Resolves TRUE when the sheet actually reached the user, so the caller can
   * fall back to the popover when it didn't — the trigger must never become a dead tap.
   *
   * The subtlety is that @capacitor/share REJECTS on a normal dismissal, so "it threw" is not the
   * same as "it failed". Both platforms reject with the same two hardcoded literals for outcomes
   * where the sheet was genuinely on screen — `"Share canceled"` (user backed out) and
   * `"Can't share while sharing is in progress"` (a second tap while it's up) — and those are the
   * only rejections treated as success. Anything else (plugin not in this build, an unsupported
   * payload) means the user saw nothing, so we hand them the popover instead of silence.
   */
  const osShareSheet = async (): Promise<boolean> => {
    if (native) {
      try {
        const { Share } = await import('@capacitor/share')
        if (!(await Share.canShare()).value) return false
        try { await Share.share({ title: shareText, url }) } catch (err) {
          return SHEET_WAS_PRESENTED.test((err as Error | undefined)?.message ?? '')
        }
        return true
      } catch { return false } // plugin not synced into this build
    }
    if (typeof navigator === 'undefined' || !navigator.share) return false
    // Web: navigator.share rejects with AbortError on dismissal — same distinction, but the DOM
    // gives us a proper error name instead of a message to match on.
    try { await navigator.share({ title: shareText, url }) } catch (err) {
      return (err as Error | undefined)?.name === 'AbortError'
    }
    return true
  }

  const nativeShare = async () => { setOpen(false); await osShareSheet() }
  // The popover's "More…" row is now WEB-only: in the shell the OS sheet is the PRIMARY action on
  // the trigger (below), so the row could only appear in the fallback popover — i.e. exactly when
  // the sheet is unavailable and the row would dead-end.
  const hasNative = !native && typeof navigator !== 'undefined' && !!navigator.share

  /**
   * Native gets the OS sheet FIRST. On a phone the system sheet IS the share affordance — it
   * carries the targets the user actually has (their pinned Zalo/Messenger threads, AirDrop,
   * Notes, every installed app), which a fixed web popover can never match, and it is what a
   * tap on ⤴ is expected to produce. The curated popover remains the WEB experience, and stays
   * the fallback here if the sheet can't be presented, so the button is never a dead tap.
   */
  const onOpenChange = (next: boolean) => {
    if (next && native) {
      hapticTap()
      void osShareSheet().then((presented) => { if (!presented) setOpen(true) })
      return
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* Base UI supplies toggle-on-click + aria-expanded/haspopup on the rendered button. In the
          native shell onOpenChange diverts that same click to the OS sheet and leaves `open` false,
          so aria-expanded stays honest — the popup the trigger promises is the system one. */}
      <PopoverTrigger
        render={
          // compact: icon-only, OVER MEDIA (mirrors SaveListingButton's compact mode) — NO circle
          // background; the `overlay` variant is a white glyph + baked drop-shadow that reads on any
          // photo, light or dark (our over-media icon aesthetic). That shell IS <IconButton>, so use
          // the primitive. The labelled (non-compact) variant is a padded pill with text.
          compact ? (
            <IconButton
              size="md"
              variant="overlay"
              aria-label={tr('Share', 'Chia sẻ')}
              className={cn('transition-transform active:scale-95', className)}
            >
              <Share2 className="h-5 w-5" />
            </IconButton>
          ) : (
            <Button
              variant="bare"
              size="none"
              type="button"
              aria-label={tr('Share', 'Chia sẻ')}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer active:scale-95 tap-44 relative',
                open ? 'bg-accent text-accent-foreground' : 'text-body hover:bg-muted',
                className,
              )}
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">{tr('Share', 'Chia sẻ')}</span>
            </Button>
          )
        }
      />

      {/* Portaled by the primitive — survives overflow-x-auto table containers un-clipped. */}
      <PopoverContent align="end" side="bottom" sideOffset={8} className="w-64 gap-0 p-3">
        <p className="px-1 pb-2 text-xs font-bold text-foreground">{tr('Share this listing', 'Chia sẻ tin này')}</p>
        <div className="grid grid-cols-3 gap-1">
          {channels.map(({ key, label, href, Icon }) => (
            // Buttons (not <a href="share-url">) so ad/social blockers (EasyList
            // "Social", Brave, Safari content blockers) can't hide these — they
            // match on anchor hrefs pointing at share URLs.
            // openExternal keeps these third-party share endpoints in an in-app browser tab in
            // the native shell instead of hard-exiting to Safari/Chrome; on web, and for the
            // mailto: channel (which no in-app browser can present), it is the same window.open
            // as before.
            <Button
              key={key}
              variant="bare"
              size="none"
              type="button"
              onClick={() => { void openExternal(href); setOpen(false) }}
              className="group flex flex-col items-center gap-1 rounded-xl py-2 transition-colors hover:bg-muted cursor-pointer"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-body transition-colors group-hover:bg-muted group-hover:text-accent-foreground">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-3xs font-medium text-body">{label}</span>
            </Button>
          ))}
        </div>

        <div className="mt-3 pt-2">
          <Button variant="bare" size="none" onClick={copy} className="flex w-full justify-start items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
            <span className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted">
              {copied ? <Check className="h-4 w-4 text-accent-foreground" /> : <Link2 className="h-4 w-4" />}
            </span>
            {copied ? tr('Link copied', 'Đã sao chép') : tr('Copy link', 'Sao chép liên kết')}
          </Button>
          {hasNative && (
            <Button variant="bare" size="none" onClick={nativeShare} className="flex w-full justify-start items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
              <span className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></span>
              {tr('More…', 'Thêm…')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
