import 'server-only'
import { db } from '@/lib/db'
import { cache } from 'react'
import { editionHiddenSellerIds, editionAllowedSellerIds, scopedListingWhere } from '@/lib/edition-scope'

/**
 * The storefronts that have set a cover banner AND that this edition is allowed to promote.
 *
 * ⛔ THE EDITION SCOPE IS THE WHOLE REASON THIS IS NOT A ONE-LINE QUERY. A banner is the most
 * prominent thing on the home page, so a shop hidden from this edition surfacing here would be the
 * loudest possible version of the leak the hide-list exists to prevent — and on the marketplace
 * that hide-list is a LICENSING control, not a preference. Both directions are applied: the
 * deny-list (`hidden`) and, on eno.vn, the allow-list that says which sellers may appear at all.
 *
 * ⚠️ IT FAILS CLOSED. Any error resolving the scope returns NO banners rather than all of them.
 * An empty strip is invisible; the wrong storefront in the hero is not.
 *
 * ⚠️ officialPartner ONLY. A banner is an endorsement in the most valuable slot on the site; it is
 * not something an ordinary seller gets by uploading an image. Storefront covers are open to
 * everyone — that is the shop's own page. This is the home page.
 */
export type PartnerBanner = { id: string; name: string; bannerUrl: string; handle: string | null }

export const partnerBanners = cache(async (limit = 3): Promise<PartnerBanner[]> => {
  try {
    const [hidden, allowed] = await Promise.all([editionHiddenSellerIds(), editionAllowedSellerIds()])
    const rows = await db.seller.findMany({
      where: {
        officialPartner: true,
        bannerUrl: { not: null },
        /**
         * ⛔ ONE `id` OBJECT, NOT TWO SPREADS. Written as
         *   ...(allowed ? { id: { in: allowed } } : {}),
         *   ...(hidden.length ? { id: { notIn: hidden } } : {}),
         * the second key OVERWRITES the first, so whenever a deny-list existed the ALLOW-list was
         * silently dropped — on eno.vn that is the licensing gate disappearing while the query
         * still looks scoped. A test caught it; nothing about the shape of the code would have.
         */
        ...(allowed || hidden.length
          ? { id: { ...(allowed ? { in: allowed } : {}), ...(hidden.length ? { notIn: hidden } : {}) } }
          : {}),
        /**
         * A shop with nothing to sell HERE is not worth the hero slot, and the click would land on
         * an empty storefront.
         *
         * ⛔ SCOPED THE SAME WAY THE FEED IS, WHICH IS THE WHOLE POINT OF THE await. A bare
         * `{ status: 'active', verified: true }` counts listings this edition does not serve, so a
         * partner whose only active products are the ones eno.vn may not surface would still earn
         * the largest promotional slot on the marketplace's home page — the licensing leak wearing
         * the costume of an activity check.
         */
        listings: { some: await scopedListingWhere({ status: 'active', verified: true }) },
      },
      // Stable order so the strip does not reshuffle between the server render and a revalidate.
      orderBy: [{ trustScore: 'desc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, name: true, bannerUrl: true, handle: { select: { handle: true } } },
    })
    return rows.map((r) => ({ id: r.id, name: r.name, bannerUrl: r.bannerUrl!, handle: r.handle?.handle ?? null }))
  } catch {
    return []
  }
})
