import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import type { SerializedCategory } from '@/lib/types'
import { getCurrentProfile } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard, type ListingEditData } from '@/components/marketplace/post-wizard'
import { safeParse, serializeCategoryBasic } from '@/lib/serialize'
import { categoryHasBrand, isPostableCategory, LICENCE_CHECK_SUBCATEGORIES, NON_POSTING_CATEGORIES, paysSalary, salaryMFromPrice } from '@/lib/taxonomy'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { deskSellerIds } from '@/lib/edition-scope'
import { LICENCE_WHITELIST, licenceCleared } from '@/lib/licence-stamp'
import { editFormAttributes } from '@/lib/multi-facet'

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

  // The four lookups are independent — run them in parallel (force-dynamic route,
  // every request pays these round-trips serially otherwise).
  const [seller, listing, cats, deskIds] = await Promise.all([
    db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } }),
    db.listing.findUnique({
      where: { id },
      select: {
        id: true, sellerId: true, title: true, description: true, price: true, negotiable: true, urgentUntil: true,
        categoryId: true, subcategorySlug: true, listingType: true, condition: true,
        brandSlug: true, model: true, attributes: true, priceUnit: true,
        // A seller's multi-select picks (apartment amenities) live here, not in `attributes` — the chips open on them.
        facetTokens: true,
        year: true, mileageKm: true, engineL: true, engineCc: true, areaM2: true, salaryM: true,
        district: true, city: true, lat: true, lng: true, images: true, video: true, status: true,
        // The licence-check stamp (src/lib/licence-stamp.ts) — read for `edit.licence` below, never sent to the client.
        verificationMethod: true,
        category: { select: { slug: true } },
      },
    }),
    // Categories for the wizard's (locked-in-edit) picker — same shape as /post.
    db.category.findMany({ where: { slug: { notIn: [...NON_POSTING_CATEGORIES] } }, orderBy: { name: 'asc' } }),
    // eno's own desk is exempt from the licence check. A failed read counts as "not the desk": the form then asks for the
    // provider's values, which is the fail-closed side — and only the UI's; the save decides on the server.
    deskSellerIds().catch(() => [] as string[]),
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

  // ⛔ WHERE THE LISTING STANDS WITH eno'S LICENCE CHECK (owner, 2026-10-14 — e-Visa and Legal & permits): approved = its
  // stamp is the stamp of exactly its values (always true outside the two aisles, and for the desk). It decides only what
  // the wizard SHOWS — the resubmit note, or the quiet "changing either sends it back" hint — and the stamp itself stays
  // on the server; updateListingCore decides the hold.
  // The AISLES this storefront is exempt in: every one for eno's desk; a whitelisted storefront's own (licence-whitelist.ts —
  // owner, 2026-10-15). Per aisle, so the form asks for the values again when the seller picks an aisle the whitelist
  // does not cover — the server decides the same way (updateListingCore, by the row's TARGET aisle).
  const exemptAisles: string[] = deskIds.includes(listing.sellerId)
    ? [...LICENCE_CHECK_SUBCATEGORIES]
    : LICENCE_WHITELIST.filter((w) => w.sellerId === listing.sellerId).flatMap((w) => [...w.aisles])
  const desk = exemptAisles.includes(listing.subcategorySlug ?? '')
  const licence = {
    approved: licenceCleared({ categorySlug: listing.category.slug, subcategorySlug: listing.subcategorySlug, sellerId: listing.sellerId, attributes: listing.attributes, verificationMethod: listing.verificationMethod }, { desk }),
    exempt: desk,
    exemptAisles,
  }

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
    // ⛔ …WITH THE MULTI-SELECT PICKS FROM `facetTokens` (apartment amenities, owner 2026-10-20): the form sends that facet on
    // every save and the server REPLACES it, so a form opened without them would save an apartment's amenities away.
    attributes: editFormAttributes(safeParse<Record<string, string>>(listing.attributes, {}), listing.facetTokens, listing.category.slug, listing.subcategorySlug, listing.listingType),
    // The stored unit is what buyers see — a rent edit opens its period chip on it (initAttrsFromEdit).
    priceUnit: listing.priceUnit,
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
    licence,
  }

  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <PostWizard categories={categories} edit={edit} />
      </main>
      <Footer />
    </div>
  )
}
