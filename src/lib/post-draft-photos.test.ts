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

  it('stores BYTES, never a Blob — WebKit private mode cannot clone a Blob into IndexedDB', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    await saveDraftPhotos('d1', [{ file: photo('a.jpg'), original: photo('a-full.jpg') }])
    const saved = idb.store.get('photos') as { photos: Record<string, unknown>[] }
    expect(saved.photos[0].buf).toBeInstanceOf(ArrayBuffer)
    expect(saved.photos[0].original).toBeInstanceOf(ArrayBuffer)
    for (const v of Object.values(saved.photos[0])) expect(v).not.toBeInstanceOf(Blob)
    expect(saved.photos[0]).toMatchObject({ name: 'a.jpg', type: 'image/jpeg', originalName: 'a-full.jpg', originalType: 'image/jpeg' })
    const back = await loadDraftPhotos('d1')
    expect(back?.[0].file.size).toBe(3)
    expect(back?.[0].original?.type).toBe('image/jpeg')
  })

  it('⛔ two OVERLAPPING saves: the newer one wins even when the older one finishes reading last', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    // The older save's photo is slow to read (a big original, a busy phone)…
    const slow = photo('older.jpg')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((r) => setTimeout(() => r(new Uint8Array([9]).buffer), 40)) })
    const older = saveDraftPhotos('d1', [{ file: slow }])
    // …and the newer save, called after it, reads fast and commits first.
    const newer = saveDraftPhotos('d1', [{ file: photo('newer.jpg') }, { file: photo('second.jpg') }])
    await Promise.all([older, newer])
    expect((await loadDraftPhotos('d1'))?.map((p) => p.file.name)).toEqual(['newer.jpg', 'second.jpg'])
  })

  it('…and a newer save that starts while an older one is already inside its transaction still lands last', async () => {
    const idb = fakeIndexedDB({ putDelayMs: 30 })
    vi.stubGlobal('indexedDB', idb)
    const first = saveDraftPhotos('d1', [{ file: photo('first.jpg') }])
    await new Promise((r) => setTimeout(r, 10)) // the first save's put is now in flight
    const second = saveDraftPhotos('d1', [{ file: photo('second.jpg') }])
    await Promise.all([first, second])
    expect((await loadDraftPhotos('d1'))?.map((p) => p.file.name)).toEqual(['second.jpg'])
  })

  it('⛔ reads each photo ONCE: a second save with the same files re-reads nothing, a changed file only itself', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    const a = photo('a.jpg')
    const aFull = photo('a-full.jpg')
    const b = photo('b.jpg')
    const reads = [vi.spyOn(a, 'arrayBuffer'), vi.spyOn(aFull, 'arrayBuffer'), vi.spyOn(b, 'arrayBuffer')]
    await saveDraftPhotos('d1', [{ file: a, original: aFull }, { file: b }])
    await saveDraftPhotos('d1', [{ file: b }, { file: a, original: aFull }]) // a reorder: same Files
    expect(reads.map((r) => r.mock.calls.length)).toEqual([1, 1, 1])
    // A crop makes a NEW File: only that one is read again.
    const cropped = photo('a-cropped.jpg')
    const croppedRead = vi.spyOn(cropped, 'arrayBuffer')
    await saveDraftPhotos('d1', [{ file: cropped, original: aFull }, { file: b }])
    expect(croppedRead).toHaveBeenCalledTimes(1)
    expect(reads.map((r) => r.mock.calls.length)).toEqual([1, 1, 1])
    // …and what is stored is still the Private-Safari-safe bytes, in the newest order.
    const saved = idb.store.get('photos') as { photos: { buf: ArrayBuffer; name: string }[] }
    expect(saved.photos.map((p) => p.name)).toEqual(['a-cropped.jpg', 'b.jpg'])
    expect(saved.photos[0].buf).toBeInstanceOf(ArrayBuffer)
  })

  it('a read that FAILS is not cached — the next save reads the file again', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    const flaky = photo('flaky.jpg')
    let attempts = 0
    const real = flaky.arrayBuffer.bind(flaky)
    Object.defineProperty(flaky, 'arrayBuffer', { value: () => (++attempts === 1 ? Promise.reject(new Error('NotReadableError')) : real()) })
    await saveDraftPhotos('d1', [{ file: flaky }])
    expect(idb.store.get('photos')).toBeUndefined()
    await saveDraftPhotos('d1', [{ file: flaky }])
    expect(attempts).toBe(2)
    expect((idb.store.get('photos') as { photos: unknown[] }).photos).toHaveLength(1)
  })

  it('reads the bytes without Blob.arrayBuffer() (Safari < 14) — through a Response', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    const old = photo('old-webkit.jpg')
    // An engine that predates Blob.arrayBuffer(): the own property shadows the prototype method.
    Object.defineProperty(old, 'arrayBuffer', { value: undefined })
    await saveDraftPhotos('d1', [{ file: old }])
    const saved = idb.store.get('photos') as { photos: { buf: ArrayBuffer }[] }
    expect(saved.photos[0].buf).toBeInstanceOf(ArrayBuffer)
    expect(saved.photos[0].buf.byteLength).toBe(3)
    expect((await loadDraftPhotos('d1'))?.[0].file.name).toBe('old-webkit.jpg')
  })

  it('still restores a set an older build saved as Blobs', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
    idb.store.set('photos', { draftId: 'd1', savedAt: Date.now(), photos: [{ file: photo('old.jpg'), name: 'old.jpg', type: 'image/jpeg' }] })
    const back = await loadDraftPhotos('d1')
    expect(back?.map((p) => p.file.name)).toEqual(['old.jpg'])
    expect(back?.[0].file).toBeInstanceOf(File)
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
