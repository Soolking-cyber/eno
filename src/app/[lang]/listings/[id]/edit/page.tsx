import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import type { SerializedCategory } from '@/lib/types'
import { getCurrentProfile } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard, type ListingEditData } from '@/components/marketplace/post-wizard'
import { safeParse, serializeCategoryBasic } from '@/lib/serialize'
import { categoryHasBrand, isPostableCategory, NON_POSTING_CATEGORIES, paysSalary, salaryMFromPrice } from '@/lib/taxonomy'
import { LISTING_REMOVED } from '@/lib/listing-removed'

/** A pre-salary-rule job's monthly price as whole millions on the salary facet's scale, or null.
 *  ⚠️ ROUNDED DOWN (salaryMFromPrice), never to the nearest: an untouched 12,500,000 ₫ job opened and
 *  saved must not come out advertising 13 tr/tháng. The Salary line under the box shows the figure the
 *  save will post, so the employer sees the 12 before saving. */
function legacyJobSalaryM(l: { listingType: string; price: number; category: { slug: string } }): number | null {
  return paysSalary(l.listingType) ? salaryMFromPrice(l.price, l.category.slug) : null
}

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

// Owner-only edit screen — the SAME full post wizard, prefilled with the listing's
// data, so editing is "post again with everything filled in". Re-checks ownership
// server-side (Prisma bypasses RLS), then the wizard PATCHes back on save.
export default async function EditListingPage({ params }: Props) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect(`/signin?next=/listings/${id}/edit`)

  // The three lookups are independent — run them in parallel (force-dynamic route,
  // every request pays these round-trips serially otherwise).
  const [seller, listing, cats] = await Promise.all([
    db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } }),
    db.listing.findUnique({
      where: { id },
      select: {
        id: true, sellerId: true, title: true, description: true, price: true, negotiable: true, urgentUntil: true,
        categoryId: true, subcategorySlug: true, listingType: true, condition: true,
        brandSlug: true, model: true, attributes: true,
        year: true, mileageKm: true, engineL: true, engineCc: true, areaM2: true, salaryM: true,
        district: true, city: true, lat: true, lng: true, images: true, video: true, status: true,
        category: { select: { slug: true } },
      },
    }),
    // Categories for the wizard's (locked-in-edit) picker — same shape as /post.
    db.category.findMany({ where: { slug: { notIn: [...NON_POSTING_CATEGORIES] } }, orderBy: { name: 'asc' } }),
  ])
  // A tombstone (src/lib/listing-removed.ts) cannot be edited back to life — 404 like a missing row.
  if (!listing || listing.status === LISTING_REMOVED) notFound()
  // Not your storefront's listing → 404 (don't reveal it exists).
  if (!seller || listing.sellerId !== seller.id) notFound()
  // A teacher profile is edited in the teacher form, never the post wizard (NON_POSTING_CATEGORIES).
  if (!isPostableCategory(listing.category.slug)) redirect('/teachers/edit')

  const showBrand = categoryHasBrand(listing.category.slug)
  const brandName = showBrand && listing.brandSlug
    ? (await db.brand.findUnique({ where: { slug: listing.brandSlug }, select: { name: true } }))?.name ?? null
    : null

  const categories: SerializedCategory[] = cats.map(serializeCategoryBasic)

  const edit: ListingEditData = {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    negotiable: listing.negotiable,
    urgent: !!listing.urgentUntil && listing.urgentUntil.getTime() > Date.now(),
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
    areaM2: listing.areaM2,
    // ⛔ A JOB'S PAY IS ITS SALARY (taxonomy.ts paysSalary), and the wizard edits it through the salary
    // slider. A job posted before that rule carried a typed monthly PRICE and often no salaryM — seed the
    // slider from that price (whole millions, clamped to the facet's range) so the employer edits the
    // pay their post already states instead of finding it blank and saving it away as "Negotiable".
    salaryM: listing.salaryM ?? legacyJobSalaryM(listing),
    district: listing.district,
    city: listing.city,
    lat: listing.lat,
    lng: listing.lng,
    images: safeParse<string[]>(listing.images, []),
    video: listing.video,
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
