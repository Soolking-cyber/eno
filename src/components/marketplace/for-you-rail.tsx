'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, TrendingUp } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
import { useLanguage } from '@/context/language-context'
import { personalizationAllowed } from '@/lib/consent'
import { getRecoSignals, getInboundQuery } from '@/lib/reco-signals'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

/** "For You" — a horizontal rail at the very top of the home feed. Personalized from
 *  the user's own on-site signals when they've allowed it (consent 'all'); otherwise
 *  Trending. Only shows on the default home view — hides as soon as a filter/search is
 *  active (it would be redundant over filtered results). */
export function ForYouRail() {
  const { tr } = useLanguage()
  const router = useRouter()
  const [listings, setListings] = useState<SerializedListing[] | null>(null)
  const [personalized, setPersonalized] = useState(false)
  const [active, setActive] = useState(true) // default (unfiltered) home view?

  const load = useCallback(() => {
    const params = new URLSearchParams()
    const terms: string[] = []
    // Inbound intent (campaign/referrer query) is contextual — used even without
    // stored-history consent, since it's the explicit intent they arrived with.
    const inbound = getInboundQuery()
    if (inbound) terms.push(inbound)
    // Stored on-site history (searches + viewed categories/brands) — first-party, on by
    // default (only an explicit "Essential only / Decline" opts out).
    if (personalizationAllowed()) {
      const s = getRecoSignals()
      terms.push(...s.terms)
      if (s.categories.length) params.set('cats', s.categories.join(','))
      if (s.brands.length) params.set('brands', s.brands.join(','))
    }
    const uniqTerms = Array.from(new Set(terms.filter(Boolean))).slice(0, 6)
    if (uniqTerms.length) params.set('terms', uniqTerms.join(','))
    fetch(`/api/recommendations?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setListings(d.listings || []); setPersonalized(!!d.personalized) } })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const onConsent = () => load() // re-fetch personalized results the moment consent is granted
    window.addEventListener('eno:consent', onConsent)
    return () => window.removeEventListener('eno:consent', onConsent)
  }, [load])

  // Hide when the feed is filtered/searched (the explorer broadcasts 'eno:query' on
  // every URL change; it also covers popstate/deep-links).
  useEffect(() => {
    const check = () => {
      const p = new URLSearchParams(window.location.search)
      const filtered = FILTER_KEYS.some((k) => p.has(k)) || Array.from(p.keys()).some((k) => k.startsWith('attr_') || k.startsWith('range_'))
      setActive(!filtered)
    }
    check()
    window.addEventListener('eno:query', check)
    window.addEventListener('popstate', check)
    return () => { window.removeEventListener('eno:query', check); window.removeEventListener('popstate', check) }
  }, [])

  if (!active) return null
  if (listings !== null && listings.length === 0) return null // nothing to recommend → hide

  return (
    <section className="mb-7">
      <div className="mb-2.5 flex items-center gap-2">
        {personalized ? <Sparkles className="h-4 w-4 text-accent-foreground" /> : <TrendingUp className="h-4 w-4 text-accent-foreground" />}
        <h2 className="text-base font-bold text-foreground">{personalized ? tr('For you', 'Dành cho bạn') : tr('Trending now', 'Đang thịnh hành')}</h2>
      </div>
      {/* Cards are PIXEL-IDENTICAL to the feed grid below: same gaps (gap-2 / sm:gap-4)
          and each card == one grid column width (cols-2 / -3 / -4), so a card width
          exactly equals (100% − N·gap) / cols. No edge-bleed (the parent landing
          <section> is overflow-hidden and would clip it). Default sizes too. */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {listings === null
          ? Array.from({ length: 6 }).map((_, i) => (
              // Same shape as the feed skeleton (4:3 image + title/price/location lines)
              // so it matches the real card size — not a tall block.
              <div key={i} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start space-y-3 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                <div className="aspect-[4/3] w-full rounded-xl shimmer skeleton-photo" />
                <div className="h-4 w-2/3 rounded shimmer" />
                <div className="h-3 w-1/2 rounded shimmer" />
                <div className="h-3 w-1/3 rounded shimmer" />
              </div>
            ))
          : listings.map((l) => (
              <div key={l.id} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                <ListingCard
                  listing={l}
                  onOpen={(x) => router.push(`/listings/${x.id}`)}
                  onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                />
              </div>
            ))}
      </div>
    </section>
  )
}
