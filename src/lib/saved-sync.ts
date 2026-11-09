import { SAVED_IDS_PER_WRITE, SAVED_LISTING_ID_RE, chunkListingIds } from '@/lib/listing-ids'
import { readCopy, readGuest, sessionUidFromCookie, updateGuest, withSavedLock, writeCopy } from '@/lib/saved-store'

/**
 * A SIGNED-IN PERSON'S SAVES, KEPT IN STEP WITH THE ACCOUNT (owner, 2026-11-09: "3 ok"). Loaded by FavoritesProvider only
 * once a session is in play — a guest never downloads this module.
 *
 * ⛔ ONE INVARIANT (review r4 — four rounds each found a new edge where the guest list and the account met in one view):
 * a signed-in tab shows THE ACCOUNT'S LIST (`snapshot`, from the server or its cache) with this tab's own taps still on
 * their way on top (`intents`), newest first. The device's guest list is shown only until the account's list is known
 * (no cache yet, or the read failed) — after that, a guest id the merge could not move (a full account) waits, unseen,
 * for the next sign-out, where it is the guest's again.
 *
 * ⛔ EVERY REQUEST AND EVERY WRITE OF A STORED LIST TAKES `withSavedLock` (saved-store.ts), and after every await the
 * account is checked again (`owner`, and the session cookie before the cache is written): a sign-out, or another account
 * signing in, between a tap and its answer must never write into the wrong account or recreate a cleared cache.
 * ⛔ NO OUTBOX. A tap that fails goes back (no toast; the heart is the only feedback, owner 2026-07-06); there is no queue
 * to replay, so nothing can be replayed out of order, against another account, or after a later tap. Three plan reviews
 * found each of those in the outbox designs (2026-11-09).
 * ⚠️ THE MERGE MOVES, IT DOES NOT COPY: each chunk of the guest list the server stored leaves the guest list, read from
 * storage inside the lock, so a save another tab added meanwhile stays. A tap in account mode also takes its id out of the
 * guest list (an unsave always, before it is sent: the person's word covers the device copy too), so a later merge can
 * never bring back an unsave. On a shared device a guest's saves therefore move into whoever signs in next — the
 * guest-cart rule, stated in the plan.
 */

type Intent = { saved: boolean; seq: number }

let owner: string | null = null
/** The account's list, newest first; null while not known (no cache, first answer pending). */
let snapshot: string[] | null = null
/** The view is the account's own (a cache, or an answer came back — even a failed one). */
let ready = false
/** False once the server says the table is not there: the provider goes back to device saves for this page. */
let available = true
/** The last read failed and nothing is known (no cache): /saved says so and offers a retry — taps still go to the account. */
let failed = false
const intents = new Map<string, Intent>()
let seq = 0
let syncSeq = 0
let lastSync = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of [...listeners]) l()
}

export type SavedView = { owner: string | null; ids: string[]; ready: boolean; available: boolean; failed: boolean }

/** Newest first: this tab's saves on their way, then the account's list — or, until that is known, the guest list. */
export function savedView(): SavedView {
  const pending = [...intents].sort((a, b) => b[1].seq - a[1].seq)
  const removed = new Set(pending.filter(([, i]) => !i.saved).map(([id]) => id))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...pending.filter(([, i]) => i.saved).map(([id]) => id), ...(snapshot ?? readGuest().reverse())]) {
    if (seen.has(id) || removed.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return { owner, ids: out, ready, available, failed }
}

export function subscribeSaved(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Is `uid` still the session this browser holds? (The cookie is shared by every tab, so a sign-out elsewhere shows here.) */
function stillSignedIn(uid: string): boolean {
  try { return sessionUidFromCookie(document.cookie, Date.now(), { anyExpiry: true }) === uid } catch { return false }
}

/** Enter account mode for `uid`, showing its cached list at once when there is one. */
export function startSaved(uid: string): void {
  if (owner === uid) return
  owner = uid
  intents.clear()
  available = true
  failed = false
  const c = readCopy()
  snapshot = c && c.u === uid ? c.ids : null
  ready = snapshot !== null
  emit()
}

/** Leave account mode (signed out, or another account): this tab forgets the account; the provider drops the cache. */
export function stopSaved(): void {
  owner = null
  snapshot = null
  ready = false
  intents.clear()
  syncSeq++
  emit()
}

/**
 * ⛔ EVERY REQUEST GIVES UP AFTER THIS LONG (commit review, 2026-11-09): it runs inside the browser-wide lock, so one that
 * stalled on a bad network would hold every tab's saves — guest writes included — until the page closed.
 */
const REQUEST_TIMEOUT_MS = 10_000
function withTimeout(): { signal?: AbortSignal; done: () => void } {
  if (typeof AbortController === 'undefined') return { done: () => {} }
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

type Ids = string[] | 'unavailable' | null
/** The account's list — null on any failure, and on an answer about ANOTHER account (the shared cookie changed mid-flight). */
async function getIds(uid: string): Promise<Ids> {
  const t = withTimeout()
  try {
    const r = await fetch('/api/saved-listings', { cache: 'no-store', credentials: 'same-origin', signal: t.signal })
    if (!r.ok) return null
    const d = (await r.json()) as { uid?: unknown; ids?: unknown; available?: unknown }
    if (d?.uid !== uid) return null
    if (d?.available === false) return 'unavailable'
    return Array.isArray(d?.ids) ? d.ids.filter((x): x is string => typeof x === 'string') : null
  } catch { return null } finally { t.done() }
}

/** `notStored`: added ids the server did not keep (not shown in this edition) — a tap puts its heart back. */
type Write = { ok: true; notStored: string[] } | 'limit' | 'fail'
async function postSaved(uid: string, body: { add?: string[]; remove?: string[] }): Promise<Write> {
  const t = withTimeout()
  try {
    const r = await fetch('/api/saved-listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, ...body }),
      credentials: 'same-origin',
      // A tap right before leaving the page still lands (a merge chunk is ~6 KB, under keepalive's 64 KB).
      keepalive: true,
      signal: t.signal,
    })
    if (r.ok) {
      const d = (await r.json().catch(() => null)) as { notStored?: unknown } | null
      return { ok: true, notStored: Array.isArray(d?.notStored) ? d.notStored.filter((x): x is string => typeof x === 'string') : [] }
    }
    if (r.status === 409) {
      const d = (await r.json().catch(() => null)) as { error?: unknown } | null
      if (d?.error === 'limit_reached') return 'limit'
    }
    return 'fail'
  } catch { return 'fail' } finally { t.done() }
}

/**
 * Bring this tab in line with the account: read it, move the guest list in, read it again if anything moved, cache it.
 * A newer sync supersedes an older one still queued; a failed read keeps what is shown.
 */
export function syncSaved(uid: string): Promise<void> {
  if (owner !== uid) return Promise.resolve()
  const my = ++syncSeq
  lastSync = Date.now()
  return withSavedLock(async () => {
    const current = () => owner === uid && my === syncSeq
    if (!current()) return
    const first = await getIds(uid)
    if (!current()) return
    // No table (a database without scripts/saved-listings-ddl.mjs): device saves for this page, as before accounts held
    // them — nothing is on the server to unsave, so nothing is lost.
    if (first === 'unavailable') { available = false; ready = true; emit(); return }
    // ⚠️ A FAILED READ IS NOT "NO TABLE" (commit review, 2026-11-09): the page stays on the account — taps still reach it,
    // so an unsave is never left behind on the device only — and with nothing cached /saved says the list could not
    // load and offers a retry, never "No saved listings". With a cache, the cache stays on screen.
    if (first === null) { if (snapshot === null) failed = true; ready = true; emit(); return }
    failed = false
    let list = first
    const movedIn: string[] = []
    // An id the API would refuse (it checks every one) would fail its whole chunk on every sync, for good: it is no
    // listing id, so it leaves the guest list here (review r3).
    const guest = readGuest()
    if (guest.some((id) => !SAVED_LISTING_ID_RE.test(id))) updateGuest((g) => g.filter((id) => SAVED_LISTING_ID_RE.test(id)))
    for (const chunk of chunkListingIds(guest.filter((id) => SAVED_LISTING_ID_RE.test(id)), SAVED_IDS_PER_WRITE)) {
      const w = await postSaved(uid, { add: chunk })
      if (owner !== uid) return
      if (w === 'limit' || w === 'fail') break
      // Every id sent leaves the guest list: stored ones are on the account now, and one the server did not keep is one this
      // edition does not show — the device's own self-heal would delete it the same way.
      const sent = new Set(chunk)
      updateGuest((g) => g.filter((id) => !sent.has(id)))
      const kept = new Set(w.notStored)
      movedIn.push(...chunk.filter((id) => !kept.has(id)))
    }
    if (movedIn.length) {
      const again = await getIds(uid)
      if (!current()) return
      // The re-read failed: what moved in is on the account, so it stays in view (newest first) rather than vanish until
      // the next sync (commit review).
      list = Array.isArray(again) ? again : [...new Set([...[...movedIn].reverse(), ...first])]
    }
    snapshot = list
    ready = true
    if (stillSignedIn(uid)) writeCopy({ u: uid, ids: list })
    emit()
  })
}

/** Re-read the account when the tab comes back, at most once a minute. */
export function syncSavedIfStale(): void {
  if (owner && Date.now() - lastSync >= 60_000) void syncSaved(owner)
}

/**
 * Save or unsave, in account mode: the heart moves now, the server is told under the lock, a failure puts it back.
 * `done(true)` once the account holds the tap, `done(false)` when it went back — the provider moves the public saved count
 * only on `true` (commit review: a refused save must not leave the listing's count one too high).
 */
export function toggleSaved(id: string, saved: boolean, done?: (ok: boolean) => void): void {
  const uid = owner
  if (!uid) { done?.(false); return }
  const s = ++seq
  intents.set(id, { saved, seq: s })
  emit()
  const settle = (ok: boolean) => {
    if (intents.get(id)?.seq === s) intents.delete(id)
    emit()
    done?.(ok)
  }
  void withSavedLock(async () => {
    if (owner !== uid) return settle(false)
    // An UNSAVE takes the device copy out FIRST, whatever the answer: it is the person's word for that listing, and a
    // later merge (the recovery read after a lost answer included) must never send it back up (review r4).
    if (!saved) updateGuest((g) => g.filter((x) => x !== id))
    const w = await postSaved(uid, saved ? { add: [id] } : { remove: [id] })
    if (owner !== uid) return settle(false)
    // A save the server did not keep (a listing this edition does not show) goes back like a failure.
    const ok = typeof w === 'object' && !(saved && w.notStored.includes(id))
    if (ok) {
      // A save on the account needs no device copy: a later merge would only send it twice.
      if (saved) updateGuest((g) => g.filter((x) => x !== id))
      const apply = (list: string[]) => (saved ? [id, ...list.filter((x) => x !== id)] : list.filter((x) => x !== id))
      // Not known yet (no cache, the first read pending): this much is known, and that read will replace it whole.
      snapshot = apply(snapshot ?? [])
      if (stillSignedIn(uid)) {
        const c = readCopy()
        if (c?.u === uid) writeCopy({ u: uid, ids: apply(c.ids) })
      }
    }
    settle(ok)
    // ⚠️ A FAILED WRITE MAY STILL HAVE LANDED (a timeout or a lost answer after the server committed): read the account
    // again rather than leave the heart showing the opposite of what it holds (review r3). Queued behind this lock.
    if (w === 'fail' && owner === uid) void syncSaved(uid)
  })
}

/**
 * Ids the cards read named gone (removed, hidden here): out of the local account list (the account read hides them
 * already — no server delete) and out of the guest list not yet moved in, as the device's own self-heal does (review r3:
 * a gone guest id kept counting in an account view the cap had stopped the merge of).
 */
export function dropGoneSaved(gone: readonly string[]): void {
  const uid = owner
  if (!uid || !gone.length) return
  const g = new Set(gone)
  if (snapshot?.some((x) => g.has(x))) snapshot = snapshot.filter((x) => !g.has(x))
  void withSavedLock(() => {
    updateGuest((list) => list.filter((x) => !g.has(x)))
    if (owner === uid && stillSignedIn(uid)) {
      const c = readCopy()
      if (c?.u === uid) writeCopy({ u: uid, ids: c.ids.filter((x) => !g.has(x)) })
    }
    emit()
  })
  emit()
}

/** Another tab changed the cache (or the guest list): show it — no request, so tabs never set each other off. */
export function adoptStoredSaved(): void {
  if (!owner) return
  const c = readCopy()
  if (c?.u === owner) { snapshot = c.ids; ready = true }
  emit()
}

/** Test seam: forget everything, as a fresh page does. */
export function resetSavedForTest(): void {
  owner = null
  snapshot = null
  ready = false
  available = true
  failed = false
  intents.clear()
  seq = 0
  syncSeq = 0
  lastSync = 0
  listeners.clear()
}
