import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { FAQS, faqPageJsonLd } from './faq'

/**
 * The FAQ is written twice: once as the FAQS data the FAQPage JSON-LD is built from (./faq.ts), and once in
 * page.tsx as literal `<Tr>`s so the string harvest sees it. Google penalises structured data that does not match
 * the visible page, so the two must say the same thing, word for word.
 * An answer written in both languages (`aVi`) renders as a literal `<Bilingual en vi>` instead, and the JSON-LD
 * reads the same `aVi` — so it is held to the same rule in both languages.
 */
describe('/hcmc-rent-index FAQ', () => {
  const src = readFileSync('src/app/[lang]/hcmc-rent-index/page.tsx', 'utf8')

  // Spelled `<${TR}` so scripts/gen-ui-strings.mjs does not harvest this test's template as copy.
  const TR = 'Tr'
  const BI = 'Bilingual'
  it('renders every JSON-LD question and answer as a literal <Tr>, or <Bilingual> when it carries its own Vietnamese', () => {
    expect(FAQS).toHaveLength(3)
    for (const { q, a, aVi } of FAQS) {
      expect(src).toContain(`<${TR} text="${q}" />`)
      expect(src).toContain(aVi ? `<${BI} en="${a}" vi="${aVi}" />` : `<${TR} text="${a}" />`)
    }
  })

  it('builds the FAQPage node in the language the page prints', () => {
    type Node = { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    const en = faqPageJsonLd('en') as Node
    const vi = faqPageJsonLd('vi') as Node
    FAQS.forEach((f, i) => {
      expect(en.mainEntity[i]).toMatchObject({ name: f.q, acceptedAnswer: { text: f.a } })
      expect(vi.mainEntity[i]).toMatchObject({ name: VI_OVERRIDES[f.q] ?? f.q, acceptedAnswer: { text: f.aVi ?? VI_OVERRIDES[f.a] ?? f.a } })
    })
    // The answer with its own Vietnamese has no curated key, so without `aVi` the vi node would carry English.
    const cite = FAQS.findIndex((f) => f.aVi)
    expect(vi.mainEntity[cite].acceptedAnswer.text).toMatch(/^Có\. /)
  })

  /**
   * ⛔ OWNER DECISION 9 (the original-data terms): free to cite; a credit link is welcome and may be nofollow —
   * never a link required as the price of using the data (Google's spam policies list that as link spam).
   */
  it('states the decision-9 citation terms, in both languages, and no longer asks for a link', () => {
    const cite = FAQS.find((e) => e.q === 'Can I use this data in an article or report?')!
    expect(cite.a).toContain('Please credit eno.vn; a link to https://eno.vn/hcmc-rent-index is welcome and may be nofollow.')
    expect(cite.aVi).toContain('Vui lòng ghi nguồn eno.vn; chúng tôi hoan nghênh liên kết đến https://eno.vn/hcmc-rent-index, kể cả liên kết nofollow.')
    expect(src).not.toContain('credit eno.vn with a link')
  })

  it('declares no Dataset licence (owner ruling R-f, restated by decision 9)', () => {
    // Comments may name the field; code may not set it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/['"]?license['"]?\s*:/)
    expect(code).toContain("usageInfo: `${URL_}#cite`")
  })
})
