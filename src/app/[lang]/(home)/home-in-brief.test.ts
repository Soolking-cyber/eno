import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * "In brief" — the sr-only summary heading on the home page, the text pages (ContentPage) and /help, and the home page's one
 * sr-only paragraph (aeo.js "Page Citability", 2026-11-26). The scorer reads the first 8,000 characters of <main> as text:
 * Structure Quality counts a summary only on a line that IS "In brief" / "Summary" / "Overview", and Answer Blocks only a
 * paragraph of 20–200 words that opens /^[A-Z][a-z]/ on a word other than This/That/It/We/I…
 * ⛔ Never drawn: the owner dropped a visible home intro on 2026-11-24 ("why so ugly, do we really need it?").
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('"In brief" for a parser and a screen reader, never drawn', () => {
  it('home: an sr-only heading and paragraph straight after the H1, both languages, free and not', () => {
    const src = read('./layout.tsx')
    const block = src.slice(src.indexOf('</h1>'), src.indexOf('PREPAINT_SCRIPT }}'))
    expect(block).toContain('<div className="sr-only">')
    expect(block).toContain('<h2><Bilingual en="In brief" vi="Tóm tắt" /></h2>')
    const ens = [...block.matchAll(/<Bilingual en="([^"]+)" vi="[^"]+" \/>/g)].map((m) => m[1]).filter((t) => t !== 'In brief')
    expect(ens).toHaveLength(2)
    for (const en of ens) {
      const words = en.split(/\s+/).length
      expect(en, 'opens on a capitalised word that is not a pronoun').toMatch(/^[A-Z][a-z]/)
      expect(en).not.toMatch(/^(This|That|These|Those|It|They|We|He|She|I)\b/)
      expect(words, en).toBeGreaterThanOrEqual(20)
      expect(words, en).toBeLessThanOrEqual(200)
    }
  })
  it('ContentPage: the heading only over an intro that summarises (legal pages open on their text; archived versions on a notice)', () => {
    const src = read('../../../components/marketplace/content-page.tsx')
    expect(src).toContain('{intro && introIsSummary && <h2 className="sr-only"><Bilingual en="In brief" vi="Tóm tắt" /></h2>}')
    for (const v of ['v1', 'v2', 'v3', 'v4']) expect(read(`../regulations/${v}/page.tsx`), v).toContain('introIsSummary={false}')
  })
  it('/help: the same heading over its lede', () => {
    const src = read('../../../components/marketplace/help-center.tsx')
    expect(src).toContain('<h2 className="sr-only"><Bilingual en="In brief" vi="Tóm tắt" /></h2>')
  })
})
