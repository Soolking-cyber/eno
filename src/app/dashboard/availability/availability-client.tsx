'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, Check, X } from '@/components/ui/icons'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Price } from '@/components/marketplace/price'
import { Mascot } from '@/components/marketplace/mascot'
import { useAuth } from '@/context/auth-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { STROKE_MARK } from '@/lib/icon-tokens'

// localStorage marker so the daily review only auto-shows once per day per user.
export const reviewKey = (uid: string) => `eno-avail:${uid}`
export const todayStr = () => new Date().toISOString().slice(0, 10)

/** Daily availability review — the Carousell "is it still available?" flow.
 *  Tick anything that sold; everything else gets bumped to the top in one tap. */
export function AvailabilityClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Shared dashboard cache (same source the rail + sibling section pages read) instead
  // of a bespoke /api/dashboard fetch.
  const { dash, refresh, loading: dashLoading } = useDashboard()
  const [soldIds, setSoldIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Consecutive "Skip for now" taps. After 2 in a row, the Skip option is hidden so the
  // seller has to confirm (reset to 0 on confirm). Read from the dashboard payload.
  const skips = dash?.profile.availabilitySkips ?? 0
  const canSkip = skips < 2

  // null while the dashboard is still loading (skeletons); [] only once it resolved empty.
  const listings = useMemo<SerializedListing[] | null>(
    () => (dash ? dash.listings.filter((l) => l.status === 'active') : dashLoading ? null : []),
    [dash, dashLoading],
  )

  useEffect(() => {
    if (!loading && !user) router.replace('/')
  }, [user, loading, router])

  const markDone = useCallback(() => {
    try { if (user) localStorage.setItem(reviewKey(user.id), todayStr()) } catch {}
  }, [user])

  // Nothing to review → mark done + leave.
  useEffect(() => {
    if (user && listings && listings.length === 0) { markDone(); router.replace('/dashboard') }
  }, [user, listings, markDone, router])

  const toggle = (id: string) => setSoldIds((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !listings) return listings ?? []
    return listings.filter((l) => `${l.title} ${l.titleVi ?? ''}`.toLowerCase().includes(q))
  }, [listings, query])

  const total = listings?.length ?? 0
  const soldCount = soldIds.size
  const availCount = total - soldCount

  const submit = async () => {
    if (!listings || submitting) return
    setSubmitting(true)
    const sold = [...soldIds]
    const confirm = listings.filter((l) => !soldIds.has(l.id)).map((l) => l.id)
    try {
      await fetch('/api/listings/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm, sold }),
      })
    } catch { /* best-effort */ }
    refresh() // statuses/bumps changed — re-pull the shared dashboard cache
    markDone()
    router.replace('/dashboard')
  }

  const skip = () => {
    // Record the consecutive skip, then re-pull so the cached availabilitySkips stays honest.
    fetch('/api/availability/skip', { method: 'POST' }).then(() => refresh()).catch(() => {})
    markDone()
    router.replace('/dashboard')
  }

  // Rendered as a MODAL (owner 2026-07-18): a full-screen sheet on mobile (the focused review), a
  // CENTERED POPOVER on desktop — no longer the stretched full-page mobile layout in the dashboard
  // main. Backdrop/X/Esc close it → back to the dashboard. It portals over the dashboard chrome.
  const close = () => { markDone(); router.replace('/dashboard') }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogPortal>
        {/* Backdrop dims the dashboard behind the DESKTOP popover; on mobile the full-screen sheet
            covers everything, so no dimming is needed. */}
        <DialogOverlay className="hidden lg:block" />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background outline-none duration-150 data-open:animate-in data-open:fade-in-0',
            'lg:inset-auto lg:top-1/2 lg:left-1/2 lg:h-auto lg:max-h-[85vh] lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl lg:border lg:border-border lg:shadow-overlay lg:data-open:zoom-in-95',
          )}
        >
          <div className="relative shrink-0 px-4 pt-6 pb-1 text-center sm:px-6">
            <Mascot name="success" className="mx-auto h-24 w-24" />
            <DialogPrimitive.Title className="mt-2 h-title text-foreground">{tr('Still available?', 'Còn hàng không?')}</DialogPrimitive.Title>
            <p className="mt-1 text-sm text-muted-foreground">{tr('Tick anything that sold — everything else gets bumped to the top.', 'Đánh dấu món đã bán — những món còn lại sẽ được đẩy lên đầu.')}</p>
            {/* Icon-only control → the IconButton shell (44px tap target), composed onto the
                Base UI Close via the render prop — not a bare padded button. */}
            <DialogPrimitive.Close
              render={<IconButton aria-label={tr('Close', 'Đóng')} className="absolute right-3 top-3 text-ink-4 transition-colors hover:bg-muted" />}
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {total > 6 && (
            <div className="shrink-0 px-4 sm:px-6">
              <div className="relative mt-2">
                {/* §4: input lead glyphs sit on the h-5 step. */}
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-4" />
                <Input variant="filled" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tr('Search your listings', 'Tìm tin của bạn')} placeholder={tr('Search your listings', 'Tìm tin của bạn')} className="py-2.5 pl-10 pr-4 focus:bg-muted focus:ring-0" />
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3 sm:px-6">
            {!listings ? (
              // ⚠️ 76px, NOT h-16. The real row is `rounded-2xl p-2.5` (20px of padding) around
              // an `h-14 w-14` thumb, so a flat 64px bar grew 12px per row — ~48px across the
              // four — the moment the listings landed. Built from the row's own box model so it
              // stays right if the thumb size changes.
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex w-full items-center gap-3 rounded-2xl p-2.5">
                  <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-5 w-40 max-w-full" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-6 w-6 shrink-0 rounded-lg" />
                </div>
              ))
            ) : filtered.map((l) => {
              const sold = soldIds.has(l.id)
              return (
                <Button key={l.id} variant="bare" size="none" onClick={() => toggle(l.id)} className={cn('flex w-full items-center justify-start gap-3 whitespace-normal rounded-2xl p-2.5 text-left transition-colors active:scale-100 cursor-pointer', sold ? 'bg-accent' : 'hover:bg-muted')}>
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-tint">
                    {l.images[0] && <img src={l.images[0]} alt="" className={cn('h-full w-full object-cover transition-opacity', sold && 'opacity-50')} loading="lazy" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-semibold', sold ? 'text-muted-foreground line-through' : 'text-foreground')}>{l.titleVi || l.title}</p>
                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact className="text-sm text-accent-foreground" />
                  </div>
                  {/* Unchecked = a clearly-STROKED empty box (border-2, like ui/checkbox and the
                      listing-row select box) — a borderless tint blob read as decoration, not as
                      a tickable affordance. border-2 on BOTH states so the flip never resizes. */}
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-bold transition-colors', sold ? 'border-primary bg-primary text-white' : 'border-line-strong bg-card')}>
                    {/* §2: a Check inside a small filled box is a MARK — checkbox weight. */}
                    {sold ? <Check className="h-4 w-4" strokeWidth={STROKE_MARK} /> : ''}
                  </span>
                </Button>
              )
            })}
          </div>

          {/* Footer action bar — a STATIC footer of the sheet/popover (no longer viewport-fixed). */}
          {listings && total > 0 && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-3">
              <div className="flex items-center justify-between gap-3">
                {canSkip ? (
                  <Button variant="bare" size="none" onClick={skip} className="text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer">{tr('Skip for now', 'Để sau')}</Button>
                ) : (
                  <span className="max-w-[55%] text-xs text-muted-foreground">{tr('Quick check needed — confirm what’s still available to keep your listings live.', 'Cần xác nhận nhanh — xác nhận món còn hàng để giữ tin của bạn hiển thị.')}</span>
                )}
                <Button variant="cta" size="none" onClick={submit} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm transition-colors disabled:opacity-50 cursor-pointer">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {soldCount > 0
                    ? tr(`Bump ${availCount} · sold ${soldCount}`, `Đẩy ${availCount} · đã bán ${soldCount}`)
                    : tr('Everything’s still available', 'Tất cả vẫn còn')}
                </Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
