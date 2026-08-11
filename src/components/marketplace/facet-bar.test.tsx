// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { FacetBar, allCount, chipCount, labelWithCount, railDimension, type FacetBarProps } from './facet-bar'
import type { FacetCounts } from '@/lib/facet-counts'

/**
 * LIVE CHIP COUNTS ON THE FACET BAR — the four things that are invisible in a screenshot:
 *
 *   1. ABSENT ≠ ZERO. `facets` is `{}` on a load-more page and with `?facets=0`; a rail that
 *      degraded to a row of zeros would state that every filter is empty.
 *   2. "All" IS `dim.all`, NOT THE SUM of the chips beside it — it counts the rows that fall in no
 *      bucket too, which is exactly what tapping it returns.
 *   3. THE CHIPS COME FROM THE TAXONOMY. `values` reports whatever the DATA carries, including
 *      values no category offers any more; indexing into it must never grow a chip.
 *   4. THE BAR'S OWN ROW DOES NOT WIDEN. That row is the horizontally-scrollable one coupled to the
 *      page gutter (`-mx-3 px-3`), and it clips at 390px — so the counts live in the menus and the
 *      panel, and this suite pins the row's text as payload-independent rather than measuring
 *      pixels jsdom does not have.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach. Without it the second render in the file fails with
 * "Found multiple elements". (Same note as result-line.test.tsx; any new component test needs it.)
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT localStorage — see the long note in
 * result-line.test.tsx: under this vitest/jsdom combination `window.localStorage` has no setItem,
 * so a storage-seeded "vi" test would silently have run in English.
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

/**
 * ⚠️ <CurrencyProvider> IS REQUIRED, NOT SCENERY. <PriceRangeFilter> is one of the bar's own pills
 * and calls useCurrency(), which THROWS outside the provider — the bar cannot render at all without
 * it. Its mount effect prefetches /api/fx, hence the stub below; nothing in this suite reads a rate.
 */
function renderIn(lang: 'en' | 'vi', ui: React.ReactNode) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>
        <LangSwitch to={lang} />
        {ui}
      </CurrencyProvider>
    </LanguageProvider>,
  )
}

// A relative URL is not fetchable in jsdom, and an unstubbed rejection here would surface as noise
// in an unrelated assertion. The bar's own fetches (histogram, /api/geo) are all gated on a popover
// being OPEN, so this only ever answers the currency provider's rate prefetch.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * `electronics` is the fixture category because it exercises every surface at once: two intents
 * (so the listing-type pill renders at all), a `condition` toggle group, seven subcategories, a
 * countless `warranty` toggle group and a `color` select.
 */
function props(over: Partial<FacetBarProps> = {}): FacetBarProps {
  return {
    activeCategory: 'electronics',
    activeSubcategory: 'all',
    setActiveSubcategory: vi.fn(),
    province: null,
    setProvince: vi.fn(),
    ward: null,
    setWard: vi.fn(),
    nearby: null,
    setNearby: vi.fn(),
    priceRange: 'all',
    setPriceRange: vi.fn(),
    conditionFilter: 'all',
    setConditionFilter: vi.fn(),
    listingType: 'all',
    setListingType: vi.fn(),
    customFilters: {},
    setCustomFilters: vi.fn(),
    verifiedOnly: true,
    setVerifiedOnly: vi.fn(),
    histogramQuery: 'category=electronics',
    ...over,
  }
}

/**
 * A payload shaped like the real one, and DEEP-FROZEN like the real one — `computeFacetCounts`
 * freezes what it memoizes, so any read path that sorted or assigned in place would throw here
 * instead of on production's second request.
 *
 * Three properties are deliberate:
 *   · `subcategory.all` (1200) is far larger than the sum of its buckets (899) — rows with no
 *     subcategorySlug are in "All" and in no chip.
 *   · `accessories` is MISSING from `values` although the taxonomy offers it → an honest 0.
 *   · `legacy-not-in-taxonomy` carries 99 → the payload reports it, the rail must not render it.
 */
const COUNTS: FacetCounts = Object.freeze({
  condition: Object.freeze({ all: 1200, values: Object.freeze({ new: 340, used: 860 }) }),
  type: Object.freeze({ all: 1200, values: Object.freeze({ sell: 1180, free: 20 }) }),
  subcategory: Object.freeze({
    all: 1200,
    values: Object.freeze({
      'phones-tablets': 500,
      'laptops-pcs': 300,
      'tv-monitors': 0,
      audio: 0,
      cameras: 0,
      gaming: 0,
      'legacy-not-in-taxonomy': 99,
    }),
  }),
}) as FacetCounts

/**
 * What a chip SHOWS, with the screen-reader-only phrase stripped.
 *
 * ⚠️ A CHIP NOW CARRIES TWO COUNTS: the compact one that is drawn ("1.2k", aria-hidden) and the
 * exact one that is announced (", 1,200 listings", `sr-only`). `textContent` returns BOTH glued
 * together, so every visible-text assertion has to say which one it means. jsdom applies no
 * stylesheet, so `sr-only` cannot be detected by computed style — the class is the marker.
 */
function shown(el: HTMLElement): string {
  return [...el.querySelectorAll('.sr-only')].reduce(
    (text, srOnly) => text.replace(srOnly.textContent ?? '', ''),
    el.textContent ?? '',
  )
}

/** Open the advanced "Filter" panel and hand back a scope to query inside it. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Filter/ }))
  return await screen.findByRole('dialog', { name: 'Filters' })
}

describe('chipCount / allCount — absent is NOT zero', () => {
  it('an absent dimension returns null so the rail renders countless', () => {
    // `{}` is what the API returns for offset > 0 and for ?facets=0, and a dimension the active
    // category has no rail for is simply missing. Both must read as "no count", never as 0.
    expect(chipCount(undefined, 'new')).toBeNull()
    expect(allCount(undefined)).toBeNull()
  })

  it('a PRESENT dimension with no key for this option is an honest 0', () => {
    const dim = { all: 10, values: { new: 4 } }
    expect(chipCount(dim, 'new')).toBe(4)
    expect(chipCount(dim, 'used')).toBe(0)
  })

  it('railDimension hands the rail nothing when the payload is about another rail', () => {
    const electronics = { all: 9, values: { 'phones-tablets': 5, audio: 4 } }
    // One key in common is enough — the server seeds every static rail with zeros, so a payload
    // that really is about this rail carries its keys even when they are all 0.
    expect(railDimension(electronics, ['phones-tablets', 'gaming'])).toBe(electronics)
    expect(railDimension(electronics, ['audio'])).toBe(electronics)
    // No key in common: this payload answers a different question. Countless, not zeros.
    expect(railDimension(electronics, ['womens', 'mens'])).toBeUndefined()
    expect(railDimension(electronics, [])).toBeUndefined()
    expect(railDimension(undefined, ['audio'])).toBeUndefined()
    // Returns the SAME object, never a copy — the payload is deep-frozen and shared.
    expect(railDimension(electronics, ['audio'])).toBe(electronics)
  })

  it('allCount reports `all` verbatim — never the sum of the buckets', () => {
    // 40 is bigger than 4 + 6 on purpose: rows in no bucket (condition null, no brand set) come
    // back under "All", so `all >= sum(values)` is the normal case, not a corrupt payload.
    expect(allCount({ all: 40, values: { new: 4, used: 6 } })).toBe(40)
  })

  it('treats a corrupt number as countless, NOT as zero', () => {
    // ⚠️ THE ASYMMETRY THIS PINS. A key that is PRESENT but is not a finite number can only come
    // from a malformed payload, and rendering it as 0 would say "nothing matches this filter" on a
    // chip that may have hundreds of results — the same false statement a row of zeros makes. The
    // two guards must agree: `allCount` already suppresses a non-finite `all`.
    const bad = { all: Number.NaN, values: { new: 'lots' as unknown as number } }
    expect(allCount(bad)).toBeNull()
    expect(chipCount(bad, 'new')).toBeNull()
    // A dimension with no `values` object at all is malformed too — every chip goes countless
    // rather than every chip claiming zero.
    expect(chipCount({ all: 1, values: undefined as unknown as Record<string, number> }, 'new')).toBeNull()
    // …but a key that is simply ABSENT is still the documented honest zero, not corruption.
    expect(chipCount({ all: 1, values: {} }, 'new')).toBe(0)
  })

  it('rejects a NEGATIVE count as corruption too', () => {
    // A count is a row count. -1 is finite, so a `Number.isFinite` guard alone would happily render
    // "Free · -1" on a live chip; both helpers must agree that the floor is 0. (codex, round 2.)
    expect(chipCount({ all: 5, values: { new: -1 } }, 'new')).toBeNull()
    expect(allCount({ all: -1, values: {} })).toBeNull()
    // Zero itself is a perfectly good count and must survive the same guard.
    expect(chipCount({ all: 0, values: { new: 0 } }, 'new')).toBe(0)
    expect(allCount({ all: 0, values: {} })).toBe(0)
  })
})

describe('labelWithCount — the string-option path', () => {
  it('leaves the label untouched when the count is null', () => {
    expect(labelWithCount('For sale', null, 'en')).toBe('For sale')
  })

  it('appends the count through the repo formatter, in the reader’s locale', () => {
    // formatCount is the repo's compact count formatter: 1200 → "1.2k" (en) / "1,2k" (vi).
    // Vietnamese uses a COMMA as the decimal mark, which is the whole reason this cannot be a
    // hand-rolled `${n}`.
    expect(labelWithCount('For sale', 1200, 'en')).toBe('For sale · 1.2k')
    expect(labelWithCount('Cần bán', 1200, 'vi')).toBe('Cần bán · 1,2k')
    expect(labelWithCount('Free', 0, 'en')).toBe('Free · 0')
  })
})

describe('<FacetBar> — the panel chips carry their counts', () => {
  it('puts a count on every condition chip and on the subcategory group’s All', async () => {
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    const panel = await openPanel(user)

    expect(shown(screen.getByRole('button', { name: /^New \/ Like new/ }))).toBe('New / Like new340')
    expect(shown(screen.getByRole('button', { name: /^Used/ }))).toBe('Used860')

    // …and what is ANNOUNCED is the exact figure with its noun, not the compact glyph. Measured:
    // accessible names concatenate inline text with no separator, hence the comma.
    expect(screen.getByRole('button', { name: 'Used, 860 listings' })).toBeDefined()

    // ⚠️ THE "All" CHIP IS `all`, NOT THE SUM. The buckets in this payload add up to 899 (and the
    // chips the taxonomy renders to 800); "All" is 1200 because 301 rows carry no subcategory and
    // tapping All returns them. If someone ever "fixes" this by summing, these three fail.
    const all = screen.getByRole('button', { name: /^All/, pressed: true })
    expect(shown(all)).toBe('All1.2k')
    expect(shown(all)).not.toContain('899')
    expect(shown(all)).not.toContain('800')
    // The spoken form is the UNROUNDED figure — "1.2k" would be read out as "one point two k".
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'All, 1,200 listings' })).toBeDefined()

    expect(panel.textContent).toContain('Phones')
  })

  it('renders the chips from the TAXONOMY and only indexes into `values`', async () => {
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    const panel = await openPanel(user)

    // A taxonomy chip the payload does not mention is an honest 0 — it must not vanish.
    expect(shown(screen.getByRole('button', { name: /^Accessories/ }))).toBe('Accessories0')

    // …and a value the payload DOES carry but the taxonomy does not offer grows no chip at all.
    // (The payload reports it honestly — a legacy row that chip would genuinely return — but which
    // chips exist is a product decision that lives in taxonomy.ts.)
    //
    // Scoped to the subcategory GROUP, not to the whole panel: a bare `not.toContain('99')` over a
    // panel whose option labels are full of digits ("64 GB", "27–32\"") is one taxonomy edit away
    // from a false pass or a false failure. This asks the only question that matters — did the rail
    // that indexes into `values` grow a chip from it — and pins the chip count while it is there.
    const group = screen.getByRole('group', { name: 'Type' })
    expect(group.textContent).not.toContain('legacy-not-in-taxonomy')
    expect(group.textContent).not.toContain('99')
    // 7 electronics subcategories + the group's own "All", and nothing the payload invented.
    expect(within(group).getAllByRole('button')).toHaveLength(8)
    // Plain DOM containment: this suite registers no jest-dom matchers (there is no vitest setup
    // file), so `toContainElement` would be undefined at runtime.
    expect(panel.contains(group)).toBe(true)
  })

  it('keeps the count readable on the SELECTED chip, which is a different colour', async () => {
    /**
     * ⚠️ THE STATE EVERY OTHER TEST IN THIS FILE MISSES, and a reviewer was right to say so: they
     * all render the released state ('all'), so the selected branch of <ChipCount> — the one that
     * has to survive `segBtn`'s `bg-primary text-white` fill — was never rendered. `text-ink-4` on
     * brand blue is unreadable, so the counter switches to `text-white/80` exactly here.
     */
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ conditionFilter: 'used', activeSubcategory: 'phones-tablets', facetCounts: COUNTS })} />)
    await openPanel(user)

    const used = screen.getByRole('button', { name: /^Used/ })
    expect(used.getAttribute('aria-pressed')).toBe('true')
    expect(shown(used)).toBe('Used860')
    expect(used.querySelector('[aria-hidden="true"]')?.className).toContain('text-white/80')

    // The unselected sibling keeps the muted ink, and its count is still there.
    const fresh = screen.getByRole('button', { name: /^New \/ Like new/ })
    expect(fresh.getAttribute('aria-pressed')).toBe('false')
    expect(fresh.querySelector('[aria-hidden="true"]')?.className).toContain('text-ink-4')

    // Same for the subcategory rail: the picked chip carries its own count, not the group's.
    const phones = screen.getByRole('button', { name: /^Phones/ })
    expect(phones.getAttribute('aria-pressed')).toBe('true')
    expect(shown(phones)).toBe('Phones500')
    expect(shown(screen.getByRole('button', { name: /^All/ }))).toBe('All1.2k')
  })

  it('leaves a facet with no counted dimension exactly as countless as it was', async () => {
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    await openPanel(user)

    // `warranty` is an attr_* facet src/lib/facet-counts.ts does not count. Showing 0 there would
    // claim, falsely, that nothing in the category is under warranty.
    expect(screen.getByRole('button', { name: 'In warranty' }).textContent).toBe('In warranty')
    expect(screen.getByRole('button', { name: 'No warranty' }).textContent).toBe('No warranty')
  })

  it('formats the counts for a Vietnamese reader (comma decimal, no plural)', async () => {
    const user = userEvent.setup()
    renderIn('vi', <FacetBar {...props({ facetCounts: COUNTS })} />)
    await user.click(await screen.findByRole('button', { name: /^Bộ lọc/ }))
    const panel = await screen.findByRole('dialog', { name: 'Bộ lọc' })

    expect(panel.textContent).toContain('1,2k')
    expect(panel.textContent).not.toContain('1.2k')
    expect(shown(screen.getByRole('button', { name: /^Đã dùng/ }))).toBe('Đã dùng860')
    // "tin đăng" for one listing and for 860 — Vietnamese takes no plural -s, which is exactly why
    // the spoken phrase goes through resultCountLabel instead of being built here.
    expect(screen.getByRole('button', { name: 'Đã dùng, 860 tin đăng' })).toBeDefined()
  })

  it('never writes to the deep-frozen payload', async () => {
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    await openPanel(user)
    // The fixture is frozen exactly as computeFacetCounts freezes its memo entry, so an in-place
    // sort/assign anywhere on the read path would already have thrown above. This pins the intent.
    expect(Object.isFrozen(COUNTS.subcategory)).toBe(true)
    expect(COUNTS.subcategory?.values['phones-tablets']).toBe(500)
  })
})

describe('<FacetBar> — degradation when the dimension is absent', () => {
  it('renders the panel IDENTICALLY for `{}` and for a payload of rails it does not draw', async () => {
    /**
     * The load-more / ?facets=0 case.
     *
     * ⚠️ THE BASELINE IS NOT `props()` WITH THE PROP OMITTED — that would be a tautology, because
     * `facetCounts = {}` is the default and the two renders would receive the identical value. A
     * reviewer caught exactly that. The meaningful baseline is a payload that is NON-empty but
     * carries only dimensions this component does not render (`brand` and `year` are real rails,
     * drawn elsewhere), which must produce the same countless panel as `{}`.
     */
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: {} })} />)
    const empty = (await openPanel(user)).textContent
    cleanup()

    const elsewhere = Object.freeze({
      brand: Object.freeze({ all: 77, values: Object.freeze({ honda: 41 }) }),
      year: Object.freeze({ all: 77, values: Object.freeze({ '2022-2027': 12 }) }),
    }) as FacetCounts
    renderIn('en', <FacetBar {...props({ facetCounts: elsewhere })} />)
    const none = (await openPanel(userEvent.setup())).textContent

    expect(empty).toBe(none)
    // …and neither rail leaked a number into the panel on the way past.
    expect(empty).not.toContain('77')
    expect(empty).not.toContain('41')
    // …and it really is countless: no bare digits on the chips (the option labels themselves carry
    // digits — "64 GB", "27–32"" — so this asks about the two groups that DO get counts).
    expect(empty).toContain('New / Like new')
    expect(empty).not.toMatch(/New \/ Like new\d/)
    expect(empty).not.toMatch(/All\d/)
  })

  it('degrades to countless when the payload belongs to the PREVIOUS category', async () => {
    /**
     * ⚠️ THE WINDOW WHERE THE HONEST-ZERO RULE INVERTS. The chips are drawn synchronously from
     * `activeCategory`; the counts arrive with the next feed response. Between the tap and that
     * response the panel is asking a Fashion rail about an Electronics payload — every key misses,
     * and without `railDimension()` every chip would render a confident `0`, stating that the whole
     * category is empty. Countless is the only honest answer while the payload is in flight.
     */
    const user = userEvent.setup()
    // `fashion-beauty` is the destination because it shares a `condition` facet with the fixture
    // category and shares NOT ONE subcategory slug with it — which is exactly the split being
    // tested: one rail is stale, the other is not.
    renderIn('en', <FacetBar {...props({ activeCategory: 'fashion-beauty', facetCounts: COUNTS })} />)
    await openPanel(user)

    const group = screen.getByRole('group', { name: 'Type' })
    expect(group.textContent).toContain('Women')
    // Not one digit on the rail — neither a bucket count nor the group's "All".
    expect(group.textContent).not.toMatch(/\d/)

    /**
     * ⚠️ AND HERE IS THE GUARD'S KNOWN LIMIT, PINNED RATHER THAN HIDDEN. `condition` is seeded
     * new/used in EVERY category, so its keys still match and the rail still renders — with
     * Electronics numbers on a Fashion panel until the next response lands. That is a stale count,
     * not a correct one; this assertion records the behaviour so nobody reads railDimension() as a
     * complete defence. It cannot be one: no key comparison can tell a right 860 from a stale 860.
     * Closing it needs a query identity the payload does not carry, which is why the `facetCounts`
     * prop doc puts that half of the contract on the producer. (opus, round 5.)
     */
    expect(shown(screen.getByRole('button', { name: /^Used/ }))).toBe('Used860')
  })

  it('shows counts for the dimensions it HAS and nothing for the ones it lacks', async () => {
    // A real partial payload: the route omits `subcategory` unless a category is selected, and
    // omits `year`/`brand` unless the category has that rail. One present dimension must not
    // fabricate the others.
    const user = userEvent.setup()
    const partial = Object.freeze({ condition: Object.freeze({ all: 12, values: Object.freeze({ new: 5, used: 7 }) }) }) as FacetCounts
    renderIn('en', <FacetBar {...props({ facetCounts: partial })} />)
    await openPanel(user)

    expect(shown(screen.getByRole('button', { name: /^New \/ Like new/ }))).toBe('New / Like new5')
    // The subcategory rail has no dimension in this payload → countless, not zeroed.
    expect(screen.getByRole('button', { name: 'Phones' }).textContent).toBe('Phones')
    expect(screen.getByRole('button', { name: 'All' }).textContent).toBe('All')
  })
})

describe('<FacetBar> — the scrollable chip row does not widen', () => {
  /**
   * ⚠️ THIS IS THE 390px TEST, and it is a text-identity test on purpose. jsdom has no layout, so
   * asking it for a width would return 0 and prove nothing. What actually has to hold is stronger
   * and checkable: the row that bleeds to the screen edges (`-mx-3 px-3`, `overflow-x-auto`) must
   * render the SAME TEXT whether or not counts arrived — then its measured width at any viewport,
   * 390px included, is unchanged by definition. The counts ride in the portaled menu and in the
   * Filter panel instead, neither of which is inside that row.
   */
  /**
   * The row itself, selected by the two classes that MAKE it that row: `overflow-x-auto` (it
   * scrolls) and `-mx-3` (it bleeds to the screen edges, coupled to the page gutter
   * `max-w-7xl px-3 sm:px-6 lg:px-8`). Selecting on them is deliberate — if either is ever
   * dropped, this test fails and points at the coupling that has to be re-thought.
   */
  function scrollRow(container: HTMLElement): HTMLElement {
    const row = container.querySelector<HTMLElement>('.overflow-x-auto')
    expect(row).not.toBeNull()
    expect(row!.className).toContain('-mx-3')
    return row!
  }

  /**
   * ⚠️ React's `useId` COUNTER, NOT THE MARKUP. Two renders in the same process get different ids
   * (`_r_4a_` vs `_r_4k_`) — the counter is per-root and advances across mounts, so it moves even
   * for two structurally identical trees. Measured: with the ids normalised the two rows below are
   * byte-identical; the ids were the ONLY difference. They are also the one thing in that markup
   * that provably cannot affect layout, which is what this comparison is about.
   */
  const stripIds = (html: string) => html.replace(/_r_[0-9a-z]+_/g, '_rID_')

  it('the ENTIRE row renders identical MARKUP with and without counts', () => {
    /**
     * Every count this component adds lives either in a portaled menu or in the Filter panel, so
     * the row that clips at 390px cannot gain a single glyph from the payload.
     *
     * ⚠️ innerHTML, NOT textContent — text equality alone would not settle this and a reviewer was
     * right to say so: identical text with a different class could still lay out differently.
     * Comparing the markup pins the classes and the element structure as well, which together with
     * one stylesheet is the whole input to layout. That is as close to a width measurement as this
     * environment can honestly get; jsdom computes no layout, so asking for a rect would return 0
     * and prove nothing — and it does NOT prove that the row is usable at 390px, only that this
     * feature cannot have changed it. See `stripIds` above for the one difference that is expected.
     */
    const bare = renderIn('en', <FacetBar {...props()} />)
    const before = stripIds(scrollRow(bare.container).innerHTML)
    cleanup()

    const counted = renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    expect(stripIds(scrollRow(counted.container).innerHTML)).toBe(before)
    // Guard against the comparison passing because both sides are empty.
    expect(before).toContain('Any type')
  })

  it('the listing-type pill reads the same with and without counts', () => {
    renderIn('en', <FacetBar {...props({ listingType: 'sell' })} />)
    const bare = screen.getByRole('combobox', { name: /Listing type/ }).textContent
    cleanup()

    renderIn('en', <FacetBar {...props({ listingType: 'sell', facetCounts: COUNTS })} />)
    const counted = screen.getByRole('combobox', { name: /Listing type/ }).textContent

    expect(counted).toBe(bare)
    expect(counted).toContain('For sale')
    // 1180 formats to "1.2k"; neither spelling may reach the trigger.
    expect(counted).not.toContain('1.2k')
    expect(counted).not.toContain('1180')
  })

  it('but the OPTIONS in its menu do carry them', async () => {
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...props({ facetCounts: COUNTS })} />)
    await user.click(screen.getByRole('combobox', { name: /Listing type/ }))

    const listbox = await screen.findByRole('listbox')
    // 1180 → "1.2k" through the repo's compact count formatter, not a hand-written number.
    expect(listbox.textContent).toContain('For sale · 1.2k')
    expect(listbox.textContent).toContain('Free · 20')
    // The group's own All row: `type.all`, not the sum of the two above.
    expect(listbox.textContent).toContain('Any type · 1.2k')
  })
})
