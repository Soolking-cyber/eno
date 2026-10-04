import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Mascot } from '@/components/marketplace/mascot'
import { Tr } from '@/context/language-context'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { Button } from '@/components/ui/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { EmptyState } from '@/components/ui/empty-state'
import { db } from '@/lib/db'
import { brandIconPath } from '@/lib/brand-icons'
import { brandLogoUrl } from '@/lib/brand-logo-url'
import { listedBrands, liveBrandCounts } from '@/lib/live-brands'
import { localizedHref } from '@/lib/lang-pinned'

export const metadata: Metadata = {
  title: `Brands | ${SITE_NAME}`,
  description: 'Browse listings by brand on eno.vn — phones, laptops, motorbikes, fashion and more from the brands buyers in Vietnam search for.',
  alternates: { canonical: '/brands' },
}

// Brand directory refreshes hourly — the catalogue grows slowly and rankings are
// listing-count based, so first-paint can be cached aggressively.
// 1h, down from 6h (2026-10-04): tiles now come from LIVE listings (src/lib/live-brands.ts), and a brand that
// sells out should leave /brands within the hour, not up to six — one cheap regeneration per hour per language.
export const revalidate = 3600

export default async function BrandsPage({ params }: { params: Promise<{ lang: string }> }) {
  // The page's language: a Vietnamese render links the `/vi` home twin, never the English-pinned `/` (A1-LANG).
  const { lang } = await params
  const home = (href: string) => localizedHref(href, lang === 'vi' ? 'vi' : 'en')
  // Brands with LIVE listings only, most-listed first, each with the count `/?brand=<slug>` returns
  // (src/lib/live-brands.ts). Resolve each brand's monotone logo server-side so simple-icons never
  // reaches the client.
  // ⛔ CURATION NO LONGER BUYS A TILE. This page used to add every curated brand (`curatedAt` set, the
  // seeded top-100) as a day-one brand wall, with an "Explore" label where a count would be. After the
  // new-goods catalogues were hidden that was 66 tiles — Casio, Adidas, Audi, BMW, Chanel… — each opening
  // an empty explorer (verify, 2026-10-04). Curation still supplies the logo and the aliases; a curated
  // brand reappears here by itself once one of its listings is live.
  // Defensive: only a genuinely missing table (pre-migration build, Prisma P2021) falls back to empty.
  // Transient DB errors RETHROW so ISR keeps serving the last good HTML instead of caching a false
  // "No brands" page for the revalidate window.
  const brands = await liveBrandCounts()
    .then(async (live) => listedBrands(
      await db.brand.findMany({
        where: { status: 'active', slug: { in: [...live.keys()] } },
        select: { slug: true, name: true, iconSlug: true, logoPath: true },
      }),
      live,
    ))
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'P2021') return []
      throw error
    })
  /* ⛔ `iconUrl` KEEPS 648 kB OF INLINE SVG OUT OF THIS PAGE. A curated logo is a full `<svg>` that
     BrandLogo would otherwise percent-encode into a `data:` URI per instance — measured 2026-09-20:
     176 of them, 28% of a 2.27 MB page. Served from /api/brand-logo instead, it is fetched once and
     cached for a year. Brands on simple-icons path data are unaffected and still inline (they are
     one short `d` attribute, not a document).
     ⚠️ `iconPath` IS WITHHELD WHENEVER `iconUrl` IS SET, and that is not tidiness. Props are
     serialised into the RSC flight payload whether the component reads them or not, so passing
     both would keep shipping the full ~241 kB of SVG source that this change exists to remove —
     it would just no longer be percent-encoded. A reviewer caught that. */
  const items = brands.map((b) => ({ ...b, iconPath: brandIconPath(b), iconUrl: brandLogoUrl(b) }))

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* The family's statement header: breadcrumb → h-display → measured lede → hairline.
            Same pattern (and frame paddings) as /c/[category]. */}
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              {/* Base UI render prop (never asChild) — keeps the Next.js client-side nav. */}
              <BreadcrumbLink render={<Link href={home('/')} />} className="hover:text-accent-foreground"><Tr text="Home" /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><Tr text="Brands" /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="h-display text-foreground">
          <Tr text="Browse by brand" />
        </h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          <Tr text="Jump straight to listings from the brands people search for most." />
        </p>

        {/* Masthead boundary — on the content box, like the tiles under it (C1-HAIRLINE). */}
        <div aria-hidden className="mt-8 border-t border-border" />

        {items.length === 0 ? (
          <EmptyState
            tone="bare"
            size="lg"
            media={<Mascot name="search" className="h-40 w-40" />}
            title={<Tr text="No brands yet — they appear as sellers post." />}
            action={
              <Button asChild variant="cta" size="none">
                <Link
                  href={home('/')}
                  className="px-5 py-2.5"
                >
                  <Tr text="Browse all listings" />
                </Link>
              </Button>
            }
          />
        ) : (
          /* Hairline tiles, not tint fills — flat canon (lines separate, boxes don't). Every tile
             shares one structure (44px logo box → one-line name → one-line meta) so heights stay
             equal across the wall; logos never move on hover, only the surface responds. */
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
            {items.map((b) => (
              <Link
                key={b.slug}
                href={home(`/?brand=${encodeURIComponent(b.slug)}`)}
                className="flex flex-col items-center gap-3 rounded-2xl border border-border px-4 py-6 text-center transition-colors hover:border-line-strong hover:bg-muted active:bg-muted"
              >
                <BrandLogo name={b.name} iconPath={b.iconUrl ? null : b.iconPath} iconUrl={b.iconUrl} size={44} />
                <span className="line-clamp-1 text-sm font-semibold text-foreground">{b.name}</span>
                <span className="text-xs text-muted-foreground">
                  {b.count} {b.count === 1 ? <Tr text="listing" /> : <Tr text="listings" />}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
