import { describe, expect, it } from 'vitest'
import {
  RENTAL_CHECK_CHANNELS, RENTAL_CHECK_ID_RE, RENTAL_CHECK_REQUEST_ID_RE,
  normaliseRentalContact, rentalContactHref, rentalCheckApplies, type RentalCheckChannel,
} from './shared'
import { TAXONOMY } from '../taxonomy'

/**
 * The contact a requester types is the one field of the card that is free text AND is turned into
 * a link the operator taps. These pin the three things that matter: each channel accepts what real
 * people type, refuses what it cannot deliver to, and stores a FIXED POINT — the card schema on the
 * server refuses any value that does not normalise to itself.
 */
describe('normaliseRentalContact — zalo', () => {
  it.each([
    ['0901234567', '84901234567'],
    ['090 123 4567', '84901234567'],
    ['+84 90 123 4567', '84901234567'],
    ['84901234567', '84901234567'],
    ['901234567', '84901234567'], // nine bare digits = a VN mobile typed without its 0
    ['  0381234567 ', '84381234567'],
  ])('accepts a Vietnamese mobile %j → %j', (raw, want) => {
    expect(normaliseRentalContact('zalo', raw)).toEqual({ ok: true, value: want })
  })

  it.each([
    '+1 415 555 0100', // a foreign number — Zalo cannot reach it
    '0241234567', // Hanoi landline range
    '8431234567', // US 843 area code, not a VN mobile
    'not a number',
  ])('refuses %j as zalo_needs_vn_mobile', (raw) => {
    expect(normaliseRentalContact('zalo', raw)).toEqual({ ok: false, reason: 'zalo_needs_vn_mobile' })
  })
})

describe('normaliseRentalContact — whatsapp', () => {
  it.each([
    ['+1 (415) 555-0100', '14155550100'],
    ['+44 7700 900123', '447700900123'],
    ['0901234567', '84901234567'],
    ['+84901234567', '84901234567'],
    ['+500 12345', '50012345'], // 8 digits — the E.164 floor
  ])('accepts %j → %j', (raw, want) => {
    expect(normaliseRentalContact('whatsapp', raw)).toEqual({ ok: true, value: want })
  })

  it.each([
    '+12345', // too short
    '+1234567890123456', // 16 digits, past E.164
    '+376 312345', // 9 digits: not a fixed point, see the note in shared.ts
    'call me',
  ])('refuses %j as phone_invalid', (raw) => {
    expect(normaliseRentalContact('whatsapp', raw)).toEqual({ ok: false, reason: 'phone_invalid' })
  })
})

describe('normaliseRentalContact — email', () => {
  it('trims and lowercases', () => {
    expect(normaliseRentalContact('email', '  Anna.Nguyen+rent@Example.COM ')).toEqual({ ok: true, value: 'anna.nguyen+rent@example.com' })
  })

  it.each([
    'no-at-sign.example.com',
    'two@@example.com',
    'a@b',
    'a@b.c',
    // URL-structural characters would ride into the operator's mailto: link
    'a@b.co?body=hello',
    'a@b.co#x',
    'a&b@example.com',
    '<a@example.com>',
    'a b@example.com',
    'a@exa\u0000mple.com',
  ])('refuses %j', (raw) => {
    expect(normaliseRentalContact('email', raw)).toEqual({ ok: false, reason: 'email_invalid' })
  })

  it('refuses an address longer than 254 characters', () => {
    const long = `${'a'.repeat(250)}@example.com`
    expect(normaliseRentalContact('email', long)).toEqual({ ok: false, reason: 'email_invalid' })
  })
})

describe('normaliseRentalContact — shared behaviour', () => {
  it.each(RENTAL_CHECK_CHANNELS)('%s: empty or whitespace is "empty"', (channel) => {
    expect(normaliseRentalContact(channel, '')).toEqual({ ok: false, reason: 'empty' })
    expect(normaliseRentalContact(channel, '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normaliseRentalContact(channel, undefined as unknown as string)).toEqual({ ok: false, reason: 'empty' })
  })

  /**
   * ⛔ THE PROPERTY THE SERVER'S CARD SCHEMA IS BUILT ON. Every accepted value must normalise to
   * itself, or a card re-read from the database would be refused (or worse, dial another number).
   */
  const samples: Array<[RentalCheckChannel, string]> = [
    ['zalo', '0901234567'], ['zalo', '+84 38 123 4567'], ['zalo', '901234567'],
    ['whatsapp', '+1 415 555 0100'], ['whatsapp', '0901234567'], ['whatsapp', '+500 12345'], ['whatsapp', '+44 7700 900123'],
    ['email', ' Foo@Bar.COM '],
  ]
  it.each(samples)('%s %j is a fixed point', (channel, raw) => {
    const once = normaliseRentalContact(channel, raw)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(normaliseRentalContact(channel, once.value)).toEqual(once)
  })
})

describe('rentalContactHref', () => {
  it('builds the three deep links from the normalised value', () => {
    expect(rentalContactHref('zalo', '84901234567')).toBe('https://zalo.me/84901234567')
    expect(rentalContactHref('whatsapp', '14155550100')).toBe('https://wa.me/14155550100')
    expect(rentalContactHref('email', 'a@example.com')).toBe('mailto:a@example.com')
  })

  it('never carries text that does not normalise', () => {
    expect(rentalContactHref('email', 'a@b.co?body=pwned')).toBe('mailto:')
    expect(rentalContactHref('zalo', 'javascript:alert(1)')).toBe('https://zalo.me/')
  })
})

describe('id shapes', () => {
  it('listing ids: bounded charset, no free text', () => {
    expect(RENTAL_CHECK_ID_RE.test('cmqumj6s3000004kzfx64tlh1')).toBe(true)
    expect(RENTAL_CHECK_ID_RE.test('rever-12345_a')).toBe(true)
    expect(RENTAL_CHECK_ID_RE.test('')).toBe(false)
    expect(RENTAL_CHECK_ID_RE.test('a b')).toBe(false)
    expect(RENTAL_CHECK_ID_RE.test('x'.repeat(65))).toBe(false)
  })

  it('request ids: 8..64 of the same charset', () => {
    expect(RENTAL_CHECK_REQUEST_ID_RE.test('abcdefgh')).toBe(true)
    expect(RENTAL_CHECK_REQUEST_ID_RE.test('abcdefg')).toBe(false)
    expect(RENTAL_CHECK_REQUEST_ID_RE.test('3f9c1e2a-5b7d-4c8e-9f01-23456789abcd')).toBe(true)
    expect(RENTAL_CHECK_REQUEST_ID_RE.test('bad id!!')).toBe(false)
  })
})

/**
 * THE ONE GATE FOR EVERY RentalCheckToggle MOUNT (2026-10-01): car and motorbike PDPs offered the HOUSING
 * availability check. Vehicle hire — and only vehicle hire — is excluded from the rentals category.
 */
describe('rentalCheckApplies', () => {
  it('a home in rentals: yes — and a rentals row with no subcategory is a place (an unmapped Rever row)', () => {
    for (const sub of ['apartment-rental', 'house-rental', 'room-rental', 'hotel-short-stay', 'homestay-serviced', 'office-rental', null, undefined]) {
      expect(rentalCheckApplies('rentals', sub), String(sub)).toBe(true)
    }
  })

  it('vehicle hire: never — car, motorbike, bicycle, e-bike', () => {
    for (const sub of ['car-rental', 'motorbike-rental', 'bicycle-rental', 'ebike-rental']) {
      expect(rentalCheckApplies('rentals', sub), sub).toBe(false)
    }
  })

  it('outside rentals: never', () => {
    expect(rentalCheckApplies('vehicles', 'car-rental')).toBe(false)
    expect(rentalCheckApplies('electronics', null)).toBe(false)
    expect(rentalCheckApplies(undefined, undefined)).toBe(false)
  })

  it('every vehicle-hire slug it excludes is a REAL rentals subcategory (a typo would silently let it through)', () => {
    const rentals = TAXONOMY.find((c) => c.slug === 'rentals')!
    const slugs = new Set(rentals.subcategories.map((s) => s.slug))
    for (const sub of ['car-rental', 'motorbike-rental', 'bicycle-rental', 'ebike-rental']) expect(slugs.has(sub), sub).toBe(true)
    // …and every OTHER rentals subcategory still gets the check.
    for (const sub of slugs) {
      if (!['car-rental', 'motorbike-rental', 'bicycle-rental', 'ebike-rental'].includes(sub)) expect(rentalCheckApplies('rentals', sub), sub).toBe(true)
    }
  })
})
