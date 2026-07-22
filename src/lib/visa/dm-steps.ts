// ── The 5-step "e-Visa in a DM" partition ─────────────────────────────────────────
//
// The dashboard wizard walks 3 pages (Documents / Your details / Vietnam trip) and
// routes issue codes through STEP_ISSUES in src/lib/visa/schema.ts. The chat surface
// walks FIVE conversational steps, so it needs its own map.
//
// ⚠️ WHY THIS IS A SEPARATE, UNPAIRED MODULE — do not "fix" it by editing schema.ts:
//  · STEP_ISSUES there is module-PRIVATE (not exported), and validateVisaStep is a thin
//    filter over the exported validateVisaForReview. There is nothing to extend.
//  · schema.ts is a SYNC-PAIR: src/lib/sync-pairs.test.ts couples it to
//    apps/forum/src/lib/visa/schema.ts modulo comments/import specifiers, so any edit
//    there fails the root suite until the forum copy is mirrored. The DM wizard is an
//    eno.vn-only surface (CLAUDE.md "Visa ownership"), so it must not drag the forum
//    copy along.
// This file therefore RE-PARTITIONS the same emittable code set on top of the exported
// validator. schema.ts stays byte-untouched and the 3-step wizard keeps working.
//
// ── THE ONE INVARIANT ─────────────────────────────────────────────────────────────
// The union of VISA_DM_STEP_ISSUES must equal the FULL set of codes
// validateVisaForReview can emit. A code owned by no step is a code the wizard can
// never surface: the applicant sails through all five steps and only discovers the case
// is incomplete at final submit (exactly the live bug the 3-step map's characterization
// test was written for — the singular/plural previous_visit_details_required typo).
// dm-steps.test.ts extracts the emittable set STATICALLY from schema.ts's source and
// fails the build the moment the two diverge, so adding a code to the validator without
// routing it here is not shippable.
//
// Relative specifier on purpose (the crypto.ts / schema.ts idiom): `@/…` does not
// resolve under vitest, and this module is unit-tested. Same module either way.
import { validateVisaForReview, type VisaPayload } from './schema'

export type VisaDmStep = 1 | 2 | 3 | 4 | 5
/** Same shape validateVisaForReview accepts: a bare kind, or a row with its quality verdict. */
export type VisaDmDoc = string | { kind: string; validation_status?: string }

const ALL_STEPS: readonly VisaDmStep[] = [1, 2, 3, 4, 5]

/**
 * Payload issue codes owned by each DM step. UNION MUST EQUAL the full emittable set of
 * validateVisaForReview. Step 5 is intentionally EMPTY (consent + pay only).
 *
 * The partition is FROZEN — later waves render against these numbers, and a renumber
 * would silently repoint every persisted visa_step card's `meta.step`:
 *   1 Documents        — the two uploads and their AI quality verdicts.
 *   2 Confirm passport — everything the passport extraction fills in for the applicant
 *                        (src/app/api/visa/applications/[id]/extract) plus the contact
 *                        email, i.e. the "check what we read off your passport" step.
 *   3 About you        — the remainder of the applicant's own details: the yes/no
 *                        declarations, home address, phone, emergency contact, work.
 *   4 Your trip        — the whole Vietnam-trip page: dates, gates, stay, expenses.
 *   5 Review & pay     — consent literals + the card. No payload validation of its own.
 */
export const VISA_DM_STEP_ISSUES: Record<VisaDmStep, ReadonlySet<string>> = {
  // ── 1 · Documents ── (identical to the wizard's step 0)
  1: new Set([
    'portrait_required', 'portrait_image_not_verified',
    'passport_image_required', 'passport_image_not_verified',
  ]),
  // ── 2 · Confirm passport ── the AI-FILLABLE subset of the wizard's step 1. Every code
  // here names a field the extraction route suggests from the passport image (or the
  // email we already hold), so the card can be "confirm these" rather than "type these".
  2: new Set([
    'surname_required', 'given_names_required', 'date_of_birth_required', 'sex_required',
    'nationality_required', 'place_of_birth_required',
    'passport_number_required', 'passport_authority_required',
    'passport_issue_date_required', 'passport_expiry_date_required', 'passport_dates_invalid',
    'email_required', 'email_invalid',
  ]),
  // ── 3 · About you ── the REMAINDER of the wizard's step 1: nothing here can be read
  // off a document, so it is asked, not confirmed.
  3: new Set([
    'other_nationalities_answer_required', 'other_nationalities_details_required',
    'previous_passport_answer_required', 'previous_passport_details_required',
    'law_violation_answer_required', 'law_violation_details_required',
    'other_passports_answer_required', 'other_passport_details_required',
    'permanent_address_required', 'phone_required',
    'emergency_contact_required', 'emergency_relationship_required', 'emergency_phone_required',
    'occupation_required',
  ]),
  // ── 4 · Your trip ── the wizard's step 2 in full.
  4: new Set([
    'visa_start_required', 'visa_end_required', 'visa_dates_invalid', 'visa_period_exceeds_90_days',
    'purpose_required', 'entry_date_required', 'stay_length_invalid',
    'outside_vietnam_answer_required', 'applicant_must_be_outside_vietnam',
    'vietnam_address_required', 'vietnam_province_required', 'entry_gate_required', 'exit_gate_required',
    'previous_visits_answer_required', 'previous_visit_details_required',
    'relatives_answer_required', 'relatives_details_required',
    'insurance_answer_required', 'insurance_details_required',
    'payer_name_required', 'payer_address_required', 'payer_phone_required',
    'local_contact_name_required', 'local_contact_address_required', 'local_contact_phone_required',
    'children_on_passport_answer_required', 'children_details_required',
  ]),
  // ── 5 · Review & pay ── deliberately empty: this step gates on the consent literals
  // and the payment capture, both of which live outside the payload validator.
  5: new Set<string>(),
}

/**
 * Payload FIELD NAMES each step is responsible for. Every entry MUST be a key of
 * visaPayloadSchema.shape — enforced by dm-steps.test.ts, which also proves the steps
 * are disjoint and that the only unrouted keys are the four system/admin-owned ones
 * (schemaVersion, adminMessage, governmentRegistrationCode, governmentApplicationStatus).
 *
 * This is the allowlist a DM step form renders and the vocabulary a `needsReview` array
 * draws from — never values, only names (see the metaJson contract in src/lib/messages.ts).
 *
 * ⚠️ A STEP RENDERS ALL OF ITS FIELDS, NOT JUST THE OUTSTANDING ONES (2026-07-22, when the
 * dashboard wizard became the chat's only alternative and then stopped being one). A field
 * carrying a schema DEFAULT — religion, passportType, every yes/no declaration, purposeOfEntry,
 * entryGate/exitGate, stayLengthDays, the expense fields — never produces a validation issue,
 * so an issue-driven card never asked it and the applicant shipped the default as if it were
 * their answer. VISA_STEP_FORM in src/components/marketplace/visa-cards.tsx renders each of
 * these lists in full, pre-filled; visa-cards.test.ts fails the build if a name here is not
 * reachable in the chat. Adding a field to a step is therefore a promise to ASK for it.
 * (The single exemption is step 1's aiDocumentProcessingConsent, which is not a question: the
 * upload route stamps it when the applicant sends the photo this step exists to collect.)
 *
 * Visible ≠ required: completeness is still validateVisaForReview's alone, so a defaulted
 * field is shown and editable but never blocks the step (the owner's launch-lenience policy).
 */
export const VISA_DM_STEP_FIELDS: Record<VisaDmStep, readonly string[]> = {
  // The uploads themselves live in visa_documents; the one payload field this step owns
  // is the AI-processing consent the extraction route stamps when it reads the passport.
  1: ['aiDocumentProcessingConsent'],
  // Exactly the keys src/app/api/visa/applications/[id]/extract can suggest, plus email.
  2: [
    'surname', 'givenNames', 'dateOfBirth', 'sex', 'nationality', 'identityNumber', 'placeOfBirth',
    'passportNumber', 'passportType', 'passportIssuingAuthority', 'passportIssueDate', 'passportExpiryDate',
    'email',
  ],
  3: [
    'religion',
    'hasOtherNationalities', 'otherNationalities',
    'hasVietnamLawViolation', 'vietnamLawViolationDetails',
    'usedOtherPassportsForVietnam', 'usedOtherPassportDetails',
    'hasOtherPassports', 'otherPassportDetails',
    'permanentAddress', 'phone',
    'emergencyName', 'emergencyRelationship', 'emergencyAddress', 'emergencyPhone',
    'occupation', 'employerName', 'employerAddress', 'employerPhone',
  ],
  4: [
    'entryType', 'visaValidFrom', 'visaValidTo',
    'purposeOfEntry', 'currentlyOutsideVietnam', 'intendedEntryDate', 'stayLengthDays',
    'temporaryAddress', 'temporaryProvince', 'temporaryWard', 'entryGate', 'exitGate',
    'localContactName', 'localContactAddress', 'localContactPhone',
    'visitedVietnamLastYear', 'previousVisitDetails',
    'hasRelativesInVietnam', 'relativesInVietnamDetails',
    'hasChildrenOnPassport', 'childrenOnPassportDetails',
    'estimatedExpenses', 'expensesCurrency', 'expensesPayer', 'paymentMethod',
    'payerName', 'payerAddress', 'payerPhone', 'payerDetails',
    'hasTravelInsurance', 'insuranceDetails',
    'applicantNotes',
  ],
  5: [],
}

/**
 * The outstanding issues THIS step owns. A thin filter over the exported
 * validateVisaForReview — exactly the shape of schema.ts's own validateVisaStep, so the
 * two step models can never disagree about whether a given code is satisfied.
 */
export function validateVisaDmStep(payload: VisaPayload, documents: VisaDmDoc[], step: VisaDmStep): string[] {
  const owned = VISA_DM_STEP_ISSUES[step]
  if (!owned || owned.size === 0) return []
  return validateVisaForReview(payload, documents).filter((issue) => owned.has(issue))
}

/**
 * Lowest step with outstanding issues; null = all five satisfied.
 * One validator pass for all five steps (the DM emits a card per turn, so this runs on
 * every applicant reply).
 */
export function firstIncompleteVisaDmStep(payload: VisaPayload, documents: VisaDmDoc[]): VisaDmStep | null {
  const issues = validateVisaForReview(payload, documents)
  if (issues.length === 0) return null
  for (const step of ALL_STEPS) {
    const owned = VISA_DM_STEP_ISSUES[step]
    if (issues.some((issue) => owned.has(issue))) return step
  }
  // Unreachable while the totality test holds (an emittable code owned by no step fails
  // the build). Belt-and-braces it FAILS CLOSED anyway: parking the applicant on the last
  // form step is recoverable; reporting "complete" would let them pay for a case that
  // can never submit.
  console.error('[visa-dm] unrouted validation issues', issues)
  return 4
}

// Bilingual composites, the price-drop.ts / messages.ts idiom: this string PERSISTS into
// the plaintext Conversation.lastMessageText that BOTH inboxes read, where tr() cannot
// run at render time. ⚠️ Constant literals only — nothing is interpolated, so no
// applicant datum can ever reach the unencrypted column through this path.
const VISA_DM_STEP_PREVIEW: Record<VisaDmStep, string> = {
  1: 'Bước 1/5: Giấy tờ · Step 1 of 5: Documents',
  2: 'Bước 2/5: Xác nhận hộ chiếu · Step 2 of 5: Confirm passport',
  3: 'Bước 3/5: Thông tin của bạn · Step 3 of 5: About you',
  4: 'Bước 4/5: Chuyến đi của bạn · Step 4 of 5: Your trip',
  5: 'Bước 5/5: Kiểm tra và thanh toán · Step 5 of 5: Review & pay',
}

/** Bilingual, PII-FREE inbox line for Conversation.lastMessageText. Never interpolates applicant data. */
export function visaDmStepPreview(step: VisaDmStep): string {
  return VISA_DM_STEP_PREVIEW[step] ?? VISA_DM_STEP_PREVIEW[1]
}
