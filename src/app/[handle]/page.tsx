import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays } from '@/components/ui/icons'
import { db } from '@/lib/db'
import { HANDLE_RE } from '@/lib/handle'
import { storefrontBaseHost, storefrontUrl } from '@/lib/storefront-host'
import { storefrontByHandle } from '@/lib/storefront'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerStorefront, loadSeller } from '@/components/marketplace/seller-storefront'
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

type Props = { params: Promise<{ handle: string }> }

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
  if (seller && await isSellerHiddenHere(seller.id)) {
    return { title: 'Not found', robots: { index: false, follow: false } }
  }
  if (seller) {
    // Compose a real description from the storefront data the page itself loads —
    // loadSeller is React-cache()d, so this is the SAME DB read SellerStorefront
    // makes for the render, not an extra query. Falls back to the bare name if the
    // storefront row vanished between resolve() and here.
    const shop = await loadSeller(seller.id)
    const count = shop?.listings.length ?? 0
    const cats = shop ? [...new Set(shop.listings.map((l) => l.category.name))].slice(0, 3) : []
    const tierWord = shop?.trustTier === 'exceptional' ? 'Top-rated seller' : shop?.trustTier === 'trusted' ? 'Trusted seller' : ''
    const bits = [
      count > 0 ? `${count} listing${count === 1 ? '' : 's'}${cats.length ? ` in ${cats.join(', ')}` : ''}` : '',
      shop?.location || '',
      tierWord,
    ].filter(Boolean)
    const description = bits.length ? `${seller.name} — ${bits.join(' · ')} on eno.vn` : `${seller.name} on eno.vn`
    return {
      title: `${seller.name} | ${SITE_NAME}`,
      description,
      alternates: { canonical: `${hostUrl}/${row.handle}` },
      openGraph: {
        title: `${seller.name} | ${SITE_NAME}`,
        description,
        url: `${hostUrl}/${row.handle}`,
      },
    }
  }
  return {
    title: `@${row.handle} | ${SITE_NAME}`,
    description: `${row.profile?.displayName || `@${row.handle}`} on eno.vn`,
    openGraph: {
      title: `@${row.handle} | ${SITE_NAME}`,
      description: `${row.profile?.displayName || `@${row.handle}`} on eno.vn`,
      url: `${hostUrl}/${row.handle}`,
    },
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
    if (row.seller?.id) {
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? ''
      const canonical = storefrontUrl(row.handle, origin)
      /**
       * ⚠️ ONLY WHEN THE SUBDOMAIN CAN ACTUALLY RESOLVE. `storefrontUrl()` falls back to the path
       * form for a handle that cannot be a host, and it lowercases both branches — so comparing
       * against the path form is a reliable "did it give me a subdomain", with no loop. On a local
       * preview it returns `http://<handle>.localhost:3000`, which Chrome resolves but curl,
       * Playwright and the guest e2e suite do not; a base host with no dot renders in place.
       */
      const pathForm = `${origin.replace(/\/$/, '')}/${row.handle.toLowerCase()}`
      const baseHost = storefrontBaseHost(origin)
      /**
       * ⚠️ A DOT IS NOT ENOUGH — AN IP HAS DOTS TOO. A preview served from `http://127.0.0.1:3000`
       * passes a naive dotted-host test and would redirect to `shop.127.0.0.1:3000`, which resolves
       * nowhere. Only a name can carry a wildcard subdomain.
       */
      const realDomain = baseHost.includes('.') && !/^[\d.]+(:\d+)?$/.test(baseHost)
      /**
       * ⛔ ONLY REDIRECT WHERE THE DESTINATION ACTUALLY RESOLVES. `/s/<handle>` 404s when
       * `storefrontByHandle` returns null, and it returns null for a handle that matches a BRAND
       * slug — so a shop holding such a handle would have been bounced from a working page to a
       * 404. Asking the same question the destination asks is the only way to be sure the two
       * agree; it is one indexed lookup, on the redirect path only.
       */
      if (realDomain && canonical !== pathForm && await storefrontByHandle(row.handle)) redirect(canonical)
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
