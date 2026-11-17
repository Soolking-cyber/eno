import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CAT_ROW_ATTR, FOLD_ATTR, LANES_OFF_ATTR, MASK_KEYS, PREPAINT_SCRIPT, RECENTS_ATTR, explorerUrlCatRow, explorerUrlFolds, explorerUrlHidesLanes, explorerUrlMasks, readExplorerUrl, recentSearchTerms } from './explorer-url'
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

describe('the category a cold link asks for', () => {
  it('reaches <html>, so globals.css can hold open the rows that category will grow', () => {
    expect(runScript('?category=electronics').attrs.get('data-explorer-cat')).toBe('electronics')
  })
  it('is absent when the link names none', () => {
    expect(runScript('?q=phone').attrs.has('data-explorer-cat')).toBe(false)
  })
  it('never without the mask: an undirected home has nothing to reserve', () => {
    expect(runScript('').attrs.has('data-explorer-cat')).toBe(false)
  })
})

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
  ['?province=79', true], // NAV-2: the area is the explorer's too
  ['?province=79&ward=26734', true],
  ['?lat=10.7&lng=106.7', false], // never ours: the explorer writes no coordinates
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

describe('the one-row mark (owner, 2026-11-16, hub Q17; every phone feed one row since 2026-11-17) — a cold fold that names a rung paints its one control row from the first frame', () => {
  const marks = (search: string) => runScript(search).attrs.has(CAT_ROW_ATTR)
  it('the script marks exactly what explorerUrlCatRow says', () => {
    const urls = ['?category=electronics', '?category=rentals', '?category=rentals&subcategory=apartment-rental', '?category=rentals&district=q1',
      '?category=rentals&sort=price-low', '?category=services', '?category=%20electronics%20', '?category=electronics&q=iphone',
      '?category=electronics&q=%20', '?category=electronics&brand=apple', '?category=electronics&brand=all', '?category=electronics&model=x',
      '?category=electronics&model=all', '?category=teachers', '?category=jobs', '?category=all', '?category=', '?q=iphone', '?brand=apple',
      '?subcategory=apartment-rental', '', '?sort=recent', '?category=all&category=electronics', '?category=electronics&category=all',
      '?category=electronics&view=map', '?category=electronics&view=compact',
      // every rung alone, words beside a rung, Teachers and Jobs with their own filters (owner 2026-11-17)
      '?model=iphone-15', '?brand=%20apple%20', '?brand=all', '?model=all', '?subcategory=all', '?category=all&brand=apple',
      '?category=all&subcategory=apartment-rental', '?category=all&q=iphone', '?brand=apple&q=case', '?q=iphone&model=iphone-15',
      '?category=electronics&brand=apple&model=iphone-15&q=case', '?category=jobs&q=english', '?category=teachers&district=q1',
      '?category=jobs&sort=price-low', '?category=teachers&view=map',
      // rung-less folds and unfolded links
      '?view=compact', '?view=map', '?line=pro', '?district=q1', '?priceMin=100', '?type=free', '?condition=used', '?deal=good',
      '?province=79', '?view=grid', '?ref=email', '?utm_source=zalo', '?category=%20&sort=price-low',
      // the first value of each rung decides, as the explorer reads it
      '?brand=all&brand=apple', '?brand=apple&brand=all', '?model=all&model=x', '?subcategory=x&subcategory=all']
    for (const u of urls) expect(marks(u), u).toBe(explorerUrlCatRow(u))
    // the script's rung list is the four ladder keys, the chip's words come from the deepest one
    expect(PREPAINT_SCRIPT).toContain(JSON.stringify(['category', 'subcategory', 'brand', 'model']))
  })
  it('every fold that names a category, subcategory, brand or model — words allowed, Teachers and Jobs too (owner 2026-11-17, "every phone feed one row"); never a rung-less or unfolded link', () => {
    for (const u of ['?category=electronics', '?category=rentals&subcategory=apartment-rental', '?category=rentals&district=q1&priceMax=9000000',
      '?category=electronics&q=iphone', '?category=electronics&brand=apple', '?category=electronics&model=iphone-15',
      '?category=teachers', '?category=jobs', '?brand=apple', '?subcategory=apartment-rental', '?model=iphone-15', '?category=all&brand=apple'])
      expect(explorerUrlCatRow(u), u).toBe(true)
    for (const u of ['?category=all', '?q=iphone', '?category=all&q=iphone', '?brand=all&q=iphone', '?view=compact', '?line=pro', '?district=q1',
      '', '?ref=email', '?sort=price-low', '?view=grid', '?category=', '?category=%20&sort=price-low', '?category=all&category=electronics'])
      expect(explorerUrlCatRow(u), u).toBe(false)
  })
  it('the script sets it, with the fold, for ?brand=apple (no category), ?category=electronics&q=iphone, ?category=jobs and ?category=teachers', () => {
    for (const u of ['?brand=apple', '?category=electronics&q=iphone', '?category=jobs', '?category=teachers']) {
      const { attrs } = runScript(u)
      expect(attrs.has(FOLD_ATTR), u).toBe(true)
      expect(attrs.has(CAT_ROW_ATTR), u).toBe(true)
    }
  })
  it('the script never sets it for an unfolded link, nor for a fold that names no rung (words alone, a list view, a district, `all`)', () => {
    for (const u of ['', '?ref=email', '?sort=price-low', '?view=grid', '?utm_source=zalo', '?category=%20&sort=price-low']) {
      const { attrs } = runScript(u)
      expect(attrs.has(FOLD_ATTR), u).toBe(false)
      expect(attrs.has(CAT_ROW_ATTR), u).toBe(false)
    }
    for (const u of ['?q=iphone', '?view=compact', '?view=map', '?district=q1', '?line=pro', '?category=all&q=iphone', '?brand=all&q=iphone', '?category=all&category=electronics&q=x']) {
      const { attrs } = runScript(u)
      expect(attrs.has(FOLD_ATTR), u).toBe(true)
      expect(attrs.has(CAT_ROW_ATTR), u).toBe(false)
    }
  })
  it('its rung loop declares no global (the script is inline, sloppy-mode)', () => {
    const before = new Set(Object.getOwnPropertyNames(globalThis))
    for (const u of ['?brand=apple', '?category=jobs&q=english', '?q=iphone', '']) runScript(u)
    expect(Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k))).toEqual([])
  })
  it('only with the fold mark (no fold, no row), and the 15 s net lifts it with the fold', () => {
    const { attrs, timers } = runScript('?category=rentals')
    expect(attrs.has(FOLD_ATTR)).toBe(true)
    expect(attrs.has(CAT_ROW_ATTR)).toBe(true)
    timers.forEach((fn) => fn())
    expect(attrs.has(CAT_ROW_ATTR)).toBe(false)
    expect(attrs.has(FOLD_ATTR)).toBe(false)
    for (const u of ['?ref=email', '?sort=price-low']) expect(runScript(u).attrs.has(CAT_ROW_ATTR), u).toBe(false)
  })
  it('the explorer drops it wherever it drops the fold mark (listings-explorer.tsx)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/marketplace/listings-explorer.tsx'), 'utf8')
    const folds = src.match(/removeAttribute\(FOLD_ATTR\)/g)!.length
    expect(folds).toBeGreaterThan(0)
    expect(src.match(/removeAttribute\(CAT_ROW_ATTR\)/g)!.length).toBe(folds)
  })
})

describe('the fold mark (all21 phone hunt #1, 2026-11-09) — a phone paints a directed link already folded', () => {
  const marks = (search: string) => runScript(search).attrs.has(FOLD_ATTR)
  it('the script marks exactly what explorerUrlFolds says, and that is readExplorerUrl(…).directed for every masked link', () => {
    const urls = ['?q=iphone', '?q=%20%20', '?category=rentals', '?category=all', '?subcategory=apartment-rental', '?brand=apple', '?brand=all',
      '?model=x', '?line=pro', '?type=rent', '?type=all', '?condition=used', '?condition=all', '?deal=good', '?deal=bad', '?priceMin=100',
      '?priceMax=9', '?district=q1', '?district=all', '?province=79', '?province=79&ward=26734', '?province=x', '?view=map', '?view=video',
      '?view=compact', '?sort=price-low', '?match=any', '?q=honda&category=vehicles&sort=price-low', '?ref=email', '',
      // The first value of a key decides, as the explorer reads it (review): undirected, then directed.
      '?category=all&category=electronics', '?category=electronics&category=all', '?line=all', '?priceMin=abc']
    for (const u of urls) {
      expect(marks(u), u).toBe(explorerUrlFolds(u))
      if (explorerUrlMasks(u)) expect(explorerUrlFolds(u), u).toBe(readExplorerUrl(u).directed)
      else expect(explorerUrlFolds(u), u).toBe(false) // no mask, no fold
    }
  })
  it('a category\'s own filters fold with the category, never alone (the explorer keeps only the ones it defines)', () => {
    expect(explorerUrlFolds('?attr_bedrooms=2')).toBe(false)
    expect(explorerUrlFolds('?category=rentals&attr_bedrooms=2')).toBe(true)
  })
  it('the 15 s net lifts the fold with the mask', () => {
    const { attrs, timers } = runScript('?q=iphone')
    expect(attrs.has(FOLD_ATTR)).toBe(true)
    timers.forEach((fn) => fn())
    expect(attrs.has(FOLD_ATTR)).toBe(false)
    expect(attrs.has('data-explorer-directed')).toBe(false)
  })
})

/**
 * ⛔ THE HOME PAGE'S PHONE LANES NEVER PAINT ON A LINK THAT WILL HIDE THEM (owner-approved 2026-11-14, cook r04 home-b —
 * explorer-url.ts LANES_OFF_ATTR). The explorer shows the lanes exactly while it shows undirected browse (`showDiscovery`):
 * not on any URL it reads as directed, except a list view (`?view=compact`), which it un-latches back to the undirected home.
 */
describe('the lanes-off mark — a phone never paints lanes a directed link will drop', () => {
  const marks = (search: string) => runScript(search).attrs.has(LANES_OFF_ATTR)
  const urls = ['?q=iphone', '?q=%20%20', '?category=rentals', '?category=all', '?subcategory=apartment-rental', '?brand=apple', '?brand=all',
    '?model=x', '?line=pro', '?type=rent', '?type=all', '?condition=used', '?condition=all', '?deal=good', '?deal=bad', '?priceMin=100',
    '?priceMax=9', '?district=q1', '?district=all', '?province=79', '?province=79&ward=26734', '?province=x', '?view=map', '?view=video',
    '?view=compact', '?view=grid', '?sort=price-low', '?sort=recent', '?match=any', '?q=honda&category=vehicles&sort=price-low', '?ref=email',
    '?utm_source=zalo', '?fbclid=x', '', '?category=all&category=electronics', '?category=electronics&category=all', '?line=all', '?priceMin=abc',
    '?view=compact&q=iphone']
  it('the script marks exactly what explorerUrlHidesLanes says, and that is "directed, but not by a list view alone"', () => {
    for (const u of urls) {
      expect(marks(u), u).toBe(explorerUrlHidesLanes(u))
      const s = readExplorerUrl(u)
      // The explorer's own reading: directed by anything but `view=compact`, or a takeover view.
      const directedWithoutList = readExplorerUrl(new URLSearchParams([...new URLSearchParams(u)].filter(([k, v]) => !(k === 'view' && v === 'compact')))).directed
      const want = s.view === 'map' || s.view === 'video' || directedWithoutList
      if (explorerUrlMasks(u)) expect(explorerUrlHidesLanes(u), u).toBe(want)
      else expect(explorerUrlHidesLanes(u), u).toBe(false) // no mask, no lanes-off
    }
  })
  it('a sort, a list view and tracking parameters keep the lanes (they direct nothing the lanes depend on)', () => {
    for (const u of ['?sort=recent', '?view=compact', '?utm_source=zalo', '?match=any', '']) expect(marks(u), u).toBe(false)
    for (const u of ['?q=iphone', '?category=rentals', '?view=map', '?deal=good', '?province=79']) expect(marks(u), u).toBe(true)
  })
  it('the 15 s net does NOT lift it (a page whose JavaScript never came keeps its feed where it painted it)', () => {
    const { attrs, timers } = runScript('?q=iphone')
    expect(attrs.has(LANES_OFF_ATTR)).toBe(true)
    timers.forEach((fn) => fn())
    expect(attrs.has(LANES_OFF_ATTR)).toBe(true)
    expect(attrs.has('data-explorer-directed')).toBe(false)
  })
  it('the fold mark is unchanged by it: `view=compact` still folds', () => {
    expect(runScript('?view=compact').attrs.has(FOLD_ATTR)).toBe(true)
    expect(runScript('?view=compact').attrs.has(LANES_OFF_ATTR)).toBe(false)
  })
  it('declares no global (the script is inline, sloppy-mode)', () => {
    expect(PREPAINT_SCRIPT).not.toMatch(/[;{]h=false/)
    expect(PREPAINT_SCRIPT).toContain(',h=false;')
  })
})
