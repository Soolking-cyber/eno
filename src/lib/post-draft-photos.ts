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
 * ⛔ BYTES, NOT BLOBS (2026-10-04). WebKit's ephemeral IndexedDB — Safari Private Browsing, and every
 * in-app browser that runs on a non-persistent data store — refuses to store a Blob (put() throws
 * DataCloneError / "BlobURLs are not yet supported"), so every private-tab seller lost their photos
 * on the Google round trip while the text came back. ArrayBuffers clone everywhere, so each photo is
 * stored as `{ buf, name, type }` and rebuilt with `new File([buf], name, { type })`. A set saved as
 * Blobs by an older build still loads (the `file` field) until its TTL runs out.
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

type StoredPhoto = {
  /** The photo's bytes (current builds). */
  buf?: ArrayBuffer
  /** LEGACY: a set saved before 2026-10-04 holds a Blob here instead. Read, never written. */
  file?: Blob
  name: string
  type: string
  original?: ArrayBuffer | Blob
  originalName?: string
  originalType?: string
  square?: boolean
}

type Stored = {
  draftId: string
  savedAt: number
  photos: StoredPhoto[]
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

/**
 * The bytes already read, per File. ⛔ READ EACH PHOTO ONCE, NOT ON EVERY SAVE: the save is debounced
 * after every crop, reorder or add and stores the whole set, so re-reading six phone originals (~12MB
 * each) each time put ~150MB of fresh buffers on a low-end Android per tap. A crop makes a NEW File, so
 * only the file that changed is read again. The PROMISE is cached, so two overlapping saves share one
 * read; a read that fails is forgotten, so the next save can try again. A WeakMap: a photo the seller
 * removed takes its bytes with it. The buffer is only ever structured-CLONED by put(), never
 * transferred, so one cached copy serves every save.
 */
const bytesCache = new WeakMap<Blob, Promise<ArrayBuffer>>()

/**
 * A Blob's bytes, read at most once (bytesCache). `Blob.arrayBuffer()` only arrived in Safari 14 —
 * older WebKit (in-app browsers on an old iOS) lacks it, and calling it there threw, so the save fell
 * into its catch and kept nothing. A Response reads any Blob on every engine that has fetch.
 */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  const cached = bytesCache.get(blob)
  if (cached) return cached
  const read = typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : new Response(blob).arrayBuffer()
  bytesCache.set(blob, read)
  read.catch(() => { if (bytesCache.get(blob) === read) bytesCache.delete(blob) })
  return read
}

/** A saved set older than this is discarded (and deleted) on load, whatever the text draft says. */
export const PHOTO_TTL_MS = 24 * 60 * 60_000

/** Bumped by every clear. A save carries the epoch it belongs to and never writes under a newer one. */
let epoch = 0
const inFlight = new Set<Promise<unknown>>()
/**
 * ⛔ THE LATEST SAVE WINS, NOT THE LAST ONE TO FINISH. A save reads every photo's bytes BEFORE it
 * opens its transaction, so two overlapping saves (a crop, then a reorder) race: the older one, slower
 * to read, could commit after the newer and put stale photos back. The epoch above cannot see that —
 * both saves share it; it only fences off a CLEAR. Each save takes the next number when it is called,
 * and writes only while it is still the newest (checked after the reads and again inside the
 * transaction, just before the put).
 */
let saveSeq = 0

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
  const seq = ++saveSeq
  const current = () => since === epoch && seq === saveSeq
  // The epoch AND the sequence are re-checked after the bytes are read and again once the database is
  // open: a clear — or a newer save — during either skips the write (withStore's catch turns the throw
  // into a soft no-op). A clear after the put has started waits for this promise, then deletes.
  const write = (async () => {
    let stored: StoredPhoto[]
    try {
      stored = await Promise.all(photos.map(async (p) => ({
        buf: await bytesOf(p.file),
        name: p.file.name,
        type: p.file.type,
        original: p.original ? await bytesOf(p.original) : undefined,
        originalName: p.original?.name,
        originalType: p.original?.type,
        square: p.square,
      })))
    } catch {
      return // an unreadable File (revoked, evicted) — nothing to keep, and never a rejection
    }
    if (!current()) return
    const value: Stored = { draftId, savedAt: Date.now(), photos: stored }
    await withStore('readwrite', (s) => {
      if (!current()) throw new Error('cleared or superseded')
      return s.put(value, KEY)
    })
  })()
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
  try {
    for (const p of stored.photos) {
      // Bytes (current) or a Blob (a set an older build saved); anything else is skipped.
      const main = p?.buf instanceof ArrayBuffer ? p.buf : p?.file instanceof Blob ? p.file : null
      if (!main) continue
      const orig = p.original instanceof ArrayBuffer || p.original instanceof Blob ? p.original : null
      out.push({
        file: new File([main], p.name || 'photo.jpg', { type: p.type || (main instanceof Blob ? main.type : '') }),
        original: orig ? new File([orig], p.originalName || p.name || 'photo.jpg', { type: p.originalType || (orig instanceof Blob ? orig.type : '') || p.type }) : undefined,
        square: p.square,
      })
    }
  } catch {
    return null // a File constructor missing or refusing (very old WebViews) — fail soft
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
