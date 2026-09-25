// @vitest-environment jsdom
/**
 * The availability-check basket is the one piece of this feature that lives entirely on the device,
 * so these tests pin what the device must never get wrong:
 *   · five and no more, one row per listing, rentals only — the server refuses anything else, and a
 *     basket that let a sixth in would fail at the last step instead of the first;
 *   · a stored basket is re-validated on the way in (localStorage is user-writable);
 *   · storage that throws (private mode, blocked site data) degrades to an in-memory basket rather
 *     than a chip that does nothing;
 *   · another tab's edit reaches this one;
 *   · the draft outlives a week of nothing, the send intent does not outlive fifteen minutes.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BASKET_KEY,
  DRAFT_KEY,
  DRAFT_TTL_MS,
  HINT_KEY,
  INTENT_TTL_MS,
  __resetRentalCheckStoreForTests,
  addToBasket,
  basketItemFrom,
  clearBasket,
  clearDraft,
  getBasket,
  newClientRequestId,
  parseBasket,
  readDraft,
  removeFromBasket,
  subscribeBasket,
  takeFirstAddHint,
  useInRentalBasket,
  useRentalBasket,
  useRentalBasketCount,
  writeDraft,
} from './store'
import { RENTAL_CHECK_REQUEST_ID_RE } from './shared'

const rental = (n: number, over: Record<string, unknown> = {}) => ({
  id: `r${n}`,
  title: `Flat ${n}`,
  titleVi: `Căn ${n}`,
  images: [`https://photo.example/${n}.jpg`],
  price: 10_000_000 + n,
  currency: 'VND',
  priceUnit: 'VND/month',
  category: { slug: 'rentals' },
  ...over,
})

const stored = () => JSON.parse(localStorage.getItem(BASKET_KEY) || 'null') as { v: number; items: { id: string }[] } | null

/**
 * ⚠️ A REAL Storage, BECAUSE THIS ENVIRONMENT DOES NOT HAVE ONE — under vitest's jsdom (Node 25) the
 * global is an empty object, so every read and write would land in the store's own try/catch and
 * the tests would pass whatever the code did. Same stub as favorites-context.test.tsx.
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
const throwingStorage = (): Storage => {
  const boom = () => { throw new Error('SecurityError') }
  return { length: 0, key: boom, getItem: boom, setItem: boom, removeItem: boom, clear: boom } as unknown as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetRentalCheckStoreForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('basket', () => {
  it('holds five and refuses the sixth — and says so', () => {
    for (let i = 1; i <= 5; i++) expect(addToBasket(rental(i))).toBe('added')
    expect(addToBasket(rental(6))).toBe('full')
    expect(getBasket().map((i) => i.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(stored()?.items).toHaveLength(5)
  })

  it('one row per listing', () => {
    expect(addToBasket(rental(1))).toBe('added')
    expect(addToBasket(rental(1, { title: 'again' }))).toBe('exists')
    expect(getBasket()).toHaveLength(1)
  })

  it('refuses anything that is not a rental', () => {
    expect(addToBasket(rental(1, { category: { slug: 'motorbikes' } }))).toBe('refused')
    expect(addToBasket(rental(2, { category: null }))).toBe('refused')
    expect(getBasket()).toHaveLength(0)
    expect(localStorage.getItem(BASKET_KEY)).toBeNull()
  })

  it('snapshots only what the row needs, first image only', () => {
    const item = basketItemFrom(rental(1, { images: ['https://a/1.jpg', 'https://a/2.jpg'] }), 123)
    expect(item).toEqual({
      id: 'r1', title: 'Flat 1', titleVi: 'Căn 1', image: 'https://a/1.jpg',
      price: 10_000_001, currency: 'VND', priceUnit: 'VND/month', addedAt: 123,
    })
  })

  it('remove and clear write through; an empty basket leaves no key behind', () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    removeFromBasket('r1')
    expect(stored()?.items.map((i) => i.id)).toEqual(['r2'])
    clearBasket()
    expect(localStorage.getItem(BASKET_KEY)).toBeNull()
    expect(getBasket()).toEqual([])
  })

  it('re-validates a stored basket: junk rows dropped, dupes folded, capped at five, unsafe images nulled', () => {
    const rows = [
      { id: 'a', title: 'A', titleVi: null, image: 'javascript:alert(1)', price: 1, currency: 'VND', priceUnit: 'VND', addedAt: 1 },
      { id: 'a', title: 'A again', titleVi: null, image: null, price: 1, currency: 'VND', priceUnit: 'VND', addedAt: 1 },
      { id: 'bad id!', title: 'B', price: 1, currency: 'VND', priceUnit: 'VND' },
      { id: 'c', title: '', price: 1, currency: 'VND', priceUnit: 'VND' },
      { id: 'd', title: 'D', price: -5, currency: 'VND', priceUnit: 'VND' },
      ...['e', 'f', 'g', 'h', 'i', 'j'].map((id) => ({ id, title: id, titleVi: null, image: '/local.jpg', price: 2, currency: 'VND', priceUnit: 'VND', addedAt: 2 })),
    ]
    const parsed = parseBasket(JSON.stringify({ v: 1, items: rows }))
    expect(parsed.map((i) => i.id)).toEqual(['a', 'e', 'f', 'g', 'h'])
    expect(parsed[0].image).toBeNull()
    expect(parsed[1].image).toBe('/local.jpg')
    expect(parseBasket('not json')).toEqual([])
    expect(parseBasket(JSON.stringify({ v: 2, items: rows }))).toEqual([])
    expect(parseBasket(JSON.stringify(rows))).toEqual([])
  })

  it('keeps working in memory when storage throws', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(addToBasket(rental(1))).toBe('added')
    expect(addToBasket(rental(2))).toBe('added')
    removeFromBasket('r1')
    expect(getBasket().map((i) => i.id)).toEqual(['r2'])
  })

  it('another tab’s edit reaches this one (the storage event)', () => {
    addToBasket(rental(1))
    const seen = vi.fn()
    const off = subscribeBasket(seen)
    // The other tab writes storage directly and the browser fires `storage` here.
    localStorage.setItem(BASKET_KEY, JSON.stringify({ v: 1, items: [{ ...basketItemFrom(rental(1)), addedAt: 1 }, { ...basketItemFrom(rental(7)), addedAt: 2 }] }))
    window.dispatchEvent(new StorageEvent('storage', { key: BASKET_KEY }))
    expect(seen).toHaveBeenCalledTimes(1)
    expect(getBasket().map((i) => i.id)).toEqual(['r1', 'r7'])
    // An unrelated key is not our business.
    window.dispatchEvent(new StorageEvent('storage', { key: 'eno:favorites' }))
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })

  it('hooks: the per-id boolean flips only for its own id; the count follows', () => {
    let renders = 0
    const mine = renderHook(() => { renders++; return useInRentalBasket('r2') })
    const count = renderHook(() => useRentalBasketCount())
    const all = renderHook(() => useRentalBasket())
    expect(mine.result.current).toBe(false)
    const before = renders
    act(() => { addToBasket(rental(1)) })
    expect(mine.result.current).toBe(false)
    // Another card's add must not re-render this one — the whole reason the hook returns a boolean.
    expect(renders).toBe(before)
    expect(count.result.current).toBe(1)
    act(() => { addToBasket(rental(2)) })
    expect(mine.result.current).toBe(true)
    expect(count.result.current).toBe(2)
    expect(all.result.current.map((i) => i.id)).toEqual(['r1', 'r2'])
    // A stable snapshot between changes — useSyncExternalStore loops forever on a fresh array.
    expect(getBasket()).toBe(getBasket())
  })
})

describe('draft + intent', () => {
  const base = { requirements: 'Pets?', channel: 'zalo' as const, value: '0912345678' }

  it('round-trips, then expires after 7 days (and clears itself)', () => {
    writeDraft(base, 1_000)
    expect(readDraft(1_000 + DRAFT_TTL_MS)).toMatchObject({ ...base, savedAt: 1_000 })
    expect(readDraft(1_000 + DRAFT_TTL_MS + 1)).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('the send intent lives 15 minutes; the draft outlives it', () => {
    const intent = { clientRequestId: newClientRequestId(), at: 5_000 }
    writeDraft({ ...base, pending: intent }, 5_000)
    expect(readDraft(5_000 + INTENT_TTL_MS)?.pending).toEqual(intent)
    const later = readDraft(5_000 + INTENT_TTL_MS + 1)
    expect(later).not.toBeNull()
    expect(later?.pending).toBeUndefined()
  })

  it('refuses a malformed intent id and an unknown channel', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...base, channel: 'sms', savedAt: 1, pending: { clientRequestId: 'x', at: 1 } }))
    const d = readDraft(2)
    expect(d?.channel).toBe('whatsapp')
    expect(d?.pending).toBeUndefined()
  })

  it('clearDraft removes it', () => {
    writeDraft(base)
    clearDraft()
    expect(readDraft()).toBeNull()
  })

  it('mints ids the server accepts', () => {
    const a = newClientRequestId()
    expect(a).toMatch(RENTAL_CHECK_REQUEST_ID_RE)
    expect(newClientRequestId()).not.toBe(a)
  })
})

describe('first-add hint', () => {
  it('fires once per session', () => {
    expect(takeFirstAddHint()).toBe(true)
    expect(takeFirstAddHint()).toBe(false)
    expect(sessionStorage.getItem(HINT_KEY)).toBe('1')
  })

  it('still fires once when sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', throwingStorage())
    expect(takeFirstAddHint()).toBe(true)
    expect(takeFirstAddHint()).toBe(false)
  })

  it('does not fire again in a new page life of the same session', () => {
    sessionStorage.setItem(HINT_KEY, '1')
    expect(takeFirstAddHint()).toBe(false)
  })
})
