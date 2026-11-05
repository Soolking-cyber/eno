import { describe, expect, it } from 'vitest'
import { isFacebookPhotoUrl, priceFromUnit, reportedItem, vndFromFacebook, workerReport } from './shared'

describe('priceFromUnit', () => {
  it.each([
    ['65', 'million', 65_000_000], ['15', 'million', 15_000_000], ['120', 'thousand', 120_000], ['3500000', 'as_is', 3_500_000], ['0', 'as_is', 0],
  ])('%s as %s → %s', (a, u, n) => expect(priceFromUnit(a, 'VND', u)).toBe(n))
  it.each([['65', 'as_is'], ['1', 'unknown'], ['123456', 'unknown'], ['0', 'unknown'], ['65', 'nonsense'], ['65', undefined]])('%s as %s stays blank: under 1,000đ is never a price', (a, u) => expect(priceFromUnit(a, 'VND', u)).toBeNull())
  it.each([['1.50', 'million', 1_500_000], ['1.25', 'million', 1_250_000], ['2.5', 'thousand', 2_500]])('%s as %s is scaled before rounding: %s', (a, u, n) => expect(priceFromUnit(a, 'VND', u)).toBe(n))
  it.each([['500000', 'million', 500_000], ['3000000', 'thousand', 3_000_000]])('%s can’t be shorthand for %s: it stays as written', (a, u, n) => expect(priceFromUnit(a, 'VND', u)).toBe(n))
  it('only đồng is scaled', () => expect(priceFromUnit('65', 'USD', 'million')).toBeNull())
})

describe('vndFromFacebook', () => {
  it.each([['5000000.00', 'VND', 5000000], ['1500', 'VND', 1500], ['0', 'VND', 0], ['1500.50', 'VND', 1501]])('%s %s → %s', (a, c, n) => expect(vndFromFacebook(a, c)).toBe(n))
  it.each([['200', 'USD'], ['200', null], [null, 'VND'], ['1,5', 'VND'], ['-3', 'VND'], ['abc', 'VND'], ['99999999999999', 'VND'], ['65', 'VND'], ['999', 'VND']])('%s %s has no eno price', (a, c) => expect(vndFromFacebook(a, c)).toBeNull())
})

describe('isFacebookPhotoUrl: the box fetches these', () => {
  it.each(['https://scontent.fsgn2-1.fna.fbcdn.net/v/t45.jpg?oe=1'])('takes %s', (u) => expect(isFacebookPhotoUrl(u)).toBe(true))
  it.each(['http://scontent.fbcdn.net/a.jpg', 'https://fbcdn.net.evil.example/a.jpg', 'https://evil.example/?x=.fbcdn.net', 'https://a@scontent.fbcdn.net/a.jpg', 'https://scontent.fbcdn.net:8443/a.jpg', 'https://169.254.169.254/latest', 'nonsense'])('refuses %s', (u) => expect(isFacebookPhotoUrl(u)).toBe(false))
})

describe('the worker’s report is validated', () => {
  const item = { fbItemId: '12345678', title: 'A chair', description: null, priceAmount: '100000', currency: 'VND', location: null, condition: null, photos: ['https://scontent.fbcdn.net/a.jpg'] }
  it('takes a well-formed item', () => expect(reportedItem.safeParse(item).success).toBe(true))
  it('refuses a photo from anywhere else, or a hand-made id', () => {
    expect(reportedItem.safeParse({ ...item, photos: ['https://evil.example/a.jpg'] }).success).toBe(false)
    expect(reportedItem.safeParse({ ...item, fbItemId: '../x' }).success).toBe(false)
  })
  it('caps a batch and names only known kinds', () => {
    expect(workerReport.safeParse({ kind: 'items', jobId: 'j', leaseId: 'l', items: Array(26).fill(item) }).success).toBe(false)
    expect(workerReport.safeParse({ kind: 'delete_everything', jobId: 'j', leaseId: 'l' }).success).toBe(false)
  })
})
