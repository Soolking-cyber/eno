// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeFaq } from '@/components/marketplace/home-faq'
import { FaqItem } from '@/components/marketplace/home-faq-item'
import { LanguageProvider } from '@/context/language-context'
import { HOME_ABOUT } from '@/lib/home-about'

/**
 * The home page's questions are home-faq-item.tsx rows since 2026-11-25 (an H2 holding a button, ui/accordion's look). Base
 * UI's accordion was the largest part of the phone's worst long task. Every word stays in the server's HTML, in place,
 * every question stays an H2, and the keyboard moves between them as before.
 */
describe('the home questions, for speed, with nothing lost', () => {
  const html = renderToString(<LanguageProvider><HomeFaq /></LanguageProvider>)

  it('every question is an H2 holding its button, every answer is in the HTML (closed), and no Base UI accordion is left', () => {
    for (const s of HOME_ABOUT) {
      expect(html).toMatch(new RegExp(`<h2 id="about-${s.id}" class="flex"><button type="button" aria-expanded="false" aria-controls="[^"]+" data-faq-trigger="" class="acc-trigger group/acc-trigger py-2\\.5 text-sm">`))
      expect(html).toContain(s.open[0].en.slice(0, 40).replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;'))
    }
    expect(html.match(/role="region" aria-labelledby="about-[^"]+" hidden=""/g)?.length).toBe(HOME_ABOUT.length)
    expect(html).not.toContain('data-slot="accordion')
    expect(html).not.toContain('<details')
  })

  it('the two columns stay (owner 2026-11-24 "2 rows faq more compact")', () => {
    expect(html).toContain('sm:grid-cols-2')
  })

  it('a row opens and closes on its button; closed, its answer is `hidden="until-found"`, and a find-in-page match opens it', async () => {
    const question = 'Q', answer = 'A'
    const { container } = render(<FaqItem id="x" question={question}><p>{answer}</p></FaqItem>)
    const button = container.querySelector('button')!
    const panel = container.querySelector('[role="region"]')!
    expect(panel.getAttribute('hidden')).toBe('until-found')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.hasAttribute('data-panel-open')).toBe(true)
    expect(panel.hasAttribute('hidden')).toBe(false)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(panel.getAttribute('hidden')).toBe('until-found')
    await act(async () => { panel.dispatchEvent(new Event('beforematch')) })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hasAttribute('hidden')).toBe(false)
  })

  it('↑ / ↓ / Home / End move between the questions, across both columns, wrapping at the ends (as Base UI did)', () => {
    const { container } = render(<LanguageProvider><HomeFaq /></LanguageProvider>)
    const triggers = [...container.querySelectorAll<HTMLButtonElement>('[data-faq-trigger]')]
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
