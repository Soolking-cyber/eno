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

/** The site-neutral provider sentence the services line carries since 2026-10-14 (owner: providers may be "foreign
 *  workers") — the one pair that names no site. */
const PROVIDER_EN = 'Each provider is responsible for holding any licence or work permit they need to offer their service.'
/** Every tr('English', 'Tiếng Việt') pair in the note, whichever quote each side uses — the site lines, without it. */
const allPairs = [...NOTE.matchAll(/\btr\(\s*(["'])((?:(?!\1).)*)\1,\s*(["'])((?:(?!\3).)*)\3\)/g)].map((m) => ({ en: m[2], vi: m[4] }))
const pairs = allPairs.filter((p) => p.en !== PROVIDER_EN)

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
    expect(NOTE).toContain("safetyNoteKind === 'rent'") // which listing gets which note: src/lib/pdp-safety-note.ts
    expect(pairs).toHaveLength(3)
    expect(allPairs).toHaveLength(4) // + the provider sentence (below)
  })

  it('the services line adds who holds a licence or work permit — the provider — on both editions, in each one\'s voice', () => {
    // ⚠️ Assembled, never written as a Tr/tr call: the string harvester scans test files and would catalogue a placeholder.
    expect(NOTE).toContain(['tr(', "'", PROVIDER_EN, "'"].join('')) // eno.forum: an authored pair
    expect(NOTE).toContain(['<Tr', ' text="', PROVIDER_EN, '" />'].join('')) // eno.vn: <Tr> with a curated vi-override
    expect(VI_OVERRIDES[PROVIDER_EN]).toBe('Mỗi nhà cung cấp tự chịu trách nhiệm có đủ giấy phép hoặc giấy phép lao động cần thiết để cung cấp dịch vụ của mình.')
    expect(UI_STRINGS).toContain(JSON.stringify(PROVIDER_EN))
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
    expect(NOTE).toMatch(/IS_SERVICES\s*\n?\s*\?\s*<>\{tr\('Agree what is included/)
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

  /**
   * ⛔ THE NOTE IS DROPPED ONLY BECAUSE THE STRIP SAYS IT (batch 62), so the page must hand the strip the same facts the
   * note is judged by (pdpSafetyNoteKind ← stripLineKind), render it unconditionally, and pick a partner line only for a
   * listing that links out — the one case where the note is null for its own reason.
   */
  it('the strip is in every safety block, fed the same category, subcategory and job facts, partner lines only when linked', () => {
    const block = PAGE.slice(PAGE.indexOf('<div data-safety-block="" className="order-9 md:order-7">'), PAGE.indexOf('</div>', PAGE.indexOf('<SafetyStrip')))
    const beforeStrip = block.slice(0, block.indexOf('<SafetyStrip')).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(beforeStrip).not.toMatch(/&&|\?/) // nothing conditional between the block and the strip
    expect(block).toContain('categorySlug={rawListing.category.slug}')
    expect(block).toContain('subcategorySlug={rawListing.subcategorySlug}')
    expect(block).toContain("job={listing.listingType === 'job'}")
    expect(block).toMatch(/variant=\{affiliateUrl \? \(/)
    expect(PAGE).toContain('const catSlug = rawListing.category.slug')
    expect(PAGE).toContain('const safetyNoteKind = pdpSafetyNoteKind({ listingType: listing.listingType, categorySlug: catSlug, subcategorySlug: rawListing.subcategorySlug, linked: !!affiliateUrl,')
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
  it('names the spec rows AND the attribute rows Details renders — and the ones batch 89 moved to the facts line or found in the H1', () => {
    // From the FULL spec list (the facts line prints the numeric specs now, Details none of them) and with restatedAttrs: those
    // facts are still on the page, so the description must not print its own rows for them again.
    expect(PAGE).toContain('hideRepeatedFacts([...numericSpecs, ...detailOnlySpecs].map((s) => s.label.toLowerCase()).concat(detailAttrs.map(([k]) => k), restatedAttrs))')
    // The spec labels lower-case to the keys rich-text.tsx uses.
    for (const label of ["label: 'Area'", "label: 'Year'", "label: 'Mileage'", "label: 'Engine'"]) expect(PAGE).toContain(label)
  })

  it('puts it on the description, not on Details', () => {
    expect(PAGE).toMatch(/<ListingDescription [^>]*className=\{`max-w-prose [^`]*\$\{repeatedFacts\}`\}/)
  })

  it('a LINKED job prints no description: the importer\'s template only repeats Details and the safety lines (2026-11-06 audit)', () => {
    expect(PAGE).toContain("const showDescription = !isJob && descNorm !== ''")
    // …keyed on the link-out, so an employer's own job post (no affiliateUrl) keeps its words.
    expect(PAGE).toContain("const isJob = !!affiliateUrl && listing.listingType === 'job'")
  })
})

/**
 * A3-PDP (2026-10-04) — the page-level halves, pinned on the source (the page is a server component with a
 * database behind it; the client halves are rendered in their own tests).
 */
describe('PDP — no repeated rows, no vehicle facts on parts, the brand chip keeps the reader’s language', () => {
  it('a job has no bottom safety note: its ID-documents advice is the SafetyStrip line beside Apply (2026-11-06 audit)', () => {
    // Every job, linked or not, gets no note (pdpSafetyNoteKind's first rule; pdp-safety-note.test.ts renders the matrix): the
    // strip carries never-pay, the training fee and the ID advice.
    expect(PAGE).toContain('const safetyNoteKind = pdpSafetyNoteKind({ listingType: listing.listingType,')
    expect(NOTE).toMatch(/: safetyNoteKind !== 'goods'\s*\n\s*\?\s*null/)
    const STRIP = readFileSync(join(process.cwd(), 'src/components/marketplace/safety-strip.tsx'), 'utf8')
    expect(STRIP).toMatch(/\{isJobStrip && \(\s*<p data-job-id-line=""/)
    expect(STRIP).toContain("const isJobStrip = categorySlug === 'jobs' || job")
    expect(STRIP).toContain("Don't send copies of your ID documents before you have checked the employer, and never pay for training.")
  })

  it('the Details "Source" fact is hidden when Seller information shows a Source row (pdp-09)', () => {
    expect(PAGE).toContain("if (sellerInfo?.kind === 'source' && sellerInfo.source.trim()) hiddenAttrs.add('source')")
    // …and SellerInfo itself still renders (the Decree 248 row stays).
    // (Its `max-md:` classes are batch 79's phone section hairline — ./section-hairline.test.tsx.)
    expect(PAGE).toContain('{sellerInfo && <SellerInfo info={sellerInfo} className="order-8 max-md:border-t max-md:border-border max-md:pt-6" />}')
  })

  it('mileage is a vehicle fact: only above 0 km and never on Vehicles › Parts (pdp-08)', () => {
    expect(PAGE).toMatch(/if \(listing\.mileageKm != null && listing\.mileageKm > 0 && rawListing\.subcategorySlug !== 'parts-gear'\) numericSpecs\.push\(\{ label: 'Mileage'/)
  })

  it('the brand link goes through localizedHref, like the breadcrumb (disc-missed) — an inline link in the facts line since batch 89', () => {
    expect(PAGE).toContain('<Link href={localizedHref(`/?brand=${encodeURIComponent(listing.brandSlug!)}`, pageVariant)} prefetch={false} className="text-foreground underline underline-offset-4">{brand.name}</Link>')
    // The old chip is gone: one brand link on the page.
    expect(PAGE.match(/\?brand=\$\{encodeURIComponent/g)).toHaveLength(1)
  })

  it('⛔ the inline brand link has no tap-44: its 44px hit area covered "See original" right above the line (review, 2026-11-13)', () => {
    const link = PAGE.match(/<Link href=\{localizedHref\(`\/\?brand=[^\n]*/)?.[0] ?? ''
    expect(link).not.toBe('')
    expect(link).not.toMatch(/tap-44/)
    // ⛔ Always underlined, not only on hover: axe link-in-text-block (serious) failed on live branded listings (2026-11-14).
    expect(link).toMatch(/className="[^"]*\bunderline\b(?!-)/)
    expect(link).not.toMatch(/hover:underline/)
  })

  it('⛔ the place is never dropped from the facts line for the title (built and withdrawn 2026-11-13)', () => {
    // "Phòng gần Quận 7" (a room NEAR District 7) would have hidden "District 7"; the English HTML's H1 is also translated in
    // the browser for nine languages, while the place never is.
    expect(PAGE).toContain("if (listing.location?.trim()) facts.push({ key: 'place', node: placeName })")
    expect(PAGE).not.toMatch(/headingRestatesValue|placeHeading/)
  })

  it('the H1, the market price and every meta item opt into the support bubble’s yield (pdp-01, si-11)', () => {
    // `[overflow-wrap:anywhere]` joined the class list (break-ui, 2026-10-05) — a title with no spaces must not widen the page.
    expect(PAGE).toContain('<LocalizedTitleHeading className="text-xl font-bold leading-snug sm:text-2xl sm:leading-tight text-foreground [overflow-wrap:anywhere]"')
    // The one H1 is LocalizedTitleHeading's (the only `<h1` left in the page is the layout comment).
    expect(PAGE.match(/<h1[\s>]/g) ?? []).toHaveLength(1)
    expect(PAGE.match(/<LocalizedTitleHeading className=/g)).toHaveLength(1)
    // Batch 89: the facts line opts in as one wide value (yield-only); a job's meta row keeps its items' own opt-ins.
    expect(PAGE).toMatch(/<div data-facts-line="" data-fab-avoid className=\{cn\('text-base text-muted-foreground \[overflow-wrap:anywhere\]'/)
    expect(PAGE).toContain('<span data-fab-avoid className="inline-flex shrink-0 items-center gap-1">')
    expect(PAGE).toContain('<span data-fab-avoid className="inline-flex min-w-0 items-center gap-1">')
    // The condition wraps with the line, never cut (break-ui, 2026-10-05: a 60-char free-text condition overflowed 320px).
    const line = PAGE.slice(PAGE.indexOf('<div data-facts-line'), PAGE.indexOf('</div>', PAGE.indexOf('<div data-facts-line')))
    expect(line).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap/)
    const MARKET = readFileSync(join(process.cwd(), 'src/components/marketplace/market-price.tsx'), 'utf8')
    expect(MARKET.match(/(?<!`)data-fab-avoid(?!`)/g)).toHaveLength(2) // the verdict and the range (not the comment)
    const CONTENT = readFileSync(join(process.cwd(), 'src/components/marketplace/listing-content.tsx'), 'utf8')
    expect(CONTENT).toContain('<h1 data-fab-avoid className={className}>')
  })

  it('the sign-in sheet gets the title the H1 shows (pdp-05)', () => {
    expect(PAGE).toMatch(/listingTitle=\{displayTitle\}\s*listingTitleVi=\{listing\.titleVi\}\s*listingTitleI18n=\{i18n\[listing\.title\]\}/)
  })
})
