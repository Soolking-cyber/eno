// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { RichText } from './listing-content'

/**
 * THE LIGHT-MARKDOWN FORMATTER, which now renders BOTH listing descriptions and storefront bios.
 *
 * ⚠️ THE FAILURE THIS SUITE EXISTS FOR IS NOT "A MARKER SHOWS AS A LITERAL CHARACTER". It is far
 * worse than that and it is invisible in a diff: an UNRECOGNISED marker falls through to the
 * paragraph branch, and paragraph lines are JOINED WITH SPACES. So four tick lines did not render
 * as four plain lines — they merged into one run-on sentence. Any new marker added to
 * formatDescription needs a case here, because "it renders the text somehow" is exactly what the
 * broken version also did.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach and the second render in the file would fail on a duplicate.
 */
afterEach(cleanup)

// Bare words in JSX trip `react/jsx-no-literals` (an ERROR in npm run lint, tests included).
const TICK_BIO = ['Welcome to Eno', '', '✓ Clear options & upfront pricing', '✓ Standard and express e-Visa processing', '✓ Friendly support when you need help'].join('\n')
const BOLD_BIO = 'We make it simpler — from **Vietnam e-Visas** to **free trip planning**.'
const DASH_LIST = ['Included:', '- Official assistance', '- Multiple entry'].join('\n')
const MIXED = ['1. First', '2. Second'].join('\n')

function renderRich(text: string) {
  return render(
    <LanguageProvider>
      <RichText text={text} />
    </LanguageProvider>,
  )
}

describe('RichText / formatDescription', () => {
  it('keeps tick lines as separate list items instead of merging them into one paragraph', () => {
    const { container } = renderRich(TICK_BIO)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
    // ⚠️ Assert on the TEXT span, not the <li> — the tick is a real (aria-hidden) child of the
    // item, so `li.textContent` legitimately reads "✓Clear options…". My first version of this
    // test asserted on the <li> and failed for that reason: the test was wrong, not the markup.
    expect(items[0]?.querySelectorAll('span')[1]?.textContent).toBe('Clear options & upfront pricing')
    // ⚠️ THE REGRESSION ASSERTION. Before the fix these three lines arrived as ONE paragraph with
    // the ticks embedded mid-sentence — "…upfront pricing ✓ Standard and express…". If a future
    // edit drops the tick branch, they merge again and this is what catches it.
    expect(container.textContent).not.toContain('pricing ✓')
  })

  it("keeps the seller's own tick glyph rather than normalising every mark to one", () => {
    const { container } = renderRich(['☑️ Boxed', '✅ Green', '✔ Heavy'].join('\n'))
    const marks = [...container.querySelectorAll('li')].map((li) => li.querySelector('span')?.textContent)
    expect(marks).toEqual(['☑', '✅', '✔'])
    // ⚠️ "☑️" is ☑ + an invisible U+FE0F. Without consuming it, the selector leads the TEXT and
    // renders as a stray box on some fonts — reviewer-caught, and invisible in a screenshot.
    expect([...container.querySelectorAll('li')][0]?.querySelectorAll('span')[1]?.textContent).toBe('Boxed')
  })

  it('does not give a tick list a second, disc marker', () => {
    const { container } = renderRich(TICK_BIO)
    const list = container.querySelector('ul')
    expect(list?.className).toContain('list-none')
    expect(list?.className).not.toContain('list-disc')
  })

  it('renders **bold** as a real <strong>, not literal asterisks', () => {
    const { container } = renderRich(BOLD_BIO)
    const strongs = [...container.querySelectorAll('strong')].map((s) => s.textContent)
    expect(strongs).toEqual(['Vietnam e-Visas', 'free trip planning'])
    expect(container.textContent).not.toContain('**')
  })

  it('still renders dash bullets as a disc list', () => {
    const { container } = renderRich(DASH_LIST)
    const list = container.querySelector('ul')
    expect(list?.className).toContain('list-disc')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('still renders numbered lines as an ordered list', () => {
    const { container } = renderRich(MIXED)
    expect(container.querySelector('ol')).not.toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('keeps a blank-line-separated paragraph separate from the list that follows it', () => {
    const { container } = renderRich(TICK_BIO)
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByText('Welcome to Eno')).toBeTruthy()
  })
})
