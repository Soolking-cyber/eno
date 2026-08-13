import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'

// THE HANDOVER PACK, and the gate in front of it.
//
// Two things decide whether this feature is safe to ship, and neither is observable from a
// live-DB e2e without downloading a real applicant's passport:
//
//  1. THE PACK IS COMPLETE. It goes to a human who retypes it into the government portal,
//     so a payload field the sheet silently drops is an answer the applicant gave and the
//     agent never sees. The coverage test below reads the cells back OUT of the generated
//     .xlsx — not out of the label table — so it can only pass on a sheet the desk would
//     actually receive.
//  2. NOTHING IS READ BEFORE THE ADMIN GATE PASSES. `route.GET` is driven with the whole
//     data layer mocked and counting: a non-admin must get a refusal AND leave every
//     counter at zero. Deleting `if (!admin) …` from the route turns this file red.
//
// A THIRD property has its own describe block: a case missing a photo must still produce a
// pack that SAYS what is missing. A half-complete case is exactly when the desk needs one.

// ── The route's world ─────────────────────────────────────────────────────────────
// Everything the route touches is mocked, so the test exercises the handler's own order
// of operations (gate → validate → load → decrypt → fetch → build → audit → respond) and
// nothing else. The counters are the assertion surface for property 2.
const h = vi.hoisted(() => {
  const application = {
    id: '3f2a91bc-1111-4222-8333-444455556666',
    user_id: 'user-1',
    status: 'ready_for_review',
    encrypted_payload: 'envelope',
    created_at: '2026-07-20T02:00:00.000Z',
    submitted_at: '2026-07-21T02:00:00.000Z',
    paid_at: '2026-07-21T01:00:00.000Z',
    payment_provider: 'stripe',
  }
  return {
    state: {
      admin: 'desk@eno.vn' as string | null,
      cryptoReady: true,
      caseState: 'ok' as 'ok' | 'not-found' | 'unavailable',
      documents: [] as Array<Record<string, unknown>>,
      events: [] as Array<Record<string, unknown>>,
      downloadFails: false,
      auditFails: false,
      // counters — the "nothing was read" proof
      loads: 0,
      decrypts: 0,
      downloads: 0,
      audits: [] as Array<{ applicationId: string; actorType: string; event: string; actorRef?: string; metadata: unknown }>,
      application,
    },
  }
})

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } }),
  },
}))

// ⚠️ THE DESK OPERATOR GATE, MOCKED TO THE SAME `h.state.admin` THESE TESTS ALREADY DRIVE.
// The production gate moved from getAdmin() to the SCOPED desk operator (src/lib/desk-operator.ts)
// so a partner running one desk does not need ADMIN_EMAILS — which would have granted them every
// dispute room and every other applicant's documents. Every assertion in this file is about the
// operator/non-operator distinction, not about which env names the operator, so pointing the new
// helper at the same flag keeps them meaningful. The entitlement itself — visa operator refused on
// trips and vice versa — is pinned in src/lib/desk-operator.test.ts.
vi.mock('@/lib/desk-operator', () => ({
  getVisaDeskOperator: async () => h.state.admin,
  getTripDeskOperator: async () => h.state.admin,
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.state.admin }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9 }) }))
vi.mock('@/lib/visa-admin', () => ({
  VISA_BUCKET: 'visa-documents',
  loadVisaAdminCase: async () => {
    h.state.loads += 1
    if (h.state.caseState !== 'ok') return { state: h.state.caseState }
    return { state: 'ok', application: h.state.application, documents: h.state.documents, events: h.state.events }
  },
}))
vi.mock('@/lib/visa/crypto', () => ({
  visaCryptoReady: () => h.state.cryptoReady,
  decryptVisaPayload: () => {
    h.state.decrypts += 1
    return fixturePayload()
  },
}))
vi.mock('@/lib/visa/db', () => ({
  getVisaDb: () => ({
    storage: {
      from: () => ({
        download: async () => {
          h.state.downloads += 1
          if (h.state.downloadFails) return { data: null, error: { message: 'nope' } }
          const bytes = JPEG_BYTES
          return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null }
        },
      }),
    },
  }),
}))
// Imported by the route for the product-event NAME only; the real module drags in Prisma.
vi.mock('@/lib/visa/dm-flow', () => ({ VISA_DM_PRODUCT_EVENT: 'dm_product_selected' }))
vi.mock('@/lib/visa/records', () => ({
  recordVisaEvent: async (applicationId: string, actorType: string, event: string, actorRef?: string, metadata?: unknown) => {
    if (h.state.auditFails) throw new Error('visa_event_failed:boom')
    h.state.audits.push({ applicationId, actorType, event, actorRef, metadata })
  },
}))

import { buildVisaHandoverBundle, visaCaseRef, visaPackReference, VISA_SHEET_SECTIONS, type VisaBundleCase } from './bundle'
import { visaPayloadSchema, type VisaPayload } from './schema'
import { GET } from '@/app/api/visa/admin/applications/[id]/bundle/route.svc'

// Not a real JPEG — the pack stores document bytes verbatim and never decodes them, so a
// recognizable byte string is more useful here than a valid image.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
const CASE_ID = '3f2a91bc-1111-4222-8333-444455556666'
/** The human case number stored on visa_applications.reference. */
const REFERENCE = 'EV-1042'
/** The folder every pack in this file is built into. */
const PACK = `eno-visa-${REFERENCE}`
/** The pre-reference naming: first 8 hex of the uuid. Still the fallback for a row that
 *  has no reference, which is the only reason it is still here. */
const UUID_REF = '3f2a91bc'
const GENERATED_AT = new Date('2026-07-22T03:15:00.000Z') // 10:15 in Vietnam

/**
 * Every payload field populated with a distinctive value. A blanket "nothing renders as the
 * empty dash" assertion is only meaningful if every field really was answered.
 */
function fixturePayload(): VisaPayload {
  return visaPayloadSchema.parse({
    aiDocumentProcessingConsent: true,
    surname: 'O&#x27;BRIEN <test>', givenNames: 'MARY JANE', dateOfBirth: '1990-04-11',
    sex: 'female', nationality: 'Ireland', identityNumber: 'ID-556677', email: 'mary@example.com',
    religion: 'Catholic', placeOfBirth: 'Cork, Ireland',
    usedOtherPassportsForVietnam: 'yes', usedOtherPassportDetails: 'Old passport P111 in 2019',
    hasOtherNationalities: 'yes', otherNationalities: 'United Kingdom',
    hasVietnamLawViolation: 'yes', vietnamLawViolationDetails: 'Overstayed by two days in 2018',
    passportNumber: 'X1234567', passportType: 'ordinary', passportIssuingAuthority: 'DFA Dublin',
    passportIssueDate: '2021-01-05', passportExpiryDate: '2031-01-04',
    hasOtherPassports: 'yes', otherPassportDetails: 'Emergency passport E99',
    entryType: 'multiple', visaValidFrom: '2026-08-01', visaValidTo: '2026-10-29',
    permanentAddress: '14 Sea Road, Galway', phone: '+353861112222',
    emergencyName: 'Sean O Brien', emergencyRelationship: 'Brother',
    emergencyAddress: '9 Hill Street, Galway', emergencyPhone: '+353869998888',
    occupation: 'Nurse', employerName: 'Galway Clinic', employerAddress: 'Doughiska, Galway', employerPhone: '+35391785000',
    purposeOfEntry: 'Tourism', intendedEntryDate: '2026-08-03', stayLengthDays: 30,
    currentlyOutsideVietnam: 'yes',
    temporaryAddress: '25 Bui Vien', temporaryProvince: 'Ho Chi Minh City', temporaryWard: 'Pham Ngu Lao',
    entryGate: 'Tan Son Nhat Intl Airport', exitGate: 'Noi Bai Intl Airport',
    localContactName: 'Tran Thi Mai', localContactAddress: '25 Bui Vien', localContactPhone: '+84901234567',
    visitedVietnamLastYear: 'yes', previousVisitDetails: 'Two weeks in March 2026',
    hasRelativesInVietnam: 'yes', relativesInVietnamDetails: 'Cousin in Da Nang',
    estimatedExpenses: 2500, expensesCurrency: 'EUR', expensesPayer: 'organization', paymentMethod: 'cash',
    payerName: 'Galway Clinic', payerAddress: 'Doughiska, Galway', payerPhone: '+35391785000',
    payerDetails: 'Employer covers the trip',
    hasTravelInsurance: 'yes', insuranceDetails: 'AXA policy 44-AB',
    hasChildrenOnPassport: 'yes', childrenOnPassportDetails: 'Daughter Aoife, 6',
    applicantNotes: '=SUM(A1:A9) please call before 9am',
    adminMessage: 'Desk note: expedite', governmentRegistrationCode: 'REG-2026-1', governmentApplicationStatus: 'processing',
  })
}

function fixtureCase(overrides: Partial<VisaBundleCase> = {}): VisaBundleCase {
  return {
    applicationId: CASE_ID,
    reference: REFERENCE,
    status: 'ready_for_review',
    payload: fixturePayload(),
    documents: [
      { kind: 'passport', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
      { kind: 'portrait', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
    ],
    product: { entryType: 'multiple', speed: '1H' },
    createdAt: '2026-07-20T02:00:00.000Z',
    submittedAt: '2026-07-21T02:00:00.000Z',
    paidAt: '2026-07-21T01:00:00.000Z',
    paymentProvider: 'stripe',
    generatedAt: GENERATED_AT,
    ...overrides,
  }
}

// ── Reading the artefact back ─────────────────────────────────────────────────────

const unescape = (value: string) =>
  value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&')

function packEntries(zip: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(zip)
}

function workbookParts(zip: Uint8Array): Record<string, Uint8Array> {
  const files = packEntries(zip)
  // Folder-agnostic on purpose: the pack folder is named from the CASE REFERENCE, and this
  // file reads both reference-named packs and the uuid-fallback ones.
  const sheet = Object.entries(files).find(([name]) => name.endsWith('/applicant.xlsx'))?.[1]
  if (!sheet) throw new Error('the pack contains no applicant.xlsx')
  return unzipSync(sheet)
}

/** [label, value] for every row of the sheet, decoded out of the real worksheet part.
 *  A heading row has NO value cell, and reads back as null rather than as an empty string —
 *  otherwise a heading that happens to share a field's wording would answer a lookup with ''
 *  and a genuinely dropped value would look identical to a heading. */
function sheetRows(zip: Uint8Array): Array<[string, string | null]> {
  const xml = strFromU8(workbookParts(zip)['xl/worksheets/sheet1.xml'])
  return [...xml.matchAll(/<row r="\d+">([\s\S]*?)<\/row>/g)].map(([, row]) => {
    const cells = [...row.matchAll(/<c r="([AB])\d+"[^>]*>([\s\S]*?)<\/c>/g)]
    const read = (raw: string) => {
      const inline = raw.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)
      if (inline) return unescape(inline[1])
      const numeric = raw.match(/<v>([\s\S]*?)<\/v>/)
      return numeric ? numeric[1] : ''
    }
    const a = cells.find((cell) => cell[1] === 'A')
    const b = cells.find((cell) => cell[1] === 'B')
    return [a ? read(a[2]) : '', b ? read(b[2]) : null] as [string, string | null]
  })
}

const lookup = (rows: Array<[string, string | null]>, label: string) =>
  rows.find(([a, b]) => a === label && b !== null)?.[1]

// ── 1 · The pack a desk downloads ─────────────────────────────────────────────────

describe('buildVisaHandoverBundle', () => {
  it('is one folder: 2 images, the spreadsheet, and a cover note', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase())
    expect(Object.keys(packEntries(bundle.bytes)).sort()).toEqual([
      `${PACK}/README.txt`,
      `${PACK}/applicant.xlsx`,
      `${PACK}/passport.jpg`,
      `${PACK}/portrait.jpg`,
    ])
    expect(bundle.missing).toEqual([])
  })

  it('stores the image bytes verbatim — the pack is the original files', () => {
    const files = packEntries(buildVisaHandoverBundle(fixtureCase()).bytes)
    expect(Array.from(files[`${PACK}/passport.jpg`])).toEqual(Array.from(JPEG_BYTES))
    expect(Array.from(files[`${PACK}/portrait.jpg`])).toEqual(Array.from(JPEG_BYTES))
  })

  it('names the file from the case reference and the date — never from applicant data', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase())
    // Spelled out rather than composed from PACK: this is the exact string that lands in
    // a Content-Disposition header and in the desk's download history.
    expect(bundle.filename).toBe('eno-visa-EV-1042-2026-07-22.zip')
    // The whole point of the naming rule: nothing identifying may reach a download history.
    for (const secret of ['X1234567', 'OBRIEN', 'O&', 'MARY', 'mary@example.com', 'ID-556677']) {
      expect(bundle.filename).not.toContain(secret)
    }
    expect(bundle.filename).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('uses the VIETNAM calendar day in the filename, not the server day', () => {
    // 22:30 UTC on the 21st is already 05:30 on the 22nd in Ho Chi Minh City.
    const bundle = buildVisaHandoverBundle(fixtureCase({ generatedAt: new Date('2026-07-21T22:30:00.000Z') }))
    expect(bundle.filename).toBe(`${PACK}-2026-07-22.zip`)
  })

  it('is reproducible — same case, same bytes', () => {
    const a = buildVisaHandoverBundle(fixtureCase()).bytes
    const b = buildVisaHandoverBundle(fixtureCase()).bytes
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

// ── 2 · Completeness: the agent must see every answer ─────────────────────────────

describe('the spreadsheet carries every answer', () => {
  it('labels EVERY payload field — no key may be unrouted', () => {
    const labelled = VISA_SHEET_SECTIONS.flatMap((section) => section.fields.map((field) => field.key))
    expect(new Set(labelled).size).toBe(labelled.length) // no field printed twice
    expect([...labelled].sort()).toEqual(Object.keys(visaPayloadSchema.shape).sort())
  })

  it('renders every labelled field into the sheet with a real answer', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase()).bytes)
    for (const section of VISA_SHEET_SECTIONS) {
      for (const field of section.fields) {
        const value = lookup(rows, field.label)
        expect(value, `${String(field.key)} (${field.label}) is missing from the sheet`).toBeDefined()
        // The fixture answers everything, so an em dash here means the value was dropped.
        expect(value, `${String(field.key)} rendered as empty`).not.toBe('—')
        expect(value).not.toBe('')
      }
    }
  })

  it('keeps every section heading, in order', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase()).bytes)
    const labels = rows.map(([a]) => a)
    let cursor = labels.indexOf('Case')
    expect(cursor).toBeGreaterThanOrEqual(0)
    for (const section of VISA_SHEET_SECTIONS) {
      const at = labels.indexOf(section.title, cursor)
      expect(at, `section ${section.title} missing or out of order`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('writes values a human can key: passport number verbatim, enums as words', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase()).bytes)
    expect(lookup(rows, 'Passport number')).toBe('X1234567')
    expect(lookup(rows, 'Given names (exactly as in the passport)')).toBe('MARY JANE')
    expect(lookup(rows, 'Sex')).toBe('Female')
    expect(lookup(rows, 'Entry type')).toBe('Multiple entry')
    expect(lookup(rows, 'Passport type')).toBe('Ordinary')
    expect(lookup(rows, 'Method of payment')).toBe('Cash')
    expect(lookup(rows, 'Who covers the expenses')).toBe('An organization')
    expect(lookup(rows, 'Holds other valid passports?')).toBe('Yes')
    expect(lookup(rows, 'Applicant is outside Vietnam')).toBe('Yes — outside Vietnam')
    expect(lookup(rows, 'Applicant consented to automated passport reading')).toBe('Yes')
    // Numbers stay numbers so the agent reads 30, not "30 days".
    expect(lookup(rows, 'Intended length of stay (days)')).toBe('30')
    expect(lookup(rows, 'Estimated expenses for the trip')).toBe('2500')
  })

  it('carries the case reference, the product bought and the requested dates', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase()).bytes)
    expect(lookup(rows, 'Case reference')).toBe(REFERENCE)
    expect(lookup(rows, 'Full case id')).toBe(CASE_ID)
    expect(lookup(rows, 'Case status')).toBe('Ready for review')
    expect(lookup(rows, 'Product — entry type')).toBe('Multiple entry')
    expect(lookup(rows, 'Product — processing speed')).toBe('Within 1 hour (1H)')
    expect(lookup(rows, 'Requested visa dates')).toBe('2026-08-01 to 2026-10-29')
    expect(lookup(rows, 'eno service fee')).toContain('Paid')
    expect(lookup(rows, 'Pack generated (Vietnam time)')).toBe('22/07/2026 10:15')
  })

  it('flags a product/answer entry-type mismatch instead of picking one silently', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase({ product: { entryType: 'single', speed: '1H' } })).bytes)
    // Sold: single. Answered (fixture payload): multiple. The agent must see both.
    expect(lookup(rows, 'Product — entry type')).toBe(
      "Single entry — MISMATCH: the applicant's answer says Multiple entry. Confirm before filing.",
    )
    expect(lookup(rows, 'Entry type')).toBe('Multiple entry')
  })

  it('says nothing about a mismatch when the two agree', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase()).bytes)
    expect(lookup(rows, 'Product — entry type')).toBe('Multiple entry')
  })

  it('falls back to the applicant answer when no product event was recorded', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase({ product: null })).bytes)
    expect(lookup(rows, 'Product — entry type')).toBe('Multiple entry') // payload.entryType
    expect(lookup(rows, 'Product — processing speed')).toBe('—')
  })

  it('escapes XML and cannot emit a formula cell', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase())
    const xml = strFromU8(workbookParts(bundle.bytes)['xl/worksheets/sheet1.xml'])
    // The fixture surname contains & and <; both must be escaped in the part…
    expect(xml).not.toMatch(/<t[^>]*>[^<]*<test>/)
    expect(xml).toContain('&amp;')
    // …and survive intact when read back.
    const rows = sheetRows(bundle.bytes)
    expect(lookup(rows, 'Surname (exactly as in the passport)')).toBe('O&#x27;BRIEN <test>')
    // A leading '=' is DATA. Inline strings are typed text, so no reader evaluates it.
    const notes = xml.match(/<row r="\d+"><c r="A\d+"[^>]*><is><t[^>]*>Notes from the applicant<\/t><\/is><\/c>(<c r="B\d+"[^>]*>)/)
    expect(notes?.[1]).toContain('t="inlineStr"')
    expect(lookup(rows, 'Notes from the applicant')).toContain('=SUM(A1:A9)')
  })

  it('is a structurally valid xlsx package', () => {
    const parts = workbookParts(buildVisaHandoverBundle(fixtureCase()).bytes)
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
    const types = strFromU8(parts['[Content_Types].xml'])
    expect(types).toContain('/xl/workbook.xml')
    expect(types).toContain('/xl/worksheets/sheet1.xml')
    expect(types).toContain('/xl/styles.xml')
    // Every relationship target must exist in the package, or Excel calls the file corrupt.
    const rels = strFromU8(parts['xl/_rels/workbook.xml.rels']) + strFromU8(parts['_rels/.rels'])
    for (const target of ['xl/workbook.xml', 'worksheets/sheet1.xml', 'styles.xml']) {
      expect(rels).toContain(`Target="${target}"`)
    }
    // Every part must be well-formed enough to have balanced angle brackets and a decl.
    for (const [name, bytes] of Object.entries(parts)) {
      const xml = strFromU8(bytes)
      expect(xml.startsWith('<?xml'), `${name} has no XML declaration`).toBe(true)
      expect(xml.split('<').length, name).toBe(xml.split('>').length)
    }
  })
})

// ── 3 · A half-complete case still produces a pack ────────────────────────────────

describe('a missing document degrades, never throws', () => {
  it('builds without the portrait and says so, in the sheet and the README', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase({
      documents: [{ kind: 'passport', mimeType: 'image/jpeg', bytes: JPEG_BYTES }],
    }))
    const files = packEntries(bundle.bytes)
    expect(Object.keys(files).sort()).toEqual([
      `${PACK}/README.txt`,
      `${PACK}/applicant.xlsx`,
      `${PACK}/passport.jpg`,
    ])
    expect(bundle.missing).toEqual([{ kind: 'portrait', reason: 'not_uploaded' }])
    expect(lookup(sheetRows(bundle.bytes), 'Portrait photo')).toContain('NOT IN THIS PACK')
    const readme = strFromU8(files[`${PACK}/README.txt`])
    expect(readme).toContain('MISSING')
    expect(readme).toContain('Portrait photo')
  })

  it('distinguishes "never uploaded" from "storage could not produce it"', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase({
      documents: [
        { kind: 'passport', mimeType: 'image/jpeg', bytes: null },
        { kind: 'portrait', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
      ],
    }))
    expect(bundle.missing).toEqual([{ kind: 'passport', reason: 'unavailable' }])
    expect(lookup(sheetRows(bundle.bytes), 'Passport data page')).toContain('could not be read from storage')
  })

  it('survives a case with no documents at all', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase({ documents: [] }))
    expect(Object.keys(packEntries(bundle.bytes)).sort()).toEqual([
      `${PACK}/README.txt`,
      `${PACK}/applicant.xlsx`,
    ])
    expect(bundle.missing.map((item) => item.kind).sort()).toEqual(['passport', 'portrait'])
  })

  it('names other files held on the case without shipping them', () => {
    const rows = sheetRows(buildVisaHandoverBundle(fixtureCase({
      documents: [
        { kind: 'passport', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
        { kind: 'portrait', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
        { kind: 'result', mimeType: 'application/pdf', bytes: null },
      ],
    })).bytes)
    expect(lookup(rows, 'Other files on the case')).toContain('result')
  })

  it('takes the NEWEST upload of a kind (a re-upload supersedes the photo it replaced)', () => {
    const newer = new Uint8Array([9, 9, 9, 9])
    const files = packEntries(buildVisaHandoverBundle(fixtureCase({
      documents: [
        { kind: 'passport', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
        { kind: 'passport', mimeType: 'image/jpeg', bytes: newer },
        { kind: 'portrait', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
      ],
    })).bytes)
    expect(Array.from(files[`${PACK}/passport.jpg`])).toEqual([9, 9, 9, 9])
  })
})

// ── 3½ · What the pack is NAMED after ─────────────────────────────────────────────
//
// The folder, the zip and the "Case reference" cell all read one string, and it reaches a
// filesystem path and a Content-Disposition header. Two properties matter: it is the
// HUMAN case number when the row has one, and it is a CLOSED CHARACTER SET always.

describe('visaPackReference', () => {
  it('is the stored human case number', () => {
    expect(visaPackReference({ applicationId: CASE_ID, reference: 'EV-1042' })).toBe('EV-1042')
    expect(visaPackReference({ applicationId: CASE_ID, reference: 'EV-1001' })).toBe('EV-1001')
  })

  it('canonicalises a reference that arrived messy', () => {
    // Same case, however it was stored or pasted: lower case, stray padding, no hyphen.
    for (const stored of [' ev-1042 ', 'EV1042', 'ev 1042', '\uFEFFEV-1042']) {
      expect(visaPackReference({ applicationId: CASE_ID, reference: stored })).toBe('EV-1042')
    }
  })

  it('falls back to the uuid slice for a row written before references existed', () => {
    for (const missing of [null, undefined, '']) {
      expect(visaPackReference({ applicationId: CASE_ID, reference: missing })).toBe(UUID_REF)
    }
  })

  it('⚠️ REFUSES anything that is not a reference — a path is not a case number', () => {
    // Each of these would be a traversal, a broken archive or a header injection if it
    // were interpolated into the folder name. All degrade to the uuid slice instead.
    const hostile = [
      '../../etc/passwd', 'EV-1042/../..', 'EV-1042\r\nX-Injected: 1', 'EV-1042"; rm -rf /',
      'EV-١٠٤٢', 'EV-1042 X1234567', 'MARY JANE', 'EV--1042', 'EV-0042', 'EV-999',
    ]
    for (const reference of hostile) {
      expect(visaPackReference({ applicationId: CASE_ID, reference }), reference).toBe(UUID_REF)
    }
  })

  it('keeps the pack ASCII-safe even when the stored reference is not', () => {
    const bundle = buildVisaHandoverBundle(fixtureCase({ reference: 'EV-1042/../../secret' }))
    expect(bundle.filename).toBe(`eno-visa-${UUID_REF}-2026-07-22.zip`)
    for (const entry of bundle.entries) expect(entry).toMatch(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
  })
})

describe('visaCaseRef', () => {
  it('is the first 8 hex of the id — the pre-reference naming, kept as the fallback', () => {
    expect(visaCaseRef(CASE_ID)).toBe(UUID_REF)
    expect(visaCaseRef('ABCDEF01-2222-4333-8444-555566667777')).toBe('abcdef01')
  })
  it('never returns an empty or non-ascii reference', () => {
    expect(visaCaseRef('')).toBe('unknown0')
    expect(visaCaseRef('zzz')).toBe('unknown0')
  })
})

// ── 4 · THE ADMIN GATE ────────────────────────────────────────────────────────────
//
// ⚠️ THESE PACKS ARE STILL UUID-NAMED, and that is a WIRING GAP, not a decision. The
// builder names a pack from `kase.reference`, but the route does not read the column yet:
// it constructs its VisaBundleCase field by field (route.ts, `buildVisaHandoverBundle({
// applicationId: application.id, … })`) and `reference` is not among them. Closing it is
// two lines OUTSIDE this file — `reference: string` on VisaApplicationRow
// (src/lib/visa-admin.ts, plus the column in QUEUE_COLUMNS) and `reference:
// application.reference` in the route — after which:
//   · `h.state.application` gains `reference: REFERENCE`, and
//   · the six `eno-visa-${UUID_REF}` entry expectations below become `${PACK}`.
// Asserting the uuid form is what the route DOES today; it is not what it should do.

describe('GET /api/visa/admin/applications/[id]/bundle', () => {
  const call = (id = CASE_ID) => GET(new Request(`https://eno.vn/api/visa/admin/applications/${id}/bundle`), { params: Promise.resolve({ id }) })

  beforeEach(() => {
    h.state.admin = 'desk@eno.vn'
    h.state.cryptoReady = true
    h.state.caseState = 'ok'
    h.state.downloadFails = false
    h.state.auditFails = false
    h.state.documents = [
      { id: 'd1', kind: 'passport', storage_path: 'user-1/case/passport.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
      { id: 'd2', kind: 'portrait', storage_path: 'user-1/case/portrait.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
    ]
    h.state.events = [
      { id: 'e1', event: 'dm_product_selected', created_at: '2026-07-20T03:00:00.000Z', metadata: { entryType: 'single', speed: '2D' } },
      { id: 'e2', event: 'dm_product_selected', created_at: '2026-07-20T04:00:00.000Z', metadata: { entryType: 'multiple', speed: '1H' } },
    ]
    h.state.loads = 0
    h.state.decrypts = 0
    h.state.downloads = 0
    h.state.audits = []
  })

  it('REFUSES a non-admin and reads NOTHING — the gate is the whole feature', async () => {
    h.state.admin = null
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    // If the gate is deleted, these are what turn red: no case load, no decrypt, no
    // passport photo pulled out of storage, and no audit row for a download that happened.
    expect(h.state.loads).toBe(0)
    expect(h.state.decrypts).toBe(0)
    expect(h.state.downloads).toBe(0)
    expect(h.state.audits).toEqual([])
  })

  it('serves an admin a no-store zip attachment named after the case', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('cache-control')).toContain('no-store')
    const disposition = res.headers.get('content-disposition') || ''
    // Either naming is acceptable to the HEADER contract (that is the point of the
    // normalizer); what must never vary is the closed character set and the date.
    expect(disposition).toMatch(/^attachment; filename="eno-visa-(EV-\d+|[0-9a-f]{8})-\d{4}-\d{2}-\d{2}\.zip"$/)
    expect(disposition).not.toContain('X1234567')
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([
      `eno-visa-${UUID_REF}/README.txt`,
      `eno-visa-${UUID_REF}/applicant.xlsx`,
      `eno-visa-${UUID_REF}/passport.jpg`,
      `eno-visa-${UUID_REF}/portrait.jpg`,
    ])
    // Fetched SERVER-SIDE: the client got bytes, never a URL to a passport photo.
    expect(h.state.downloads).toBe(2)
  })

  it('audits the download — who, which case, and no applicant data', async () => {
    await call()
    expect(h.state.audits).toHaveLength(1)
    const [audit] = h.state.audits
    expect(audit.applicationId).toBe(CASE_ID)
    expect(audit.actorType).toBe('admin')
    expect(audit.event).toBe('admin_handover_downloaded')
    expect(audit.actorRef).toBe('desk@eno.vn')
    expect(audit.metadata).toEqual({ files: 4, missing: [] })
    expect(JSON.stringify(audit)).not.toContain('X1234567')
  })

  it('REFUSES to serve when the audit cannot be written', async () => {
    h.state.auditFails = true
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'audit_unavailable' })
  })

  it('uses the newest product event for the sheet', async () => {
    const res = await call()
    const rows = sheetRows(new Uint8Array(await res.arrayBuffer()))
    expect(lookup(rows, 'Product — processing speed')).toBe('Within 1 hour (1H)')
  })

  it('still serves a pack when a document cannot be downloaded', async () => {
    h.state.downloadFails = true
    const res = await call()
    expect(res.status).toBe(200)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([`eno-visa-${UUID_REF}/README.txt`, `eno-visa-${UUID_REF}/applicant.xlsx`])
    expect(h.state.audits[0].metadata).toEqual({ files: 2, missing: ['passport:unavailable', 'portrait:unavailable'] })
  })

  it('answers honestly when the case, the tables or the key are absent', async () => {
    h.state.caseState = 'not-found'
    expect((await call()).status).toBe(404)
    h.state.caseState = 'unavailable'
    expect((await call()).status).toBe(503)
    h.state.caseState = 'ok'
    h.state.cryptoReady = false
    h.state.loads = 0
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'visa_encryption_not_configured' })
    // No key ⇒ the case is never even loaded.
    expect(h.state.loads).toBe(0)
  })

  it('404s a non-uuid id before touching the database', async () => {
    const res = await call('not-a-uuid')
    expect(res.status).toBe(404)
    expect(h.state.loads).toBe(0)
  })
})

// ── XML-illegal characters (external review, GPT-5.6 2026-07-22) ────────────────────
// U+FFFE / U+FFFF are illegal in XML 1.0 but sail through escaping, so an applicant could
// hand the desk a workbook Excel refuses to open — a denial of service delivered through a
// name field. The dossier is what a human agent files the visa from, so a corrupt sheet is
// not cosmetic.
describe('a hostile answer cannot corrupt the workbook', () => {
  const sheetXmlFor = (payload: Partial<VisaPayload>) =>
        strFromU8(
          workbookParts(
            buildVisaHandoverBundle(fixtureCase({ payload: { ...fixturePayload(), ...payload } })).bytes,
          )['xl/worksheets/sheet1.xml'],
        )

  it('strips characters XML 1.0 forbids outright, and lone surrogates', async () => {
    const sheet = sheetXmlFor({ surname: `Sm￾ith￿`, givenNames: 'A\uD800B' })
    for (const bad of ['￾', '￿', '\uD800']) {
      expect(sheet.includes(bad), `must not contain ${bad.codePointAt(0)?.toString(16)}`).toBe(false)
    }
    // …while the surrounding letters survive: stripping must not eat the answer.
    expect(sheet).toContain('Smith')
  })

  it('still neutralises a formula, which is the other half of the same surface', () => {
    const sheet = sheetXmlFor({ surname: '=cmd|\' /C calc\'!A0' })
    // inlineStr, never <f> — Excel renders it as text.
    expect(sheet).toContain('t="inlineStr"')
    expect(sheet).not.toMatch(/<f>/)
  })
})
