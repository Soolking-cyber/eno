import { db } from '@/lib/db'
import { purgeStorageObjects } from '@/lib/core/storage-purge'
import { clearTombstones, writeTombstones, type TombstoneRef } from '@/lib/core/storage-tombstones'
import { listingObjectKey } from '@/lib/listing-image'
import { parseVerificationDocs } from '@/lib/business-verification-store'
import { BUSINESS_VERIFICATION_BUCKET } from '@/lib/supabase-admin'
import { appendAudit } from '@/lib/compliance/audit'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { VISA_BUCKET } from '@/lib/visa-admin'
import { logError } from '@/lib/log'
import type { Prisma } from '@/generated/prisma/client'

// ── ACCOUNT ERASURE (PDPL 91/2025: delete ≤20 days — we do it now) ──────────────────────────────
//
// The ONE erasure path, whoever asks for it: the person themselves (POST /api/account/delete, which
// keeps the CSRF gate, the typed confirmation and the strict rate limit around this) or an admin
// acting on a written request (the Users console, 2026-09-05). Before that date the whole procedure
// lived inside the self-service route, so an admin had no way to erase an account at all except by
// SQL — and no audit row was written either way.
//
// WHAT IS DELETED vs KEPT:
//  Deleted: listings (+stats via cascade), storefront, reviews RECEIVED by the storefront (required
//  FK; the storefront they describe is gone), API keys, webhooks, conversations + messages (both
//  sides of the user's threads), notifications, trust events, saved searches, push subscriptions,
//  profile, and the Supabase auth user. Storage objects are tombstoned in the same transaction and
//  purged on the response path (purgeStorageObjects); the sweep finishes what the fast path cannot.
//  Kept: reviews the user WROTE are anonymized (author name scrubbed + authorProfileId → null),
//  resolved report records are DETACHED from the dying listings first so they survive by bare
//  target/reporter ids for the statutory retention window (e-commerce records: 3 years), and the
//  identity-verification RECORD survives pseudonymised (docs/compliance-2026.md §4.2).
//
// INVESTIGATION HOLD: an account that is held/suspended or the target of OPEN reports is not erased
// (evidence destruction by scammers); the caller reports `under_review`. An admin resolves the
// reports or lifts the action first — deliberately no override flag, so "erase" can never be the
// way a case disappears.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY

export type EraseActor = { kind: 'self' } | { kind: 'admin'; email: string; reason: string }
export type EraseResult =
  | { ok: true; purge: { deleted: number; kept: number; foreign: number; failed: number } }
  | { ok: false; code: 'not_found' | 'under_review' }

export async function eraseAccount(profileId: string, actor: EraseActor): Promise<EraseResult> {
  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { id: true, avatarUrl: true, enforcementState: true, email: true } })
  if (!profile) return { ok: false, code: 'not_found' }
  const by = actor.kind === 'self' ? 'self' : `admin:${actor.email}`

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true } })

  // Investigation hold — no evidence destruction while reports are open or the
  // account is under enforcement. These users go through support (manual review).
  const underEnforcement = ['held', 'suspended'].includes(profile.enforcementState)
  const openReports = await db.report.count({
    where: {
      status: 'open',
      OR: [{ targetProfileId: profile.id }, ...(seller ? [{ targetSellerId: seller.id }] : [])],
    },
  })
  if (underEnforcement || openReports > 0) return { ok: false, code: 'under_review' }

  // Interactive transaction: re-resolve the seller INSIDE the tx (a storefront
  // created concurrently must not survive as an orphan), then reports → reviews →
  // listings → storefront → profile. FK cascades take the rest (conversations +
  // messages on both sides, notifications, trust events, keys, webhooks,
  // subscriptions); reviews the user WROTE anonymize via SetNull.
  const imageUrls: string[] = profile.avatarUrl ? [profile.avatarUrl] : []
  // Private-bucket objects this person owns (business-registration scans, KYC captures). They have
  // no public URL and are never on the response-path purge; the tombstone sweep removes them.
  const privateRefs: TombstoneRef[] = []
  await db.$transaction(async (tx) => {
    const s = await tx.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true, bannerUrl: true } })
    if (s) {
      const listings = await tx.listing.findMany({ where: { sellerId: s.id }, select: { id: true, images: true, video: true } })
      for (const l of listings) {
        try { imageUrls.push(...(JSON.parse(l.images) as string[])) } catch {}
        // ⚠️ THE LISTING VIDEO TOO — it was never queued, so a deleted seller's clips stayed public.
        if (l.video) imageUrls.push(l.video)
      }
      if (s.avatarUrl) imageUrls.push(s.avatarUrl)
      if (s.bannerUrl) imageUrls.push(s.bannerUrl)
      // SellerVerification rows cascade with the storefront; their bucket objects would not.
      const cases = await tx.sellerVerification.findMany({ where: { sellerId: s.id }, select: { documents: true } })
      for (const c of cases) for (const d of parseVerificationDocs(c.documents)) privateRefs.push({ bucket: BUSINESS_VERIFICATION_BUCKET, path: d.path })
      // Resolved reports must SURVIVE for the statutory retention window, but
      // Report.listingId cascades with the listing — detach them first so the
      // record (with its bare target/reporter ids) outlives the listing. Open
      // reports can't exist here (the hold above blocks deletion).
      await tx.report.updateMany({
        where: { listingId: { in: listings.map((l) => l.id) } },
        data: { listingId: null },
      })
      // Reviews RECEIVED by this storefront: Review.sellerId is a required FK
      // (restrict) — deleting the seller with reviews attached would throw. The
      // storefront they describe is being erased; remove them with it.
      await tx.review.deleteMany({ where: { sellerId: s.id } })
      await tx.listing.deleteMany({ where: { sellerId: s.id } })
      await tx.seller.delete({ where: { id: s.id } })
    }
    // Reviews the user WROTE stay (they belong to the reviewed storefront), but the
    // captured author DISPLAY NAME renders publicly and must be erased too — nulling
    // only authorProfileId (via SetNull) would leave the name visible forever after a
    // PDPL erasure request (2026-07-06 launch audit). Scrub it before deleting the FK.
    await tx.review.updateMany({ where: { authorProfileId: profile.id }, data: { author: 'Anonymous' } })
    // Identity verification: the RECORD survives (onDelete: SetNull — the 3-year duty is to keep
    // that a verification happened, keyed by subjectHash), the PERSON does not (docs/compliance-2026.md
    // §4.2: on erasure clear the name and nationality, keep the hash, decision and expiry). The
    // evidence column keeps the checks and consent stamps but loses the object paths and the
    // decision inputs (the names again), and the captures themselves are tombstoned.
    const identities = await tx.identityVerification.findMany({ where: { profileId: profile.id }, select: { id: true, evidence: true } })
    for (const v of identities) {
      const ev = (v.evidence && typeof v.evidence === 'object' && !Array.isArray(v.evidence) ? v.evidence : {}) as Record<string, unknown>
      for (const key of ['documentPath', 'selfiePath'] as const) {
        if (typeof ev[key] === 'string' && ev[key]) privateRefs.push({ bucket: BUSINESS_VERIFICATION_BUCKET, path: ev[key] as string })
      }
      const { documentPath: _d, selfiePath: _s, decisionInput: _i, ...kept } = ev
      await tx.identityVerification.update({
        where: { id: v.id },
        data: { fullName: null, nationality: null, residenceCountry: null, residenceSource: null, evidence: kept as Prisma.InputJsonValue },
      })
    }
    // ⛔ TOMBSTONES COMMIT WITH THE ROWS. Every first-party public object and every private one
    // gets a StorageTombstone in THIS transaction, so from the moment the rows are gone there is
    // a durable record of what still has to go. The purge below is the fast path; what it
    // settles is cleared, and /api/cron/storage-tombstones finishes the rest.
    const publicRefs: TombstoneRef[] = []
    for (const u of imageUrls) { const p = listingObjectKey(u); if (p) publicRefs.push({ bucket: p.bucket, path: p.key }) }
    await writeTombstones(tx, [...publicRefs, ...privateRefs], 'account_deleted')
    // The erasure itself is recorded (§4.2: "an unexplained gap in a hash chain is worse than a
    // documented one") — by whom, why, and how many objects were queued. No PII: bare ids only.
    await appendAudit(tx, {
      actorType: actor.kind === 'self' ? 'user' : 'admin',
      actorId: actor.kind === 'self' ? profile.id : actor.email,
      action: 'account.erased',
      subjectType: 'profile',
      subjectId: profile.id,
      // ⚠️ `reason` is an admin's free text and this row outlives the erasure: the console asks for
      // a ticket id or a date, never a name, and it is capped here as well.
      detail: { by: actor.kind, reason: actor.kind === 'admin' ? actor.reason.slice(0, 120) : 'self_service', objects: publicRefs.length + privateRefs.length },
    })
    await tx.profile.delete({ where: { id: profile.id } })
  }, { timeout: 30_000 }) // an account with hundreds of listings writes hundreds of tombstones; Prisma's 5s default is for a form save

  // ⛔ THE DESK'S OBJECTS ARE QUEUED BEFORE THE AUTH USER GOES. `visa_applications.user_id`
  // references auth.users ON DELETE CASCADE (measured 2026-09-05), and the document rows cascade
  // from the applications — so the auth-user DELETE below is what removes every visa case this
  // person had, on either edition and whatever its status, and it removes the ROWS only: the
  // scans in the private bucket would be orphaned with nothing left pointing at them. So every
  // object under the user's prefix is tombstoned FIRST (paths are `${userId}/${applicationId}/…`,
  // listed here by prefix — no visa table is named in this shared module); the sweep re-checks
  // each against the document rows and drops the tombstone of anything a surviving case (a paid
  // one the delete-guard trigger keeps, and with it the auth user) still references.
  // If that queueing fails, the auth user is NOT deleted: an orphan auth user is recoverable by
  // hand; orphaned passport scans are not findable at all.
  let deskQueued = 0
  let deskQueueFailed = false
  try {
    deskQueued = await writeTombstones(db, await listDeskObjects(profile.id), 'visa_application_deleted')
  } catch (e) {
    deskQueueFailed = true
    logError(e, { op: 'account-erasure.desk-objects' })
    console.error('[account-delete] desk objects NOT queued — auth user kept so the cascade cannot orphan them', profile.id)
  }

  /**
   * ⛔ AND THE PRIVATE VERIFICATION PREFIX, WHICH THE ROW WALK ABOVE CANNOT SEE. The transaction
   * collected every path a case or an identity record NAMES; this collects every object the person
   * actually owns, which is a superset — an abandoned capture has no row to be named by. Both are
   * needed: the rows are gone by now, so only the prefix can still enumerate them.
   *
   * ⚠️ A FAILURE HERE IS LOGGED, NOT FATAL. Unlike the desk listing above it does not gate the
   * auth-user delete: nothing about removing the auth user destroys the ability to find these
   * objects again, because the prefix is the person's id and that does not change.
   */
  let ownedQueued = 0
  try {
    ownedQueued = await writeTombstones(db, await listOwnedVerificationObjects(profile.id), 'account_deleted')
  } catch (e) {
    logError(e, { op: 'account-erasure.verification-objects' })
    /**
     * ⛔ THE PREFIX IS IN THE LOG BECAUSE NOTHING WILL ASK AGAIN. By this point the profile row is
     * gone, so no retry can rediscover which person these objects belonged to — an external
     * reviewer was right that "it is logged" is not a recovery path on its own. The prefix IS the
     * recovery path: `<profileId>/` in the private bucket, remediable by hand from this line
     * alone, exactly as `residue` serves the purge below.
     */
    console.error(
      `[account-delete] INCOMPLETE ERASURE — private verification prefix "${profile.id}/" was not enumerated; ` +
      `objects under it are orphaned and must be removed by hand`,
    )
  }

  // Remove the auth user (invalidates every session/device). Loud log on failure:
  // ensureProfile would recreate an EMPTY profile on a later sign-in — no data
  // comes back, but the orphan auth user should be cleaned up by hand.
  if (deskQueueFailed) {
    // handled above
  } else if (SUPABASE_URL && SECRET_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profile.id}`, {
        method: 'DELETE',
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) console.error('[account-delete] auth user removal failed', profile.id, res.status)
    } catch (e) {
      console.error('[account-delete] auth user removal errored', profile.id, (e as Error).name)
    }
  } else {
    console.error('[account-delete] SUPABASE_SECRET_KEY missing — auth user not removed', profile.id)
  }

  // Audit line (id only — no PII), then the storage purge ON the response path.
  console.log('[account-delete] completed', profile.id, by, { deskQueued, ownedQueued })
  const { residue, settled, ...purge } = await purgeStorageObjects(imageUrls)
  // Settled = gone, or somebody else's. Clearing can fail without consequence: the sweep re-checks
  // references and finds those objects absent or referenced, and drops the tombstones itself.
  try { await clearTombstones(settled) } catch (e) { console.error('[account-delete] tombstones not cleared (sweep will)', profile.id, e) }
  // A non-zero `failed` is an INCOMPLETE ERASURE and needs a human: the DB no longer holds
  // these URLs, so nothing can retry it automatically. `residue` carries the bare storage
  // keys precisely so that remediation is possible from the log alone.
  if (purge.failed > 0) console.error('[account-delete] storage purge INCOMPLETE', profile.id, purge, residue)
  else console.log('[account-delete] storage purged', profile.id, purge)


  return { ok: true, purge }
}

/** One Supabase listing page. Their maximum; asking for more is silently capped. */
const LIST_PAGE = 1000
/** A sanity ceiling, not a policy: past this something is wrong and erasure must say so. */
const MAX_LISTED_OBJECTS = 100_000

/**
 * Every entry under `prefix`, PAGINATED.
 *
 * ⛔ `list()` RETURNS AT MOST ONE PAGE AND SAYS NOTHING ABOUT THE REST. The two callers below each
 * asked for `{ limit: 1000 }` and treated the answer as the whole folder — so a user with more than
 * a thousand objects at either level had the surplus silently skipped, and skipped objects in these
 * buckets are passport scans and identity captures that nothing will ever look for again. A short
 * page is the only end-of-list signal there is; anything else keeps asking.
 *
 * A listing error THROWS: "could not enumerate" must never read as "nothing there".
 */
async function listAllEntries(
  storage: ReturnType<ReturnType<typeof getSupabaseAdmin>['storage']['from']>,
  prefix: string,
  label: string,
): Promise<Array<{ name: string; isFile: boolean }>> {
  const out: Array<{ name: string; isFile: boolean }> = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const page = await storage.list(prefix, { limit: LIST_PAGE, offset })
    if (page.error) throw new Error(`${label}: ${page.error.message}`)
    const rows = page.data ?? []
    // Supabase lists "folders" as entries with no id; files carry one.
    for (const r of rows) out.push({ name: r.name, isFile: !!r.id })
    if (rows.length < LIST_PAGE) return out
    if (out.length > MAX_LISTED_OBJECTS) throw new Error(`${label}: more than ${MAX_LISTED_OBJECTS} entries under "${prefix}"`)
  }
}

/** Every object `bucket` holds under this user's prefix, across both levels. */
async function listOwnedObjects(bucket: string, userId: string, label: string): Promise<TombstoneRef[]> {
  const storage = getSupabaseAdmin().storage.from(bucket)
  const refs: TombstoneRef[] = []
  for (const entry of await listAllEntries(storage, userId, label)) {
    if (entry.isFile) { refs.push({ bucket, path: `${userId}/${entry.name}` }); continue }
    for (const f of await listAllEntries(storage, `${userId}/${entry.name}`, label)) {
      if (f.isFile) refs.push({ bucket, path: `${userId}/${entry.name}/${f.name}` })
    }
  }
  return refs
}

/** The visa desk's objects (`user/application/file`). */
async function listDeskObjects(userId: string): Promise<TombstoneRef[]> {
  return listOwnedObjects(VISA_BUCKET, userId, 'desk_list_failed')
}

/**
 * Everything the PRIVATE verification bucket holds under this person's prefix.
 *
 * ⛔ THE ROWS ARE NOT THE WHOLE STORY IN THIS BUCKET, AND THAT IS THE GAP THIS CLOSES. Both writers
 * here store the object BEFORE any row references it: a KYC capture lands at
 * `<profile>/identity/…` and only becomes evidence when the applicant finishes the form, and a
 * business document lands at `<profile>/…` and only becomes a case document when the append
 * commits. Someone who photographs their passport and closes the tab therefore leaves images that
 * no row-driven erasure and no row-driven retention will ever find. The prefix does find them —
 * which is exactly why kyc/store.ts puts the person on top of the path — and the sweep re-checks
 * each against the surviving rows before deleting anything.
 */
async function listOwnedVerificationObjects(profileId: string): Promise<TombstoneRef[]> {
  return listOwnedObjects(BUSINESS_VERIFICATION_BUCKET, profileId, 'verification_list_failed')
}
