// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SafetyStrip } from './safety-strip'
import { ProtectionsRow } from './protections-row'

/**
 * ⛔ THE GOODS SHEET'S COUNSEL WITHOUT THE BOX (owner-approved 2026-11-15 (build 7), cook r07 "item"; SafetyStrip `flow` with
 * `quiet`, ProtectionsRow `accent`; src/lib/goods-sheet.ts COUNSEL_*). Below md only: no line and no padding over the strip, the
 * shield 20px in ink 8px from the words, the statements 8px apart, "Reports & disputes" an accent link and the guide / Report /
 * Block row hanging back 28px to the 12px text edge, that row with no hairline over it. Every word stays, in EN and VI.
 */
const dom = (lang: 'en' | 'vi', flow: boolean, protections = true) => {
  const div = document.createElement('div')
  div.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>
      <SafetyStrip categorySlug="rentals" subcategorySlug="motorbike-rental" quiet flow={flow} protections={protections ? <ProtectionsRow inline shortLabel accent={flow} /> : undefined} action={<span data-actions="" />} />
    </LanguageProvider>,
  )
  return div.firstElementChild as HTMLElement
}
const cls = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

describe('SafetyStrip `flow` (the goods sheet)', () => {
  it('every word stays: the same text as the quiet strip, EN and VI', () => {
    for (const lang of ['en', 'vi'] as const) expect(dom(lang, true).textContent).toBe(dom(lang, false).textContent)
    const t = dom('en', true).textContent!
    expect(t).toContain('See the vehicle and check its papers match the chassis before paying.')
    expect(t).toContain('Driving a hired car or motorbike yourself needs a valid licence')
  })

  it('no line and no padding over it, 8px from the shield (ink) to the words, 8px between the statements', () => {
    const root = dom('en', true)
    expect(cls(root)).toEqual(expect.arrayContaining(['max-md:border-t-0', 'max-md:pt-0', 'max-md:gap-2']))
    expect(cls(root)).not.toContain('max-md:gap-3')
    expect(cls(root.querySelector('svg')!)).toEqual(expect.arrayContaining(['h-5', 'w-5', 'max-md:text-foreground']))
    const col = root.children[1]
    expect(cls(col)).toContain('max-md:space-y-2')
  })

  it('the two link rows hang back 28px to the text edge; the actions row has no hairline; the disputes row is flush on it', () => {
    const root = dom('en', true)
    const row = root.querySelector('[data-actions]')!.parentElement!
    expect(cls(row)).toEqual(expect.arrayContaining(['max-md:-ml-7', 'max-md:border-t-0', 'max-md:min-h-11', 'max-md:flex-wrap']))
    expect(cls(row)).not.toContain('max-md:border-t')
    const disputes = root.querySelector('[data-protections-row]')!
    const hang = disputes.parentElement!
    expect(cls(hang)).toEqual(expect.arrayContaining(['max-md:-ml-7', 'max-md:mb-0']))
    expect(hang.nextElementSibling).toBe(row)
  })

  it('"Reports & disputes" is an accent link below md (label and chevron), the tail screen-reader only', () => {
    const disputes = dom('en', true).querySelector('[data-protections-row]')!
    const label = [...disputes.querySelectorAll('span')].find((s) => s.textContent === 'Reports & disputes')!
    expect(cls(label)).toEqual(expect.arrayContaining(['font-bold', 'max-md:text-accent-foreground']))
    expect(cls(disputes.querySelector('svg')!)).toContain('max-md:text-accent-foreground')
    expect(disputes.textContent).toContain('how they work')
  })

  it('a linked listing (no disputes row): the actions row hangs alone; without `flow` the quiet strip is as it was', () => {
    const root = dom('en', true, false)
    expect(root.querySelector('[data-protections-row]')).toBeNull()
    expect(cls(root.querySelector('[data-actions]')!.parentElement!)).toContain('max-md:-ml-7')
    const quiet = dom('en', false)
    expect(cls(quiet.querySelector('[data-actions]')!.parentElement!)).toEqual(expect.arrayContaining(['max-md:border-t', 'max-md:border-line-strong']))
    expect(quiet.querySelector('[data-protections-row]')!.parentElement).toBe(quiet.children[1])
    expect(quiet.innerHTML).not.toContain('max-md:text-accent-foreground')
  })

  it('every class `flow` adds is max-md:', () => {
    const a = dom('en', true), b = dom('en', false)
    const added = (x: Element, y: Element) => cls(x).filter((c) => !cls(y).includes(c))
    for (const c of added(a, b)) expect(c).toMatch(/^max-md:/)
    for (const c of added(a.children[1], b.children[1])) expect(c).toMatch(/^max-md:/)
  })
})
