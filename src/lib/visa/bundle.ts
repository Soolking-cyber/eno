import 'server-only'
import { strToU8, zipSync, type Zippable } from 'fflate'
// Relative specifiers (the crypto.ts / dm-steps.ts idiom): this module is unit-tested and
// the alias adds nothing here. Same module either way.
import { visaPayloadSchema, type VisaPayload } from './schema'
import { parseVisaEntryType, parseVisaSpeedCode, VISA_SPEED_SPECS } from './speed'

// ── THE HANDOVER PACK ─────────────────────────────────────────────────────────────
//
// One application → one folder a human agent can file from. The owner's words:
// "admin should receive as full info ready to download as folder inside 2 images and an
// excel file with information about applicant. we will send it further to agents to apply
// for us." So the pack is deliberately DUMB: no links, no logins, no lookups. Everything
// the agent needs to retype into the government e-Visa portal is inside one zip.
//
// ⚠️ THIS IS THE MOST CONCENTRATED PII ARTEFACT THE APP PRODUCES — a decrypted dossier
// plus two identity photos. The rules that follow from that live where they can be
// enforced:
//   · the ADMIN gate, the audit event and the no-store headers are the route's
//     (src/app/api/visa/admin/applications/[id]/bundle/route.ts);
//   · this module is PURE — bytes in, bytes out, no I/O, no disk, no logging, no
//     `console.*` anywhere. It cannot leak what it never reaches for.
// Keeping the two apart is what makes the pack unit-testable without a database and what
// makes "nothing is ever written to disk" a property of the code rather than a promise.
//
// ⚠️ NO APPLICANT VALUE MAY REACH A FILENAME. The zip and its folder are named from the
// case reference (the first 8 hex of the application uuid — the same string the admin case
// page prints) and the generation date. That is enough for a desk juggling several cases
// and it puts neither a passport number nor a name into a download history, an email
// subject, or a screen-share.
//
// ── WHY THESE TWO LIBRARIES ───────────────────────────────────────────────────────
// ZIP: `fflate` (MIT, ZERO dependencies, pure JS — no native build, so it needs no
// next.config.ts serverExternalPackages entry). It is the smallest maintained zip
// implementation with a SYNCHRONOUS API, which matters because the pack is assembled in
// memory and handed straight to the response. The obvious alternative, `archiver`, is a
// stream pipeline with ~15 transitive dependencies for something we do not need to stream.
//
// XLSX: NO LIBRARY, deliberately. An .xlsx IS a zip of a handful of XML parts, so with
// fflate already present the whole writer is the ~120 lines below. The npm alternatives
// were each disqualified on the security/size axis this feature cares about most:
//   · `xlsx` (SheetJS) — the npm registry copy is frozen at 0.18.5 and carries two known
//     advisories (prototype pollution, ReDoS); current releases are published off-registry
//     only, which is not a supply chain to put a passport dossier through.
//   · `exceljs` — MIT but 9 direct dependencies (archiver, unzipper, jszip, fast-csv…) to
//     write ONE two-column sheet, and it pulls in a zip reader we have no use for.
// The cost of hand-writing the part is that the OOXML must be right; bundle.test.ts
// therefore asserts the package structure (parts, rels, content types) and not just the
// values. The sheet uses INLINE STRINGS (`t="inlineStr"`), which also means every cell is
// typed as text: a value beginning with `=` is data, never a formula, so the spreadsheet
// cannot be an injection vector into whatever the agent opens it with.

/** What the route managed to fetch for one visa_documents row. */
export type VisaBundleDocument = {
  kind: string
  /** Decoded file bytes, or null when storage could not produce them. */
  bytes: Uint8Array | null
  mimeType: string
}

/** The picked product, as recorded by the chat's `dm_product_selected` event. */
export type VisaBundleProduct = { entryType?: unknown; speed?: unknown } | null

export type VisaBundleCase = {
  applicationId: string
  status: string
  payload: VisaPayload
  documents: VisaBundleDocument[]
  product: VisaBundleProduct
  createdAt?: string | null
  submittedAt?: string | null
  paidAt?: string | null
  paymentProvider?: string | null
  /** Injected, never `new Date()` inside — the pack must be reproducible in a test. */
  generatedAt: Date
}

export type VisaBundle = {
  /** ASCII-safe by construction — no quoting needed in Content-Disposition. */
  filename: string
  /** ⚠️ Explicitly ArrayBuffer-backed: a plain `Uint8Array` widens to ArrayBufferLike,
   *  which is NOT assignable to BodyInit, and the route hands these bytes to a Response. */
  bytes: Uint8Array<ArrayBuffer>
  /** Every path inside the archive, in order. */
  entries: string[]
  /** Document kinds the pack could NOT include, and why. Never throws instead. */
  missing: Array<{ kind: string; reason: 'not_uploaded' | 'unavailable' }>
}

/** The two identity photos the government form needs, in the order the pack lists them. */
const PACK_IMAGE_KINDS = ['passport', 'portrait'] as const
type PackImageKind = (typeof PACK_IMAGE_KINDS)[number]

const IMAGE_TITLE: Record<PackImageKind, string> = {
  passport: 'Passport data page',
  portrait: 'Portrait photo',
}

// ── Formatting helpers ────────────────────────────────────────────────────────────
//
// ⚠️ TIME ZONE, the speed.ts rule: the desk and the agents are in Vietnam, the server runs
// in UTC and a laptop is in whatever zone it is in. Every timestamp in the pack is
// formatted through Intl with an EXPLICIT timeZone — there is no offset arithmetic here
// and there must never be one.
const HCM = 'Asia/Ho_Chi_Minh'
const EMPTY = '—'

function stamp(value: string | null | undefined): string {
  if (!value) return EMPTY
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return EMPTY
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: HCM, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at).replace(',', '')
}

/** YYYY-MM-DD of the Vietnam calendar day — the only date that goes in a filename. */
function packDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: HCM, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : '0000-00-00'
}

/** The case reference the admin page already prints: first 8 hex of the uuid. */
export function visaCaseRef(applicationId: string): string {
  const hex = applicationId.toLowerCase().replace(/[^0-9a-f]/g, '')
  return (hex.slice(0, 8) || 'unknown').padEnd(8, '0')
}

const sentence = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)
const humanize = (value: string) => sentence(value.replaceAll('_', ' '))

const YES_NO: Record<string, string> = { yes: 'Yes', no: 'No' }
const SEX: Record<string, string> = { male: 'Male', female: 'Female' }
const PASSPORT_TYPE: Record<string, string> = { ordinary: 'Ordinary', official: 'Official', diplomatic: 'Diplomatic', other: 'Other' }
const ENTRY_TYPE: Record<string, string> = { single: 'Single entry', multiple: 'Multiple entry' }
const PAYER: Record<string, string> = { self: 'The applicant', organization: 'An organization', other: 'Someone else' }
const PAYMENT_METHOD: Record<string, string> = { cash: 'Cash', credit_card: 'Credit card', travellers_cheques: "Traveller's cheques" }
const OUTSIDE: Record<string, string> = { yes: 'Yes — outside Vietnam', no: 'No — already in Vietnam' }

/** Enum → the words a human keys from. Anything unmapped is passed through verbatim. */
const VALUE_WORDS: Partial<Record<keyof VisaPayload, Record<string, string>>> = {
  sex: SEX, passportType: PASSPORT_TYPE, entryType: ENTRY_TYPE,
  expensesPayer: PAYER, paymentMethod: PAYMENT_METHOD, currentlyOutsideVietnam: OUTSIDE,
  usedOtherPassportsForVietnam: YES_NO, hasOtherNationalities: YES_NO, hasVietnamLawViolation: YES_NO,
  hasOtherPassports: YES_NO, visitedVietnamLastYear: YES_NO, hasRelativesInVietnam: YES_NO,
  hasTravelInsurance: YES_NO, hasChildrenOnPassport: YES_NO,
}

// ── The sheet ─────────────────────────────────────────────────────────────────────
//
// ⚠️ EVERY PAYLOAD KEY MUST APPEAR HERE, and bundle.test.ts fails the build when one does
// not (set equality against visaPayloadSchema.shape, the dm-steps.ts totality idiom). A
// field the chat now asks for but the sheet silently drops is an answer the applicant gave
// and the agent never sees — the exact failure this whole pass exists to prevent.
//
// Order and wording are the product here. The sections follow the government e-Visa form's
// own running order so an agent can key straight down the page, and the labels say what
// the form calls the field, not what the database calls it.
type FieldSpec = { key: keyof VisaPayload; label: string }
type Section = { title: string; fields: FieldSpec[] }

export const VISA_SHEET_SECTIONS: readonly Section[] = [
  {
    title: 'Applicant',
    fields: [
      { key: 'surname', label: 'Surname (exactly as in the passport)' },
      { key: 'givenNames', label: 'Given names (exactly as in the passport)' },
      { key: 'dateOfBirth', label: 'Date of birth (YYYY-MM-DD)' },
      { key: 'sex', label: 'Sex' },
      { key: 'nationality', label: 'Current nationality' },
      { key: 'placeOfBirth', label: 'Place of birth' },
      { key: 'religion', label: 'Religion' },
      { key: 'identityNumber', label: 'National ID number (if any)' },
      { key: 'email', label: 'Email address' },
    ],
  },
  {
    title: 'Passport',
    fields: [
      { key: 'passportNumber', label: 'Passport number' },
      { key: 'passportType', label: 'Passport type' },
      { key: 'passportIssuingAuthority', label: 'Issuing authority / place of issue' },
      { key: 'passportIssueDate', label: 'Date of issue (YYYY-MM-DD)' },
      { key: 'passportExpiryDate', label: 'Date of expiry (YYYY-MM-DD)' },
    ],
  },
  {
    title: 'Declarations',
    fields: [
      { key: 'hasOtherPassports', label: 'Holds other valid passports?' },
      { key: 'otherPassportDetails', label: 'Other valid passports — details' },
      { key: 'usedOtherPassportsForVietnam', label: 'Used another passport to enter Vietnam before?' },
      { key: 'usedOtherPassportDetails', label: 'Previous passport used for Vietnam — details' },
      { key: 'hasOtherNationalities', label: 'Holds other nationalities?' },
      { key: 'otherNationalities', label: 'Other nationalities — details' },
      { key: 'hasVietnamLawViolation', label: 'Has violated Vietnamese law before?' },
      { key: 'vietnamLawViolationDetails', label: 'Law violation — details' },
    ],
  },
  {
    title: 'Contact and home address',
    fields: [
      { key: 'permanentAddress', label: 'Permanent residential address' },
      { key: 'phone', label: 'Telephone number' },
      { key: 'emergencyName', label: 'Emergency contact — full name' },
      { key: 'emergencyRelationship', label: 'Emergency contact — relationship' },
      { key: 'emergencyAddress', label: 'Emergency contact — address' },
      { key: 'emergencyPhone', label: 'Emergency contact — telephone' },
    ],
  },
  {
    title: 'Employment',
    fields: [
      { key: 'occupation', label: 'Occupation' },
      { key: 'employerName', label: 'Employer / company name' },
      { key: 'employerAddress', label: 'Employer address' },
      { key: 'employerPhone', label: 'Employer telephone' },
    ],
  },
  {
    title: 'Visa requested',
    fields: [
      { key: 'entryType', label: 'Entry type' },
      { key: 'visaValidFrom', label: 'Visa valid from (YYYY-MM-DD)' },
      { key: 'visaValidTo', label: 'Visa valid to (YYYY-MM-DD)' },
      { key: 'purposeOfEntry', label: 'Purpose of entry' },
      { key: 'intendedEntryDate', label: 'Intended date of entry (YYYY-MM-DD)' },
      { key: 'stayLengthDays', label: 'Intended length of stay (days)' },
      { key: 'currentlyOutsideVietnam', label: 'Applicant is outside Vietnam' },
      { key: 'entryGate', label: 'Intended entry checkpoint' },
      { key: 'exitGate', label: 'Intended exit checkpoint' },
    ],
  },
  {
    title: 'Stay in Vietnam',
    fields: [
      { key: 'temporaryAddress', label: 'Address in Vietnam' },
      { key: 'temporaryProvince', label: 'Province / city' },
      { key: 'temporaryWard', label: 'Ward / commune' },
      { key: 'localContactName', label: 'Contact in Vietnam — full name' },
      { key: 'localContactAddress', label: 'Contact in Vietnam — address' },
      { key: 'localContactPhone', label: 'Contact in Vietnam — telephone' },
    ],
  },
  {
    title: 'Previous visits, relatives and children',
    fields: [
      { key: 'visitedVietnamLastYear', label: 'Visited Vietnam in the last 12 months?' },
      { key: 'previousVisitDetails', label: 'Previous visits — details' },
      { key: 'hasRelativesInVietnam', label: 'Has relatives in Vietnam?' },
      { key: 'relativesInVietnamDetails', label: 'Relatives in Vietnam — details' },
      { key: 'hasChildrenOnPassport', label: 'Children travelling on this passport?' },
      { key: 'childrenOnPassportDetails', label: 'Children on this passport — details' },
    ],
  },
  {
    title: 'Trip expenses and insurance',
    fields: [
      { key: 'estimatedExpenses', label: 'Estimated expenses for the trip' },
      { key: 'expensesCurrency', label: 'Expenses currency' },
      { key: 'expensesPayer', label: 'Who covers the expenses' },
      { key: 'paymentMethod', label: 'Method of payment' },
      { key: 'payerName', label: 'Payer — full name' },
      { key: 'payerAddress', label: 'Payer — address' },
      { key: 'payerPhone', label: 'Payer — telephone' },
      { key: 'payerDetails', label: 'Payer — other details' },
      { key: 'hasTravelInsurance', label: 'Has travel insurance?' },
      { key: 'insuranceDetails', label: 'Travel insurance — details' },
    ],
  },
  {
    // Last on purpose: everything below is context for the desk and the agent, not a box
    // on the government form.
    title: 'Notes and case record',
    fields: [
      { key: 'applicantNotes', label: 'Notes from the applicant' },
      { key: 'adminMessage', label: 'Note from the eno desk' },
      { key: 'governmentRegistrationCode', label: 'Government registration code (once filed)' },
      { key: 'governmentApplicationStatus', label: 'Government application status' },
      { key: 'aiDocumentProcessingConsent', label: 'Applicant consented to automated passport reading' },
      { key: 'schemaVersion', label: 'Answer format version' },
    ],
  },
]

/** Rendered rows: a section heading, or one labelled answer. */
export type VisaSheetRow =
  | { kind: 'title'; label: string }
  | { kind: 'section'; label: string }
  | { kind: 'field'; label: string; value: string | number; key?: keyof VisaPayload }

function fieldValue(key: keyof VisaPayload, payload: VisaPayload): string | number {
  const raw = payload[key]
  if (typeof raw === 'number') return raw
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return EMPTY
  return VALUE_WORDS[key]?.[text] ?? text
}

function productWords(product: VisaBundleProduct, payload: VisaPayload): { entry: string; speed: string } {
  // The chat records the SOLD pair on the `dm_product_selected` event; the payload's own
  // entryType is the applicant's ANSWER. When the event is absent (an older case, or one
  // opened before the product was picked) the answer stands in.
  const sold = parseVisaEntryType(product?.entryType)
  const answered = parseVisaEntryType(payload.entryType)
  const entryCode = sold ?? answered
  const speedCode = parseVisaSpeedCode(product?.speed)
  // ⚠️ SAY IT OUT LOUD WHEN THEY DISAGREE. An applicant can pick a single-entry product and
  // then answer "multiple" in step 4 (or the reverse). Printing one of the two silently
  // hands the agent a coin flip on the single field the government form cannot be wrong
  // about, so the sheet shows the sold product AND the contradiction.
  const mismatch = sold && answered && sold !== answered
    ? ` — MISMATCH: the applicant's answer says ${ENTRY_TYPE[answered]}. Confirm before filing.`
    : ''
  return {
    entry: entryCode ? `${ENTRY_TYPE[entryCode]}${mismatch}` : EMPTY,
    speed: speedCode ? `${VISA_SPEED_SPECS[speedCode].label} (${speedCode})` : EMPTY,
  }
}

/**
 * Every row of the spreadsheet, in reading order. Coverage is asserted against the built
 * artefact rather than against this list (bundle.test.ts unzips the .xlsx and reads the
 * cells back), so the test cannot pass on a sheet the desk would never receive.
 */
function visaSheetRows(kase: VisaBundleCase, documents: DocumentPlan): VisaSheetRow[] {
  const payload = kase.payload
  const ref = visaCaseRef(kase.applicationId)
  const product = productWords(kase.product, payload)
  const rows: VisaSheetRow[] = [
    { kind: 'title', label: 'eno.vn — e-Visa application handover' },
    { kind: 'section', label: 'Case' },
    { kind: 'field', label: 'Case reference', value: ref },
    { kind: 'field', label: 'Full case id', value: kase.applicationId },
    { kind: 'field', label: 'Case status', value: humanize(kase.status || '') || EMPTY },
    { kind: 'field', label: 'Product — entry type', value: product.entry },
    { kind: 'field', label: 'Product — processing speed', value: product.speed },
    { kind: 'field', label: 'Requested visa dates', value: rangeWords(payload.visaValidFrom, payload.visaValidTo) },
    { kind: 'field', label: 'Case opened', value: stamp(kase.createdAt) },
    { kind: 'field', label: 'Sent for review', value: stamp(kase.submittedAt) },
    {
      kind: 'field',
      label: 'eno service fee',
      value: kase.paidAt ? `Paid ${stamp(kase.paidAt)}${kase.paymentProvider ? ` · ${kase.paymentProvider}` : ''}` : 'Not paid',
    },
    { kind: 'field', label: 'Pack generated (Vietnam time)', value: stamp(kase.generatedAt.toISOString()) },
    { kind: 'section', label: 'Files in this pack' },
  ]
  for (const item of documents.images) {
    rows.push({ kind: 'field', label: IMAGE_TITLE[item.kind], value: item.note })
  }
  if (documents.otherKinds.length) {
    rows.push({ kind: 'field', label: 'Other files on the case', value: `${documents.otherKinds.join(', ')} — held in eno, not part of this pack` })
  }
  for (const section of VISA_SHEET_SECTIONS) {
    rows.push({ kind: 'section', label: section.title })
    for (const field of section.fields) {
      rows.push({ kind: 'field', key: field.key, label: field.label, value: fieldValue(field.key, payload) })
    }
  }
  return rows
}

function rangeWords(from: string, to: string): string {
  if (!from && !to) return EMPTY
  return `${from || EMPTY} to ${to || EMPTY}`
}

// ── OOXML (SpreadsheetML) ─────────────────────────────────────────────────────────
//
// The minimum viable .xlsx package: content types, the package rel, the workbook and its
// rels, one worksheet, one stylesheet. Inline strings, so there is no sharedStrings part
// and no cell that a spreadsheet app will treat as a formula.

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
// XML 1.0 forbids most C0 control characters outright — they are stripped, not escaped,
// because an escaped one is still illegal and would make the workbook unopenable.
/**
 * Characters XML 1.0 forbids OUTRIGHT — not "should be escaped", but cannot appear at all.
 *
 * ⚠️ U+FFFE and U+FFFF were missing, and an external reviewer (GPT-5.6, 2026-07-22) showed why
 * that matters here: both are illegal in XML 1.0 yet sail straight through escaping, so an
 * applicant who types one into any free-text answer produces a workbook Excel REFUSES TO OPEN.
 * This dossier is the artefact a human agent files the visa from — a corrupt sheet is a silent
 * denial of service against the desk, delivered through a name field.
 *
 * Lone surrogates go too: half a surrogate pair is not a character, and a paste from a broken
 * source can carry one.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function xmlText(value: string): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** cellXfs indexes, fixed by the stylesheet below. */
const STYLE = { body: 0, label: 1, value: 2, section: 3, title: 4 } as const

function sheetXml(rows: VisaSheetRow[]): string {
  const body = rows.map((row, index) => {
    const r = index + 1
    if (row.kind !== 'field') {
      const style = row.kind === 'title' ? STYLE.title : STYLE.section
      return `<row r="${r}"><c r="A${r}" s="${style}" t="inlineStr"><is><t>${xmlText(row.label)}</t></is></c></row>`
    }
    const label = `<c r="A${r}" s="${STYLE.label}" t="inlineStr"><is><t>${xmlText(row.label)}</t></is></c>`
    const value = typeof row.value === 'number' && Number.isFinite(row.value)
      ? `<c r="B${r}" s="${STYLE.body}"><v>${row.value}</v></c>`
      : `<c r="B${r}" s="${STYLE.value}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(row.value))}</t></is></c>`
    return `<row r="${r}">${label}${value}</row>`
  }).join('')
  return `${XML_DECL}<worksheet xmlns="${NS_MAIN}">`
    + '<cols><col min="1" max="1" width="46" customWidth="1"/><col min="2" max="2" width="62" customWidth="1"/></cols>'
    + `<sheetData>${body}</sheetData></worksheet>`
}

const STYLES_XML = `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">`
  + '<fonts count="3">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="14"/><name val="Calibri"/></font>'
  + '</fonts>'
  // Excel reserves fill 0 (none) and fill 1 (gray125); ours has to be index 2 or the
  // workbook is rejected as corrupt.
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF2"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

const CONTENT_TYPES_XML = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '</Types>'

const PACKAGE_RELS_XML = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>`
  + '</Relationships>'

const WORKBOOK_XML = `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
  + '<sheets><sheet name="Application" sheetId="1" r:id="rId1"/></sheets>'
  + '</workbook>'

const WORKBOOK_RELS_XML = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>`
  + `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>`
  + '</Relationships>'

/** The .xlsx package for one application — an in-memory zip, never a temp file. */
export function buildApplicantWorkbook(rows: VisaSheetRow[], mtime: Date): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(PACKAGE_RELS_XML),
    'xl/workbook.xml': strToU8(WORKBOOK_XML),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS_XML),
    'xl/styles.xml': strToU8(STYLES_XML),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(rows)),
  }, { level: 6, mtime })
}

// ── The pack ──────────────────────────────────────────────────────────────────────

type ImagePlan = { kind: PackImageKind; bytes: Uint8Array | null; entry: string | null; note: string }
type DocumentPlan = { images: ImagePlan[]; otherKinds: string[]; missing: VisaBundle['missing'] }

/** Extension from the stored mime type. Storage normalizes to JPEG; this stays honest anyway. */
function extensionFor(mimeType: string): string {
  const subtype = (mimeType || '').toLowerCase().split(';')[0].split('/')[1] || 'jpg'
  if (subtype === 'jpeg') return 'jpg'
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype : 'bin'
}

/**
 * ⚠️ A MISSING DOCUMENT DEGRADES, IT NEVER THROWS. "A half-complete case is exactly when
 * the desk needs to look" — so the pack still builds, the sheet says which photo is absent
 * and why, and the README repeats it where nobody can miss it. Refusing to produce
 * anything would hide the very thing the desk downloaded the pack to find out.
 */
function planDocuments(documents: VisaBundleDocument[]): DocumentPlan {
  const missing: VisaBundle['missing'] = []
  const images = PACK_IMAGE_KINDS.map<ImagePlan>((kind) => {
    // Newest upload of this kind wins: a re-upload supersedes the photo it replaced, and
    // the caller hands rows over in created_at order.
    const rows = documents.filter((document) => document.kind === kind)
    const row = rows.length ? rows[rows.length - 1] : null
    if (!row) {
      missing.push({ kind, reason: 'not_uploaded' })
      return { kind, bytes: null, entry: null, note: 'NOT IN THIS PACK — the applicant has not uploaded this photo' }
    }
    if (!row.bytes || row.bytes.length === 0) {
      missing.push({ kind, reason: 'unavailable' })
      return { kind, bytes: null, entry: null, note: 'NOT IN THIS PACK — the file could not be read from storage; ask the applicant to upload it again' }
    }
    const entry = `${kind}.${extensionFor(row.mimeType)}`
    return { kind, bytes: row.bytes, entry, note: `Included as ${entry}` }
  })
  const otherKinds = [...new Set(documents
    .filter((document) => !(PACK_IMAGE_KINDS as readonly string[]).includes(document.kind))
    .map((document) => document.kind.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40))
    .filter(Boolean))]
  return { images, otherKinds, missing }
}

/**
 * The plain-text cover note. Bilingual because the agent filing the application is
 * Vietnamese and the desk is not always — the same reasoning as the bilingual inbox
 * previews in dm-steps.ts. CRLF line endings so it opens correctly in Windows Notepad,
 * which is where a forwarded zip usually gets opened.
 */
function readmeText(kase: VisaBundleCase, plan: DocumentPlan, entries: string[]): string {
  const ref = visaCaseRef(kase.applicationId)
  const lines = [
    'eno.vn — e-Visa application handover pack',
    'Bộ hồ sơ e-Visa chuyển cho đại lý nộp',
    '',
    `Case reference / Mã hồ sơ:  ${ref}`,
    `Generated / Tạo lúc:        ${stamp(kase.generatedAt.toISOString())} (Vietnam time)`,
    '',
    'CONTENTS / NỘI DUNG',
    '  applicant.xlsx  Every answer the applicant gave, labelled for the government form.',
    '                  Toàn bộ thông tin người nộp đơn, đã ghi nhãn theo mẫu tờ khai.',
  ]
  for (const image of plan.images) {
    if (!image.entry) continue
    lines.push(`  ${image.entry.padEnd(15)} ${IMAGE_TITLE[image.kind]}.`)
  }
  if (plan.missing.length) {
    lines.push('', 'MISSING / THIẾU')
    for (const image of plan.images) {
      if (image.entry) continue
      lines.push(`  ${IMAGE_TITLE[image.kind]}: ${image.note}`)
    }
    lines.push('  Do not file this application until the missing file is supplied.')
    lines.push('  Chưa nộp hồ sơ khi còn thiếu tập tin.')
  }
  lines.push(
    '',
    `FILES / TẬP TIN: ${entries.length}`,
    '',
    'This pack contains personal data. Treat it as confidential, forward it only to the',
    'agent filing this application, and delete it once the application has been filed.',
    'Tập tin này chứa dữ liệu cá nhân — chỉ chuyển cho đại lý nộp hồ sơ và xoá sau khi nộp.',
    '',
  )
  return lines.join('\r\n')
}

/**
 * Assemble one application's handover pack.
 *
 * PURE: bytes in, bytes out. No I/O, no disk, no clock (`generatedAt` is injected), no
 * logging — see the module header for why that split is load-bearing.
 */
export function buildVisaHandoverBundle(kase: VisaBundleCase): VisaBundle {
  // Re-parse rather than trust the caller's object: this is the last point before the
  // answers leave the system, and a payload that has drifted from the schema (an older
  // row, a hand-edited envelope) must be normalized here rather than rendered raw.
  const payload = visaPayloadSchema.parse(kase.payload)
  const normalized: VisaBundleCase = { ...kase, payload }
  const plan = planDocuments(kase.documents)
  const ref = visaCaseRef(kase.applicationId)
  const folder = `eno-visa-${ref}`
  const rows = visaSheetRows(normalized, plan)
  const mtime = kase.generatedAt

  const files: Zippable = {}
  const entries: string[] = []
  const add = (name: string, bytes: Uint8Array, level: 0 | 6) => {
    const path = `${folder}/${name}`
    files[path] = [bytes, { level, mtime }]
    entries.push(path)
  }

  add('applicant.xlsx', buildApplicantWorkbook(rows, mtime), 0) // already deflated inside
  for (const image of plan.images) {
    if (image.entry && image.bytes) add(image.entry, image.bytes, 0) // JPEG — re-deflating buys nothing
  }
  // Written last so its file count is the final one, listed first in the archive order the
  // reader shows because entries[] drives the sheet, not the zip's own ordering.
  add('README.txt', strToU8(readmeText(normalized, plan, [...entries, `${folder}/README.txt`])), 6)

  return {
    filename: `eno-visa-${ref}-${packDay(kase.generatedAt)}.zip`,
    bytes: zipSync(files, { mtime }),
    entries,
    missing: plan.missing,
  }
}
