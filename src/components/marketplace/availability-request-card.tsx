'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChatCard } from '@/components/marketplace/chat-card-shell'
import { Price } from '@/components/marketplace/price'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ClipboardCheck, Copy, ExternalLink, Home } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { isMockImageUrl } from '@/lib/listing-image'
import {
  RENTAL_CHECK_CHANNELS, RENTAL_CHECK_ID_RE, RENTAL_CHECK_MAX_ITEMS, rentalContactHref,
  type AvailabilityRequestItem, type AvailabilityRequestMeta, type RentalCheckChannel,
} from '@/lib/rental-check/shared'

/**
 * THE AVAILABILITY REQUEST, IN THE THREAD — one card, two readers.
 *
 *   · The REQUESTER (`mine`) sees what they asked about, what they asked for, which contact they
 *     gave, who can see it, and the promise that made them press the button: the check is free and
 *     eno adds nothing to the rent.
 *   · The OPERATOR sees the same card with the CONTACT FIRST — it is the thing they act on — plus a
 *     one-tap deep link into Zalo / WhatsApp / mail, and which edition the request came from.
 *
 * ⚠️ A SNAPSHOT, NOT A LIVE READ. Titles and prices are what the listings said when the request was
 * sent (the route copies them from the database). That is the honest record of the question; the
 * row links to the live listing for anything newer.
 * ⚠️ `requirements` IS PLAIN TEXT: pre-wrapped, never linkified, never scanned for chips — it is the
 * requester's own words, and turning a pasted address into a link is how a card becomes a lure.
 */

/**
 * Client-side shape check for a card's `meta`. The server already strict-parsed it on write and
 * again on read (parseMessageMeta), so this is the guard for a THREAD CACHED by an older build or a
 * hand-written row — anything it cannot read falls back to an inert bubble on the thread page.
 */
export function parseAvailabilityRequestMeta(meta: unknown): AvailabilityRequestMeta | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  if (m.v !== 1 || typeof m.requestId !== 'string' || typeof m.requirements !== 'string') return null
  if (m.origin !== 'vn' && m.origin !== 'forum') return null
  if (m.lang !== 'en' && m.lang !== 'vi') return null
  const c = m.contact as Record<string, unknown> | null | undefined
  if (!c || typeof c !== 'object' || typeof c.value !== 'string' || !c.value) return null
  if (!(RENTAL_CHECK_CHANNELS as readonly unknown[]).includes(c.channel)) return null
  if (!Array.isArray(m.items) || m.items.length < 1 || m.items.length > RENTAL_CHECK_MAX_ITEMS) return null
  for (const raw of m.items) {
    const it = raw as Record<string, unknown> | null
    if (!it || typeof it !== 'object') return null
    if (typeof it.id !== 'string' || !RENTAL_CHECK_ID_RE.test(it.id)) return null
    if (typeof it.title !== 'string' || (it.titleVi !== null && typeof it.titleVi !== 'string')) return null
    if (it.image !== null && typeof it.image !== 'string') return null
    if (typeof it.price !== 'number' || !Number.isFinite(it.price)) return null
    if (typeof it.currency !== 'string' || typeof it.priceUnit !== 'string') return null
  }
  return meta as AvailabilityRequestMeta
}

type Tr = (en: string, vi: string) => string

function channelLabel(channel: RentalCheckChannel, tr: Tr): string {
  if (channel === 'zalo') return 'Zalo'
  if (channel === 'whatsapp') return 'WhatsApp'
  return tr('Email', 'Email')
}

function openLabel(channel: RentalCheckChannel, tr: Tr): string {
  if (channel === 'zalo') return tr('Open in Zalo', 'Mở trong Zalo')
  if (channel === 'whatsapp') return tr('Open in WhatsApp', 'Mở trong WhatsApp')
  return tr('Write an email', 'Viết email')
}

/** Phones are stored as international digits; shown with the '+' a person would dial. */
function displayContact(channel: RentalCheckChannel, value: string): string {
  return channel === 'email' ? value : `+${value}`
}

/**
 * The row thumbnail. ≤64px media → `rounded-lg` (design-language §2). A photo that fails to load
 * swaps to the placeholder rather than leaving a broken-image glyph in the thread.
 */
function Thumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-tint text-ink-4" aria-hidden>
        <Home className="h-5 w-5" />
      </span>
    )
  }
  return (
    <Image
      src={src}
      alt=""
      width={48}
      height={48}
      sizes="48px"
      className="h-12 w-12 shrink-0 rounded-lg object-cover"
      unoptimized={isMockImageUrl(src)}
      onError={() => setFailed(true)}
    />
  )
}

function ItemRow({ item }: { item: AvailabilityRequestItem }) {
  const { lang } = useLanguage()
  const title = (lang === 'vi' && item.titleVi) || item.title || item.titleVi || ''
  return (
    <li>
      <Link
        href={`/listings/${item.id}`}
        className="flex items-center gap-3 rounded-xl py-2 transition-colors hover:bg-muted/60"
      >
        <Thumb src={item.image} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{title}</span>
          <span className="mt-0.5 block">
            <Price price={item.price} currency={item.currency} priceUnit={item.priceUnit} native dual={false} className="text-xs" />
          </span>
        </span>
      </Link>
    </li>
  )
}

function ContactRow({ channel, value }: { channel: RentalCheckChannel; value: string }) {
  const { tr } = useLanguage()
  const shown = displayContact(channel, value)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown)
      toast.success(tr('Copied', 'Đã sao chép'))
    } catch {
      toast.error(tr("Couldn't copy — select the text instead.", 'Không sao chép được — hãy chọn văn bản để sao chép.'))
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-2xs font-semibold text-ink-4">{channelLabel(channel, tr)}</span>
        <span className="block truncate text-sm font-semibold text-foreground" data-testid="rental-contact">{shown}</span>
      </span>
      <IconButton size="sm" onClick={copy} aria-label={tr('Copy contact', 'Sao chép liên hệ')} className="text-body hover:bg-muted">
        <Copy className="h-4 w-4" aria-hidden />
      </IconButton>
    </div>
  )
}

export function AvailabilityRequestCard({ meta, mine }: { meta: AvailabilityRequestMeta; mine: boolean }) {
  const { tr } = useLanguage()
  const n = meta.items.length
  // ⚠️ BUILT FROM LITERAL PARTS, not one template string: the UI-string catalogue (and the machine
  // translation it feeds for the nine other languages) only sees literal tr() arguments, so a
  // `${n}` template would stay English everywhere but vi.
  const heading = `${tr('Availability check', 'Kiểm tra phòng trống')} · ${n} ${n === 1 ? tr('rental', 'căn') : tr('rentals', 'căn')}`
  const { channel, value } = meta.contact
  const href = rentalContactHref(channel, value)

  const requirements = meta.requirements ? (
    <div className="mt-3">
      <p className="text-2xs font-semibold text-ink-4">{mine ? tr('Your requirements', 'Yêu cầu của bạn') : tr('Requirements', 'Yêu cầu thêm')}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{meta.requirements}</p>
    </div>
  ) : null

  const items = (
    <ul className="mt-2 divide-y divide-border">
      {meta.items.map((item) => <ItemRow key={item.id} item={item} />)}
    </ul>
  )

  if (!mine) {
    // THE OPERATOR'S VIEW — contact first, because reaching the person is the first thing to do.
    return (
      <ChatCard
        eyebrow={tr('Free check', 'Kiểm tra miễn phí')}
        icon={ClipboardCheck}
        title={heading}
        right={
          <Badge variant="neutral" size="sm">
            {meta.origin === 'forum' ? 'eno.forum' : 'eno.vn'} · {meta.lang === 'vi' ? 'VI' : 'EN'}
          </Badge>
        }
      >
        <div className="mt-2 space-y-2">
          <ContactRow channel={channel} value={value} />
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={href} {...(channel === 'email' ? {} : { target: '_blank', rel: 'noreferrer nofollow' })}>
              {openLabel(channel, tr)} <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        </div>
        {items}
        {requirements}
        <p className="mt-3 text-xs text-body">
          {tr('Check these with the landlords and reply here — the person sees your answer in Messages.', 'Hãy kiểm tra với chủ nhà và trả lời tại đây — người gửi sẽ thấy câu trả lời trong Tin nhắn.')}
        </p>
      </ChatCard>
    )
  }

  // THE REQUESTER'S VIEW — what they sent, who sees the contact, and the free promise.
  return (
    <ChatCard eyebrow={tr('Free check', 'Kiểm tra miễn phí')} icon={ClipboardCheck} title={heading}>
      {items}
      {requirements}
      <div className="mt-3 space-y-1.5">
        <ContactRow channel={channel} value={value} />
        <p className="text-2xs text-ink-4">{tr('Only the eno team sees your contact.', 'Chỉ đội ngũ eno thấy thông tin liên hệ của bạn.')}</p>
      </div>
      <p className="mt-3 text-xs font-medium text-success">
        {tr(
          'Free service to find your next home — the price you see is the price you get.',
          'Dịch vụ miễn phí giúp bạn tìm nhà — giá bạn thấy là giá bạn trả.',
        )}
      </p>
    </ChatCard>
  )
}
