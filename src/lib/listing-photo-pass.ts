import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import type { PhotoCheckLane } from '@/lib/ai-guard'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { appendAudit } from '@/lib/compliance/audit'
import { pickLocale } from '@/lib/admin-macros'
import { deskSellerIds } from '@/lib/edition-scope'
import { listingObjectKey } from '@/lib/listing-image'
import { LISTING_REMOVED, NOT_REMOVED } from '@/lib/listing-removed'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'
import { logError } from '@/lib/log'
import { LICENCE_HELD_NOTE } from '@/lib/licence-stamp'
import { REVIEW_SEAT_HELD_NOTE } from '@/lib/review-seat-accounts'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { OPEN_CASE, OWNER_PULLED, publishListings } from '@/lib/core/publish-listings'
import { flyerRuleFor, photoCheckExempt } from '@/lib/listing-photo-check'
import { listingPhotoVerdict, type PhotoClearance } from '@/lib/listing-photo-verdict'
import { PHOTO_HELD_NOTE, strippedPhotosOf, type StrippedPhotos } from '@/lib/listing-photo-hold'
import { enqueuePhotoChecks, photoCheckDone, photoRulesLive } from '@/lib/listing-photo-hooks'
import { isPhotoDeskSeller } from '@/lib/listing-photo-desk'

/**
 * THE PHOTO PASS AFTER PUBLISH (owner, 2026-11-15: no flyers and no contact details in listing photos). For one listing,
 * each photo's verdict (listing-photo-verdict.ts; a refusal counts only when two models agree), then:
 *  · every photo refused → HOLD: unpublished under the photo hold's mark (listing-photo-hold.ts), status untouched, so the
 *    dashboard says "Held" and the seller is told to add a real photo;
 *  · some refused, one at least fine → STRIP: the refused ones leave `images`, recorded (audit `listing.photo.stripped`)
 *    and kept 180 days (a tombstone) so "Photo is fine" can put them back (restoreStrippedPhotos);
 *  · a held row whose every photo is now fine → RELEASE through publishListings' photo release. A listing its seller hid
 *    stays hidden; one the identity gate refuses is parked, and the gate owns it from then (A11);
 *  · a photo it could not decide, or a release refused for now (a report open, the owner held) → no release (A9) and the
 *    row joins the pending set for the cron.
 * ⛔ A PHOTO THAT HELD ITS LISTING STAYS REFUSED until an admin says it is fine or both models now say ok (heldKeysOf).
 * ⛔ Exempt, never read (listing-photo-check.ts PHOTO_CHECK_EXEMPT): teachers and the owner's protected stores, eno's
 *    own e-Visa / trip desk (listing-photo-desk.ts) and the official partners (partnerPhotoExempt; never a store-review
 *    seat) — a held one is released.
 * ⛔ HELD = the photo mark AND not verified. A verified row still carrying the mark is live: judged as any live row, and
 *    the stale mark is cleared in the same compare-and-set as whatever the pass writes.
 * ⛔ THE BREAKER (storefrontMayWrite) bounds every caller's holds and strips.
 * ⛔ Only a row that is live or identity-parked, or carries the photo mark: a row someone else took down is theirs to put
 * back, and a licence or review-seat mark is never touched. Every write is a compare-and-set on the row as read.
 * ⛔ A STRIP BYPASSES assertEnoughAngles ON PURPOSE (owner's rule: the flyer goes, the listing stays): the seller's next
 * edit must meet the category minimum again.
 * ⛔ Writes only with PHOTO_RULES_WRITE=1 (A16 — listing-photo-hooks.ts photoRulesLive); otherwise a dry run that only
 * fills the cache. Never throws.
 */

/** How long a removed photo is kept (/privacy: "up to 180 days"). */
export const STRIPPED_KEEP_MS = 180 * 24 * 3600_000

export type PhotoVerdict = { kind: 'ok' } | { kind: 'bad'; rule: 'flyer' | 'contact' } | { kind: 'unknown'; budget?: true }
export type PhotoPlan = { hold?: true; strip?: number[]; release?: true; pending?: true }

/** The decision on one listing's photos, by index. Pure. */
export function planPhotoPass(v: PhotoVerdict[], held: boolean): PhotoPlan {
  const bad = v.flatMap((x, i) => (x.kind === 'bad' ? [i] : []))
  const pending = v.some((x) => x.kind === 'unknown') ? { pending: true as const } : null
  if (!bad.length) return pending ?? (held && v.length ? { release: true } : {})
  if (!v.some((x) => x.kind === 'ok')) return pending ?? (held ? {} : { hold: true })
  return { strip: bad, ...(pending ?? (held ? { release: true as const } : {})) }
}

export type PhotoPassOptions = {
  /** Default: a dry run unless PHOTO_RULES_WRITE=1. */
  dryRun?: boolean
  /** Storefronts whose tripped breaker the sweep lifts (?allow). */
  allow?: ReadonlySet<string>
  /** The cron's per-run cap on holds and strips: false → the row is reported, nothing written. */
  mayWrite?: (row: { id: string; sellerId: string }, plan: PhotoPlan) => Promise<boolean>
}
export type PhotoPassResult =
  | { skip: 'gone' | 'exempt' | 'marked' | 'not_public' | 'failed' }
  | { plan: PhotoPlan; dryRun: boolean; wrote: Array<'held' | 'stripped' | 'released'>; breaker?: 'storefront' | 'run'; budget?: true }

const ROW = {
  id: true, images: true, status: true, verified: true, identityHold: true, verificationNotes: true, sellerId: true, subcategorySlug: true,
  category: { select: { slug: true } },
  seller: { select: { ownerId: true, officialPartner: true, handle: { select: { handle: true } }, owner: { select: { locale: true, email: true } } } },
} satisfies Prisma.ListingSelect
type Row = Prisma.ListingGetPayload<{ select: typeof ROW }>

export async function photoPassById(id: string, lane: PhotoCheckLane, o: PhotoPassOptions = {}): Promise<PhotoPassResult> {
  try {
    return await pass(id, lane, o)
  } catch (e) {
    logError(e, { op: 'listing-photo.pass', listingId: id })
    return { skip: 'failed' }
  }
}

async function pass(id: string, lane: PhotoCheckLane, o: PhotoPassOptions): Promise<PhotoPassResult> {
  const row = await db.listing.findUnique({ where: { id }, select: ROW })
  if (!row || row.status === LISTING_REMOVED) return { skip: 'gone' }
  const held = row.verificationNotes === PHOTO_HELD_NOTE && !row.verified
  const exempt = photoCheckExempt({
    category: row.category.slug, subcategory: row.subcategorySlug, sellerId: row.sellerId, handle: row.seller.handle?.handle ?? null,
    ownerless: !row.seller.ownerId, officialPartner: row.seller.officialPartner, ownerEmail: row.seller.owner?.email ?? null,
  }) || (await isPhotoDeskSeller(row.sellerId))
  if (exempt && !held) return { skip: 'exempt' }
  if (row.verificationNotes === LICENCE_HELD_NOTE || row.verificationNotes === REVIEW_SEAT_HELD_NOTE) return { skip: 'marked' }
  if (!held && !row.verified && !row.identityHold) return { skip: 'not_public' }

  const images = parseImages(row.images)
  const flyerRule = flyerRuleFor(row.category.slug)
  const heldKeys = held && !exempt ? await heldKeysOf(id) : new Set<string>()
  const once = new Map<string, Promise<PhotoVerdict>>()
  const verdicts = exempt ? [] : await Promise.all(images.map((url) => {
    if (!once.has(url)) once.set(url, verdictOf(url, id, lane, flyerRule, heldKeys))
    return once.get(url)!
  }))
  const plan: PhotoPlan = exempt ? { release: true } : planPhotoPass(verdicts, held)
  const budget = verdicts.some((v) => v.kind === 'unknown' && v.budget) ? { budget: true as const } : {}
  const dryRun = o.dryRun ?? !photoRulesLive()
  const wrote: Array<'held' | 'stripped' | 'released'> = []
  if (dryRun) return { plan, dryRun, wrote, ...budget }

  let breaker: 'storefront' | 'run' | undefined
  if (plan.hold || plan.strip) {
    if (!(await storefrontMayWrite(row.sellerId, o.allow))) breaker = 'storefront'
    else if (o.mayWrite && !(await o.mayWrite(row, plan))) breaker = 'run'
  }
  if ((plan.hold || plan.strip || plan.release) && !breaker) {
    if (plan.hold && (await hold(row, images, verdicts))) wrote.push('held')
    let checked: string | null = row.images
    if (plan.strip) {
      checked = await strip(row, images, verdicts, plan.strip)
      if (checked) wrote.push('stripped')
    }
    if (plan.release && checked && (await release(row, checked))) wrote.push('released')
    if (wrote.length) refreshListingSurfaces([id], 'photoCheck', { home: true })
  }
  // A breaker's row, and a release refused for now (nothing re-runs the pass when a report closes), wait for the next run.
  await (plan.pending || breaker || (plan.release && !wrote.includes('released')) ? enqueuePhotoChecks([id]) : photoCheckDone(id))
  return { plan, dryRun, wrote, ...(breaker ? { breaker } : {}), ...budget }
}

/** The object keys the latest photo hold refused (its audit). */
async function heldKeysOf(id: string): Promise<Set<string>> {
  const a = await db.complianceAudit.findFirst({ where: { action: 'listing.photo.held', subjectType: 'listing', subjectId: id }, orderBy: { id: 'desc' }, select: { detail: true } })
  const photos = (a?.detail as { photos?: Array<{ key?: unknown }> } | null)?.photos ?? []
  return new Set(photos.flatMap((p) => (typeof p?.key === 'string' ? [p.key] : [])))
}

const BREAKER = { floor: 10, share: 0.25 } as const
const WEEK_MS = 7 * 24 * 3600_000
const trippedKey = (sellerId: string) => `listing-photo:tripped:${sellerId}`

/**
 * ⛔ THE BREAKER (A12), for every caller: a storefront whose holds and strips over 7 days would pass the larger of 10 and
 * a quarter of its rows TRIPS, recorded in kv with no expiry, and nothing more is held or stripped there until a sweep
 * passes ?allow=<sellerId>, which clears it. Passes running at once can each pass the line once.
 * Whoever trips it, the next cron run reports it once (api/cron/listing-photos, its kv mark).
 */
async function storefrontMayWrite(sellerId: string, allow?: ReadonlySet<string>): Promise<boolean> {
  if (allow?.has(sellerId)) { await kv.del(trippedKey(sellerId)); return true }
  if (await kv.get(trippedKey(sellerId))) return false
  const [[week], rows] = await Promise.all([
    db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM compliance_audit a JOIN "Listing" l ON l.id = a."subjectId"
       WHERE l."sellerId" = ${sellerId} AND a."subjectType" = 'listing' AND a.action IN ('listing.photo.held', 'listing.photo.stripped')
         AND a."occurredAt" >= ${new Date(Date.now() - WEEK_MS)}`,
    // A held row still counts: the share is of the storefront as it was, not of what the holds left.
    // edition-lint-allow: the size of a storefront the pass may write to, for its breaker; nothing is rendered.
    db.listing.count({ where: { sellerId, OR: [{ status: 'active', verified: true }, { verificationNotes: PHOTO_HELD_NOTE }] } }),
  ])
  if ((week?.n ?? 0) + 1 <= Math.max(BREAKER.floor, rows * BREAKER.share)) return true
  await kv.set(trippedKey(sellerId), { at: new Date().toISOString() })
  return false
}

/** A photo not in our listings bucket cannot be checked here: unknown, never a refusal. */
async function verdictOf(url: string, listingId: string, lane: PhotoCheckLane, flyerRule: boolean, heldKeys: Set<string>): Promise<PhotoVerdict> {
  const obj = listingObjectKey(url)
  if (!obj || obj.bucket !== 'listings') return { kind: 'unknown' }
  const v = await listingPhotoVerdict({ key: obj.key }, { lane, flyerRule, listingId, confirm: heldKeys.has(obj.key) ? 'both' : 'after' })
  if (v === 'budget') return { kind: 'unknown', budget: true }
  if (v === 'unavailable') return { kind: 'unknown' }
  if (v.rule === 'ok') return { kind: 'ok' }
  return v.confirmed ? { kind: 'bad', rule: v.rule } : { kind: 'unknown' }
}

const refused = (images: string[], verdicts: PhotoVerdict[], only?: number[]) => verdicts.flatMap((v, i) =>
  v.kind === 'bad' && (!only || only.includes(i)) ? [{ i, url: images[i], key: listingObjectKey(images[i])!.key, rule: v.rule }] : [])

/** The hold, on exactly the row as read (its photos, publication and mark), with its audit and bell — or nothing. */
async function hold(row: Row, images: string[], verdicts: PhotoVerdict[]): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true)`
    const { count } = await tx.listing.updateMany({
      where: { id: row.id, ...NOT_REMOVED, images: row.images, verified: row.verified, identityHold: row.identityHold, verificationNotes: row.verificationNotes },
      data: { verified: false, identityHold: false, verificationNotes: PHOTO_HELD_NOTE },
    })
    if (count !== 1) return false
    const photos = refused(images, verdicts).map(({ i, key, rule }) => ({ i, key, rule }))
    await appendAudit(tx, { actorType: 'system', action: 'listing.photo.held', subjectType: 'listing', subjectId: row.id, detail: { wasPublic: row.verified && row.status === 'active', parked: row.identityHold, photos }, legalBasis: 'ecommerceLaw' })
    await bell(tx, row, 'held')
    return true
  })
}

/** The refused photos out of `images` (the rest in their order), recorded and kept — the new images JSON, or null. */
async function strip(row: Row, images: string[], verdicts: PhotoVerdict[], remove: number[]): Promise<string | null> {
  const removed = refused(images, verdicts, remove)
  const kept = JSON.stringify(images.filter((_, i) => !remove.includes(i)))
  const now = new Date()
  const done = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true)`
    // On exactly the row as read, its publication too: a row an admin hid or unverified, or moderation held, meanwhile is
    // theirs — no strip, tombstone or bell. A verified row's stale photo mark goes in the same write.
    const stale = row.verified && row.verificationNotes === PHOTO_HELD_NOTE
    const { count } = await tx.listing.updateMany({
      where: { id: row.id, ...NOT_REMOVED, images: row.images, status: row.status, verified: row.verified, identityHold: row.identityHold, verificationNotes: row.verificationNotes },
      data: { images: kept, ...(stale ? { verificationNotes: null } : {}) },
    })
    if (count !== 1) return false
    await appendAudit(tx, { actorType: 'system', action: 'listing.photo.stripped', subjectType: 'listing', subjectId: row.id, detail: { before: images, removed } satisfies StrippedPhotos, legalBasis: 'ecommerceLaw' })
    await writeTombstones(tx, removed.map((r) => ({ bucket: 'listings', path: r.key })), 'listing_photo_stripped', now, { graceMs: STRIPPED_KEEP_MS })
    await bell(tx, row, 'stripped')
    return true
  })
  return done ? kept : null
}

/**
 * The self-release: publishListings' photo release, on the photos just checked, never over an open or upheld report, an
 * owner held or suspended (the enforcement pull's states) or a Restricted storefront — licence-approve's conditions. The
 * audit and bell follow it (a release is not a takedown: a failed record is logged, never undone).
 */
async function release(row: Row, checked: string): Promise<boolean> {
  const r = await publishListings([row.id], await deskSellerIds(), {
    photoRelease: true,
    onlyIf: {
      images: checked,
      reports: { none: { status: { in: OPEN_CASE } } },
      seller: { OR: [{ ownerId: null }, { owner: { enforcementState: { notIn: OWNER_PULLED } } }], trustTier: { not: 'restricted' } },
    },
  })
  if (!r.affected && !r.held) return false
  await db.$transaction(async (tx) => {
    await appendAudit(tx, { actorType: 'system', action: 'listing.photo.released', subjectType: 'listing', subjectId: row.id, detail: { parked: r.held > 0 }, legalBasis: 'ecommerceLaw' })
    if (r.affected && row.status === 'active') await bell(tx, row, 'released')
  }).catch((e) => logError(e, { op: 'listing-photo.released', listingId: row.id }))
  return true
}

/** The seller's bells (EN/VI, the owner's language), one per listing. */
export const PHOTO_BELLS = {
  held: {
    title: { en: 'Listing held: add a real photo', vi: 'Tin đăng tạm ẩn: hãy thêm ảnh thật' },
    body: {
      en: 'Your listing is hidden because its photos are flyers or show a phone number or other contact details. Edit it and add a real photo of what you offer — it goes live again by itself. Think we got it wrong? Tell us from the Help page.',
      vi: 'Tin đăng của bạn đang bị ẩn vì ảnh là tờ rơi hoặc có số điện thoại, thông tin liên hệ. Hãy sửa tin và thêm ảnh chụp thật của sản phẩm hoặc dịch vụ — tin sẽ tự hiển thị lại. Bạn cho rằng chúng tôi nhầm? Hãy báo cho chúng tôi từ trang Trợ giúp.',
    },
  },
  stripped: {
    title: { en: 'Some photos were removed', vi: 'Một số ảnh đã bị gỡ' },
    body: {
      en: 'We removed photos from your listing that were flyers or showed a phone number or other contact details. Think we got it wrong? Tell us from the Help page.',
      vi: 'Chúng tôi đã gỡ khỏi tin đăng của bạn những ảnh là tờ rơi hoặc có số điện thoại, thông tin liên hệ. Bạn cho rằng chúng tôi nhầm? Hãy báo cho chúng tôi từ trang Trợ giúp.',
    },
  },
  released: {
    title: { en: 'Your listing is live again', vi: 'Tin đăng đã hiển thị lại' },
    body: {
      en: 'Thanks for the real photo — buyers can see your listing again.',
      vi: 'Cảm ơn bạn đã thêm ảnh thật — người mua đã có thể xem lại tin đăng của bạn.',
    },
  },
} as const

async function bell(tx: Pick<Prisma.TransactionClient, 'notification'>, row: Row, kind: keyof typeof PHOTO_BELLS): Promise<void> {
  const to = row.seller.ownerId
  if (!to) return
  const l = pickLocale(row.seller.owner?.locale)
  await tx.notification.create({
    data: { recipientId: to, type: 'system', title: PHOTO_BELLS[kind].title[l], body: PHOTO_BELLS[kind].body[l], url: kind === 'released' ? `/listings/${row.id}` : `/listings/${row.id}/edit` },
  })
}

/**
 * Where restored photos go (A13), pure: each one at its place in the listing as it was stripped — after the nearest photo
 * before it that the listing still has — around the photos it has NOW, so the seller's later edits stay. Newest strip
 * first; a photo already there is not added twice.
 */
export function restoreOrder(current: string[], strips: StrippedPhotos[], keys: string[]): { images: string[]; restored: StrippedPhotos['removed'] } {
  const images = [...current]
  const restored: StrippedPhotos['removed'] = []
  for (const s of strips) {
    for (const r of s.removed) {
      if (!keys.includes(r.key) || images.includes(r.url)) continue
      let pos = 0
      for (let j = s.before.indexOf(r.url) - 1; j >= 0; j--) {
        const k = images.indexOf(s.before[j])
        if (k >= 0) { pos = k + 1; break }
      }
      images.splice(pos, 0, r.url)
      restored.push(r)
    }
  }
  return { images, restored }
}

/**
 * "Photo is fine" (A13): the admin's override of these keys (audit `listing.photo.override`), and the photos the pass
 * removed from this listing under them put back, within the 180 days they are kept, their tombstones cancelled — one
 * transaction, a compare-and-set on the images it read, so a failed restore records no override. With the override, an
 * audit `listing.photo.cleared` {key, sha, rule} per clearance the caller then puts in the shared cache (clearPhotoContent).
 * The urls put back ([] for none), or null when the row is gone or changed under it (try again).
 */
export async function restoreStrippedPhotos(listingId: string, keys: string[], admin: string, clearances: PhotoClearance[] = []): Promise<string[] | null> {
  // A day short of the tombstone's clock: an object about to be swept is not put back.
  const since = new Date(Date.now() - STRIPPED_KEEP_MS + 24 * 3600_000)
  const put = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true)`
    const row = await tx.listing.findFirst({ where: { id: listingId, ...NOT_REMOVED }, select: { images: true } })
    if (!row) return null
    const audits = await tx.complianceAudit.findMany({
      where: { action: 'listing.photo.stripped', subjectType: 'listing', subjectId: listingId, occurredAt: { gt: since } },
      orderBy: { id: 'desc' }, select: { detail: true },
    })
    const strips = audits.map((a) => strippedPhotosOf(a.detail)).filter((s): s is StrippedPhotos => !!s)
    const { images, restored } = restoreOrder(parseImages(row.images), strips, keys)
    const override = async () => {
      for (const key of keys) await appendAudit(tx, { actorType: 'admin', actorId: admin, action: 'listing.photo.override', subjectType: 'listing', subjectId: listingId, detail: { key }, legalBasis: 'ecommerceLaw' })
      for (const { key, sha, rule } of clearances) await appendAudit(tx, { actorType: 'admin', actorId: admin, action: 'listing.photo.cleared', subjectType: 'listing', subjectId: listingId, detail: { key, sha, rule }, legalBasis: 'ecommerceLaw' })
    }
    if (!restored.length) { await override(); return [] }
    const { count } = await tx.listing.updateMany({ where: { id: listingId, ...NOT_REMOVED, images: row.images }, data: { images: JSON.stringify(images) } })
    if (count !== 1) return null
    await override()
    await tx.storageTombstone.deleteMany({ where: { bucket: 'listings', path: { in: restored.map((r) => r.key) }, reason: 'listing_photo_stripped' } })
    await appendAudit(tx, { actorType: 'admin', actorId: admin, action: 'listing.photo.restored', subjectType: 'listing', subjectId: listingId, detail: { restored: restored.map(({ i, key }) => ({ i, key })) }, legalBasis: 'ecommerceLaw' })
    return restored.map((r) => r.url)
  })
  if (put?.length) refreshListingSurfaces([listingId], 'photoCheck', { home: true })
  return put
}

function parseImages(json: string | null): string[] {
  try {
    const v = JSON.parse(json || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
