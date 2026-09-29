/**
 * ⛔ AN ENGLISH GUIDE PRINTS ĐỒNG THE ENGLISH WAY: "2,480,000 đ", never a hand-typed "2.480.000 đ".
 *
 * Four English guides carried ~70 figures typed by hand in Vietnamese grouping, on a note claiming
 * đồng "always takes dot separators, per src/lib/vnd.ts" — which says the opposite: it groups by the
 * READER's language (vnd.ts, docs/design-language.md §7 "never hand-format numbers"). On an English
 * page "2.480.000" reads as two-point-four, the same page printed counts with commas, and every other
 * English price on the site is "2,480,000 đ" (L-NUMBERS, 2026-09-29). The figures now go through
 * vnd.ts; this keeps a new one from being typed back in.
 *
 * ⚠️ VIETNAMESE ARTICLES ARE EXEMPT, AND CORRECT: a page whose content root says `lang: 'vi'`
 * (thanh-ly-…, do-cu-…, ban-do-cu-…, dang-tin-…) groups with dots because its reader does.
 * An `alternate: { lang: 'vi', … }` link to a sibling is NOT that marker — it sits on English pages.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = 'src/app/[lang]'

function* pages(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* pages(p)
    else if (/^page.*\.tsx$/.test(name)) yield p
  }
}

// Comments may quote the old spelling to explain it; only code and copy count.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')

/** A dot-grouped figure followed by "đ", or opening a range ("3.980.000–7.800.000 đ"). */
const DOT_GROUPED_MONEY = /\b\d{1,3}(?:\.\d{3})+(?:\s?đ|–)/g

const englishArticles = [...pages(ROOT)].filter((p) => {
  const src = readFileSync(p, 'utf8')
  return /\b(SeoArticle|SeoLanding)\b/.test(src) && !/^\s{2}lang:\s*'vi',?\s*$/m.test(src)
})

describe('English guides format đồng through vnd.ts', () => {
  it('finds the English guides (the scan is not vacuous)', () => {
    expect(englishArticles).toEqual(
      expect.arrayContaining([
        join(ROOT, 'rental-deposit-vietnam/page.tsx'),
        join(ROOT, 'renting-an-apartment-vietnam-foreigner/page.tsx'),
        join(ROOT, 'secondhand-furniture-ho-chi-minh-city/page.tsx'),
        join(ROOT, 'moving-sales-vietnam/page.tsx'),
      ]),
    )
    expect(englishArticles).not.toContain(join(ROOT, 'thanh-ly-do-gia-dung-cu-tphcm/page.tsx'))
  })

  it.each(englishArticles)('%s has no hand-typed Vietnamese-grouped amount', (file) => {
    const hits = stripComments(readFileSync(file, 'utf8')).match(DOT_GROUPED_MONEY) ?? []
    expect(hits).toEqual([])
  })
})
