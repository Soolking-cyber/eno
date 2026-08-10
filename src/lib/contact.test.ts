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

  // ⚠️ THIS IS THE CASE THAT WAS BROKEN FOR EVERY SELLER IN PRODUCTION — and the previous version
  // of this test PINNED THE BUG, with a comment calling it "latent rather than universal" on the
  // reasoning that the wizard does not normalise. That reasoning was wrong in both halves: the
  // wizard does normalise (`normalizePhone`, every write path), which is precisely WHY all 9
  // sellers with a number store it in `+…` form and none start with '0' — so the old function's
  // repair branch never fired and 100% of reveals emitted an unusable `tel:`. Counting the rows
  // refuted an argument that had sounded airtight. Keep this assertion; it is the regression.
  it('tel: KEEPS the plus on an already-international number (E.164, dials)', () => {
    expect(telHref('+84901234567')).toBe('tel:+84901234567')
  })

  it('tel: a non-VN country code keeps its plus too', () => {
    // Two sellers hold non-+84 numbers. The old code emitted `tel:77…`, which dials nothing.
    expect(telHref('+77012345622')).toBe('tel:+77012345622')
  })

  it('tel: still repairs a hand-typed local number — the branch the old code existed for', () => {
    expect(telHref('0901234567')).toBe('tel:+84901234567')
  })

  it('tel: is idempotent, so a stored canonical number survives a round trip', () => {
    expect(telHref(telHref('+84901234567').replace('tel:', ''))).toBe('tel:+84901234567')
  })

  // ⚠️ TOTALITY. telHref now delegates to normalizePhone, and two reviewers flagged that the
  // helper's contract is invisible from this module — if it returned null/undefined for an input it
  // could not parse, TS would not complain inside a template literal and we would emit `tel:null`.
  // It does not (src/lib/phone.ts: `return d ? '+'+d : ''`), but "I read it once" is not a contract.
  // These pin it, so a future change to normalizePhone breaks here rather than in a dial link.
  it.each([
    ['', 'tel:'],
    ['   ', 'tel:'],
    ['not a phone', 'tel:'],
    ['+84 90 123 4567', 'tel:+84901234567'],
    ['(090) 123-4567', 'tel:+84901234567'],
  ])('tel: stays a string for %j', (input, expected) => {
    const out = telHref(input)
    expect(out).toBe(expected)
    expect(out.includes('null') || out.includes('undefined')).toBe(false)
  })

  it('zalo: uses the LOCAL form — an 84-prefixed link opens to "user not found"', () => {
    expect(zaloHref('+84901234567')).toBe('https://zalo.me/0901234567')
    expect(zaloHref('0901234567')).toBe('https://zalo.me/0901234567')
  })
})
