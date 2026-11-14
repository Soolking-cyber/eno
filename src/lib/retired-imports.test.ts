import { describe, expect, it } from 'vitest'
import { IMPORTABLE_ACCESSTRADE_CAMPAIGNS, RETIRED_ACCESSTRADE_IMPORTS, SUPERSPORTS_RETIRED, importableCampaign, retiredImportReason } from './retired-imports'

describe('retiredImportReason — the AccessTrade importer, second-hand focus (2026-10-03)', () => {
  it('refuses the two new-goods campaigns by name, each with its reason', () => {
    expect([...RETIRED_ACCESSTRADE_IMPORTS.keys()].sort()).toEqual(['ben', 'tiki_creator'])
    for (const slug of ['tiki_creator', 'ben']) {
      expect(RETIRED_ACCESSTRADE_IMPORTS.has(slug), slug).toBe(true)
      expect(retiredImportReason(slug)).toBe(RETIRED_ACCESSTRADE_IMPORTS.get(slug))
      expect(retiredImportReason(` ${slug} `)).toBe(RETIRED_ACCESSTRADE_IMPORTS.get(slug))
    }
  })
  it('allows exactly the two used shelves the owner brought back (2026-11-14), both used-only', () => {
    expect([...IMPORTABLE_ACCESSTRADE_CAMPAIGNS.keys()].sort()).toEqual(['cellphones_cps', 'dienthoaivui', 'hoanghamobile', 'shopdunk_web'])
    for (const slug of ['cellphones_cps', 'dienthoaivui', ' dienthoaivui ']) {
      expect(retiredImportReason(slug), slug).toBeNull()
      expect(importableCampaign(slug)?.usedOnly).toBe(true)
      expect(importableCampaign(slug)?.why).toMatch(/2026-11-14/)
    }
  })
  it('refuses any other campaign: only a used-only campaign the owner named is importable', () => {
    for (const slug of ['shopee_cps', '', 'fpt_shop', 'constructor']) {
      expect(retiredImportReason(slug), slug).toMatch(/not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS/)
      expect(importableCampaign(slug)).toBeNull()
    }
    expect(retiredImportReason(null)).toMatch(/not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS/)
  })
  it('Hoàng Hà and ShopDunk (owner 2026-11-14 "All of them") are CRAWL campaigns, used-only and CHAT ONLY, with their ids', () => {
    expect(importableCampaign('hoanghamobile')).toMatchObject({ usedOnly: true, source: 'crawl', chatOnly: true, campaignId: '5229340396064683522' })
    expect(importableCampaign('shopdunk_web')).toMatchObject({ usedOnly: true, source: 'crawl', chatOnly: true, campaignId: '6800497735607325103' })
    // The datafeed shelves are neither crawled nor chat-only by declaration (their eno-run status is the pinned pair).
    expect(importableCampaign('cellphones_cps')?.source).toBeUndefined()
    expect(importableCampaign('dienthoaivui')?.chatOnly).toBeUndefined()
  })
  it('names the decision in the SuperSports refusal', () => {
    expect(SUPERSPORTS_RETIRED).toMatch(/2026-10-02/)
    expect(SUPERSPORTS_RETIRED).toMatch(/second-hand focus/)
  })
})
