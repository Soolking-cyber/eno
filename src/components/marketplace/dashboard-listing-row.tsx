'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, MessageSquareText, CheckCircle2, RotateCcw, Trash2, ExternalLink, Pencil, Heart } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { ShareButton } from './share-button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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
  // Delete the Gmail way: hide the row instantly, hold the DELETE for the toast's
  // lifetime, and only commit if "Undo" wasn't tapped. No blocking confirm() dialog.
  const del = () => {
    setGone(true)
    let undone = false
    const commit = setTimeout(() => {
      if (undone) return
      fetch(`/api/listings/${listing.id}`, { method: 'DELETE' })
        .then((res) => { if (!res.ok) throw new Error('failed'); onChanged() })
        .catch(() => { setGone(false); toast.error(tr('Could not delete — listing restored.', 'Không xóa được — đã khôi phục tin.')); onChanged() })
    }, 5000)
    toast(tr('Listing deleted', 'Đã xóa tin'), {
      duration: 5000,
      action: {
        label: tr('Undo', 'Hoàn tác'),
        onClick: () => { undone = true; clearTimeout(commit); setGone(false) },
      },
    })
  }

  if (gone) return null

  const statusChip =
    !listing.verified && status === 'active'
      ? { label: tr('Held', 'Đang giữ'), cls: 'bg-warning/15 text-warning' }
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
      {listing.savedCount > 0 && (
        <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{listing.savedCount} {tr('saved', 'đã lưu')}</span>
      )}
    </div>
  )

  // Demand nudge — interest without conversion is almost always a price problem.
  // One quiet line, one plain action (never a scold). Saves beat views as the signal.
  const showNudge = status === 'active' && listing.contactCount === 0 && (listing.savedCount >= 5 || listing.views > 50)
  const nudge = showNudge ? (
    <p className="mt-0.5 text-xs text-warning">
      {listing.savedCount >= 5
        ? tr(`${listing.savedCount} people saved this — a small price drop usually sells it`, `${listing.savedCount} người đã lưu tin này — giảm giá một chút thường sẽ bán được`)
        : tr('Lots of views but no contacts yet — a lower price usually fixes this', 'Nhiều lượt xem nhưng chưa có liên hệ — giảm giá thường sẽ bán được')}
      {' · '}
      <button
        onClick={() => router.push(`/listings/${listing.id}/edit`)}
        onMouseEnter={() => router.prefetch(`/listings/${listing.id}/edit`)}
        className="font-semibold underline underline-offset-2 transition-colors hover:text-foreground cursor-pointer"
      >
        {tr('Edit price', 'Sửa giá')}
      </button>
    </p>
  ) : null

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
      <button onClick={del} aria-label={tr('Delete listing', 'Xóa tin')} className={cn(btn, 'hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 relative tap-44')}>
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
          {nudge}
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
        {nudge}
        <div className="mt-2">{actions}</div>
      </div>
    </div>
  )
}
