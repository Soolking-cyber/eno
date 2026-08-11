// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { formatCount } from '@/lib/vnd'
import { resultCountLabel, type TrFn } from './result-line'
import { CountChip, countChipLabel, countDigits, optionCount, railDimension } from './count-chip'
import { CategoryRail } from './category-rail'
import { BrandRail } from './brand-rail'

// A fixture label, as a const: `react/jsx-no-literals` is an ERROR in `npm run lint` and it
// lints tests too — a bare word in JSX is indistinguishable to it from untranslated product copy.
const BRAND = 'Honda'


/**
 * THE NUMBER BESIDE A CHIP — the four things that are easy to get wrong and invisible in a
 * screenshot: the SEPARATOR (a Vietnamese reader must see 2.418, not 2,418), the difference
 * between an ABSENT dimension and a ZERO, the difference between a missing KEY and an absent
 * dimension, and what a screen reader actually says when a bare number is glued to a brand name.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach. Without this line the second render in the file fails with
 * "Found multiple elements". (Same note as result-line.test.tsx; any new component test needs it.)
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT THROUGH localStorage — the provider's mount
 * effect reads localStorage, but under this vitest/jsdom combination `window.localStorage` has no
 * getItem/setItem at all, so a stored preference is silently swallowed and every "vi" test would
 * have run in English. Same harness, and same reason, as result-line.test.tsx.
 */
function clearLangPref() {
  try {
    window.localStorage?.removeItem?.('lang')
  } catch {
    /* no usable storage in this environment — nothing to clear */
  }
}
beforeEach(clearLangPref)
afterEach(clearLangPref)

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

function renderIn(lang: Language, ui: React.ReactNode) {
  return render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      {ui}
    </LanguageProvider>,
  )
}

/**
 * ⚠️ EVERY ASYNC WAIT IN THIS FILE GETS A GENEROUS BUDGET, AND THAT IS NOT PADDING. Nothing here
 * awaits real I/O — the fetches are mocked and the language switch is one effect — so the default
 * 1000ms budget cannot measure anything except how loaded the machine is. Measured: this file
 * passes 6/6 in isolation and failed twice inside a full 150-file, 8-worker run that had just
 * finished a typecheck. A correctness assertion that fails under load is not a gate, it is a coin
 * flip that trains people to re-run the suite.
 */
const WAIT = { timeout: 8000 }

// Stand-ins for the real tr() when testing the pure helpers: exactly the provider's contract.
const trEn: TrFn = (en) => en
const trVi: TrFn = (en, vi) => vi ?? en

describe('countDigits — the separator, which is the whole reason this is not hand-formatted', () => {
  it('groups thousands with a COMMA in English and a DOT in Vietnamese', () => {
    expect(countDigits(2418, 'en')).toBe('2,418')
    expect(countDigits(2418, 'vi')).toBe('2.418')
    expect(countDigits(12000000, 'en')).toBe('12,000,000')
    expect(countDigits(12000000, 'vi')).toBe('12.000.000')
  })

  it('every non-Vietnamese language takes the international comma form', () => {
    // moneyLocale() narrows anything that is not 'vi' to 'en' — the eleven machine-translated
    // languages inherit the international grouping rather than each inventing one.
    expect(countDigits(2418, 'ru')).toBe('2,418')
    expect(countDigits(2418, 'ko')).toBe('2,418')
  })

  it('pins WHY this is not formatCount, so the choice cannot rot silently', () => {
    // formatCount is the repo's COMPACT count formatter. It is the wrong tool for a chip that is
    // meant to answer "how many exactly": it throws the figure away, and its Vietnamese form puts
    // a COMMA where Vietnamese puts a decimal comma.
    expect(formatCount(2418, 'vi')).toBe('2,4k')
    expect(formatCount(2418, 'en')).toBe('2.4k')
    // Asserted as a PROPERTY too, so a change to formatCount's exact output does not make this
    // file fail for a reason that has nothing to do with the chip.
    expect(countDigits(2418, 'vi')).not.toBe(formatCount(2418, 'vi'))
    expect(countDigits(2418, 'vi')).toContain('418')
  })

  it('a count below 1000 is still grouped, and 0 renders as 0 rather than an empty string', () => {
    // groupVnd returns '' for an empty digit string — 0 must not fall into that hole, because a
    // zero is information and a blank chip is not.
    expect(countDigits(0, 'en')).toBe('0')
    expect(countDigits(0, 'vi')).toBe('0')
    expect(countDigits(412, 'vi')).toBe('412')
  })

  it('a nonsense count degrades to 0 instead of rendering NaN at a buyer', () => {
    expect(countDigits(Number.NaN, 'en')).toBe('0')
    // A negative can only arrive from a caller bug; groupVnd strips the sign anyway, so clamping
    // first is what stops "-5" reading as "5".
    expect(countDigits(-5, 'en')).toBe('0')
    // Truncation, not rounding: a count is a row count.
    expect(countDigits(1.7, 'en')).toBe('1')
  })
})

describe('countChipLabel — what the chip SOUNDS like', () => {
  it('English inflects the noun; Vietnamese does not', () => {
    expect(countChipLabel(1, 'en', trEn)).toBe('1 listing')
    expect(countChipLabel(412, 'en', trEn)).toBe('412 listings')

    // ⚠️ Vietnamese has no plural inflection — "tin đăng" is the same word for one and for 412 —
    // so the noun is chosen PER LANGUAGE, never by pluralising English and translating it. If
    // someone ever "fixes" this by appending an -s, these two stop being equal and this says so.
    const one = countChipLabel(1, 'vi', trVi)
    const many = countChipLabel(412, 'vi', trVi)
    expect(one).toBe('1 tin đăng')
    expect(many).toBe('412 tin đăng')
    expect(one.replace(/^[\d.,]+ /, '')).toBe(many.replace(/^[\d.,]+ /, ''))
  })

  it('says exactly what the result line says — the anti-drift pin for the copied helper', () => {
    // count-chip.tsx deliberately restates result-line.tsx's `resultCountLabel` rather than
    // importing it (result-line.tsx is a component module that would drag ui/breadcrumb and
    // ui/badge onto the rails' eager chunk). THIS is what keeps the two copies honest: if either
    // side changes its noun, its plural rule or its formatter, these stop matching.
    for (const n of [0, 1, 2, 412, 2418, 12000000]) {
      expect(countChipLabel(n, 'en', trEn)).toBe(resultCountLabel(n, 'en', trEn))
      expect(countChipLabel(n, 'vi', trVi)).toBe(resultCountLabel(n, 'vi', trVi))
    }
  })

  it('zero is plural in English', () => {
    expect(countChipLabel(0, 'en', trEn)).toBe('0 listings')
  })
})

describe('optionCount — absent dimension vs missing key, the distinction the payload lives on', () => {
  it('an ABSENT dimension is undefined, never zero', () => {
    // `facets` is `{}` on a load-more page and with ?facets=0. Rendering that as a row of zeros
    // would claim an empty catalogue.
    expect(optionCount(undefined, 'honda')).toBeUndefined()
  })

  it('a MISSING KEY inside a present dimension is zero', () => {
    // brand/model values are data-driven and NOT zero-seeded (see FacetCounts), so a brand the
    // rail renders and the current filters exclude simply has no key — and it must read 0.
    const dim = { all: 40, values: { honda: 12 } }
    expect(optionCount(dim, 'honda')).toBe(12)
    expect(optionCount(dim, 'yamaha')).toBe(0)
  })

  it('an explicit zero survives — it is not confused with absence', () => {
    expect(optionCount({ all: 5, values: { scooter: 0 } }, 'scooter')).toBe(0)
  })

  it('indexes into values and does not care what else is in there', () => {
    // The rail is rendered from the taxonomy and indexes into this; the payload honestly reports
    // legacy values the taxonomy no longer offers, and those must not be able to grow a chip.
    const dim = { all: 9, values: { car: 4, 'legacy-rent-row': 5 } }
    expect(optionCount(dim, 'car')).toBe(4)
    expect(Object.keys(dim.values)).toContain('legacy-rent-row') // present in the lookup…
    expect(optionCount(dim, 'motorbike')).toBe(0) // …and a taxonomy slug it lacks still reads 0
  })
})

describe('<CountChip> — what renders, and what a screen reader hears', () => {
  it('renders nothing for an absent count, and something for a zero', () => {
    const { container, unmount } = renderIn('en', <CountChip count={undefined} />)
    expect(container.textContent).toBe('')
    unmount()

    const zero = renderIn('en', <CountChip count={0} />)
    expect(zero.container.textContent).toContain('0')
  })

  it('null is absence too (an unwired prop must not print a zero)', () => {
    const { container } = renderIn('en', <CountChip count={null} />)
    expect(container.textContent).toBe('')
  })

  it('"Honda 412" is announced as "Honda, 412 listings", not as a model designation', () => {
    // ⚠️ THE POINT OF THE a11y TREATMENT. A bare number appended to a label is concatenated into
    // the button's accessible name, so the tile would announce "Honda 412" — a perfectly
    // plausible model number. The digits are aria-hidden and the unit is named instead.
    renderIn(
      'en',
      <button type="button">
        {BRAND}
        <CountChip count={412} />
      </button>,
    )
    // Regex, not an exact string: the accessible-name algorithm inserts whitespace at element
    // boundaries, and this test is about the WORDS, not about where the spaces land.
    expect(screen.getByRole('button', { name: /Honda\s*,\s*412 listings/ })).toBeTruthy()
  })

  it('the visible digits are hidden from the accessible name, so the number is not said twice', () => {
    const { container } = renderIn('en', <CountChip count={412} />)
    const hidden = container.querySelector('[aria-hidden="true"]')
    expect(hidden?.textContent).toBe('412')
    // The spoken half is a separate node — remove the aria-hidden one and the phrase survives.
    expect(container.textContent).toContain('412 listings')
  })

  it('a Vietnamese viewer hears the dot-grouped figure and the uninflected noun', async () => {
    renderIn(
      'vi',
      <button type="button">
        {BRAND}
        <CountChip count={2418} />
      </button>,
    )
    // The provider switches language in an effect, so the vi text appears on the next paint.
    const btn = await screen.findByRole('button', { name: /Honda\s*,\s*2\.418 tin đăng/ }, WAIT)
    expect(btn).toBeTruthy()
    // And the SEEN number is the dot-grouped one, not the comma-grouped one.
    expect(btn.querySelector('[aria-hidden="true"]')?.textContent).toBe('2.418')
  })

  it('spacing belongs to the caller, type and colour do not', () => {
    // The className lands on the VISIBLE span (a className on a render-child is concatenated, not
    // merged — the override that must win has to ride the element that carries the base classes).
    const { container } = renderIn('en', <CountChip count={7} className="ml-1 shrink-0" />)
    const visible = container.querySelector('[aria-hidden="true"]')!
    expect(visible.className).toContain('ml-1')
    expect(visible.className).toContain('shrink-0')
    // One type ramp and one colour for every rail — this is what stops the four call sites drifting.
    expect(visible.className).toContain('text-3xs')
    expect(visible.className).toContain('text-ink-4')
  })
})

describe('railDimension — telling a stale payload from a genuinely empty one', () => {
  const keys = ['apple', 'samsung']

  it('an absent dimension stays absent', () => {
    expect(railDimension(undefined, keys)).toBeUndefined()
  })

  it('a dimension that shares a key with the rendered options is used', () => {
    const dim = { all: 40, values: { apple: 12 } }
    expect(railDimension(dim, keys)).toBe(dim)
  })

  it('a dimension reporting results but sharing NO key is an answer to another question', () => {
    // The Vehicles payload held across a tap into Electronics. Every Electronics option misses,
    // and a miss inside a present dimension is a legitimate 0 — so without this the rail would
    // print "Apple 0 / Samsung 0" over a full catalogue until the feed answered.
    expect(railDimension({ all: 40, values: { honda: 12, yamaha: 28 } }, keys)).toBeUndefined()
  })

  it('an honest zero survives, because a SEEDED dimension still carries its keys', () => {
    // "Nothing matches these filters" is the answer the chip counts exist to give, and the
    // dimensions that can give it (subcategory, category, condition, type…) are zero-seeded — so
    // an empty result still carries every option key and passes on the key test alone.
    const emptyButSeeded = { all: 0, values: { apple: 0, samsung: 0 } }
    expect(railDimension(emptyButSeeded, keys)).toBe(emptyButSeeded)
  })

  it('⚠️ an EMPTY dimension is not thereby FRESH — the regression all three reviewers caught', () => {
    // The highest-frequency transition of all: filter until nothing matches, then tap a different
    // category *because* it showed nothing. The held payload is stale AND empty. An earlier
    // version short-circuited on `all <= 0` and returned it, after which every key in the new
    // category missed and every chip read a confident 0 over a full catalogue.
    expect(railDimension({ all: 0, values: {} }, keys)).toBeUndefined()
    expect(railDimension({ all: 0, values: { honda: 0, yamaha: 0 } }, keys)).toBeUndefined()
  })

  it('with no options to check against it cannot judge, and cannot-judge means no numbers', () => {
    // Fails CLOSED. Both rails happen to nest their "All" chip inside the same guard that hides
    // the options, so today nothing would render — but that is a fact about their layout, not
    // about this function, and an "All" chip that moved outside the guard would start advertising
    // a stale total.
    expect(railDimension({ all: 3, values: { honda: 3 } }, [])).toBeUndefined()
  })

  it('reads the lookup table through its OWN keys, not through the prototype', () => {
    // `values` comes from Object.fromEntries, so it carries Object.prototype: a bare index on
    // 'constructor' returns a function, which is neither a count nor caught by `??`.
    const dim = { all: 5, values: { honda: 5 } }
    expect(railDimension(dim, ['constructor', 'toString'])).toBeUndefined()
    expect(optionCount(dim, 'constructor')).toBe(0)
  })

  it('⚠️ PINS THE LIMIT: partial overlap passes, so the caller still has to invalidate', () => {
    // Vehicles/Motorbike → Vehicles/Car refetches the car brands while the held payload is
    // motorbike-keyed. They share Honda, so this passes and Toyota reads 0 until the feed answers.
    // Tightening to "every rendered key must be present" is NOT available: a fresh brand payload
    // legitimately omits any brand with no matches. The real fix is the caller dropping `facets`
    // when its filter signature changes — this test exists so that limit is recorded rather than
    // rediscovered, and so a future stricter rule has something to change deliberately.
    const stale = { all: 60, values: { honda: 20, yamaha: 40 } }
    expect(railDimension(stale, ['toyota', 'mazda', 'honda'])).toBe(stale)
  })
})

/**
 * THE RAILS THEMSELVES.
 *
 * ⚠️ THEY LIVE IN THIS FILE ON PURPOSE. <CountChip> is only worth anything at its call sites, and
 * the failures that matter — a stale payload printing zeros, a rail losing the numbers it has
 * today — are invisible from a unit test of the helper. This is the test file this stream owns, so
 * the call-site coverage rides here rather than not existing.
 */
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * ⚠️ THE HARNESS PUTS THE GLOBALS BACK. Both rails need three things jsdom does not provide, and
 * the first draft installed them and walked away — `globalThis.fetch`, `ResizeObserver` and
 * `HTMLElement.prototype.scrollTo` stayed overwritten for every test that ran after, including the
 * pure-helper ones above. Vitest isolates per FILE, not per test, so a leak like this is invisible
 * until something in the same file quietly depends on a stub. Restore what was there.
 */
type Globals = { fetch?: unknown; ResizeObserver?: unknown }
const saved: { fetch?: unknown; ro?: unknown; scrollTo?: unknown } = {}
function installRailGlobals(fetchImpl?: unknown) {
  const g = globalThis as Globals
  saved.fetch = g.fetch
  saved.ro = g.ResizeObserver
  saved.scrollTo = HTMLElement.prototype.scrollTo
  g.ResizeObserver = TestResizeObserver
  HTMLElement.prototype.scrollTo = () => {}
  if (fetchImpl) g.fetch = fetchImpl
}
function restoreRailGlobals() {
  const g = globalThis as Globals
  g.fetch = saved.fetch
  g.ResizeObserver = saved.ro
  HTMLElement.prototype.scrollTo = saved.scrollTo as typeof HTMLElement.prototype.scrollTo
}

const CATS = [
  { id: '1', slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ', icon: 'Car' },
  { id: '2', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone' },
] as unknown as React.ComponentProps<typeof CategoryRail>['categories']

describe('<CategoryRail> — counts at the call site', () => {
  beforeEach(() => installRailGlobals())
  afterEach(restoreRailGlobals)

  it('puts a count on every tile, on "All", and an honest 0 on an empty subcategory', () => {
    renderIn(
      'en',
      <CategoryRail
        categories={CATS}
        activeCategory="vehicles"
        activeSubcategory="all"
        subcategoryCounts={{ motorbike: 12 }}
        facets={{
          category: { all: 2418, values: { vehicles: 40, electronics: 9 } },
          subcategory: { all: 40, values: { motorbike: 12, car: 0, bicycle: 0, 'ebike-scooter': 0, 'parts-gear': 0, 'vehicle-other': 0 } },
        }}
        onCategory={() => {}}
        onSubcategory={() => {}}
      />,
    )
    // The rail's own "All" tile is the released dimension, not a sum of the tiles beside it.
    expect(screen.getByRole('button', { name: /^All\s*,\s*2,418 listings$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Vehicles\s*,\s*40 listings/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Electronics\s*,\s*9 listings/ })).toBeTruthy()
    // The subcategory grid's own "All" — same number as the category tile, different question.
    expect(screen.getAllByRole('button', { name: /All\s*,\s*40 listings/ }).length).toBe(1)
    expect(screen.getByRole('button', { name: /Motorbike\s*,\s*12 listings/ })).toBeTruthy()
    // ⚠️ A ZERO IS INFORMATION: the chip stays, carrying its 0, rather than vanishing.
    expect(screen.getByRole('button', { name: /Car\s*,\s*0 listings/ })).toBeTruthy()
  })

  it('a payload from the PREVIOUS category does not become a grid of zeros', () => {
    // The state the rail is in for as long as the feed takes to answer a category tap. The held
    // payload is seeded for Electronics; the open category is Vehicles.
    renderIn(
      'en',
      <CategoryRail
        categories={CATS}
        activeCategory="vehicles"
        activeSubcategory="all"
        subcategoryCounts={{}}
        facets={{
          category: { all: 2418, values: { vehicles: 40, electronics: 9 } },
          subcategory: { all: 9, values: { 'phones-tablets': 4, laptops: 0, audio: 5 } },
        }}
        onCategory={() => {}}
        onSubcategory={() => {}}
      />,
    )
    // The subcategory chips carry no number at all — the pre-counts appearance…
    expect(screen.getByRole('button', { name: /^Motorbike$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Motorbike\s*,\s*0 listings/ })).toBeNull()
    // …while the CATEGORY tiles keep theirs, because that dimension releases the whole category
    // cascade and therefore reads the same before and after the tap.
    expect(screen.getByRole('button', { name: /Vehicles\s*,\s*40 listings/ })).toBeTruthy()
  })

  it('a payload that is stale AND empty does not zero the grid either', () => {
    // Filter Electronics down to nothing, then tap Vehicles because it showed nothing. The held
    // payload has all: 0 — which is not evidence that it describes Vehicles.
    renderIn(
      'en',
      <CategoryRail
        categories={CATS}
        activeCategory="vehicles"
        activeSubcategory="all"
        subcategoryCounts={{}}
        facets={{ category: { all: 0, values: {} }, subcategory: { all: 0, values: { 'phones-tablets': 0, audio: 0 } } }}
        onCategory={() => {}}
        onSubcategory={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /^Motorbike$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Motorbike\s*,\s*0 listings/ })).toBeNull()
  })

  it('with no facets at all it renders exactly the rail it rendered before counts existed', () => {
    renderIn(
      'en',
      <CategoryRail
        categories={CATS}
        activeCategory="vehicles"
        activeSubcategory="all"
        subcategoryCounts={{ motorbike: 12 }}
        onCategory={() => {}}
        onSubcategory={() => {}}
      />,
    )
    // The legacy key still puts its number on the chip it has always put it on…
    expect(screen.getByRole('button', { name: /Motorbike\s*,\s*12 listings/ })).toBeTruthy()
    // …and nothing else grew one.
    expect(screen.getByRole('button', { name: /^Vehicles$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Car$/ })).toBeTruthy()
  })
})

describe('<BrandRail> — counts at the call site', () => {
  beforeEach(() => {
    installRailGlobals(
      vi.fn(async (url: string) =>
        String(url).includes('/models')
          ? { json: async () => ({ models: [{ model: 'Vision', count: 30 }, { model: 'Wave', count: 5 }] }) }
          : { json: async () => ({ brands: [{ slug: 'honda', name: 'Honda', count: 50, iconPath: null }, { slug: 'yamaha', name: 'Yamaha', count: 20, iconPath: null }] }) },
      ),
    )
  })
  afterEach(restoreRailGlobals)

  it('shows the CONDITIONAL count on brands and models, and 0 where the filters exclude one', async () => {
    renderIn(
      'en',
      <BrandRail
        category="vehicles"
        subcategory="all"
        activeBrand="honda"
        activeModel="all"
        facets={{ brand: { all: 40, values: { honda: 12 } }, model: { all: 12, values: { Vision: 7 } } }}
        onPickBrand={() => {}}
        onPickModel={() => {}}
      />,
    )
    await screen.findByRole('button', { name: /Honda\s*,\s*12 listings/ }, WAIT)
    // Yamaha is missing from a PRESENT dimension → 0, not "no number". The rail is warning that
    // this tap dead-ends under the current filters.
    expect(screen.getByRole('button', { name: /Yamaha\s*,\s*0 listings/ })).toBeTruthy()
    // The model rail's own "All": the chosen brand's total, not a sum of the model chips.
    expect(screen.getByRole('button', { name: /All\s*,\s*12 listings/ })).toBeTruthy()
    // 7, not the 30 /api/brands reports — the directory count answers a different question.
    expect(screen.getByRole('button', { name: /Vision\s*,\s*7 listings/ })).toBeTruthy()
    // Wave is missing from a present dimension: an honest 0, which is the dead-end warning the
    // whole feature exists to give at tap four.
    expect(screen.getByRole('button', { name: /Wave\s*,\s*0 listings/ })).toBeTruthy()
  })

  it('a payload from another category does not zero the tiles', async () => {
    renderIn(
      'en',
      <BrandRail
        category="vehicles"
        subcategory="all"
        activeBrand="honda"
        activeModel="all"
        facets={{ brand: { all: 30, values: { apple: 12, samsung: 18 } }, model: { all: 30, values: { 'iPhone 15': 12 } } }}
        onPickBrand={() => {}}
        onPickModel={() => {}}
      />,
    )
    await screen.findByText('Honda', undefined, WAIT)
    // Nothing on the rail grew a number: not the tiles, and not the model chips either — the
    // /api/brands directory figure is no longer used as a fallback, precisely so a suppressed
    // dimension cannot put an UNCONDITIONAL number beside a conditional one in the same type.
    expect(screen.queryByRole('button', { name: /Honda\s*,/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Vision$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Vision\s*,\s*30 listings/ })).toBeNull()
  })

  it('⚠️ the model grid CUTS on the number it shows, so the one live option is never buried', async () => {
    // A rail that cuts must cut on the number it displays. Ten models, and the only one with
    // matches under the current filters sits at directory rank 9 — ranking the 3×3 grid on the
    // directory count would fold it into "+N" and leave the brand reading as empty.
    ;(globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string) =>
      String(url).includes('/models')
        ? {
            json: async () => ({
              models: Array.from({ length: 10 }, (_, i) => ({ model: `M${i}`, count: 100 - i })),
            }),
          }
        : { json: async () => ({ brands: [{ slug: 'honda', name: 'Honda', count: 50, iconPath: null }] }) },
    )
    renderIn(
      'en',
      <BrandRail
        category="vehicles"
        subcategory="all"
        activeBrand="honda"
        activeModel="all"
        facets={{ brand: { all: 6, values: { honda: 6 } }, model: { all: 6, values: { M8: 6 } } }}
        onPickBrand={() => {}}
        onPickModel={() => {}}
      />,
    )
    // M8 is directory-rank 9 of 10 and would sit inside "More" on the old ordering.
    await screen.findByRole('button', { name: /M8\s*,\s*6 listings/ }, WAIT)
    // …and the seven zero-count models it displaced are the ones now folded away.
    expect(screen.queryByRole('button', { name: /M6\s*,/ })).toBeNull()
  })

  it('⚠️ a brand filtered to zero results must not advertise the unfiltered figure', async () => {
    // The state that killed the `?? m.count` fallback. `facets.model` comes back empty, which is
    // indistinguishable from a stale payload, so the dimension is suppressed — and the fallback
    // would then have shown "Vision 30" over zero results while "All" beside it showed nothing.
    renderIn(
      'en',
      <BrandRail
        category="vehicles"
        subcategory="all"
        activeBrand="honda"
        activeModel="all"
        facets={{ brand: { all: 0, values: {} }, model: { all: 0, values: {} } }}
        onPickBrand={() => {}}
        onPickModel={() => {}}
      />,
    )
    await screen.findByText('Vision', undefined, WAIT)
    expect(screen.queryByRole('button', { name: /listings/ })).toBeNull()
  })

  it('an UNWIRED caller keeps the exact rail it has today — omitting the prop is not the same as {}', async () => {
    // ⚠️ THE MIGRATION SEAM. The explorer is wired in a separate commit, and until it is, a caller
    // that has never heard of counts must not silently LOSE the model numbers it has always shown.
    // Omitting the prop keeps them; passing `{}` — a caller that knows about counts and has none —
    // does not, because that caller could otherwise be shown an unconditional figure beside
    // conditional ones. The two states are asserted together so neither can drift into the other.
    const unwired = renderIn(
      'en',
      <BrandRail category="vehicles" subcategory="all" activeBrand="honda" activeModel="all" onPickBrand={() => {}} onPickModel={() => {}} />,
    )
    await screen.findByRole('button', { name: /Vision\s*,\s*30 listings/ }, WAIT)
    expect(screen.getByRole('button', { name: /Wave\s*,\s*5 listings/ })).toBeTruthy()
    // A brand tile has never carried a number and still does not.
    expect(screen.queryByRole('button', { name: /Honda\s*,/ })).toBeNull()
    unwired.unmount()

    renderIn(
      'en',
      <BrandRail category="vehicles" subcategory="all" activeBrand="honda" activeModel="all" facets={{}} onPickBrand={() => {}} onPickModel={() => {}} />,
    )
    await screen.findByText('Vision', undefined, WAIT)
    expect(screen.queryByRole('button', { name: /listings/ })).toBeNull()
  })
})
