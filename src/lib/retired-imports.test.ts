import { describe, expect, it } from 'vitest'
import { IMPORTABLE_ACCESSTRADE_CAMPAIGNS, RETIRED_ACCESSTRADE_IMPORTS, SUPERSPORTS_RETIRED, retiredImportReason } from './retired-imports'

describe('retiredImportReason — the AccessTrade importer, second-hand focus (2026-10-03)', () => {
  it('refuses the four retired campaigns by name, each with its reason', () => {
    for (const slug of ['tiki_creator', 'cellphones_cps', 'ben', 'dienthoaivui']) {
      expect(RETIRED_ACCESSTRADE_IMPORTS.has(slug), slug).toBe(true)
      expect(retiredImportReason(slug)).toBe(RETIRED_ACCESSTRADE_IMPORTS.get(slug))
      expect(retiredImportReason(` ${slug} `)).toBe(RETIRED_ACCESSTRADE_IMPORTS.get(slug))
    }
  })
  it('refuses any other campaign too: the importer creates every product as new, and the allow-list is empty', () => {
    expect(IMPORTABLE_ACCESSTRADE_CAMPAIGNS.size).toBe(0)
    expect(retiredImportReason('shopee_cps')).toMatch(/not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS/)
    expect(retiredImportReason('')).toMatch(/not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS/)
  })
  it('names the decision in the SuperSports refusal', () => {
    expect(SUPERSPORTS_RETIRED).toMatch(/2026-10-02/)
    expect(SUPERSPORTS_RETIRED).toMatch(/second-hand focus/)
  })
})
