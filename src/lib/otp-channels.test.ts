import { describe, expect, it } from 'vitest'
import { normalizePhoneVN } from './otp-channels'

// Characterization (audit P2): the OTP dispatch number. The old implementation
// 84-prefixed EVERY non-84 number — a +1/+44 expat sign-up became a bogus VN number
// and the code went nowhere on every channel.
describe('normalizePhoneVN', () => {
  it('canonicalizes VN forms', () => {
    expect(normalizePhoneVN('0901234567')).toBe('84901234567')
    expect(normalizePhoneVN('+84 901 234 567')).toBe('84901234567')
    expect(normalizePhoneVN('84901234567')).toBe('84901234567')
    expect(normalizePhoneVN('901234567')).toBe('84901234567') // bare 9-digit mobile
  })

  it('keeps foreign E.164 numbers intact', () => {
    expect(normalizePhoneVN('+1 555 010 0000')).toBe('15550100000')
    expect(normalizePhoneVN('+442079460958')).toBe('442079460958')
  })

  it('keeps bare full international digits intact (Supabase drops the +)', () => {
    expect(normalizePhoneVN('15550100000')).toBe('15550100000')
    expect(normalizePhoneVN('442079460958')).toBe('442079460958')
  })
})
