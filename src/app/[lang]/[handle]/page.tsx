import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays } from '@/components/ui/icons'
import { db } from '@/lib/db'
import { HANDLE_RE } from '@/lib/handle'
import { storefrontByHandle, storefrontCanonical } from '@/lib/storefront'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { loadSeller, SellerStorefront, storefrontMetaDescription } from '@/components/marketplace/seller-storefront'
import { pageShare } from '@/lib/site-identity'
import SubdomainStorefront from '@/app/[lang]/s/[handle]/page'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { Tr } from '@/context/language-context'

// eno.vn/<handle> — the shareable, Telegram-style clean URL for users and storefronts
// (NO "@" in the address bar: eno.vn/apple_store, not eno.vn/@apple_store). This is a
// root-level dynamic segment, so it doubles as the catch-all for unknown top-level
// paths: anything that isn't a valid, existing handle 404s. Static routes always win
// over this segment in Next routing.
//
// Resolution: a handle that belongs to a storefront (or a user who owns one) renders
// the storefront IN PLACE — the clean handle stays in the address bar. A user handle
// with no storefront renders a minimal profile card (name/avatar/member-since only —
// no contact info, noindex). Old eno.vn/@name links redirect to the clean eno.vn/name.

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ lang?: string; handle: string }> }

// Shared by generateMetadata + the page (one DB round-trip per request). Accepts the
// bare handle; a leading "@" (legacy links) is tolerated and stripped.
const resolve = cache(async (raw: string) => {
  const h = decodeURIComponent(raw).replace(/^@/, '').toLowerCase()
  if (!HANDLE_RE.test(h)) return null
  return db.handle.findUnique({
    where: { handle: h },
    select: {
      handle: true,
      seller: { select: { id: true, name: true } },
      profile: {
        select: {
          displayName: true, avatarUrl: true, avatarColor: true, createdAt: true,
          seller: { select: { id: true, name: true } },
        },
      },
    },
  })
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  // Legacy eno.vn/@name → the page redirects it to the clean URL; no metadata needed.
  if (decodeURIComponent(handle).startsWith('@')) return {}
  const row = await resolve(handle)
  // notFound() HERE (in generateMetadata, before any streaming/Suspense boundary)
  // makes an unknown handle a REAL HTTP 404 rather than a soft-404 (200 + 404 UI)
  // that the force-dynamic render under the root loading.tsx boundary would produce.
  if (!row) notFound()

  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const seller = row.seller || row.profile?.seller
  /**
   * ⛔ THE HIDDEN CHECK BELONGS HERE TOO. generateMetadata runs independently of the page body, so
   * a seller this edition refuses to show still had its NAME in the <title>, the description and
   * the OG tags of a page that 404s — the same leak closed on `/s/[handle]` in this change, left
   * open on the route it redirects FROM. `loadSeller` returns null for a hidden seller, but the
   * title above it is built from `seller.name`, which comes straight off the handle row.
   */
  /**
   * ⛔ AND THE GONE CHECK (src/lib/storefront-gone.ts, owner 2026-10-02): an ownerless shop with no
   * public listing 404s, so its name must not title the 404 either. `loadSeller` answers both — it
   * returns null for a hidden OR a gone seller — and it is the cache()d read the description below
   * and the page body make anyway, so this costs no query of its own.
   * ⛔ notFound(), NOT A "Not found" TITLE: the 404 contract (not-found-contract.test.ts) wants the throw
   * HERE, before any boundary could swallow it — a returned title left the status to the body alone,
   * and SubdomainStorefront would run its listing queries first. The body 404s on both anyway.
   */
  if (seller && (await isSellerHiddenHere(seller.id) || !(await loadSeller(seller.id)))) notFound()
  if (seller) {
    // One composition for both storefront routes (src/lib/storefront-description.ts), built from the
    // SAME cache()d loadSeller read SellerStorefront makes for the render. Falls back to the bare name
    // if the storefront row vanished between resolve() and here.
    const description = (await storefrontMetaDescription(seller.id)) ?? `${seller.name} on ${SITE_NAME}`
    /**
     * The shop's subdomain is its canonical address when the subdomain actually serves it (the same
     * storefrontByHandle question /s/<handle> asks); a brand-slug handle it rejects keeps the path.
     * ⚠️ `og:url` IS THE SAME URL. It said `${hostUrl}/<handle>` while the canonical named the subdomain,
     * so a share card and the search result disagreed about which page this is. And pages.xml submits
     * exactly this value (`storefrontCanonical`), so the sitemap can no longer list a URL the page disowns.
     */
    const canonical = await storefrontCanonical(row.handle, hostUrl)
    return {
      title: `${seller.name} | ${SITE_NAME}`,
      description,
      alternates: { canonical },
      // The SITE's card, not the shop banner: banners are 1280×300 (banner-image.tsx), and a 1.91:1 unfurl
      // crop keeps only the middle 45% of that artwork — a sliver of the creative, words cut mid-line.
      ...pageShare({ title: `${seller.name} | ${SITE_NAME}`, description, url: canonical }),
    }
  }
  return {
    title: `@${row.handle} | ${SITE_NAME}`,
    description: `${row.profile?.displayName || `@${row.handle}`} on ${SITE_NAME}`,
    // Shared links are how people reach a member card, so it keeps the site's preview image too.
    ...pageShare({
      title: `@${row.handle} | ${SITE_NAME}`,
      description: `${row.profile?.displayName || `@${row.handle}`} on ${SITE_NAME}`,
      url: `${hostUrl}/${row.handle}`,
    }),
    // Member cards are not an SEO surface — people land here via shared links only.
    robots: { index: false, follow: false },
  }
}

export default async function HandlePage({ params }: Props) {
  const { handle } = await params
  const decoded = decodeURIComponent(handle)
  // Normalize legacy eno.vn/@name links to the clean eno.vn/name URL.
  if (decoded.startsWith('@')) redirect(`/${decoded.slice(1).toLowerCase()}`)

  const row = await resolve(handle)
  if (!row) notFound()

  /**
   * ⛔ A SHOP'S CANONICAL HOME IS ITS SUBDOMAIN — owner, 2026-09-07: *"this is the format from now
   * on … everywhere the businesses storefront is this style"*. `eno.vn/<handle>` used to render
   * `<SellerStorefront>` in place, a profile-shaped page, while `<handle>.eno.vn` rewrites to
   * `/s/<handle>` and gets the real shop: the full `ListingsExplorer` with search, facets and
   * sorting. Two URLs, two different products, and the one people were handed from the dashboard
   * was the lesser of them. This sends every storefront request to the one that is the shop.
   *
   * ⚠️ ONLY WHEN THE SUBDOMAIN CAN ACTUALLY RESOLVE, and that guard is doing real work.
   * `storefrontUrl()` falls back to the path form for a handle that cannot be a host (an infra
   * label, a reserved word) — redirecting to that would be a loop. And on a local preview it
   * happily returns `http://<handle>.localhost:3000`, which Chrome resolves but curl, Playwright
   * and the guest e2e suite do not: a redirect there would break the one target the ship ritual
   * points at. A base host with no dot is not a real domain, so it renders in place as before.
   *
   * ⚠️ TEMPORARY (307), NOT PERMANENT. A 308 is cached by browsers effectively for ever, and
   * handle-format.ts already records what that costs when a root-level redirect turns out wrong.
   * Promote it once the format has settled; the SEO consolidation is worth having, but not at the
   * price of an un-revertable redirect on every shop.
   */
  const sellerId = row.seller?.id ?? row.profile?.seller?.id
  if (sellerId) {
    /**
     * ⛔ THE HIDDEN CHECK COMES FIRST. `SellerStorefront` runs the same test and returns null, so
     * rendering in place used to be the 404 path for a desk seller on eno.vn.
     * Redirecting before that test would have bounced the visitor onto `<desk>.eno.vn` and served
     * the storefront from a host this page had just decided must not show it — a licensing bypass
     * introduced by a redirect that looked purely cosmetic. Reviewer-caught.
     *
     * ⛔ AND ONLY THE SHOP'S OWN HANDLE REDIRECTS. `row.seller` is a handle attached to the SELLER;
     * `row.profile?.seller` is a PERSON's handle who happens to own a shop, and those are different
     * strings in one namespace. Sending `alice` to `alice.eno.vn` publishes a subdomain for a
     * handle the shop does not hold — and the `/sellers/{id}` fallback elsewhere proves a
     * handle-less seller is a real state. A person's handle keeps rendering the shop in place.
     */
    if (await isSellerHiddenHere(sellerId)) notFound()
    // ⚠️ A GONE shop (ownerless, nothing public — src/lib/storefront-gone.ts) 404s one step down, in
    // BOTH branches: SubdomainStorefront and SellerStorefront each notFound() when `loadSeller` is
    // null. Not repeated here, where it would serialise that read ahead of their parallel queries on
    // every storefront view to save work only on the rare gone one.
    if (row.seller?.id) {
      /**
       * ⛔ SUPERSEDED 2026-09-13 — NO REDIRECT, THE SHOP RENDERS RIGHT HERE. Owner: "when seller clicks
       * my storefront use page redirect only; when user selects to share storefront use slug like
       * vietkite.eno.vn or vietkite.eno.forum". This path is the dashboard's "View storefront" link, and
       * the 2026-09-07 307 to `<handle>.eno.vn` took the seller out of the app. The full shop — the same
       * component the subdomain rewrite serves, so the two URLs are one product — renders in place;
       * the subdomain is what the Share button hands out, and stays the canonical in generateMetadata.
       * ⚠️ `storefrontByHandle` is the same question `/s/<handle>` asks (null for a handle that matches a
       * brand slug), so a shop that page would 404 keeps the profile-shaped storefront below.
       * The hidden check above still runs first.
       */
      if (await storefrontByHandle(row.handle)) return <SubdomainStorefront params={Promise.resolve({ handle: row.handle })} />
    }
    return <SellerStorefront id={sellerId} />
  }
  if (!row.profile) notFound()

  const name = row.profile.displayName || `@${row.handle}`
  const memberYear = new Date(row.profile.createdAt).getFullYear()

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-12">
        <div className="mx-auto max-w-md rounded-2xl bg-popover p-8 text-center shadow-xs">
          <Avatar name={name} url={row.profile.avatarUrl} color={row.profile.avatarColor} size="2xl" className="mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-foreground">{name}</h1>
          <p className="mt-0.5 text-sm font-semibold text-accent-foreground">@{row.handle}</p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> <Tr text="Member since" /> {memberYear}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-body">
            <Tr text="This member hasn't opened a shop yet. Browse the marketplace to see what's for sale." />
          </p>
          <Button asChild variant="cta" size="none" className="active:scale-[0.96]">
            <Link href="/" className="mt-4 cursor-pointer px-5 py-2.5 text-sm">
              <Tr text="Explore listings" />
            </Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
