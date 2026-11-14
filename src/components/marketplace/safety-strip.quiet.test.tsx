// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SafetyStrip } from './safety-strip'

/**
 * ⛔ THE RENTAL SHEET'S SAFETY WELL (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round build all best options
 * and deploy"; src/lib/rental-sheet.ts). `quiet`, below md only: 14/20 body ink, the warning REGULAR but still the first line and
 * every word of it, 4px between lines, the guide the one accent link, the actions row its own 44px line over a hairline. From md
 * (and without the prop) the strip is what it was: the warning `font-semibold` in the darkest ink (2026-11-06).
 */
const dom = (lang: 'en' | 'vi', quiet: boolean) => {
  const div = document.createElement('div')
  div.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>
      <SafetyStrip categorySlug="rentals" subcategorySlug="apartment-rental" quiet={quiet} action={<span data-actions="" />} />
    </LanguageProvider>,
  )
  return div.firstElementChild as HTMLElement
}

describe('SafetyStrip quiet (the rental sheet)', () => {
  it('every word stays: the same text in EN and VI, quiet or not', () => {
    for (const lang of ['en', 'vi'] as const) expect(dom(lang, true).textContent).toBe(dom(lang, false).textContent)
    expect(dom('en', true).textContent).toContain("Visit in person and check the owner's papers before paying any deposit.")
  })

  it('the warning is still the FIRST line; below md it is regular body ink, from md semibold in the darkest ink', () => {
    const p = dom('en', true).querySelector('p')!
    expect(p.textContent).toMatch(/^Visit in person/)
    const c = p.className.split(' ')
    expect(c).toEqual(expect.arrayContaining(['font-semibold', 'text-foreground', 'max-md:font-normal', 'max-md:text-body']))
    expect(dom('en', false).querySelector('p')!.className).toBe('font-semibold text-foreground')
  })

  it('14/20 and the 12px glyph gap below md; the actions row a 44px line over the line-strong hairline; the guide link 44px', () => {
    const root = dom('en', true)
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['max-md:text-sm', 'max-md:leading-5', 'max-md:gap-3', 'text-xs', 'lg:text-sm']))
    const row = root.querySelector('[data-actions]')!.parentElement!
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['justify-between', 'max-md:min-h-11', 'max-md:flex-wrap', 'max-md:border-t', 'max-md:border-line-strong']))
    const guide = root.querySelector('a[href="/safety"]')!
    expect(guide.className.split(' ')).toEqual(expect.arrayContaining(['text-accent-foreground', 'max-md:min-h-11', 'max-md:whitespace-nowrap']))
    // Every class the prop adds is max-md:.
    const plain = dom('en', false)
    const added = (a: Element, b: Element) => a.className.split(' ').filter((x) => !b.className.split(' ').includes(x))
    for (const x of added(root, plain)) expect(x).toMatch(/^max-md:/)
    for (const x of added(guide, plain.querySelector('a[href="/safety"]')!)) expect(x).toMatch(/^max-md:/)
  })
})
