import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { storefrontBaseHost, storefrontHandleFromHost } from '@/lib/storefront-host'

/**
 * WHOSE STOREFRONT A REQUEST IS FOR — the database half of `storefront-host.ts`.
 *
 * That module answers "is this host shaped like a storefront, and which handle"; this one answers
 * "does that handle belong to a shop that may have one today". The split is deliberate: the shape
 * question is pure and runs in the proxy (edge runtime, no database), the eligibility question
 * needs Postgres and runs in the server components that render the page.
 *
 * ⛔ ANY SHOP WITH A HANDLE GETS ONE — VERIFICATION IS NOT THE GATE, AND THAT IS A REVERSAL.
 * Owner first chose "verified shops only" (2026-08-30), then reversed it the same day once the
 * data made the cost concrete: NOT ONE shop on the marketplace passes `isBusinessVerified` — it
 * needs a tax-registry match AND a human document review, and of six shop handles only eno's own
 * even has a tax code. The gate was not selective, it was total, and a storefront nobody can have
 * is not a value proposition. So the subdomain now follows the handle.
 *
 * ⛔ EXCEPT A BRAND NAME, WHICH NEVER GETS A SUBDOMAIN — NOT EVEN VERIFIED. The first version of
 * this let a business-verified shop through, and three reviewers made the same correct objection:
 * business verification proves a seller is a real, documented business; it says NOTHING about
 * whether they are Apple or authorised by Apple. Any verified seller holding `apple` would have
 * passed. There is no cheap test for trademark entitlement, so the rule is the blunt one — a
 * handle that names a brand keeps `eno.vn/<handle>` and never gets `apple.eno.vn`, because it is
 * the SUBDOMAIN that hands out eno's own certificate for that name, and eno is mid-licensing as a
 * sàn TMĐT. A genuine brand partner is a support conversation, not a predicate.
 *
 * ⚠️ THE BRAND LIST IS THE CATALOGUE, NOT A CONSTANT, so it grows as the marketplace learns brands.
 * A shop can therefore hold a handle that is not a brand today and lose the SUBDOMAIN (never the
 * path) when the catalogue learns that name tomorrow. That is deliberate and is the same live-read
 * shape the verification gate had; it costs one indexed lookup on a page that already queries.
 *
 * ⛔ AND THE SHARED SESSION COOKIE MUST NOT BE BUILT AS SPECIFIED — READ THIS BEFORE TOUCHING AUTH.
 * The owner chose (2026-08-30) to scope the session to `.eno.vn` so a buyer stays signed in on a
 * shop's storefront. That was justified HERE by a fact this commit deletes: that every such host
 * belonged to a business a human had checked. It is now any handle-holder. Worse, and decisively:
 * this app's session cookie is deliberately NOT `httpOnly` — see ed222c6d, which refused the audit
 * fix because `createBrowserClient` reads the jar with `document.cookie` across 11 files and 39
 * auth calls. So a domain-scoped cookie would not be a CSRF question at all; one line of
 * JavaScript on any shop's storefront would read the visitor's session token outright. The Origin
 * write-guard in `proxy.ts` does not help with a read. Storefronts stay a READ surface with
 * sign-in on the canonical host until that is redesigned.
 */

export type Storefront = {
  sellerId: string
  handle: string
  name: string
  /** The shop's own cover art. Null for almost every shop — the storefront renders nothing there
   *  rather than a placeholder, which is what `<StorefrontBanner>` already does on the path page. */
  bannerUrl: string | null
  bannerMobileUrl: string | null
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
  // ⚠️ NOT PART OF THE VERIFICATION HASH, and deliberately so: the banner is artwork, not
  // identity, so a shop may change it freely without dropping its badge. Contrast `name`, which
  // IS in the hash precisely because changing it is how impersonation would start.
  bannerUrl: true,
  bannerMobileUrl: true,
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
  /**
   * ⚠️ THE BRAND CHECK RUNS ONLY WHEN THE NAME IS ACTUALLY A BRAND, so the ordinary shop pays
   * nothing for it beyond one indexed lookup that misses. `Brand.slug` is the canonical form the
   * catalogue stores (`huawei`, `apple`), which is the same shape a handle takes, so this compares
   * like with like rather than trying to fold a display name.
   */
  const brand = await db.brand.findUnique({ where: { slug: handle }, select: { slug: true } })
  if (brand) return null
  return {
    sellerId: seller.id,
    handle: row.handle,
    name: seller.name,
    bannerUrl: seller.bannerUrl,
    bannerMobileUrl: seller.bannerMobileUrl,
  }
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
