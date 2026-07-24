// GENERATED FROM src/lib/visa/schema.ts — do not edit. Regenerate: node scripts/sync-visa-pairs.mjs --write
// This file is that root file VERBATIM: nothing is stripped, reordered or reworded, and
// only relative visa import specifiers ('./x') become the forum alias ('@/lib/visa/x').
// Every comment below is therefore written from the ROOT's perspective — its paths,
// tooling notes and TODOs describe src/ on eno.vn, not apps/forum/. Read them against
// the root file; correct an inaccurate one THERE and re-run --write.
// Ported VERBATIM from apps/forum/src/lib/visa/schema.ts (2026-07-18 in-hub port).
// ⚠️ INTEROP: both apps validate the same encrypted rows — keep the payload schema,
// versions, and validation codes in lockstep with the forum copy.
import { z } from 'zod'
// Relative for vitest resolvability (see crypto.ts) — same module either way.
import { DEFAULT_EVISA_ENTRY_GATE } from '@/lib/visa/checkpoints'

export const VISA_PAYLOAD_VERSION = '2026-07-16'
export const VISA_DECLARATION_VERSION = 'evisa-applicant-declaration-2026-07-24'
export const VISA_AUTHORIZATION_VERSION = 'eno-hosted-prefill-authorization-2026-07-24'
export const MAX_EVISA_VALIDITY_DAYS = 90

export function visaEndDateFor90DayWindow(startDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return ''
  const start = new Date(`${startDate}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) return ''
  start.setUTCDate(start.getUTCDate() + MAX_EVISA_VALIDITY_DAYS - 1)
  return start.toISOString().slice(0, 10)
}

export function visaDateDefaultsForStart(startDate: string) {
  return {
    visaValidFrom: startDate,
    visaValidTo: visaEndDateFor90DayWindow(startDate),
    intendedEntryDate: startDate,
    stayLengthDays: MAX_EVISA_VALIDITY_DAYS,
  }
}

const short = z.string().trim().max(160)
const long = z.string().trim().max(1200)
const date = z.string().trim().regex(/^$|^\d{4}-\d{2}-\d{2}$/)
const religion = z.string().trim().max(160).transform((value) => value || 'None').default('None')
const commonNo = z.enum(['', 'yes', 'no']).transform((value): '' | 'yes' | 'no' => value === 'yes' ? 'yes' : 'no').default('no')
const eligibleOutsideVietnam = z.enum(['', 'yes', 'no']).transform((value): '' | 'yes' | 'no' => value === 'no' ? 'no' : 'yes').default('yes')

export const visaPayloadSchema = z.object({
  schemaVersion: z.literal(VISA_PAYLOAD_VERSION).default(VISA_PAYLOAD_VERSION),
  aiDocumentProcessingConsent: z.boolean().default(false),
  surname: short.default(''), givenNames: short.default(''), dateOfBirth: date.default(''),
  sex: z.enum(['', 'male', 'female']).default(''), nationality: short.default(''),
  identityNumber: short.default(''), email: z.string().trim().max(254).default(''),
  religion, placeOfBirth: short.default(''),
  usedOtherPassportsForVietnam: commonNo, usedOtherPassportDetails: long.default(''),
  hasOtherNationalities: commonNo, otherNationalities: short.default(''),
  hasVietnamLawViolation: commonNo, vietnamLawViolationDetails: long.default(''),
  passportNumber: short.default(''), passportType: z.enum(['ordinary', 'official', 'diplomatic', 'other']).default('ordinary'),
  passportIssuingAuthority: short.default(''), passportIssueDate: date.default(''), passportExpiryDate: date.default(''),
  hasOtherPassports: commonNo, otherPassportDetails: long.default(''),
  entryType: z.enum(['single', 'multiple']).default('single'), visaValidFrom: date.default(''), visaValidTo: date.default(''),
  permanentAddress: long.default(''), phone: short.default(''), emergencyName: short.default(''),
  emergencyRelationship: short.default(''), emergencyAddress: long.default(''), emergencyPhone: short.default(''),
  occupation: short.default(''), employerName: short.default(''), employerAddress: long.default(''), employerPhone: short.default(''),
  purposeOfEntry: short.default('Tourism'), intendedEntryDate: date.default(''), stayLengthDays: z.number().int().min(0).max(90).default(90),
  currentlyOutsideVietnam: eligibleOutsideVietnam,
  temporaryAddress: long.default(''), temporaryProvince: short.default(''), temporaryWard: short.default(''),
  entryGate: short.default(DEFAULT_EVISA_ENTRY_GATE), exitGate: short.default(DEFAULT_EVISA_ENTRY_GATE),
  localContactName: short.default(''), localContactAddress: long.default(''), localContactPhone: short.default(''),
  visitedVietnamLastYear: commonNo, previousVisitDetails: long.default(''),
  hasRelativesInVietnam: commonNo, relativesInVietnamDetails: long.default(''),
  estimatedExpenses: z.number().min(0).max(1_000_000_000).default(1000), expensesCurrency: z.string().trim().max(3).default('USD'),
  expensesPayer: z.enum(['self', 'organization', 'other']).default('self'), paymentMethod: z.enum(['cash', 'credit_card', 'travellers_cheques']).default('credit_card'),
  payerName: short.default(''), payerAddress: long.default(''), payerPhone: short.default(''), payerDetails: long.default(''),
  hasTravelInsurance: commonNo, insuranceDetails: long.default(''),
  hasChildrenOnPassport: commonNo, childrenOnPassportDetails: long.default(''),
  applicantNotes: long.default(''), adminMessage: long.default(''),
  governmentRegistrationCode: short.default(''), governmentApplicationStatus: short.default(''),
})

export type VisaPayload = z.infer<typeof visaPayloadSchema>
export const emptyVisaPayload = (email = '') => visaPayloadSchema.parse({ email })

const required: Array<[keyof VisaPayload, string]> = [
  ['surname', 'surname_required'], ['givenNames', 'given_names_required'], ['dateOfBirth', 'date_of_birth_required'],
  ['sex', 'sex_required'], ['nationality', 'nationality_required'], ['email', 'email_required'], ['placeOfBirth', 'place_of_birth_required'],
  ['usedOtherPassportsForVietnam', 'previous_passport_answer_required'],
  ['hasOtherNationalities', 'other_nationalities_answer_required'], ['hasVietnamLawViolation', 'law_violation_answer_required'],
  ['passportNumber', 'passport_number_required'], ['passportIssuingAuthority', 'passport_authority_required'],
  ['passportIssueDate', 'passport_issue_date_required'], ['passportExpiryDate', 'passport_expiry_date_required'],
  ['hasOtherPassports', 'other_passports_answer_required'],
  ['visaValidFrom', 'visa_start_required'], ['visaValidTo', 'visa_end_required'], ['permanentAddress', 'permanent_address_required'],
  ['phone', 'phone_required'], ['emergencyName', 'emergency_contact_required'], ['emergencyRelationship', 'emergency_relationship_required'],
  ['emergencyPhone', 'emergency_phone_required'], ['occupation', 'occupation_required'], ['purposeOfEntry', 'purpose_required'],
  ['intendedEntryDate', 'entry_date_required'], ['temporaryAddress', 'vietnam_address_required'],
  ['currentlyOutsideVietnam', 'outside_vietnam_answer_required'],
  ['temporaryProvince', 'vietnam_province_required'], ['entryGate', 'entry_gate_required'], ['exitGate', 'exit_gate_required'],
  ['visitedVietnamLastYear', 'previous_visits_answer_required'], ['hasRelativesInVietnam', 'relatives_answer_required'],
  ['hasTravelInsurance', 'insurance_answer_required'],
  ['hasChildrenOnPassport', 'children_on_passport_answer_required'],
]

export function validateVisaForReview(payload: VisaPayload, documents: Array<string | { kind: string; validation_status?: string }>): string[] {
  const normalizedDocuments = documents.map((document) => typeof document === 'string' ? { kind: document, validation_status: 'passed' } : document)
  const issues = required.flatMap(([key, code]) => payload[key] ? [] : [code])
  if (!z.string().email().safeParse(payload.email).success) issues.push('email_invalid')
  if (payload.stayLengthDays < 1 || payload.stayLengthDays > 90) issues.push('stay_length_invalid')
  if (payload.visaValidFrom && payload.visaValidTo && payload.visaValidFrom > payload.visaValidTo) issues.push('visa_dates_invalid')
  if (payload.passportIssueDate && payload.passportExpiryDate && payload.passportIssueDate >= payload.passportExpiryDate) issues.push('passport_dates_invalid')
  if (payload.hasOtherPassports === 'yes' && !payload.otherPassportDetails) issues.push('other_passport_details_required')
  if (payload.usedOtherPassportsForVietnam === 'yes' && !payload.usedOtherPassportDetails) issues.push('previous_passport_details_required')
  if (payload.hasOtherNationalities === 'yes' && !payload.otherNationalities) issues.push('other_nationalities_details_required')
  if (payload.hasVietnamLawViolation === 'yes' && !payload.vietnamLawViolationDetails) issues.push('law_violation_details_required')
  if (payload.visitedVietnamLastYear === 'yes' && !payload.previousVisitDetails) issues.push('previous_visit_details_required')
  if (payload.hasRelativesInVietnam === 'yes' && !payload.relativesInVietnamDetails) issues.push('relatives_details_required')
  if (payload.hasTravelInsurance === 'yes' && !payload.insuranceDetails) issues.push('insurance_details_required')
  if (payload.expensesPayer !== 'self') {
    if (!payload.payerName) issues.push('payer_name_required')
    if (!payload.payerAddress) issues.push('payer_address_required')
    if (!payload.payerPhone) issues.push('payer_phone_required')
  }
  if (payload.localContactName || payload.localContactAddress || payload.localContactPhone) {
    if (!payload.localContactName) issues.push('local_contact_name_required')
    if (!payload.localContactAddress) issues.push('local_contact_address_required')
    if (!payload.localContactPhone) issues.push('local_contact_phone_required')
  }
  if (payload.hasChildrenOnPassport === 'yes' && !payload.childrenOnPassportDetails) issues.push('children_details_required')
  if (payload.currentlyOutsideVietnam === 'no') issues.push('applicant_must_be_outside_vietnam')
  if (payload.visaValidFrom && payload.visaValidTo) {
    const days = Math.floor((new Date(`${payload.visaValidTo}T00:00:00Z`).getTime() - new Date(`${payload.visaValidFrom}T00:00:00Z`).getTime()) / 86400_000) + 1
    if (days > MAX_EVISA_VALIDITY_DAYS) issues.push('visa_period_exceeds_90_days')
  }
  for (const [kind, missingCode, qualityCode] of [
    ['portrait', 'portrait_required', 'portrait_image_not_verified'],
    ['passport', 'passport_image_required', 'passport_image_not_verified'],
  ] as const) {
    const document = normalizedDocuments.find((item) => item.kind === kind)
    if (!document) issues.push(missingCode)
    else if (document.validation_status !== 'passed') issues.push(qualityCode)
  }
  return [...new Set(issues)]
}

const STEP_ISSUES: Record<0 | 1 | 2, Set<string>> = {
  0: new Set(['portrait_required', 'portrait_image_not_verified', 'passport_image_required', 'passport_image_not_verified']),
  1: new Set([
    'surname_required', 'given_names_required', 'date_of_birth_required', 'sex_required', 'nationality_required',
    'email_required', 'email_invalid', 'place_of_birth_required', 'other_nationalities_answer_required',
    'previous_passport_answer_required', 'previous_passport_details_required',
    'other_nationalities_details_required', 'law_violation_answer_required', 'law_violation_details_required',
    'passport_number_required', 'passport_authority_required', 'passport_issue_date_required', 'passport_expiry_date_required',
    'passport_dates_invalid', 'other_passports_answer_required', 'other_passport_details_required', 'permanent_address_required',
    'phone_required', 'emergency_contact_required', 'emergency_relationship_required', 'emergency_phone_required', 'occupation_required',
  ]),
  2: new Set([
    'visa_start_required', 'visa_end_required', 'visa_dates_invalid', 'visa_period_exceeds_90_days', 'purpose_required',
    'entry_date_required', 'stay_length_invalid', 'outside_vietnam_answer_required', 'applicant_must_be_outside_vietnam',
    'vietnam_address_required', 'vietnam_province_required', 'entry_gate_required', 'exit_gate_required',
    'previous_visits_answer_required', 'previous_visit_details_required', 'relatives_answer_required',
    'relatives_details_required', 'insurance_answer_required', 'insurance_details_required',
    'payer_name_required', 'payer_address_required', 'payer_phone_required',
    'local_contact_name_required', 'local_contact_address_required', 'local_contact_phone_required',
    'children_on_passport_answer_required', 'children_details_required',
  ]),
}

export function validateVisaStep(payload: VisaPayload, documents: Array<string | { kind: string; validation_status?: string }>, step: 0 | 1 | 2) {
  return validateVisaForReview(payload, documents).filter((issue) => STEP_ISSUES[step].has(issue))
}

export const visaStatuses = ['draft', 'ready_for_review', 'under_review', 'needs_changes', 'applicant_approval', 'ready_to_submit', 'submitted', 'payment_required', 'processing', 'approved', 'rejected', 'cancelled'] as const
