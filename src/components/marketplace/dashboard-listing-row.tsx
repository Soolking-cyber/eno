'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, MessageSquareText, CheckCircle2, RotateCcw, Trash2, ExternalLink, Pencil, Heart, Check, MoreHorizontal, Link2 } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { QuickDiscount } from './quick-discount'
import { ListingSparkline, type SparkPoint } from './listing-sparkline'
import { useListingActions } from './use-listing-actions'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { copyText } from '@/lib/copy-text'
import { cn } from '@/lib/utils'

// One row in the seller dashboard's listings table. Lifecycle actions are
// OPTIMISTIC: the row's status/availability flips INSTANTLY (local override), the
// request fires in the background, and we only revert + revalidate if it fails.
// No blocking spinner — the user never waits on the network for feedback.
export function DashboardListingRow({ listing, onChanged, variant = 'row', series, selectable = false, selected = false, onSelectToggle }: { listing: SerializedListing; onChanged: () => void; variant?: 'row' | 'grid'; series?: SparkPoint[]; selectable?: boolean; selected?: boolean; onSelectToggle?: () => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  // Optimistic lifecycle actions — shared with the desktop data-table so both
  // surfaces behave identically (instant flip, undo-delete, rollback on failure).
  const { gone, status, setStatus, del } = useListingActions(listing, onChanged)

  const title = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  const img = listing.images[0] || null

  if (gone) return null

  // Rendered TWO ways, deliberately. The row variant is a <Badge> (neutral = bg-tint
  // text-ink-4, so the muted tone is re-pinned via className — the later class wins
  // through cn()/twMerge; text-3xs overrides Badge's sm text-2xs). The GRID variant is
  // an over-image overlay with a drop-shadow, which badge.tsx's own header explicitly
  // disowns — so it stays a bespoke span and carries the raw token pair in `cls`.
  const statusChip: { label: string; variant: 'warning' | 'brand' | 'neutral'; className: string; cls: string } =
    !listing.verified && status === 'active'
      ? { label: tr('Held', 'Đang giữ'), variant: 'warning', className: 'text-2xs', cls: 'bg-warning/15 text-warning' }
      : status === 'sold'
        ? { label: tr('Sold', 'Đã bán'), variant: 'neutral', className: 'text-2xs text-muted-foreground', cls: 'bg-tint text-muted-foreground' }
        : status === 'hidden'
          ? { label: tr('Hidden', 'Đã ẩn'), variant: 'neutral', className: 'text-2xs text-muted-foreground', cls: 'bg-tint text-muted-foreground' }
          : { label: tr('Live', 'Đang hiển thị'), variant: 'brand', className: 'text-2xs', cls: 'bg-accent text-accent-foreground' }

  // Unified tinted action chips (owner 2026-07-17): every action is the SAME soft blue-tint chip with
  // an accent-blue icon and even spacing — consistent, forum-scale (text-sm label + size-4 icon). The
  // `border-transparent` + `[&_svg]:*` overrides also fold QuickDiscount (a warning chip) and
  // ShareButton into the same look when this class is passed to them.
  const chip =
    'inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-tint px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-40 cursor-pointer [&_svg]:size-4 [&_svg]:text-accent-foreground'

  // Warm the listing page on hover/touch so opening it is instant.
  const prefetch = () => router.prefetch(`/listings/${listing.id}`)
  // In select mode, tapping the thumbnail toggles selection instead of opening.
  const open = () => (selectable ? onSelectToggle?.() : router.push(`/listings/${listing.id}`))

  // Real checkbox semantics (role, aria-checked, Space, disabled) instead of a <button>
  // wearing role="checkbox". ui/checkbox is HEADLESS — it paints the box (Root) and we
  // hand it the glyph (Indicator), so the 20px border-2 box + brand fill + 14px Check
  // survive verbatim; only the h-4 w-4 default is overridden (cn() merges it away).
  //
  // ⚠️ TWO stopPropagation()s, and both are load-bearing. The row/cover is clickable, so a
  // select must never also open the listing. Base UI's Root is a <span> and the hidden
  // <input> is its SIBLING, not its child — and Root's own onClick re-dispatches a
  // `bubbles: true` click ONTO that input (CheckboxRoot.js). That second click starts
  // OUTSIDE Root, so Root's stopPropagation cannot see it: it would bubble straight into
  // the grid cover's onClick and toggle the selection a second time (net: nothing happens).
  // The display:contents wrapper is the common ancestor of BOTH nodes and stops it. It adds
  // no box, so layout is untouched. Toggling stays on onChange (the input's change event,
  // which the click-stop does not affect) — putting it on onClick too would double-fire.
  const checkbox = selectable ? (
    <span className="contents" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
      <Checkbox
        checked={selected}
        onChange={() => onSelectToggle?.()}
        onClick={(e) => e.stopPropagation()}
        aria-label={tr('Select listing', 'Chọn tin')}
        className={cn(
          'inline-flex h-5 w-5',
          selected ? 'border-brand bg-primary text-white' : 'border-line-strong bg-card hover:border-brand',
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </Checkbox>
    </span>
  ) : null

  // Shared between the row + square-card layouts.
  const meta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><Eye className="size-4" />{listing.views}</span>
      <span className="inline-flex items-center gap-1"><MessageSquareText className="size-4" />{listing.contactCount} {tr('leads', 'liên hệ')}</span>
      {listing.savedCount > 0 && (
        <span className="inline-flex items-center gap-1"><Heart className="size-4" />{listing.savedCount} {tr('saved', 'đã lưu')}</span>
      )}
      {/* Business tier only (series is fetched lazily for business dashboards and
          simply never passed otherwise) — the slot only exists once data arrived,
          so the default view renders exactly as before. */}
      {series && <ListingSparkline series={series} />}
    </div>
  )

  // Demand nudge — interest without conversion is almost always a price problem.
  // One quiet line, one plain action (never a scold). Saves beat views as the signal.
  const showNudge = status === 'active' && listing.contactCount === 0 && (listing.savedCount >= 5 || listing.views > 50)
  const nudge = showNudge ? (
    <p className="mt-0.5 text-sm text-warning">
      {listing.savedCount >= 5
        ? tr(`${listing.savedCount} people saved this — a small price drop usually sells it`, `${listing.savedCount} người đã lưu tin này — giảm giá một chút thường sẽ bán được`)
        : tr('Lots of views but no contacts yet — a lower price usually fixes this', 'Nhiều lượt xem nhưng chưa có liên hệ — giảm giá thường sẽ bán được')}
      {' · '}
      <Button
        variant="bare"
        size="none"
        onClick={() => router.push(`/listings/${listing.id}/edit`)}
        onMouseEnter={() => router.prefetch(`/listings/${listing.id}/edit`)}
        className="text-sm font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
      >
        {tr('Edit price', 'Sửa giá')}
      </Button>
    </p>
  ) : null

  // Row density (dashboard native-feel review, codex + Gemini): the old 5-6 wrapping chips read
  // webby and half were under 44px. Keep the TWO high-value quick actions inline — the price-cut
  // (only for a priced live listing — the owner's differentiated shortcut) and the status flip
  // (Mark sold / Relist) — and fold the rest into a trailing "…" overflow menu (native list-row
  // pattern), so each row is a couple of clean ≥44px taps, not a dense chip grid.
  const listingUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/listings/${listing.id}`
  const copyLink = async () => { if (await copyText(listingUrl)) toast.success(tr('Link copied', 'Đã sao chép liên kết')) }
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'active' && listing.price > 0 && (
        <QuickDiscount listing={{ id: listing.id, price: listing.price, currency: listing.currency }} onChanged={onChanged} className={chip} />
      )}
      {status === 'active' ? (
        <Button variant="bare" size="none" onClick={() => setStatus('sold')} className={chip}>
          <CheckCircle2 className="size-4" /> {tr('Mark sold', 'Đã bán')}
        </Button>
      ) : (
        <Button variant="bare" size="none" onClick={() => setStatus('active')} className={chip}>
          <RotateCcw className="size-4" /> {tr('Relist', 'Đăng lại')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="bare" size="none" aria-label={tr('More actions', 'Thêm thao tác')} className={cn(chip, 'relative tap-44 px-2.5')}>
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="min-w-44">
          <DropdownMenuItem onMouseEnter={() => router.prefetch(`/listings/${listing.id}/edit`)} onClick={() => router.push(`/listings/${listing.id}/edit`)}><Pencil /> {tr('Edit', 'Sửa')}</DropdownMenuItem>
          <DropdownMenuItem onClick={open}><ExternalLink /> {tr('View listing', 'Xem tin')}</DropdownMenuItem>
          {/* Copy link — only meaningful for a LIVE, verified listing (held/sold/hidden has no
              public page). navigator.share is unreliable in the Android WebView, so a copy is the
              portable action; the PDP keeps the full curated share. */}
          {status === 'active' && listing.verified && (
            <DropdownMenuItem onClick={() => void copyLink()}><Link2 /> {tr('Copy link', 'Sao chép liên kết')}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={del}><Trash2 /> {tr('Delete listing', 'Xóa tin')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  // Square card (grid view): square cover with the status chip on it, then title /
  // price / stats, with the quick-action buttons pinned to the bottom.
  if (variant === 'grid') {
    // No overflow-hidden on the card — it would clip the Share popover. The image
    // rounds its own top corners instead.
    return (
      <div className={cn('flex flex-col rounded-2xl border bg-card transition-colors', selected ? 'border-brand ring-1 ring-brand' : 'border-border/70 hover:border-line-strong')} onMouseEnter={prefetch} onTouchStart={prefetch}>
        <button onClick={open} className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-tint cursor-pointer" aria-label={title}>
          {img && (
            <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
          )}
          {selectable && <span className="absolute right-2 top-2">{checkbox}</span>}
          <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-2xs font-bold shadow-sm', statusChip.cls)}>{statusChip.label}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <p className="line-clamp-2 text-base font-semibold text-foreground">{title}</p>
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-base font-bold text-accent-foreground" />
          {meta}
          {nudge}
          <div className="mt-auto pt-2">{actions}</div>
        </div>
      </div>
    )
  }

  // Row (list view) — horizontal thumbnail + details.
  return (
    <div className={cn('flex gap-3 rounded-2xl p-3 transition-colors', selected ? 'bg-accent' : 'hover:bg-muted')} onMouseEnter={prefetch} onTouchStart={prefetch}>
      {selectable && <span className="self-center">{checkbox}</span>}
      <Button variant="bare" size="none" onClick={open} className="press relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-tint" aria-label={title}>
        {img && (
          <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-base font-semibold text-foreground">{title}</p>
          <Badge variant={statusChip.variant} className={statusChip.className}>{statusChip.label}</Badge>
        </div>
        <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-base font-bold text-accent-foreground" />
        <div className="mt-0.5">{meta}</div>
        {nudge}
        <div className="mt-2">{actions}</div>
      </div>
    </div>
  )
}
