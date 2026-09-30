/**
 * The post wizard's DRAFT PHOTOS, kept in IndexedDB so a full-page navigation does not throw them
 * away. The text half of the draft lives in localStorage ('eno-listing-draft'), but a File cannot be
 * serialised into localStorage — and the Google sign-in that Publish opens for a guest is a
 * full-page redirect (/auth/google/start or signInWithOAuth), so before this every guest who chose
 * Google came back to "Draft restored — re-add your photos". A reload or a crash did the same.
 *
 * Native IndexedDB, no dependency: one database, one object store, one key.
 *
 * ⚠️ THE PHOTOS ARE TIED TO ONE TEXT DRAFT BY ID, NOT BY THEIR OWN CLOCK. The text draft's savedAt
 * is the one TTL clock (post-wizard.tsx, DRAFT_TTL_MS), and it is refreshed on every keystroke —
 * while photos come FIRST in the form and are often not touched again. Timing the photos on their
 * own savedAt would have dropped them for exactly the careful seller this exists for: add photos,
 * write for twenty minutes, press Publish, sign in with Google, come back to a restored description
 * and no photos. So a photo set is saved under the draft's id and restored only beside the text
 * draft carrying that same id; the text draft's TTL decides for both.
 *
 * ⚠️ ONE ABSOLUTE BACKSTOP ON TOP: PHOTO_TTL_MS (24h) on the set's own savedAt. The text draft's TTL
 * only runs when someone opens /post again; a guest on a shared device who never comes back left
 * the photos in IndexedDB forever. 24h is ~100x the text draft's sliding window, so it never cuts the
 * careful seller above — it only bounds what a walked-away device keeps.
 *
 * ⛔ A CLEAR MUST WIN OVER A SAVE ALREADY IN FLIGHT. Publish, sign-out and a fresh draft all clear;
 * a save that had already started (or a debounced one scheduled before the clear) used to land
 * AFTER the delete and resurrect the photos. So every clear bumps a module-level epoch and awaits
 * the saves in flight before it deletes, and a save refuses to write once the epoch it was started
 * (or scheduled — see draftPhotosEpoch) under is gone.
 *
 * ⛔ FAILS SOFT, ALWAYS. Every function resolves — never rejects, never throws — and resolves to
 * "nothing" when IndexedDB is missing (old WebViews, some in-app browsers), refused (private
 * windows), blocked, or out of quota. A photo draft is a convenience; losing it must never break
 * the form it serves.
 */

const DB_NAME = 'eno-post-draft'
const STORE = 'kv'
const KEY = 'photos'

/** What the wizard hands over: its photo entries, reduced to what survives structured clone. */
export type DraftPhotoIn = { file: File; original?: File; square?: boolean }

type Stored = {
  draftId: string
  savedAt: number
  photos: { file: Blob; name: string; type: string; original?: Blob; originalName?: string; square?: boolean }[]
}

/**
 * ⚠️ AN OPEN THAT NEVER SETTLES IS A FAILURE TOO. Some WebViews (the iOS WKWebView bug class) hand
 * back an open request whose onsuccess/onerror/onblocked never fire. Without a deadline the wizard's
 * restore awaited it forever, never marked the photos hydrated, and autosave never started. After
 * OPEN_TIMEOUT_MS we resolve "unavailable"; a connection that arrives later is closed, not leaked.
 */
export const OPEN_TIMEOUT_MS = 3000

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (db: IDBDatabase | null) => {
      if (settled) { try { db?.close() } catch { /* already closed */ } return }
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(db)
    }
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { finish(null); return }
      const req = indexedDB.open(DB_NAME, 1)
      timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS)
      req.onupgradeneeded = () => {
        try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) } catch { /* resolves via onerror */ }
      }
      req.onsuccess = () => finish(req.result)
      req.onerror = () => finish(null)
      req.onblocked = () => finish(null)
    } catch {
      finish(null)
    }
  })
}

/** One transaction against the store. Resolves with the request's result, or undefined on ANY failure. */
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) { resolve(undefined); return }
    const done = (value: T | undefined) => { try { db.close() } catch { /* already closed */ } resolve(value) }
    try {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      let value: T | undefined
      req.onsuccess = () => { value = req.result }
      tx.oncomplete = () => done(value)
      // A failed request aborts its transaction (QuotaExceededError lands here), so onabort is the
      // one exit every failure reaches; onerror is belt and braces.
      tx.onabort = () => done(undefined)
      tx.onerror = () => done(undefined)
    } catch {
      // Synchronous throws: DataCloneError from put() on an engine that cannot store Blobs,
      // InvalidStateError from a connection closing underneath us.
      done(undefined)
    }
  }))
}

/** A saved set older than this is discarded (and deleted) on load, whatever the text draft says. */
export const PHOTO_TTL_MS = 24 * 60 * 60_000

/** Bumped by every clear. A save carries the epoch it belongs to and never writes under a newer one. */
let epoch = 0
const inFlight = new Set<Promise<unknown>>()

/**
 * The current clear-epoch. A caller that DEFERS a save (the wizard's debounce) reads it when it
 * schedules and passes it to saveDraftPhotos, so a clear that lands in between voids the save.
 */
export function draftPhotosEpoch(): number {
  return epoch
}

/**
 * Replace the saved photo set for draft `draftId`. An empty list clears it. `since` is the epoch the
 * save belongs to (default: now); if a clear has happened since, nothing is written.
 */
export function saveDraftPhotos(draftId: string, photos: DraftPhotoIn[], since: number = epoch): Promise<void> {
  if (since !== epoch) return Promise.resolve()
  if (!photos.length) return clearDraftPhotos()
  const value: Stored = {
    draftId,
    savedAt: Date.now(),
    photos: photos.map((p) => ({
      file: p.file,
      name: p.file.name,
      type: p.file.type,
      original: p.original,
      originalName: p.original?.name,
      square: p.square,
    })),
  }
  // The epoch is re-checked once the database is open: a clear during the open skips the write
  // (withStore's catch turns the throw into a soft no-op). A clear after the put has started waits
  // for this promise, then deletes.
  const write = withStore('readwrite', (s) => {
    if (since !== epoch) throw new Error('cleared')
    return s.put(value, KEY)
  }).then(() => undefined)
  inFlight.add(write)
  void write.finally(() => inFlight.delete(write))
  return write
}

/**
 * The photos saved for draft `draftId`, rebuilt as Files — or null when there are none, they belong
 * to another draft, they are older than PHOTO_TTL_MS, or anything about the read fails. A set for
 * another draft or past its TTL is deleted on the way out: it can never be restored.
 */
export async function loadDraftPhotos(draftId: string): Promise<DraftPhotoIn[] | null> {
  const stored = await withStore<Stored | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<Stored | undefined>)
  if (!stored) return null
  const age = Date.now() - (typeof stored.savedAt === 'number' ? stored.savedAt : 0)
  if (stored.draftId !== draftId || !Array.isArray(stored.photos) || !(age >= 0 && age < PHOTO_TTL_MS)) {
    await clearDraftPhotos()
    return null
  }
  const out: DraftPhotoIn[] = []
  for (const p of stored.photos) {
    if (!(p?.file instanceof Blob)) continue
    out.push({
      file: new File([p.file], p.name || 'photo.jpg', { type: p.type || p.file.type }),
      original: p.original instanceof Blob ? new File([p.original], p.originalName || p.name || 'photo.jpg', { type: p.original.type || p.type }) : undefined,
      square: p.square,
    })
  }
  return out.length ? out : null
}

export function clearDraftPhotos(): Promise<void> {
  epoch++
  // Every save started under an older epoch settles first (it resolves, never rejects), so this
  // delete is the last write.
  return Promise.all([...inFlight])
    .then(() => withStore('readwrite', (s) => s.delete(KEY)))
    .then(() => undefined)
}
