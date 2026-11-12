import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ONE SAFETY CARD ON A PHONE (UI climb batch 70, 2026-11-12; blind A/B +0.10 GPT / +0.15 Opus, trust up in both): below md the
 * listing page's safety strip is a `tint` well; md and up keep the flat buy-box line. Report stays red (owner, 2026-07-08); Block
 * reads in ink-4 on the tint (chosen when muted-foreground was 4.35:1 there; 6.42:1 since its 2026-11-12 darkening, and ink-4,
 * 5.68:1, stays as the quieter ink). The browser check is in the batch's commit message.
 */
describe('the phone safety well (batch 70)', () => {
  const page = readFileSync('src/app/[lang]/listings/[id]/(pdp)/page.tsx', 'utf8')
  it('the strip is a tint well below md only — every class is max-md:', () => {
    expect(page).toContain('className="max-md:rounded-2xl max-md:border-t-0 max-md:bg-tint max-md:px-3.5 max-md:pb-2.5 max-md:pt-3.5"')
  })
  it('Block is ink-4 below md (AA on the tint); Report keeps its own red', () => {
    expect(page).toMatch(/<BlockUserButton [^>]*className="max-md:text-ink-4 lg:text-sm"/)
    expect(page).toMatch(/<ReportButton listingId=\{listing\.id\} className="lg:text-sm" \/>/)
  })
})
