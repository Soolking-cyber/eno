import { readFileSync } from 'node:fs'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatHelpBody, isImplicitHeading } from './rich-text'

/**
 * Every seeded help answer, in both languages, through the help formatter — the corpus the heading rule
 * was tuned on (C-HELP-RENDER). The seed is what scripts/sync-help-center.ts writes to the database,
 * so a copy edit that breaks the structure (a heading that gains a full stop, a bullet typed as "·")
 * fails here rather than on the live page.
 */
type Seed = { slugHint: string; body: string; bodyVi: string }
const seeds = JSON.parse(readFileSync('scripts/help-center-seed.json', 'utf8')) as Seed[]

const html = (text: string, level: 3 | 4 = 3) =>
  renderToStaticMarkup(createElement(Fragment, null, ...formatHelpBody(text, { implicitHeadings: true, headingLevel: level })))
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
// renderToStaticMarkup escapes text; compare against the escaped form of a seed line.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

describe('formatHelpBody over the seeded help answers', () => {
  const all = seeds.flatMap((s) => [s.body, s.bodyVi])
  const rendered = all.map((t) => html(t))

  it('reads the whole seed (the scan is not vacuous)', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(40)
  })

  it('finds the 89 sub-heads the corpus carries (45 EN, 44 VI)', () => {
    expect(rendered.reduce((n, h) => n + count(h, /<h3\b/g), 0)).toBe(89)
    expect(seeds.reduce((n, s) => n + count(html(s.body), /<h3\b/g), 0)).toBe(45)
    expect(seeds.reduce((n, s) => n + count(html(s.bodyVi), /<h3\b/g), 0)).toBe(44)
  })

  it('leaves no literal bullet glyph in any answer', () => {
    for (const h of rendered) expect(h).not.toContain('•')
  })

  it('puts every bullet line inside an <li>', () => {
    for (const text of all) {
      const out = html(text)
      for (const line of text.split('\n')) {
        const m = line.trim().match(/^•\s+(.+)/)
        if (m) expect(out).toContain(`<li>${esc(m[1])}</li>`)
      }
    }
  })

  it('never joins two plain lines into one paragraph', () => {
    for (const h of rendered) expect(h).not.toMatch(/<p[^>]*>[^<]*\n/)
  })

  it('heads the named sections and leaves the sign-off line a sentence', () => {
    const joined = rendered.join('\n')
    expect(joined).toContain('>Hanoi, Noi Bai (HAN)</h3>')
    expect(joined).toMatch(/>TP\.HCM, Tân Sơn Nhất \(SGN\)<\/h3>/)
    expect(joined).not.toContain('Safety advice before you pay anyone: eno.vn/safety</h3>')
    expect(joined).toContain('Safety advice before you pay anyone: eno.vn/safety</p>')
  })

  it('renders h4 when nested under an accordion trigger', () => {
    const checklist = seeds.find((s) => s.slugHint === 'safe-trading-checklist')!
    const out = html(checklist.body, 4)
    expect(count(out, /<h4\b/g)).toBe(3)
    expect(out).not.toMatch(/<h3\b/)
  })
})

describe('isImplicitHeading', () => {
  const at = (text: string, i: number) => isImplicitHeading(text.split('\n'), i)

  it('accepts a short unpunctuated line after a blank line with content below', () => {
    expect(at('Intro.\n\nBefore you go\n• Check the item.', 2)).toBe(true)
    expect(at('Before you go\nMeet in public.', 0)).toBe(true)
  })

  it('ignores parentheticals when counting words', () => {
    expect(at('\nNorth (Hanoi, Ha Long, Ninh Binh, Sapa)\nCold winters.', 1)).toBe(true)
  })

  it('refuses a line glued to the previous one', () => {
    expect(at('Intro line\nBefore you go\nMore.', 1)).toBe(false)
  })

  it('refuses sentence punctuation, domains, list items, long lines and a last line', () => {
    expect(at('\nWhat to bring:\n• ID', 1)).toBe(false)
    expect(at('\nRead more at eno.vn/safety\nMore.', 1)).toBe(false)
    expect(at('\n• A bullet\nMore.', 1)).toBe(false)
    expect(at('\n1. A step\nMore.', 1)).toBe(false)
    expect(at('\nThis line has far too many words to be a heading\nMore.', 1)).toBe(false)
    expect(at('Intro.\n\nThe end', 2)).toBe(false)
  })

  it('does not guess headings for community posts', () => {
    const out = renderToStaticMarkup(createElement(Fragment, null, ...formatHelpBody('Before you go\nMeet in public.', { implicitHeadings: false })))
    expect(out).not.toMatch(/<h[34]\b/)
    expect(count(out, /<p\b/g)).toBe(2)
  })
})
