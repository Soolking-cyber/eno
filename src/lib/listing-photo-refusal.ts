import 'server-only'
import { db } from '@/lib/db'
import { listingObjectKey } from '@/lib/listing-image'
import { logError } from '@/lib/log'
import { PublishBlockedError } from '@/lib/publish-guard'
import { flyerRuleFor, photoCheckExempt } from '@/lib/listing-photo-check'
import { listingPhotoVerdict, photoOverridden } from '@/lib/listing-photo-verdict'
import { photoRulesLive } from '@/lib/listing-photo-hooks'
import { isPhotoDeskSeller } from '@/lib/listing-photo-desk'

/**
 * THE SAVE-TIME SCREEN of the listing photo check (plan §2, amendments A5/A6). /api/upload refuses a flyer or a photo with
 * contact details before it is stored; this catches what reached a create or an edit anyway — an upload whose check
 * finished after its 8 s deadline, an API client, a photo already on the listing.
 * ⛔ A REFUSAL IS ACTED ON ONLY WHEN CONFIRMED (two reads agree), new photo or old: a lone read never blocks a save, so a
 * listing the second read cleared stays editable.
 * ⛔ THE CACHE ONLY: no download, no model call; a kv or db error passes (fail-open — the pass after the save decides).
 * ⛔ Bulk, sync and the Facebook import never come here: a refused photo is stripped by the pass, so a price or stock
 * update is never lost to it.
 * ⛔ DRY RUN IS DRY FOR EXISTING LISTINGS (A16): while writes are off (photoRulesLive), only photos NEW to the listing are
 *    screened — those already on it (`existing`) are left to the pass, and the edit page marks none.
 * Exempt (listing-photo-check.ts PHOTO_CHECK_EXEMPT): teachers and the owner's protected stores, and eno's own e-Visa /
 * trip desk (listing-photo-desk.ts, pending the owner's call).
 */

export type ConfirmedRefusal = { url: string; rule: 'flyer' | 'contact' }

/** The photos among `images` whose refusal is confirmed in the cache, minus this listing's "Photo is fine" overrides. */
export async function confirmedPhotoRefusals(images: string[], o: { category: string; listingId?: string }): Promise<ConfirmedRefusal[]> {
  const flyerRule = flyerRuleFor(o.category)
  const found = await Promise.all(images.map(async (url): Promise<ConfirmedRefusal | null> => {
    const obj = listingObjectKey(url)
    if (!obj || obj.bucket !== 'listings') return null
    const v = await listingPhotoVerdict({ key: obj.key }, { lane: 'pass', flyerRule, cacheOnly: true })
    if (typeof v !== 'object' || v.rule === 'ok' || !v.confirmed) return null
    // Asked only for a refusal: an override read per photo on every save would cost a query each.
    if (o.listingId && (await photoOverridden(o.listingId, obj.key).catch((e) => { logError(e, { op: 'listing-photo.refusal' }); return true }))) return null
    return { url, rule: v.rule }
  }))
  return found.filter((r): r is ConfirmedRefusal => r !== null)
}

/** Teachers, the protected stores and the desk (the storefront is read only when the ids alone do not settle it). */
export async function photoCheckExemptFor(l: { category: string; subcategory?: string | null; sellerId: string }): Promise<boolean> {
  if (photoCheckExempt(l)) return true
  if (!l.sellerId) return false
  if (await isPhotoDeskSeller(l.sellerId).catch(() => false)) return true
  // edition-lint-allow: one storefront's owner and handle, to know whether the photo check skips it; nothing is rendered.
  const s = await db.seller.findUnique({ where: { id: l.sellerId }, select: { ownerId: true, handle: { select: { handle: true } } } }).catch(() => null)
  return !!s && photoCheckExempt({ ...l, handle: s.handle?.handle ?? null, ownerless: !s.ownerId })
}

/** Whether `seller` is a storefront `profileId` owns — a client-sent seller counts only then (/api/upload). */
export async function ownsStorefront(profileId: string | null, seller: string): Promise<boolean> {
  if (!profileId || !seller) return false
  // edition-lint-allow: one storefront's ownership, to honour a client-sent seller; nothing is rendered.
  return !!(await db.seller.findFirst({ where: { id: seller, ownerId: profileId }, select: { id: true } }).catch(() => null))
}

type Screened = { category: string; subcategory: string | null; sellerId: string; listingId?: string; existing?: string | null }

/** The same refusals as the edit page marks; [] for an exempt listing. `existing`: the row's images JSON as stored. */
export async function photoRefusalsFor(images: string[], l: Screened): Promise<ConfirmedRefusal[]> {
  const refused = await confirmedPhotoRefusals(photoRulesLive() ? images : newPhotos(images, l.existing), l)
  return refused.length && !(await photoCheckExemptFor(l)) ? refused : []
}

/**
 * Throws PublishBlockedError('photo_not_allowed') when a photo's refusal is confirmed. `detail`: the refused photos as
 * '<rule>:<url>', space-separated — the wizard marks those tiles (upload-client.ts parsePhotoRefusalDetail). Never throws
 * anything else.
 */
export async function assertNoRefusedPhotos(images: string[], l: Screened): Promise<void> {
  const refused = await photoRefusalsFor(images, l).catch((e): ConfirmedRefusal[] => { logError(e, { op: 'listing-photo.refusal' }); return [] })
  if (refused.length) throw new PublishBlockedError('photo_not_allowed', refused.map((r) => `${r.rule}:${r.url}`).join(' '))
}

/** The photos not already on the listing (writes off: only these are screened). */
function newPhotos(images: string[], existing: string | null | undefined): string[] {
  let old: unknown = []
  try { old = JSON.parse(existing || '[]') } catch { /* unreadable: every photo is new */ }
  const had = new Set(Array.isArray(old) ? old : [])
  return images.filter((url) => !had.has(url))
}
