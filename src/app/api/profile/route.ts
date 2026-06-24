import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { isListingImageUrl } from '@/lib/listing-image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Edit the signed-in user's OWN profile (the person/account — distinct from the
// business storefront, which is PATCH /api/seller). For an individual this is
// their account; for a business it's the representative behind the account.
export async function PATCH(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const data: Record<string, unknown> = {}
  if (body.displayName !== undefined) {
    const name = String(body.displayName).trim().slice(0, 80)
    if (name.length < 2) return NextResponse.json({ error: 'name_too_short' }, { status: 400 })
    if (containsPhoneNumber(name)) return NextResponse.json({ error: 'no_phone_in_name' }, { status: 400 })
    data.displayName = name
  }
  if (body.avatarUrl !== undefined) {
    const url = body.avatarUrl ? String(body.avatarUrl) : null
    if (url && !isListingImageUrl(url)) return NextResponse.json({ error: 'bad_avatar' }, { status: 400 })
    data.avatarUrl = url
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone || ''))
    if (body.phone && phone.replace(/\D/g, '').length < 9) return NextResponse.json({ error: 'bad_phone' }, { status: 400 })
    // One number ↔ one account (any format). Reject if another account already uses
    // it — as their profile phone or storefront contact.
    if (phone && await phoneTakenByOther(phone, profile.id)) return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
    data.phone = phone || null
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true })
  try {
    await db.profile.update({ where: { id: profile.id }, data })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
    throw e
  }
  return NextResponse.json({ ok: true })
}
