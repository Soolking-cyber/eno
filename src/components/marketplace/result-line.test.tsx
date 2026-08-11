// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { formatCount } from '@/lib/vnd'
import {
  ResultLine,
  removeFilterLabel,
  resultCountLabel,
  shouldOfferSaveSearch,
  type ResultFilter,
  type TrFn,
} from './result-line'

/**
 * THE RESULT LINE — the three things that are easy to get wrong and impossible to see from a
 * screenshot: the plural, the order, and what the ✕ is called.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach. Without this line the second render in the file fails with
 * "Found multiple elements". (Same note as chat-send-button.test.tsx; any new component test
 * needs it too.)
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT THROUGH localStorage — measured, not assumed.
 * The obvious harness is `localStorage.setItem('lang','vi')` before render, because that is the
 * key LanguageProvider's mount effect reads. It does not work here: under this vitest/jsdom
 * combination `window.localStorage` is a bare `{}` with no getItem/setItem/clear at all, so the
 * provider's own `safeGetItem` try/catch swallows the read and every "vi" test would silently
 * have run in English — a green suite proving nothing.
 *
 * ⚠️ AND THE HARNESS MUST NOT ASSERT THAT STORAGE IS BROKEN. An earlier draft pinned
 * `typeof localStorage.setItem === 'undefined'` to document the finding; a reviewer pointed out
 * that turns an environment limitation into a required invariant, so a jsdom/vitest bump would
 * fail CI for an app that got BETTER. Instead the switcher is mounted for BOTH languages and the
 * stored preference is cleared defensively, so this file behaves identically whether or not the
 * environment grows a real Storage. Driving `setLang` is also what a user actually does.
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

function wrap(lang: 'en' | 'vi', ui: React.ReactNode) {
  return (
    <LanguageProvider>
      <LangSwitch to={lang} />
      {ui}
    </LanguageProvider>
  )
}

function renderIn(lang: 'en' | 'vi', ui: React.ReactNode) {
  return render(wrap(lang, ui))
}

// Stand-in for the real tr() when testing the pure helpers: exactly the provider's contract —
// English source for en, the hand-authored Vietnamese for vi.
const trEn: TrFn = (en) => en
const trVi: TrFn = (en, vi) => vi ?? en

describe('resultCountLabel — the plural, and the number the plural is about', () => {
  it('English inflects the noun; Vietnamese does not', () => {
    expect(resultCountLabel(1, 'en', trEn)).toBe('1 listing')
    expect(resultCountLabel(2418, 'en', trEn)).toBe('2,418 listings')

    // ⚠️ THE POINT OF THE WHOLE HELPER. Vietnamese has no plural inflection — "tin đăng" is the
    // same word for one listing and for 2,418 — so the noun must be chosen PER LANGUAGE, never
    // by pluralising English and translating the result. If someone ever "fixes" this by
    // appending an -s (or a "các"), these two stop being equal and this test says so.
    const one = resultCountLabel(1, 'vi', trVi)
    const many = resultCountLabel(2418, 'vi', trVi)
    expect(one).toBe('1 tin đăng')
    expect(many).toBe('2.418 tin đăng')
    expect(one.replace(/^[\d.,]+ /, '')).toBe(many.replace(/^[\d.,]+ /, ''))
  })

  it('Vietnamese groups thousands with a DOT, English with a comma', () => {
    expect(resultCountLabel(12000000, 'en', trEn)).toBe('12,000,000 listings')
    expect(resultCountLabel(12000000, 'vi', trVi)).toBe('12.000.000 tin đăng')
    // GROUPING only: every non-Vietnamese language takes the international comma form, because
    // moneyLocale() narrows anything that is not 'vi' to 'en'. This says nothing about Russian
    // NOUN forms — ru needs three (1 / 2–4 / 5+) and this helper is binary; see the ⚠️ note on
    // resultCountLabel for why that gap is app-wide and deliberately not patched here.
    expect(resultCountLabel(2418, 'ru', trEn)).toBe('2,418 listings')
  })

  it('zero is plural; a fraction TRUNCATES and a nonsense count degrades to 0', () => {
    expect(resultCountLabel(0, 'en', trEn)).toBe('0 listings')
    // Truncation, not rounding and not rejection: a count is a row count, so 1.7 can only ever
    // arrive from a caller bug, and "1 listing" beside one visible card is the least wrong
    // thing to say. (Rounding would say "2 listings" over one card.)
    expect(resultCountLabel(1.7, 'en', trEn)).toBe('1 listing')
    expect(resultCountLabel(Number.NaN, 'en', trEn)).toBe('0 listings')
    expect(resultCountLabel(-5, 'en', trEn)).toBe('0 listings')
  })

  it('pins WHY the number does not go through formatCount', () => {
    // formatCount is the repo's COMPACT count formatter: it would render this line as
    // "2.4k listings" and throw away the exact figure the line exists to state.
    //
    // Asserted as a PROPERTY, not as the literal '2.4k'. Pinning another module's exact output
    // here would fail this file for a cosmetic change ('2.4K') that has nothing to do with the
    // decision — the same mistake the localStorage note in this file rejects. What matters is
    // only that formatCount is lossy for this count; if it ever becomes exact, this fails and
    // the choice should be revisited.
    expect(formatCount(2418)).not.toBe('2,418')
    expect(resultCountLabel(2418, 'en', trEn)).toBe('2,418 listings')
  })
})

describe('removeFilterLabel — the ✕ says WHAT it removes', () => {
  it('names the value in both languages', () => {
    expect(removeFilterLabel('Thảo Điền', trEn)).toBe('Remove Thảo Điền')
    expect(removeFilterLabel('Thảo Điền', trVi)).toBe('Bỏ Thảo Điền')
  })

  it('is never a bare verb', () => {
    // A row of five chips all called "Remove" is five identical undoable actions to a screen
    // reader. The label must carry the value.
    expect(removeFilterLabel('Honda', trEn)).not.toBe('Remove')
    expect(removeFilterLabel('Honda', trEn)).toContain('Honda')
  })
})

describe('shouldOfferSaveSearch', () => {
  it('offers from the SECOND filter tap on', () => {
    expect(shouldOfferSaveSearch(0)).toBe(false)
    expect(shouldOfferSaveSearch(1)).toBe(false)
    expect(shouldOfferSaveSearch(2)).toBe(true)
    expect(shouldOfferSaveSearch(5)).toBe(true)
  })
})

function chip(id: string, label: string, extra: Partial<ResultFilter> = {}): ResultFilter {
  return { id, label, onRemove: vi.fn(), ...extra }
}

describe('<ResultLine> chips', () => {
  it('renders one chip per active filter, IN THE ORDER THE USER PICKED THEM', () => {
    // Pick order: district, then brand, then price. Deliberately NOT alphabetical and NOT the
    // taxonomy's own order, so a sort/group-by-facet creeping in would change the answer.
    const picked = [chip('district', 'Thảo Điền'), chip('brand', 'Honda'), chip('price', 'Under 50tr')]
    // `onClearAll` is passed deliberately: "Clear all" and "Save search" are NOT list items, so
    // reading the row by listitem must return the chips and only the chips.
    const { rerender } = renderIn('en', <ResultLine count={12} filters={picked} onClearAll={vi.fn()} />)

    const names = () => screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(names()).toEqual(['Thảo Điền', 'Honda', 'Under 50tr'])

    // The user removes the district and adds a model: the row must re-read in the NEW pick
    // order, not keep a remembered position for the chips that survived.
    const next = [chip('brand', 'Honda'), chip('price', 'Under 50tr'), chip('model', 'Vision')]
    rerender(wrap('en', <ResultLine count={4} filters={next} />))
    expect(names()).toEqual(['Honda', 'Under 50tr', 'Vision'])
  })

  it('gives every ✕ its own accessible name naming that filter', () => {
    const picked = [chip('district', 'Thảo Điền'), chip('brand', 'Honda')]
    renderIn('en', <ResultLine count={12} filters={picked} />)

    expect(screen.getByRole('button', { name: 'Remove Thảo Điền' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Remove Honda' })).toBeDefined()
    // …and there is no second button called just "Remove" hiding behind them.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('translates the ✕ name and the count noun — not English-only chrome', async () => {
    renderIn('vi', <ResultLine count={2418} filters={[chip('district', 'Thảo Điền')]} />)
    expect(await screen.findByRole('button', { name: 'Bỏ Thảo Điền' })).toBeDefined()
    // Both halves of the switch, so the test cannot pass by rendering English and Vietnamese
    // names at once, and cannot pass with the language stuck at 'en'.
    expect(screen.queryByRole('button', { name: 'Remove Thảo Điền' })).toBeNull()
    expect(screen.getByText('2.418 tin đăng')).toBeDefined()
    expect(screen.queryByText('2,418 listings')).toBeNull()
  })

  it('the ✕ removes only its own filter', async () => {
    const user = userEvent.setup()
    const district = chip('district', 'Thảo Điền')
    const brand = chip('brand', 'Honda')
    renderIn('en', <ResultLine count={12} filters={[district, brand]} />)

    await user.click(screen.getByRole('button', { name: 'Remove Thảo Điền' }))
    expect(district.onRemove).toHaveBeenCalledTimes(1)
    expect(brand.onRemove).not.toHaveBeenCalled()
  })

  it('⚠️ tapping the LABEL does not remove the filter', async () => {
    // The regression both hand-rolled chip rows in listings-explorer.tsx still have: the whole
    // chip is the remove button, so reading the chip deletes the filter.
    const user = userEvent.setup()
    const district = chip('district', 'Thảo Điền')
    renderIn('en', <ResultLine count={12} filters={[district]} />)

    await user.click(screen.getByText('Thảo Điền'))
    expect(district.onRemove).not.toHaveBeenCalled()
  })

  it('the LABEL re-opens the filter when the caller supplies onReopen', async () => {
    const user = userEvent.setup()
    const onReopen = vi.fn()
    const district = chip('district', 'Thảo Điền', { onReopen })
    renderIn('en', <ResultLine count={12} filters={[district]} />)

    // The label control's accessible name is its visible text (WCAG 2.5.3), so the chip offers
    // exactly two clearly distinct names: "Thảo Điền" and "Remove Thảo Điền".
    await user.click(screen.getByRole('button', { name: 'Thảo Điền' }))
    expect(onReopen).toHaveBeenCalledTimes(1)
    expect(district.onRemove).not.toHaveBeenCalled()
  })

  it('the ✕ is type=button — a chip row inside a <form> must not submit it', () => {
    // Reviewer flag, checked rather than assumed: ui/icon-button defaults `type` to 'button'
    // and forwards it, so this holds without RemovableBadge restating it. Pinned here because
    // the failure (a filter removal reloading the page) only appears inside a form.
    renderIn('en', <ResultLine count={12} filters={[chip('district', 'Thảo Điền')]} />)
    const x = screen.getByRole('button', { name: 'Remove Thảo Điền' })
    expect(x.getAttribute('type')).toBe('button')
  })

  it('labels the ladder and the filter list as the two different things they are', () => {
    renderIn(
      'en',
      <ResultLine count={12} crumbs={[{ label: 'Vehicles' }]} filters={[chip('district', 'Thảo Điền')]} />,
    )
    // The nav is the CATEGORY path; the list is the FILTERS. Naming the nav "Filters applied"
    // (an earlier draft) left the real filter list unlabelled and mislabelled the taxonomy.
    expect(screen.getByRole('navigation', { name: 'Category' })).toBeDefined()
    expect(screen.getByRole('list', { name: 'Filters' })).toBeDefined()
  })
})

describe('<ResultLine> count, ladder and save-search', () => {
  it('states the count and names every tap in the ladder', () => {
    renderIn(
      'en',
      <ResultLine
        count={2418}
        crumbs={[{ label: 'Vehicles' }, { label: 'Manual' }, { label: 'Honda' }, { label: 'Vision' }]}
        filters={[]}
      />,
    )
    expect(screen.getByText('2,418 listings')).toBeDefined()
    const ladder = screen.getByRole('navigation')
    for (const rung of ['Vehicles', 'Manual', 'Honda', 'Vision']) {
      expect(within(ladder).getByText(rung)).toBeDefined()
    }
    // The rung you are standing on is the current page, not a link back to itself.
    expect(within(ladder).getByText('Vision').getAttribute('aria-current')).toBe('page')
  })

  it('a rung with onSelect climbs back down; the last rung never does', async () => {
    const user = userEvent.setup()
    const onVehicles = vi.fn()
    const onVision = vi.fn()
    renderIn(
      'en',
      <ResultLine
        count={12}
        crumbs={[{ label: 'Vehicles', onSelect: onVehicles }, { label: 'Vision', onSelect: onVision }]}
        filters={[]}
      />,
    )
    const ladder = screen.getByRole('navigation')
    // Proves the BreadcrumbLink render-prop composition actually produces a working control —
    // it is the one place here that leans on Base UI's useRender rather than plain JSX.
    await user.click(within(ladder).getByRole('button', { name: 'Vehicles' }))
    expect(onVehicles).toHaveBeenCalledTimes(1)

    expect(within(ladder).queryByRole('button', { name: 'Vision' })).toBeNull()
    await user.click(within(ladder).getByText('Vision'))
    expect(onVision).not.toHaveBeenCalled()
  })

  it('shows the save-search offer only when the CALLER says so, and never as a dialog', async () => {
    const user = userEvent.setup()
    const onSaveSearch = vi.fn()
    const filters = [chip('district', 'Thảo Điền'), chip('brand', 'Honda')]

    const { rerender } = renderIn('en', <ResultLine count={12} filters={filters} />)
    expect(screen.queryByRole('button', { name: 'Save search' })).toBeNull()

    rerender(wrap('en', <ResultLine count={12} filters={filters} showSaveSearch onSaveSearch={onSaveSearch} />))
    await user.click(screen.getByRole('button', { name: 'Save search' }))
    expect(onSaveSearch).toHaveBeenCalledTimes(1)
    // Inline, in the chip row — no dialog was opened by the primitive itself.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the caller can suppress the offer but cannot bring it forward past two filters', () => {
    const onSaveSearch = vi.fn()
    renderIn(
      'en',
      <ResultLine count={12} filters={[chip('district', 'Thảo Điền')]} showSaveSearch onSaveSearch={onSaveSearch} />,
    )
    // One filter is browsing. `showSaveSearch` is a veto, not an override.
    expect(screen.queryByRole('button', { name: 'Save search' })).toBeNull()
  })

  it('⚠️ removing a chip by KEYBOARD hands focus to the next ✕, not to <body>', async () => {
    const user = userEvent.setup()
    // A stateful harness, because the focus destination only exists after the parent really
    // drops the filter — a vi.fn() onRemove would leave the row unchanged and prove nothing.
    function Harness() {
      const [ids, setIds] = React.useState(['district', 'brand', 'price'])
      const labels: Record<string, string> = { district: 'Thảo Điền', brand: 'Honda', price: 'Under 50tr' }
      return (
        <ResultLine
          count={ids.length}
          filters={ids.map((id) => ({
            id,
            label: labels[id],
            onRemove: () => setIds((cur) => cur.filter((x) => x !== id)),
          }))}
        />
      )
    }
    renderIn('en', <Harness />)

    screen.getByRole('button', { name: 'Remove Honda' }).focus()
    await user.keyboard('{Enter}')

    // Honda is gone and focus sits on whatever took its place — "Under 50tr" — so a second
    // removal is one more keypress instead of a full re-traversal of the page.
    expect(screen.queryByRole('button', { name: 'Remove Honda' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Under 50tr' }))

    // Tail case: removing the LAST chip in the row falls back to the one before it.
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Thảo Điền' }))

    // And when the row empties there is no ✕ left, so focus lands on the count — the surviving
    // anchor, and the thing that just changed.
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('list', { name: 'Filters' })).toBeNull()
    expect(document.activeElement?.textContent).toBe('0 listings')
  })

  it('⚠️ survives an ASYNC removal — a re-render before the commit must not consume the intent', async () => {
    const user = userEvent.setup()
    // The shape three reviewers found and the synchronous harness above cannot see: the caller
    // removes by pushing a URL, so the chip is still in `filters` for one or more renders after
    // the click, AND the array identity is fresh every render (built inline). A naive
    // "fire on the next filters change" focuses the ✕ that is about to unmount, then focus
    // drops to <body>.
    function AsyncHarness() {
      const [ids, setIds] = React.useState(['district', 'brand', 'price'])
      const [pending, setPending] = React.useState<string | null>(null)
      const labels: Record<string, string> = { district: 'Thảo Điền', brand: 'Honda', price: 'Under 50tr' }
      return (
        <>
          {/* Stands in for the router transition landing. Driven with fireEvent, which does not
              move focus, so the only thing that can move it is the component under test. */}
          <button
            type="button"
            data-testid="commit"
            onClick={() => {
              if (pending) setIds((cur) => cur.filter((x) => x !== pending))
              setPending(null)
            }}
            aria-label="commit"
          />
          <ResultLine
            count={ids.length}
            filters={ids.map((id) => ({
              id,
              label: labels[id],
              // Deferred: the click only RECORDS the removal. `filters` still contains the chip
              // on the next render, exactly as it would while a URL push is in flight.
              onRemove: () => setPending(id),
            }))}
          />
        </>
      )
    }
    renderIn('en', <AsyncHarness />)

    const honda = screen.getByRole('button', { name: 'Remove Honda' })
    honda.focus()
    await user.keyboard('{Enter}')

    // The interleaved render: `filters` has a fresh identity and Honda is STILL there. The naive
    // version consumed the intent here and focused a ✕ that was about to unmount.
    expect(screen.getByRole('button', { name: 'Remove Honda' })).toBeDefined()
    expect(document.activeElement).toBe(honda)

    fireEvent.click(screen.getByTestId('commit'))

    expect(screen.queryByRole('button', { name: 'Remove Honda' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Under 50tr' }))
  })

  it('⚠️ reclaims focus from a router SEGMENT container, but yields to a real user choice', async () => {
    const user = userEvent.setup()
    function AsyncHarness({ parkOn }: { parkOn: 'segment' | 'control' }) {
      const [ids, setIds] = React.useState(['district', 'brand', 'price'])
      const [pending, setPending] = React.useState<string | null>(null)
      const labels: Record<string, string> = { district: 'Thảo Điền', brand: 'Honda', price: 'Under 50tr' }
      return (
        <>
          {/* App Router's focus-and-scroll parks focus on the changed segment root: a
              tabindex="-1" container, NOT <body>. Nobody chose it, so it is reclaimable. */}
          <div data-testid="segment" tabIndex={-1} />
          <button type="button" data-testid="elsewhere" aria-label="elsewhere" />
          <button
            type="button"
            data-testid="commit"
            onClick={() => {
              if (pending) setIds((cur) => cur.filter((x) => x !== pending))
              setPending(null)
            }}
            aria-label="commit"
          />
          <ResultLine
            count={ids.length}
            filters={ids.map((id) => ({
              id,
              label: labels[id],
              onRemove: () => {
                setPending(id)
                // Whatever ends up holding focus while the removal is in flight.
                screen.getByTestId(parkOn === 'segment' ? 'segment' : 'elsewhere').focus()
              },
            }))}
          />
        </>
      )
    }

    // A. Parked on the segment container → the restore still lands on the next ✕.
    renderIn('en', <AsyncHarness parkOn="segment" />)
    screen.getByRole('button', { name: 'Remove Honda' }).focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByTestId('segment'))
    fireEvent.click(screen.getByTestId('commit'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Under 50tr' }))
    cleanup()

    // B. The user tabbed/clicked into a real control while it was in flight → hands off.
    renderIn('en', <AsyncHarness parkOn="control" />)
    screen.getByRole('button', { name: 'Remove Honda' }).focus()
    await user.keyboard('{Enter}')
    fireEvent.click(screen.getByTestId('commit'))
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'))
  })

  it('⚠️ a TOUCH tap arms nothing — no delayed scroll jump back to the filter row', () => {
    // iOS Safari does not focus a <button> on tap, so activeElement stays <body>. fireEvent
    // reproduces that (userEvent always focuses, which is why the suite could not see it).
    // Nothing of ours held focus, so there is nothing to give back — and a later .focus() would
    // scroll the chip row into view under a user who has scrolled two screens down.
    function Harness() {
      const [ids, setIds] = React.useState(['district', 'brand'])
      const labels: Record<string, string> = { district: 'Thảo Điền', brand: 'Honda' }
      return (
        <ResultLine
          count={ids.length}
          filters={ids.map((id) => ({
            id,
            label: labels[id],
            onRemove: () => setIds((cur) => cur.filter((x) => x !== id)),
          }))}
        />
      )
    }
    renderIn('en', <Harness />)
    expect(document.activeElement).toBe(document.body)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Honda' }))

    expect(screen.queryByRole('button', { name: 'Remove Honda' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('does not steal focus when filters change for some OTHER reason', () => {
    const { rerender } = renderIn('en', <ResultLine count={9} filters={[chip('district', 'Thảo Điền')]} />)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    // A URL pop / facet panel / refetch replaces the array. Nothing of ours fired, so the ref
    // guard must leave focus alone.
    rerender(wrap('en', <ResultLine count={3} filters={[chip('brand', 'Honda')]} />))
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('a multi-select facet may re-use its id — the chip identity is id + label', async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // Two districts, both keyed by the facet. This is what a caller naturally produces, so it
      // must be SAFE — no warning, correct chips, and (below) a working focus restore.
      function Harness() {
        const [labels, setLabels] = React.useState(['Thảo Điền', 'Thủ Đức', 'Bình Thạnh'])
        return (
          <ResultLine
            count={labels.length}
            filters={labels.map((label) => ({
              id: 'district',
              label,
              onRemove: () => setLabels((cur) => cur.filter((x) => x !== label)),
            }))}
          />
        )
      }
      renderIn('en', <Harness />)
      expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Thảo Điền',
        'Thủ Đức',
        'Bình Thạnh',
      ])
      expect(warn.mock.calls.some((c) => String(c[0]).includes('duplicate filter chip'))).toBe(false)

      // The hole two reviewers found in an id-only intent: the sibling keeps the id alive, so the
      // restore never resolves and focus falls to <body>. Keyed on id + label, it resolves.
      screen.getByRole('button', { name: 'Remove Thủ Đức' }).focus()
      await user.keyboard('{Enter}')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Bình Thạnh' }))
    } finally {
      warn.mockRestore()
    }
  })

  it('warns in development on a TRUE duplicate — same id and same label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderIn('en', <ResultLine count={12} filters={[chip('district', 'Thảo Điền'), chip('district', 'Thảo Điền')]} />)
      expect(warn.mock.calls.some((c) => String(c[0]).includes('duplicate filter chip'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('offers Clear all only when there is more than one filter to clear', () => {
    const onClearAll = vi.fn()
    const { rerender } = renderIn(
      'en',
      <ResultLine count={12} filters={[chip('district', 'Thảo Điền')]} onClearAll={onClearAll} />,
    )
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()

    rerender(
      wrap(
        'en',
        <ResultLine
          count={12}
          filters={[chip('district', 'Thảo Điền'), chip('brand', 'Honda')]}
          onClearAll={onClearAll}
        />,
      ),
    )
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDefined()
  })
})
