// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeFaq } from '@/components/marketplace/home-faq'
import { LanguageProvider } from '@/context/language-context'
import { HOME_ABOUT } from '@/lib/home-about'

/**
 * The home page's questions are ui/disclosure.tsx rows since 2026-11-25 (an H2 holding a button, ui/accordion's look). Base
 * UI's accordion was the largest part of the phone's worst long task. Every word stays in the server's HTML, in place,
 * every question stays an H2, and the keyboard moves between them as before. The row itself (open, close, until-found,
 * beforematch, the group's arrow keys) is pinned in src/components/ui/disclosure.test.tsx.
 */
describe('the home questions, for speed, with nothing lost', () => {
  const html = renderToString(<LanguageProvider><HomeFaq /></LanguageProvider>)

  it('every question is an H2 holding its button, every answer is in the HTML (closed), and no Base UI accordion is left', () => {
    for (const s of HOME_ABOUT) {
      expect(html).toMatch(new RegExp(`<h2 id="about-${s.id}" data-slot="disclosure-header" class="flex"><button type="button" aria-expanded="false" aria-controls="[^"]+" data-disclosure-trigger="" class="acc-trigger group/acc-trigger py-2\\.5 text-sm">`))
      expect(html).toContain(s.open[0].en.slice(0, 40).replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;'))
    }
    expect(html.match(/role="region" aria-labelledby="about-[^"]+" data-slot="disclosure-panel" hidden=""/g)?.length).toBe(HOME_ABOUT.length)
    expect(html).not.toContain('data-slot="accordion')
    expect(html).not.toContain('<details')
  })

  it('the two columns stay (owner 2026-11-24 "2 rows faq more compact")', () => {
    expect(html).toContain('sm:grid-cols-2')
  })

  it('↑ / ↓ / Home / End move between the questions, across both columns, wrapping at the ends (as Base UI did)', () => {
    const { container } = render(<LanguageProvider><HomeFaq /></LanguageProvider>)
    const triggers = [...container.querySelectorAll<HTMLButtonElement>('[data-disclosure-trigger]')]
    expect(triggers).toHaveLength(HOME_ABOUT.length)
    triggers[0].focus()
    fireEvent.keyDown(triggers[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(triggers[1])
    fireEvent.keyDown(triggers[1], { key: 'End' })
    expect(document.activeElement).toBe(triggers.at(-1))
    fireEvent.keyDown(triggers.at(-1)!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(triggers[0])
    fireEvent.keyDown(triggers[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(triggers.at(-1))
    fireEvent.keyDown(triggers.at(-1)!, { key: 'Home' })
    expect(document.activeElement).toBe(triggers[0])
  })
})
