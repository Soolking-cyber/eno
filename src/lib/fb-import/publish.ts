import 'server-only'
import { db } from '@/lib/db'
import { consolidateSellerHandle } from '@/lib/handle'
import { postingGate } from '@/lib/enforcement'
import { claimRehostedImages, discardRehostedImages, rehostListingImage } from '@/lib/core/bulk'
import { createListingCore } from '@/lib/core/listings'
import { assertCleanTexts, PublishBlockedError } from '@/lib/publish-guard'
import { logError } from '@/lib/log'
import { resolveSellerForPost } from '@/app/api/listings/resolve-seller'
import { FB_IMPORT_MAX_PHOTOS, type ReportedItem } from './shared'
import { textProblem, translateText } from './sort'

export type PublishResult = { ok: true; listingId: string } | { ok: false; code: string; detail?: string }

/**
 * One draft becomes a listing, through the same gates as a post from the form (createListingCore, postingGate). One item per request, so a timeout costs one item and the screen reports each.
 * ⛔ THE ROW IS CLAIMED FIRST, BY A CONDITIONAL UPDATE: a double click or a retry finds it taken. ⛔ externalId IS THE SECOND LINE: a sweep can put a killed publish back to draft after its listing was
 * made, so an existing fb:<id> on this seller is that listing, not a reason to make another. ⚠️ A process killed in the instant between creating the listing and stamping its fb:<id> isn't covered.
 * Photos are re-hosted here, not at import: the store's tombstones give an unclaimed photo an hour, and a draft waits for days. fbcdn links do expire, so a draft left too long says so.
 */
/**
 * The listing's two languages (owner, 2026-11-06: "at least 2 proper translations vietnamese english"): English in `title`/`description`, Vietnamese beside it,
 * the feed importer's layout. The draft PATCH translates each edit as it saves it, so normally both are whole here; a gap a failed call left is filled now,
 * FIELD BY FIELD FROM ITS OWN SOURCE LANGUAGE (commit gate, codex + opus: a title edited in one language and a description in the other). With a gap still
 * there: the language that is whole goes out alone, as any hand post does (the site's machine translation still shows it in both); with neither whole,
 * nothing is published and the seller is asked to try again, so their words are never dropped and a listing is never half one language.
 */
async function bothLanguages(item: { title: string | null; description: string | null; titleVi: string | null; descriptionVi: string | null }): Promise<{ title: string; description: string; titleVi: string | null; descriptionVi: string | null } | null> {
  // ⚠️ A draft sorted before 2026-11-06 kept the seller's own language in title/description, so a Vietnamese one is read as English here and goes out with
  // Vietnamese in both. No letter test tells them apart ("Bán xe" and "Café" share their accents), and those few drafts expire in 7 days: Import again
  // replaces them with two-language drafts.
  const t = { en: (item.title ?? '').trim(), vi: (item.titleVi ?? '').trim() }
  const d = { en: (item.description ?? '').trim(), vi: (item.descriptionVi ?? '').trim() }
  // A description exists if either side has one; a side lacking it then has a gap.
  const hasD = !!(d.en || d.vi)
  for (const [field, kind] of [[t, 'title'], [d, 'description']] as const) {
    if (kind === 'description' && !hasD) continue
    if (!field.en && field.vi) field.en = (await translateText(field.vi, kind, 'en')) ?? ''
    if (!field.vi && field.en) field.vi = (await translateText(field.en, kind, 'vi')) ?? ''
  }
  const whole = (l: 'en' | 'vi') => !!t[l] && (!hasD || !!d[l])
  if (whole('en') && whole('vi')) return { title: t.en, description: d.en, titleVi: t.vi, descriptionVi: d.vi || null }
  if (whole('en')) return { title: t.en, description: d.en, titleVi: null, descriptionVi: null }
  if (whole('vi')) return { title: t.vi, description: d.vi, titleVi: null, descriptionVi: null }
  return null
}

/**
 * `place`: where the seller CONFIRMED this whole import is, on the review screen (owner, 2026-11-07: "imported post has wrong location … ask the user if
 * location is correct … for whole import with default as taken from fb but they have to review it before posting"; then "make it a selector dropdown for
 * city ward plus … pin location"). The city and ward the post form's picker gives, and its pin: stored as the post form stores them (post-wizard.tsx,
 * district = the ward, city = the province, the pin when it is in Vietnam). It replaces each draft's own guess from Facebook; with none, nothing is published.
 */
export type ConfirmedPlace = { province: string; ward: string; lat?: number | null; lng?: number | null }
const inVietnam = (lat: number, lng: number) => lat >= 8 && lat <= 23.6 && lng >= 102 && lng <= 110
export async function publishImportItem(profileId: string, itemId: string, contactPhone: string, contactName: string, headers: Headers, confirmed: ConfirmedPlace): Promise<PublishResult> {
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
    if (!item.categorySlug) { await release('no_category'); return back('no_category') }
    if (item.price == null) { await release('price_required'); return back('price_required') }
    // Public text on every listing: the same screens as a title (phone, contact, banned words), the import's not the draft's (commit gate, opus).
    const province = confirmed.province.trim(), ward = confirmed.ward.trim()
    try { assertCleanTexts([province, ward]) } catch (e) { if (e instanceof PublishBlockedError) { await release(item.reason ?? null); return back('location_contact') } throw e }
    // The import's place, not this draft's fault: the draft keeps the reason it had, so a fixed place publishes it without re-ticking each one (commit gate, opus).
    if (!province || !ward) { await release(item.reason ?? null); return back('location_required') }
    const pin = confirmed.lat != null && confirmed.lng != null && inVietnam(confirmed.lat, confirmed.lng) ? { lat: confirmed.lat, lng: confirmed.lng } : {}
    // The seller's own text first: a cleared title is "too short", never "try again" (commit gate, opus).
    const first = textProblem(item.title ?? item.titleVi ?? '', item.description ?? item.descriptionVi ?? '')
    if (first) { await release(first); return back(first) }
    const text = await bothLanguages(item)
    if (!text) { await release('translation_failed'); return back('translation_failed') }
    const problem = textProblem(text.title, text.description) ?? (text.titleVi ? textProblem(text.titleVi, text.descriptionVi ?? text.description) : null)
    if (problem) { await release(problem); return back(problem) }
    const { title, description } = text

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
      imported: { titleVi: text.titleVi, descriptionVi: text.descriptionVi },
      body: {
        title, description, price: item.price, images: fresh,
        subcategorySlug: item.subcategorySlug, listingType: item.listingType, condition: item.condition,
        brand: item.brand, model: item.model,
        attributes: item.attributes ?? undefined, ...(item.specs && typeof item.specs === 'object' ? (item.specs as Record<string, unknown>) : {}),
        // Last, so nothing above can put another place over the one the seller confirmed (commit gate, codex).
        // lat/lng always set here, so a point in the draft's details never stands in for the one the seller confirmed (commit gate, codex).
        district: ward, city: province, location: ward, lat: undefined, lng: undefined, ...pin,
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
