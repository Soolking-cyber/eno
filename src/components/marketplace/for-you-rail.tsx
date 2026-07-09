'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, TrendingUp } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { personalizationAllowed } from '@/lib/consent'
import { getRecoSignals, getInboundQuery } from '@/lib/reco-signals'
import { ListingCardSkeleton } from './listing-card-skeleton'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

/** "For You" — a horizontal rail at the very top of the home feed. Personalized from
 *  the user's own on-site signals when they've allowed it (consent 'all'); otherwise
 *  Trending. Only shows on the default home view — hides as soon as a filter/search is
 *  active (it would be redundant over filtered results). */
export function ForYouRail() {
  const { tr } = useLanguage()
  const router = useRouter()
  const [listings, setListings] = useState<SerializedListingCard[] | null>(null)
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
    // Cards are PIXEL-IDENTICAL to the feed grid below (RAIL_CARD_W == one grid column) so
    // the rail reads as one family with the grid.
    <Shelf
      icon={personalized ? Sparkles : TrendingUp}
      title={personalized ? tr('For you', 'Dành cho bạn') : tr('Trending now', 'Đang thịnh hành')}
      sectionClassName="mb-7"
    >
      {listings === null
        ? Array.from({ length: 6 }).map((_, i) => (
            <ListingCardSkeleton key={i} className={RAIL_CARD_W} />
          ))
        : listings.map((l) => (
            <div key={l.id} className={RAIL_CARD_W}>
              <ListingCard
                listing={l}
                onOpen={(x) => router.push(`/listings/${x.id}`)}
                onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
              />
            </div>
          ))}
    </Shelf>
  )
}
