'use client'

import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { CountValue } from './rating-value'

/**
 * '{n} listings on eno.vn' / '{n} tin đăng trên eno.vn' — with the singular for one, and the number
 * through <CountValue> so a vi reader gets '1.234'. The site name is the edition's (SITE_NAME), never a
 * literal: eno.forum's partner rows must name eno.forum. Used by pdp-shop-link.tsx and seller-card.tsx.
 *
 * `layout="stat"` (owner-approved 2026-11-14, cook r05 "rental-c": the rental listing page's host card): the SAME words as a
 * figure — the number on its own line in the h2 role, ink, over the rest in the meta role, muted. Real markup, not text drawn
 * from attributes: the element's text stays "5,379 listings on eno.vn" for a screen reader and for copy (the space between the
 * two lines is a real text node).
 */
export function PartnerListingCount({ n, layout = 'inline' }: { n: number; layout?: 'inline' | 'stat' }) {
  const { tr } = useLanguage()
  const words = n === 1 ? tr('listing on', 'tin đăng trên') : tr('listings on', 'tin đăng trên')
  if (layout === 'stat') {
    return (
      <span data-partner-listing-count className="block min-w-0">
        <span className="block text-t-h2 tabular-nums text-foreground"><CountValue value={n} /></span>
        {' '}
        <span className="block text-t-meta text-muted-foreground">{words} {SITE_NAME}</span>
      </span>
    )
  }
  return (
    <span data-partner-listing-count>
      <CountValue value={n} /> {words} {SITE_NAME}
    </span>
  )
}
