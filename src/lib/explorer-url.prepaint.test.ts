import { describe, expect, it, vi } from 'vitest'
import { MASK_KEYS, PREPAINT_SCRIPT, RECENTS_ATTR, explorerUrlMasks, readExplorerUrl, recentSearchTerms } from './explorer-url'
import { RECENT_SEARCHES_KEY } from './reco-signals'

/**
 * E-SSR phase 1 (2026-09-29): the home layout's pre-paint script and the TypeScript predicate are the
 * same rule, written twice only because one of them runs before any bundle exists. These cases run
 * BOTH and demand the same answer, so the copy the browser executes cannot drift from the one the
 * suite reads.
 */

/** Runs the inline script against a fake `location` / `document`, the way the browser would. */
function runScript(search: string) {
  const attrs = new Map<string, string>()
  const timers: (() => void)[] = []
  const document = {
    documentElement: {
      setAttribute: (k: string, v: string) => { attrs.set(k, v) },
      removeAttribute: (k: string) => { attrs.delete(k) },
    },
  }
  const setTimeout = (fn: () => void) => { timers.push(fn); return timers.length }
  new Function('location', 'document', 'setTimeout', PREPAINT_SCRIPT)({ search }, document, setTimeout)
  return { masked: attrs.has('data-explorer-directed'), timers, attrs }
}

const CASES: [string, boolean][] = [
  ['', false],
  ['?', false],
  ['?q=honda', true],
  ['?q=', false], // an empty value directs nothing
  ['?category=rentals&district=d2', true],
  ['?sort=price-low', true], // same set, but not in the seed's order
  ['?match=any&q=sofa', true],
  ['?view=grid', false], // the default view is the seed's own
  ['?view=compact', true],
  ['?view=map', true],
  ['?attr_bedrooms=2', true],
  ['?range_areaM2=30-80', true],
  ['?utm_source=zalo&fbclid=x', false], // tracking params are not the explorer's
  ['?focus=abc', false],
]

describe('the pre-paint mask rule', () => {
  it.each(CASES)('%s → masked %s (script and predicate agree)', (search, want) => {
    expect(explorerUrlMasks(search)).toBe(want)
    expect(runScript(search).masked).toBe(want)
  })

  it('every mask key alone masks; the list is the one the script was built from', () => {
    for (const k of MASK_KEYS) {
      const v = k === 'view' ? 'map' : 'x'
      expect(runScript(`?${k}=${v}`).masked, k).toBe(true)
      expect(explorerUrlMasks(`?${k}=${v}`), k).toBe(true)
    }
    expect(PREPAINT_SCRIPT).toContain(JSON.stringify(MASK_KEYS))
  })

  it('masks every URL the explorer itself reads as directed (no directed URL paints the seed unmasked)', () => {
    for (const search of ['?q=honda', '?category=rentals', '?district=d2', '?brand=apple', '?type=free', '?condition=used', '?deal=good', '?priceMin=1000000', '?view=map', '?subcategory=x&category=rentals']) {
      if (readExplorerUrl(search).directed) expect(explorerUrlMasks(search), search).toBe(true)
    }
  })

  it('removes itself after 15s — the no-JS safety net', () => {
    const r = runScript('?q=honda')
    expect(r.masked).toBe(true)
    expect(r.timers).toHaveLength(1)
    r.timers[0]()
    expect(r.attrs.has('data-explorer-directed')).toBe(false)
  })

  it('never throws — a hostile environment costs the mask, not the page', () => {
    const boom = vi.fn(() => { throw new Error('nope') })
    expect(() => new Function('location', 'document', 'setTimeout', PREPAINT_SCRIPT)(
      { get search() { return boom() } }, {}, () => 0,
    )).not.toThrow()
  })

  it('is ES5 syntax — no arrow functions, let/const, template literals or spread', () => {
    const body = PREPAINT_SCRIPT.replace(JSON.stringify(MASK_KEYS), '[]')
    expect(body).not.toMatch(/=>|\blet\b|\bconst\b|`|\.\.\./)
  })
})

/** The same script, with a fake localStorage holding `stored` under the recent-searches key. */
function runWithRecents(search: string, stored: string | null) {
  const attrs = new Map<string, string>()
  const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs.set(k, v) }, removeAttribute: (k: string) => { attrs.delete(k) } } }
  const localStorage = { getItem: (k: string) => (k === RECENT_SEARCHES_KEY ? stored : null) }
  new Function('location', 'document', 'setTimeout', 'localStorage', PREPAINT_SCRIPT)({ search }, document, () => 0, localStorage)
  return { recents: attrs.has(RECENTS_ATTR), masked: attrs.has('data-explorer-directed') }
}

describe('the returning-visitor recents reservation (E-RETURNING, O-16)', () => {
  it('reserves the row on the undirected home when a recent search is stored', () => {
    expect(runWithRecents('', JSON.stringify(['honda']))).toEqual({ recents: true, masked: false })
    expect(runWithRecents('?utm_source=zalo', JSON.stringify(['sofa', 'fridge']))).toEqual({ recents: true, masked: false })
  })

  it('never on a directed URL — the row is an undirected-home affordance, and the mask still applies', () => {
    expect(runWithRecents('?q=honda', JSON.stringify(['honda']))).toEqual({ recents: false, masked: true })
  })

  it('nothing on a first visit, and nothing for a list the row would not fill', () => {
    for (const stored of [null, '[]', '["  "]', '[1,2]', '"honda"', '{"0":"honda","length":1}', 'not json']) {
      expect(runWithRecents('', stored).recents, String(stored)).toBe(false)
    }
  })

  it('the script and the row read the same list (recentSearchTerms)', () => {
    for (const stored of ['["honda"]', '[" sofa ",""]', '[]', '["  "]', '[1,"x"]', '"honda"']) {
      const parsed = JSON.parse(stored)
      expect(runWithRecents('', stored).recents, stored).toBe(recentSearchTerms(parsed).length > 0)
    }
    expect(recentSearchTerms([' sofa ', '', 3, 'honda'])).toEqual(['sofa', 'honda'])
  })

  it('a storage that throws costs the row, never the page', () => {
    const document = { documentElement: { setAttribute: () => {}, removeAttribute: () => {} } }
    const localStorage = { getItem: () => { throw new Error('blocked') } }
    expect(() => new Function('location', 'document', 'setTimeout', 'localStorage', PREPAINT_SCRIPT)({ search: '' }, document, () => 0, localStorage)).not.toThrow()
  })
})

describe('recentSearchTerms — no duplicate chips (gate 2026-09-30)', () => {
  it('dedupes case-insensitively after trimming, first wins', () => {
    expect(recentSearchTerms(['sofa', 'sofa ', 'Sofa', 'honda'])).toEqual(['sofa', 'honda'])
  })
})
