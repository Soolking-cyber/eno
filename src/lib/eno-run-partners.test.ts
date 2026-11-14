import { describe, expect, it } from 'vitest'
import { ENO_RUN_SELLER_IDS } from './eno-run-sellers'
import { ENO_RUN_PARTNERS, enoRunPartnerSellerIds, enoRunPartnerSql, enoRunPartnerWhere, isEnoRunPartner, type EnoRunPartner } from './eno-run-partners'

const CPS = 'cmt78nvif0000gpq48kvzmxjw'
const OWNER = '11111111-2222-4333-8444-555555555555'
const LIST: EnoRunPartner[] = [{ sellerId: CPS, ownerProfileId: OWNER, name: 'CellphoneS' }]

describe('eno-run partners — a pinned (seller, owner) pair, flagged officialPartner (owner 2026-11-14)', () => {
  it('pins exactly the two eno-held logins the claim script created (2026-11-15) — and only those owners count', () => {
    expect(ENO_RUN_PARTNERS.map((p) => p.sellerId)).toEqual(['cmt78nvif0000gpq48kvzmxjw', 'cmtr9qva90000glq44fkjs18b'])
    for (const p of ENO_RUN_PARTNERS) {
      expect(isEnoRunPartner({ id: p.sellerId, ownerId: p.ownerProfileId, officialPartner: true })).toBe(true)
      expect(isEnoRunPartner({ id: p.sellerId, ownerId: OWNER, officialPartner: true })).toBe(false)
    }
    expect(enoRunPartnerSql('s.')).toContain('(s.id, s."ownerId") IN (')
    expect(enoRunPartnerWhere()).toHaveLength(2)
  })
  it('only the exact pair counts — another owner of the same storefront (a stranger\'s claim) gains nothing', () => {
    expect(isEnoRunPartner({ id: CPS, ownerId: OWNER, officialPartner: true }, LIST)).toBe(true)
    expect(isEnoRunPartner({ id: CPS, ownerId: '99999999-2222-4333-8444-555555555555', officialPartner: true }, LIST)).toBe(false)
    expect(isEnoRunPartner({ id: CPS, ownerId: null, officialPartner: true }, LIST)).toBe(false)
    expect(isEnoRunPartner({ id: 'cmtr9qva90000glq44fkjs18b', ownerId: OWNER, officialPartner: true }, LIST)).toBe(false)
  })
  it('and only while flagged officialPartner (a flag eno alone sets)', () => {
    expect(isEnoRunPartner({ id: CPS, ownerId: OWNER, officialPartner: false }, LIST)).toBe(false)
    expect(isEnoRunPartner({ id: CPS, ownerId: OWNER }, LIST)).toBe(false)
  })
  it('the SQL and Prisma twins say the same pair', () => {
    expect(enoRunPartnerSql('s.', LIST)).toBe(`((s.id, s."ownerId") IN (('${CPS}', '${OWNER}'::uuid)) AND s."officialPartner")`)
    expect(enoRunPartnerWhere(LIST)).toEqual([{ id: CPS, ownerId: OWNER, officialPartner: true }])
    expect(enoRunPartnerSellerIds(LIST)).toEqual([CPS])
  })
  it('the client-side seller-id list (the strip) is exactly the pinned pairs\' seller ids — no owner id leaves the server', () => {
    expect([...ENO_RUN_SELLER_IDS]).toEqual(enoRunPartnerSellerIds())
  })
  it('refuses a malformed pair or alias before any SQL is built', () => {
    expect(() => enoRunPartnerSql('s.', [{ sellerId: "x'); drop table", ownerProfileId: OWNER, name: 'x' }])).toThrow(/malformed/)
    expect(() => enoRunPartnerSql('s.', [{ sellerId: CPS, ownerProfileId: 'not-a-uuid', name: 'x' }])).toThrow(/malformed/)
    expect(() => enoRunPartnerSql('s; drop', LIST)).toThrow(/alias/)
  })
})
