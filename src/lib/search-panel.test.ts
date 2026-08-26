import { describe, it, expect } from 'vitest'
import { searchPanels, trendingEnabled, INSTANT_MIN_CHARS } from './search-panel'

const HISTORY = true
const NOTHING = false

describe('the gap that made the window blink', () => {
  /**
   * ⛔ THE REGRESSION TEST. Against the old rule (`suggestOpen` gated on `=== 0`) the 1-char case
   * below is FALSE — that was the bug, and every returning user hit it on every search.
   */
  it('a returning user with history keeps the window open through 0, 1 and 2 characters', () => {
    for (const q of ['', 'a', 'ao']) {
      expect(searchPanels(true, q, HISTORY).panelOpen, `query ${JSON.stringify(q)}`).toBe(true)
    }
  })

  it('and in reverse, while deleting', () => {
    for (const q of ['ao', 'a', '']) {
      expect(searchPanels(true, q, HISTORY).panelOpen, `query ${JSON.stringify(q)}`).toBe(true)
    }
  })

  it('hands over at exactly two characters — history closes as instant opens, in one step', () => {
    const one = searchPanels(true, 'a', HISTORY)
    const two = searchPanels(true, 'ao', HISTORY)
    expect(one).toMatchObject({ suggestOpen: true, instantOpen: false })
    expect(two).toMatchObject({ suggestOpen: false, instantOpen: true })
  })
})

describe('the two panels are complements of one comparison', () => {
  const QUERIES = ['', ' ', 'a', ' a', 'a ', ' a ', 'ao', 'a o', 'áo', 'áo dài', 'iphone 15 pro max']

  it('never opens both at once, for any query', () => {
    for (const q of QUERIES) {
      const p = searchPanels(true, q, HISTORY)
      expect(p.suggestOpen && p.instantOpen, `query ${JSON.stringify(q)}`).toBe(false)
    }
  })

  it('leaves no query length uncovered when there is history to show', () => {
    for (const q of QUERIES) {
      expect(searchPanels(true, q, HISTORY).panelOpen, `query ${JSON.stringify(q)}`).toBe(true)
    }
  })

  it('measures the TRIMMED length in both — "a " is one character, not two', () => {
    expect(searchPanels(true, 'a ', HISTORY)).toMatchObject({ suggestOpen: true, instantOpen: false })
    expect(searchPanels(true, ' a', HISTORY)).toMatchObject({ suggestOpen: true, instantOpen: false })
    // ...and whitespace alone is an empty query, not a two-character one.
    expect(searchPanels(true, '  ', HISTORY)).toMatchObject({ suggestOpen: true, instantOpen: false })
  })

  /**
   * ⛔ THE DECOMPOSED CASE IS THE ONE THAT BITES. `'ế'.normalize('NFD').length` is 3 — so without
   * NFC folding, ONE Vietnamese letter satisfies `>= 2` and the instant panel opens on the first
   * keystroke, closing the history panel a character early. These go red without `normalize`.
   */
  it('counts a Vietnamese letter as one character, composed OR decomposed', () => {
    for (const letter of ['á', 'ế', 'ữ', 'ợ', 'đ']) {
      for (const form of [letter.normalize('NFC'), letter.normalize('NFD')]) {
        expect(searchPanels(true, form, HISTORY).instantOpen, `${letter} as ${form.length} units`).toBe(false)
        expect(searchPanels(true, form, HISTORY).suggestOpen, `${letter} as ${form.length} units`).toBe(true)
      }
    }
  })

  it('opens the instant panel at two Vietnamese letters, in either encoding', () => {
    for (const word of ['áo', 'ếch', 'đồ']) {
      for (const form of [word.normalize('NFC'), word.normalize('NFD')]) {
        expect(searchPanels(true, form, HISTORY).instantOpen, `${word} as ${form.length} units`).toBe(true)
      }
    }
  })

  it('counts an emoji as one character, not two', () => {
    // A surrogate pair is 2 UTF-16 units — `.length` would open the instant panel on one glyph.
    expect(searchPanels(true, '😊', HISTORY)).toMatchObject({ suggestOpen: true, instantOpen: false })
    expect(searchPanels(true, '😊😊', HISTORY).instantOpen).toBe(true)
  })

  it('keeps the trending fetch on the same side of the line for a decomposed letter', () => {
    const one = 'ế'.normalize('NFD')
    expect(trendingEnabled(true, one)).toBe(true)
    expect(searchPanels(true, one, HISTORY).suggestOpen).toBe(true)
  })
})

describe('a first visit, with nothing to show', () => {
  it('keeps the window shut rather than opening an empty panel', () => {
    expect(searchPanels(true, '', NOTHING).panelOpen).toBe(false)
    expect(searchPanels(true, 'a', NOTHING).panelOpen).toBe(false)
  })

  it('still opens the instant panel at two characters — that one needs no history', () => {
    expect(searchPanels(true, 'ao', NOTHING)).toMatchObject({ suggestOpen: false, instantOpen: true })
  })
})

describe('focus', () => {
  it('closes everything when the box is not focused, whatever the query', () => {
    for (const q of ['', 'a', 'ao dai']) {
      const p = searchPanels(false, q, HISTORY)
      expect(p, `query ${JSON.stringify(q)}`).toMatchObject({ suggestOpen: false, instantOpen: false, panelOpen: false })
    }
  })
})

describe('the trending fetch tracks the panel that displays it', () => {
  /**
   * ⚠️ THE COLD-CACHE RACE. `useTrendingSearches` aborts on disable, so any range NARROWER than
   * `suggestOpen`'s kills the request under a fast typer and leaves a first-time visitor — who has
   * no history to fall back on — with a closed panel at 1 char and a pop-in at 2.
   */
  it('stays enabled for exactly the queries the history panel can be open for', () => {
    for (const q of ['', ' ', 'a', 'a ', 'á']) {
      expect(trendingEnabled(true, q), `query ${JSON.stringify(q)}`).toBe(true)
      expect(searchPanels(true, q, HISTORY).suggestOpen, `query ${JSON.stringify(q)}`).toBe(true)
    }
    for (const q of ['ao', 'áo dài']) {
      expect(trendingEnabled(true, q), `query ${JSON.stringify(q)}`).toBe(false)
      expect(searchPanels(true, q, HISTORY).suggestOpen, `query ${JSON.stringify(q)}`).toBe(false)
    }
  })

  it('does not fetch for an unfocused box', () => {
    expect(trendingEnabled(false, '')).toBe(false)
  })
})

// ⚠️ DERIVED FROM THE CONSTANT, NEVER PINNING IT. An `expect(INSTANT_MIN_CHARS).toBe(2)` here would
// forbid exactly the edit the shared constant exists to make safe.
it('opens the instant panel at the threshold and not one character below it', () => {
  expect(searchPanels(true, 'x'.repeat(INSTANT_MIN_CHARS - 1), HISTORY).instantOpen).toBe(false)
  expect(searchPanels(true, 'x'.repeat(INSTANT_MIN_CHARS), HISTORY).instantOpen).toBe(true)
})
