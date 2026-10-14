import { describe, expect, it } from 'vitest'
import {
  PROVIDER_LEGAL_NAME,
  PROVIDER_LICENCE_KEYS,
  PROVIDER_LICENCE_LIMITS,
  PROVIDER_LICENCE_NO,
  PROVIDER_LICENCE_REFUSAL,
  checkProviderLicence,
  isEnterpriseCodeForm,
  normalizeLegalName,
  normalizeLicenceNo,
  providerLicenceFromInput,
  providerLicenceKeysFor,
  providerLicenceOf,
  providerLicenceProblems,
  sameProviderLicence,
  withProviderLicence,
  withoutProviderLicence,
} from './provider-licence'
import { containsPhoneNumber } from './phone'
import { containsContactInfo, findBannedWord } from './publish-guard'
import { TAXONOMY, subcategoriesFor } from './taxonomy'

/**
 * THE PROVIDER'S LICENCE VALUES (owner, 2026-10-14: "seller enters") — src/lib/provider-licence.ts. A table built from
 * the plan's probe values: real licence and registration shapes are accepted as typed; a bare number in e-Visa, a
 * personal ID, a phone, a link or a banned word is refused. The wizard and the server run these same rules.
 * R6 (plan review, 2026-10-14): a phone cut up by letters or slashes is refused from the digits alone, and every real
 * licence shape the review named still passes — measured against the real detector, which calls several of them phones.
 */

const VIETKITE = 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE'
const AISLES = ['visa-legal', 'legal-permits'] as const
/** The licence number's problem when the name is a clean one. */
const numberIn = (sub: string, licenceNo: string) => checkProviderLicence({ legalName: VIETKITE, licenceNo }, sub)
/** The name's problem when the number is a clean one for the aisle. */
const nameIn = (legalName: string, sub = 'visa-legal') =>
  checkProviderLicence({ legalName, licenceNo: sub === 'visa-legal' ? '79-123/2019/TCDL-GP LHQT' : '0312345678' }, sub)

describe('licence numbers — accepted as typed', () => {
  it.each(['0312345678', '0201234567', '0401234567', '0101234567', '0312345678-001', '01021234/TP/ĐKHĐ', '41.02.1234/TP/ĐKHĐ'])(
    'Legal & permits: %s',
    (n) => { expect(numberIn('legal-permits', n)).toBeNull() },
  )

  it.each(['79-123/2019/TCDL-GP LHQT', '79-0234/2018/TCDL-GP LHQT', '01-1234/2019/TCDL-GP LHQT', '01-0912/2017/TCDL-GP LHQT'])(
    'e-Visa (and Legal & permits): %s',
    (n) => {
      for (const sub of AISLES) expect(numberIn(sub, n), sub).toBeNull()
    },
  )

  it('a copied "Số:" label is dropped — the stored number is the bare licence', () => {
    expect(normalizeLicenceNo('Số: 79-123/2019/TCDL-GP LHQT')).toBe('79-123/2019/TCDL-GP LHQT')
    expect(normalizeLicenceNo('  No.  01-1234/2019/TCDL-GP LHQT ')).toBe('01-1234/2019/TCDL-GP LHQT')
    expect(numberIn('visa-legal', 'Số: 79-123/2019/TCDL-GP LHQT')).toBeNull()
  })

  // R6: every shape the review named, plus the other province codes that start with 0 (and Trà Vinh's 84).
  it.each([
    '79-123/2019/TCDL-GP LHQT', '01-1234/2019/TCDL-GP LHQT', '02-0123/2019/TCDL-GP LHQT', '08-0456/2020/TCDL-GP LHQT',
    '48-0789/2021/TCDL-GP LHQT', '04-0567/2022/TCDL-GP LHQT', '06-1234/2023/TCDL-GP LHQT', '84-2345/2019/TCDL-GP LHQT',
  ])('R6: a travel licence passes the digit screen, in either aisle: %s', (n) => {
    for (const sub of AISLES) expect(numberIn(sub, n), sub).toBeNull()
  })

  it.each(['01021234/TP/ĐKHĐ', '41.02.1234/TP/ĐKHĐ'])('R6: a law-firm registration passes the digit screen: %s', (n) => {
    expect(numberIn('legal-permits', n)).toBeNull()
  })

  it('R6: the narrowing is measured, not assumed — the generic detector calls these licences’ digits a phone', () => {
    // Why the digit screen reads only a real number's exact shape (PHONE_IN_DIGITS): containsPhoneNumber on the digits
    // alone would refuse every one of these real licences.
    for (const n of ['02-0123/2019/TCDL-GP LHQT', '08-0456/2020/TCDL-GP LHQT', '04-0567/2022/TCDL-GP LHQT', '06-1234/2023/TCDL-GP LHQT', '84-2345/2019/TCDL-GP LHQT']) {
      expect(containsPhoneNumber(n.replace(/\D/g, '')), n).toBe(true)
      for (const sub of AISLES) expect(numberIn(sub, n), `${n} ${sub}`).toBeNull()
    }
  })
})

describe('licence numbers — refused', () => {
  it.each(['0312345678', '3700123456'])('e-Visa never takes a bare number: %s → format', (n) => {
    expect(numberIn('visa-legal', n)).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
  })

  it.each(['0312 345 678', '0312.345.678'])('the enterprise code only in its exact form: %s → format', (n) => {
    expect(numberIn('legal-permits', n)).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
  })

  it.each(['079123456789', '079 123 456 789', '079.123.456.789', '001123456789', '048123456789', '025123456', 'CCCD 079123456789', 'cmnd 025123456'])(
    'a personal ID number, in either aisle: %s → personal_id',
    (n) => {
      for (const sub of AISLES) expect(numberIn(sub, n), sub).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'personal_id' })
    },
  )

  it('the ID-card words are read folded, separators included', () => {
    for (const n of ['Căn cước 079-1234', 'CHỨNG MINH 0251-2345', 'can-cuoc 079/123']) expect(numberIn('legal-permits', n), n).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'personal_id' })
  })

  it.each(['GP 0903 123 456', 'zalo 0903123456', '+84903123456'])('a phone, in either aisle: %s', (n) => {
    for (const sub of AISLES) expect(numberIn(sub, n), sub).not.toBeNull()
  })

  it('a non-bare number keeps the phone screen in Legal & permits too — only the exact bare code skips it', () => {
    expect(numberIn('legal-permits', '0312345678/ĐKKD')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
    expect(numberIn('legal-permits', 'GP 0903 123 456')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
    // The digit screen (R6) does not reach the waiver: the bare code IS a phone's shape, and is still accepted there.
    expect(containsPhoneNumber('0312345678')).toBe(true)
    expect(numberIn('legal-permits', '0312345678')).toBeNull()
    expect(numberIn('legal-permits', '0312345678-001')).toBeNull()
  })

  it.each([
    'ZALO/0903/123/456', 'GP-0903-ABC-123-456', 'A0903B123C456', 'ZALO/090/312/3456', // a mobile cut up by letters or slashes
    'GP/84/903/123/456', // …with 84 for the 0
    'TEL/028/3822/1234', 'GP/0283/822/1234', // an 11-digit landline
    'ZALO/0903/123/456/2019', 'GP 79-123/2019 ZALO 0903/123/456', // digits after it, or a licence before it, do not hide it
    'GP 7/０９０３/１２３/４５６', 'GP 7/⁰⁹⁰³/¹²³/⁴⁵⁶', // full-width or superscript digits
  ])('R6: a phone cut up by letters or slashes is contact, in either aisle: %s', (n) => {
    // Not vacuous: every screen before R6 let these through.
    expect(containsPhoneNumber(n), n).toBe(false)
    expect(containsContactInfo(n), n).toBe(false)
    for (const sub of AISLES) expect(numberIn(sub, n), sub).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
  })

  it('R6: a letterless phone cut up by slashes — contact in Legal & permits (it used to pass), format in e-Visa', () => {
    expect(containsPhoneNumber('0903/123/456')).toBe(false)
    expect(numberIn('legal-permits', '0903/123/456')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
    expect(numberIn('visa-legal', '0903/123/456')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
  })

  it('R6: "+84 903 123 456" is refused as format in either aisle — a "+" is outside the licence characters, checked first', () => {
    // Like every letterless phone ('0903 123 456' is bare, so format too). Among letters, the same digits are contact.
    for (const sub of AISLES) expect(numberIn(sub, '+84 903 123 456'), sub).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
    expect(numberIn('visa-legal', 'GP/84/903/123/456')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
  })

  it('a number in the international travel licence\u2019s exact form skips the digit read — a province-08 serial past 0999 is a real licence (commit gate)', () => {
    // 08-1456/2020 is 0814562020, an 081 mobile's shape — refused before; the form itself is the evidence it is a licence.
    expect(numberIn('visa-legal', '08-1456/2020/TCDL-GP LHQT')).toBeNull()
    expect(numberIn('visa-legal', '08-1456/2020/TCDL-GPLHQT')).toBeNull()
    // A phone dressed in that exact form passes the screen; the admin's comparison with the licence is what catches it.
    expect(numberIn('visa-legal', '09-0312/2019/TCDL-GP LHQT')).toBeNull()
    // Outside the exact form the digit read still applies.
    expect(numberIn('visa-legal', '08-1456/2020/TCDL-GP LHQT zalo')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
    expect(numberIn('visa-legal', 'GP-0903-ABC-123-456')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'contact' })
  })

  it('a citizen-ID number written with separators inside a licence is a personal ID (commit gate)', () => {
    for (const v of ['GP 001/123/456/789', 'GP-079.123.456.789', 'TCDL 048 123 456 789']) {
      expect(numberIn('visa-legal', v), v).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'personal_id' })
    }
    // A real licence's 9–11 digits are not.
    for (const v of ['79-123/2019/TCDL-GP LHQT', '01-12345/2019/TCDL-GP LHQT']) expect(numberIn('visa-legal', v), v).toBeNull()
  })

  it('a run of 11+ digits inside a licence is read as a personal ID', () => {
    expect(numberIn('visa-legal', 'GP 07912345678/TCDL')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'personal_id' })
  })

  it('format, length and digits', () => {
    expect(numberIn('visa-legal', '')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'missing' })
    expect(numberIn('visa-legal', '   ')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'missing' })
    expect(numberIn('visa-legal', `GP ${'1-'.repeat(30)}`)).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'too_long' })
    expect(numberIn('visa-legal', 'G1')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
    expect(numberIn('visa-legal', 'GP#79-123')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
    expect(numberIn('visa-legal', 'GP@79-123')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
    expect(numberIn('visa-legal', 'TCDL-GP LHQT')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'no_digit' })
    // e-Visa: a non-bare number still needs a letter (an international travel-service licence always has one).
    expect(numberIn('visa-legal', '79/2019')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'format' })
    expect(numberIn('legal-permits', '79/2019')).toBeNull()
  })

  it('a banned word in the number', () => {
    expect(numberIn('visa-legal', 'MA TUY 79-123')).toEqual({ field: PROVIDER_LICENCE_NO, reason: 'banned' })
  })
})

describe('registered names', () => {
  it('a real 48-character name is accepted uncut, and NFD input comes back NFC', () => {
    expect(VIETKITE).toHaveLength(48)
    expect(nameIn(VIETKITE)).toBeNull()
    expect(normalizeLegalName(VIETKITE)).toBe(VIETKITE)
    const nfd = VIETKITE.normalize('NFD')
    expect(nfd).not.toBe(VIETKITE) // the probe is not vacuous
    expect(normalizeLegalName(nfd)).toBe(VIETKITE)
  })

  it('a domain-like name that is no link is accepted; a .com name is a link', () => {
    expect(nameIn('CÔNG TY TNHH VISA5S.VN')).toBeNull()
    expect(nameIn('Vietnamvisa.com Co., Ltd')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'contact' })
  })

  it('a phone or an ID-length digit run inside a name is refused', () => {
    expect(nameIn('Công ty ABC 0903 123 456')).not.toBeNull()
    expect(nameIn('Công ty ABC 079123456789')).not.toBeNull()
    expect(nameIn('Công ty ABC 079123456789')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'personal_id' })
    expect(nameIn('Công ty ABC zalo: abc.vn')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'contact' })
  })

  it('R6: the name reads its digits on their own too — a phone cut up by letters or slashes is contact', () => {
    for (const n of ['CÔNG TY ZALO/0903/123/456', 'CÔNG TY TNHH 0903 VÀ 123 456']) {
      expect(containsPhoneNumber(n), n).toBe(false)
      for (const sub of AISLES) expect(nameIn(n, sub), `${n} ${sub}`).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'contact' })
    }
    // Digits that hold no phone stay fine.
    expect(nameIn('CÔNG TY TNHH 1 THÀNH VIÊN DU LỊCH 24H')).toBeNull()
    expect(nameIn('Công ty 368 - Chi nhánh 2')).toBeNull()
  })

  it('length, letters and banned words', () => {
    expect(nameIn('')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'missing' })
    expect(nameIn('A'.repeat(PROVIDER_LICENCE_LIMITS.legalName))).toBeNull()
    expect(nameIn('A'.repeat(PROVIDER_LICENCE_LIMITS.legalName + 1))).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'too_long' })
    expect(nameIn('12345')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'no_letter' })
    const banned = 'CÔNG TY MA TÚY'
    expect(findBannedWord(banned)).toBeTruthy()
    expect(nameIn(banned)).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'banned' })
  })
})

describe('providerLicenceProblems / checkProviderLicence', () => {
  it('one problem per field, name first — what the wizard shows per field; the server answers the first', () => {
    expect(providerLicenceProblems({ legalName: '', licenceNo: '0312345678' }, 'visa-legal')).toEqual([
      { field: PROVIDER_LEGAL_NAME, reason: 'missing' },
      { field: PROVIDER_LICENCE_NO, reason: 'format' },
    ])
    expect(checkProviderLicence({ legalName: '', licenceNo: '' }, 'legal-permits')).toEqual({ field: PROVIDER_LEGAL_NAME, reason: 'missing' })
    expect(providerLicenceProblems(null, 'visa-legal')).toHaveLength(2)
    expect(providerLicenceProblems({ legalName: VIETKITE, licenceNo: '79-123/2019/TCDL-GP LHQT' }, 'visa-legal')).toEqual([])
  })

  it('raw, unnormalised input is fine', () => {
    expect(checkProviderLicence({ legalName: `  ${VIETKITE.normalize('NFD')}\n`, licenceNo: ' Số:\t79-123/2019/TCDL-GP  LHQT ' }, 'visa-legal')).toBeNull()
  })
})

describe('helpers', () => {
  it('the keys, the limits and the refusal (typographic apostrophes only)', () => {
    expect(PROVIDER_LICENCE_KEYS).toEqual(['providerLegalName', 'providerLicenceNo'])
    expect(PROVIDER_LICENCE_LIMITS).toEqual({ legalName: 160, licenceNo: 60 })
    expect(PROVIDER_LICENCE_REFUSAL.en).toContain('provider’s')
    for (const s of Object.values(PROVIDER_LICENCE_REFUSAL)) expect(s).not.toContain("'")
  })

  it('normalize* is idempotent', () => {
    const messy = [
      VIETKITE.normalize('NFD'), '  CÔNG   TY\tTNHH\nABC  ', 'Số: Số:  0312345678', 'no. NO: 79-123/2019', 'Number : 0312345678-001',
      ' 79-123/2019/TCDL-GP LHQT ', '', 'x', 'số:', 'No.No.123',
    ]
    for (const v of messy) {
      expect(normalizeLegalName(normalizeLegalName(v)), v).toBe(normalizeLegalName(v))
      expect(normalizeLicenceNo(normalizeLicenceNo(v)), v).toBe(normalizeLicenceNo(v))
    }
    expect(normalizeLicenceNo('Số: Số:  0312345678')).toBe('0312345678')
    for (const v of [undefined, null, 42, {}, ['x']]) {
      expect(normalizeLegalName(v)).toBe('')
      expect(normalizeLicenceNo(v)).toBe('')
    }
  })

  it('providerLicenceKeysFor holds for the two aisles only', () => {
    for (const sub of AISLES) expect(providerLicenceKeysFor('services', sub)).toEqual(['providerLegalName', 'providerLicenceNo'])
    for (const s of subcategoriesFor('services')) {
      if (!(AISLES as readonly string[]).includes(s.slug)) expect(providerLicenceKeysFor('services', s.slug), s.slug).toEqual([])
    }
    expect(providerLicenceKeysFor('services', null)).toEqual([])
    for (const c of TAXONOMY.filter((x) => x.slug !== 'services')) expect(providerLicenceKeysFor(c.slug, 'visa-legal'), c.slug).toEqual([])
  })

  it('providerLicenceFromInput reads a plain object only, normalised, with absent halves as empty', () => {
    expect(providerLicenceFromInput({ providerLegalName: ` ${VIETKITE} `, providerLicenceNo: 'Số: 0312345678', condition: 'new' }))
      .toEqual({ legalName: VIETKITE, licenceNo: '0312345678' })
    expect(providerLicenceFromInput({ condition: 'new' })).toEqual({ legalName: '', licenceNo: '' })
    expect(providerLicenceFromInput({ providerLegalName: 7, providerLicenceNo: ['x'] })).toEqual({ legalName: '', licenceNo: '' })
    for (const raw of [undefined, null, '{"providerLegalName":"A"}', ['A'], 3]) expect(providerLicenceFromInput(raw)).toBeUndefined()
  })

  it('providerLicenceOf needs BOTH values, reads a stored string or an object, and normalises', () => {
    const json = JSON.stringify({ providerLegalName: VIETKITE.normalize('NFD'), providerLicenceNo: ' 79-123/2019/TCDL-GP  LHQT', condition: 'x' })
    expect(providerLicenceOf(json)).toEqual({ legalName: VIETKITE, licenceNo: '79-123/2019/TCDL-GP LHQT' })
    expect(providerLicenceOf({ providerLegalName: 'A', providerLicenceNo: '0312345678' })).toEqual({ legalName: 'A', licenceNo: '0312345678' })
    expect(providerLicenceOf(JSON.stringify({ providerLegalName: 'A' }))).toBeNull()
    expect(providerLicenceOf(JSON.stringify({ providerLicenceNo: '0312345678', providerLegalName: '  ' }))).toBeNull()
    for (const junk of [null, undefined, '', '{not json', '[1,2]', 42]) expect(providerLicenceOf(junk)).toBeNull()
  })

  it('sameProviderLicence compares normalised values; null (or nothing typed) equals null', () => {
    const a = { legalName: VIETKITE, licenceNo: '79-123/2019/TCDL-GP LHQT' }
    expect(sameProviderLicence(a, { legalName: ` ${VIETKITE.normalize('NFD')}  `, licenceNo: 'Số: 79-123/2019/TCDL-GP   LHQT' })).toBe(true)
    expect(sameProviderLicence(a, { ...a, licenceNo: '79-124/2019/TCDL-GP LHQT' })).toBe(false)
    expect(sameProviderLicence(a, { ...a, legalName: 'CÔNG TY KHÁC' })).toBe(false)
    expect(sameProviderLicence(a, null)).toBe(false)
    expect(sameProviderLicence(null, null)).toBe(true)
    expect(sameProviderLicence({ legalName: '', licenceNo: ' ' }, null)).toBe(true)
  })

  it('withProviderLicence sets both keys normalised and keeps every other key', () => {
    const out = withProviderLicence(JSON.stringify({ condition: 'new' }), { legalName: ` ${VIETKITE} `, licenceNo: 'Số: 0312345678' })
    expect(JSON.parse(out!)).toEqual({ condition: 'new', providerLegalName: VIETKITE, providerLicenceNo: '0312345678' })
    expect(JSON.parse(withProviderLicence(null, { legalName: 'A', licenceNo: '0312345678' })!)).toEqual({ providerLegalName: 'A', providerLicenceNo: '0312345678' })
    expect(JSON.parse(withProviderLicence({ x: '1' }, { legalName: 'A', licenceNo: '0312345678' })!)).toEqual({ x: '1', providerLegalName: 'A', providerLicenceNo: '0312345678' })
  })

  it('never changes an object it is handed', () => {
    const input = { x: '1', providerLegalName: 'A', providerLicenceNo: '0312345678' }
    const copy = { ...input }
    withoutProviderLicence(input)
    withProviderLicence(input, { legalName: 'B', licenceNo: '0312345679' })
    expect(input).toEqual(copy)
  })

  it('withProviderLicence / withoutProviderLicence return the SAME string when unchanged, and null when empty', () => {
    const stored = JSON.stringify({ priceBasis: 'one-time', providerLegalName: 'A', providerLicenceNo: '0312345678' })
    expect(withProviderLicence(stored, { legalName: ' A ', licenceNo: '0312345678' })).toBe(stored)
    const plain = JSON.stringify({ priceBasis: 'one-time' })
    expect(withoutProviderLicence(plain)).toBe(plain)
    expect(withProviderLicence(plain, null)).toBe(plain)
    expect(withoutProviderLicence(null)).toBeNull()
    expect(withoutProviderLicence(JSON.stringify({ providerLegalName: 'A', providerLicenceNo: '0312345678' }))).toBeNull()
    expect(JSON.parse(withoutProviderLicence(stored)!)).toEqual({ priceBasis: 'one-time' })
    // A half-empty value stores only the half that is there (the server refuses it before it gets here).
    expect(JSON.parse(withProviderLicence(plain, { legalName: 'A', licenceNo: '' })!)).toEqual({ priceBasis: 'one-time', providerLegalName: 'A' })
  })

  it('isEnterpriseCodeForm: exactly 10 digits, or 10-3 for a branch', () => {
    for (const v of ['0312345678', '0312345678-001', ' 0312345678 ']) expect(isEnterpriseCodeForm(v), v).toBe(true)
    for (const v of ['031234567', '03123456789', '0312 345 678', '0312.345.678', '0312345678-01', '0312345678/001', 'MST 0312345678', null, 312345678]) {
      expect(isEnterpriseCodeForm(v), String(v)).toBe(false)
    }
  })
})
