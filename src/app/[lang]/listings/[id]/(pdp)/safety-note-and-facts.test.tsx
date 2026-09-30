// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
const UI_STRINGS = readFileSync(join(process.cwd(), 'src/generated/ui-strings.ts'), 'utf8')
/** The bottom safety note's expression, from its declaration to the blank line that ends it. */
const NOTE = PAGE.slice(PAGE.indexOf('const safetyNote ='), PAGE.indexOf('\n\n', PAGE.indexOf('const safetyNote =')))

/** Every tr('English', 'Tiếng Việt') pair in the note, whichever quote each side uses. */
const pairs = [...NOTE.matchAll(/\btr\(\s*(["'])((?:(?!\1).)*)\1,\s*(["'])((?:(?!\3).)*)\3\)/g)].map((m) => ({ en: m[2], vi: m[4] }))

/**
 * ⛔ THE BOTTOM SAFETY NOTE NAMES THE SITE THE READER IS ON (review, 2026-09-29). The per-type lines
 * said "eno.vn never asks …" on both editions, so eno.forum's PDP pointed at the other site.
 */
describe('PDP safety note — one copy per edition', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
  })
  const html = (node: ReactNode) =>
    renderToString(<LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}>{node}</LanguageProvider>)

  it('the scan is not vacuous', () => {
    expect(NOTE).toContain('listing.listingType === \'job\'')
    expect(pairs).toHaveLength(3)
  })

  it('each eno.forum line is an authored pair that names eno.forum in BOTH languages, behind IS_SERVICES', () => {
    for (const { en, vi } of pairs) {
      expect(en).toContain('eno.forum never asks')
      expect(en).not.toContain('eno.vn')
      expect(vi).toContain('eno.forum không bao giờ')
      expect(vi).not.toContain('eno.vn')
      // Harvested into the catalogue, so the nine machine-translated languages are pre-warmed.
      expect(UI_STRINGS, en).toContain(JSON.stringify(en))
      // The Vietnamese is what a Vietnamese reader gets — no dictionary lookup, no machine pass.
      expect(html(<Bilingual en={en} vi={vi} />)).toBe(vi)
    }
    expect(NOTE.match(/IS_SERVICES/g)).toHaveLength(3)
    expect(NOTE).toMatch(/IS_SERVICES\s*\n?\s*\?\s*tr\("Visit in person/)
    expect(NOTE).toMatch(/IS_SERVICES\s*\n?\s*\?\s*tr\('Agree what is included/)
    expect(NOTE).toMatch(/IS_SERVICES && !visaCopyHeld\s*\n?\s*\?\s*tr\('Meet in a public place/)
  })

  it('eno.vn keeps its three lines word for word, with their curated Vietnamese', () => {
    for (const en of [
      "Visit in person and check the owner's papers before paying any deposit. eno.vn never asks for a deposit via a link.",
      'Agree what is included and the price in chat before paying, and never send a deposit through a link. eno.vn never asks for one.',
      'Meet in a public place and inspect the item before paying. eno.vn never asks for a deposit via a link.',
    ]) {
      expect(NOTE).toContain(["<Tr text=\"", en, "\" />"].join(""))
      expect(VI_OVERRIDES[en], en).toContain('eno.vn')
    }
  })

  it('⛔ the e-visa page keeps the line it had — visa copy is held for the owner', () => {
    // The last branch is the old default, and an e-visa listing (visaCopyHeld) reaches it on both editions.
    expect(NOTE.trimEnd().endsWith('<Tr text="Meet in a public place and inspect the item before paying. eno.vn never asks for a deposit via a link." />')).toBe(true)
  })
})

/**
 * ⛔ THE DESCRIPTION DOES NOT REPEAT DETAILS (review, 2026-09-29). An imported rental printed Area,
 * Bedrooms and Bathrooms in the description's fact table and again in Details right below it. The
 * page names every Details row it renders and hands the result to the description as a className
 * (rich-text.facts.test.tsx pins the tagging and the classes).
 */
describe('PDP description — rows Details already shows are hidden', () => {
  it('names the spec rows AND the attribute rows Details renders', () => {
    expect(PAGE).toContain('hideRepeatedFacts([...numericSpecs, ...detailOnlySpecs].map((s) => s.label.toLowerCase()).concat(detailAttrs.map(([k]) => k)))')
    // The spec labels lower-case to the keys rich-text.tsx uses.
    for (const label of ["label: 'Area'", "label: 'Year'", "label: 'Mileage'", "label: 'Engine'"]) expect(PAGE).toContain(label)
  })

  it('puts it on the description, not on Details', () => {
    expect(PAGE).toMatch(/<ListingDescription [^>]*className=\{`max-w-prose [^`]*\$\{repeatedFacts\}`\}/)
  })
})
