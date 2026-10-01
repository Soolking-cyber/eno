import { describe, it, expect } from 'vitest'
import { listingMoneyFor, paysSalary, salaryPriceFor, salaryMFromPrice, parseSalaryInput, takesOffers, resolveListingType, rangeFacetsFor, typesFor, facetsFor, isRequiredFacet } from './taxonomy'

/**
 * A JOB IS PAID A SALARY, NOT PRICED (owner, 2026-10-01: "when posting a job we have price — if job
 * selected it should be salary and urgent hire etc."). These are the pure rules every write path and
 * every offer gate reads; the server's use of them is in core/listings.job-pay.test.ts.
 */
describe('paysSalary — the job intent, and only it', () => {
  it('is true for a job and false for every other intent', () => {
    expect(paysSalary('job')).toBe(true)
    for (const t of ['sell', 'rent', 'free', 'wanted', 'wholesale', 'service', 'event', 'teacher', '', null, undefined]) {
      expect(paysSalary(t), String(t)).toBe(false)
    }
  })

  it('a NEW jobs-category post resolves to the job intent unless it asks for another the category allows', () => {
    expect(typesFor('jobs')[0]).toBe('job')
    expect(resolveListingType('jobs', undefined)).toBe('job')
    expect(resolveListingType('jobs', '')).toBe('job')
    expect(resolveListingType('jobs', 'sell')).toBe('job') // not a jobs intent → the category's primary
    expect(resolveListingType('jobs', 'wanted')).toBe('wanted')
    expect(resolveListingType('electronics', 'job')).toBe('sell') // only the jobs category offers 'job'
  })
})

describe('salaryPriceFor — the stored price of a job is its monthly salary', () => {
  it('is salaryM million đồng', () => {
    expect(salaryPriceFor(45)).toBe(45_000_000)
    expect(salaryPriceFor(1)).toBe(1_000_000)
    expect(salaryPriceFor(25.4)).toBe(25_000_000) // the facet is whole millions
  })

  it('is 0 — "Salary: see details" / negotiable — when no salary is stated', () => {
    for (const v of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(salaryPriceFor(v), String(v)).toBe(0)
  })

  it('the jobs Salary facet is the salaryM range the wizard and the server both read', () => {
    const salary = rangeFacetsFor('jobs').find((f) => f.range.column === 'salaryM')
    expect(salary?.key).toBe('salary')
    expect(salary?.range.unit).toBe('tr/tháng')
  })

  it('a job is stored per MONTH (listingMoneyFor), in đồng', () => {
    expect(listingMoneyFor({ categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job' })).toEqual({ currency: '₫', priceUnit: 'VND/month', isoCode: 'VND' })
  })
})

describe('takesOffers — a job never takes an offer, whatever its stored flag', () => {
  it('follows `negotiable` for everything else', () => {
    expect(takesOffers({ negotiable: true, listingType: 'sell' })).toBe(true)
    expect(takesOffers({ negotiable: false, listingType: 'sell' })).toBe(false)
    expect(takesOffers({ negotiable: true })).toBe(true) // callers that never selected the type keep the old rule
  })

  it('is false on a job even when the row says negotiable (a job stored before the salary rule)', () => {
    expect(takesOffers({ negotiable: true, listingType: 'job' })).toBe(false)
    expect(takesOffers({ negotiable: false, listingType: 'job' })).toBe(false)
  })
})

describe('the jobs facets do not force a false claim', () => {
  it('"English: Required" is optional — it is the facet\'s only option', () => {
    const english = facetsFor('jobs').find((f) => f.key === 'english')
    expect(english?.options.map((o) => o.value)).toEqual(['required'])
    expect(english && isRequiredFacet(english)).toBe(false)
  })
})

describe('salaryMFromPrice — a đồng amount sent for a job is its monthly salary, never rounded UP', () => {
  it('whole millions, rounded down (12,500,000 is 12 tr, not 13)', () => {
    expect(salaryMFromPrice(45_000_000)).toBe(45)
    expect(salaryMFromPrice(12_500_000)).toBe(12)
    expect(salaryMFromPrice(12_999_999)).toBe(12)
    expect(salaryMFromPrice('8000000')).toBe(8) // a CSV / JSON string amount
  })

  it('clamped to the Salary facet (jobs: 0–100 tr)', () => {
    expect(salaryMFromPrice(250_000_000)).toBe(100)
    expect(salaryMFromPrice(1e12)).toBe(100)
  })

  it('states no salary under 1,000,000 ₫ or when not a number', () => {
    for (const v of [0, 20_000, 999_999, -5_000_000, Number.NaN, null, undefined, '', 'abc']) expect(salaryMFromPrice(v), String(v)).toBeNull()
  })
})

describe('parseSalaryInput — what an employer types in the Salary box (million ₫ / month)', () => {
  it('"8.5" and "8,5" are eight and a half million, kept as 8 — never 85', () => {
    expect(parseSalaryInput('8.5')).toBe(8)
    expect(parseSalaryInput('8,5')).toBe(8)
    expect(parseSalaryInput('12.75')).toBe(12)
  })

  it('the full amount in đồng, grouped or not, is millions — never clamped to 100', () => {
    expect(parseSalaryInput('8.000.000')).toBe(8)
    expect(parseSalaryInput('8,000,000')).toBe(8)
    expect(parseSalaryInput('8000000')).toBe(8)
    expect(parseSalaryInput('12.500.000')).toBe(12)
    expect(parseSalaryInput('25 000 000')).toBe(25) // only the first number counts
  })

  it('thousands of đồng ("8000", "8.000" — the "k" way of writing pay) are millions when that fits', () => {
    expect(parseSalaryInput('8000')).toBe(8)
    expect(parseSalaryInput('8.000')).toBe(8)
    expect(parseSalaryInput('25000')).toBe(25)
    // …and an amount that would land past the box's scale as thousands is đồng, never 100 tr.
    expect(parseSalaryInput('500000')).toBe(0)
  })

  it('plain millions, a unit, or a range read as written (a range keeps its floor)', () => {
    expect(parseSalaryInput('25')).toBe(25)
    expect(parseSalaryInput('15tr')).toBe(15)
    expect(parseSalaryInput('15 triệu')).toBe(15)
    expect(parseSalaryInput('10-15')).toBe(10)
    expect(parseSalaryInput('8.')).toBe(8) // mid-typing "8.5"
  })

  it('an empty or numberless box is no salary', () => {
    for (const v of ['', ' ', '.', ',', 'abc', 'thỏa thuận']) expect(parseSalaryInput(v), v).toBeNull()
  })

  it('is NOT clamped — the box clamps on blur, like every range spec', () => {
    expect(parseSalaryInput('250')).toBe(250)
  })
})
