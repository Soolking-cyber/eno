import { describe, expect, it } from 'vitest'
import { buildFacetTokens } from '@/lib/facet-tokens'
import { TEACHER_OPTIONS } from '@/lib/teachers/profile'
import { EXPERIENCE_BAND_PHRASE, NOT_PROOF, PROOF_MAX_CHARS, teacherProofFacts, teacherProofLine } from './card-proof'

/**
 * THE TEACHER CARD'S PROOF LINE (owner, 2026-11-12, "build 2" — round-8 A/B test 4). Pinned here:
 *   · the vocabulary — every taxonomy value of experience / cert / degree is either printable or NOT_PROOF, never both,
 *     and every printable label is the taxonomy's own (card-proof.ts restates them so the card bundle never carries the
 *     taxonomy; this file is what keeps the copies honest);
 *   · the server projection (facetTokens → ≤ 2 slugs) — ranked, capped, and blind to every other token;
 *   · PARITY with the tested mock's `proofOf` (variants6/teacher-proof.js) — a frozen table of every shape its 49
 *     teachers had plus edge cases, AND the mock's function ported verbatim, compared over every possible profile;
 *   · the ≤ 22-character budget and the words that must never print, exhaustively, in en and vi.
 */
const en = (e: string) => e
const vi = (e: string, v?: string) => v ?? e

const CERTS = ['tefl', 'tesol', 'celta', 'delta', 'tkt', 'pgce', 'teaching-license', 'other-cert'] as const
const BANDS = [null, 'under-1-year', '1-3-years', '3-5-years', '5-10-years', 'over-10-years'] as const
const DEGREES = [null, 'phd', 'master', 'bachelor', 'associate', 'no-degree'] as const

const tokens = (experience: string | null, degree: string | null, cert: readonly string[], more: Record<string, string | string[]> = {}) =>
  buildFacetTokens({ ...more, experience, degree, cert: [...cert] })
const lineOf = (experience: string | null, degree: string | null, cert: readonly string[], tr: typeof vi = en) =>
  teacherProofLine(teacherProofFacts(tokens(experience, degree, cert)), tr)

/** Every subset of the eight certificates — 256 of them. */
const CERT_SETS: string[][] = Array.from({ length: 1 << CERTS.length }, (_, m) => CERTS.filter((_, i) => m & (1 << i)))

/**
 * THE MOCK'S `proofOf`, PORTED LINE FOR LINE (variants6/teacher-proof.js lines 17-40; only typed, and the `lang`
 * switch made a parameter) — the design the owner chose was tested with this function, so the shipped line must equal it
 * on every profile, not only on the ones the mock happened to show.
 */
function mockProofOf(t: { b: string | null; d: string | null; c: readonly string[] }, isVi: boolean): string | null {
  const CERT: Record<string, string> = { delta: 'DELTA', celta: 'CELTA', pgce: 'PGCE', tefl: 'TEFL', tesol: 'TESOL', 'teaching-license': isVi ? 'Giấy phép giảng dạy' : 'Teaching licence', tkt: 'TKT' }
  const CERT_RANK = ['delta', 'celta', 'pgce', 'tefl', 'tesol', 'teaching-license', 'tkt']
  const BAND_SHORT: Record<string, string> = isVi ? { '1-3-years': '1–3 năm', '3-5-years': '3–5 năm', '5-10-years': '5–10 năm', 'over-10-years': '10 năm trở lên' }
    : { '1-3-years': '1–3 yrs', '3-5-years': '3–5 yrs', '5-10-years': '5–10 yrs', 'over-10-years': '10+ yrs' }
  const BAND_ALONE: Record<string, string> = isVi ? { '1-3-years': 'Dạy 1–3 năm', '3-5-years': 'Dạy 3–5 năm', '5-10-years': 'Dạy 5–10 năm', 'over-10-years': 'Dạy 10 năm trở lên' }
    : { '1-3-years': '1–3 years teaching', '3-5-years': '3–5 years teaching', '5-10-years': '5–10 years teaching', 'over-10-years': '10+ years teaching' }
  const DEGREE: Record<string, string> = isVi ? { phd: 'Tiến sĩ', master: 'Thạc sĩ', bachelor: 'Cử nhân' } : { phd: 'PhD', master: "Master's", bachelor: "Bachelor's" }
  const MAX = 22
  const certs = CERT_RANK.filter((c) => t.c.includes(c))
  const band = t.b && BAND_SHORT[t.b] ? t.b : null
  const facts: string[] = []
  if (certs[0]) facts.push(CERT[certs[0]])
  if (band) facts.push(BAND_SHORT[band])
  if (t.d === 'phd' || t.d === 'master') facts.push(DEGREE[t.d])
  if (certs[1]) facts.push(CERT[certs[1]])
  if (t.d === 'bachelor') facts.push(DEGREE[t.d])
  if (!facts.length) return null
  if (facts.length === 1) return band ? BAND_ALONE[band] : facts[0]
  const pair = `${facts[0]} · ${facts[1]}`
  return pair.length <= MAX ? pair : band && facts[0] === BAND_SHORT[band] ? BAND_ALONE[band] : facts[0]
}

describe('the vocabulary is complete, and its labels are the taxonomy\'s own', () => {
  const groups = [
    ['experience', TEACHER_OPTIONS.experience, NOT_PROOF.experience],
    ['cert', TEACHER_OPTIONS.cert, NOT_PROOF.cert],
    ['degree', TEACHER_OPTIONS.degree, NOT_PROOF.degree],
  ] as const

  it('every option is printable XOR not proof — a new taxonomy value fails here until it is placed', () => {
    for (const [key, options, notProof] of groups) {
      for (const o of options) {
        const printable = teacherProofLine([o.value], en) !== null
        const excluded = (notProof as readonly string[]).includes(o.value)
        expect(printable !== excluded, `${key}:${o.value}`).toBe(true)
        // The server agrees with the client about it.
        expect(teacherProofFacts(buildFacetTokens({ [key]: o.value })) !== null, `${key}:${o.value} (server)`).toBe(printable)
      }
      // Nothing in NOT_PROOF is a value the taxonomy no longer has.
      for (const v of notProof) expect(options.map((o) => o.value), `${key}:${v}`).toContain(v)
    }
  })

  it('a certificate or degree prints its taxonomy label / labelVi — an acronym the same in both', () => {
    for (const o of [...TEACHER_OPTIONS.cert, ...TEACHER_OPTIONS.degree]) {
      if (teacherProofLine([o.value], en) === null) continue
      expect(teacherProofLine([o.value], en), o.value).toBe(o.label)
      expect(teacherProofLine([o.value], vi), o.value).toBe(o.labelVi)
    }
    for (const o of TEACHER_OPTIONS.cert) if (/^[A-Z]+$/.test(o.label)) expect(o.labelVi, o.value).toBe(o.label)
  })

  it('a band beside another fact prints the experience facet\'s label ("5–10 yrs"); alone, the profile\'s phrase', () => {
    for (const o of TEACHER_OPTIONS.experience) {
      if (teacherProofLine([o.value], en) === null) continue
      // TKT is the shortest certificate name, so the pair always fits and the band's own label is readable.
      expect(teacherProofLine(['tkt', o.value], en), o.value).toBe(`TKT · ${o.label}`)
      expect(teacherProofLine(['tkt', o.value], vi), o.value).toBe(`TKT · ${o.labelVi}`)
      expect(teacherProofLine([o.value], en), o.value).toBe(EXPERIENCE_BAND_PHRASE[o.value].en)
      expect(teacherProofLine([o.value], vi), o.value).toBe(EXPERIENCE_BAND_PHRASE[o.value].vi)
    }
  })
})

describe('teacherProofFacts — the server projection', () => {
  it('ranks the certificates (DELTA > CELTA > PGCE > TEFL > TESOL > Teaching licence > TKT) and caps at two', () => {
    expect(teacherProofFacts(tokens(null, null, ['tkt', 'tefl', 'delta', 'celta']))).toEqual(['delta', 'celta'])
    expect(teacherProofFacts(tokens(null, null, ['tesol', 'tefl']))).toEqual(['tefl', 'tesol'])
    expect(teacherProofFacts(tokens(null, null, ['tkt', 'teaching-license']))).toEqual(['teaching-license', 'tkt'])
    expect(teacherProofFacts(tokens('5-10-years', 'master', ['celta', 'tefl']))).toEqual(['celta', '5-10-years'])
    expect(teacherProofFacts(tokens('5-10-years', 'phd', []))).toEqual(['5-10-years', 'phd'])
    expect(teacherProofFacts(tokens(null, 'master', ['tefl', 'tesol']))).toEqual(['tefl', 'master'])
    expect(teacherProofFacts(tokens(null, 'bachelor', ['tefl', 'tesol']))).toEqual(['tefl', 'tesol'])
    // ⚠️ ONE assertion for the 9,216 shapes (commit review): an expect() per shape took ~1 s under load.
    const over: string[] = []
    for (const cert of CERT_SETS) for (const b of BANDS) for (const d of DEGREES) {
      if ((teacherProofFacts(tokens(b, d, cert)) ?? []).length > 2) over.push(`${b}/${d}/${cert.join(',')}`)
    }
    expect(over).toEqual([])
  })

  it('drops other-cert, under-1-year, associate and no-degree', () => {
    expect(teacherProofFacts(tokens('under-1-year', 'associate', ['other-cert']))).toBeNull()
    expect(teacherProofFacts(tokens('under-1-year', 'no-degree', []))).toBeNull()
    expect(teacherProofFacts(tokens('under-1-year', 'no-degree', ['other-cert', 'tefl']))).toEqual(['tefl'])
    expect(teacherProofFacts(tokens('1-3-years', 'associate', ['other-cert']))).toEqual(['1-3-years'])
  })

  it('ignores every other token — where the teacher will teach or cover, nationality, subjects', () => {
    const more = {
      workIn: ['hcmc-d7', 'online'], coverArea: ['hcmc-d3'], cover: 'open', coverSlot: ['mon-am'], native: 'native',
      subject: ['ielts', 'phonics'], ageGroup: ['kids'], jobType: ['fulltime'], inVietnam: 'yes', video: 'has-video',
    }
    expect(teacherProofFacts(buildFacetTokens(more))).toBeNull()
    expect(teacherProofFacts(tokens('3-5-years', 'bachelor', ['tesol'], more))).toEqual(['tesol', '3-5-years'])
  })

  it('null for null, \'\', nothing printable, or an unknown certificate', () => {
    expect(teacherProofFacts(null)).toBeNull()
    expect(teacherProofFacts(undefined)).toBeNull()
    expect(teacherProofFacts('')).toBeNull()
    expect(teacherProofFacts('||')).toBeNull()
    expect(teacherProofFacts(tokens(null, null, ['other-cert']))).toBeNull()
    expect(teacherProofFacts(buildFacetTokens({ cert: 'cambridge-diploma' }))).toBeNull()
    expect(teacherProofFacts(buildFacetTokens({ experience: '20-years', degree: 'doctorate' }))).toBeNull()
  })
})

describe('parity with the tested mock (variants6/teacher-proof.js proofOf)', () => {
  // band / degree / certs → en | vi. The first 34 are every distinct shape among the mock's 49 teachers; the last 10 are
  // edge cases. `tl` = teaching-license, `other` = other-cert, `–` = not answered.
  const TABLE = `
1-3 / – / –                              → 1–3 years teaching | Dạy 1–3 năm
over-10 / bachelor / tesol               → TESOL · 10+ yrs | TESOL · 10 năm trở lên
3-5 / – / –                              → 3–5 years teaching | Dạy 3–5 năm
over-10 / master / tefl,tesol            → TEFL · 10+ yrs | TEFL · 10 năm trở lên
5-10 / bachelor / tefl                   → TEFL · 5–10 yrs | TEFL · 5–10 năm
over-10 / bachelor / tefl                → TEFL · 10+ yrs | TEFL · 10 năm trở lên
over-10 / master / tefl                  → TEFL · 10+ yrs | TEFL · 10 năm trở lên
3-5 / bachelor / tefl                    → TEFL · 3–5 yrs | TEFL · 3–5 năm
3-5 / bachelor / tesol                   → TESOL · 3–5 yrs | TESOL · 3–5 năm
5-10 / master / tefl                     → TEFL · 5–10 yrs | TEFL · 5–10 năm
under-1 / no-degree / –                  → null | null
1-3 / associate / other                  → 1–3 years teaching | Dạy 1–3 năm
under-1 / associate / –                  → null | null
1-3 / bachelor / tesol                   → TESOL · 1–3 yrs | TESOL · 1–3 năm
under-1 / no-degree / tefl               → TEFL | TEFL
over-10 / – / –                          → 10+ years teaching | Dạy 10 năm trở lên
under-1 / master / tesol                 → TESOL · Master's | TESOL · Thạc sĩ
1-3 / bachelor / pgce,tefl               → PGCE · 1–3 yrs | PGCE · 1–3 năm
1-3 / bachelor / tefl                    → TEFL · 1–3 yrs | TEFL · 1–3 năm
under-1 / bachelor / tefl                → TEFL · Bachelor's | TEFL · Cử nhân
5-10 / bachelor / other,tefl,tesol       → TEFL · 5–10 yrs | TEFL · 5–10 năm
5-10 / master / other,tl                 → Teaching licence | Giấy phép giảng dạy
3-5 / bachelor / tefl,tesol              → TEFL · 3–5 yrs | TEFL · 3–5 năm
3-5 / no-degree / tefl                   → TEFL · 3–5 yrs | TEFL · 3–5 năm
over-10 / bachelor / other,tl,tefl,tesol → TEFL · 10+ yrs | TEFL · 10 năm trở lên
1-3 / bachelor / tl,tefl,tesol           → TEFL · 1–3 yrs | TEFL · 1–3 năm
under-1 / bachelor / –                   → Bachelor's | Cử nhân
5-10 / bachelor / tesol                  → TESOL · 5–10 yrs | TESOL · 5–10 năm
over-10 / no-degree / tefl               → TEFL · 10+ yrs | TEFL · 10 năm trở lên
over-10 / bachelor / tefl,tesol          → TEFL · 10+ yrs | TEFL · 10 năm trở lên
3-5 / bachelor / other,tl,tefl,tesol     → TEFL · 3–5 yrs | TEFL · 3–5 năm
1-3 / – / tefl,tesol                     → TEFL · 1–3 yrs | TEFL · 1–3 năm
5-10 / – / –                             → 5–10 years teaching | Dạy 5–10 năm
5-10 / bachelor / pgce,tesol             → PGCE · 5–10 yrs | PGCE · 5–10 năm
over-10 / master / –                     → 10+ yrs · Master's | Dạy 10 năm trở lên
5-10 / phd / –                           → 5–10 yrs · PhD | 5–10 năm · Tiến sĩ
– / bachelor / tkt                       → TKT · Bachelor's | TKT · Cử nhân
3-5 / bachelor / –                       → 3–5 yrs · Bachelor's | 3–5 năm · Cử nhân
– / – / celta,delta,tefl                 → DELTA · CELTA | DELTA · CELTA
over-10 / phd / delta                    → DELTA · 10+ yrs | DELTA · 10 năm trở lên
over-10 / phd / tl                       → Teaching licence | Giấy phép giảng dạy
– / master / –                           → Master's | Thạc sĩ
– / – / other                            → null | null
5-10 / master / tl,tefl                  → TEFL · 5–10 yrs | TEFL · 5–10 năm
`
  const BAND_OF: Record<string, string> = { 'under-1': 'under-1-year', '1-3': '1-3-years', '3-5': '3-5-years', '5-10': '5-10-years', 'over-10': 'over-10-years' }
  const CERT_OF: Record<string, string> = { tl: 'teaching-license', other: 'other-cert' }
  const rows = TABLE.trim().split('\n').map((line) => {
    const [shape, out] = line.split('→').map((s) => s.trim())
    const [b, d, c] = shape.split('/').map((s) => s.trim())
    const [outEn, outVi] = out.split('|').map((s) => s.trim())
    return {
      line,
      band: b === '–' ? null : BAND_OF[b],
      degree: d === '–' ? null : d,
      certs: c === '–' ? [] : c.split(',').map((x) => CERT_OF[x] ?? x),
      en: outEn === 'null' ? null : outEn,
      vi: outVi === 'null' ? null : outVi,
    }
  })

  it('reads 44 rows (34 mock shapes + 10 edge cases)', () => {
    expect(rows).toHaveLength(44)
    for (const r of rows) {
      if (r.band) expect(Object.values(BAND_OF), r.line).toContain(r.band)
      for (const c of r.certs) expect(CERTS as readonly string[], r.line).toContain(c)
    }
  })

  it('every frozen row: the shipped line (server projection → client line) equals the mock, en and vi', () => {
    for (const r of rows) {
      expect(lineOf(r.band, r.degree, r.certs, en), `${r.line} [en]`).toBe(r.en)
      expect(lineOf(r.band, r.degree, r.certs, vi), `${r.line} [vi]`).toBe(r.vi)
      // The frozen table is the mock's own output — the port agrees with it.
      expect(mockProofOf({ b: r.band, d: r.degree, c: r.certs }, false), `${r.line} [mock en]`).toBe(r.en)
      expect(mockProofOf({ b: r.band, d: r.degree, c: r.certs }, true), `${r.line} [mock vi]`).toBe(r.vi)
    }
  })
})

describe('exhaustive: 6 bands × 6 degrees × 256 certificate sets, en and vi', () => {
  const NEVER = /other|khác|under|dưới|no degree|không có|associate|cao đẳng/i

  it('≤ PROOF_MAX_CHARS, none of the not-proof words, ≤ 2 printable facts — and equal to the mock\'s proofOf', () => {
    expect(PROOF_MAX_CHARS).toBe(22)
    // ⚠️ MISMATCHES ARE COLLECTED AND ASSERTED ONCE (commit review, 2026-11-12): an expect() per check (~180k of them)
    // ran 5–10 s on a loaded machine, past vitest's 5 s default — a flaky gate. Each entry names its shape and rule.
    const bad: string[] = []
    let lines = 0
    for (const c of CERT_SETS) for (const b of BANDS) for (const d of DEGREES) {
      const facts = teacherProofFacts(tokens(b, d, c))
      const at = `${b}/${d}/${c.join(',')}`
      if (facts) {
        if (facts.length === 0 || facts.length > 2) bad.push(`${at}: ${facts.length} facts`)
        for (const f of facts) if (teacherProofLine([f], en) === null) bad.push(`${at}: fact ${f} prints nothing`)
      }
      for (const [tr, isVi] of [[en, false], [vi, true]] as const) {
        const line = teacherProofLine(facts, tr)
        const shape = `${at} [${isVi ? 'vi' : 'en'}]`
        const mock = mockProofOf({ b, d, c }, isVi)
        if (line !== mock) bad.push(`${shape}: ${JSON.stringify(line)} ≠ mock ${JSON.stringify(mock)}`)
        if (line === null) continue
        lines++
        if (line.length > PROOF_MAX_CHARS) bad.push(`${shape}: ${line.length} chars`)
        if (NEVER.test(line)) bad.push(`${shape}: not-proof word in ${JSON.stringify(line)}`)
      }
    }
    expect(bad).toEqual([])
    expect(lines).toBeGreaterThan(10_000)
  })
})

describe('teacherProofLine — what reaches the card', () => {
  it('a machine-translated language whose words run long: the pair falls back to the first fact, or the band phrase', () => {
    const long = (e: string) => `${e} (a much longer translation)`
    // A certificate leads: its name is never translated, and it stands alone.
    expect(teacherProofLine(['tefl', '5-10-years'], long)).toBe('TEFL')
    // A band leads: the profile's phrase, translated — the card's `truncate` cuts it if it must.
    expect(teacherProofLine(['5-10-years', 'master'], long)).toBe(long('5–10 years teaching'))
    expect(teacherProofLine(['teaching-license', 'tkt'], long)).toBe(long('Teaching licence'))
  })

  it('drops a prototype key, an unknown slug (a newer server) and anything that is not a string', () => {
    for (const s of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'cambridge-diploma']) {
      expect(teacherProofLine([s], en), s).toBeNull()
      expect(teacherProofLine([s, 'tefl'], en), s).toBe('TEFL')
    }
    expect(teacherProofLine([1, null, { slug: 'tefl' }, 'celta'], en)).toBe('CELTA')
    expect(teacherProofFacts('|cert:constructor|experience:__proto__|degree:toString|cert:__proto__|')).toBeNull()
  })

  it('⛔ a payload of another shape (a cached /saved card from an older or newer build) is null, never a crash', () => {
    for (const shape of ['TEFL · 5–10 yrs', { 0: 'tefl', length: 1 }, 42, true, null, undefined, []]) {
      expect(teacherProofLine(shape, en), JSON.stringify(shape) ?? String(shape)).toBeNull()
    }
  })
})

describe('EXPERIENCE_BAND_PHRASE — the profile\'s facts line reads it too', () => {
  it('keeps all five bands, under a year included (the profile prints it; the card never does)', () => {
    expect(Object.keys(EXPERIENCE_BAND_PHRASE).sort()).toEqual(TEACHER_OPTIONS.experience.map((o) => o.value).sort())
    expect(EXPERIENCE_BAND_PHRASE['under-1-year']).toEqual({ en: 'Under 1 year teaching', vi: 'Dạy dưới 1 năm' })
    expect(EXPERIENCE_BAND_PHRASE['over-10-years']).toEqual({ en: '10+ years teaching', vi: 'Dạy 10 năm trở lên' })
  })
})
