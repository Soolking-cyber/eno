import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { MIN_CELL_N, RENT_INDEX_RULES_VERSION } from '@/lib/rent-index'
import {
  BEDROOMS_CSV, CITY_BANDS, DISTRICT_BANDS, FreezeRefused, MODEL_INPUTS, MODEL_VERSION, RENT_INDEX_CSV_URL,
  TEACHER_COST_INDEX_CSV_COLUMNS, TEACHER_COST_INDEX_PATH, cellFigures, computeEdition, csvRows, editionIdAt, editionLastmod,
  editionMonth, editionNotes, editionPageLastmod, editionSchema, erratumSchema, parseRentIndexCsv, planEdition, saigonDay,
  seriesBreaks, seriesLastmod, sharePct, sharePctWhole, shareText, takeHome, teacherCostIndexBreadcrumb, teacherCostIndexCsv,
  teacherCostIndexDataset, type Edition, type Erratum,
} from '@/lib/teacher-cost-index'
import { EDITIONS, ERRATA } from '@/lib/teacher-cost-index-editions'
import { EDITION_BANNED, visibleCodeText } from '@/test/edition-words'
import { CONTENT_DIR, parseArgs, readEditions, renderEditionsIndex, sha256, writeEdition, writeIndex } from '../../scripts/teacher-cost-index-freeze'

/**
 * THE HCMC TEACHER COST & PAY INDEX (D1) — the guards on its model, its input, its frozen editions and what it publishes
 * (d1-spec §14, adapted to Rent Index rules v5). The fixture is the Rent Index CSV the first edition was frozen from,
 * byte for byte (GET https://eno.vn/hcmc-rent-index.csv, 2026-10-21 05:11 UTC; its sha256 is in the edition); the
 * 19 October file is the v3 one, kept only to prove that series cannot be read as this one.
 */
const FIXTURE = 'src/lib/__fixtures__/rent-index-2026-10-21.csv'
const V3_FIXTURE = 'src/lib/__fixtures__/rent-index-2026-10-19.csv'
const csvV5 = readFileSync(FIXTURE, 'utf8')
const SNAPSHOT = '2026-10-21T05:07:42.038Z'
const AT = new Date('2026-10-21T06:00:00Z')
const first = EDITIONS.find((e) => e.edition === '2026-10')!

/** The fixture with its snapshot moved (every row) — the shape of next month's file. */
const withSnapshot = (csv: string, iso: string) => csv.split(SNAPSHOT).join(iso)
/** The fixture with one row's field replaced: `row` is matched on `scope,slug,…,type` and `col` is the column index. */
function editRow(csv: string, match: (cells: string[]) => boolean, col: number, value: string): string {
  return csv
    .split('\r\n')
    .map((line, i) => {
      const cells = line.split(',')
      if (i === 0 || !line || !match(cells)) return line
      cells[col] = value
      return cells.join(',')
    })
    .join('\r\n')
}
const cityBr1 = (c: string[]) => c[1] === 'city' && c[5] === 'apartment_1br'
const N = 6
const MEDIAN = 7
const RULES = 12

describe('the pay model (the salary guide’s, unchanged)', () => {
  it('takes home 34,630,000 at 40M gross and 38,702,500 at 45M gross: resident, 12-month contract, no dependants', () => {
    expect(takeHome(40_000_000)).toEqual({ grossVnd: 40_000_000, insuranceVnd: 3_800_000, taxVnd: 1_570_000, takeHomeVnd: 34_630_000 })
    expect(takeHome(45_000_000)).toEqual({ grossVnd: 45_000_000, insuranceVnd: 4_275_000, taxVnd: 2_022_500, takeHomeVnd: 38_702_500 })
  })

  it('caps insurance at 9.5% of 50,600,000 above the cap: 4,807,000 at 52.25M and at 60M gross', () => {
    expect(takeHome(52_250_000).insuranceVnd).toBe(4_807_000)
    expect(takeHome(60_000_000)).toEqual({ grossVnd: 60_000_000, insuranceVnd: 4_807_000, taxVnd: 4_438_600, takeHomeVnd: 50_754_400 })
  })

  it('reads the inputs it is given, not the current constants — a frozen edition is recomputed with its own', () => {
    const noTax = { ...MODEL_INPUTS, taxBrackets: [[null, 0]] as const }
    expect(takeHome(40_000_000, noTax).takeHomeVnd).toBe(36_200_000)
  })

  /**
   * ⛔ THE GUIDE IS THE SOURCE OF TRUTH (d1-spec §2.2): its gross-to-net table, read from the approved JSON. If the guide
   * is re-verified with new rules, this fails — then the model moves with it, MODEL_VERSION is bumped and the next
   * freeze stops as a series break. The guide itself is never edited from here (its review digest).
   */
  describe('the coupling to the salary guide', () => {
    const guide = JSON.parse(readFileSync('src/content/teach-in-vietnam/english-teacher-salary-in-vietnam.json', 'utf8')) as {
      sections: { id: string; blocks: { type: string; text?: string; rows?: string[][] }[] }[]
    }
    const section = guide.sections.find((s) => s.id === 'gross-to-net')!
    const table = section.blocks.find((b) => b.type === 'table')!
    const prose = section.blocks.filter((b) => b.type === 'p').map((b) => b.text!).join('\n')
    const vnd = (cell: string) => [...cell.matchAll(/\{\{vnd:(\d+)\}\}/g)].map((m) => Number(m[1]))
    const rows = (label: string) => table.rows!.filter((r) => r[0] === label).map((r) => r.map(vnd))

    it('the reference incomes are the guide’s two "12-month labour contract" rows, and the model prints their figures', () => {
      const contract = rows('12-month labour contract')
      expect(contract.map((r) => r[1][0])).toEqual([...MODEL_INPUTS.referenceGrossVnd])
      for (const [, [gross], [insurance], [tax], [printed]] of contract) {
        const t = takeHome(gross)
        expect([t.insuranceVnd, t.taxVnd], `${gross}`).toEqual([insurance, tax])
        // The guide prints take-home rounded to 10,000 đ ("About 38,700,000").
        expect(Math.round(t.takeHomeVnd / 10_000) * 10_000, `${gross}`).toBe(printed)
      }
    })

    it('the row above the insurance cap: the cap, its 9.5%, the tax and the take-home', () => {
      const [[, [gross], [insurance], [tax], [printed]]] = rows('12-month contract, salary above the insurance cap')
      const t = takeHome(gross)
      expect([t.insuranceVnd, t.taxVnd, Math.round(t.takeHomeVnd / 10_000) * 10_000]).toEqual([insurance, tax, printed])
    })

    it('the guide states every input in words: the 9.5% split, the cap, the deduction and the resident scale', () => {
      const m = MODEL_INPUTS
      expect(prose).toContain(`you pay ${(m.insurancePerMille.pension + m.insurancePerMille.health) / 10}% (${m.insurancePerMille.pension / 10}% pension plus ${m.insurancePerMille.health / 10}% health insurance)`)
      expect(prose).toContain(`capped at {{vnd:${m.insuranceSalaryCapVnd}}} a month of salary`)
      expect(prose).toContain(`personal deduction of {{vnd:${m.personalDeductionVnd}}} a month`)
      expect(prose).toContain(m.law)
      const scale = m.taxBrackets.map(([top, pct], i) => (top === null ? `${pct}% above` : `${pct}% ${i === 0 ? 'up ' : ''}to {{vnd:${top}}}`))
      expect(prose).toContain(`${scale.slice(0, -1).join(', ')} and ${scale.at(-1)}`)
    })
  })

  /**
   * ⛔ THE MODEL IS VERSIONED, SO THIS FAILS WHEN AN INPUT MOVES WITHOUT THE VERSION (the Rent Index's rule, rent-index
   * test "the rules fingerprint"). If it fails: bump MODEL_VERSION, say why in MODEL_INPUTS, and pin both numbers below.
   */
  it('the fingerprint of every model input is pinned to MODEL_VERSION 1', () => {
    const fingerprint = createHash('sha256').update(JSON.stringify(MODEL_INPUTS)).digest('hex').slice(0, 16)
    expect({ version: MODEL_VERSION, fingerprint }).toEqual({ version: 1, fingerprint: '124052acd8235a9a' })
  })
})

describe('shares: half up, from the exact share, never rounded twice', () => {
  it('whole percent for the page, 0.1 point for the CSV', () => {
    expect([sharePctWhole(6_600_000, 38_702_500), sharePct(6_600_000, 38_702_500)]).toEqual([17, 17.1])
    expect([sharePctWhole(6_600_000, 34_630_000), sharePct(6_600_000, 34_630_000)]).toEqual([19, 19.1])
    // 15.5029…%: half up is 16 on the page, 15.5 in the CSV (Tan Binh's 1-bedroom, 2026-10).
    expect([sharePctWhole(6_000_000, 38_702_500), sharePct(6_000_000, 38_702_500)]).toEqual([16, 15.5])
  })

  it('an exact half rounds up, and 16.4589…% is 16 on the page though its CSV figure is 16.5', () => {
    expect(sharePctWhole(1, 2)).toBe(50)
    expect(sharePctWhole(165, 1_000)).toBe(17) // 16.5% exactly
    expect(sharePct(6_370_000, 38_702_500)).toBe(16.5)
    expect(sharePctWhole(6_370_000, 38_702_500)).toBe(16)
  })
})

describe('reading the Rent Index CSV (rules v5)', () => {
  it('reads every band city-wide and Studio, 1 and 2 bedrooms by district, in the Rent Index’s band order', () => {
    const r = parseRentIndexCsv(csvV5, { now: AT })
    expect([r.snapshotUtc, r.rulesVersion]).toEqual([SNAPSHOT, RENT_INDEX_RULES_VERSION])
    const city = r.cells.filter((c) => c.scope === 'city')
    expect(city.map((c) => [c.band, c.n, c.medianVnd])).toEqual([
      ['studio', 2_377, 4_500_000], ['br1', 139, 6_600_000], ['br2', 75, 8_800_000], ['br3plus', 5, null],
    ])
    expect(CITY_BANDS).toEqual(['studio', 'br1', 'br2', 'br3plus'])
    expect(DISTRICT_BANDS).toEqual(['studio', 'br1', 'br2'])
    const districts = [...new Set(r.cells.filter((c) => c.scope === 'district').map((c) => c.districtSlug))]
    expect(districts).toHaveLength(20)
    for (const d of districts) expect(r.cells.filter((c) => c.districtSlug === d).map((c) => c.band), d).toEqual(['studio', 'br1', 'br2'])
    expect(r.cells.find((c) => c.districtSlug === 'd7' && c.band === 'studio')).toEqual({
      scope: 'district', districtSlug: 'd7', districtName: 'District 7 (Phu My Hung)', partOf: null, band: 'studio', n: 12, medianVnd: 4_750_000,
    })
  })

  it('⛔ suppresses a median under the floor itself — n kept, median dropped — and keeps one at the floor', () => {
    const nine = editRow(csvV5, cityBr1, N, String(MIN_CELL_N - 1))
    const at9 = parseRentIndexCsv(nine, { now: AT }).cells.find((c) => c.scope === 'city' && c.band === 'br1')!
    expect([at9.n, at9.medianVnd]).toEqual([MIN_CELL_N - 1, null])
    const e = computeEdition({ ...first, rent: { ...first.rent, cells: parseRentIndexCsv(nine, { now: AT }).cells } })
    expect(cellFigures(e, 'city', 'all', 'br1')).toBeNull()
    expect(e.outputs.filter((o) => o.scope === 'city' && o.band === 'br1')).toEqual([])
    const ten = parseRentIndexCsv(editRow(csvV5, cityBr1, N, String(MIN_CELL_N)), { now: AT }).cells.find((c) => c.scope === 'city' && c.band === 'br1')!
    expect([ten.n, ten.medianVnd]).toEqual([MIN_CELL_N, 6_600_000])
  })

  describe('⛔ refuses rather than guesses', () => {
    const refused = (text: string, why: RegExp, opts: { now?: Date; seriesBreak?: string } = {}) =>
      expect(() => parseRentIndexCsv(text, { now: opts.now ?? AT, seriesBreak: opts.seriesBreak })).toThrow(why)

    it('a body that is not the Rent Index CSV: another header, the 503 apology, an empty file', () => {
      refused(csvV5.replace('snapshot_utc,scope', 'snapshot,scope'), /not the Rent Index CSV/)
      refused('The rent index could not be computed just now. Please try again shortly.\n', /not the Rent Index CSV/)
      refused('', /not the Rent Index CSV/)
      refused(`${csvV5.split('\r\n')[0]}\r\n`, /no rows/)
    })

    it(`a rules version other than ${RENT_INDEX_RULES_VERSION}, unless a series break is declared`, () => {
      const v6 = csvV5.replace(/,5\r\n/g, ',6\r\n')
      refused(v6, /rules version 6; this code reads version 5/)
      expect(parseRentIndexCsv(v6, { now: AT, seriesBreak: 'The Rent Index changed its rules.' }).rulesVersion).toBe(6)
    })

    it('the real 19 October file (rules v3): refused for its version, and with a break declared still refused — it has no Studio band', () => {
      const v3 = readFileSync(V3_FIXTURE, 'utf8')
      refused(v3, /rules version 3/, { now: new Date('2026-10-19T12:00:00Z') })
      refused(v3, /city-wide apartment_studio row is missing/, { now: new Date('2026-10-19T12:00:00Z'), seriesBreak: 'v3 to v5' })
    })

    it(`a snapshot more than ${36} hours old, or in the future`, () => {
      refused(csvV5, /more than 36 hours old/, { now: new Date(Date.parse(SNAPSHOT) + 36 * 3_600_000 + 1) })
      expect(() => parseRentIndexCsv(csvV5, { now: new Date(Date.parse(SNAPSHOT) + 36 * 3_600_000) })).not.toThrow()
      refused(csvV5, /in the future/, { now: new Date(Date.parse(SNAPSHOT) - 10 * 60_000) })
    })

    it('a missing city or district band row', () => {
      const lines = csvV5.split('\r\n')
      refused(lines.filter((l) => !(l.includes(',city,') && l.includes(',apartment_1br,'))).join('\r\n'), /city-wide apartment_1br row is missing/)
      refused(lines.filter((l) => !(l.includes(',district,go-vap,') && l.includes(',apartment_studio,'))).join('\r\n'), /go-vap apartment_studio row is missing/)
      // A district whose band rows are ALL gone while its other rows stay is refused, never left out (codex, integration
      // review) — and so is a file with no district rows at all.
      refused(lines.filter((l) => !(l.includes(',district,go-vap,') && /,apartment_(studio|1br|2br),/.test(l))).join('\r\n'), /go-vap apartment_studio row is missing/)
      refused(lines.filter((l) => !l.includes(',district,')).join('\r\n'), /no district rows/)
    })

    it('mixed snapshots or rules versions, a short row, a repeated row, a count or a median that is not a number', () => {
      const lines = csvV5.split('\r\n')
      refused([lines[0], lines[1], lines[2].replace(SNAPSHOT, '2026-10-20T05:07:42.038Z'), ...lines.slice(3)].join('\r\n'), /another snapshot/)
      refused([lines[0], lines[1], lines[2].replace(/,5$/, ',4'), ...lines.slice(3)].join('\r\n'), /other rules/)
      refused([lines[0], lines[1], lines[2].split(',').slice(0, 12).join(','), ...lines.slice(3)].join('\r\n'), /12 fields, not 13/)
      const br1 = lines.find((l) => l.includes(',city,') && l.includes(',apartment_1br,'))!
      refused([...lines.slice(0, -1), br1, ''].join('\r\n'), /repeats city\|all\|br1/)
      refused(editRow(csvV5, cityBr1, N, '1e3'), /has n "1e3"/)
      refused(editRow(csvV5, cityBr1, MEDIAN, '6600000.5'), /has median "6600000.5"/)
      // A blank median at the floor is a broken file, never a dash beside 139 listings (codex, gate review).
      refused(editRow(csvV5, cityBr1, MEDIAN, ''), /row \d+ has 139 listings and no median: the Rent Index gives one from 10/)
      refused(editRow(csvV5, cityBr1, RULES, '5x'), /other rules/)
    })
  })

  it('csvRows: RFC 4180 quoting, doubled quotes, CRLF or LF, and no phantom row after the last line break', () => {
    expect(csvRows('a,"b,c","d ""e"""\r\nf,,g\n')).toEqual([['a', 'b,c', 'd "e"'], ['f', '', 'g']])
    expect(csvRows('x\r\n"multi\r\nline",y')).toEqual([['x'], ['multi\r\nline', 'y']])
  })
})

describe('the first edition, 2026-10 (frozen from the fixture)', () => {
  it('is the fixture, byte for byte: its sha256, its snapshot, rules v5, and a note that the series starts on v5', () => {
    expect(first.rent.csvSha256).toBe(createHash('sha256').update(readFileSync(FIXTURE)).digest('hex'))
    expect(first.rent.csvSha256).toBe('98d7bc599ab1f3cadaca1339586ca1af23c9c28d17bbbcff3b998011daea6651')
    expect([first.rent.source, first.rent.snapshotUtc, first.rent.rulesVersion, first.rent.minCellN]).toEqual([RENT_INDEX_CSV_URL, SNAPSHOT, 5, MIN_CELL_N])
    expect([first.seriesBreak, first.model.version]).toEqual([null, 1])
    expect(first.note).toMatch(/^The series starts with this edition, on Rent Index rules version 5: from 21 October 2026 a studio or duplex room is its own band \(Studio\)/)
    // Frozen at most 36 hours after its snapshot (it was 4 minutes).
    expect(Date.parse(first.frozenAt) - Date.parse(first.rent.snapshotUtc)).toBeLessThanOrEqual(36 * 3_600_000)
  })

  it('freezing the fixture again, at the same moment and with the same note, gives the committed file exactly', () => {
    const again = planEdition({ csvText: csvV5, csvSha256: first.rent.csvSha256, now: new Date(first.frozenAt), editions: [], note: first.note, sources: first.rent.sources })
    expect(again).toEqual(first)
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(readFileSync(join(CONTENT_DIR, '2026-10.json'), 'utf8'))
  })

  it('the worked example (d1-spec §4, rules v5): city-wide', () => {
    const fig = (b: Parameters<typeof cellFigures>[3]) => {
      const f = cellFigures(first, 'city', 'all', b)
      return f && [f.cell.medianVnd, f.cell.n, shareText(f.shareWhole), f.leftAfterRentVnd]
    }
    expect(fig('studio')).toEqual([4_500_000, 2_377, '12–13%', [30_130_000, 34_202_500]])
    expect(fig('br1')).toEqual([6_600_000, 139, '17–19%', [28_030_000, 32_102_500]])
    expect(fig('br2')).toEqual([8_800_000, 75, '23–25%', [25_830_000, 29_902_500]])
    expect(fig('br3plus')).toBeNull()
    expect(first.model.takeHome.map((t) => t.takeHomeVnd)).toEqual([34_630_000, 38_702_500])
  })

  it('the worked example: by district — every published 1- and 2-bedroom cell, and the dashes with their counts', () => {
    const published = (band: 'br1' | 'br2') =>
      first.rent.cells.filter((c) => c.scope === 'district' && c.band === band).flatMap((c) => {
        const f = cellFigures(first, 'district', c.districtSlug, band)
        return f ? [[c.districtSlug, c.medianVnd, c.n, shareText(f.shareWhole)]] : []
      })
    expect(published('br1')).toEqual([
      ['d12', 5_600_000, 16, '14–16%'], ['binh-thanh', 8_800_000, 12, '23–25%'], ['go-vap', 6_650_000, 58, '17–19%'],
      ['tan-binh', 6_000_000, 21, '16–17%'], ['tan-phu', 7_000_000, 10, '18–20%'],
    ])
    expect(published('br2')).toEqual([['binh-thanh', 9_400_000, 17, '24–27%'], ['go-vap', 7_900_000, 33, '20–23%'], ['tan-binh', 8_150_000, 10, '21–24%']])
    // A dash keeps its count: District 1's seven one-bedrooms, Thu Duc's three.
    expect(first.rent.cells.find((c) => c.districtSlug === 'd1' && c.band === 'br1')).toMatchObject({ n: 7, medianVnd: null })
    expect(first.rent.cells.find((c) => c.districtSlug === 'thu-duc' && c.band === 'br1')).toMatchObject({ n: 3, medianVnd: null })
    // 18 studio cells publish; 29 cells in all, each at both reference incomes.
    expect(first.rent.cells.filter((c) => c.scope === 'district' && c.band === 'studio' && c.medianVnd !== null)).toHaveLength(18)
    expect(first.outputs).toHaveLength(29 * 2)
  })
})

describe('every frozen edition', () => {
  it('there is at least one, newest first, each id a month, and the editions.ts index matches the directory', () => {
    expect(EDITIONS.length).toBeGreaterThan(0)
    expect(EDITIONS.map((e) => e.edition)).toEqual([...EDITIONS.map((e) => e.edition)].sort().reverse())
    const ids = readdirSync(CONTENT_DIR).flatMap((f) => /^(\d{4}-\d{2})\.json$/.exec(f)?.[1] ?? [])
    expect(ids.sort()).toEqual(EDITIONS.map((e) => e.edition).sort())
    expect(readFileSync(join(CONTENT_DIR, 'editions.ts'), 'utf8')).toBe(renderEditionsIndex(ids))
  })

  it.each(EDITIONS.map((e) => [e.edition, e] as const))('%s: its stored outputs are a recomputation of its stored inputs', (_, e) => {
    const inputs = { edition: e.edition, frozenAt: e.frozenAt, note: e.note, seriesBreak: e.seriesBreak, rent: e.rent }
    expect(computeEdition(inputs, { version: e.model.version, inputs: e.model.inputs })).toEqual(e)
  })

  it('every erratum names a frozen edition (errata live in errata.json only: the strict schema has no place for one in an edition)', () => {
    for (const x of ERRATA) expect(EDITIONS.map((e) => e.edition), x.text).toContain(x.edition)
    expect(() => editionSchema.parse({ ...first, errata: [] })).toThrow()
  })

  /**
   * ⛔ EVERY EDITION SAYS WHAT ITS RENTS ARE (d1-spec §2.1, §16.2; verifier round): the Rent Index's names for its
   * snapshot's sources, stored at the freeze. 2026-10's were added before it was first published (2026-10-21), from the
   * same snapshot's method line, so the first edition launched without an erratum.
   */
  it.each(EDITIONS.map((e) => [e.edition, e] as const))('%s: names the sources of its rents, beside it and in its CSV note', (_, e) => {
    const said = editionNotes(e, ERRATA).join(' ')
    expect(e.rent.sources).toMatch(/\S/)
    expect(said).toContain(`Sources in the Rent Index snapshot these rents are from: ${e.rent.sources}.`)
  })

  it('2026-10 names the snapshot it was frozen from: GoPlus and eno.vn members', () => {
    expect(first.rent.sources).toBe("GoPlus (an official eno.vn partner's own listings) · listings posted by eno.vn members")
  })
})

describe('⛔ freezing: comparability guards and immutability', () => {
  const NOV = new Date('2026-11-01T01:00:00Z') // 08:00 on the 1st in Saigon
  const nextMonth = (br1n: number) => editRow(withSnapshot(csvV5, '2026-11-01T00:30:00.000Z'), cityBr1, N, String(br1n))

  it('the edition id is the month in Ho Chi Minh City — the 1st begins at 17:00 UTC the day before', () => {
    expect(editionIdAt(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10')
    expect(editionIdAt(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11')
    expect(editionMonth('2026-11')).toBe('November 2026')
    expect(saigonDay('2026-10-31T17:00:00.000Z')).toBe('1 November 2026')
  })

  it('a city-wide 1-bedroom count that moves more than ±30% stops the freeze; exactly 30% does not', () => {
    expect(() => planEdition({ csvText: nextMonth(182), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] })).toThrow(
      /series break: the city-wide 1-bedroom count moved from 139 to 182 listings, more than ±30%/,
    )
    expect(() => planEdition({ csvText: nextMonth(97), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] })).toThrow(FreezeRefused)
    // 139 × 1.3 = 180.7 and 139 × 0.7 = 97.3: 180 and 98 are inside the band.
    for (const n of [180, 98]) expect(planEdition({ csvText: nextMonth(n), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] }).seriesBreak).toBeNull()
  })

  it('--series-break writes its reason into the edition, its page notes and every CSV row of it', () => {
    const reason = 'The Rent Index added a new source on 30 October 2026.'
    const nov = planEdition({ csvText: nextMonth(182), csvSha256: 'a'.repeat(64), now: NOV, editions: [first], seriesBreak: reason })
    expect([nov.edition, nov.seriesBreak]).toEqual(['2026-11', reason])
    expect(editionNotes(nov, [])).toEqual([`Series break: ${reason}`])
    const rows = csvRows(teacherCostIndexCsv([first, nov], [])).slice(1).filter((r) => r[0] === '2026-11')
    expect(rows.length).toBe(nov.rent.cells.length * 2)
    for (const r of rows) expect(r.at(-1)).toBe(`Series break: ${reason}`)
  })

  it('⛔ an edition’s rents are from its own month: a freeze on the 1st still reading the month before’s snapshot is refused', () => {
    // 12:07 on 31 October in Saigon, read at 08:00 on 1 November: the Rent Index had not refreshed yet (verifier round).
    expect(() => planEdition({ csvText: withSnapshot(csvV5, '2026-10-31T05:07:42.038Z'), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] })).toThrow(
      /the snapshot \(2026-10-31T05:07:42\.038Z, 31 October 2026 in Ho Chi Minh City\) is not from edition 2026-11's month\. Wait for the Rent Index's first snapshot of November 2026/,
    )
    // 00:30 on 1 November in Saigon is November's.
    expect(planEdition({ csvText: withSnapshot(csvV5, '2026-10-31T17:30:00.000Z'), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] }).edition).toBe('2026-11')
  })

  it('--sources: the Rent Index’s names for the snapshot, stored with the edition and printed beside it and in every CSV row of it', () => {
    const names = "GoPlus (an official eno.vn partner's own listings) · listings posted by eno.vn members"
    const plan = (sources?: string) => planEdition({ csvText: nextMonth(139), csvSha256: 'a'.repeat(64), now: NOV, editions: [first], sources })
    // A pasted label, a final full stop and stray whitespace are dropped.
    const nov = plan(`  Sources in this snapshot:  ${names}.\n`)
    expect(nov.rent.sources).toBe(names)
    expect(Object.keys(nov.rent)).toEqual(['source', 'csvSha256', 'snapshotUtc', 'rulesVersion', 'sources', 'minCellN', 'cells'])
    const said = `Sources in the Rent Index snapshot these rents are from: ${names}. The figures are always pooled and never broken down by source.`
    expect(editionNotes(nov, [])).toEqual([said])
    const rows = csvRows(teacherCostIndexCsv([first, nov], [])).slice(1).filter((r) => r[0] === '2026-11')
    for (const r of rows) expect(r.at(-1)).toBe(said)
    // Every label the Rent Index prints (rent-index-sections.r2.test.tsx): an import, a partner, members, a nameless partner —
    // and a name may hold a digit (opus, gate review), or a typographic apostrophe from a copy.
    for (const line of [
      "Nhatot.com (listings imported from that site) · GoPlus (an official eno.vn partner's own listings) · listings posted by eno.vn members",
      "an official eno.vn partner's own listings",
      '99.co (listings imported from that site) · Home 247 (an official eno.vn partner’s own listings)',
    ]) expect(plan(line).rent.sources).toBe(line)
    // ⛔ Nothing else — never a count per source (owner, 2026-09-27): refused at the freeze, and by the schema besides.
    const notTheLine = /is not the Rent Index's "Sources in this snapshot" line/
    expect(() => plan('GoPlus (2,605 listings)')).toThrow(notTheLine)
    expect(() => plan(`${names}, 2,605 of them GoPlus's`)).toThrow(notTheLine)
    expect(() => editionSchema.parse({ ...nov, rent: { ...nov.rent, sources: 'GoPlus (2,605 listings)' } })).toThrow()
    // ⛔ Given, it names a source: a lone full stop or the bare label came to nothing and is refused, not dropped (codex).
    for (const empty of ['.', 'Sources in this snapshot:', 'Sources in this snapshot: .']) expect(() => plan(empty)).toThrow(notTheLine)
    // Left out, the plan has no key for it: a dry run's plan (the script refuses to write an edition without --sources).
    expect(plan().rent).not.toHaveProperty('sources')
    expect(plan('  ').rent).not.toHaveProperty('sources')
  })

  it('a rules version or a model version that moved is a series break too', () => {
    const v6 = parseRentIndexCsv(withSnapshot(csvV5, '2026-11-01T00:30:00.000Z').replace(/,5\r\n/g, ',6\r\n'), { now: NOV, seriesBreak: 'x' })
    expect(seriesBreaks(first, v6)).toEqual(['the Rent Index rules moved from version 5 to 6'])
    const same = parseRentIndexCsv(withSnapshot(csvV5, '2026-11-01T00:30:00.000Z'), { now: NOV })
    expect(seriesBreaks(first, same)).toEqual([])
    expect(seriesBreaks(first, same, MODEL_VERSION + 1)).toEqual([`the pay model moved from version 1 to ${MODEL_VERSION + 1}`])
    expect(seriesBreaks(undefined, v6)).toEqual([])
  })

  it('an edition already frozen, or older than the newest, is refused — never replaced', () => {
    expect(() => planEdition({ csvText: csvV5, csvSha256: first.rent.csvSha256, now: AT, editions: [first] })).toThrow(/edition 2026-10 is already frozen/)
    const nov = planEdition({ csvText: nextMonth(139), csvSha256: 'a'.repeat(64), now: NOV, editions: [first] })
    expect(() => planEdition({ csvText: csvV5, csvSha256: 'b'.repeat(64), now: AT, editions: [nov] })).toThrow(/older than the newest frozen edition, 2026-11/)
  })

  it('the script writes with `wx`: an existing edition file is refused and left byte for byte, and the index follows the directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tci-freeze-'))
    try {
      writeFileSync(join(dir, '2026-10.json'), 'committed bytes')
      expect(() => writeEdition(dir, first)).toThrow(/EEXIST/)
      expect(readFileSync(join(dir, '2026-10.json'), 'utf8')).toBe('committed bytes')
      rmSync(join(dir, '2026-10.json'))
      writeEdition(dir, first)
      const nov = planEdition({ csvText: nextMonth(139), csvSha256: sha256(Buffer.from(nextMonth(139))), now: NOV, editions: readEditions(dir) })
      writeEdition(dir, nov)
      expect(readEditions(dir).map((e) => e.edition).sort()).toEqual(['2026-10', '2026-11'])
      const index = readFileSync(join(dir, 'editions.ts'), 'utf8')
      expect(index).toContain("import e2026_11 from '@/content/teacher-cost-index/2026-11.json'")
      expect(index).toContain('export const EDITION_FILES: readonly unknown[] = [e2026_11, e2026_10]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * ⛔ THE COMMAND LINE REFUSES WHAT IT DOES NOT KNOW (codex, gate review): an edition cannot be frozen twice, so a mistyped
 * `--dry-run` must not run the real freeze; and the index is rebuilt atomically, with `--reindex` to finish a freeze that
 * stopped after its edition file.
 */
describe('⛔ the freeze script’s command line and index', () => {
  it('reads the known flags', () => {
    expect(parseArgs(['--sources', 'GoPlus'])).toEqual({ '--sources': 'GoPlus' })
    expect(parseArgs(['--dry-run'])).toEqual({ '--dry-run': true })
    expect(parseArgs(['--dry-run', '--note', 'The series starts here.', '--save-csv', '/x.csv'])).toEqual({ '--dry-run': true, '--note': 'The series starts here.', '--save-csv': '/x.csv' })
    expect(parseArgs(['--fixture', 'f.csv', '--now', '2026-11-01T01:00:00Z', '--dir', '/d', '--sources', 'GoPlus'])).toEqual({ '--fixture': 'f.csv', '--now': '2026-11-01T01:00:00Z', '--dir': '/d', '--sources': 'GoPlus' })
    expect(parseArgs(['--fixture', 'f.csv', '--dry-run'])).toEqual({ '--fixture': 'f.csv', '--dry-run': true })
    expect(parseArgs(['--reindex', '--dir', '/d'])).toEqual({ '--reindex': true, '--dir': '/d' })
  })

  it.each([
    [['--dryrun'], /unknown argument "--dryrun"/],
    [['--dry-run', 'now'], /unknown argument "now"/],
    [['--note'], /--note needs a value/],
    [['--note', '--dry-run'], /--note needs a value/],
    [['--series-break', '  '], /--series-break needs a value/],
    [['--dry-run', '--dry-run'], /--dry-run is given twice/],
    [['--now', '2026-11-01T01:00:00Z'], /--now is for --fixture runs only/],
    [['--reindex', '--note', 'x'], /--reindex takes only --dir/],
    // A fixture never freezes into the real editions: its edition would name the live file as its source.
    [['--fixture', 'f.csv', '--now', '2026-11-01T01:00:00Z'], /--fixture writes only with --dir/],
    // ⛔ Nothing is written without the snapshot's sources: an edition says what its rents are (verifier round).
    [[], /--sources is required to write an edition/],
    [['--note', 'The series starts here.'], /--sources is required to write an edition/],
    [['--fixture', 'f.csv', '--now', '2026-11-01T01:00:00Z', '--dir', '/d'], /--sources is required to write an edition/],
    [['--sources'], /--sources needs a value/],
    [['--reindex', '--sources', 'GoPlus'], /--reindex takes only --dir/],
    // ⛔ A rehearsal directory is never a real editions folder, however it is spelled (codex, gate review).
    [['--fixture', 'f.csv', '--dir', 'src/content/teacher-cost-index', '--sources', 'GoPlus'], /--fixture never writes into the real editions/],
    [['--fixture', 'f.csv', '--dir', './src/content/teacher-cost-index/', '--sources', 'GoPlus'], /--fixture never writes into the real editions/],
    [['--fixture', 'f.csv', '--dir', CONTENT_DIR, '--sources', 'GoPlus'], /--fixture never writes into the real editions/],
    [['--fixture', 'f.csv', '--dir', '/elsewhere/eno/src/content/teacher-cost-index', '--sources', 'GoPlus'], /--fixture never writes into the real editions/],
  ] as const)('refuses %j', (argv, why) => {
    expect(() => parseArgs(argv)).toThrow(FreezeRefused)
    expect(() => parseArgs(argv)).toThrow(why)
  })

  it('--reindex rebuilds the index from the edition files alone, through a temp file it leaves nowhere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tci-index-'))
    try {
      writeFileSync(join(dir, '2026-10.json'), readFileSync(join(CONTENT_DIR, '2026-10.json')))
      writeFileSync(join(dir, 'editions.ts'), '// a stale index')
      expect(writeIndex(dir)).toEqual(['2026-10'])
      expect(readFileSync(join(dir, 'editions.ts'), 'utf8')).toBe(renderEditionsIndex(['2026-10']))
      expect(readdirSync(dir).sort()).toEqual(['2026-10.json', 'editions.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('⛔ privacy: aggregates only, nothing about a person, nothing by nationality', () => {
  it('the edition schema is strict at every level: an unknown key is a refusal', () => {
    expect(() => editionSchema.parse({ ...first, nationality: 'any' })).toThrow()
    expect(() => editionSchema.parse({ ...first, rent: { ...first.rent, cells: [{ ...first.rent.cells[0], nationality: 'US' }, ...first.rent.cells.slice(1)] } })).toThrow()
    expect(() => editionSchema.parse({ ...first, outputs: [{ ...first.outputs[0], teacher: 'x' }] })).toThrow()
    expect(() => editionSchema.parse({ ...first, model: { ...first.model, inputs: { ...first.model.inputs, passportCountry: 'x' } } })).toThrow()
    expect(() => erratumSchema.parse({ edition: '2026-10', at: '2026-10-22T03:00:00.000Z', text: 'x', by: 'someone' })).toThrow()
  })

  /**
   * The modules that make and serve the figures reach no profile, message, job or database code — at any depth, through
   * every runtime import (a type-only import is erased). The page is left out: its header and footer import half the app.
   */
  it('the import boundary: the lib, the editions loader, the CSV route and the freeze script', () => {
    const roots = ['src/lib/teacher-cost-index.ts', 'src/lib/teacher-cost-index-editions.ts', 'src/app/hcmc-teacher-cost-pay-index.csv/route.ts', 'scripts/teacher-cost-index-freeze.ts']
    const seen = new Set<string>()
    const packages = new Set<string>()
    const resolve = (spec: string, from: string): string | null => {
      const base = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
      if (!base) return (packages.add(spec), null)
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((f) => existsSync(f) && statSync(f).isFile())
      if (!hit) throw new Error(`${from}: cannot resolve ${spec}`)
      return hit
    }
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      if (!/\.tsx?$/.test(file)) return
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      for (const st of sf.statements) {
        if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue
        if (ts.isImportDeclaration(st) ? st.importClause?.isTypeOnly : st.isTypeOnly) continue
        const next = resolve(st.moduleSpecifier.text, file)
        if (next) walk(next)
      }
    }
    roots.forEach(walk)
    // Not vacuous: the walk reaches the Rent Index's constants and the frozen data.
    expect([...seen]).toEqual(expect.arrayContaining(['src/lib/rent-index.ts', 'src/content/teacher-cost-index/2026-10.json']))
    expect([...seen].filter((f) => /prisma|profile|message|conversation|chat|job|teacher-?listing|\/teachers?\/|\/db\.ts$|supabase|auth/i.test(f))).toEqual([])
    expect([...packages].sort()).toEqual(['node:crypto', 'node:fs', 'node:path', 'zod'])
  })

  it('⛔ no licensed-services word in any D1 string, the CSV (header and notes), the JSON-LD or an edition', () => {
    const files = [
      'src/lib/teacher-cost-index.ts', 'src/lib/teacher-cost-index-editions.ts', 'scripts/teacher-cost-index-freeze.ts',
      'src/app/hcmc-teacher-cost-pay-index.csv/route.ts', 'src/app/[lang]/hcmc-teacher-cost-pay-index/page.tsx',
      'src/app/[lang]/hcmc-teacher-cost-pay-index/[edition]/page.tsx', 'src/app/[lang]/hcmc-teacher-cost-pay-index/sections.tsx',
    ]
    for (const f of files) expect(visibleCodeText(f).match(EDITION_BANNED), f).toBeNull()
    expect(teacherCostIndexCsv(EDITIONS, ERRATA).match(EDITION_BANNED)).toBeNull()
    expect(JSON.stringify([teacherCostIndexDataset(EDITIONS, { origin: 'https://eno.vn', name: 'eno.vn' }), teacherCostIndexBreadcrumb('https://eno.vn', '2026-10')]).match(EDITION_BANNED)).toBeNull()
    for (const e of EDITIONS) expect(JSON.stringify(e).match(EDITION_BANNED), e.edition).toBeNull()
    expect(JSON.stringify(ERRATA).match(EDITION_BANNED)).toBeNull()
    // The sweep bites.
    expect('a work permit, then a visa'.match(EDITION_BANNED)?.[0]).toBe('visa')
  })
})

describe('the CSV', () => {
  const rows = (editions: readonly Edition[], errata: readonly Erratum[] = []) => csvRows(teacherCostIndexCsv(editions, errata))

  it('its columns, in order, `note` last; CRLF; one row per edition × cell × reference income', () => {
    const text = teacherCostIndexCsv([first], [])
    expect(text.split('\r\n')[0]).toBe(
      'edition,rent_snapshot_utc,rent_rules_version,model_version,scope,district_slug,district_name,part_of,bedrooms,n,median_rent_vnd_month,gross_vnd_month,take_home_vnd_month,rent_share_pct,left_after_rent_vnd_month,note',
    )
    expect(TEACHER_COST_INDEX_CSV_COLUMNS.at(-1)).toBe('note')
    expect(text.endsWith('\r\n')).toBe(true)
    expect(rows([first])).toHaveLength(1 + first.rent.cells.length * 2)
  })

  it('a published cell carries its figures; a dash keeps its n with the rest empty; the note is the edition’s', () => {
    const [, ...data] = rows([first])
    const at = (slug: string, bedrooms: string, gross: string) => data.find((r) => r[5] === slug && r[8] === bedrooms && r[11] === gross)!
    expect(at('all', '1', '45000000')).toEqual([
      '2026-10', SNAPSHOT, '5', '1', 'city', 'all', 'Ho Chi Minh City', '', '1', '139', '6600000', '45000000', '38702500', '17.1', '32102500', editionNotes(first, []).join(' | '),
    ])
    // The note column is the edition's own notes: its note, then the sources of its rents.
    expect(editionNotes(first, [])).toEqual([first.note, `Sources in the Rent Index snapshot these rents are from: ${first.rent.sources}. The figures are always pooled and never broken down by source.`])
    expect(at('all', '3+', '40000000').slice(9, 15)).toEqual(['5', '', '40000000', '34630000', '', ''])
    expect(at('tan-binh', '1', '45000000')[13]).toBe('15.5')
    expect(at('all', 'studio', '40000000')[13]).toBe('13.0')
    expect(Object.values(BEDROOMS_CSV)).toEqual(['studio', '1', '2', '3+'])
  })

  it('a new edition only appends rows, and an erratum reaches only its own edition’s note — RFC 4180 quoted', () => {
    const nov = planEdition({ csvText: editRow(withSnapshot(csvV5, '2026-11-01T00:30:00.000Z'), cityBr1, N, '140'), csvSha256: 'a'.repeat(64), now: new Date('2026-11-01T01:00:00Z'), editions: [first] })
    const one = teacherCostIndexCsv([first], [])
    const both = teacherCostIndexCsv([nov, first], [])
    expect(both.startsWith(one)).toBe(true)
    const erratum: Erratum = { edition: '2026-10', at: '2026-11-03T02:00:00.000Z', text: 'District 7\'s row said "Phu My Hung", a ward, not a district' }
    const withErratum = rows([first, nov], [erratum])
    const oct = withErratum.filter((r) => r[0] === '2026-10')
    for (const r of oct) expect(r.at(-1)).toBe(`${editionNotes(first, []).join(' | ')} | Erratum (3 November 2026): ${erratum.text}`)
    for (const r of withErratum.filter((r) => r[0] === '2026-11')) expect(r.at(-1)).toBe('')
    // The figures of the corrected edition did not move.
    expect(withErratum.slice(1, 1 + oct.length).map((r) => r.slice(0, -1))).toEqual(rows([first]).slice(1).map((r) => r.slice(0, -1)))
    expect(teacherCostIndexCsv([first], [erratum])).toContain('""Phu My Hung""')
    expect(editionLastmod(first, [erratum])).toBe('2026-11-03T02:00:00.000Z')
    expect(editionLastmod(first, [])).toBe(first.frozenAt)
    // An erratum made the same day as the freeze moves the date too — a bare day would have sorted before the freeze.
    expect(editionLastmod(first, [{ ...erratum, at: '2026-10-21T09:00:00.000Z' }])).toBe('2026-10-21T09:00:00.000Z')
    // One for another edition, or older than the freeze, moves nothing.
    expect(editionLastmod(first, [{ ...erratum, edition: '2026-11' }, { ...erratum, at: '2026-10-21T05:00:00.000Z' }])).toBe(first.frozenAt)
  })

  it('the formula guard: a text field starting with = + - @ is prefixed, as in the Rent Index CSV', () => {
    const odd = { ...first, rent: { ...first.rent, cells: first.rent.cells.map((c, i) => (i === 4 ? { ...c, districtName: '=HYPERLINK("x")' } : c)) } }
    expect(teacherCostIndexCsv([odd], [])).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('the Dataset JSON-LD (one, for the series)', () => {
  const ld = teacherCostIndexDataset(EDITIONS, { origin: 'https://eno.vn', name: 'eno.vn' }) as Record<string, unknown> & { distribution: Record<string, string>; description: string }
  const keysDeep = (v: unknown): string[] =>
    Array.isArray(v) ? v.flatMap(keysDeep) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []

  it('⛔ has no licence key at any depth (owner ruling R-f, restated by decision 9) and points its terms at the cite box', () => {
    expect(keysDeep(ld).filter((k) => /licen[cs]e/i.test(k))).toEqual([])
    expect(ld.usageInfo).toBe(`https://eno.vn${TEACHER_COST_INDEX_PATH}#cite`)
    expect(ld.isAccessibleForFree).toBe(true)
  })

  it('its file, version, dates and the three properties the Rich Results Test requires', () => {
    expect(ld.distribution).toEqual({ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: 'https://eno.vn/hcmc-teacher-cost-pay-index.csv' })
    expect(ld.version).toBe(EDITIONS[0].edition)
    expect([ld.datePublished, ld.dateModified]).toEqual([EDITIONS.at(-1)!.frozenAt, EDITIONS[0].frozenAt])
    // A later erratum to any edition changes what the dataset says, so it moves dateModified too.
    const later = new Date(Date.parse(EDITIONS[0].frozenAt) + 86_400_000).toISOString()
    const corrected = teacherCostIndexDataset(EDITIONS, { origin: 'https://eno.vn', name: 'eno.vn' }, [{ edition: EDITIONS.at(-1)!.edition, at: later, text: 'x' }])
    expect(corrected.dateModified).toBe(later)
    expect(ld.name).toBe('HCMC Teacher Cost & Pay Index')
    expect(ld.description.length).toBeGreaterThanOrEqual(50)
    expect(ld.description.length).toBeLessThanOrEqual(5_000)
    expect(ld.description).toContain(`at least ${MIN_CELL_N} listings`)
    expect(ld.description).toContain('at 40,000,000 and 45,000,000 VND gross under 2026 Vietnamese income-tax and social-insurance rules')
    expect(ld.measurementTechnique).toBe('Rent Index median divided by modelled take-home pay: tax resident, 12-month labour contract, no dependants; 9.5% employee insurance; PIT Law 109/2025/QH15')
    expect(ld).not.toHaveProperty('temporalCoverage')
  })

  /**
   * ⛔ THE SITEMAP'S DATES (pages.xml/build.ts; verifier round): the series page as its Dataset's dateModified, one value;
   * a SUPERSEDED edition by its own record or the newest freeze, whichever is later — every later freeze moves its page
   * (its canonical, its "newest" line, its editions list), though never its figures.
   */
  it('the sitemap’s dates: the series is dated as the Dataset; a superseded edition moves with every later freeze', () => {
    const oct = { edition: '2026-10', frozenAt: '2026-10-21T05:11:39.330Z' }
    const nov = { edition: '2026-11', frozenAt: '2026-11-01T01:00:00.000Z' }
    const dec = { edition: '2026-12', frozenAt: '2026-12-01T01:00:00.000Z' }
    expect(editionPageLastmod(oct, nov, [])).toBe(nov.frozenAt)
    expect(editionPageLastmod(oct, dec, [])).toBe(dec.frozenAt)
    const fix: Erratum = { edition: '2026-10', at: '2026-12-05T03:00:00.000Z', text: 'x' }
    expect(editionPageLastmod(oct, dec, [fix])).toBe(fix.at)
    // Another edition's erratum is not on this page.
    expect(editionPageLastmod(nov, dec, [fix])).toBe(dec.frozenAt)
    // The series: the newest freeze, or a later erratum to ANY edition.
    expect(seriesLastmod([dec, nov, oct], [])).toBe(dec.frozenAt)
    expect(seriesLastmod([dec, nov, oct], [fix])).toBe(fix.at)
    expect(seriesLastmod([dec, nov, oct], [{ ...fix, at: '2026-11-20T00:00:00.000Z' }])).toBe(dec.frozenAt)
    // The real files: one value for the Dataset and the sitemap.
    expect(teacherCostIndexDataset(EDITIONS, { origin: 'https://eno.vn', name: 'eno.vn' }, ERRATA).dateModified).toBe(seriesLastmod(EDITIONS, ERRATA))
  })

  it('the breadcrumb: the teach hub, the series, and an edition when the page is one', () => {
    const names = (n: Record<string, unknown>) => (n.itemListElement as { name: string; item: string }[]).map((x) => [x.name, x.item])
    expect(names(teacherCostIndexBreadcrumb('https://eno.vn'))).toEqual([
      ['Teach in Vietnam', 'https://eno.vn/teach-in-vietnam'], ['HCMC Teacher Cost & Pay Index', 'https://eno.vn/hcmc-teacher-cost-pay-index'],
    ])
    expect(names(teacherCostIndexBreadcrumb('https://eno.vn', '2026-10')).at(-1)).toEqual(['October 2026 edition', 'https://eno.vn/hcmc-teacher-cost-pay-index/2026-10'])
  })
})
