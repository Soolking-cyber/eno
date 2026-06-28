import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { checkListingOwner } from '@/lib/listing-owner'
import { containsPhoneNumber } from '@/lib/phone'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'
import { categoryHasBrand, resolveBrand, bumpBrandCount } from '@/lib/brand'
import { rangeFacetsFor, subcategoriesFor, typesFor } from '@/lib/taxonomy'
import { reindexListing, removeFromIndex } from '@/lib/listing-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PATCH — a seller edits their OWN listing (title/description/price/district/
// condition/images). Category isn't editable here. Re-runs the same guards as
// create: phone-in-text block, image allowlist, searchText rebuild, re-warm.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const current = await db.listing.findUnique({
    where: { id },
    select: { title: true, description: true, district: true, location: true, brandSlug: true, model: true, subcategorySlug: true, verified: true, images: true, seller: { select: { trustTier: true } }, category: { select: { slug: true, name: true, nameVi: true } } },
  })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const data: Record<string, unknown> = {}

  const title = body.title !== undefined ? String(body.title).trim().slice(0, 140) : undefined
  const description = body.description !== undefined ? String(body.description).trim().slice(0, 5000) : undefined
  const contactName = body.contactName !== undefined ? String(body.contactName).trim().slice(0, 80) : undefined

  if (title !== undefined) {
    if (title.length < 3) return NextResponse.json({ error: 'title_too_short' }, { status: 400 })
    data.title = title
    data.titleVi = null // drop the stale VI title; display falls back to the new EN title (re-warmed below)
  }
  if (description !== undefined) data.description = description

  // Phone numbers are never allowed in public text (same rule as create).
  if (containsPhoneNumber(title ?? '') || containsPhoneNumber(description ?? '') || containsPhoneNumber(contactName ?? '')) {
    return NextResponse.json({ error: 'no_phone_in_listing' }, { status: 400 })
  }

  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0 || price > 1e12) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
    data.price = price
  }
  if (body.district !== undefined) {
    const district = body.district ? String(body.district).trim().slice(0, 80) : null
    data.district = district
    // Don't stomp the listing's city with a hardcoded "Ho Chi Minh City" (wrong for
    // every non-HCMC listing). Use the new district as the display location; if it's
    // cleared, keep the existing location (a non-nullable column — never write null).
    data.location = district || current.location
  }
  if (body.condition !== undefined) data.condition = body.condition ? String(body.condition).trim() : null
  if (Array.isArray(body.images)) {
    const images = (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    data.images = JSON.stringify(images)
  }

  // Subcategory — must belong to the listing's (unchanged) category.
  if (body.subcategorySlug !== undefined) {
    const sc = body.subcategorySlug ? String(body.subcategorySlug).trim() : null
    if (!sc || subcategoriesFor(current.category.slug).some((s) => s.slug === sc)) data.subcategorySlug = sc
  }
  // Intent (listingType) — must be valid for the category.
  if (body.listingType !== undefined) {
    const lt = String(body.listingType).trim()
    if ((typesFor(current.category.slug) as string[]).includes(lt)) data.listingType = lt
  }
  // Attribute facets — whitelisted stringly-typed taxonomy values (same rule as create).
  if (body.attributes !== undefined) {
    const clean: Record<string, string> = {}
    if (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
      for (const [k, v] of Object.entries(body.attributes as Record<string, unknown>)) {
        if (typeof v === 'string' && v && /^[a-z0-9_]+$/i.test(k)) clean[k] = v.slice(0, 40)
      }
    }
    data.attributes = Object.keys(clean).length ? JSON.stringify(clean) : null
  }
  // Precise pin from "use my current location".
  if (body.city !== undefined && body.city) data.city = String(body.city).trim().slice(0, 80)
  if (body.lat !== undefined) { const n = Number(body.lat); data.lat = Number.isFinite(n) && n >= -90 && n <= 90 ? n : null }
  if (body.lng !== undefined) { const n = Number(body.lng); data.lng = Number.isFinite(n) && n >= -180 && n <= 180 ? n : null }

  // Brand edit (product categories only) — re-resolve into the catalogue and move
  // the listing-count from the old brand to the new one. Best-effort; never blocks.
  let brandChange: { from: string | null; to: string | null } | null = null
  if (body.brand !== undefined && categoryHasBrand(current.category.slug)) {
    const raw = body.brand ? String(body.brand) : ''
    const next = raw.trim() ? await resolveBrand(raw).catch(() => null) : null
    if (next !== current.brandSlug) {
      data.brandSlug = next
      brandChange = { from: current.brandSlug, to: next }
      if (!next) data.model = null // brand cleared → model is meaningless
    }
  }
  // Model edit (product categories only) — kept alongside a brand.
  if (body.model !== undefined && categoryHasBrand(current.category.slug)) {
    const effectiveBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
    data.model = effectiveBrand && body.model ? (String(body.model).trim().slice(0, 60) || null) : null
  }

  // Range specs (year/mileage/engine) → clamped to the category's declared range.
  // An explicit null/'' clears the spec; an omitted key leaves it untouched.
  for (const f of rangeFacetsFor(current.category.slug, current.subcategorySlug)) {
    const col = f.range.column
    if (body[col] === undefined) continue
    if (body[col] === null || body[col] === '') { data[col] = null; continue }
    const raw = Number(body[col])
    if (!Number.isFinite(raw)) continue
    const clamped = Math.min(Math.max(raw, f.range.min), f.range.max)
    data[col] = col === 'engineL' ? Math.round(clamped * 10) / 10 : Math.round(clamped)
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true })

  // Rebuild the folded search blob from the new values (fall back to current).
  const newTitle = (data.title as string) ?? current.title
  const newDesc = (data.description as string) ?? current.description
  const newDistrict = (data.district as string | null) ?? current.district
  const newBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
  const newModel = (data.model as string | null | undefined) ?? current.model
  data.searchText = buildSearchText([newTitle, newDesc, newDistrict, current.category.name, current.category.nameVi, newBrand, newModel])

  // Republish a HELD listing (verified=false — it was photoless or the seller was
  // Restricted) the moment it becomes eligible again: adding a photo to a held listing
  // must make it public, not leave it dead inventory (manual moderation was removed).
  // The publish gate mirrors create: >=1 image AND a non-restricted seller. The PATCH's
  // reindex after() then indexes it for AI search since verified flips to true.
  if (current.verified === false && current.seller?.trustTier !== 'restricted') {
    let imgs: string[] = []
    try { imgs = data.images !== undefined ? JSON.parse(data.images as string) : JSON.parse(current.images || '[]') } catch { imgs = [] }
    if (imgs.length >= 1) data.verified = true
  }

  await db.listing.update({ where: { id }, data })
  if (brandChange) after(() => Promise.all([
    brandChange!.from ? bumpBrandCount(brandChange!.from, -1) : Promise.resolve(),
    brandChange!.to ? bumpBrandCount(brandChange!.to, 1) : Promise.resolve(),
  ]))
  revalidatePath(`/listings/${id}`) // purge the cached (ISR) detail page so the edit shows
  after(() => reindexListing(id)) // refresh the AI-search document with the edited fields

  // Re-warm translations for any changed user text (after the response flushes).
  const warm = [data.title as string, data.description as string, data.location as string].filter(Boolean)
  if (warm.length) after(() => warmTranslations(warm))

  return NextResponse.json({ ok: true })
}

// DELETE — a seller removes their OWN listing (cascades reports/conversations).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })
  const gone = await db.listing.findUnique({ where: { id }, select: { brandSlug: true } })
  await db.listing.delete({ where: { id } })
  if (gone?.brandSlug) after(() => bumpBrandCount(gone.brandSlug!, -1))
  revalidatePath(`/listings/${id}`)
  after(() => removeFromIndex(id)) // drop the deleted listing from AI search
  return NextResponse.json({ ok: true })
}
