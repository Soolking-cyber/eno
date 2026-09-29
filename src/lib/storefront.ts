import 'server-only'
import { cache } from 'react'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { IS_SERVICES } from '@/lib/edition'
import { storefrontBaseHost, storefrontHandleFromHost, storefrontLabelUrl, storefrontSubdomainLabel, subdomainKey } from '@/lib/storefront-host'

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
 * THE SHOP A SUBDOMAIN LABEL SERVES — owner, 2026-09-28: a subdomain is the handle with its
 * underscores removed (`sdcstore.eno.vn` is `sdc_store`'s). Null when it serves none.
 *
 * - **The exact handle first.** A handle equal to the label decides it, whoever holds it: a shop gets
 *   the subdomain, and a person or a brand-slug handle gets nobody (the same 404 as ever). Otherwise
 *   the owner of `sdcstore` could lose its own name the day somebody claimed `sdc_store`.
 * - **Else the ONE handle that strips to it.** Two (`ab_cd` and `abc_d`) serve nobody: a 404, exactly
 *   like an unknown label, rather than one shop picked by an order nobody chose. `claimHandle` refuses
 *   such a pair from 2026-09-28 on, so only an older pair can reach this.
 * - **A brand never gets a subdomain, in either spelling**: `app_le` keeps `eno.vn/app_le` and never
 *   gets `apple.eno.vn` (see the brand note at the top of this file).
 *
 * ⚠️ ALSO CALLED WITH A HANDLE, NOT A LABEL: `eno.vn/<handle>` renders the same component in place
 * (`[handle]/page.tsx`), with `row.handle`. That handle exists, so the exact branch answers it, and
 * an underscore handle can never be mistaken for a label (no label has one).
 * ⚠️ `cache()`-WRAPPED like `storefrontByHandle`: per request, never across requests.
 */
export const storefrontByLabel = cache(async (label: string): Promise<Storefront | null> => {
  const rows = await db.$queryRaw<{ handle: string }[]>(
    Prisma.sql`SELECT "handle" FROM "Handle" WHERE "handle" = ${label} OR replace("handle", '_', '') = ${label}`,
  )
  if (rows.some((r) => r.handle === label)) return storefrontByHandle(label)
  if (rows.length !== 1) return null
  const [{ handle }] = rows
  if (storefrontSubdomainLabel(handle) !== label) return null
  if (await db.brand.findUnique({ where: { slug: label }, select: { slug: true } })) return null
  return storefrontByHandle(handle)
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
  const label = storefrontHandleFromHost(host, appHost)
  if (!label) return null
  return storefrontByLabel(label)
}

/**
 * The host storefronts hang off. Delegates to `storefrontBaseHost` so this cannot drift from the
 * proxy's copy — they disagreeing about `www` is exactly the defect that reached review.
 */
export function canonicalAppHost(): string {
  return storefrontBaseHost(process.env.NEXT_PUBLIC_APP_URL)
}

/**
 * THE CANONICAL URL OF A HANDLE'S STOREFRONT: its subdomain when that host actually serves THIS shop
 * (`storefrontByLabel` of its label resolves back to it — `alex.eno.vn`, and since 2026-09-28
 * `sdcstore.eno.vn` for `sdc_store`), else the path, `eno.vn/<handle>`.
 *
 * ⛔ ONE ANSWER FOR EVERY PLACE THAT NAMES THE PAGE (SEO wave B, I2): `<link rel="canonical">` and
 * `og:url` on `/<handle>` and on the subdomain page, the canonical `/sellers/<id>` points at, the Share
 * and "Copy link" address (`shopShareUrl`), the storefront's `Store.url`, and the storefront `<loc>` in
 * pages.xml. Measured before this: pages.xml submitted `eno.vn/eno-trading`, `eno.vn/gmbr` and
 * `eno.vn/vinwonders` while each page canonicalised to its subdomain, so the sitemap asked Google for a
 * URL the page itself disowned.
 * ⚠️ "RESOLVES BACK TO IT", NOT "HAS A LABEL": `sdc_store` and an older `sdcstore` share one label, and
 * the host serves `sdcstore` (the exact handle), so `sdc_store`'s canonical stays its path. Naming the
 * label unconditionally would hand out a link to somebody else's shop.
 */
export async function storefrontCanonical(handle: string, origin: string): Promise<string> {
  const label = storefrontSubdomainLabel(handle)
  const served = !!label && (await storefrontByLabel(label))?.handle === handle
  return canonicalFor(handle, label, origin, served)
}

/** The canonical, given whether the subdomain serves this handle's shop. */
function canonicalFor(handle: string, label: string | null, origin: string, served: boolean): string {
  return served && label ? storefrontLabelUrl(label, origin) : `${origin.replace(/\/$/, '')}/${handle}`
}

/**
 * `storefrontCanonical` for MANY handles in two queries, whatever their number — pages.xml's storefront
 * block. One call per seller was two queries each, all at once (agy and opus, review of this change):
 * harmless for today's handful of sellers with stock of their own, a pool-exhausting fan-out once every
 * private seller qualifies, and one failed read fails the whole sitemap.
 * ⚠️ THE SAME QUESTION `storefrontByLabel` ASKS — the exact handle first, else the one handle that
 * strips to the label, held by a SELLER, and not a brand slug in either spelling — asked of a set.
 * storefront.test.ts pins the two to the same answer for every kind of handle, so the batch cannot drift
 * from the page's own canonical. One read covers both branches: a label has no underscore, so the exact
 * holder of a label also "strips" to it.
 */
export async function storefrontCanonicals(handles: string[], origin: string): Promise<Map<string, string>> {
  const unique = [...new Set(handles)]
  if (!unique.length) return new Map()
  const labelOf = new Map(unique.map((h) => [h, storefrontSubdomainLabel(h)]))
  const labels = [...new Set([...labelOf.values()].filter((l): l is string => !!l))]
  const [rows, brands] = await Promise.all([
    labels.length
      ? db.$queryRaw<{ handle: string; sellerId: string | null }[]>(
        Prisma.sql`SELECT "handle", "sellerId" FROM "Handle" WHERE replace("handle", '_', '') IN (${Prisma.join(labels)})`,
      )
      : Promise.resolve([]),
    db.brand.findMany({ where: { slug: { in: [...new Set([...unique, ...labels])] } }, select: { slug: true } }),
  ])
  const brandSlugs = new Set(brands.map((b) => b.slug))
  /** The handle row a label serves, by `storefrontByLabel`'s rule; undefined when it serves none. */
  const servedBy = (label: string) => {
    const exact = rows.find((r) => r.handle === label)
    if (exact) return exact
    const stripped = rows.filter((r) => subdomainKey(r.handle) === label)
    return stripped.length === 1 && !brandSlugs.has(label) ? stripped[0] : undefined
  }
  return new Map(unique.map((h) => {
    const label = labelOf.get(h) ?? null
    const row = label ? servedBy(label) : undefined
    return [h, canonicalFor(h, label, origin, !!row && row.handle === h && !!row.sellerId && !brandSlugs.has(h))]
  }))
}

/**
 * The address to hand out for a SHOP's handle — its canonical (above). Owner, 2026-09-26: "when users
 * copies this link give it in alex.eno.vn format".
 * ⚠️ NEVER FOR A PERSONAL HANDLE — `<person>.eno.vn` is a 404 (only shops have storefronts), and
 * sharing a subdomain that 404s is worse than the path. The origin falls back to THIS edition's own
 * domain, so a forum build missing its env can never hand out an eno.vn address.
 */
export async function shopShareUrl(handle: string): Promise<string> {
  return storefrontCanonical(handle, process.env.NEXT_PUBLIC_APP_URL || (IS_SERVICES ? 'https://www.eno.forum' : 'https://eno.vn'))
}
