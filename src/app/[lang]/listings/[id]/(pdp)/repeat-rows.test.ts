/**
 * Batches 83–84 (UI climb, 2026-11-13): the listing page stops repeating itself, and only where the same fact is already on
 * the page. Source pins, like the other contracts in this folder: page.tsx is a server component too heavy to render here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

describe('batch 84 — a linked job\'s Details do not repeat its header', () => {
  const block = PAGE.slice(PAGE.indexOf('  if (isJob) {\n    const heading'), PAGE.indexOf('  /**', PAGE.indexOf('  if (isJob) {\n    const heading')))
  it('is keyed on isJob only, so an employer\'s own job and every other listing keep their rows', () => {
    expect(block).toMatch(/^ {2}if \(isJob\) \{/)
  })
  it('drops Employer only when the heading this variant prints names it (pdp-repeat-rows.ts, unit-tested there)', () => {
    expect(block).toContain("const heading = lang === 'vi' ? viTitle(listing.title, listing.titleVi, i18n[listing.title]) : listing.title")
    expect(block).toContain("if (headingNamesEmployer(heading, listing.attributes?.employer)) hiddenAttrs.add('employer')")
  })
  it("isJob is a LINKED job only — an employer's own job keeps every row", () => {
    expect(PAGE).toContain("const isJob = !!affiliateUrl && listing.listingType === 'job'")
  })
  it('drops Posted (the header prints "Posted <ago>" on every linked job) and Apply by only for a YYYY-MM-DD date', () => {
    expect(block).toContain("hiddenAttrs.add('postedOn')")
    expect(block).toContain("if (jobApplyBy && /^\\d{4}-\\d{2}-\\d{2}$/.test(jobApplyBy)) hiddenAttrs.add('applyBy')")
  })
  it('hides rows through hiddenAttrs, before detailAttrs and showDetails are computed — never deletes the attributes', () => {
    expect(PAGE.indexOf("hiddenAttrs.add('applyBy')")).toBeLessThan(PAGE.indexOf('const detailAttrs = attrs.filter'))
    expect(block).not.toMatch(/delete |attributes\.\w+ =/)
  })
})

describe('batch 83 — a GoPlus room\'s template description is not shown', () => {
  it('folds into showDescription after the clauses safety-note-and-facts pins, for a GoPlus room only', () => {
    expect(PAGE).toContain("descNorm !== normText(listing.titleVi ?? '')\n    && !(goplusRoom && isGoplusTemplateDescription({ description: listing.description, title: listing.title, ...(lang === 'vi' ? { descriptionVi: listing.descriptionVi ?? '', titleVi: listing.titleVi } : {}) }))")
  })
  it('decides per server variant: only the Vietnamese page tests the Vietnamese column (where the staff extras live)', () => {
    expect(PAGE).toMatch(/const \{ id, lang \} = await params/)
  })
  it('the metadata still reads the stored description', () => {
    expect(PAGE).toMatch(/plainSnippet\(listing\.description/)
  })
})

describe('batch 95 — the job page says it once (owner-approved 2026-11-14, decision 3)', () => {
  it('the role-only H1 is decided once, for a LINKED job only, by roleOnlyHeading (pdp-repeat-rows.ts, unit-tested there)', () => {
    expect(PAGE.match(/roleOnlyHeading\(/g)).toHaveLength(1)
    expect(PAGE).toContain('const roleHeading = isJob ? roleOnlyHeading({ title: listing.title, titleVi: listing.titleVi, i18n: i18n[listing.title], employer: listing.attributes?.employer, storefront: listing.seller.name }) : null')
    expect(PAGE).toContain('const h1Text = roleHeading ?? { title: listing.title, titleVi: listing.titleVi, i18n: i18n[listing.title] ?? null }')
  })
  it('only the H1 reads it: same class list, fed the role props', () => {
    expect(PAGE).toContain('<LocalizedTitleHeading className="text-xl font-bold leading-snug sm:text-2xl sm:leading-tight text-foreground [overflow-wrap:anywhere]" title={h1Text.title} titleVi={h1Text.titleVi} i18n={h1Text.i18n} />')
    expect(PAGE.match(/h1Text\./g)).toHaveLength(3)
  })
  it('⛔ the <title>, og and share titles, the md+ crumb leaf and the Details heading keep the full title', () => {
    expect(PAGE).toContain('const titleFor = vi ? viTitle(listing.title, listing.titleVi, titleI18n) : listing.title')
    expect(PAGE.match(/const displayTitle = listing\.title/g)).toHaveLength(2)
    expect(PAGE).toContain('<span className="hidden font-medium text-foreground md:inline"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></span>')
    expect(PAGE).toContain('<ShareButton url={canonicalUrl} title={displayTitle} className="border border-border" />')
  })
  it('no "Salary: see the original posting": a no-pay linked job renders no price block at all', () => {
    expect(PAGE).not.toContain('en="Salary: see the original posting"')
    // An empty or whitespace-only salaryText states no pay either (batch 95 review).
    expect(PAGE).toContain("const noPayLine = isJob && listing.price === 0 && !(typeof listing.attributes?.salaryText === 'string' && listing.attributes.salaryText.trim())")
    expect(PAGE).toContain('const priceBlock = !(noPayLine && !listing.urgent && !(listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price)))')
    expect(PAGE).toMatch(/\{priceBlock && \(\n\s*<div className="flex flex-col gap-1\.5">/)
    // An employer's own job keeps "Salary: negotiable" (owner 2026-10-01), at its weight.
    expect(PAGE).toContain('<span className="text-base font-semibold text-body"><Bilingual en="Salary: negotiable" vi="Lương: thỏa thuận" /></span>')
  })
  it('the deadline\'s year is decided from the data (postedOn vs applyBy), never the clock', () => {
    const line = PAGE.slice(PAGE.indexOf('  const jobPostedOn = '), PAGE.indexOf('\n', PAGE.indexOf('  const applyByYear = ')))
    expect(line).toContain('const applyByYear = !(jobPostedOn && jobApplyBy && jobPostedOn.slice(0, 4) === jobApplyBy.slice(0, 4))')
    expect(line).not.toMatch(/Date|now\(/)
    expect(PAGE).toContain('applyByYear={applyByYear}')
  })
  it('both storefront rows are the same call, unchanged: the job branch lives in PdpShopLink', () => {
    const calls = PAGE.match(/<PdpShopLink [^\n]*\/>/g)!
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe(calls[1])
    expect(calls[0]).toContain('linked={linkedSeller}')
  })
})
