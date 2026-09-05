import { db } from '@/lib/db'
import { isFirstPartyStorageUrl, listingObjectKey, STORAGE_HOST } from '@/lib/listing-image'

// ── DELETING A USER'S PUBLIC STORAGE OBJECTS ────────────────────────────────────────────────────
//
// Lives in lib, NOT in the account-delete route file: a Next route module may only export handlers
// and route config, and an extra export fails `next build`'s route-type check (the exact class of
// failure the Dockerfile's `&&` now stops on). Tested directly in storage-purge.test.ts.

/** Read per call, not at import: the misconfiguration branch below is tested by unsetting it. */
const secretKey = () => process.env.SUPABASE_SECRET_KEY

/**
 * Is this object still in use by ANY surviving row? Storage object paths are flat
 * (`${ts}-${rand}.webp`, no per-owner namespace) and the images array is user-supplied, so a
 * caller could paste a VICTIM's image URL into their own listing and, on deletion, wipe someone
 * else's image with the service-role key (cross-tenant destruction — 2026-07-06 launch audit).
 * Gate every delete on this check: it runs AFTER the caller's own profile/seller/listings are
 * removed, so a match means some other user's row still points at the object → keep it. Every
 * column that can hold a first-party public URL is checked — listing images AND the listing
 * video, both seller images, the profile avatar.
 *
 * ⚠️ THE ACCEPTED LIMIT OF A FLAT NAMESPACE, stated so nobody "fixes" it into the worse bug: a
 * surviving row that references the departing user's object — by copying its canonical URL, which
 * ingestion allows — keeps that object alive, because nothing here can tell an owner from a
 * copier. The alternative, deleting whatever the departing user's rows named, is the
 * cross-tenant destruction above. Erasure of a copied object needs an owner namespace, not a
 * different comparison.
 *
 * ⚠️ `contains` on every column, not equality: a legacy row could hold an aliased spelling of the
 * same object (a query or fragment appended — the S01 hole this route used to have) and equality
 * would call that object unreferenced. The canonical URL is a substring of a query/fragment alias;
 * it is NOT a substring of a dot-segment (`a/../x.webp`) or percent (`%2Ex`) alias — those two
 * would read as unreferenced and be deleted, which is the same outcome equality gives for every
 * alias, so `contains` is strictly no worse. The dangerous direction (an alias in the DEPARTING
 * user's rows deleting somebody else's object) is closed by `listingObjectKey`, which never lets
 * an alias into the delete path at all.
 * Measured 2026-09-05 over every column above: 51,429 first-party URLs in production, all
 * canonical, all in `listings`/`listing-videos`; profile avatars are Google-hosted (foreign).
 */
export async function isStillReferenced(url: string): Promise<boolean> {
  const [inListing, listingVideo, sellerAvatar, sellerBanner, profileAvatar] = await Promise.all([
    db.listing.count({ where: { images: { contains: url } } }),
    db.listing.count({ where: { video: { contains: url } } }),
    db.seller.count({ where: { avatarUrl: { contains: url } } }),
    db.seller.count({ where: { bannerUrl: { contains: url } } }),
    db.profile.count({ where: { avatarUrl: { contains: url } } }),
  ])
  return inListing > 0 || listingVideo > 0 || sellerAvatar > 0 || sellerBanner > 0 || profileAvatar > 0
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
//     takes no AbortSignal, so its five `LIKE '%…%'` scans hold their pool slots until Postgres
//     finishes. A worker then claims the next URL and issues five more, so over a full budget
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
  const ref = listingObjectKey(url)
  if (ref) return `${ref.bucket}/${ref.key}`
  // ⛔ OURS OR NOTHING. A first-party URL the parser refuses is still named — from the URL's own
  // tail (path only, bounded) — so the residue line is never empty for something we may have to
  // finish by hand. Anything else returns null: a Google avatar's photo id, a merchant CDN path,
  // are joinable identifiers and never belong in a log (2026-09-05 review of this change).
  if (!isFirstPartyStorageUrl(url)) return null
  const path = url.split(/[?#]/, 1)[0]
  const tail = path.slice(path.indexOf('/storage/v1/') + '/storage/v1/'.length).replace(/^object\/public\//, '')
  return tail ? tail.slice(0, 120) : null
}

// ⛔ `why` EXISTS BECAUSE THE FAILURE KINDS ARE NOT INTERCHANGEABLE, and an earlier version logged
// them identically. 'delete-failed' passed the reference check and is safe to retry by hand.
// 'ref-unknown' means the "is another surviving user still using this object?" check TIMED OUT —
// hand-deleting one of those can destroy a different user's image, which this code refuses to do
// for exactly that reason. 'unparsed' and 'unreached' NEVER REACHED the reference check either:
// the tail in the log names an object, not a verdict — the alias `victim.webp#f` in a departing
// user's row logs `unparsed:listings/victim.webp`, and that object may be somebody else's. An
// operator finishing one of those by hand runs the reference check FIRST. The log has to keep
// them apart or it invites the harm the guard prevents.
type Outcome =
  | { r: 'deleted' | 'kept' | 'foreign' }
  | { r: 'failed'; ref: string | null; why: 'delete-failed' | 'ref-unknown' | 'unreached' | 'unparsed' }
/** `deleted` = the object is GONE (2xx, or 404/410 — already absent IS the desired end state,
 *  and counting it a failure would raise a false erasure alarm on every retry).
 *  `kept` = ours, but a SURVIVING row still references it, so deliberately not deleted.
 *  `foreign` = not our storage at all (a Google avatar, a merchant CDN) — nothing of ours to erase.
 *  `failed` = removal UNCONFIRMED, i.e. residue — including `unparsed`: a first-party URL in a
 *  spelling the canonical parser refuses. ⛔ That one is NOT `kept`: booking it as success would
 *  let a parser tightening turn into invisible un-erasure (2026-09-05 review of this change). */
export type PurgeResult = { deleted: number; kept: number; foreign: number; failed: number; residue: string[] }

export async function purgeStorageObjects(urls: string[]): Promise<PurgeResult> {
  const queue = [...new Set(urls)]
  const gone = (status: number) => (status >= 200 && status < 300) || status === 404 || status === 410

  const SECRET_KEY = secretKey()
  if (!STORAGE_HOST || !SECRET_KEY) {
    // Misconfiguration erases NOTHING, so every first-party object is a failure — and the log
    // keeps the SAME contract as the normal path: nothing here passed a reference check, so a
    // parsed object is `unreached` (never `delete-failed`, which an operator may retry by hand)
    // and an alias is `unparsed`. Foreign URLs are foreign. With the host itself unset nothing
    // can even be classified, so all of it is failed and the residue is honestly empty.
    let foreign = 0
    const residue: string[] = []
    for (const url of queue) {
      if (STORAGE_HOST && !isFirstPartyStorageUrl(url)) { foreign++; continue }
      const ref = storageRefOf(url)
      if (ref && residue.length < RESIDUE_MAX) residue.push(`${listingObjectKey(url) ? 'unreached' : 'unparsed'}:${ref}`)
    }
    return { deleted: 0, kept: 0, foreign, failed: queue.length - foreign, residue }
  }

  const deadline = Date.now() + PURGE_BUDGET_MS
  const outcome: Array<Outcome | null> = new Array(queue.length).fill(null)
  let cursor = 0

  const deleteOnce = async (bucket: string, key: string): Promise<number> =>
    withTimeout(
      fetch(`${STORAGE_HOST}/storage/v1/object/${bucket}/${key}`, {
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
      // ⛔ CANONICAL SPELLINGS ONLY. `listingObjectKey` is the one parser (shared with ingestion):
      // an alias — query, fragment, dot-segment, percent-escape — is NEVER deleted, because the
      // reference check compares by URL and an alias could pass it while its PATH named somebody
      // else's object. Ingestion refuses aliases now; this is the backstop for old rows — and a
      // first-party URL the parser refuses is booked as FAILED with its tail, not as success,
      // so an unfinished erasure is always visible in the log. A URL that is not ours at all
      // (`foreign`) has nothing to delete.
      const parsed = listingObjectKey(url)
      if (!parsed) {
        outcome[i] = isFirstPartyStorageUrl(url) ? { r: 'failed', ref: storageRefOf(url), why: 'unparsed' } : { r: 'foreign' }
        continue
      }
      const { bucket, key, url: canonicalUrl } = parsed
      // The reference check and the DELETE both use the parser's canonical spelling — ONE host
      // constant, so a trailing slash in the env cannot make them disagree.
      // Never delete an object another (surviving) user still references. An UNKNOWN answer must
      // not delete: cross-tenant destruction is far worse than an orphan.
      const ref = await withTimeout(
        isStillReferenced(canonicalUrl).then((r): 'yes' | 'no' => (r ? 'yes' : 'no')),
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
  let foreign = 0
  let failed = 0
  const residue: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const o = outcome[i]
    if (o?.r === 'deleted') { deleted++; continue }
    if (o?.r === 'kept') { kept++; continue }
    if (o?.r === 'foreign') { foreign++; continue }
    // No slot, or an explicit failure: either way the object's removal is UNCONFIRMED.
    failed++
    const ref = o?.r === 'failed' ? o.ref : storageRefOf(queue[i])
    const why = o?.r === 'failed' ? o.why : 'unreached'
    if (ref && residue.length < RESIDUE_MAX) residue.push(`${why}:${ref}`)
  }
  return { deleted, kept, foreign, failed, residue }
}
