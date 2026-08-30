import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { isListingImageUrl } from '@/lib/listing-image'
import { recordProfileComplete } from '@/lib/trust'
import { lookupTaxCode, TAX_FACTS_TTL_MS } from '@/lib/tax-lookup'
import { sellerIdentityHash } from '@/lib/business-verification'
import { logError } from '@/lib/log'

// Storefront (Seller) edit core — decoupled from auth, takes the already-resolved
// sellerId + owning profileId. Shared by the dashboard PATCH /api/seller and the partner
// PATCH /api/v1/shop. Sparse: only present fields change. Returns a validation error code
// or { ok: true }; one-time trust bonus once the profile is fully filled out.
/**
 * Every code `updateSellerCore` can put on the wire.
 *
 * ⚠️ NAMED RATHER THAN `error: string`, FOR THE REASON RECORDED IN `ListingUpdateErrorCode`.
 * `PATCH /api/seller` answers `{ error: res.error }`, so this union IS an API union — and while it
 * was a bare `string` two of its members (`bad_tax_code`, `no_phone_in_profile`) were absent from
 * `ApiErrorCode`, invisible to both the compiler and the text-scan harvest. `src/lib/api/errors.ts`
 * now asserts this is a subset of that union at COMPILE time.
 */
export type SellerUpdateErrorCode =
  | 'name_too_short'
  | 'bad_avatar'
  | 'bad_banner'
  | 'bad_phone'
  | 'phone_taken'
  | 'bad_id_number'
  | 'bad_tax_code'
  | 'no_phone_in_profile'

export async function updateSellerCore(
  sellerId: string,
  profileId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: number; error: SellerUpdateErrorCode }> {
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
  /**
   * THE SHOP'S STOREFRONT BANNER — one cover image, set by the shop itself. Owner, 2026-08-30:
   * a shop gets one banner for its store, added through its store profile.
   *
   * ⛔ `isListingImageUrl` IS THE SAME GUARD THE AVATAR USES, AND IT IS NOT COSMETIC. It restricts
   * the value to media this platform stores, so a shop cannot point its banner at a third-party
   * URL — which would let it hotlink, swap the creative after any review, or aim the request at
   * an internal address. The banner is rendered on `<handle>.eno.vn`, a host that carries eno's
   * own certificate, so the artwork there has to come from us.
   * ⚠️ NULL IS A REAL VALUE, NOT AN OMISSION: clearing the banner is how a shop removes it, which
   * is why this tests `!== undefined` rather than truthiness.
   * ⚠️ THE MOBILE VARIANT IS OPTIONAL AND FALLS BACK TO THE WIDE ONE in <StorefrontBanner>. A shop
   * that uploads one image gets it on both, which is why this does not require them in pairs.
   */
  if (body.bannerUrl !== undefined) {
    const url = body.bannerUrl ? String(body.bannerUrl) : null
    if (url && !isListingImageUrl(url)) return { ok: false, code: 400, error: 'bad_banner' }
    data.bannerUrl = url
  }
  if (body.bannerMobileUrl !== undefined) {
    const url = body.bannerMobileUrl ? String(body.bannerMobileUrl) : null
    if (url && !isListingImageUrl(url)) return { ok: false, code: 400, error: 'bad_banner' }
    data.bannerMobileUrl = url
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

  // ── Drop the verified-business stamp when the edit MOVES the identity off the approved
  //    snapshot (external review — else a verified seller could change their tax code away
  //    to un-hold the MST, let another storefront claim it, then RESTORE the code and have
  //    the identity-hash badge auto-return, leaving two live badges for one tax code). We
  //    clear only on a real mismatch, so a no-op or bio-only save never costs the badge.
  if (data.name !== undefined || identityTouched) {
    const cur = await db.seller.findUnique({
      where: { id: sellerId },
      select: { name: true, legalName: true, legalAddress: true, idNumber: true, taxCode: true, verifiedIdentityHash: true },
    })
    if (cur?.verifiedIdentityHash) {
      const nextIdentity = {
        name: (data.name as string | undefined) ?? cur.name,
        legalName: (data.legalName as string | null | undefined) ?? cur.legalName,
        legalAddress: (data.legalAddress as string | null | undefined) ?? cur.legalAddress,
        idNumber: (data.idNumber as string | null | undefined) ?? cur.idNumber,
        taxCode: (data.taxCode as string | null | undefined) ?? cur.taxCode,
      }
      if (sellerIdentityHash(nextIdentity) !== cur.verifiedIdentityHash) {
        data.verifiedIdentityHash = null
        data.verifiedAt = null
        data.verifiedUntil = null
        data.verifiedBy = null
      }
    }
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
    after(() => recordProfileComplete(profileId).catch((e) => logError(e, { op: 'seller.recordProfileComplete' })))
  }
  return { ok: true }
}
