'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, MessageSquareText, RefreshCw, CheckCircle2, RotateCcw, Trash2, Clock, ExternalLink } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { useLanguage } from '@/context/language-context'
import { isStale } from '@/lib/stale'
import { cn } from '@/lib/utils'

// One row in the seller dashboard's listings table. Lifecycle actions are
// OPTIMISTIC: the row's status/availability flips INSTANTLY (local override), the
// request fires in the background, and we only revert + revalidate if it fails.
// No blocking spinner — the user never waits on the network for feedback.
export function DashboardListingRow({ listing, onChanged }: { listing: SerializedListing; onChanged: () => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const [gone, setGone] = useState(false)
  // Local optimistic overrides (null = use the prop / server value).
  const [optStatus, setOptStatus] = useState<string | null>(null)
  const [optConfirmed, setOptConfirmed] = useState<string | null>(null)

  const title = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  const img = listing.images[0] || null
  const status = optStatus ?? listing.status
  const confirmedAt = optConfirmed ?? listing.availabilityConfirmedAt
  const stale = status === 'active' && isStale(confirmedAt, listing.postedAt)

  // Fire-and-reconcile: apply the optimistic change, then send. On failure, roll
  // back the local override and pull fresh server state.
  const act = (
    optimistic: () => void,
    rollback: () => void,
    url: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
  ) => {
    optimistic()
    fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      .then((res) => { if (!res.ok) throw new Error('failed'); onChanged() })
      .catch(() => { rollback(); onChanged() })
  }

  const confirm_ = () => act(
    () => { setOptStatus('active'); setOptConfirmed(new Date().toISOString()) },
    () => { setOptStatus(null); setOptConfirmed(null) },
    `/api/listings/${listing.id}/confirm`, 'POST',
  )
  const setStatus = (s: 'sold' | 'active') => act(
    () => setOptStatus(s),
    () => setOptStatus(null),
    `/api/listings/${listing.id}/status`, 'POST', { status: s },
  )
  const del = () => act(
    () => setGone(true),
    () => setGone(false),
    `/api/listings/${listing.id}`, 'DELETE',
  )

  if (gone) return null

  const statusChip =
    !listing.verified && status === 'active'
      ? { label: tr('Held', 'Đang giữ'), cls: 'bg-amber-100 text-amber-700' }
      : status === 'sold'
        ? { label: tr('Sold', 'Đã bán'), cls: 'bg-tint text-muted-foreground' }
        : status === 'hidden'
          ? { label: tr('Hidden', 'Đã ẩn'), cls: 'bg-tint text-muted-foreground' }
          : { label: tr('Live', 'Đang hiển thị'), cls: 'bg-accent text-accent-foreground' }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer'

  // Warm the listing page on hover/touch so opening it is instant.
  const prefetch = () => router.prefetch(`/listings/${listing.id}`)

  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-card p-3" onMouseEnter={prefetch} onTouchStart={prefetch}>
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
              <button onClick={confirm_} className={cn(btn, stale && 'border-[#0a66c2] bg-accent text-accent-foreground')}>
                <RefreshCw className="h-3 w-3" /> {tr('Still available', 'Còn hàng')}
              </button>
              <button onClick={() => setStatus('sold')} className={btn}>
                <CheckCircle2 className="h-3 w-3" /> {tr('Mark sold', 'Đã bán')}
              </button>
            </>
          ) : (
            <button onClick={() => setStatus('active')} className={btn}>
              <RotateCcw className="h-3 w-3" /> {tr('Relist', 'Đăng lại')}
            </button>
          )}
          <button onClick={() => router.push(`/listings/${listing.id}`)} className={btn}>
            <ExternalLink className="h-3 w-3" /> {tr('View', 'Xem')}
          </button>
          <button onClick={() => { if (confirm(tr('Delete this listing permanently?', 'Xóa vĩnh viễn tin này?'))) del() }} className={cn(btn, 'hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30')}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
