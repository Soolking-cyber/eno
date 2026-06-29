import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { isListingImageUrl } from '@/lib/listing-image'
import { recordProfileComplete } from '@/lib/trust'

// Storefront (Seller) edit core — decoupled from auth, takes the already-resolved
// sellerId + owning profileId. Shared by the dashboard PATCH /api/seller and the partner
// PATCH /api/v1/shop. Sparse: only present fields change. Returns a validation error code
// or { ok: true }; one-time trust bonus once the profile is fully filled out.
export async function updateSellerCore(
  sellerId: string,
  profileId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: number; error: string }> {
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120)
    if (name.length < 2) return { ok: false, code: 400, error: 'name_too_short' }
    data.name = name
  }
  if (body.bio !== undefined) data.bio = String(body.bio).trim().slice(0, 1000) || null
  if (body.location !== undefined) data.location = String(body.location).trim().slice(0, 120) || null
  if (body.avatarUrl !== undefined) {
    const url = body.avatarUrl ? String(body.avatarUrl) : null
    if (url && !isListingImageUrl(url)) return { ok: false, code: 400, error: 'bad_avatar' }
    data.avatarUrl = url
  }
  // Contact phone (the in-chat reveal number; gated, never shown publicly).
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone || ''))
    if (body.phone && phone.replace(/\D/g, '').length < 9) return { ok: false, code: 400, error: 'bad_phone' }
    // One number ↔ one account: reject a number already tied to another account.
    if (phone && (await phoneTakenByOther(phone, profileId))) return { ok: false, code: 409, error: 'phone_taken' }
    data.phone = phone || null
  }
  // Public-facing text can't carry a phone number (same rule as listings).
  if (containsPhoneNumber(String(data.name ?? '')) || containsPhoneNumber(String(data.bio ?? ''))) {
    return { ok: false, code: 400, error: 'no_phone_in_profile' }
  }

  if (Object.keys(data).length === 0) return { ok: true }
  let updated
  try {
    updated = await db.seller.update({ where: { id: sellerId }, data, select: { name: true, bio: true, location: true, avatarUrl: true, phone: true } })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return { ok: false, code: 409, error: 'phone_taken' } // Seller.phone unique
    throw e
  }
  // One-time trust bonus once the storefront is fully filled out.
  if (updated.name && updated.bio && updated.location && updated.avatarUrl && updated.phone) {
    after(() => recordProfileComplete(profileId).catch(() => {}))
  }
  return { ok: true }
}
