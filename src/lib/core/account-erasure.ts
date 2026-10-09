import { db } from '@/lib/db'
import { purgeStorageObjects } from '@/lib/core/storage-purge'
import { clearTombstones, writeTombstones, type TombstoneRef } from '@/lib/core/storage-tombstones'
import { listingObjectKey } from '@/lib/listing-image'
import { parseVerificationDocs } from '@/lib/business-verification-store'
import { BUSINESS_VERIFICATION_BUCKET, TEACHER_CVS_BUCKET, TEACHER_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { appendAudit } from '@/lib/compliance/audit'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { VISA_BUCKET } from '@/lib/visa-admin'
import { logError } from '@/lib/log'
import { isAppleRelayEmail } from '@/lib/apple-signin'
import {
  APPLE_MIN_CALL_MS,
  appleIdentityState,
  appleOnOffer,
  authUserState,
  hasQueuedTokens,
  isGoTrueUserNotFound,
  queueTokensForErasure,
  queueUnsettledTokens,
  settleQueuedTokens,
  type QueuedKey,
} from '@/lib/auth/apple-siwa'
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
//  Sign in with Apple: the kept tokens are queued in the same transaction (so the daily retry owns them whatever
//  happens next), and the person's authorization of eno is REVOKED at Apple before the auth user goes
//  (Guideline 5.1.1(v), TN3194 — settleAppleTokens below); the result rides back as `apple`.
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
/**
 * What happened to the person's Sign in with Apple authorization (Guideline 5.1.1(v), TN3194, plan D9):
 *   none    — PROVEN not an Apple account: GoTrue lists its providers and none is Apple, no token row of it was found,
 *             its address is not one of Apple's relays, and nothing the caller knows says otherwise.
 *   revoked — every token we held was validated and revoked: eno is gone from their Apple Account.
 *   queued  — Apple could not be reached (or refused our secret), or the request path's Apple budget ran out: retried
 *             daily for 14 days by /api/cron/apple-revocations. The person is told to remove eno in their Apple Account
 *             meanwhile.
 *   manual  — everything else: an Apple account whose token we do not hold, or whose token Apple says is already dead,
 *             and ANY account Apple may be involved with that we cannot prove otherwise (GoTrue not answering, a relay
 *             address): only the person can confirm eno is gone, so they are told how (support.apple.com/…/102571).
 * ⛔ FAIL TOWARD THE NOTICE (commit gate round 2, C1): a needless "check your Apple Account" costs a glance; a missing
 * one leaves eno in it for good.
 * ⛔ APPLE NEVER BLOCKS OR FAILS AN ERASURE: every Apple step is bounded — APPLE_ERASURE_BUDGET_MS in all — and caught.
 */
export type AppleEraseStatus = 'none' | 'revoked' | 'queued' | 'manual'
export type EraseResult =
  | { ok: true; purge: { deleted: number; kept: number; foreign: number; failed: number }; apple: AppleEraseStatus }
  | { ok: false; code: 'not_found' | 'under_review' }

/**
 * ⛔ THE APPLE WORK ON THE ERASURE'S REQUEST PATH, IN ALL (commit gate round 2, O3): GoTrue's identity read, the wait for
 * the Apple ID's lock and every call to Apple, together. It used to be a 5 s identity read, then up to 10 s for a pooled
 * connection, a 25 s lock wait and four 5 s calls per Apple ID — close to a minute, long enough for a proxy to give up
 * and the person to retry a deletion that had in fact succeeded. Past the budget, whatever is not settled stays queued
 * for the daily retry and the person reads `queued`.
 */
export const APPLE_ERASURE_BUDGET_MS = 9_000

/**
 * `signals.appleLinked`: what the CALLER knows — the self-service route's verified session claims name Apple. It can
 * only ADD the Apple notice (`manual` where the status would otherwise be `none`), never remove one.
 */
export async function eraseAccount(profileId: string, actor: EraseActor, signals: { appleLinked?: boolean } = {}): Promise<EraseResult> {
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

  // ⛔ SIGN IN WITH APPLE — whether GoTrue knows an Apple identity for this account, read BEFORE anything is deleted
  // (it is gone with the auth user). A GoTrue that does not answer in 5 s reads as "unknown". The kept tokens
  // themselves are queued INSIDE the transaction below and revoked after it. Its time counts against the Apple budget.
  // ⛔ Only where Apple can have been used (appleOnOffer — commit gate rounds 6–7): before Apple is configured the dark
  // deploy never waits on GoTrue for it; once configured, a later rollback of the flag still finds earlier Apple users.
  const appleStarted = Date.now()
  const appleIdentity: AppleIdentity = appleOnOffer() ? await readAppleIdentity(profile.id) : 'none'
  const appleIdentityMs = Date.now() - appleStarted
  /** What the transaction handed to the daily retry (queueTokensForErasure) — "failed" until it has run. */
  let appleQueue: AppleQueue = { keys: [], missingTable: false, failed: true }

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
    // The teacher's private files — the CV (phone and email on it) and a private intro video (2026-10-07). TeacherPrivate
    // cascades with the profile; its objects would not, and before this nothing queued them (map, 2026-10-07).
    const tpriv = await tx.teacherPrivate.findFirst({ where: { teacherProfile: { profileId: profile.id } }, select: { cvPath: true, videoPath: true } })
    if (tpriv?.cvPath) privateRefs.push({ bucket: TEACHER_CVS_BUCKET, path: tpriv.cvPath })
    if (tpriv?.videoPath) privateRefs.push({ bucket: TEACHER_VIDEOS_BUCKET, path: tpriv.videoPath })
    const identities = await tx.identityVerification.findMany({ where: { profileId: profile.id }, select: { id: true, evidence: true } })
    for (const v of identities) {
      const ev = (v.evidence && typeof v.evidence === 'object' && !Array.isArray(v.evidence) ? v.evidence : {}) as Record<string, unknown>
      for (const key of ['documentPath', 'selfiePath'] as const) {
        if (typeof ev[key] === 'string' && ev[key]) privateRefs.push({ bucket: BUSINESS_VERIFICATION_BUCKET, path: ev[key] as string })
      }
      /**
       * ⛔ THE EVIDENCE IS FILTERED BY RULE, NOT BY A LIST OF FOUR NAMES — BECAUSE THE LIST WENT
       * STALE THE FIRST TIME SOMEONE ADDED A KEY. §4.2 says clear the name and the nationality and
       * keep the hash, decision and expiry; a fixed destructure honours that only for the keys that
       * existed the day it was written. The review path since grew `nationalitySource`,
       * `nationalityBefore`, `nationalityAfter`, `nationalitySetBy`, `nationalitySetAt`,
       * service.ts grew `nationalitySuggested`/`nationalitySuggestedFrom`, and review.ts grew a
       * `corrections` log holding both codes AND a free-text reason. Every one of those survived an
       * erasure through `...kept` — so an erased record still answered "what nationality", which is
       * the exact question the nulled column exists to stop answering. Three reviewer seats found
       * it independently (2026-09-09).
       *
       * ⛔ SO THE RULE IS DROP-BY-DEFAULT FOR ANYTHING NATIONALITY-SHAPED, plus the named
       * object-path and decision-input keys. A future `nationalityWhatever` is dropped without
       * anyone remembering to come back here, and being wrong in that direction costs an audit
       * detail; being wrong in the other direction is a failed deletion request.
       *
       * ⚠️ ONE PREFIX IS NOT A GENERAL RULE, AND SAYING SO HERE IS THE POINT. `residence*` or any
       * other family of PII keys added later still needs a line in this filter — the prefix bought
       * safety for the keys that exist, not immunity from thinking (the Opus seat, 2026-09-09).
       * Anything added to `evidence` that identifies the PERSON rather than the CHECK belongs on
       * one of these two lists the day it is written.
       */
      const DROP_EXACT = new Set(['documentPath', 'selfiePath', 'decisionInput', 'corrections'])
      const kept = Object.fromEntries(
        Object.entries(ev).filter(([k]) => !DROP_EXACT.has(k) && !k.startsWith('nationality')),
      )
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
    // ⛔ APPLE'S TOKENS ARE QUEUED IN THIS COMMIT, NOT AFTER IT (commit-gate C1, 2026-10-08). Every active row of this
    // account becomes the daily retry's in the same commit that deletes the profile, so a process killed right after
    // the commit — before the revocation below — leaves them queued, not active and invisible to the retry for good.
    // Never fails this transaction: a missing table or a failed UPDATE answers instead (savepoint — see the helper).
    appleQueue = await queueTokensForErasure(tx, profile.id)
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

  // ⛔ APPLE'S TOKENS ARE REVOKED AFTER THE ROWS ARE GONE AND BEFORE THE AUTH USER IS (TN3194): the rows the
  // transaction queued are validated, then revoked, each deleted once settled; what Apple could not take now stays
  // queued for the daily retry. Runs even when the auth user is kept below (deskQueueFailed): the account the person
  // asked to delete is gone from eno either way, and so must eno be from their Apple Account. Within what the identity
  // read left of APPLE_ERASURE_BUDGET_MS (O3) — the transaction and the storage walks in between are not Apple's time.
  const appleSettled = await settleAppleTokens(profile.id, appleQueue, Date.now() + APPLE_ERASURE_BUDGET_MS - appleIdentityMs)

  // Remove the auth user (invalidates every session/device). Loud log on failure:
  // ensureProfile would recreate an EMPTY profile on a later sign-in — no data
  // comes back, but the orphan auth user should be cleaned up by hand.
  let authUserGone = false
  if (deskQueueFailed) {
    // handled above
  } else if (SUPABASE_URL && SECRET_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profile.id}`, {
        method: 'DELETE',
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        signal: AbortSignal.timeout(8000),
      })
      // 404 from GoTrue itself (user_not_found): already gone — for the sweep below the same as deleted now. Not just any
      // 404: a gateway's "no route" left the auth user in place, and the sweep must not run then (isGoTrueUserNotFound).
      authUserGone = res.ok || (await isGoTrueUserNotFound(res))
      if (!res.ok) console.error('[account-delete] auth user removal failed', profile.id, res.status)
    } catch (e) {
      console.error('[account-delete] auth user removal errored', profile.id, (e as Error).name)
    }
  } else {
    console.error('[account-delete] SUPABASE_SECRET_KEY missing — auth user not removed', profile.id)
  }

  // ⛔ AND AGAIN ONCE THE AUTH USER IS GONE (commit-gate C2, 2026-10-08). Until that DELETE the account could still
  // sign in elsewhere — another device, a tab mid-flow — and a sign-in stores its token at the END, so one could land
  // after the transaction's queue and after the revocation above: an ACTIVE row with no account behind it, never
  // revoked. Queue whatever row is still active, now that no sign-in can belong to this account any more. A store
  // that lands later still — after this sweep — is the daily retry's orphan sweep's (queueOrphanedTokens).
  // Not when the auth user is kept: a row re-activated then is a live sign-in, and the account can be used again.
  let appleSwept = 0
  if (authUserGone && !appleQueue.missingTable) {
    try {
      appleSwept = (await queueUnsettledTokens(profile.id)).length
    } catch (e) {
      logError(e, { op: 'account-erasure.apple-sweep' })
    }
  }
  const apple = appleEraseStatus(appleSettled, appleSwept, appleIdentity, profile.email, signals.appleLinked === true)

  // Audit line (id only — no PII), then the storage purge ON the response path.
  console.log('[account-delete] completed', profile.id, by, { deskQueued, ownedQueued, apple })
  const { residue, settled, ...purge } = await purgeStorageObjects(imageUrls)
  // Settled = gone, or somebody else's. Clearing can fail without consequence: the sweep re-checks
  // references and finds those objects absent or referenced, and drops the tombstones itself.
  try { await clearTombstones(settled) } catch (e) { console.error('[account-delete] tombstones not cleared (sweep will)', profile.id, e) }
  // A non-zero `failed` is an INCOMPLETE ERASURE and needs a human: the DB no longer holds
  // these URLs, so nothing can retry it automatically. `residue` carries the bare storage
  // keys precisely so that remediation is possible from the log alone.
  if (purge.failed > 0) console.error('[account-delete] storage purge INCOMPLETE', profile.id, purge, residue)
  else console.log('[account-delete] storage purged', profile.id, purge)


  return { ok: true, purge, apple }
}

/** What the transaction handed over: the rows it queued, or why there are none (no table; the hand-over failed). */
type AppleQueue = { keys: QueuedKey[]; missingTable: boolean; failed: boolean }
type AppleIdentity = 'apple' | 'none' | 'unknown'

async function readAppleIdentity(userId: string): Promise<AppleIdentity> {
  try {
    return await appleIdentityState(userId)
  } catch (e) {
    // It answers rather than throws; this is the last guard of "Apple never blocks an erasure".
    logError(e, { op: 'account-erasure.apple-identity' })
    return 'unknown'
  }
}

/**
 * What the revocation right after the commit achieved. `pending`: rows still queued for the daily retry. `seen`: token
 * rows of this account found at all, whatever became of them. `unowned`: the transaction's hand-over failed AND the one
 * after the commit too — rows of this account may still be ACTIVE, and nothing is going to retry them.
 */
type AppleSettled = { revoked: number; dead: number; pending: number; seen: number; unowned: boolean }

/**
 * Settle the rows the transaction queued, at once: one locked unit per Apple ID (settleQueuedTokens — it checks every
 * row, THEN revokes the valid ones, because the Services ID and the bundle ID share ONE grouped authorization:
 * checked row by row, the second answered invalid_grant after the first revoke, and a person eno WAS removed for was
 * told to remove it by hand). A row the unit could not settle stays queued — the transaction made it the daily
 * retry's — so nothing here can leave a token active. When the transaction's hand-over had failed, it is done first,
 * now (queueUnsettledTokens).
 * ⛔ BY `deadline` (O3): each unit gets what is left of it (a short lock wait, calls bounded by it), and a unit there is
 * no time left for is not started — its rows stay queued, the daily retry's, and count as pending.
 */
async function settleAppleTokens(userId: string, queue: AppleQueue, deadline: number): Promise<AppleSettled> {
  const s: AppleSettled = { revoked: 0, dead: 0, pending: 0, seen: 0, unowned: false }
  if (queue.missingTable) return s
  let keys = queue.keys
  if (queue.failed) {
    try {
      keys = await queueUnsettledTokens(userId)
    } catch (e) {
      logError(e, { op: 'account-erasure.apple-handover' })
      s.unowned = true
      return s
    }
  }
  s.seen = keys.length
  const bySub = new Map<string, string[]>()
  for (const k of keys) bySub.set(k.appleSub, [...(bySub.get(k.appleSub) ?? []), k.clientId])
  for (const [appleSub, clientIds] of bySub) {
    if (deadline - Date.now() < APPLE_MIN_CALL_MS) {
      s.pending += clientIds.length
      continue
    }
    try {
      for (const o of await settleQueuedTokens({ userId, appleSub, clientIds }, { liveCheck: false, deadline })) {
        if (o.outcome === 'revoked') s.revoked++
        else if (o.outcome === 'manual') s.dead++
        else if (o.outcome === 'retried' || o.outcome === 'deferred') s.pending++
        // 'skipped': a sign-in re-activated the row (the post-delete sweep queues it again) or the retry settled it.
      }
    } catch (e) {
      // Still queued, exactly as the transaction left them: the daily retry has them.
      logError(e, { op: 'account-erasure.apple-settle' })
      s.pending += clientIds.length
    }
  }
  return s
}

/**
 * The person's Apple status, most demanding first:
 *   queued  — anything waiting for the daily retry (a row Apple could not take now, one the budget left, or one the
 *             post-delete sweep found);
 *   manual  — rows that could not be handed to the retry at all (nobody will retry them);
 *   revoked — at least one token revoked here: the one grouped authorization is gone, so a token that was already dead
 *             (an earlier authorization) changes nothing;
 *   then, nothing revoked and nothing waiting — ⛔ FAIL TOWARD THE NOTICE (commit gate round 2, C1): `none` ONLY when
 *   GoTrue proved no Apple identity (appleIdentityState 'none'), no token row was found, the address is not one of
 *   Apple's relays and the caller's session did not name Apple. Every other state is `manual` — a dead token, an Apple
 *   identity, GoTrue unreachable (it used to read `none` unless the address was a relay: an Apple user who had shared
 *   a real address and whose token was never kept got no notice at all), rows settled elsewhere meanwhile.
 */
/**
 * ⚠️ AN UNKNOWN IDENTITY COUNTS ONLY WHERE APPLE COULD HAVE BEEN USED (commit gate round 4, opus): failing toward the
 * notice (round 2, C1) told every Google and email user deleting during a GoTrue blip to "remove eno in your Apple
 * Account" — through the dark deploy too, where nobody can have signed in with Apple. `unknown` now reads as Apple only
 * where Apple can have been used (appleOnOffer: the flag, or Apple configured on this server). eno.forum counts once
 * configured: the editions share one GoTrue, so an eno.vn Apple account can sign in and be deleted on either.
 */
function appleEraseStatus(s: AppleSettled, swept: number, identity: AppleIdentity, email: string | null, linked: boolean): AppleEraseStatus {
  if (s.pending || swept) return 'queued'
  if (s.unowned) return 'manual'
  // A dead row beside a revoked one is an earlier authorization of the same grouped Apple ID (both clients share one):
  // the revoke removed eno. Two different Apple IDs on one account would need GoTrue's manual linking, which is off (D8).
  if (s.revoked) return 'revoked'
  const identityApple = identity === 'apple' || (identity === 'unknown' && appleOnOffer())
  if (s.dead || s.seen || identityApple || linked || isAppleRelayEmail(email)) return 'manual'
  return 'none'
}

/**
 * ⛔ A REPEATED DELETION REQUEST, AFTER THE FIRST ONE SUCCEEDED (commit gate round 2, O3) — the Apple status to answer it
 * with, or null unless the account is PROVABLY erased. The caller has checked the profile is gone; this asks for
 * GoTrue's own word that the auth user is too (authUserState: auth.users, or the admin API's user_not_found — never just
 * any 404), so a session that merely failed to resolve never reads as a finished deletion.
 * What the first request answered is not kept anywhere, so this fails toward the notice: rows still queued for the
 * daily retry → `queued`; the queue unreadable, or the verified session naming Apple or carrying a relay address →
 * `manual`; else `none`.
 */
export async function appleStatusAfterErasure(userId: string, session: { appleLinked: boolean; email: string | null }): Promise<AppleEraseStatus | null> {
  if ((await authUserState(userId)) !== 'gone') return null
  const queued = await hasQueuedTokens(userId)
  if (queued === true) return 'queued'
  if ((queued === null && appleOnOffer()) || session.appleLinked || isAppleRelayEmail(session.email)) return 'manual'
  return 'none'
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
