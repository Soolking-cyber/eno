import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPEN_TIMEOUT_MS, PHOTO_TTL_MS, clearDraftPhotos, draftPhotosEpoch, loadDraftPhotos, saveDraftPhotos } from './post-draft-photos'

/**
 * The photo draft is a convenience: it must NEVER reject or throw, whatever IndexedDB does, and it
 * must only ever hand photos back to the text draft they were saved for. A tiny in-memory stand-in
 * for the one database / one store / one key this file uses — enough to exercise both paths without
 * a new dependency.
 */

type Req = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; onupgradeneeded?: () => void }

function fakeIndexedDB(opts: { failPut?: boolean; putDelayMs?: number } = {}) {
  const store = new Map<string, unknown>()
  let created = false
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true },
    close: () => {},
    transaction: () => {
      const tx: { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          get: (k: string) => run(tx, () => store.get(k)),
          put: (v: unknown, k: string) => run(tx, () => { if (opts.failPut) throw new Error('QuotaExceededError'); store.set(k, v) }, opts.putDelayMs),
          delete: (k: string) => run(tx, () => { store.delete(k) }),
        }),
      }
      return tx
    },
  }
  // A request settles, then its transaction completes — or, when the operation fails, aborts.
  function run(tx: { oncomplete?: () => void; onabort?: () => void }, op: () => unknown, delayMs = 0) {
    const req: Req = {}
    setTimeout(() => {
      try {
        req.result = op()
        req.onsuccess?.()
        tx.oncomplete?.()
      } catch {
        req.onerror?.()
        tx.onabort?.()
      }
    }, delayMs)
    return req
  }
  return {
    store,
    open: () => {
      const req: Req = {}
      setTimeout(() => {
        req.result = db
        if (!created) req.onupgradeneeded?.()
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
}

const photo = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

afterEach(() => { vi.unstubAllGlobals() })

describe('post-draft-photos — fails soft', () => {
  it('resolves to nothing when IndexedDB does not exist', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(saveDraftPhotos('d1', [{ file: photo('a.jpg') }])).resolves.toBeUndefined()
    await expect(loadDraftPhotos('d1')).resolves.toBeNull()
    await expect(clearDraftPhotos()).resolves.toBeUndefined()
  })

  it('resolves when opening throws (a storage-blocked browser)', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('SecurityError') } })
    await expect(loadDraftPhotos('d1')).resolves.toBeNull()
    await expect(saveDraftPhotos('d1', [{ file: photo('a.jpg') }])).resolves.toBeUndefined()
  })

  it('resolves when opening errors or is blocked (private windows)', async () => {
    for (const fail of ['onerror', 'onblocked'] as const) {
      vi.stubGlobal('indexedDB', { open: () => { const req: Req = {}; setTimeout(() => req[fail]?.(), 0); return req } })
      await expect(loadDraftPhotos('d1')).resolves.toBeNull()
    }
  })

  it('resolves as unavailable when the open NEVER settles (iOS WebView), and closes a late connection', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn()
      let req: Req = {}
      vi.stubGlobal('indexedDB', { open: () => { req = {}; return req } })
      const load = loadDraftPhotos('d1')
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS)
      await expect(load).resolves.toBeNull()
      // The open finally succeeds after we gave up: the connection is closed, nothing else happens.
      req.result = { close }
      req.onsuccess?.()
      expect(close).toHaveBeenCalledTimes(1)
      const save = saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS)
      await expect(save).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves when the write is refused (quota)', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB({ failPut: true }))
    await expect(saveDraftPhotos('d1', [{ file: photo('a.jpg') }])).resolves.toBeUndefined()
    await expect(loadDraftPhotos('d1')).resolves.toBeNull()
  })
})

describe('post-draft-photos — one draft, one photo set', () => {
  it('round-trips the photos as Files, in order, with their crop state', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB())
    await saveDraftPhotos('d1', [{ file: photo('a.jpg'), original: photo('a-full.jpg'), square: true }, { file: photo('b.jpg'), square: false }])
    const back = await loadDraftPhotos('d1')
    expect(back?.map((p) => p.file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(back?.[0].file).toBeInstanceOf(File)
    expect(back?.[0].file.type).toBe('image/jpeg')
    expect(back?.[0].original?.name).toBe('a-full.jpg')
    expect(back?.map((p) => p.square)).toEqual([true, false])
  })

  it('never hands back photos saved for ANOTHER draft — and deletes them', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    await saveDraftPhotos('old-draft', [{ file: photo('a.jpg') }])
    await expect(loadDraftPhotos('new-draft')).resolves.toBeNull()
    expect(idb.store.has('photos')).toBe(false)
  })

  it('an empty set clears, and clear removes the entry', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    await saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
    await saveDraftPhotos('d1', [])
    expect(idb.store.has('photos')).toBe(false)
    await saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
    await clearDraftPhotos()
    await expect(loadDraftPhotos('d1')).resolves.toBeNull()
  })
})

describe('post-draft-photos — a clear always wins', () => {
  // A slow put (a big Blob set) is what let the save land after the clear's delete.
  it('a save still OPENING when the clear comes never writes', async () => {
    const idb = fakeIndexedDB({ putDelayMs: 20 })
    vi.stubGlobal('indexedDB', idb)
    const save = saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
    await clearDraftPhotos()
    await save
    expect(idb.store.has('photos')).toBe(false)
  })

  it('a save already WRITING when the clear comes is deleted after it lands', async () => {
    const idb = fakeIndexedDB({ putDelayMs: 20 })
    vi.stubGlobal('indexedDB', idb)
    const save = saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
    await new Promise((r) => setTimeout(r, 5)) // open done, put issued and pending
    await clearDraftPhotos()
    await save
    expect(idb.store.has('photos')).toBe(false)
    await expect(loadDraftPhotos('d1')).resolves.toBeNull()
  })

  it('a deferred save scheduled before the clear (the wizard debounce) is void', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    const since = draftPhotosEpoch()
    await clearDraftPhotos()
    await saveDraftPhotos('d1', [{ file: photo('a.jpg') }], since)
    expect(idb.store.has('photos')).toBe(false)
    // …while a save started after the clear is new work and is kept.
    await saveDraftPhotos('d1', [{ file: photo('b.jpg') }])
    expect((await loadDraftPhotos('d1'))?.map((p) => p.file.name)).toEqual(['b.jpg'])
  })
})

describe('post-draft-photos — absolute TTL', () => {
  it('discards and deletes a set older than PHOTO_TTL_MS, keeps a younger one', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(t0)
      await saveDraftPhotos('d1', [{ file: photo('a.jpg') }])
      now.mockReturnValue(t0 + PHOTO_TTL_MS - 1000)
      await expect(loadDraftPhotos('d1')).resolves.toHaveLength(1)
      now.mockReturnValue(t0 + PHOTO_TTL_MS + 1)
      await expect(loadDraftPhotos('d1')).resolves.toBeNull()
      expect(idb.store.has('photos')).toBe(false)
    } finally {
      now.mockRestore()
    }
  })
})
