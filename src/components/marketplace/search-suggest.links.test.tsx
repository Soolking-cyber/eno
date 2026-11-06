// @vitest-environment jsdom
/**
 * ⛔ A SUGGESTION THAT GOES SOMEWHERE IS A REAL LINK (owner, 2026-11-07: "on desktop clicking right and opening in new
 * tab doesnt work"). The rows were buttons picked on mousedown, and the pick ran for ANY button: a right-click on a row
 * opened it in place, under the menu. Pinned here:
 *   · with `hrefFor`, a row is an <a href> that keeps role="option" and stays out of the tab order;
 *   · a primary, unmodified press picks (once), and the link's own click after it is prevented and picks nothing more;
 *   · a click with no press before it (assistive tech) picks once; a press already prevented above still picks;
 *   · a right or middle press never picks; on a link row a Cmd/Ctrl/Shift press does not either, and its click is
 *     left to the browser (new tab or window);
 *   · the "Search for" row has no href and stays a button; a right press there no longer runs the search.
 * ⚠️ EXPLICIT `cleanup` — no vitest globals here (zero-results.test.tsx explains).
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { SearchSuggest, buildSuggestItems, type SuggestItem } from './search-suggest'

afterEach(cleanup)

const hrefFor = (it: SuggestItem) => (it.type === 'category' ? `/c/${it.slug}` : it.type === 'brand' ? `/?brand=${it.slug}` : null)

function renderPanel() {
  const onPick = vi.fn()
  const onSubmitQuery = vi.fn()
  render(
    <LanguageProvider>
      <SearchSuggest
        items={buildSuggestItems('sam', [{ slug: 'samsung', name: 'Samsung' }], [{ slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }], [])}
        loading={false}
        query="sam"
        activeIndex={-1}
        listboxId="t"
        onPick={onPick}
        onSubmitQuery={onSubmitQuery}
        hrefFor={hrefFor}
      />
    </LanguageProvider>,
  )
  const brand = screen.getAllByRole('option').find((o) => o.textContent?.includes('Samsung'))!
  const query = screen.getAllByRole('option')[0]
  return { onPick, onSubmitQuery, brand, query }
}

describe('typeahead rows that go somewhere are links', () => {
  it('a row with an href is an <a href>, still an option, out of the tab order', () => {
    const { brand, query } = renderPanel()
    expect(brand.tagName).toBe('A')
    expect(brand.getAttribute('href')).toBe('/?brand=samsung')
    expect(brand.getAttribute('role')).toBe('option')
    expect(brand.tabIndex).toBe(-1)
    // The "Search for" row has nowhere of its own to go: still a button.
    expect(query.tagName).toBe('BUTTON')
  })

  it('a primary press picks once; the link click after it is prevented', () => {
    const { onPick, brand } = renderPanel()
    fireEvent.mouseDown(brand, { button: 0 })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toMatchObject({ type: 'brand', slug: 'samsung' })
    expect(fireEvent.click(brand, { button: 0 })).toBe(false) // false = prevented
    expect(onPick).toHaveBeenCalledTimes(1) // the click after a press that picked does not pick again
  })

  it.each([['right', 2], ['middle', 1]])('a %s press never picks', (_n, button) => {
    const { onPick, onSubmitQuery, brand, query } = renderPanel()
    fireEvent.mouseDown(brand, { button })
    fireEvent.mouseDown(query, { button })
    expect(onPick).not.toHaveBeenCalled()
    expect(onSubmitQuery).not.toHaveBeenCalled()
  })

  it.each([[{ metaKey: true }], [{ ctrlKey: true }], [{ shiftKey: true }]])('a modified press %j on a link row is the browser\'s: no pick, click not prevented', (mod) => {
    const { onPick, brand } = renderPanel()
    fireEvent.mouseDown(brand, { button: 0, ...mod })
    expect(onPick).not.toHaveBeenCalled()
    const seen: boolean[] = []
    const on = (e: Event) => { seen.push(e.defaultPrevented); e.preventDefault() }
    document.addEventListener('click', on)
    fireEvent.click(brand, { button: 0, ...mod })
    document.removeEventListener('click', on)
    expect(seen).toEqual([false])
  })

  it('a click with no press before it (assistive tech) picks once, on link rows and the query row', () => {
    const { onPick, onSubmitQuery, brand, query } = renderPanel()
    expect(fireEvent.click(brand, { button: 0 })).toBe(false)
    fireEvent.click(query, { button: 0 })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onSubmitQuery).toHaveBeenCalledTimes(1)
  })

  it('a press released off the row is forgotten: a later click with no press still picks', () => {
    const { onPick, brand } = renderPanel()
    fireEvent.mouseDown(brand, { button: 0 })
    fireEvent.mouseLeave(brand)
    fireEvent.click(brand, { button: 0 })
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('a press that something above already prevented still picks', () => {
    const { onPick, brand } = renderPanel()
    const keepFocus = (e: Event) => e.preventDefault()
    document.addEventListener('mousedown', keepFocus, true)
    fireEvent.mouseDown(brand, { button: 0 })
    document.removeEventListener('mousedown', keepFocus, true)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('the press keeps the input focused (mousedown is prevented), on links and buttons alike', () => {
    const { brand, query } = renderPanel()
    expect(fireEvent.mouseDown(brand, { button: 0 })).toBe(false)
    expect(fireEvent.mouseDown(query, { button: 2 })).toBe(false)
  })
})
