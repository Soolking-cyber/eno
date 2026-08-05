import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { db } from '@/lib/db'
import { HANDLE_RE } from '@/lib/handle'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerStorefront, loadSeller } from '@/components/marketplace/seller-storefront'
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

  // Storefront handle — or a user who owns a storefront: render the shop in place so
  // the clean handle is the URL people see and share (no bounce to /sellers/<id>).
  const sellerId = row.seller?.id ?? row.profile?.seller?.id
  if (sellerId) return <SellerStorefront id={sellerId} />
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
            <CalendarDays className="h-3.5 w-3.5" /> <Tr text="Member since" /> {memberYear}
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
