import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VIETKITE,
  checkSeller,
  fingerprint,
  forward,
  isExpressTier,
  parseArgs,
  parseJournal,
  planAll,
  revert,
  rewriteText,
  speedModeFor,
} from '../../scripts/fix-vietkite-visa-claims.mjs'

/**
 * scripts/fix-vietkite-visa-claims.mjs (B4, docs/ios-appstore-release.md §5): the claim rules on text, the
 * express rule, and a dry run → apply → revert over a MOCK client. No database is touched.
 */

const strip = (s: string) => rewriteText(s, { speed: 'strip' }).text

describe('official claims', () => {
  it('rewrites "official assistance" and keeps the service it describes', () => {
    expect(strip('Official assistance. Secure application.')).toBe('Application assistance. Secure application.')
    expect(strip('- Official assistance\n- Multiple entry')).toBe('- Application assistance\n- Multiple entry')
    expect(strip('OFFICIAL ASSISTANCE')).toBe('APPLICATION ASSISTANCE')
    expect(strip('Hỗ trợ chính thức. Hồ sơ an toàn.')).toBe('Hỗ trợ làm hồ sơ. Hồ sơ an toàn.')
  })

  it('removes every other "official" / "chính thức", tidying grammar around it', () => {
    expect(strip('We are the official partner of eno.')).toBe('We are the partner of eno.')
    expect(strip('VietKite is an official visa agent.')).toBe('VietKite is a visa agent.')
    expect(strip('Officially registered travel agency.')).toBe('Registered travel agency.')
    expect(strip('Fast, official and secure.')).toBe('Fast and secure.')
    expect(strip('Visa điện tử chính thức do Cục cấp.')).toBe('Visa điện tử do Cục cấp.')
    expect(strip('Chính thức hoạt động từ 2015.')).toBe('Hoạt động từ 2015.')
  })

  it('matches Vietnamese however it was typed, and writes back in the same form', () => {
    const nfd = 'Hỗ trợ chính thức. Visa chính thức.'.normalize('NFD')
    expect(strip(nfd)).toBe('Hỗ trợ làm hồ sơ. Visa.'.normalize('NFD'))
    expect(strip('Dịch vụ chính thức')).toBe('Dịch vụ')
  })

  it("keeps the government's own channel, negations, other words and links", () => {
    for (const s of [
      'Apply at the official website https://evisa.gov.vn.',
      'Official source: https://evisa.gov.vn',
      'Đăng ký tại trang web chính thức https://evisa.gov.vn của Cục Quản lý xuất nhập cảnh.',
      'Immigration officials decide every case.',
      'This page is not official.',
      'Đây là kênh không chính thức.',
      'An unofficial guide.',
      'See https://vietkite.com.vn/official-visa now',
    ]) expect(strip(s)).toBe(s)
    expect(strip('Follow our official Facebook page.')).toBe('Follow our Facebook page.')
  })
})

describe('24-hour claims', () => {
  it('removes the tagline with the VISA that leads it, and the separator it leaves', () => {
    expect(strip('VietKite Travel & Visa – VISA 24 GIỜ')).toBe('VietKite Travel & Visa')
    expect(strip('Vietnam E-Visa - Single Entry - Standard - VISA 24 GIỜ')).toBe('Vietnam E-Visa - Single Entry - Standard')
    expect(strip('Line one.\n\nVISA 24 GIỜ\n\nLine two.')).toBe('Line one.\n\nLine two.')
    expect(strip('Line one.\r\nVISA 24 GIỜ\r\nLine three.')).toBe('Line one.\r\nLine three.')
  })

  it('removes the speed phrase, its preposition, a range, and a label left with no value', () => {
    expect(strip('Get your visa within 24 hours.')).toBe('Get your visa.')
    expect(strip('e-Visa 24h service')).toBe('e-Visa service')
    expect(strip('Processed in 24-72 hours.')).toBe('Processed.')
    expect(strip('Có visa trong vòng 24 giờ.')).toBe('Có visa.')
    expect(strip('Single entry\nProcessing time: 24 hours\nPrice below')).toBe('Single entry\nPrice below')
  })

  it('keeps availability, other figures, and every claim on a row that is not stripped', () => {
    for (const s of ['24h support on WhatsApp', 'Hỗ trợ 24 giờ mỗi ngày', 'Support 24/7.', 'Within 48 hours.']) expect(strip(s)).toBe(s)
    for (const speed of ['express', 'conflict', 'no-chip', 'not-evisa']) {
      expect(rewriteText('VietKite Travel & Visa – VISA 24 GIỜ', { speed }).text).toBe('VietKite Travel & Visa – VISA 24 GIỜ')
    }
  })
})

describe('the express rule', () => {
  it('express = hour tiers and one working day (VISA_SPEED_SPECS)', () => {
    expect(['1H', '2H', '4H', '1D'].every(isExpressTier)).toBe(true)
    expect(['2D', '3D', 'normal', '24h'].some(isExpressTier)).toBe(false)
  })

  const row = (o: Record<string, unknown> = {}) => ({
    id: 'x', status: 'active', categorySlug: 'services', subcategorySlug: 'visa-legal',
    title: 'Vietnam E-Visa - Single Entry - Standard', titleVi: null, attributes: '{"visaEntryType":"single","visaSpeed":"normal"}', ...o,
  })

  it("is decided by the row's own chip, with its title as a cross-check", () => {
    expect(speedModeFor(row()).mode).toBe('strip')
    expect(speedModeFor(row({ title: 'Vietnam E-Visa - 1 Business Day', attributes: '{"visaSpeed":"1D"}' })).mode).toBe('express')
    expect(speedModeFor(row({ title: 'Vietnam E-Visa - 1 Business Day' })).mode).toBe('conflict')
    expect(speedModeFor(row({ title: 'Vietnam E-Visa - Express', attributes: '{"visaSpeed":"3D"}' })).mode).toBe('conflict')
    expect(speedModeFor(row({ titleVi: 'Visa điện tử 90 ngày - Tiêu chuẩn' })).mode).toBe('strip')
    expect(speedModeFor(row({ attributes: '{"visaSpeed":"24h"}' })).mode).toBe('no-chip')
    expect(speedModeFor(row({ subcategorySlug: 'tours' })).mode).toBe('not-evisa')
  })
})

describe('plan safety', () => {
  const cols = ['title', 'description']
  const base = { id: 'r1', status: 'active', categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{"visaSpeed":"normal"}', searchText: '' }

  it('does not write a row whose rewrite would leave a short title or a dangling word', () => {
    const p = planAll([{ ...base, title: 'VISA 24 GIỜ', description: 'VietKite is official.' }], cols)
    expect(p.writes).toHaveLength(0)
    expect(p.plans[0].human.join(' ')).toMatch(/title.*(empty|under 3)/)
    expect(p.plans[0].human.join(' ')).toMatch(/dangling/)
  })

  it('fingerprints exactly what would be written', () => {
    const a = planAll([{ ...base, title: 'Vietnam E-Visa - Standard', description: 'Official assistance.' }], cols)
    const b = planAll([{ ...base, title: 'Vietnam E-Visa - Standard', description: 'Official assistance!' }], cols)
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(fingerprint(a.writes)).toBe(a.fingerprint)
  })

  it('accepts VietKite only when id, handle, owner and partnership agree', () => {
    const s = { id: VIETKITE.id, name: 'VietKite', officialPartner: true, email: VIETKITE.email, handle: VIETKITE.handle }
    expect(checkSeller([s]).seller).toBeTruthy()
    expect(checkSeller([]).error).toBeTruthy()
    expect(checkSeller([s, { ...s, id: 'other' }]).error).toBeTruthy()
    expect(checkSeller([{ ...s, officialPartner: false }]).error).toBeTruthy()
    expect(checkSeller([{ ...s, handle: 'vk' }]).error).toBeTruthy()
    expect(checkSeller([{ ...s, id: 'x1' }]).error).toBeTruthy()
    expect(checkSeller([{ ...s, id: 'x1' }], { sellerIdOverride: 'x1' }).seller).toBeTruthy()
  })

  it('refuses unknown flags and a flag without its value', () => {
    for (const a of [['--aply'], ['--plan'], ['--apply=1'], ['--revert', '--apply']]) expect(() => parseArgs(a)).toThrow()
    expect(parseArgs(['--apply', '--plan=abc'])).toEqual({ apply: true, plan: 'abc' })
  })
})

// ── dry run → apply → revert over a mock client ───────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string }
const COLS = ['id', 'title', 'titleVi', 'description', 'descriptionVi', 'location', 'district', 'city', 'condition', 'model', 'images', 'attributes', 'searchText', 'status', 'sellerId']

function fixture(): Map<string, Row> {
  const table = new Map<string, Row>()
  for (const [id, speed, label] of [['vk1', 'normal', 'Standard'], ['vk2', '1D', '1 Business Day']]) {
    table.set(id, {
      id, sellerId: VIETKITE.id, status: 'active', complianceStatus: 'clear', soldAt: null, categoryId: 'c', subcategorySlug: 'visa-legal',
      title: `Vietnam E-Visa - Single Entry - ${label}`, titleVi: null, location: 'Hồ Chí Minh', district: null, city: 'Hồ Chí Minh', condition: null, model: null,
      brandSlug: null, images: '["https://cdn/x.webp"]', attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: speed }), searchText: 'old',
      description: 'Included:\n- Official assistance\n\nApply yourself at the official website https://evisa.gov.vn.\n\nVietKite Travel & Visa – VISA 24 GIỜ',
      descriptionVi: 'Hỗ trợ chính thức.\n\nVISA 24 GIỜ',
    })
  }
  return table
}

function mockClient(table: Map<string, Row>, sql: string[], tags: string[]) {
  return {
    async query(text: string, params: unknown[] = []) {
      const s = text.replace(/\s+/g, ' ').trim()
      sql.push(s)
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(s)) return { rows: [], rowCount: 0 }
      if (s.includes('FROM "Seller" s')) return { rows: [{ id: VIETKITE.id, name: 'VietKite', officialPartner: true, bio: null, email: VIETKITE.email, handle: VIETKITE.handle }] }
      if (s.includes('information_schema.columns')) return { rows: COLS.map((name) => ({ name })) }
      if (s.includes('FROM "Listing" l JOIN "Category"')) return { rows: [...table.values()].map((r) => ({ ...r, __categorySlug: 'services', __categoryName: 'Services', __categoryNameVi: 'Dịch vụ' })) }
      if (s.includes('FROM "ApiKey"')) return { rows: [{ n: 0 }] }
      if (s.includes('to_regclass')) return { rows: [{ t: 'next_cache_tag' }] }
      if (s.startsWith('INSERT INTO next_cache_tag')) { tags.push(...(params[0] as string[])); return { rows: [], rowCount: 0 } }
      if (s.startsWith('SELECT * FROM "Listing"')) return { rows: (params[0] as string[]).map((id) => table.get(id)).filter(Boolean).map((r) => ({ ...r })) }
      if (s.startsWith('UPDATE "Listing" SET')) {
        const r = table.get(params[0] as string)
        if (!r || r.sellerId !== params[1]) return { rows: [], rowCount: 0 }
        const at = (i: string) => params[Number(i) - 1]
        if (![...s.matchAll(/"(\w+)" IS NOT DISTINCT FROM \$(\d+)/g)].every(([, c, i]) => (r[c] ?? null) === at(i))) return { rows: [], rowCount: 0 }
        for (const [, c, i] of s.matchAll(/"(\w+)" = \$(\d+)/g)) r[c] = at(i)
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`unexpected SQL: ${s.slice(0, 80)}`)
    },
  }
}

describe('dry run → apply → revert (mock client)', () => {
  let dir = ''
  let out: string[] = []
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vk-claims-'))
    out = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')) })
    process.exitCode = 0
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = 0
  })

  it('writes nothing without the reviewed fingerprint, then exactly the plan with it, then reverts', async () => {
    const table = fixture()
    const before = structuredClone([...table.values()])
    const sql: string[] = []
    const tags: string[] = []

    await forward(mockClient(table, sql, tags), {})
    const fp = /plan fingerprint: ([0-9a-f]{16})/.exec(out.join('\n'))?.[1]
    expect(fp).toBeTruthy()
    expect(sql.some((s) => s.startsWith('BEGIN') || s.startsWith('UPDATE'))).toBe(false)

    await forward(mockClient(table, sql, tags), { apply: true, plan: '0000000000000000', 'journal-dir': dir })
    expect(process.exitCode).toBe(1)
    expect(readdirSync(dir)).toHaveLength(0)
    expect([...table.values()]).toEqual(before)
    process.exitCode = 0

    sql.length = 0
    await forward(mockClient(table, sql, tags), { apply: true, plan: fp, 'journal-dir': dir })
    expect(process.exitCode).toBe(0)
    expect(sql[0]).toBe('BEGIN')
    expect(sql).toContain('COMMIT')
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    const journal = parseJournal(readFileSync(join(dir, files[0]), 'utf8'))
    expect(journal.planFingerprint).toBe(fp)
    expect(journal.rows.map((r: { id: string }) => r.id)).toEqual(['vk1', 'vk2'])

    const std = table.get('vk1')!
    expect(std.description).toBe('Included:\n- Application assistance\n\nApply yourself at the official website https://evisa.gov.vn.\n\nVietKite Travel & Visa')
    expect(std.descriptionVi).toBe('Hỗ trợ làm hồ sơ.')
    expect(std.searchText).not.toBe('old')
    const express = table.get('vk2')!
    expect(express.description).toMatch(/VISA 24 GIỜ$/)
    expect(express.description).toContain('Application assistance')
    expect(tags).toEqual(expect.arrayContaining(['eno:isrtag:_N_T_/en/listings/vk1', 'eno:isrtag:_N_T_/vi/listings/vk2']))
    expect(tags).not.toContain('eno:isrtag:_N_T_/layout')

    // A row VietKite edited after the fix is left alone by the revert.
    std.description = `${String(std.description)} (edited)`
    await revert(mockClient(table, sql, tags), { revert: join(dir, files[0]), apply: true })
    expect(table.get('vk1')!.description).toMatch(/\(edited\)$/)
    expect(table.get('vk2')).toEqual(before.find((r) => r.id === 'vk2'))
  })

  it('refuses a journal it did not write', () => {
    for (const bad of ['{}', JSON.stringify({ kind: 'vietkite-claims', version: 1, seller: { id: 's' }, rows: [{ id: 'a', changes: { price: { old: '1', new: '2' } } }] })]) {
      expect(() => parseJournal(bad)).toThrow()
    }
  })
})
