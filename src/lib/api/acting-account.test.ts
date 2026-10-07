import { describe, expect, it } from 'vitest'
import { ACTING_ACCOUNT_HEADER, actingAccountHeaders, actingAccountMismatch } from './acting-account'

/**
 * The account a delayed write was tapped as (src/lib/api/acting-account.ts). The header can only ever
 * NARROW what a request may do: absent or empty, the route behaves exactly as it did before it existed.
 */

const req = (named?: string) =>
  new Request('https://eno.vn/api/conversations/c1', { method: 'DELETE', headers: named === undefined ? {} : { [ACTING_ACCOUNT_HEADER]: named } })

describe('actingAccountHeaders', () => {
  it('names the account that tapped', () => {
    expect(actingAccountHeaders('u1')).toEqual({ 'x-eno-acting-account': 'u1' })
  })

  it('no account known at the tap → no header at all, so the server keeps its old behaviour', () => {
    expect(actingAccountHeaders(null)).toEqual({})
    expect(actingAccountHeaders('')).toEqual({})
  })
})

describe('actingAccountMismatch', () => {
  it('⛔ the session belongs to a DIFFERENT account than the one named → mismatch', () => {
    expect(actingAccountMismatch(req('u1'), 'u2')).toBe(true)
  })

  it('the same account → no mismatch', () => {
    expect(actingAccountMismatch(req('u1'), 'u1')).toBe(false)
  })

  it('no header (the native dashboards, a page loaded before this shipped) → no mismatch', () => {
    expect(actingAccountMismatch(req(), 'u2')).toBe(false)
  })

  it('an empty header names nobody → no mismatch', () => {
    expect(actingAccountMismatch(req(''), 'u2')).toBe(false)
  })

  it('signed out → no mismatch: the route’s own 401 answers that', () => {
    expect(actingAccountMismatch(req('u1'), null)).toBe(false)
  })
})
