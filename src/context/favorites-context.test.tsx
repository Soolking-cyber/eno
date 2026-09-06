// @vitest-environment jsdom
/**
 * ⛔ SAVED LISTINGS WERE BEING DELETED FROM THE DEVICE BY A SUCCESSFUL RESPONSE.
 *
 * `FavoritesContext` hydrates /saved from `GET /api/listings?ids=`, and self-heals: an id it asked
 * about that does not come back is treated as a listing that no longer exists and is dropped from
 * the device's saved set. That is right for a deleted listing and catastrophic for anything else —
 * and the endpoint used to answer only the first 200 ids of any list, with a 200 OK and no hint
 * that it had stopped. A device with 201 saved listings therefore lost the 201st on its next visit
 * to /saved. Permanently: the pruning writes localStorage.
 *
 * ⚠️ THE FIX IS A CONTRACT, NOT A BIGGER NUMBER — the response reports `evaluated`, the ids it
 * actually looked up, and the client prunes strictly inside that set. So the tests below are
 * mostly about what must NOT be pruned: ids past the cap, ids in a chunk that failed, ids from a
 * server too old to report `evaluated`, and an id hearted while the request was in flight.
 *
 * ⚠️ NO NETWORK. `fetch` is stubbed per test; nothing here reaches an API.
 */
import React from 'react'
import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FavoritesProvider, useFavorites } from './favorites-context'
import { IDS_FAST_PATH_MAX } from '@/lib/listing-ids'

vi.mock('next/navigation', () => ({ usePathname: () => '/saved' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))

const KEY = 'eno:favorites'
const SAVED_KEY = 'eno-saved-cache'

/** Zero-padded so the provider's lexicographic `sort()` matches numeric order. */
const id = (n: number) => `id-${String(n).padStart(3, '0')}`
const idsOf = (n: number) => Array.from({ length: n }, (_, i) => id(i))

/** Ids the device has saved, read straight out of localStorage — where the damage happened. */
const persisted = (): string[] => JSON.parse(localStorage.getItem(KEY) || '[]')

type Answer = { listings: string[]; evaluated?: string[] } | 'fail'

/**
 * Stub `GET /api/listings?ids=` with a per-chunk answer, and record every chunk asked for.
 * `answer(chunk, index)` returns the ids to hand back, the ids to report as evaluated, or 'fail'.
 */
function stubFetch(answer: (chunk: string[], index: number) => Answer) {
  const chunks: string[][] = []
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes('?ids=')) return { ok: true, json: async () => ({}) } as any // the save beacon
    const chunk = decodeURIComponent(url.split('?ids=')[1].split('&')[0]).split(',')
    const index = chunks.length
    chunks.push(chunk)
    const a = answer(chunk, index)
    if (a === 'fail') return { ok: false, status: 500, json: async () => ({}) } as any
    return {
      ok: true,
      json: async () => ({
        listings: a.listings.map((x) => ({ id: x })),
        total: a.listings.length,
        ...(a.evaluated === undefined ? {} : { evaluated: a.evaluated }),
      }),
    } as any
  })
  vi.stubGlobal('fetch', fetchMock)
  return chunks
}

function Probe() {
  const { saved, savedError, count, toggle } = useFavorites()
  return (
    <div>
      <span data-testid="state">{saved === null ? 'loading' : `n=${saved.length}`}</span>
      <span data-testid="error">{savedError ? 'error' : 'ok'}</span>
      <span data-testid="count">{count}</span>
      <button type="button" onClick={() => toggle('id-999')}>heart</button>
    </div>
  )
}

/** Mount with `ids` already saved on the device, and let the 400 ms debounce fire. */
async function mountWith(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids))
  render(<FavoritesProvider><Probe /></FavoritesProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
}

/**
 * ⚠️ A REAL `localStorage`, BECAUSE THIS ENVIRONMENT DOES NOT HAVE ONE. Under vitest's jsdom the
 * global is an empty plain object — no getItem, no setItem, no clear — so the provider's every
 * read and write lands in its own `try {} catch {}` and disappears. The pruning bug lives in
 * exactly those writes, so a test running against the stub would pass no matter what the code did.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('FavoritesContext hydration', () => {
  it('0 saved: settles to empty without a request', async () => {
    const chunks = stubFetch(() => ({ listings: [], evaluated: [] }))
    await mountWith([])
    expect(screen.getByTestId('state').textContent).toBe('n=0')
    expect(chunks).toHaveLength(0)
  })

  it('1 saved: hydrates it', async () => {
    stubFetch((c) => ({ listings: c, evaluated: c }))
    await mountWith([id(0)])
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('n=1'))
    expect(persisted()).toEqual([id(0)])
  })

  it(`${IDS_FAST_PATH_MAX} saved: one request, nothing pruned`, async () => {
    const ids = idsOf(IDS_FAST_PATH_MAX)
    const chunks = stubFetch((c) => ({ listings: c, evaluated: c }))
    await mountWith(ids)
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe(`n=${IDS_FAST_PATH_MAX}`))
    expect(chunks).toHaveLength(1)
    expect(persisted()).toHaveLength(IDS_FAST_PATH_MAX)
  })

  it(`${IDS_FAST_PATH_MAX + 1} saved: chunked, ALL of them survive`, async () => {
    // ⛔ THE ORIGINAL DEFECT, EXACTLY. One request, 200 answered, the 201st absent from the
    // response and therefore erased from the device.
    const ids = idsOf(IDS_FAST_PATH_MAX + 1)
    const chunks = stubFetch((c) => ({ listings: c, evaluated: c }))
    await mountWith(ids)
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe(`n=${IDS_FAST_PATH_MAX + 1}`))
    expect(chunks.map((c) => c.length)).toEqual([IDS_FAST_PATH_MAX, 1])
    expect(persisted()).toHaveLength(IDS_FAST_PATH_MAX + 1)
    expect(persisted()).toContain(id(IDS_FAST_PATH_MAX))
  })

  it('500 saved: three chunks, all hydrated in the requested order', async () => {
    const ids = idsOf(500)
    const chunks = stubFetch((c) => ({ listings: c, evaluated: c }))
    await mountWith(ids)
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('n=500'))
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 100])
    expect(persisted()).toHaveLength(500)
  })

  it('a genuinely deleted listing IS pruned — the self-heal still works', async () => {
    const ids = idsOf(3)
    stubFetch((c) => ({ listings: c.filter((x) => x !== id(1)), evaluated: c }))
    await mountWith(ids)
    await waitFor(() => expect(persisted()).toEqual([id(0), id(2)]))
    expect(screen.getByTestId('state').textContent).toBe('n=2')
  })

  it('a failed chunk prunes NOTHING from that chunk, and says the load was partial', async () => {
    const ids = idsOf(IDS_FAST_PATH_MAX + 5)
    stubFetch((c, i) => (i === 1 ? 'fail' : { listings: c, evaluated: c }))
    await mountWith(ids)
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('error'))
    // The 5 ids in the failed chunk were never evaluated, so they are still saved…
    expect(persisted()).toHaveLength(IDS_FAST_PATH_MAX + 5)
    // …and what did load is still shown rather than the page pretending to be empty.
    expect(screen.getByTestId('state').textContent).toBe(`n=${IDS_FAST_PATH_MAX}`)
    // ⚠️ A PARTIAL ANSWER IS NEVER CACHED — it would come back as the whole library next load.
    expect(localStorage.getItem(SAVED_KEY)).toBeNull()
  })

  it('every chunk failing leaves the page in its retry state, not an empty one', async () => {
    stubFetch(() => 'fail')
    await mountWith(idsOf(3))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('error'))
    expect(screen.getByTestId('state').textContent).toBe('loading')
    expect(persisted()).toHaveLength(3)
  })

  it('a response with no `evaluated` (an older revision) prunes nothing', async () => {
    // ⚠️ FAIL CLOSED. During a rolling deploy the browser can hold new code and reach an old
    // revision; a missing field must cost a stale heart, never the user's saved items.
    stubFetch((c) => ({ listings: c.filter((x) => x !== id(1)) }))
    await mountWith(idsOf(3))
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('n=2'))
    expect(persisted()).toHaveLength(3)
  })

  it('an id hearted while the request was in flight is not pruned', async () => {
    stubFetch((c) => ({ listings: c, evaluated: c }))
    await mountWith(idsOf(2))
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('n=2'))
    // The new id was never sent, so it cannot be in any `evaluated` set — and the response that
    // lands next must not read its absence as a deletion.
    await act(async () => { screen.getByText('heart').click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    await waitFor(() => expect(persisted()).toContain('id-999'))
  })
})
