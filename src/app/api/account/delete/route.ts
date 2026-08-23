import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

// ── Self-service account deletion (PDPL 91/2025: delete ≤20 days — we do it now) ──
//
// SECURITY MODEL (designed against mass-deletion abuse, 2026-07-06):
//  • No target parameter exists — the route deletes ONLY the authenticated caller's
//    own account (full JWT verify + DB profile via getCurrentProfile). There is no
//    id to enumerate, so no IDOR / bulk-deletion surface.
//  • Same-origin check: browsers' SameSite=Lax cookies already block cross-site
//    POSTs; the Origin check is defense-in-depth against CSRF regressions.
//  • Typed confirmation ("DELETE") must round-trip in the body — a drive-by script
//    can't trigger it with an empty POST.
//  • Strict rate limit (3/h per profile) — fail CLOSED; a Redis outage pauses
//    deletions (the manual support@ path still satisfies the legal deadline).
//  • Investigation hold: accounts that are held/suspended or the target of OPEN
//    reports cannot self-delete (evidence destruction by scammers); they get the
//    manual support path, which the law permits (retention for legal defense).
//
// WHAT IS DELETED vs KEPT:
//  Deleted: listings (+stats via cascade), storefront, reviews RECEIVED by the
//  storefront (required FK; the storefront they describe is gone), API keys,
//  webhooks, conversations + messages (both sides of the user's threads),
//  notifications, trust events, saved searches, push subscriptions, profile,
//  and the Supabase auth user. Storage images are purged ON the response path —
//  see purgeStorageObjects. Kept: reviews the user WROTE are anonymized (author name scrubbed +
//  authorProfileId → null), and
//  resolved report records are DETACHED from the dying listings first so they
//  survive by bare target/reporter ids for the statutory retention window
//  (e-commerce records: 3 years).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY

// True if any SURVIVING row still references this image URL. Storage object paths
// are flat (`${ts}-${rand}.webp`, no per-owner namespace) and the images array is
// user-supplied, so a caller could paste a VICTIM's image URL into their own
// listing and, on deletion, wipe someone else's image with the service-role key
// (cross-tenant destruction — 2026-07-06 launch audit). Gate every delete on this
// check: run AFTER the caller's own profile/seller/listings are already removed
// from the DB, so a match means another user genuinely owns the object → skip it.
// `contains` is a substring match on the JSON blob; it can only OVER-match (leave a
// harmless orphan), never under-match the exact URL — so it can't reintroduce the bug.
async function isStillReferenced(url: string): Promise<boolean> {
  const [inListing, sellerAvatar, profileAvatar] = await Promise.all([
    db.listing.count({ where: { images: { contains: url } } }),
    db.seller.count({ where: { avatarUrl: url } }),
    db.profile.count({ where: { avatarUrl: url } }),
  ])
  return inListing > 0 || sellerAvatar > 0 || profileAvatar > 0
}

// Storage purge. ⛔ THIS MUST NOT RUN IN `after()` — it is the erasure half of a PDPL
// deletion and it is UNRECOVERABLE if dropped: it runs after `tx.profile.delete`, so `urls`
// exists only in this closure and no surviving row points at those objects. The only storage
// GC cron covers `listing-videos`, so a lost purge orphans the images permanently with nothing
// able to find them. Post-response work has no completion guarantee on Cloud Run, so the call
// site AWAITS this. Audited 2026-08-19.
//
// ⛔ EVERY URL GETS EXACTLY ONE RECORDED OUTCOME, AND THAT IS THE WHOLE DESIGN. An earlier
// version counted outcomes as it went and re-queued a failed URL with `queue.push`. Three
// independent reviewers refuted it on the same race: a worker that drains the queue still runs
// `cursor++` on its undefined read, so a retry pushed afterwards lands at an index the shared
// cursor has already passed — never claimed, never counted, and reported as a SUCCESS while the
// object survived. That is the exact silent orphan this function exists to prevent. Outcomes are
// therefore written into a slot per index; anything without a slot at the end is a FAILURE with
// its key, so nothing can vanish between the counters.
//
// ⚠️ TWO THINGS ARE STILL NOT SOLVED, STATED RATHER THAN HIDDEN.
//  1. `withTimeout` abandons a slow reference check but CANNOT cancel it — isStillReferenced
//     takes no AbortSignal, so its three `LIKE '%…%'` scans hold their pool slots until Postgres
//     finishes. A worker then claims the next URL and issues three more, so over a full budget
//     the abandoned scans ACCUMULATE; concurrency 2 bounds the rate, not the total. It is why
//     this is 2 and not 8, but do not read it as a hard cap.
//  2. An account with hundreds of images cannot finish inside the budget, and nothing can retry
//     because the DB rows are already gone. Such a deletion ends with `failed > 0` and a residue
//     log. ⛔ THE REAL FIX IS A DURABLE MANIFEST — persist the object list BEFORE deleting the
//     profile and drain it from a cron — which needs a table and is deliberately not in this
//     change. Until then this is bounded, loud and finite, where the old `after()` version was
//     unbounded, silent and lossy.
const PURGE_CONCURRENCY = 2
// ⚠️ 12s, NOT 25s. This budget is now ON the response path, on top of the transaction and an
// 8s auth-user delete, so it is the user's spinner. At the measured worst case (15 images for
// the largest account) two workers finish in ~2-3s, so 12s is slack rather than a target.
const PURGE_BUDGET_MS = 12_000
const REF_CHECK_TIMEOUT_MS = 3_000
const DELETE_TIMEOUT_MS = 6_000
const RESIDUE_MAX = 50

/** Resolves to `fallback` on timeout OR rejection — never rejects, so no worker can reject
 *  Promise.all and turn a COMPLETED deletion into a 500. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    const settle = (v: T) => { clearTimeout(timer); resolve(v) }
    work.then(settle, () => settle(fallback))
  })
}

/** `<bucket>/<key>` — random, PII-free, and the WHOLE address an operator needs; the key alone
 *  does not say which bucket to look in. Never the URL, never anything joinable.
 *  ⚠️ Matches on the PATHNAME, so a cache-busting query string cannot end up inside the key and
 *  address the wrong object. */
function storageRefOf(url: string): string | null {
  let pathname: string
  try { pathname = new URL(url).pathname } catch { return null }
  const m = pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  return m ? `${m[1]}/${m[2]}` : null
}

// ⛔ `why` EXISTS BECAUSE THE TWO FAILURE KINDS ARE NOT INTERCHANGEABLE, and an earlier version
// logged them identically. 'delete-failed' is safe to retry by hand. 'ref-unknown' means the
// "is another surviving user still using this object?" check TIMED OUT — hand-deleting one of
// those can destroy a different user's image, which this code refuses to do for exactly that
// reason. The log has to keep them apart or it invites the harm the guard prevents.
type Outcome = { r: 'deleted' | 'kept' } | { r: 'failed'; ref: string | null; why: 'delete-failed' | 'ref-unknown' | 'unreached' }
/** `deleted` = the object is GONE (2xx, or 404/410 — already absent IS the desired end state,
 *  and counting it a failure would raise a false erasure alarm on every retry).
 *  `kept` = deliberately not deleted. `failed` = removal UNCONFIRMED, i.e. residue. */
type PurgeResult = { deleted: number; kept: number; failed: number; residue: string[] }

async function purgeStorageObjects(urls: string[]): Promise<PurgeResult> {
  const queue = [...new Set(urls)]
  const gone = (status: number) => (status >= 200 && status < 300) || status === 404 || status === 410

  if (!SUPABASE_URL || !SECRET_KEY) {
    // Misconfiguration erases NOTHING, so it is a total failure — and it still reports the keys,
    // because this is precisely a case where an operator has everything left to do.
    const residue = queue.map(storageRefOf).filter((k): k is string => !!k)
      .slice(0, RESIDUE_MAX).map((r) => `delete-failed:${r}`)
    return { deleted: 0, kept: 0, failed: queue.length, residue }
  }

  const deadline = Date.now() + PURGE_BUDGET_MS
  const outcome: Array<Outcome | null> = new Array(queue.length).fill(null)
  let cursor = 0

  const deleteOnce = async (bucket: string, key: string): Promise<number> =>
    withTimeout(
      fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
        method: 'DELETE',
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
      }).then((r) => r.status),
      DELETE_TIMEOUT_MS,
      0,
    )

  // Workers claim an INDEX, never a value, and stop themselves at the deadline — the race below
  // is a backstop, not the only bound.
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= queue.length) return
      if (Date.now() >= deadline) return // leaves outcome[i] null ⇒ counted as failed, with its key
      const url = queue[i]
      const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
      if (!m) { outcome[i] = { r: 'kept' }; continue }
      const [, bucket, key] = m
      // Never delete an object another (surviving) user still references. An UNKNOWN answer must
      // not delete: cross-tenant destruction is far worse than an orphan.
      const ref = await withTimeout(
        isStillReferenced(url).then((r): 'yes' | 'no' => (r ? 'yes' : 'no')),
        REF_CHECK_TIMEOUT_MS,
        'unknown' as const,
      )
      if (ref === 'yes') { outcome[i] = { r: 'kept' }; continue }
      if (ref === 'unknown') { outcome[i] = { r: 'failed', ref: `${bucket}/${key}`, why: 'ref-unknown' }; continue }
      let status = await deleteOnce(bucket, key)
      // ONE inline retry for a transient failure — inline, because re-queueing is what caused the
      // lost-retry race above.
      if (!gone(status) && Date.now() < deadline) status = await deleteOnce(bucket, key)
      outcome[i] = gone(status) ? { r: 'deleted' } : { r: 'failed', ref: `${bucket}/${key}`, why: 'delete-failed' }
    }
  }

  const pool = Promise.all(Array.from({ length: Math.min(PURGE_CONCURRENCY, queue.length) }, worker))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([pool, new Promise<void>((r) => { timer = setTimeout(r, PURGE_BUDGET_MS + 1_000) })])
  if (timer) clearTimeout(timer)

  let deleted = 0
  let kept = 0
  let failed = 0
  const residue: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const o = outcome[i]
    if (o?.r === 'deleted') { deleted++; continue }
    if (o?.r === 'kept') { kept++; continue }
    // No slot, or an explicit failure: either way the object's removal is UNCONFIRMED.
    failed++
    const ref = o?.r === 'failed' ? o.ref : storageRefOf(queue[i])
    const why = o?.r === 'failed' ? o.why : 'unreached'
    if (ref && residue.length < RESIDUE_MAX) residue.push(`${why}:${ref}`)
  }
  return { deleted, kept, failed, residue }
}

// ⚠️ WS6 — NOT MIGRATED, ON FOUR INDEPENDENT COUNTS. This is the irreversible route in the cluster,
// so the bar is byte-identity, not "close enough":
//  1. THE ORIGIN GATE MUST RUN BEFORE AUTH. It answers 403 `{"error":"Forbidden"}` to a cross-site
//     POST *without* consulting the session. route()'s fixed order is auth → rateLimit → body, so
//     under the wrapper a signed-out cross-site POST would flip from 403 to 401 — the CSRF gate
//     would still hold, but its verdict would stop being the one on the wire.
//  2. A GUEST GETS `{"error":"Unauthorized"}` (capital U), not `auth_required`. The wrapper's auth
//     code is hardcoded and not configurable.
//  3. THE 400 AND 429 BODIES ARE HUMAN SENTENCES, NOT CODES — `{"error":"Confirmation required"}`
//     and `{"error":"Too many attempts — try again later"}`. Neither is an ApiErrorCode, so neither
//     can be expressed as `invalidBodyCode` or reproduced by `rateLimit:`; the delete dialog renders
//     `error` straight to the user, so "tidying" them to codes would put `rate_limited` in front of
//     a person mid-deletion.
//  4. THE LIMITER MUST STAY AFTER THE CONFIRMATION CHECK. Hoisting it would let an empty drive-by
//     POST — the case the typed confirmation exists to absorb — burn one of the 3/h strict tokens
//     and lock a real user out of deleting their own account.
export async function POST(req: Request) {
  // Same-origin gate (defense-in-depth CSRF)
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (origin && host && (!URL.canParse(origin) || new URL(origin).host !== host)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { confirm?: string } = {}
  try { body = await req.json() } catch {}
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
  }

  const gate = await rateLimit('account-delete', profile.id, 3, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })

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
  if (underEnforcement || openReports > 0) {
    return NextResponse.json(
      { error: 'under_review', message: 'Your account has open reports or an active review — contact support@eno.vn to complete deletion.' },
      { status: 409 },
    )
  }

  // Interactive transaction: re-resolve the seller INSIDE the tx (a storefront
  // created concurrently must not survive as an orphan), then reports → reviews →
  // listings → storefront → profile. FK cascades take the rest (conversations +
  // messages on both sides, notifications, trust events, keys, webhooks,
  // subscriptions); reviews the user WROTE anonymize via SetNull.
  const imageUrls: string[] = profile.avatarUrl ? [profile.avatarUrl] : []
  await db.$transaction(async (tx) => {
    const s = await tx.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true } })
    if (s) {
      const listings = await tx.listing.findMany({ where: { sellerId: s.id }, select: { id: true, images: true } })
      for (const l of listings) { try { imageUrls.push(...(JSON.parse(l.images) as string[])) } catch {} }
      if (s.avatarUrl) imageUrls.push(s.avatarUrl)
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
    await tx.profile.delete({ where: { id: profile.id } })
  })

  // Remove the auth user (invalidates every session/device). Loud log on failure:
  // ensureProfile would recreate an EMPTY profile on a later sign-in — no data
  // comes back, but the orphan auth user should be cleaned up by hand.
  if (SUPABASE_URL && SECRET_KEY) {
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
  console.log('[account-delete] completed', profile.id)
  const { residue, ...purge } = await purgeStorageObjects(imageUrls)
  // A non-zero `failed` is an INCOMPLETE ERASURE and needs a human: the DB no longer holds
  // these URLs, so nothing can retry it automatically. `residue` carries the bare storage
  // keys precisely so that remediation is possible from the log alone.
  if (purge.failed > 0) console.error('[account-delete] storage purge INCOMPLETE', profile.id, purge, residue)
  else console.log('[account-delete] storage purged', profile.id, purge)

  return NextResponse.json({ ok: true })
}
