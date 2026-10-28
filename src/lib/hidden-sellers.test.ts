// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_SELLERS_EVENT, HIDDEN_SELLERS_KEY, HIDDEN_SELLERS_STYLE_ID, hiddenSellerIds, hiddenSellersCss, hiddenSellersHeadJs, hiddenSellersParam, hideSellerNow,
  MAX_HIDDEN_IN_QUERY, resetHiddenSellersForTest, syncHiddenSellers,
} from './hidden-sellers'

// ── src/lib/hidden-sellers.ts — a block takes the blocked shop's content out of every feed (App Store 1.2, 2026-10-28) ──
// One stylesheet hides every `[data-sid]` of a blocked shop and shows its `[data-sid-notice]`; the head script applies the
// stored list before first paint; AuthProvider syncs it per account. ⚠️ A fresh in-memory localStorage per test — Node
// 25's own global has no working methods, CI's Node 24 has a persistent one (memory: node25-localstorage-vitest).

const fetchMock = vi.fn()
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const styleText = () => document.getElementById(HIDDEN_SELLERS_STYLE_ID)?.textContent ?? null
const stored = () => JSON.parse(localStorage.getItem(HIDDEN_SELLERS_KEY) || 'null')

beforeEach(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
  resetHiddenSellersForTest()
  document.getElementById(HIDDEN_SELLERS_STYLE_ID)?.remove()
  document.body.innerHTML = ''
  document.cookie = 'sb-test-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('the stylesheet', () => {
  it('hides each shop\'s [data-sid] and shows its notice; nothing for no shops', () => {
    expect(hiddenSellersCss([])).toBe('')
    expect(hiddenSellersCss(['a1', 'b2', 'a1'])).toBe('[data-sid="a1"],.eno-sid-a1,[data-sid="b2"],.eno-sid-b2{display:none!important}[data-sid-notice="a1"],[data-sid-notice="b2"]{display:block!important}'
      + '[data-shelf]:has([data-shelf-items]):not(:has([data-shelf-items]>:not([data-sid="a1"]):not([data-sid="b2"]))){display:none!important}')
  })

  it('⛔ drops — never escapes — an id that is not a plain shop id, so nothing can close the selector', () => {
    expect(hiddenSellersCss(['x"]{}body{display:none', 'a b', '', 'ok_1-2', 'a.b'])).toBe('[data-sid="ok_1-2"],.eno-sid-ok_1-2{display:none!important}[data-sid-notice="ok_1-2"]{display:block!important}'
      + '[data-shelf]:has([data-shelf-items]):not(:has([data-shelf-items]>:not([data-sid="ok_1-2"]))){display:none!important}')
    expect(hiddenSellersCss(['"}'])).toBe('')
  })

  it('really hides a card and its cell, and shows the notice (jsdom applies the sheet)', () => {
    document.body.innerHTML = '<div data-sid="s1" id="cell"><div data-sid="s1" id="card"></div></div><div data-sid="s2" id="other"></div><div data-sid-notice="s1" class="hidden" id="notice" style="display:none"></div><div class="eno-pin eno-sid-s1" id="pin"></div>'
    hideSellerNow('s1')
    expect(getComputedStyle(document.getElementById('cell')!).display).toBe('none')
    expect(getComputedStyle(document.getElementById('pin')!).display).toBe('none')
    expect(getComputedStyle(document.getElementById('other')!).display).not.toBe('none')
    expect(getComputedStyle(document.getElementById('notice')!).display).toBe('block')
  })
})

describe('the pre-paint head script', () => {
  it('is empty while ugc-safety is off', () => {
    expect(hiddenSellersHeadJs(false)).toBe('')
  })

  it('applies EXACTLY the stylesheet hiddenSellersCss makes, from the stored list — with a session', () => {
    document.cookie = 'sb-test-auth-token=x; path=/'
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['s1', 'bad"id', 's2', 's1', 7] }))
    new Function(hiddenSellersHeadJs(true))()
    expect(styleText()).toBe(hiddenSellersCss(['s1', 's2']))
  })

  it('⛔ on the web with NO session it applies nothing — the list belongs to whoever signed in last (codex, review)', () => {
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['s1'] }))
    new Function(hiddenSellersHeadJs(true))()
    expect(styleText()).toBeNull()
  })

  it('in the app it applies the list even before the cookie is there (the app is one person\'s device)', () => {
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['s1'] }))
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone) EnoNativeApp/1.0.3' })
    new Function(hiddenSellersHeadJs(true))()
    expect(styleText()).toBe(hiddenSellersCss(['s1']))
  })

  it('does nothing — and never throws — with no list, an empty one, or junk', () => {
    document.cookie = 'sb-test-auth-token=x; path=/'
    for (const v of [null, '', 'not json', JSON.stringify({ ids: [] }), JSON.stringify({ ids: 'x' }), JSON.stringify([1])]) {
      document.getElementById(HIDDEN_SELLERS_STYLE_ID)?.remove()
      if (v === null) localStorage.removeItem(HIDDEN_SELLERS_KEY)
      else localStorage.setItem(HIDDEN_SELLERS_KEY, v)
      expect(() => new Function(hiddenSellersHeadJs(true))()).not.toThrow()
      expect(styleText()).toBeNull()
    }
  })
})

describe('hideSellerNow / syncHiddenSellers', () => {
  it('a Block hides the shop at once and stores it for the next load — for the account that made it', async () => {
    fetchMock.mockResolvedValueOnce(ok({ enabled: true, blocked: [], hiddenSellerIds: [] }))
    await syncHiddenSellers('u1')
    hideSellerNow('linked')
    expect(styleText()).toBe(hiddenSellersCss(['linked']))
    expect(stored()).toEqual({ u: 'u1', ids: ['linked'] })
  })

  it('a sync makes the shown list the server\'s — including a chat block\'s shop the button could not know', async () => {
    fetchMock.mockResolvedValueOnce(ok({ hiddenSellerIds: ['s1', 'shop-of-buyer'] }))
    await syncHiddenSellers('u1')
    expect(hiddenSellerIds()).toEqual(['s1', 'shop-of-buyer'])
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/blocks?only=ids')
    // An unblock elsewhere: the next sync brings the shop back.
    fetchMock.mockResolvedValueOnce(ok({ hiddenSellerIds: ['s1'] }))
    await syncHiddenSellers('u1')
    expect(styleText()).toBe(hiddenSellersCss(['s1']))
    expect(stored()).toEqual({ u: 'u1', ids: ['s1'] })
  })

  it('⛔ a sign-out clears the sheet and the stored list — the next account never inherits them', async () => {
    fetchMock.mockResolvedValueOnce(ok({ hiddenSellerIds: ['s1'] }))
    await syncHiddenSellers('u1')
    await syncHiddenSellers(null)
    expect(styleText()).toBeNull()
    expect(localStorage.getItem(HIDDEN_SELLERS_KEY)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('⛔ another account\'s stored list (the head script applied it) is dropped before this account\'s loads', async () => {
    document.cookie = 'sb-test-auth-token=x; path=/'
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'someone-else', ids: ['theirs'] }))
    new Function(hiddenSellersHeadJs(true))()
    expect(styleText()).toBe(hiddenSellersCss(['theirs']))
    let answer: (v: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((r) => { answer = r }))
    const pending = syncHiddenSellers('u1')
    expect(styleText()).toBeNull() // cleared while the fetch is still out
    answer(ok({ hiddenSellerIds: ['mine'] }))
    await pending
    expect(styleText()).toBe(hiddenSellersCss(['mine']))
  })

  it('the same account keeps its stored list while the sync is out, and a failed sync keeps what is shown', async () => {
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['s1'] }))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await syncHiddenSellers('u1')
    expect(styleText()).toBe(hiddenSellersCss(['s1']))
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await syncHiddenSellers('u1')
    expect(styleText()).toBe(hiddenSellersCss(['s1']))
  })

  it('⛔ an older sync answering last cannot undo a newer one (a list fetched before a block)', async () => {
    let first: (v: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((r) => { first = r })).mockResolvedValueOnce(ok({ hiddenSellerIds: ['linked'] }))
    const a = syncHiddenSellers('u1')
    hideSellerNow('linked')
    await syncHiddenSellers('u1')
    first(ok({ hiddenSellerIds: [] }))
    await a
    expect(hiddenSellerIds()).toEqual(['linked'])
  })

  it('⛔ a fresh page load starts from the stored list, so the FIRST feed request already carries xs (opus, review)', () => {
    document.cookie = 'sb-test-auth-token=x; path=/'
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['linked', 'bad"id'] }))
    resetHiddenSellersForTest({ reload: true })
    expect(hiddenSellersParam()).toBe('linked')
    // …and the same account's sync does not clear it while it is out.
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    void syncHiddenSellers('u1')
    expect(hiddenSellersParam()).toBe('linked')
  })

  it('…but not on the web without a session cookie', () => {
    localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: 'u1', ids: ['linked'] }))
    resetHiddenSellersForTest({ reload: true })
    expect(hiddenSellersParam()).toBe('')
  })

  it('xs is capped at the newest MAX_HIDDEN_IN_QUERY shops', async () => {
    fetchMock.mockResolvedValueOnce(ok({ hiddenSellerIds: Array.from({ length: MAX_HIDDEN_IN_QUERY + 5 }, (_, i) => `s${i}`) }))
    await syncHiddenSellers('u1')
    expect(hiddenSellersParam().split(',')).toHaveLength(MAX_HIDDEN_IN_QUERY)
    expect(hiddenSellersParam().startsWith('s0,s1,')).toBe(true)
  })

  it('a CHANGE of the hidden set fires the event QueryProvider marks the feeds stale on — no change, no event', async () => {
    const seen: number[] = []
    const on = () => seen.push(1)
    window.addEventListener(HIDDEN_SELLERS_EVENT, on)
    fetchMock.mockResolvedValue(ok({ hiddenSellerIds: ['s1'] }))
    await syncHiddenSellers('u1')
    await syncHiddenSellers('u1')
    window.removeEventListener(HIDDEN_SELLERS_EVENT, on)
    expect(seen).toHaveLength(1)
  })

  it('a shelf whose every item is a hidden shop goes whole; one with any other item (or a skeleton) stays', () => {
    document.body.innerHTML = [
      '<section data-shelf id="all"><div data-shelf-items><div data-sid="s1"></div><div data-sid="s1"></div></div></section>',
      '<section data-shelf id="mixed"><div data-shelf-items><div data-sid="s1"></div><div data-sid="s2"></div></div></section>',
      '<section data-shelf id="loading"><div data-shelf-items><div class="skeleton"></div></div></section>',
    ].join('')
    hideSellerNow('s1')
    expect(getComputedStyle(document.getElementById('all')!).display).toBe('none')
    expect(getComputedStyle(document.getElementById('mixed')!).display).not.toBe('none')
    expect(getComputedStyle(document.getElementById('loading')!).display).not.toBe('none')
  })

  it('useHiddenSellersParam follows the set — the explorer\'s feed key moves with a block', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useHiddenSellersParam } = await import('./use-hidden-sellers')
    fetchMock.mockResolvedValue(ok({ hiddenSellerIds: [] }))
    await syncHiddenSellers('u1')
    const { result } = renderHook(() => useHiddenSellersParam())
    expect(result.current).toBe('')
    act(() => hideSellerNow('linked'))
    expect(result.current).toBe('linked')
  })

  it('is inert while ugc-safety is off: no fetch, no sheet, no storage', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    await syncHiddenSellers('u1')
    hideSellerNow('s1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(styleText()).toBeNull()
    expect(localStorage.getItem(HIDDEN_SELLERS_KEY)).toBeNull()
  })
})
