import { describe, expect, it } from 'vitest'
import {
  compareSchools, isGenericEmployer, normEmployer, payInBand, positivePct, schoolsRedirectPath, screenReviewText, stintParts,
  summarisePay, toVnd, wilsonLower, type PayReport, type RankRow,
} from './logic'

describe('normEmployer', () => {
  it('folds accents, case, punctuation and legal forms', () => {
    expect(normEmployer('RMIT University Vietnam LLC')).toBe('rmit university')
    expect(normEmployer('Swinburne Việt Nam')).toBe('swinburne')
    expect(normEmployer('VUS - The English Center')).toBe('vus the english center')
    expect(normEmployer('The British International School')).toBe('british international school')
    expect(normEmployer('Công ty TNHH EMG Education')).toBe('emg education')
  })
  it('never matches by substring — ILA and VILA stay different', () => {
    expect(normEmployer('ILA Vietnam')).toBe('ila')
    expect(normEmployer('VILA')).toBe('vila')
    expect(normEmployer('ILA')).not.toBe(normEmployer('VILA'))
  })
  it('handles empty input', () => {
    expect(normEmployer(null)).toBe('')
    expect(normEmployer('  ')).toBe('')
  })
})

describe('ranking', () => {
  it('Wilson ranks 9/1 above 1/0 (a single friendly vote cannot top the list)', () => {
    expect(wilsonLower(9, 1)).toBeGreaterThan(wilsonLower(1, 0))
    expect(wilsonLower(0, 0)).toBe(0)
  })
  it('positive share is null with no votes, never 0 %', () => {
    expect(positivePct(0, 0)).toBeNull()
    expect(positivePct(3, 1)).toBe(75)
  })
  it('sorts are stable and tie-break on votes then name', () => {
    const rows: RankRow[] = [
      { name: 'B', up: 1, down: 0, reviews: 0, jobs: 2 },
      { name: 'A', up: 9, down: 1, reviews: 3, jobs: 0 },
      { name: 'C', up: 0, down: 0, reviews: 0, jobs: 0 },
    ]
    expect([...rows].sort(compareSchools('top')).map((r) => r.name)).toEqual(['A', 'B', 'C'])
    expect([...rows].sort(compareSchools('hiring')).map((r) => r.name)).toEqual(['B', 'A', 'C'])
    expect([...rows].sort(compareSchools('name')).map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })
})

describe('summarisePay', () => {
  const now = new Date('2026-10-04T00:00:00Z')
  const rep = (i: number, payVnd: number, payPeriod: 'hour' | 'month' = 'hour', age = 0): PayReport =>
    ({ payVnd, payPeriod, profileId: `p${i}`, createdAt: new Date(now.getTime() - age * 86400000) })

  it('hides pay below 5 distinct reporters (k-anonymity), but says how many there are', () => {
    const s = summarisePay([rep(1, 400_000), rep(2, 450_000), rep(3, 500_000), rep(4, 550_000)], now)
    expect(s).toEqual([{ period: 'hour', n: 4, shown: false }])
  })
  it('shows the interpolated 20th–80th percentile widened outward — never the plain 2nd and 4th pay', () => {
    // Five round-number reports — the case where a plain 25th–75th percentile IS the 2nd and 4th pay.
    const vals = [400_000, 450_000, 500_000, 550_000, 600_000]
    const s = summarisePay(vals.map((v, i) => rep(i, v)), now)
    expect(s).toEqual([{ period: 'hour', shown: true, lo: 400_000, hi: 600_000 }])
    const h = s[0]
    if (h.shown) {
      expect(h.lo % 50_000).toBe(0)
      expect(h.hi % 50_000).toBe(0)
      // wider than the 2nd and 4th reports (which a plain 25th–75th percentile would print exactly)
      expect(h.lo).toBeLessThan(vals[1])
      expect(h.hi).toBeGreaterThan(vals[3])
    }
  })
  it('monthly pay rounds outward to a million', () => {
    const s = summarisePay([28, 30, 31, 33, 40].map((m, i) => rep(i, m * 1_000_000, 'month')), now)
    expect(s).toEqual([{ period: 'month', shown: true, lo: 29_000_000, hi: 35_000_000 }])
  })
  it('never pools hourly with monthly', () => {
    const s = summarisePay([...[1, 2, 3, 4, 5].map((i) => rep(i, 400_000)), rep(9, 45_000_000, 'month')], now)
    expect(s.map((x) => [x.period, x.shown ? 'shown' : x.n])).toEqual([['hour', 'shown'], ['month', 1]])
  })
  it('one report per account, and reports older than 3 years drop out', () => {
    const s = summarisePay([rep(1, 400_000), rep(1, 900_000), rep(2, 400_000, 'hour', 4 * 365)], now)
    expect(s).toEqual([{ period: 'hour', n: 1, shown: false }])
  })
})

describe('pay input', () => {
  it('converts USD at the given rate and refuses an absurd rate', () => {
    expect(toVnd(20, 'USD', 25_500)).toBe(510_000)
    expect(toVnd(20, 'USD', 1)).toBeNull()
    expect(toVnd(400_000, 'VND', null)).toBe(400_000)
    expect(toVnd(-1, 'VND', null)).toBeNull()
  })
  it('refuses an extra-zero typo instead of averaging it', () => {
    expect(payInBand(450_000, 'hour')).toBe(true)
    expect(payInBand(4_500_000_0, 'hour')).toBe(false)
    expect(payInBand(45_000_000, 'month')).toBe(true)
    expect(payInBand(450_000, 'month')).toBe(false)
  })
})

describe('stintParts', () => {
  it('is coarse and shows the leaving year only on request', () => {
    expect(stintParts({ current: false, tenure: '2plus', role: 'teacher', leftYear: 2024, showLeftYear: false }).map((p) => p.en))
      .toEqual(['Former teacher', '2+ years'])
    expect(stintParts({ current: false, tenure: '2plus', role: 'teacher', leftYear: 2024, showLeftYear: true }).map((p) => p.en))
      .toEqual(['Former teacher', '2+ years', 'left 2024'])
    expect(stintParts({ current: true, tenure: 'lt1', role: 'assistant', leftYear: null, showLeftYear: true }).map((p) => p.en))
      .toEqual(['Current teaching assistant', 'under 1 year'])
  })
})

describe('screenReviewText', () => {
  it('refuses links', () => {
    expect(screenReviewText(['see www.example.com for more'])).toEqual({ ok: false, code: 'links_not_allowed' })
    expect(screenReviewText(['https://x.y'])).toEqual({ ok: false, code: 'links_not_allowed' })
    for (const t of ['their site ila.edu.vn says', 'see bit.ly/abc', 'example.com']) expect(screenReviewText([t]).ok, t).toBe(false)
    for (const t of ['I taught Node.js, e.g. to adults', 'IELTS 6.5 classes', 'Mr. Smith said the U.S. curriculum',
      'I taught ASP.NET to adults', 'Pay was late.Me and two others left', 'Poor management.Co-workers were kind']) expect(screenReviewText([t]).ok, t).toBe(true)
  })
  it('flags accusations for the moderator in English and Vietnamese, without refusing', () => {
    expect(screenReviewText(['They are a scam, avoid'])).toEqual({ ok: true, flags: ['accusation'] })
    expect(screenReviewText(['Trung tâm này lừa đảo giáo viên'])).toEqual({ ok: true, flags: ['accusation'] })
    expect(screenReviewText(['Great students, late pay twice'])).toEqual({ ok: true, flags: [] })
  })
})

describe('schoolsRedirectPath', () => {
  it('maps the subdomain onto /schools and never leaves the domain', () => {
    expect(schoolsRedirectPath('/', '')).toBe('/schools')
    expect(schoolsRedirectPath('/vus', '?sort=net')).toBe('/schools/vus?sort=net')
    expect(schoolsRedirectPath('//evil.example/x', '')).toBe('/schools/evil.example/x')
  })
})

describe('isGenericEmployer', () => {
  it('refuses the phrases job boards print for a hidden employer, and anything under 3 characters', () => {
    for (const n of ['The International School', 'English Center', 'Trung tâm Anh ngữ', 'Confidential', 'IU', 'E2', 'International School Vietnam Co., Ltd']) {
      expect(isGenericEmployer(normEmployer(n)), n).toBe(true)
    }
  })
  it('keeps real names and acronyms', () => {
    for (const n of ['ILA Vietnam', 'VUS', 'TIS', 'Apollo English', 'British International School']) expect(isGenericEmployer(normEmployer(n)), n).toBe(false)
  })
})
