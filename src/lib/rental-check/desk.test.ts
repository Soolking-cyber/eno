import { afterEach, describe, expect, it } from 'vitest'
import { rentalOperatorEmail } from './desk'

// The renters' availability check was removed on 2026-11-25; the desk module keeps only the operator's address, which the
// teacher-schools ask and the Trustpilot invite still read.
describe('rentalOperatorEmail', () => {
  const before = process.env.RENTAL_CHECK_OPERATOR_EMAIL
  afterEach(() => {
    if (before === undefined) delete process.env.RENTAL_CHECK_OPERATOR_EMAIL
    else process.env.RENTAL_CHECK_OPERATOR_EMAIL = before
  })
  it('defaults to support@eno.forum', () => {
    delete process.env.RENTAL_CHECK_OPERATOR_EMAIL
    expect(rentalOperatorEmail()).toBe('support@eno.forum')
  })
  it('reads RENTAL_CHECK_OPERATOR_EMAIL per call, trimmed and lowercased', () => {
    process.env.RENTAL_CHECK_OPERATOR_EMAIL = '  Ops@Example.COM '
    expect(rentalOperatorEmail()).toBe('ops@example.com')
  })
})
