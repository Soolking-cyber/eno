import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Batch 66 (2026-11-11): on a phone the home's pilot language link is not drawn — it stood alone between a thin answer and the
 * footer, whose own language picker sits right under it. CSS only (`max-sm:sr-only`, never `hidden` or [hidden]): the
 * server-rendered <a hreflang> stays in the HTML for crawlers and in the accessibility tree; from sm it is drawn where it was.
 */
describe('home layout — the pilot language row on a phone', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/[lang]/(home)/layout.tsx'), 'utf8')
  it('is screen-reader-only below sm and still the server-rendered pilot switch', () => {
    const row = src.split('\n').find((l) => l.includes('<LangPilotSwitch path="/"'))!
    const m = row.match(/<div className="([^"]+)"><div className="([^"]+)"><LangPilotSwitch path="\/"/)!
    const outer = m[1].split(' ')
    const inner = m[2].split(' ')
    expect(outer).toContain('max-sm:sr-only')
    // A keyboard on the hidden link draws it again (WCAG 2.4.7), and the row keeps its padding: `not-sr-only` zeroes padding,
    // so it sits on the outer wrapper and the spacing on the inner one.
    expect(outer).toContain('max-sm:focus-within:not-sr-only')
    expect(inner).toEqual(expect.arrayContaining(['flex', 'justify-end', 'pb-6', 'pt-2']))
    expect(outer.some((c) => /(^|:)p[tbxy]?-/.test(c))).toBe(false)
    // Never removed from the HTML or the tree: no `hidden`, at any breakpoint.
    expect([...outer, ...inner].some((c) => /(^|:)hidden$/.test(c))).toBe(false)
    expect(row).toContain('{PILOTED && ')
  })
})
