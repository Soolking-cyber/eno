// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { SearchSuggest, buildSuggestItems } from './search-suggest'

/**
 * ⛔ S-BRANDCHIP (measured headless on production, 2026-09-29): typing "sam" rendered the brand chip
 * as "Sam sung" — innerText "Sam\nsung" — and "ren" the category chip as "Ren tals". <Highlight>
 * returns a fragment [text, <span bold>, text], and inside a flex chip every piece is its own flex item
 * with the gap between them. The fix wraps the highlight in ONE span, so the chip holds no loose text.
 * jsdom has no layout (innerText is not implemented), so the structure is what this pins: no option
 * except the query row may have a non-whitespace text node as a DIRECT child.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals here (zero-results.test.tsx explains).
 */
afterEach(cleanup)

const renderPanel = (query: string) =>
  render(
    <LanguageProvider>
      <SearchSuggest
        items={buildSuggestItems(query, [{ slug: 'samsung', name: 'Samsung' }], [{ slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }], [])}
        loading={false}
        query={query}
        activeIndex={-1}
        listboxId="t"
        onPick={() => {}}
        onSubmitQuery={() => {}}
      />
    </LanguageProvider>,
  )

const looseText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim())

describe('typeahead chips keep their words whole', () => {
  it.each([['sam', 'Samsung'], ['ren', 'Rentals']])('typing %j: every chip option wraps its highlighted name in one span', (q, name) => {
    renderPanel(q)
    const options = screen.getAllByRole('option')
    for (const opt of options.slice(1)) expect(looseText(opt)).toHaveLength(0)
    const chip = options.find((o) => o.textContent === name)!
    expect(chip).toBeTruthy()
    const wrap = [...chip.children].find((c) => c.tagName === 'SPAN')!
    expect(wrap.textContent).toBe(name)
    // The bold part is INSIDE the wrapper, not a sibling flex item.
    expect(wrap.querySelector('.font-bold')?.textContent?.toLowerCase()).toBe(q)
  })
})

/**
 * ⛔ THE ENTITY ROWS (S-TYPEAHEAD, 2026-09-29) sit between the query row and the brand chips, and the
 * flat option indices must stay contiguous across them — `aria-activedescendant` and the arrow keys
 * are both expressed in that one index (`suggestOptionId`).
 */
describe('product-line and scoped rows', () => {
  const listing = (id: string) => ({ id, title: `Row ${id}`, titleVi: null, price: 1, currency: 'VND', priceUnit: '', location: 'HCMC', image: null, categorySlug: 'electronics' })
  const line = { brand: 'apple', brandName: 'Apple', line: 'iPhone', category: 'electronics', count: 972 }
  const scope = { category: 'electronics', subcategory: 'phones-tablets', categoryName: 'Electronics', categoryNameVi: 'Điện tử', subName: 'Phones', subNameVi: 'Điện thoại', count: 1523 }

  it('order: query, lines, scope, brands, categories, listings — and never more than 9 options', () => {
    const items = buildSuggestItems('iph', [{ slug: 'b', name: 'B' }, { slug: 'c', name: 'C' }, { slug: 'd', name: 'D' }],
      [{ slug: 'x', name: 'X', nameVi: 'X' }, { slug: 'y', name: 'Y', nameVi: 'Y' }, { slug: 'z', name: 'Z', nameVi: 'Z' }],
      [1, 2, 3, 4, 5, 6].map((n) => listing(String(n))), [line, { ...line, line: 'iPhone SE', count: 3 }, { ...line, line: 'third' }], scope)
    expect(items.map((i) => i.type)).toEqual(['query', 'line', 'line', 'scope', 'brand', 'brand', 'category', 'category', 'listing'])
  })

  it('the hero bar (four arguments) gets exactly the items it always did', () => {
    const items = buildSuggestItems('iph', [], [], [listing('1')])
    expect(items.map((i) => i.type)).toEqual(['query', 'listing'])
  })

  it('renders with contiguous option ids, the count spoken as "972 listings", and hands the line to onPick', () => {
    const picked: unknown[] = []
    render(
      <LanguageProvider>
        <SearchSuggest
          // No listing rows: they render <Price>, which needs the currency provider and is not under test.
          items={buildSuggestItems('iph', [{ slug: 'apple', name: 'Apple' }], [{ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }], [], [line], scope)}
          loading={false}
          query="iph"
          activeIndex={1}
          listboxId="t"
          onPick={(it) => picked.push(it)}
          onSubmitQuery={() => {}}
        />
      </LanguageProvider>,
    )
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.id)).toEqual(['t-o0', 't-o1', 't-o2', 't-o3', 't-o4'])
    expect(options[1].textContent).toBe('iPhone · Apple972, 972 listings')
    expect(options[1].getAttribute('aria-selected')).toBe('true')
    expect(options[2].textContent).toBe('“iph” in Electronics › Phones1,523, 1,523 listings')
    // The visible digits are hidden from AT; the spoken form carries the unit.
    expect(options[1].querySelector('[aria-hidden="true"].tabular-nums')?.textContent).toBe('972')
    expect(screen.getByRole('group', { name: 'Product lines' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Search in' })).toBeTruthy()
    fireEvent.mouseDown(options[1])
    expect(picked).toEqual([{ type: 'line', ...line }])
  })

  /**
   * ⚠️ THE AISLE IS NAMED IN THE READER'S LANGUAGE, ALL NINE MACHINE-TRANSLATED ONES INCLUDED (review,
   * 2026-09-29): the row used to pick `…Vi` for Vietnamese and English for everyone else, so a French
   * reader saw a translated "dans" beside "Electronics › Phones". The names now go through tr(), like
   * every category chip: the curated glossary first, then machine translation.
   */
  // A stored choice keeps the provider's mount check from moving jsdom (an English device) back to
  // English — stubbed, because this vitest/jsdom pair has no working localStorage (footer.test.tsx does
  // the same). The empty dictionary stands in for the lazily loaded Vietnamese one.
  const scopeRow = (initialLang: 'vi' | 'fr') => {
    const store = new Map<string, string>([['lang', initialLang]])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    })
    return render(
      <LanguageProvider initialLang={initialLang} initialViDict={{}}>
        <SearchSuggest items={buildSuggestItems('iph', [], [], [], [], scope)} loading={false} query="iph" activeIndex={-1} listboxId="t" onPick={() => {}} onSubmitQuery={() => {}} />
      </LanguageProvider>,
    )
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('Vietnamese: the curated names, as before', () => {
    scopeRow('vi')
    expect(screen.getAllByRole('option')[1].textContent).toMatch(/^“iph” trong Điện tử › Điện thoại/)
  })

  it('a machine-translated language: the glossary name at once, the rest once its translation lands', async () => {
    const mt: Record<string, string> = { in: 'dans', Phones: 'Téléphones' }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const { texts } = JSON.parse(init.body) as { texts: string[] }
      return { ok: true, json: async () => ({ translations: texts.map((t) => mt[t] ?? t) }) }
    }))
    scopeRow('fr')
    // "Electronics" is in the curated glossary (glossary.ts), so it is French on the first paint.
    expect(screen.getAllByRole('option')[1].textContent).toContain('Électronique ›')
    await waitFor(() => expect(screen.getAllByRole('option')[1].textContent).toMatch(/^“iph” dans Électronique › Téléphones/))
  })
})
