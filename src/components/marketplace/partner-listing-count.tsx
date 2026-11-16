'use client'

import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { CountValue } from './rating-value'

/**
 * '{n} listings on eno.vn' / '{n} tin đăng trên eno.vn' — with the singular for one, and the number
 * through <CountValue> so a vi reader gets '1.234'. The site name is the edition's (SITE_NAME), never a
 * literal: eno.forum's partner rows must name eno.forum. Used by pdp-shop-link.tsx and seller-card.tsx.
 *
 * `layout="lead"` (owner-approved 2026-11-15 (build 7), cook r07 "rental": the rental listing page's flat host row; it replaces
 * the 2026-11-14 cook r05 `stat` figure — the number in the h2 role over the words): ONE line of the SAME words, the number
 * bold in ink and the rest in the line's own muted ink (the caller sets the size). Real markup, not text drawn from
 * attributes: the element's text stays "5,379 listings on eno.vn" for a screen reader and for copy.
 */
export function PartnerListingCount({ n, layout = 'inline' }: { n: number; layout?: 'inline' | 'lead' }) {
  if (layout === 'lead') {
    return (
      <span data-partner-listing-count className="min-w-0">
        <span className="font-bold tabular-nums text-foreground"><CountValue value={n} /></span> <PartnerListingWords n={n} />
      </span>
    )
  }
  return (
    <span data-partner-listing-count>
      <CountValue value={n} /> <PartnerListingWords n={n} />
    </span>
  )
}

/**
 * The words after the number — 'listings on eno.vn' / 'tin đăng trên eno.vn', the singular for one — for a caller that sets the
 * number apart from them: the storefront header's stat cell on a phone (seller-card.tsx, UI climb r12 store-r12c S1).
 */
export function PartnerListingWords({ n }: { n: number }) {
  const { tr } = useLanguage()
  return <>{n === 1 ? tr('listing on', 'tin đăng trên') : tr('listings on', 'tin đăng trên')} {SITE_NAME}</>
}
