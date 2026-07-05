import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import type { SerializedCategory } from '@/lib/types'
import { getCurrentProfile } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard, type ListingEditData } from '@/components/marketplace/post-wizard'
import { safeParse, serializeCategoryBasic } from '@/lib/serialize'
import { categoryHasBrand } from '@/lib/taxonomy'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

// Owner-only edit screen — the SAME full post wizard, prefilled with the listing's
// data, so editing is "post again with everything filled in". Re-checks ownership
// server-side (Prisma bypasses RLS), then the wizard PATCHes back on save.
export default async function EditListingPage({ params }: Props) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect(`/signin?next=/listings/${id}/edit`)

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, sellerId: true, title: true, description: true, price: true,
      categoryId: true, subcategorySlug: true, listingType: true, condition: true,
      brandSlug: true, model: true, attributes: true,
      year: true, mileageKm: true, engineL: true, engineCc: true,
      district: true, city: true, lat: true, lng: true, images: true,
      category: { select: { slug: true } },
    },
  })
  if (!listing) notFound()
  // Not your storefront's listing → 404 (don't reveal it exists).
  if (!seller || listing.sellerId !== seller.id) notFound()

  const showBrand = categoryHasBrand(listing.category.slug)
  const brandName = showBrand && listing.brandSlug
    ? (await db.brand.findUnique({ where: { slug: listing.brandSlug }, select: { name: true } }))?.name ?? null
    : null

  // Categories for the wizard's (locked-in-edit) picker — same shape as /post.
  const cats = await db.category.findMany({ orderBy: { name: 'asc' } })
  const categories: SerializedCategory[] = cats.map(serializeCategoryBasic)

  const edit: ListingEditData = {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    categorySlug: listing.category.slug,
    subcategorySlug: listing.subcategorySlug,
    listingType: listing.listingType,
    condition: listing.condition,
    brand: brandName,
    model: showBrand ? listing.model : null,
    attributes: safeParse<Record<string, string>>(listing.attributes, {}),
    year: listing.year,
    mileageKm: listing.mileageKm,
    engineL: listing.engineL,
    engineCc: listing.engineCc,
    district: listing.district,
    city: listing.city,
    lat: listing.lat,
    lng: listing.lng,
    images: safeParse<string[]>(listing.images, []),
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <PostWizard categories={categories} edit={edit} />
      </main>
      <Footer />
    </div>
  )
}
