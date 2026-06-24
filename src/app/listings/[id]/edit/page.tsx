import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ListingEditor } from '@/components/marketplace/listing-editor'
import { safeParse } from '@/lib/serialize'
import { categoryHasBrand } from '@/lib/taxonomy'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

// Owner-only edit screen. Re-checks ownership server-side (Prisma bypasses RLS),
// then hands the editable fields to the client editor (which PATCHes back).
export default async function EditListingPage({ params }: Props) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect(`/signin?next=/listings/${id}/edit`)

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, sellerId: true, title: true, description: true, price: true, district: true, condition: true, brandSlug: true, model: true, images: true, currency: true, category: { select: { slug: true } } },
  })
  if (!listing) notFound()
  // Not your storefront's listing → 404 (don't reveal it exists).
  if (!seller || listing.sellerId !== seller.id) notFound()

  const showBrand = categoryHasBrand(listing.category.slug)
  const brand = showBrand && listing.brandSlug
    ? (await db.brand.findUnique({ where: { slug: listing.brandSlug }, select: { name: true } }))?.name ?? null
    : null

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <ListingEditor
          listing={{
            id: listing.id,
            title: listing.title,
            description: listing.description,
            price: listing.price,
            district: listing.district,
            condition: listing.condition,
            brand,
            model: showBrand ? listing.model : null,
            showBrand,
            images: safeParse<string[]>(listing.images, []),
            currency: listing.currency,
          }}
        />
      </main>
      <Footer />
    </div>
  )
}
