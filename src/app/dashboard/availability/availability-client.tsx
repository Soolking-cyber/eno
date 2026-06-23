'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, Check } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Price } from '@/components/marketplace/price'
import { Mascot } from '@/components/marketplace/mascot'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { cn } from '@/lib/utils'

// localStorage marker so the daily review only auto-shows once per day per user.
export const reviewKey = (uid: string) => `eno-avail:${uid}`
export const todayStr = () => new Date().toISOString().slice(0, 10)

/** Daily availability review — the Carousell "is it still available?" flow.
 *  Tick anything that sold; everything else gets bumped to the top in one tap. */
export function AvailabilityClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const [listings, setListings] = useState<SerializedListing[] | null>(null)
  const [soldIds, setSoldIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && !user) { router.replace('/'); return }
    if (!user) return
    fetch('/api/dashboard').then((r) => (r.ok ? r.json() : { dashboard: null })).then((d) => {
      const active = (d.dashboard?.listings ?? []).filter((l: SerializedListing) => l.status === 'active')
      setListings(active)
      // Nothing to review → mark done + leave.
      if (active.length === 0) { markDone(); router.replace('/dashboard') }
    }).catch(() => setListings([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading])

  const markDone = useCallback(() => {
    try { if (user) localStorage.setItem(reviewKey(user.id), todayStr()) } catch {}
  }, [user])

  const toggle = (id: string) => setSoldIds((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
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
    markDone()
    router.replace('/dashboard')
  }

  const skip = () => { markDone(); router.replace('/dashboard') }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 py-6 sm:px-6">
        <div className="text-center">
          <Mascot name="success" className="mx-auto h-32 w-32" />
          <h1 className="mt-2 h-title text-foreground">{tr('Still available?', 'Còn hàng không?')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr('Tick anything that sold — everything else gets bumped to the top.', 'Đánh dấu món đã bán — những món còn lại sẽ được đẩy lên đầu.')}</p>
        </div>

        {total > 6 && (
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Search your listings', 'Tìm tin của bạn')} className="w-full rounded-xl bg-tint py-2.5 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-ink-4 focus:bg-muted" />
          </div>
        )}

        <div className="mt-4 space-y-1.5 pb-28">
          {!listings ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-2xl shimmer" />)
          ) : filtered.map((l) => {
            const sold = soldIds.has(l.id)
            return (
              <button key={l.id} onClick={() => toggle(l.id)} className={cn('flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors', sold ? 'bg-accent' : 'hover:bg-muted')}>
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-tint">
                  {l.images[0] && /* eslint-disable-next-line @next/next/no-img-element */ <img src={l.images[0]} alt="" className={cn('h-full w-full object-cover transition-opacity', sold && 'opacity-50')} loading="lazy" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-semibold', sold ? 'text-muted-foreground line-through' : 'text-foreground')}>{l.titleVi || l.title}</p>
                  <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact className="text-sm font-bold text-body" />
                </div>
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors', sold ? 'bg-[#0a66c2] text-white' : 'bg-tint text-ink-4')}>
                  {sold ? <Check className="h-4 w-4" /> : ''}
                </span>
              </button>
            )
          })}
        </div>
      </main>

      {/* Sticky action bar */}
      {listings && total > 0 && (
        <div className="sticky bottom-0 bg-card px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <button onClick={skip} className="text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer">{tr('Skip for now', 'Để sau')}</button>
            <button onClick={submit} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-50 cursor-pointer">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {soldCount > 0
                ? tr(`Bump ${availCount} · sold ${soldCount}`, `Đẩy ${availCount} · đã bán ${soldCount}`)
                : tr('Everything’s still available', 'Tất cả vẫn còn')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
