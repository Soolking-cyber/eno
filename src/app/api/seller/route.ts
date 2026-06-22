import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { isListingImageUrl } from '@/lib/listing-image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A seller edits their OWN storefront (business profile). Owner-scoped via
// getCurrentProfile() → the Seller with ownerId === profile.id.
export async function PATCH(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120)
    if (name.length < 2) return NextResponse.json({ error: 'name_too_short' }, { status: 400 })
    data.name = name
  }
  if (body.bio !== undefined) data.bio = String(body.bio).trim().slice(0, 1000) || null
  if (body.location !== undefined) data.location = String(body.location).trim().slice(0, 120) || null
  if (body.avatarUrl !== undefined) {
    const url = body.avatarUrl ? String(body.avatarUrl) : null
    if (url && !isListingImageUrl(url)) return NextResponse.json({ error: 'bad_avatar' }, { status: 400 })
    data.avatarUrl = url
  }
  // Contact phone (the in-chat reveal number; gated, never shown publicly).
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone || ''))
    if (body.phone && phone.replace(/\D/g, '').length < 9) return NextResponse.json({ error: 'bad_phone' }, { status: 400 })
    data.phone = phone || null
  }

  // Public-facing text can't carry a phone number (same rule as listings).
  if (containsPhoneNumber(String(data.name ?? '')) || containsPhoneNumber(String(data.bio ?? ''))) {
    return NextResponse.json({ error: 'no_phone_in_profile' }, { status: 400 })
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true })
  try {
    await db.seller.update({ where: { id: seller.id }, data })
  } catch (e) {
    // Seller.phone is unique — another storefront already claimed it.
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
    throw e
  }
  return NextResponse.json({ ok: true })
}
