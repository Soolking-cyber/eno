'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, MessageSquareText, RefreshCw, CheckCircle2, RotateCcw, Trash2, Loader2, Clock, ExternalLink } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

const DAY = 86_400_000

// One row in the seller dashboard's listings table: thumbnail, key stats (views,
// leads), a status chip, and one-tap lifecycle actions backed by the owner-scoped
// listing APIs. Optimistic — the row updates immediately, reverts on failure.
export function DashboardListingRow({ listing, onChanged }: { listing: SerializedListing; onChanged: () => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState(false)

  const title = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  const img = listing.images[0] || null
  const confirmedAt = listing.availabilityConfirmedAt || listing.postedAt
  const stale = listing.status === 'active' && Date.now() - new Date(confirmedAt).getTime() > 7 * DAY

  const call = async (key: string, url: string, method: 'POST' | 'DELETE', body?: unknown) => {
    setBusy(key)
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
      if (!res.ok) throw new Error('failed')
      if (key === 'delete') setGone(true)
      onChanged()
    } catch {
      setBusy(null)
    }
  }

  if (gone) return null

  const status = listing.status
  const statusChip =
    !listing.verified && status === 'active'
      ? { label: tr('Held', 'Đang giữ'), cls: 'bg-amber-100 text-amber-700' }
      : status === 'sold'
        ? { label: tr('Sold', 'Đã bán'), cls: 'bg-tint text-muted-foreground' }
        : status === 'hidden'
          ? { label: tr('Hidden', 'Đã ẩn'), cls: 'bg-tint text-muted-foreground' }
          : { label: tr('Live', 'Đang hiển thị'), cls: 'bg-accent text-accent-foreground' }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer'

  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-card p-3">
      <button onClick={() => router.push(`/listings/${listing.id}`)} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint cursor-pointer" aria-label={title}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', statusChip.cls)}>{statusChip.label}</span>
        </div>
        <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-sm font-bold text-foreground" />

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{listing.views}</span>
          <span className="inline-flex items-center gap-1"><MessageSquareText className="h-3 w-3" />{listing.contactCount} {tr('leads', 'liên hệ')}</span>
          {stale && <span className="inline-flex items-center gap-1 font-semibold text-amber-600"><Clock className="h-3 w-3" />{tr('Confirm availability', 'Xác nhận còn hàng')}</span>}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {status === 'active' ? (
            <>
              <button onClick={() => call('confirm', `/api/listings/${listing.id}/confirm`, 'POST')} disabled={!!busy} className={cn(btn, stale && 'border-[#0a66c2] bg-accent text-accent-foreground')}>
                {busy === 'confirm' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {tr('Still available', 'Còn hàng')}
              </button>
              <button onClick={() => call('sold', `/api/listings/${listing.id}/status`, 'POST', { status: 'sold' })} disabled={!!busy} className={btn}>
                {busy === 'sold' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} {tr('Mark sold', 'Đã bán')}
              </button>
            </>
          ) : (
            <button onClick={() => call('relist', `/api/listings/${listing.id}/confirm`, 'POST')} disabled={!!busy} className={btn}>
              {busy === 'relist' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} {tr('Relist', 'Đăng lại')}
            </button>
          )}
          <button onClick={() => router.push(`/listings/${listing.id}`)} className={btn}>
            <ExternalLink className="h-3 w-3" /> {tr('View', 'Xem')}
          </button>
          <button onClick={() => { if (confirm(tr('Delete this listing permanently?', 'Xóa vĩnh viễn tin này?'))) call('delete', `/api/listings/${listing.id}`, 'DELETE') }} disabled={!!busy} className={cn(btn, 'hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30')}>
            {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  )
}
