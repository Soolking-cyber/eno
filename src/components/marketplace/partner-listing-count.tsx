'use client'

import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { CountValue } from './rating-value'

/**
 * '{n} listings on eno.vn' / '{n} tin đăng trên eno.vn' — with the singular for one, and the number
 * through <CountValue> so a vi reader gets '1.234'. The site name is the edition's (SITE_NAME), never a
 * literal: eno.forum's partner rows must name eno.forum. Used by pdp-shop-link.tsx and seller-card.tsx.
 */
export function PartnerListingCount({ n }: { n: number }) {
  const { tr } = useLanguage()
  return (
    <span data-partner-listing-count>
      <CountValue value={n} /> {n === 1 ? tr('listing on', 'tin đăng trên') : tr('listings on', 'tin đăng trên')} {SITE_NAME}
    </span>
  )
}
