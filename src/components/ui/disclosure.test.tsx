// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { DisclosureItem } from './disclosure'
import { DISCLOSURE_GROUP } from './disclosure-group'

afterEach(cleanup)

const Q = 'Question'
const A = 'Answer'
const LEAD = 'Static heading'
const group = (names: readonly string[]) => (
  <div {...DISCLOSURE_GROUP}>
    {names.map((n) => <DisclosureItem key={n} trigger={n}><p>{n}</p></DisclosureItem>)}
  </div>
)

describe('ui/disclosure: a heading holding a button, and its panel (the home FAQ and the footer link groups)', () => {
  it('server HTML: the heading at its level holds the button; the closed panel is a hidden region still holding its content', () => {
    const html = renderToString(<DisclosureItem level={2} headingId="h" lead={<p>{LEAD}</p>} trigger={Q}><p>{A}</p></DisclosureItem>)
    expect(html).toMatch(/^<div class="border-b border-border last:border-b-0"><p>Static heading<\/p><h2 id="h" data-slot="disclosure-header" class="flex"><button type="button" aria-expanded="false" aria-controls="[^"]+" data-disclosure-trigger="" class="acc-trigger group\/acc-trigger">Question/)
    expect(html).toMatch(/role="region" aria-labelledby="h" data-slot="disclosure-panel" hidden=""><p>Answer<\/p>/)
    expect(renderToString(<DisclosureItem trigger={Q}><p>{A}</p></DisclosureItem>)).toContain('<h3 id=')
  })

  it('opens and closes on its button; closed, its panel is `hidden="until-found"`, and a find-in-page match opens it', async () => {
    const { container } = render(<DisclosureItem trigger={Q}><p>{A}</p></DisclosureItem>)
    const button = container.querySelector('button')!
    const panel = container.querySelector('[role="region"]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(container.querySelector('h3')!.id)
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

  it('↑ / ↓ / Home / End stay inside their own group (the footer\'s rows never jump into the FAQ\'s)', () => {
    const { container } = render(<>{group(['a1', 'a2'])}{group(['b1', 'b2', 'b3'])}</>)
    const [a1, a2, b1, , b3] = [...container.querySelectorAll<HTMLButtonElement>('[data-disclosure-trigger]')]
    a2.focus()
    fireEvent.keyDown(a2, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(a1) // wraps within its group, never on to b1
    fireEvent.keyDown(a1, { key: 'End' })
    expect(document.activeElement).toBe(a2)
    b1.focus()
    fireEvent.keyDown(b1, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(b3)
    fireEvent.keyDown(b3, { key: 'ArrowDown', ctrlKey: true })
    expect(document.activeElement).toBe(b3) // a modified key is the browser's
  })

  it('the group marker comes from a module without \'use client\' (a Server Component spreads it: the home FAQ)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/src/components/ui/disclosure-group.ts`, 'utf8')
    expect(src).not.toMatch(/^\s*['"]use client['"]/m)
    const faq = readFileSync(`${process.cwd()}/src/components/marketplace/home-faq.tsx`, 'utf8')
    expect(faq).toContain("import { DISCLOSURE_GROUP } from '@/components/ui/disclosure-group'")
  })

  it('outside any group, the arrow keys do nothing', () => {
    const { container } = render(<><DisclosureItem trigger="x"><p>{A}</p></DisclosureItem><DisclosureItem trigger="y"><p>{A}</p></DisclosureItem></>)
    const [x] = [...container.querySelectorAll<HTMLButtonElement>('[data-disclosure-trigger]')]
    x.focus()
    fireEvent.keyDown(x, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(x)
  })
})
