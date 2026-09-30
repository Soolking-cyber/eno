import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('server-only', () => ({}))

import { importProvenance, SOURCE_DATE_SELLERS } from './import-provenance'
import { provenanceParts, type ProvenanceKind } from './import-provenance-copy'
import { IMPORT_SELLERS, RENTAL_IMPORT_SELLERS } from './import-sellers'
import { PARTNER_STORES } from './partner-stores'

/**
 * THE PROVENANCE LINE ON IMPORTED LISTINGS (SEO wave B, P1): which rows get it, which date it prints,
 * and that its words are the owner-approved ones (CS-2, 2026-09-30) and vouch for nothing.
 */

/** The provider's own rule for a literal pair: the Vietnamese as written, English otherwise. */
const trFor = (lang: string) => (en: string, vi: string) => (lang === 'vi' ? vi : en)
const line = (kind: ProvenanceKind, site: string, iso: string | null, lang: string) => {
  const p = provenanceParts({ kind, site, iso }, lang, trFor(lang))
  return p ? `${p.before}${p.date ?? ''}${p.after} · ${p.link}` : null
}

const POSTED = new Date('2026-09-12T05:00:00Z')
const CREATED = new Date('2026-09-25T05:00:00Z')
const row = (over: Partial<Parameters<typeof importProvenance>[0]>) => importProvenance({
  sellerId: 'nhatot-import-seller-0001', sellerName: 'Nhatot.com', affiliateUrl: 'https://www.nhatot.com/thue-can-ho/1.htm',
  listingType: 'rent', postedAt: POSTED, createdAt: CREATED, ...over,
})

describe('importProvenance: which listings get a line, and which date', () => {
  it('Chợ Tốt and Muaban print the SOURCE post date (the raw postedAt), never the import day', () => {
    expect(row({})).toEqual({ kind: 'source-date', site: 'Nhatot.com', iso: POSTED.toISOString() })
    expect(row({ sellerId: 'muaban-net-import-seller-0001', sellerName: 'Muaban.net' })).toEqual({ kind: 'source-date', site: 'Muaban.net', iso: POSTED.toISOString() })
  })

  it('Batdongsan, Rever and Honeycomb print the day eno imported the ad (createdAt) — P-g leaves Honeycomb\'s lastmod out', () => {
    for (const [sellerId, sellerName] of [['bds-vn-import-seller-0001', 'Batdongsan.com.vn'], ['cmub0wead0000zrq418bqq27m', 'Rever.vn'], ['honeycomb-import-seller-0001', 'Honeycomb House']]) {
      expect(row({ sellerId, sellerName })).toEqual({ kind: 'import-date', site: sellerName, iso: CREATED.toISOString() })
    }
  })

  it('every rental importer is covered, and the source-date sellers are a subset of the imports', () => {
    for (const id of SOURCE_DATE_SELLERS) {
      expect(RENTAL_IMPORT_SELLERS as readonly string[]).toContain(id)
      expect(IMPORT_SELLERS as readonly string[]).toContain(id)
    }
    for (const id of RENTAL_IMPORT_SELLERS) expect(row({ sellerId: id })).not.toBeNull()
  })

  it('a job never gets the line (P-b), even from an import seller', () => {
    expect(row({ listingType: 'job' })).toBeNull()
    expect(row({ sellerId: 'careerlink-vn-import-seller-0001', sellerName: 'CareerLink', listingType: 'job', affiliateUrl: 'https://www.careerlink.vn/x' })).toBeNull()
  })

  it('no checked link, no line — the line names a source the reader must be able to open', () => {
    expect(row({ affiliateUrl: null })).toBeNull()
  })

  it('a partner shop item gets the undated retail line when BOTH its host and its storefront name match', () => {
    const fpt = PARTNER_STORES.find((s) => s.domain === 'fptshop.com.vn')!
    expect(row({ sellerId: 'x', sellerName: fpt.name, listingType: 'sell', affiliateUrl: 'https://fptshop.com.vn/dien-thoai/iphone-15' }))
      .toEqual({ kind: 'retail', site: fpt.name, iso: null })
    // www. on the link is the same host.
    expect(row({ sellerId: 'x', sellerName: fpt.name, listingType: 'sell', affiliateUrl: 'https://www.fptshop.com.vn/dien-thoai/iphone-15' })?.kind).toBe('retail')
    // A storefront that only SHARES the name is not the shop; nor is the shop's name on another host.
    expect(row({ sellerId: 'x', sellerName: 'Some Shop', listingType: 'sell', affiliateUrl: 'https://fptshop.com.vn/dien-thoai/iphone-15' })).toBeNull()
    expect(row({ sellerId: 'x', sellerName: fpt.name, listingType: 'sell', affiliateUrl: 'https://example.com/dien-thoai/iphone-15' })).toBeNull()
  })

  it('each family is keyed on its listing type too: a sale under a rental importer, a rental under a shop', () => {
    expect(row({ listingType: 'sell' })).toBeNull()
    const fpt = PARTNER_STORES.find((s) => s.domain === 'fptshop.com.vn')!
    expect(row({ sellerId: 'x', sellerName: fpt.name, listingType: 'rent', affiliateUrl: 'https://fptshop.com.vn/x/y' })).toBeNull()
  })

  it('a shop whose storefront name is stored decomposed (NFD) is still the shop', () => {
    const tgdd = PARTNER_STORES.find((s) => s.domain === 'thegioididong.com')!
    expect(row({ sellerId: 'x', sellerName: tgdd.name.normalize('NFD'), listingType: 'sell', affiliateUrl: 'https://www.thegioididong.com/dtdd/x' })?.kind).toBe('retail')
  })

  it('any other affiliate row (a park ticket, an eSIM, a vehicle hire) gets nothing', () => {
    expect(row({ sellerId: 'vinwonders', sellerName: 'VinWonders', listingType: 'sell', affiliateUrl: 'https://vinwonders.com/en/ticket' })).toBeNull()
  })
})

describe('provenanceParts: the approved words (CS-2 P1-1 to P1-6), in both languages', () => {
  it('P1-1 / P1-4: a source-dated rental', () => {
    expect(line('source-date', 'Nhatot.com', '2026-09-12T05:00:00Z', 'en')).toBe('Source: Nhatot.com · posted there on 12 Sep 2026 · original ad')
    expect(line('source-date', 'Nhatot.com', '2026-09-12T05:00:00Z', 'vi')).toBe('Nguồn: Nhatot.com · đăng ngày 12/9/2026 · tin gốc')
  })

  it('P1-2: an import-dated rental', () => {
    expect(line('import-date', 'Rever.vn', '2026-09-25T05:00:00Z', 'en')).toBe('Source: Rever.vn · imported to eno on 25 Sep 2026 · original ad')
    expect(line('import-date', 'Rever.vn', '2026-09-25T05:00:00Z', 'vi')).toBe('Nguồn: Rever.vn · đưa lên eno ngày 25/9/2026 · tin gốc')
  })

  it('P1-3 / P1-5: a retail item, undated whatever it is given', () => {
    expect(line('retail', 'FPT Shop', '2026-09-25T05:00:00Z', 'en')).toBe("Source: FPT Shop's website · original page")
    expect(line('retail', 'FPT Shop', null, 'vi')).toBe('Nguồn: website của FPT Shop · trang gốc')
  })

  it('P1-6: the screen-reader suffix', () => {
    expect(provenanceParts({ kind: 'retail', site: 'x', iso: null }, 'en', trFor('en'))!.newTab).toBe('(opens in a new tab)')
    expect(provenanceParts({ kind: 'retail', site: 'x', iso: null }, 'vi', trFor('vi'))!.newTab).toBe('(mở trong tab mới)')
  })

  it('the day is VIETNAM\'s: 17:30Z is 00:30 the next morning in Hanoi, 16:59Z is still the same day', () => {
    const at = (iso: string, lang: string) => provenanceParts({ kind: 'source-date', site: 's', iso }, lang, trFor(lang))!
    expect(at('2026-09-12T17:30:00Z', 'en')).toMatchObject({ date: '13 Sep 2026', dateTime: '2026-09-13' })
    expect(at('2026-09-12T17:30:00Z', 'vi')).toMatchObject({ date: '13/9/2026', dateTime: '2026-09-13' })
    expect(at('2026-09-12T16:59:59Z', 'en')).toMatchObject({ date: '12 Sep 2026', dateTime: '2026-09-12' })
    // Month/year rollover at the same boundary.
    expect(at('2026-12-31T17:30:00Z', 'en')).toMatchObject({ date: '1 Jan 2027', dateTime: '2027-01-01' })
  })

  it('a dated rental with no readable date gets NO line — never "Invalid Date", never an unapproved wording', () => {
    expect(provenanceParts({ kind: 'source-date', site: 's', iso: 'nope' }, 'en', trFor('en'))).toBeNull()
    expect(provenanceParts({ kind: 'import-date', site: 's', iso: null }, 'vi', trFor('vi'))).toBeNull()
  })

  it('an NFD storefront name comes out NFC, and so does the whole Vietnamese line', () => {
    const nfd = 'Thế Giới Di Động'.normalize('NFD')
    const out = line('retail', nfd, null, 'vi')!
    expect(out).toBe('Nguồn: website của Thế Giới Di Động · trang gốc')
    expect(out).toBe(out.normalize('NFC'))
    for (const kind of ['source-date', 'import-date'] as const) {
      const vi = line(kind, nfd, '2026-09-12T05:00:00Z', 'vi')!
      expect(vi).toBe(vi.normalize('NFC'))
    }
  })

  it('"đ" is the letter U+0111 — not a bare d, not the currency sign ₫', () => {
    const vi = line('source-date', 's', '2026-09-12T05:00:00Z', 'vi')! + line('import-date', 's', '2026-09-12T05:00:00Z', 'vi')!
    expect(vi).toContain('đăng ngày')
    expect(vi).toContain('đưa lên eno')
    expect(vi).not.toMatch(/₫|\bdang ngay\b|\bdua len\b/)
  })

  it('a machine translation that lost or translated a placeholder falls back to the English sentence', () => {
    const at = (kind: ProvenanceKind, t: string) => {
      const p = provenanceParts({ kind, site: 'Nhatot.com', iso: '2026-09-12T05:00:00Z' }, 'fr', () => t)!
      return `${p.before}${p.date ?? ''}${p.after}`
    }
    expect(at('source-date', 'Source : {site}')).toBe('Source: Nhatot.com · posted there on 12 Sep 2026')
    expect(at('import-date', 'Source : {site} · importé le {date_fr}')).toBe('Source: Nhatot.com · imported to eno on 12 Sep 2026')
    expect(at('source-date', 'Quelle : · am {date}')).toBe('Source: Nhatot.com · posted there on 12 Sep 2026')
    expect(at('retail', 'Quelle : Webseite')).toBe("Source: Nhatot.com's website")
    // A translation that kept both placeholders is used as it is, wherever it puts them.
    expect(at('source-date', 'Le {date}, sur {site}')).toBe('Le 12 Sep 2026, sur Nhatot.com')
  })

  it('a storefront name with replacement patterns in it is printed as typed', () => {
    expect(line('retail', "A$&B$'C", null, 'en')).toBe("Source: A$&B$'C's website · original page")
    expect(line('source-date', 'X$`Y', '2026-09-12T05:00:00Z', 'vi')).toBe('Nguồn: X$`Y · đăng ngày 12/9/2026 · tin gốc')
  })
})

describe('the wording guard: the line vouches for nothing', () => {
  const COPY = readFileSync(join(process.cwd(), 'src/lib/import-provenance-copy.ts'), 'utf8')
  const pairs = [...COPY.matchAll(/\btr\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*('(?:[^'\\]|\\.)*')\s*\)/g)]
    .map((m) => [m[1].slice(1, -1), m[2].slice(1, -1)] as const)

  it('finds every approved pair as a literal tr(en, vi) — the ui-strings harvest reads only literals', () => {
    expect(pairs).toEqual(expect.arrayContaining([
      ["Source: {site}'s website", 'Nguồn: website của {site}'],
      ['original page', 'trang gốc'],
      ['Source: {site} · posted there on {date}', 'Nguồn: {site} · đăng ngày {date}'],
      ['Source: {site} · imported to eno on {date}', 'Nguồn: {site} · đưa lên eno ngày {date}'],
      ['original ad', 'tin gốc'],
      ['(opens in a new tab)', '(mở trong tab mới)'],
    ]))
    expect(pairs).toHaveLength(6)
  })

  it('no "verified", "checked", "protected", "trusted" or "partner" — in either language', () => {
    for (const [en, vi] of pairs) {
      expect(en).not.toMatch(/verif|check|protect|trust|partner|official|guarantee/i)
      expect(vi).not.toMatch(/xác minh|kiểm tra|bảo vệ|uy tín|tin cậy|đối tác|chính thức|đảm bảo|bảo đảm/i)
    }
  })

  it('the held machine-translation clause (P1-7, decision P-f) is not shipped', () => {
    expect(COPY).not.toMatch(/translated automatically|dịch tự động/)
  })
})
