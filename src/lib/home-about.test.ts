import { describe, expect, it } from 'vitest'
import { FOUNDER_QUOTE, HOME_ABOUT, wordCount } from './home-about'

/**
 * The home page's "About eno.vn" block (owner 2026-11-19, AEO): the shape is what answer engines lift, so it is pinned.
 * Each H2 opens with a 40-60 word direct answer, and each section stands alone at 120-180 words.
 */
const words = (parts: readonly { en: string }[]) => wordCount(parts.map((p) => p.en).join(' '))

describe('home about block', () => {
  it('each section opens with a 40-60 word answer, and runs 120-180 words in all (English)', () => {
    for (const s of HOME_ABOUT) {
      const open = words(s.open)
      const all = open + s.more.reduce((n, p) => n + words(p), 0) + (s.id === HOME_ABOUT[0].id ? wordCount(FOUNDER_QUOTE.text.en) : 0)
      expect(open, `${s.id} opener`).toBeGreaterThanOrEqual(40)
      expect(open, `${s.id} opener`).toBeLessThanOrEqual(60)
      expect(all, `${s.id} total`).toBeGreaterThanOrEqual(120)
      expect(all, `${s.id} total`).toBeLessThanOrEqual(180)
    }
  })

  it('every string is under 200 characters, so the nine machine-translated languages get it, and every piece has its Vietnamese', () => {
    const all = HOME_ABOUT.flatMap((s) => [s.q, ...s.open, ...s.more.flat()]).concat([FOUNDER_QUOTE.text, FOUNDER_QUOTE.by])
    for (const t of all) {
      expect(t.en.length, t.en).toBeLessThanOrEqual(200)
      expect(t.vi.length, t.vi).toBeLessThanOrEqual(200)
      expect(t.vi.trim().length).toBeGreaterThan(0)
    }
  })

  it('section ids are unique (they are the headings’ anchors)', () => {
    expect(new Set(HOME_ABOUT.map((s) => s.id)).size).toBe(HOME_ABOUT.length)
  })
})
