import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { isListingImageUrl } from '@/lib/listing-image'
import { recordProfileComplete } from '@/lib/trust'
import { lookupTaxCode, TAX_FACTS_TTL_MS } from '@/lib/tax-lookup'

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
  // ── Legal identity (Đ.29 ND52 / Law 122/2025 collection duty). Stored, provided
  //    to buyers on request + authorities; idNumber/taxCode never render publicly. ──
  let identityTouched = false
  if (body.legalName !== undefined) {
    data.legalName = String(body.legalName).trim().slice(0, 160) || null
    identityTouched = true
  }
  if (body.legalAddress !== undefined) {
    data.legalAddress = String(body.legalAddress).trim().slice(0, 240) || null
    identityTouched = true
  }
  if (body.idNumber !== undefined) {
    const digits = String(body.idNumber).replace(/\D/g, '')
    // CMND 9 / ERC 10 / CCCD 12 — accept the range, reject noise.
    if (digits && (digits.length < 9 || digits.length > 13)) return { ok: false, code: 400, error: 'bad_id_number' }
    data.idNumber = digits || null
    identityTouched = true
  }
  if (body.taxCode !== undefined) {
    const tax = String(body.taxCode).trim().replace(/[^0-9-]/g, '')
    // MST: 10 digits, or 14 with the -NNN branch suffix.
    if (tax && !/^\d{10}(-\d{3})?$/.test(tax)) return { ok: false, code: 400, error: 'bad_tax_code' }
    data.taxCode = tax || null
    identityTouched = true

    // VietQR/GDT soft check (owner "go" 2026-07-23; never a gate — the save proceeds
    // identically on any outcome). Runs when the code CHANGED or is present-but-never-
    // checked (a transiently-failed check self-heals on the next save — review note).
    // The lookup happens BEFORE the single UPDATE below so the facts land ATOMICALLY
    // with the code they describe: a concurrent PATCH can't strand facts about an
    // older code (dual plan review), and clearing the code clears the facts in the
    // same write. Inline on purpose — a rare, deliberate action; worst case adds the
    // 4s fetch cap, and the editor gets the verdict on its normal post-save refresh.
    const current = await db.seller.findUnique({
      where: { id: sellerId },
      select: { taxCode: true, taxCheckedAt: true, taxRegisteredName: true, taxActive: true },
    })
    const factsStale = !current?.taxCheckedAt || Date.now() - new Date(current.taxCheckedAt).getTime() > TAX_FACTS_TTL_MS
    const shouldCheck = !!tax && (tax !== current?.taxCode || factsStale)
    data.taxCheckedAt = null
    data.taxRegisteredName = null
    data.taxActive = null
    if (!tax) {
      /* cleared → facts stay nulled */
    } else if (shouldCheck) {
      const hit = await lookupTaxCode(tax)
      if (hit) {
        data.taxCheckedAt = new Date()
        data.taxRegisteredName = hit.found ? hit.registeredName : null
        data.taxActive = hit.found ? hit.active : false
      } // null (transient) → facts stay nulled; next save retries
    } else if (current) {
      // Same code, already checked — carry the existing facts through the reset above.
      data.taxCheckedAt = current.taxCheckedAt
      data.taxRegisteredName = current.taxRegisteredName
      data.taxActive = current.taxActive
    }
  }
  if (identityTouched) data.identityUpdatedAt = new Date()

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
