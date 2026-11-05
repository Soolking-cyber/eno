import 'server-only'
import { db } from '@/lib/db'
import { consolidateSellerHandle } from '@/lib/handle'
import { postingGate } from '@/lib/enforcement'
import { claimRehostedImages, discardRehostedImages, rehostListingImage } from '@/lib/core/bulk'
import { createListingCore } from '@/lib/core/listings'
import { PublishBlockedError } from '@/lib/publish-guard'
import { logError } from '@/lib/log'
import { resolveSellerForPost } from '@/app/api/listings/resolve-seller'
import { FB_IMPORT_MAX_PHOTOS, type ReportedItem } from './shared'
import { textProblem } from './sort'

export type PublishResult = { ok: true; listingId: string } | { ok: false; code: string; detail?: string }

/**
 * One draft becomes a listing, through the same gates as a post from the form (createListingCore, postingGate). One item per request, so a timeout costs one item and the screen reports each.
 * ⛔ THE ROW IS CLAIMED FIRST, BY A CONDITIONAL UPDATE: a double click or a retry finds it taken. ⛔ externalId IS THE SECOND LINE: a sweep can put a killed publish back to draft after its listing was
 * made, so an existing fb:<id> on this seller is that listing, not a reason to make another. ⚠️ A process killed in the instant between creating the listing and stamping its fb:<id> isn't covered.
 * Photos are re-hosted here, not at import: the store's tombstones give an unclaimed photo an hour, and a draft waits for days. fbcdn links do expire, so a draft left too long says so.
 */
export async function publishImportItem(profileId: string, itemId: string, contactPhone: string, contactName: string, headers: Headers): Promise<PublishResult> {
  const claimed = await db.facebookImportItem.updateMany({
    where: { id: itemId, status: 'draft', job: { profileId } },
    data: { status: 'publishing', publishingSince: new Date() },
  })
  if (claimed.count !== 1) return { ok: false, code: 'not_available' }
  const back = (code: string, detail?: string): PublishResult => ({ ok: false, code, ...(detail ? { detail } : {}) })
  const release = async (reason: string | null) => db.facebookImportItem.update({ where: { id: itemId }, data: { status: 'draft', publishingSince: null, reason } })
  const fresh: string[] = []
  let made: string | null = null
  let stamp = ''
  try {
    const item = await db.facebookImportItem.findUniqueOrThrow({ where: { id: itemId }, include: { job: { select: { fbName: true } } } })
    const raw = item.raw as unknown as ReportedItem
    const title = (item.title ?? '').trim()
    const description = (item.description ?? '').trim()
    if (!item.categorySlug) { await release('no_category'); return back('no_category') }
    if (item.price == null) { await release('price_required'); return back('price_required') }
    if (!item.district?.trim()) { await release('location_required'); return back('location_required') }
    const problem = textProblem(title, description)
    if (problem) { await release(problem); return back(problem) }

    // A first-time seller's new shop takes the name they import under, not a blank.
    const seller = await resolveSellerForPost(profileId, contactPhone, contactName || item.job?.fbName || '')
    if (seller instanceof Response) {
      const code = ((await seller.json().catch(() => null)) as { error?: string } | null)?.error ?? 'seller_failed'
      await release(null)
      return back(code)
    }
    await consolidateSellerHandle(seller.id, seller.name, seller.ownerId)
    const gate = await postingGate(profileId, seller.id)
    if (gate) { await release(null); return back((gate as { error?: string }).error ?? 'posting_blocked') }

    const externalId = `fb:${item.fbItemId}`
    stamp = externalId
    const existing = await db.listing.findFirst({ where: { sellerId: seller.id, externalId }, select: { id: true, images: true } })
    if (existing) {
      // A publish killed before it claimed them: an hour after re-hosting, an unclaimed photo is deleted.
      await claimRehostedImages(Array.isArray(existing.images) ? (existing.images as string[]) : [])
      await db.facebookImportItem.update({ where: { id: itemId }, data: { status: 'published', listingId: existing.id, publishingSince: null, reason: null } })
      return { ok: true, listingId: existing.id }
    }
    const category = await db.category.findUnique({ where: { slug: item.categorySlug } })
    if (!category) { await release('no_category'); return back('no_category') }

    for (const url of (raw.photos ?? []).slice(0, FB_IMPORT_MAX_PHOTOS)) {
      const hosted = await rehostListingImage(url, seller.id)
      if (hosted) fresh.push(hosted)
    }
    if ((raw.photos?.length ?? 0) > 0 && fresh.length === 0) { await release('photos_expired'); return back('photos_expired') }

    const created = await createListingCore({
      seller, guestCreate: false, category, title, price: item.price, headers,
      body: {
        title, description, price: item.price, images: fresh,
        subcategorySlug: item.subcategorySlug, listingType: item.listingType, condition: item.condition,
        brand: item.brand, model: item.model, district: item.district, city: item.city ?? item.district, location: raw.location ?? undefined,
        attributes: item.attributes ?? undefined, ...(item.specs && typeof item.specs === 'object' ? (item.specs as Record<string, unknown>) : {}),
      },
    })
    made = created.id
    await claimRehostedImages(fresh)
    await db.listing.update({ where: { id: created.id }, data: { externalId } })
    await db.facebookImportItem.update({ where: { id: itemId }, data: { status: 'published', listingId: created.id, publishingSince: null, reason: null } })
    return { ok: true, listingId: created.id }
  } catch (e) {
    // ⛔ THE LISTING IS LIVE: its photos stay, and the draft must not come back to post it twice. What failed is only the bookkeeping after it.
    if (made) {
      logError(e, { op: 'fb-import.publish.after-create', listingId: made })
      // Unstamped, it could count as the original of a photo and hide a real owner's later post: one more try.
      await db.listing.update({ where: { id: made }, data: { externalId: stamp } }).catch((x: unknown) => logError(x, { op: 'fb-import.publish.stamp' }))
      await db.facebookImportItem.update({ where: { id: itemId }, data: { status: 'published', listingId: made, publishingSince: null, reason: null } }).catch((x: unknown) => logError(x, { op: 'fb-import.publish.mark' }))
      return { ok: true, listingId: made }
    }
    await discardRehostedImages(fresh).catch((x: unknown) => logError(x, { op: 'fb-import.publish.discard' }))
    if (e instanceof PublishBlockedError) {
      await release(e.code)
      return back(e.code, typeof e.detail === 'string' ? e.detail : undefined)
    }
    logError(e, { op: 'fb-import.publish' })
    await release(null).catch((x: unknown) => logError(x, { op: 'fb-import.publish.release' }))
    return back('publish_failed')
  }
}
