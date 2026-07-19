export type PassportMrzResult = {
  valid: boolean
  checks: { passportNumber: boolean; dateOfBirth: boolean; expiryDate: boolean; optionalData: boolean; composite: boolean }
  fields: Partial<{
    surname: string
    givenNames: string
    passportNumber: string
    nationalityCode: string
    dateOfBirth: string
    sex: 'male' | 'female'
    passportExpiryDate: string
  }>
}

const WEIGHTS = [7, 3, 1]

function characterValue(character: string) {
  if (/\d/.test(character)) return Number(character)
  if (/[A-Z]/.test(character)) return character.charCodeAt(0) - 55
  return 0
}

function checkDigit(value: string, expected: string, allowFillerDigit = false) {
  // ICAO 9303 permits '<' as the check digit for an all-filler optional-data field,
  // where it is equivalent to '0'. Only that field opts in via allowFillerDigit.
  const digit = allowFillerDigit && expected === '<' ? '0' : expected
  if (!/^\d$/.test(digit)) return false
  const total = [...value].reduce((sum, character, index) => sum + characterValue(character) * WEIGHTS[index % WEIGHTS.length], 0)
  return String(total % 10) === digit
}

function cleanLine(value: string) {
  return value.toUpperCase().replace(/\s/g, '').replace(/[^A-Z0-9<]/g, '')
}

function mrzDate(value: string, type: 'birth' | 'expiry') {
  if (!/^\d{6}$/.test(value)) return undefined
  const yy = Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  const currentYear = new Date().getUTCFullYear()
  const candidates = [1900 + yy, 2000 + yy, 2100 + yy]
  const year = type === 'birth'
    ? candidates.filter((candidate) => candidate <= currentYear).sort((a, b) => b - a).find((candidate) => currentYear - candidate <= 120)
    : candidates.sort((a, b) => Math.abs(a - currentYear) - Math.abs(b - currentYear))[0]
  if (!year) return undefined
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function mrzName(value: string) {
  return value.replace(/<+/g, ' ').trim().replace(/\s+/g, ' ')
}

export function parsePassportMrz(rawLine1: string, rawLine2: string): PassportMrzResult {
  const line1 = cleanLine(rawLine1)
  const line2 = cleanLine(rawLine2)
  const empty: PassportMrzResult = {
    valid: false,
    checks: { passportNumber: false, dateOfBirth: false, expiryDate: false, optionalData: false, composite: false },
    fields: {},
  }
  if (line1.length !== 44 || line2.length !== 44 || !line1.startsWith('P')) return empty

  const checks = {
    passportNumber: checkDigit(line2.slice(0, 9), line2[9]),
    dateOfBirth: checkDigit(line2.slice(13, 19), line2[19]),
    expiryDate: checkDigit(line2.slice(21, 27), line2[27]),
    optionalData: checkDigit(line2.slice(28, 42), line2[42], true),
    composite: checkDigit(`${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`, line2[43]),
  }
  const nameParts = line1.slice(5).split('<<')
  const dateOfBirth = checks.dateOfBirth ? mrzDate(line2.slice(13, 19), 'birth') : undefined
  const passportExpiryDate = checks.expiryDate ? mrzDate(line2.slice(21, 27), 'expiry') : undefined
  const sex = line2[20] === 'M' ? 'male' : line2[20] === 'F' ? 'female' : undefined
  const fields: PassportMrzResult['fields'] = {
    ...(checks.passportNumber ? { passportNumber: line2.slice(0, 9).replace(/<+$/g, '') } : {}),
    ...(checks.dateOfBirth && dateOfBirth ? { dateOfBirth } : {}),
    ...(checks.expiryDate && passportExpiryDate ? { passportExpiryDate } : {}),
    ...(sex ? { sex } : {}),
    ...(line2.slice(10, 13).replace(/</g, '') ? { nationalityCode: line2.slice(10, 13).replace(/</g, '') } : {}),
  }
  if (checks.composite || [checks.passportNumber, checks.dateOfBirth, checks.expiryDate].filter(Boolean).length === 3) {
    const surname = mrzName(nameParts[0] || '')
    const givenNames = mrzName(nameParts.slice(1).join(' '))
    if (surname) fields.surname = surname
    if (givenNames) fields.givenNames = givenNames
  }
  return { valid: checks.passportNumber && checks.dateOfBirth && checks.expiryDate && checks.composite, checks, fields }
}
