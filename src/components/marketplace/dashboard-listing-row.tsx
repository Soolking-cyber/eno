'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, MessageSquareText, CheckCircle2, RotateCcw, Trash2, ExternalLink, Pencil } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { ShareButton } from './share-button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// One row in the seller dashboard's listings table. Lifecycle actions are
// OPTIMISTIC: the row's status/availability flips INSTANTLY (local override), the
// request fires in the background, and we only revert + revalidate if it fails.
// No blocking spinner — the user never waits on the network for feedback.
export function DashboardListingRow({ listing, onChanged, variant = 'row' }: { listing: SerializedListing; onChanged: () => void; variant?: 'row' | 'grid' }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const [gone, setGone] = useState(false)
  // Local optimistic status override (null = use the prop / server value).
  const [optStatus, setOptStatus] = useState<string | null>(null)

  const title = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  const img = listing.images[0] || null
  const status = optStatus ?? listing.status

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

  const btn = 'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer'

  // Warm the listing page on hover/touch so opening it is instant.
  const prefetch = () => router.prefetch(`/listings/${listing.id}`)
  const open = () => router.push(`/listings/${listing.id}`)

  // Shared between the row + square-card layouts.
  const meta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{listing.views}</span>
      <span className="inline-flex items-center gap-1"><MessageSquareText className="h-3 w-3" />{listing.contactCount} {tr('leads', 'liên hệ')}</span>
    </div>
  )

  const actions = (
    <div className="flex flex-wrap gap-1.5">
      {/* Availability confirmation lives in the daily review popup now — not here. */}
      {status === 'active' ? (
        <button onClick={() => setStatus('sold')} className={btn}>
          <CheckCircle2 className="h-3 w-3" /> {tr('Mark sold', 'Đã bán')}
        </button>
      ) : (
        <button onClick={() => setStatus('active')} className={btn}>
          <RotateCcw className="h-3 w-3" /> {tr('Relist', 'Đăng lại')}
        </button>
      )}
      <button onClick={() => router.push(`/listings/${listing.id}/edit`)} onMouseEnter={() => router.prefetch(`/listings/${listing.id}/edit`)} className={btn}>
        <Pencil className="h-3 w-3" /> {tr('Edit', 'Sửa')}
      </button>
      <button onClick={open} className={btn}>
        <ExternalLink className="h-3 w-3" /> {tr('View', 'Xem')}
      </button>
      {/* Quick share — only meaningful for a LIVE listing (a held/sold one has no
          public page). Reuses the curated share popover from the detail page. */}
      {status === 'active' && listing.verified && (
        <ShareButton
          url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/listings/${listing.id}`}
          title={title}
          price={listing.price}
          currency={listing.currency}
          className="gap-1 rounded-lg px-2.5 py-1 text-xs [&_svg]:h-3 [&_svg]:w-3"
        />
      )}
      <button onClick={() => { if (confirm(tr('Delete this listing permanently?', 'Xóa vĩnh viễn tin này?'))) del() }} className={cn(btn, 'hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 relative tap-44')}>
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )

  // Square card (grid view): square cover with the status chip on it, then title /
  // price / stats, with the quick-action buttons pinned to the bottom.
  if (variant === 'grid') {
    // No overflow-hidden on the card — it would clip the Share popover. The image
    // rounds its own top corners instead.
    return (
      <div className="flex flex-col rounded-2xl border border-border/70 bg-card transition-colors hover:border-line-strong" onMouseEnter={prefetch} onTouchStart={prefetch}>
        <button onClick={open} className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-tint cursor-pointer" aria-label={title}>
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
          )}
          <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm', statusChip.cls)}>{statusChip.label}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-foreground">{title}</p>
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-sm font-bold text-foreground" />
          {meta}
          <div className="mt-auto pt-2">{actions}</div>
        </div>
      </div>
    )
  }

  // Row (list view) — horizontal thumbnail + details.
  return (
    <div className="flex gap-3 rounded-2xl p-3 transition-colors hover:bg-muted" onMouseEnter={prefetch} onTouchStart={prefetch}>
      <button onClick={open} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint cursor-pointer" aria-label={title}>
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
        <div className="mt-0.5">{meta}</div>
        <div className="mt-2">{actions}</div>
      </div>
    </div>
  )
}
