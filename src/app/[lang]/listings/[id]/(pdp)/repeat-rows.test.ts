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
