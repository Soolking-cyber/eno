import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The FAQ is written twice in page.tsx: once as the FAQS array the FAQPage JSON-LD is built from, and
 * once as literal `<Tr>`s so the string harvest sees it. Google penalises structured data that does
 * not match the visible page, so the two must say the same thing, word for word.
 */
describe('/hcmc-rent-index FAQ', () => {
  const src = readFileSync('src/app/[lang]/hcmc-rent-index/page.tsx', 'utf8')
  const pairs = [...src.matchAll(/ {4}q: '([^']*)',\n {4}a: '([^']*)',/g)].map((m) => [m[1], m[2]])

  // Spelled `<${TR}` so scripts/gen-ui-strings.mjs does not harvest this test's template as copy.
  const TR = 'Tr'
  it('renders every JSON-LD question and answer as a literal <Tr>', () => {
    expect(pairs).toHaveLength(3)
    for (const [q, a] of pairs) {
      expect(src).toContain(`<${TR} text="${q}" />`)
      expect(src).toContain(`<${TR} text="${a}" />`)
    }
  })
})
