import 'server-only'
import { cache } from 'react'
import { IS_SERVICES } from '@/lib/edition'
import { getVisaShopSeller } from '@/lib/visa-shop'
import { getTripDesk } from '@/lib/trips/dm-thread'

/**
 * The server half of the edition split: the `where` fragment that keeps the visa/trip desk's
 * listings off the licensed marketplace.
 *
 * ⚠️ SEPARATE FROM `edition.ts` ON PURPOSE. That file must stay import-free so client components can
 * read the flag and have their branches minified away; this one pulls in two `server-only` modules
 * and could never be imported from the browser. Same feature, two files, because they have different
 * runtime homes. Do not merge them back.
 *
 * ⚠️ NOT IN `src/lib/core/listings.ts`, which is the obvious home and fails CI:
 * `src/lib/core/listings.currency.test.ts` asserts that file contains neither `getVisaShopSeller`
 * nor `visa-shop` as whole-file substrings.
 */

/**
 * Thrown when the marketplace edition cannot prove which sellers to exclude.
 *
 * Its own type so a caller can recognise it, and so the message is one an operator can act on at
 * three in the morning without reading this file.
 */
export class DeskResolutionError extends Error {
  constructor(detail: string) {
    super(`[edition] refusing to serve a marketplace listing query: ${detail}. ` +
      'eno.vn must exclude the visa/trip desk from every listing read, and the desk could not be ' +
      'resolved. Check VISA_SHOP_OWNER_EMAIL and TRIP_DESK_OWNER_EMAIL in the deployed env, and ' +
      'that the desk Profile rows exist.')
    this.name = 'DeskResolutionError'
  }
}

/**
 * The seller ids whose listings are services-edition-only.
 *
 * ⚠️ THE VISA DESK AND THE TRIP DESK ARE USUALLY THE SAME ROW. `Seller.ownerId` is `@unique`, so one
 * support account owns exactly one storefront and both features hang off it, distinguished only by
 * an anchor listing. They are resolved separately and unioned anyway, because "usually" is not
 * "always" — a second support identity has appeared in production before — and a union of one is
 * free.
 */
export const deskSellerIds = cache(async (): Promise<string[]> => {
  const [visaDesk, tripDesk] = await Promise.all([getVisaShopSeller(), getTripDesk()])
  const ids = new Set<string>()
  if (visaDesk?.id) ids.add(visaDesk.id)
  if (tripDesk?.id) ids.add(tripDesk.id)
  return [...ids]
})

/**
 * The `where` fragment every marketplace listing read must carry.
 *
 * Spread it into the predicate: `where: { ...(await marketplaceListingScope()), status: 'active' }`.
 * On the services edition it is `{}` and costs nothing.
 *
 * ⚠️ IT THROWS ON THE MARKETPLACE EDITION WHEN THE DESK CANNOT BE RESOLVED, AND THAT IS THE MOST
 * IMPORTANT LINE IN THIS FILE. Both resolvers are deliberately FAIL-SOFT for their own callers —
 * `getVisaShopSeller` and `getTripDesk` each swallow database errors and return null so the visa
 * feature degrades to "unavailable" instead of throwing. Inherited here, that softness inverts into
 * a legal breach: null desks would produce `{ sellerId: { notIn: [] } }`, a predicate that excludes
 * NOTHING, and the fourteen e-Visa SKUs would quietly rejoin the licensed marketplace's browse feed,
 * search, rails, sitemap and Google/Meta product feeds.
 *
 * This is not hypothetical. `src/lib/visa-shop.ts` records that on 2026-07-22 `VISA_SHOP_OWNER_EMAIL`
 * was set in neither the local env nor the deployed secret, so it fell back to a default address
 * with no Profile row — and it was still unset when this module was written. The exact condition
 * that once disabled the visa surface would, after the split, publish it on the wrong domain.
 *
 * So: a visible 500 on a rail is recoverable in ten minutes. A silently unfiltered feed is a
 * licensing breach nobody notices. Fail loud.
 */
export async function marketplaceListingScope(): Promise<{ sellerId?: { notIn: string[] } }> {
  if (IS_SERVICES) return {}
  const ids = await deskSellerIds()
  if (!ids.length) throw new DeskResolutionError('no desk seller could be resolved')
  return { sellerId: { notIn: ids } }
}
