import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { checkListingOwner } from '@/lib/listing-owner'
import { containsPhoneNumber } from '@/lib/phone'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'

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
    select: { title: true, description: true, district: true, category: { select: { name: true, nameVi: true } } },
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
    data.location = district || 'Ho Chi Minh City'
  }
  if (body.condition !== undefined) data.condition = body.condition ? String(body.condition).trim() : null
  if (Array.isArray(body.images)) {
    const images = (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    data.images = JSON.stringify(images)
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true })

  // Rebuild the folded search blob from the new values (fall back to current).
  const newTitle = (data.title as string) ?? current.title
  const newDesc = (data.description as string) ?? current.description
  const newDistrict = (data.district as string | null) ?? current.district
  data.searchText = buildSearchText([newTitle, newDesc, newDistrict, current.category.name, current.category.nameVi])

  await db.listing.update({ where: { id }, data })
  revalidatePath(`/listings/${id}`) // purge the cached (ISR) detail page so the edit shows

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
  await db.listing.delete({ where: { id } })
  revalidatePath(`/listings/${id}`)
  return NextResponse.json({ ok: true })
}
