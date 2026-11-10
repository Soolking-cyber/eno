'use client'

import type { ComponentProps } from 'react'
import { SellerListings } from './seller-listings'
import { CompactListingRow } from './compact-listing-row'

/**
 * <SellerListings> WHOSE PHONE LIST IS ROWS (owner, 2026-11-10: item 2 of the decision scorecard; the Jobs category page).
 * This file exists to hold ONE import: the list row. seller-listings.tsx takes the row as a prop (`phoneRow`, which has the
 * record) so that the row's code reaches only the page that draws it, and reaches it as part of the page, not as a late
 * dynamic import. Render this where a category reads better as rows on a phone; render <SellerListings> everywhere else.
 */
export function SellerListingsPhoneRows(props: Omit<ComponentProps<typeof SellerListings>, 'phoneRow'>) {
  return <SellerListings {...props} phoneRow={CompactListingRow} />
}
