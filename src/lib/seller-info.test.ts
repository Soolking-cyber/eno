import { describe, expect, it } from 'vitest'
import { buildSellerInfo, sellerIdentityHolder, sellerIdentityPublishable, sourceActionFor, SELLER_INFO_NOTICE_SINCE } from './seller-info'

/**
 * "Seller information" is SWITCHED OFF for business identities until owner + counsel sign off (review,
 * 2026-10-01): every stored identity was typed under a "never shown" notice. These pin the switch, the
 * saved-after-the-notice rule, and the company/person split that keeps a person's home address off the page.
 */
const company = { legalName: 'Công ty TNHH ABC', legalAddress: '1 Lê Lợi, Quận 1', taxCode: '0312345678', idNumber: '0312345678', identityUpdatedAt: new Date('2026-11-02T00:00:00Z') }
const person = { ...company, legalName: 'Nguyễn Văn A', legalAddress: '12 Ngõ 3, Hà Nội', taxCode: '8012345678', idNumber: '079123456789' }
const ON = '2026-11-01T17:00:00Z'

describe('the switch', () => {
  it('ships OFF', () => {
    expect(SELLER_INFO_NOTICE_SINCE).toBeNull()
  })

  it('off → a business shows NOTHING, whatever it entered', () => {
    expect(buildSellerInfo({ linkedShop: false, isBusiness: true, storefrontName: 'ABC', identity: company, linkedListingTypes: [] })).toBeNull()
  })

  it('a linked shop still names its source while it is off — that is nobody’s personal data', () => {
    expect(buildSellerInfo({ linkedShop: true, isBusiness: false, storefrontName: 'Batdongsan.com.vn', identity: company, linkedListingTypes: ['rent'] })).toEqual({ kind: 'source', source: 'Batdongsan.com.vn', action: 'rent' })
  })
})

describe('on — only an identity saved under the new notice', () => {
  it('saved on/after the instant → shown; before it (under the old promise) or never stamped → not', () => {
    expect(sellerIdentityPublishable(new Date('2026-11-01T17:00:00Z'), ON)).toBe(true)
    expect(sellerIdentityPublishable(new Date('2026-11-01T16:59:59Z'), ON)).toBe(false)
    expect(sellerIdentityPublishable(null, ON)).toBe(false)
    expect(sellerIdentityPublishable(new Date(), null)).toBe(false)
    expect(sellerIdentityPublishable(new Date(), 'not a date')).toBe(false)
  })

  it('a company shows name, address and tax code', () => {
    expect(buildSellerInfo({ linkedShop: false, isBusiness: true, storefrontName: 'ABC', identity: company, linkedListingTypes: [] }, ON)).toEqual({
      kind: 'business', holder: 'company', legalName: 'Công ty TNHH ABC', legalAddress: '1 Lê Lợi, Quận 1', taxCode: '0312345678',
    })
  })

  it('a person (CCCD) shows the name only — never the home address or a personal tax code', () => {
    expect(buildSellerInfo({ linkedShop: false, isBusiness: true, storefrontName: 'A', identity: person, linkedListingTypes: [] }, ON)).toEqual({
      kind: 'business', holder: 'person', legalName: 'Nguyễn Văn A', legalAddress: null, taxCode: null,
    })
  })

  it('an individual account shows nothing; the props never carry the ID number', () => {
    expect(buildSellerInfo({ linkedShop: false, isBusiness: false, storefrontName: 'A', identity: company, linkedListingTypes: [] }, ON)).toBeNull()
    expect(JSON.stringify(buildSellerInfo({ linkedShop: false, isBusiness: true, storefrontName: 'A', identity: person, linkedListingTypes: [] }, ON))).not.toContain('079123456789')
  })
})

describe('sellerIdentityHolder — unknown reads as a person (it publishes less)', () => {
  it.each([
    ['0312345678', 'company'],
    ['0312345678-001', 'company'],
    ['0312345678001', 'company'],
    ['079123456789', 'person'],
    ['123456789', 'person'],
    ['', 'person'],
    [null, 'person'],
  ] as const)('%s → %s', (id, want) => {
    expect(sellerIdentityHolder(id)).toBe(want)
  })
})

/**
 * THE SOURCE CAPTION'S VERB (2026-10-01): "you contact or buy on the source website" also rendered on linked
 * JOB and RENTAL PDPs. A job is applied for; a rental (home or vehicle hire — both listingType 'rent') is
 * contacted or booked; a mix claims no verb.
 */
describe('sourceActionFor', () => {
  it.each([
    [['job'], 'apply'],
    [['job', 'job'], 'apply'],
    [['rent'], 'rent'],
    [['sell'], 'buy'],
    [['sell', 'service', 'event'], 'buy'],
    [['rent', 'job'], 'any'],
    [['sell', 'rent'], 'any'],
    [[], 'any'],
  ] as const)('%j → %s', (types, want) => {
    expect(sourceActionFor(types)).toBe(want)
  })

  it('reaches the props: a job board PDP gets apply, an import shop with no live rows gets any', () => {
    expect(buildSellerInfo({ linkedShop: true, isBusiness: false, storefrontName: 'VietnamWorks', identity: company, linkedListingTypes: ['job'] })).toEqual({ kind: 'source', source: 'VietnamWorks', action: 'apply' })
    expect(buildSellerInfo({ linkedShop: true, isBusiness: false, storefrontName: 'Tiki', identity: company, linkedListingTypes: [] })).toEqual({ kind: 'source', source: 'Tiki', action: 'any' })
  })
})
