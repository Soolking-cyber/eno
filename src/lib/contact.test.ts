import { describe, expect, it } from 'vitest'
import { phoneForSeller, telHref, zaloHref } from './contact'

/**
 * ⚠️ THIS FILE EXISTS BECAUSE THE ROUTE TEST CANNOT COVER IT. `contact/route.test.ts` MOCKS
 * `@/lib/contact`, so every assertion it makes about partners exercises the mock, not this module —
 * an external reviewer pointed out that a security branch had been added here with zero direct
 * tests, and was right. The route's early 403 and this function's refusal are two independent
 * defences; a test that only proves the first would go green if this one were deleted.
 */
describe('phoneForSeller', () => {
  it('returns a real stored number for an ordinary seller', () => {
    expect(phoneForSeller({ phone: '0901234567', officialPartner: false })).toBe('0901234567')
  })

  it('REFUSES an official partner even when a number is stored', () => {
    // The whole point of the column. Before it existed, "partners share no phone" held only while
    // the column happened to be NULL — one profile save would have undone it silently.
    expect(phoneForSeller({ phone: '0901234567', officialPartner: true })).toBeNull()
  })

  // ⚠️ NULL IS UNREACHABLE FROM THE DATABASE — the column is `NOT NULL DEFAULT false`, so no row
  // can produce it. An earlier version of this comment claimed it covered "legacy rows predating
  // the column", which cannot exist; a reviewer was right to call that out. The branch is here
  // because Prisma's payload types admit `boolean | null` in some shapes, and the behaviour is
  // pinned so the fail direction is a DECISION rather than an accident: null means "we were not
  // told", which must not silently hide an ordinary seller's phone.
  it('treats a null flag as not-a-partner (type-level only; the column is NOT NULL)', () => {
    expect(phoneForSeller({ phone: '0901234567', officialPartner: null })).toBe('0901234567')
  })

  it('returns null for a seller with no number, partner or not', () => {
    expect(phoneForSeller({ phone: null, officialPartner: false })).toBeNull()
    expect(phoneForSeller({ phone: null, officialPartner: true })).toBeNull()
  })

  it('treats whitespace as no number rather than handing back a blank string', () => {
    expect(phoneForSeller({ phone: '   ', officialPartner: false })).toBeNull()
  })

  it('trims a padded number instead of leaking the padding into a tel: link', () => {
    expect(phoneForSeller({ phone: '  0901234567  ', officialPartner: false })).toBe('0901234567')
  })
})

describe('link builders', () => {
  it('tel: normalizes a local VN number to E.164', () => {
    expect(telHref('0901234567')).toBe('tel:+84901234567')
  })

  // ⚠️ PRE-EXISTING DEFECT, PINNED HERE AS-IS RATHER THAN FIXED IN A BADGE COMMIT.
  // `digits()` strips the '+', so an already-international number falls through the
  // `startsWith('0')` branch untouched and emits `tel:84901234567` — no plus, which is not E.164
  // and will not dial. Only reachable when a seller STORED their number in +84/84 form (the wizard
  // does not normalise), so it is latent rather than universal.
  // This test asserts what the code DOES, so it goes red the moment someone fixes it — at which
  // point flip it to expect 'tel:+84901234567'. The fix is one line (prefix '+' when the digits
  // already start with 84), but it changes a live contact-reveal dial path for existing sellers,
  // which does not belong in the same commit as a partner badge. Reported to the owner separately.
  it('tel: DROPS THE PLUS on an already-international number (known bug, see comment)', () => {
    expect(telHref('+84901234567')).toBe('tel:84901234567')
  })

  it('zalo: uses the LOCAL form — an 84-prefixed link opens to "user not found"', () => {
    expect(zaloHref('+84901234567')).toBe('https://zalo.me/0901234567')
    expect(zaloHref('0901234567')).toBe('https://zalo.me/0901234567')
  })
})
