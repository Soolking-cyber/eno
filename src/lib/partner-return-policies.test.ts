import { describe, expect, it } from 'vitest'
import { ENO_RUN_PARTNERS } from './eno-run-partners'
import { PARTNER_RETURN_POLICIES, partnerReturnPolicy } from './partner-return-policies'

describe('partner return policies', () => {
  it("every eno-run partner shop has its own policy page, under its own name", () => {
    for (const p of ENO_RUN_PARTNERS) expect(PARTNER_RETURN_POLICIES[p.sellerId]?.name, p.name).toBe(p.name)
  })

  it('every policy is an https page on a site other than eno.vn', () => {
    for (const { url } of Object.values(PARTNER_RETURN_POLICIES)) {
      const u = new URL(url)
      expect(u.protocol, url).toBe('https:')
      expect(u.hostname.endsWith('eno.vn'), url).toBe(false)
    }
  })

  it('an unknown or empty seller, or a prototype key, has none', () => {
    expect(partnerReturnPolicy('someone-else')).toBeNull()
    expect(partnerReturnPolicy(null)).toBeNull()
    expect(partnerReturnPolicy('constructor')).toBeNull()
    expect(partnerReturnPolicy('cmt78nvif0000gpq48kvzmxjw')?.name).toBe('CellphoneS')
  })
})
