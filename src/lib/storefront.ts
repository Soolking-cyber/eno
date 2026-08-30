import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { isBusinessVerified } from '@/lib/business-verification'
import { storefrontBaseHost, storefrontHandleFromHost } from '@/lib/storefront-host'

/**
 * WHOSE STOREFRONT A REQUEST IS FOR — the database half of `storefront-host.ts`.
 *
 * That module answers "is this host shaped like a storefront, and which handle"; this one answers
 * "does that handle belong to a shop that may have one today". The split is deliberate: the shape
 * question is pure and runs in the proxy (edge runtime, no database), the eligibility question
 * needs Postgres and runs in the server components that render the page.
 *
 * ⛔ ELIGIBILITY IS `isBusinessVerified`, WHICH IS A LIVE TEST RATHER THAN A STORED FLAG, AND THAT
 * IS THE WHOLE REASON THIS FEATURE CAN EXIST AT ALL. Owner, 2026-08-30: only verified shops get a
 * subdomain. That predicate is derived at read time from an identity HASH — see
 * business-verification.ts — so three things follow for free, none of which a boolean column would
 * have given us:
 *   · A shop that renames itself to a brand loses the badge on the next read (`name` is inside the
 *     hash), and therefore loses the subdomain. The impersonation route closes itself.
 *   · Verification EXPIRES, so an abandoned shop's subdomain stops answering without a sweeper.
 *   · A revoked or lapsed tax registration takes the storefront down the moment channel 1 fails.
 * Do not cache this verdict across requests, and do not denormalize it onto Seller. The freshness
 * IS the security property.
 *
 * ⚠️ AND IT IS WHY THE SHARED SESSION COOKIE IS TOLERABLE. Owner's other decision the same day was
 * to scope the session to `.eno.vn` so a buyer stays signed in on a shop's subdomain. That is only
 * defensible because the set of hosts under that cookie is not arbitrary: every one of them
 * belongs to a business that passed a registry check AND a human document review. If this gate is
 * ever widened to unverified shops, the cookie scope has to be reconsidered in the same change —
 * see the Origin check in `proxy.ts` for the other half of that trade.
 */

export type Storefront = {
  sellerId: string
  handle: string
  name: string
}

/**
 * The columns `isBusinessVerified` reads. Selected explicitly rather than fetching the row so the
 * hash inputs are visible here — if that predicate grows a field, this select fails to compile
 * rather than silently verifying against a partial identity.
 */
const VERIFICATION_SELECT = {
  id: true,
  name: true,
  legalName: true,
  legalAddress: true,
  idNumber: true,
  taxCode: true,
  taxCheckedAt: true,
  taxRegisteredName: true,
  taxActive: true,
  verifiedIdentityHash: true,
  verifiedUntil: true,
} as const

/**
 * Resolve a handle to a storefront, or null when the shop does not exist or is not verified today.
 *
 * ⚠️ `cache()`-WRAPPED, WHICH IS PER-REQUEST MEMOISATION AND NOT A CACHE ACROSS REQUESTS. The
 * layout, the page and the metadata export each need this answer and would otherwise make three
 * identical queries per render. React clears it between requests, so the freshness argument above
 * still holds.
 */
export const storefrontByHandle = cache(async (handle: string): Promise<Storefront | null> => {
  const row = await db.handle.findUnique({
    where: { handle },
    select: { handle: true, seller: { select: VERIFICATION_SELECT } },
  })
  // A handle row exists for people too; only the seller branch can be a storefront.
  const seller = row?.seller
  if (!seller) return null
  if (!isBusinessVerified(seller)) return null
  return { sellerId: seller.id, handle: row.handle, name: seller.name }
})

/**
 * The storefront a Host header addresses, or null for the ordinary site.
 *
 * ⚠️ `appHost` COMES FROM THE BUILD, NOT THE REQUEST. `NEXT_PUBLIC_APP_URL` is baked per edition
 * and next.config.ts refuses to build if it disagrees with the edition — so the base this compares
 * against cannot be influenced by a caller. Deriving it from the request instead would make the
 * whole check circular: any host would be a subdomain of itself.
 */
export async function storefrontForHost(host: string | null | undefined): Promise<Storefront | null> {
  const appHost = canonicalAppHost()
  if (!appHost) return null
  const handle = storefrontHandleFromHost(host, appHost)
  if (!handle) return null
  return storefrontByHandle(handle)
}

/**
 * The host storefronts hang off. Delegates to `storefrontBaseHost` so this cannot drift from the
 * proxy's copy — they disagreeing about `www` is exactly the defect that reached review.
 */
export function canonicalAppHost(): string {
  return storefrontBaseHost(process.env.NEXT_PUBLIC_APP_URL)
}
