import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PAGE_WELL, SHEET_BLOCK, SHEET_REPORT, SHEET_WELL } from '@/lib/rental-sheet'
import { JOB_COUNSEL, JOB_COUNSEL_STRIP } from '@/lib/job-sheet'

/**
 * ONE SAFETY CARD ON A PHONE (UI climb batch 70, 2026-11-12; blind A/B +0.10 GPT / +0.15 Opus, trust up in both): below md the
 * listing page's safety strip is a `tint` well; md and up keep the flat buy-box line. Report stays red (owner, 2026-07-08); Block
 * reads in ink-4 on the tint (chosen when muted-foreground was 4.35:1 there; 6.42:1 since its 2026-11-12 darkening, and ink-4,
 * 5.68:1, stays as the quieter ink). The browser check is in the batch's commit message.
 */
describe('the phone safety well (batch 70)', () => {
  const page = readFileSync('src/app/[lang]/listings/[id]/(pdp)/page.tsx', 'utf8')
  it('the strip is a tint well below md only — every class is max-md: (the rental sheet\'s too)', () => {
    expect(PAGE_WELL).toBe('max-md:rounded-2xl max-md:border-t-0 max-md:bg-tint max-md:px-3.5 max-md:pb-2.5 max-md:pt-3.5')
    for (const c of [...PAGE_WELL.split(' '), ...SHEET_WELL.split(' ')]) expect(c).toMatch(/^max-md:/)
    // …and the goods sheet's counsel panel (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts), max-md: too.
    // …and a linked job's (owner-approved 2026-11-14, cook r06 jobs; src/lib/job-sheet.ts): the panel is the block's wrapper
    // (JOB_COUNSEL), the strip drops its own top line and padding inside it (JOB_COUNSEL_STRIP) — max-md: too.
    expect(page).toContain('className={rentalSheet ? SHEET_WELL : goodsSheet ? (sellerInfoShown ? COUNSEL_STRIP_JOINED : COUNSEL_STRIP_ALONE) : isJob ? JOB_COUNSEL_STRIP : PAGE_WELL}')
    expect(page).toContain('quiet={rentalSheet || goodsSheet || isJob}')
    for (const c of [...JOB_COUNSEL.split(' '), ...JOB_COUNSEL_STRIP.split(' ')]) expect(c).toMatch(/^max-md:/)
  })
  it('Block is ink-4 below md (AA on the tint); Report keeps its own red — except on the rental sheet', () => {
    expect(page).toMatch(/<BlockUserButton [^>]*className=\{rentalSheet \? SHEET_BLOCK : goodsSheet \? COUNSEL_BLOCK : 'max-md:text-ink-4 lg:text-sm'\}/)
    expect(page).toMatch(/<ReportButton listingId=\{listing\.id\} className=\{rentalSheet \? SHEET_REPORT : goodsSheet \? COUNSEL_REPORT : 'lg:text-sm'\} \/>/)
  })
})

/**
 * ⛔ THE RENTAL SHEET'S WELL (owner-approved 2026-11-14, cook r05 "rental-c"; it reverses "Report stays red" there only): the
 * panel recipe, Report and Block as quiet body-ink labels, 700 14 with 16px glyphs and a 44px height. Every class max-md:
 * but the `lg:text-sm` the page has always passed (desktop unchanged).
 */
describe('the rental sheet\'s safety well (cook r05)', () => {
  it('Report and Block: body ink, bold 14, 16px glyphs, 44px — never red, never ink-4 — below md only', () => {
    for (const cls of [SHEET_REPORT, SHEET_BLOCK]) {
      const c = cls.split(' ')
      expect(c).toEqual(expect.arrayContaining(['max-md:text-body', 'max-md:text-sm', 'max-md:font-bold', 'max-md:min-h-11', 'max-md:[&_svg]:size-4', 'lg:text-sm']))
      expect(c.filter((x) => !x.startsWith('max-md:'))).toEqual(['lg:text-sm'])
      expect(cls).not.toMatch(/destructive|ink-4/)
    }
  })
  it('the well: field grey, 12 radius, 16 padding over a 4px foot — and no line over it', () => {
    expect(SHEET_WELL.split(' ')).toEqual(['max-md:rounded-xl', 'max-md:border-t-0', 'max-md:bg-tint', 'max-md:p-4', 'max-md:pb-1'])
  })
})
