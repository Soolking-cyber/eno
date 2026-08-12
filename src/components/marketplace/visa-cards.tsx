'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, CreditCard, Download, FileImage, FileText, Loader2,
  LockKeyhole, PencilLine, RotateCcw, ShieldCheck, Sparkles, Upload, UserRound, Wallet,
} from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel,
  ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger,
} from '@/components/ui/combobox'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ChatCard, ChatCardSteps, type ChatCardTone } from '@/components/marketplace/chat-card-shell'
import { useMinuteTick, useVisaCatalogue, VisaProductRow } from '@/components/marketplace/visa-start'
import { formatMoneyFull, formatUsdCents, moneyLocale } from '@/lib/vnd'
import { EVISA_CHECKPOINT_GROUPS } from '@/lib/visa/checkpoints'
import { VISA_DM_STEP_FIELDS, validateVisaDmStep, type VisaDmStep } from '@/lib/visa/dm-steps'
import { parseVisaSpeedCode, VISA_ENTRY_TYPE_LABELS, VISA_SPEED_SPECS, type VisaEntryType, type VisaSpeedCode } from '@/lib/visa/speed'
import { MAX_EVISA_VALIDITY_DAYS, visaDateDefaultsForStart, visaEndDateFor90DayWindow, type VisaPayload } from '@/lib/visa/schema'

// ── THE e-VISA WIZARD, RENDERED INSIDE THE CHAT THREAD ─────────────────────────────
//
// The owner's ask, verbatim: "one tap e visa service should be available through direct
// message … they go through ai process filling up the evisa images and writing there its
// needed parts auto filled parts just aknowledgment of correctness with skip shouldnt be
// more than 5 pages since inside the message … lastly if user fills all should pay through
// paypal inside messaging app all checkout stylized".
//
// Everything below the route layer already exists and is NOT re-implemented here:
//   · src/lib/visa/dm-steps.ts   — the frozen 5-step partition (this file's step numbers,
//                                   field allowlists and per-step validation all come from
//                                   there; nothing here re-partitions anything);
//   · src/lib/visa/dm-thread.ts  — the one card-authoring surface (server);
//   · src/lib/visa/dm-flow.ts    — when a card is emitted (server);
//   · /api/visa/*                — the frozen HTTP contract this file codes against.
// This module is the RENDERER and nothing else. It decides no step, mints no card, and
// names no price.
//
// ⚠️ PII — READ BEFORE EDITING.
//  · A card's `meta` carries a step number, an application id and payload FIELD NAMES.
//    It NEVER carries a value, and nothing here may put one back into it.
//  · The applicant's answers reach this component ONLY through `kase`, which is the
//    applicant's OWN case fetched into the APPLICANT'S OWN browser over an authenticated
//    same-origin request (GET /api/visa/applications/[id] scopes by user_id). The visa
//    desk's own session gets a 404 there, so the admin side of the thread renders the same
//    cards with no values in them — by construction, not by a flag.
//  · Nothing here writes a value into a Message body, a toast, a URL or a log.
//  · Edits go out through POST /api/visa/cards/[messageId]/act with action:'edit', which
//    writes through the existing ENCRYPTED payload path. There is no other write.
//
// ⚠️ MONEY. The client names a PRODUCT, never a price. The đồng figure is the desk's own
// Listing.price and the dollars are a SERVER-ISSUED quote (src/lib/visa/fx.ts) — both
// arrive on the thread payload, already resolved. This file does no conversion and has no
// fallback rate: no quote ⇒ the pay button is disabled and says why.

// ── Wire types (defensive: this is JSON off the network, not a typed import) ───────

export type VisaThreadMode = 'ai' | 'human_requested' | 'admin'

/** A `visa_step` card's metaJson, as it arrives on a message. */
export type VisaStepCardMeta = {
  step: VisaDmStep
  applicationId: string
  state: 'active' | 'done' | 'skipped'
  /** Payload FIELD NAMES the passport extraction filled in — never values. */
  needsReview: string[]
}

/** A `visa_checkout` card's metaJson. */
export type VisaCheckoutCardMeta = {
  applicationId: string
  amountUsd: number
  status: 'unpaid' | 'paid' | 'failed'
}

/** The server-issued VND→USD quote, echoed back to checkout as a confirmation token. */
export type VisaQuoteWire = {
  listingId: string
  priceVnd: number
  amountUsdCents: number
  vndPerUsd: number
  /**
   * ⚠️ THE FEE BREAKDOWN IS OPTIONAL ON PURPOSE — quotes issued before the processing-fee change
   * do not carry it, and rejecting those would make every outstanding quote unpayable on deploy.
   * When it IS present the card must show it, because `amountUsdCents` then exceeds a plain
   * priceVnd÷rate conversion and a buyer doing that arithmetic would otherwise find an
   * unexplained gap. See the gross-up note in src/lib/visa/fx.ts.
   */
  serviceUsdCents?: number
  processingUsdCents?: number
  feePercent?: number
  feeFixedCents?: number
  quotedAt: string
  expiresAt: string
}

/** The visa context the thread GET resolves server-side for a bound conversation. */
export type VisaThreadInfo = {
  applicationId: string
  mode: VisaThreadMode
  product: {
    listingId: string
    title: string
    speed: VisaSpeedCode | null
    entryType: 'single' | 'multiple' | null
    priceVnd: number
    acceptingNow: boolean
    nextOpensIso: string | null
    /** Server-computed ready instant for an order placed NOW (weekend/holiday aware).
     *  Null when no honest promise exists — the pay card then refuses to offer payment. */
    expectedReadyIso?: string | null
  } | null
  quote: VisaQuoteWire | null
  providers: Array<'stripe' | 'paypal'>
}

/** One uploaded document, as the applicant's own case serializes it. */
export type VisaCaseDocument = {
  id: string
  kind: string
  validationStatus?: 'pending' | 'passed' | 'failed' | 'unavailable'
  validationReport?: { issues?: string[]; warnings?: string[] }
}

/** The applicant's own case. Only ever fetched into the applicant's own browser. */
export type VisaCase = {
  id: string
  status: string
  paidAt: string | null
  payload: VisaPayload
  documents: VisaCaseDocument[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * A `visa_step` card's meta, or null. STRUCTURAL — the server already strict-parses every
 * write and re-parses on read (src/lib/messages.ts); this is the client refusing to render
 * a live prompt off a blob it cannot read, which is the same fail-closed answer.
 */
export function parseVisaStepMeta(kind: string | undefined, value: unknown): VisaStepCardMeta | null {
  if (kind !== 'visa_step' || !isRecord(value)) return null
  const { step, applicationId, state, needsReview } = value
  if (typeof step !== 'number' || ![1, 2, 3, 4, 5].includes(step)) return null
  if (typeof applicationId !== 'string' || !applicationId) return null
  if (state !== 'active' && state !== 'done' && state !== 'skipped') return null
  return {
    step: step as VisaDmStep,
    applicationId,
    state,
    needsReview: Array.isArray(needsReview) ? needsReview.filter((name): name is string => typeof name === 'string') : [],
  }
}

/** A `visa_checkout` card's meta, or null. Same discipline as parseVisaStepMeta. */
export function parseVisaCheckoutMeta(kind: string | undefined, value: unknown): VisaCheckoutCardMeta | null {
  if (kind !== 'visa_checkout' || !isRecord(value)) return null
  const { applicationId, amountUsd, status } = value
  if (typeof applicationId !== 'string' || !applicationId) return null
  if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd <= 0) return null
  if (status !== 'unpaid' && status !== 'paid' && status !== 'failed') return null
  return { applicationId, amountUsd, status }
}

/** A `visa_picker` card's metaJson — the step-0 product choice for a generic start. */
export type VisaPickerCardMeta = {
  applicationId: string
  state: 'active' | 'done'
  /** Display-only history: which product a 'done' picker recorded. Never a price source. */
  selectedListingId: string | null
}

/** A `visa_picker` card's meta, or null. Same discipline as parseVisaStepMeta. */
export function parseVisaPickerMeta(kind: string | undefined, value: unknown): VisaPickerCardMeta | null {
  if (kind !== 'visa_picker' || !isRecord(value)) return null
  const { applicationId, state, selectedListingId } = value
  if (typeof applicationId !== 'string' || !applicationId) return null
  if (state !== 'active' && state !== 'done') return null
  return {
    applicationId,
    state,
    selectedListingId: typeof selectedListingId === 'string' && selectedListingId ? selectedListingId : null,
  }
}

/** A `visa_result` card's metaJson — the finished visa, downloadable in the thread. */
export type VisaResultCardMeta = {
  applicationId: string
  documentId: string
  /** The human case number (`EV-1042`), or null when the case predates the column. */
  reference: string | null
}

/**
 * A `visa_result` card's meta, or null. Same discipline as the two above.
 *
 * The reference is re-checked against the canonical shape rather than trusted: it is
 * rendered as text here, but the server also builds a filename out of it, and a client that
 * quietly renders a reference the server would refuse is a mismatch worth not having. A
 * value that fails is dropped, not fatal — the card is still a valid download without it.
 */
export function parseVisaResultMeta(kind: string | undefined, value: unknown): VisaResultCardMeta | null {
  if (kind !== 'visa_result' || !isRecord(value)) return null
  const { applicationId, documentId, reference } = value
  if (typeof applicationId !== 'string' || !applicationId) return null
  if (typeof documentId !== 'string' || !documentId) return null
  return {
    applicationId,
    documentId,
    reference: typeof reference === 'string' && /^EV-[1-9][0-9]{0,17}$/.test(reference) ? reference : null,
  }
}

/**
 * The thread's visa block, or null for an ordinary conversation.
 *
 * Parsed rather than cast: a body whose shape moved must degrade to "this is not a visa
 * thread" (the thread still renders, the cards read as history), never throw during render
 * and take a live chat down with it.
 */
export function parseVisaThreadInfo(value: unknown): VisaThreadInfo | null {
  if (!isRecord(value)) return null
  const applicationId = value.applicationId
  if (typeof applicationId !== 'string' || !applicationId) return null
  const mode = value.mode
  const product = isRecord(value.product) ? value.product : null
  const quote = parseVisaQuoteWire(value.quote)
  return {
    applicationId,
    mode: mode === 'admin' || mode === 'human_requested' ? mode : 'ai',
    product: product && typeof product.listingId === 'string' && typeof product.priceVnd === 'number'
      ? {
        listingId: product.listingId,
        title: typeof product.title === 'string' ? product.title : '',
        speed: typeof product.speed === 'string' && product.speed in VISA_SPEED_SPECS ? (product.speed as VisaSpeedCode) : null,
        entryType: product.entryType === 'single' || product.entryType === 'multiple' ? product.entryType : null,
        priceVnd: product.priceVnd,
        acceptingNow: product.acceptingNow !== false,
        nextOpensIso: typeof product.nextOpensIso === 'string' ? product.nextOpensIso : null,
      }
      : null,
    quote,
    providers: Array.isArray(value.providers)
      ? value.providers.filter((p): p is 'stripe' | 'paypal' => p === 'stripe' || p === 'paypal')
      : [],
  }
}

/** Structural parse of a quote. Liveness is the server's call — this only refuses garbage. */
export function parseVisaQuoteWire(value: unknown): VisaQuoteWire | null {
  if (!isRecord(value)) return null
  const { listingId, priceVnd, amountUsdCents, vndPerUsd, quotedAt, expiresAt } = value
  if (typeof listingId !== 'string' || !listingId.trim()) return null
  if (typeof priceVnd !== 'number' || typeof amountUsdCents !== 'number' || typeof vndPerUsd !== 'number') return null
  if (typeof quotedAt !== 'string' || typeof expiresAt !== 'string') return null
  // The two money fields must be renderable integers, or there is nothing honest to show.
  if (!Number.isSafeInteger(amountUsdCents) || amountUsdCents <= 0) return null
  if (!Number.isSafeInteger(priceVnd) || priceVnd <= 0) return null
  // ⚠️ The breakdown is carried through, not dropped. This rebuilt the quote as a 6-field literal,
  // so the four fee fields the server now sends were silently discarded and the card could only
  // show a total it could not explain. Each is admitted ONLY if it is a sane integer/number —
  // a malformed one degrades to "no breakdown" (the pre-fee copy), never to a wrong sum.
  const cents = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined
  const service = cents((value as Record<string, unknown>).serviceUsdCents)
  const processing = cents((value as Record<string, unknown>).processingUsdCents)
  const feePercentRaw = (value as Record<string, unknown>).feePercent
  const feeFixedRaw = (value as Record<string, unknown>).feeFixedCents
  return {
    listingId: listingId.trim(), priceVnd, amountUsdCents, vndPerUsd, quotedAt, expiresAt,
    // Only expose a breakdown that actually reconciles — if the parts do not sum to the total the
    // card must fall back rather than print two numbers that disagree.
    ...(service !== undefined && processing !== undefined && service + processing === amountUsdCents
      ? { serviceUsdCents: service, processingUsdCents: processing }
      : {}),
    ...(typeof feePercentRaw === 'number' && Number.isFinite(feePercentRaw) ? { feePercent: feePercentRaw } : {}),
    ...(typeof feeFixedRaw === 'number' && Number.isSafeInteger(feeFixedRaw) ? { feeFixedCents: feeFixedRaw } : {}),
  }
}

// ── Copy ──────────────────────────────────────────────────────────────────────────
//
// Bilingual through tr() at render time (CLAUDE.md's i18n rule). None of these strings is
// ever persisted — the PERSISTED inbox lines are the bilingual composites in
// src/lib/visa/dm-steps.ts, which is a different (server) concern.

const STEP_COUNT = 5

const STEP_TITLE: Record<VisaDmStep, [string, string]> = {
  1: ['Your documents', 'Giấy tờ của bạn'],
  2: ['Check your passport details', 'Kiểm tra thông tin hộ chiếu'],
  3: ['About you', 'Thông tin của bạn'],
  4: ['Your trip', 'Chuyến đi của bạn'],
  5: ['Review and pay', 'Kiểm tra và thanh toán'],
}

const STEP_HINT: Record<VisaDmStep, [string, string]> = {
  1: [
    'Send a photo of your passport data page and a portrait photo. We read the passport automatically and fill in what we can.',
    'Gửi ảnh trang thông tin hộ chiếu và ảnh chân dung. Chúng tôi đọc hộ chiếu tự động và điền giúp bạn những gì có thể.',
  ],
  2: [
    'We read these from your passport. Confirm they are right — or correct them.',
    'Chúng tôi đã đọc các thông tin này từ hộ chiếu của bạn. Hãy xác nhận là đúng — hoặc sửa lại.',
  ],
  3: [
    'The details no document can tell us. Common answers are filled in already — open them and change anything that is not true of you.',
    'Những thông tin không giấy tờ nào nói được. Các câu trả lời phổ biến đã được điền sẵn — hãy mở ra và sửa những gì chưa đúng với bạn.',
  ],
  4: [
    'When you are coming and where you will stay. Check the border gates and the dates — they start on the most common answer, not on yours.',
    'Bạn đến khi nào và ở đâu. Hãy kiểm tra cửa khẩu và ngày tháng — chúng bắt đầu bằng lựa chọn phổ biến nhất, không phải của bạn.',
  ],
  5: ['Everything is filled in. Pay to send your application to eno.', 'Đã điền xong. Thanh toán để gửi hồ sơ đến eno.'],
}

/**
 * Payload FIELD NAME → label. The vocabulary a card is allowed to speak: names, never
 * values. Every key here is a real key of visaPayloadSchema (dm-steps.ts owns the
 * per-step allowlists these are drawn from).
 *
 * ⚠️ EVERY field a step renders must have an entry: the fallback below humanises the camelCase
 * key, which reads like debug output on a legal form. visa-cards.test.ts fails the build when a
 * field in VISA_STEP_FORM has no label here.
 */
export const VISA_FIELD_LABEL: Record<string, [string, string]> = {
  surname: ['Surname', 'Họ'],
  givenNames: ['Given and middle names', 'Tên đệm và tên'],
  dateOfBirth: ['Date of birth', 'Ngày sinh'],
  sex: ['Sex', 'Giới tính'],
  nationality: ['Nationality', 'Quốc tịch'],
  identityNumber: ['National ID', 'Số định danh'],
  placeOfBirth: ['Place of birth', 'Nơi sinh'],
  passportNumber: ['Passport number', 'Số hộ chiếu'],
  passportType: ['Passport type', 'Loại hộ chiếu'],
  passportIssuingAuthority: ['Issuing authority', 'Cơ quan cấp'],
  passportIssueDate: ['Passport issue date', 'Ngày cấp hộ chiếu'],
  passportExpiryDate: ['Passport expiry date', 'Ngày hết hạn hộ chiếu'],
  email: ['Email', 'Email'],
  hasOtherNationalities: ['Any other nationality?', 'Có quốc tịch khác?'],
  otherNationalities: ['Other nationalities', 'Quốc tịch khác'],
  usedOtherPassportsForVietnam: ['Used another passport for Vietnam?', 'Đã dùng hộ chiếu khác để nhập cảnh Việt Nam?'],
  usedOtherPassportDetails: ['Previously used passport', 'Hộ chiếu đã dùng trước đây'],
  hasVietnamLawViolation: ['Violated Vietnamese law?', 'Đã vi phạm pháp luật Việt Nam?'],
  vietnamLawViolationDetails: ['Violation details', 'Chi tiết vi phạm'],
  hasOtherPassports: ['Any other valid passport?', 'Có hộ chiếu hợp lệ khác?'],
  otherPassportDetails: ['Other passport details', 'Thông tin hộ chiếu khác'],
  permanentAddress: ['Permanent address', 'Địa chỉ thường trú'],
  phone: ['Telephone number', 'Số điện thoại'],
  emergencyName: ['Emergency contact name', 'Tên người liên hệ khẩn cấp'],
  emergencyRelationship: ['Relationship to you', 'Mối quan hệ với bạn'],
  emergencyAddress: ['Emergency contact address', 'Địa chỉ liên hệ khẩn cấp'],
  emergencyPhone: ['Emergency contact phone', 'Điện thoại liên hệ khẩn cấp'],
  occupation: ['Occupation', 'Nghề nghiệp'],
  employerName: ['Employer or school', 'Cơ quan hoặc trường học'],
  employerAddress: ['Employer address', 'Địa chỉ cơ quan'],
  employerPhone: ['Employer phone', 'Điện thoại cơ quan'],
  religion: ['Religion', 'Tôn giáo'],
  visaValidFrom: ['Visa starts', 'Visa bắt đầu'],
  visaValidTo: ['Visa ends', 'Visa kết thúc'],
  purposeOfEntry: ['Purpose of entry', 'Mục đích nhập cảnh'],
  intendedEntryDate: ['Intended entry date', 'Ngày dự kiến nhập cảnh'],
  stayLengthDays: ['Days of stay', 'Số ngày lưu trú'],
  currentlyOutsideVietnam: ['Are you outside Vietnam now?', 'Bạn đang ở ngoài Việt Nam?'],
  temporaryAddress: ['First address in Vietnam', 'Địa chỉ đầu tiên tại Việt Nam'],
  temporaryProvince: ['Province or city', 'Tỉnh hoặc thành phố'],
  entryGate: ['Entry checkpoint', 'Cửa khẩu nhập cảnh'],
  exitGate: ['Exit checkpoint', 'Cửa khẩu xuất cảnh'],
  visitedVietnamLastYear: ['Visited Vietnam in the last year?', 'Đã đến Việt Nam trong năm qua?'],
  previousVisitDetails: ['Previous visit details', 'Thông tin lần đến trước'],
  hasRelativesInVietnam: ['Relatives in Vietnam?', 'Có người thân tại Việt Nam?'],
  relativesInVietnamDetails: ['Relative details', 'Thông tin người thân'],
  hasTravelInsurance: ['Travel insurance?', 'Có bảo hiểm du lịch?'],
  insuranceDetails: ['Insurance details', 'Thông tin bảo hiểm'],
  payerName: ['Who is paying — name', 'Người chi trả — tên'],
  payerAddress: ['Payer address', 'Địa chỉ người chi trả'],
  payerPhone: ['Payer phone', 'Điện thoại người chi trả'],
  localContactName: ['Contact in Vietnam — name', 'Người liên hệ tại Việt Nam — tên'],
  localContactAddress: ['Contact address', 'Địa chỉ người liên hệ'],
  localContactPhone: ['Contact phone', 'Điện thoại người liên hệ'],
  hasChildrenOnPassport: ['Children on your passport?', 'Có trẻ em đi cùng trong hộ chiếu?'],
  childrenOnPassportDetails: ['Accompanying children', 'Thông tin trẻ em đi cùng'],
  // The rest of the dashboard's trip page — fields the chat card only started rendering
  // when the whole of TripStep was carried across (see VISA_STEP_FORM below).
  entryType: ['Entry type', 'Loại nhập cảnh'],
  temporaryWard: ['Ward or commune', 'Phường hoặc xã'],
  estimatedExpenses: ['Estimated expenses', 'Chi phí dự kiến'],
  expensesCurrency: ['Currency', 'Tiền tệ'],
  expensesPayer: ['Who pays?', 'Ai chi trả?'],
  paymentMethod: ['Payment method', 'Hình thức chi trả'],
  payerDetails: ['More about who pays', 'Thêm về người chi trả'],
  applicantNotes: ['Anything eno should know?', 'Thông tin thêm cho eno?'],
}

const fieldLabel = (name: string, tr: Tr) => {
  const copy = VISA_FIELD_LABEL[name]
  return copy ? tr(copy[0], copy[1]) : name.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/**
 * How a field is asked. `email`/`tel` exist for the keyboard alone — the dashboard passes
 * inputMode/autoComplete per call site for exactly this reason, and this form lives on a phone.
 */
type ControlKind = 'text' | 'long' | 'date' | 'number' | 'email' | 'tel' | 'yesno' | 'sex' | 'choice' | 'checkpoint'

/** One option of a `choice` control: the stored value, then its bilingual label. */
type FieldChoice = readonly [string, readonly [string, string]]

/**
 * Validation ISSUE CODE → the payload field that answers it, and how to ask for it.
 *
 * The codes are exactly the ones dm-steps.ts routes to steps 2–4 (step 1 is documents, and
 * step 5 owns none). The FIELD is what the card writes back through the encrypted path, and
 * it is re-checked against VISA_DM_STEP_FIELDS before anything is sent — so this map can
 * never widen what a step may write.
 *
 * ⚠️ THIS IS NOT THE FORM. It says how to ASK for an outstanding answer; VISA_STEP_FORM below
 * says what a step SHOWS. The gap between the two was the bug: a field carrying a schema
 * default never produces an issue, so an issue-driven form never asked it and the applicant
 * shipped the default (religion "None", every declaration "no", Tan Son Nhat both ways) as if
 * it were their answer. A card renders the FORM; issues only add a warning line to a field.
 */
export const VISA_ISSUE_FIELD: Record<string, { field: string; control: ControlKind; hint?: [string, string] }> = {
  // ── step 2 · confirm passport ──
  surname_required: { field: 'surname', control: 'text' },
  given_names_required: { field: 'givenNames', control: 'text' },
  date_of_birth_required: { field: 'dateOfBirth', control: 'date' },
  sex_required: { field: 'sex', control: 'sex' },
  nationality_required: { field: 'nationality', control: 'text' },
  place_of_birth_required: { field: 'placeOfBirth', control: 'text' },
  passport_number_required: { field: 'passportNumber', control: 'text' },
  passport_authority_required: { field: 'passportIssuingAuthority', control: 'text' },
  passport_issue_date_required: { field: 'passportIssueDate', control: 'date' },
  passport_expiry_date_required: { field: 'passportExpiryDate', control: 'date' },
  passport_dates_invalid: {
    field: 'passportExpiryDate', control: 'date',
    hint: ['Expiry must be after the issue date.', 'Ngày hết hạn phải sau ngày cấp.'],
  },
  email_required: { field: 'email', control: 'text' },
  email_invalid: {
    field: 'email', control: 'text',
    hint: ['Use a working email — the result is sent there.', 'Dùng email đang hoạt động — kết quả sẽ gửi tới đó.'],
  },
  // ── step 3 · about you ──
  other_nationalities_answer_required: { field: 'hasOtherNationalities', control: 'yesno' },
  other_nationalities_details_required: { field: 'otherNationalities', control: 'text' },
  previous_passport_answer_required: { field: 'usedOtherPassportsForVietnam', control: 'yesno' },
  previous_passport_details_required: { field: 'usedOtherPassportDetails', control: 'long' },
  law_violation_answer_required: { field: 'hasVietnamLawViolation', control: 'yesno' },
  law_violation_details_required: { field: 'vietnamLawViolationDetails', control: 'long' },
  other_passports_answer_required: { field: 'hasOtherPassports', control: 'yesno' },
  other_passport_details_required: { field: 'otherPassportDetails', control: 'long' },
  permanent_address_required: { field: 'permanentAddress', control: 'long' },
  phone_required: { field: 'phone', control: 'text' },
  emergency_contact_required: { field: 'emergencyName', control: 'text' },
  emergency_relationship_required: { field: 'emergencyRelationship', control: 'text' },
  emergency_phone_required: { field: 'emergencyPhone', control: 'text' },
  occupation_required: { field: 'occupation', control: 'text' },
  // ── step 4 · your trip ──
  visa_start_required: { field: 'visaValidFrom', control: 'date' },
  visa_end_required: { field: 'visaValidTo', control: 'date' },
  visa_dates_invalid: {
    field: 'visaValidTo', control: 'date',
    hint: ['The end date must be after the start date.', 'Ngày kết thúc phải sau ngày bắt đầu.'],
  },
  visa_period_exceeds_90_days: {
    field: 'visaValidTo', control: 'date',
    hint: ['An e-Visa covers at most 90 days.', 'E-Visa có thời hạn tối đa 90 ngày.'],
  },
  purpose_required: { field: 'purposeOfEntry', control: 'text' },
  entry_date_required: { field: 'intendedEntryDate', control: 'date' },
  stay_length_invalid: { field: 'stayLengthDays', control: 'number', hint: ['Between 1 and 90 days.', 'Từ 1 đến 90 ngày.'] },
  outside_vietnam_answer_required: { field: 'currentlyOutsideVietnam', control: 'yesno' },
  applicant_must_be_outside_vietnam: {
    field: 'currentlyOutsideVietnam', control: 'yesno',
    hint: ['The official form requires you to be outside Vietnam when you apply.', 'Biểu mẫu chính thức yêu cầu bạn đang ở ngoài Việt Nam khi nộp.'],
  },
  vietnam_address_required: { field: 'temporaryAddress', control: 'long' },
  vietnam_province_required: { field: 'temporaryProvince', control: 'text' },
  entry_gate_required: { field: 'entryGate', control: 'text' },
  exit_gate_required: { field: 'exitGate', control: 'text' },
  previous_visits_answer_required: { field: 'visitedVietnamLastYear', control: 'yesno' },
  previous_visit_details_required: { field: 'previousVisitDetails', control: 'long' },
  relatives_answer_required: { field: 'hasRelativesInVietnam', control: 'yesno' },
  relatives_details_required: { field: 'relativesInVietnamDetails', control: 'long' },
  insurance_answer_required: { field: 'hasTravelInsurance', control: 'yesno' },
  insurance_details_required: { field: 'insuranceDetails', control: 'long' },
  payer_name_required: { field: 'payerName', control: 'text' },
  payer_address_required: { field: 'payerAddress', control: 'long' },
  payer_phone_required: { field: 'payerPhone', control: 'text' },
  local_contact_name_required: { field: 'localContactName', control: 'text' },
  local_contact_address_required: { field: 'localContactAddress', control: 'long' },
  local_contact_phone_required: { field: 'localContactPhone', control: 'text' },
  children_on_passport_answer_required: { field: 'hasChildrenOnPassport', control: 'yesno' },
  children_details_required: { field: 'childrenOnPassportDetails', control: 'long' },
}

// ── THE FORM: every step asks its WHOLE field set, not just the gaps ──────────────
//
// A card used to render only what was OUTSTANDING (an issue code → a field). That reads well
// for a passport we already photographed, and it silently loses everything else: a field
// carrying a schema DEFAULT never produces an issue, so it was never asked and the default
// went to the government as if the applicant had chosen it. religion 'None', passportType
// 'ordinary', every declaration 'no', purpose 'Tourism', entryGate/exitGate 'Tan Son Nhat',
// stay 90 days, expenses USD 1,000 paid by card — none of that was ever put to the applicant
// anywhere except the dashboard wizard, and the dashboard wizard is being retired. An e-Visa
// naming the wrong border gate is a refused entry, not a cosmetic miss.
//
// So each step renders its FULL VISA_DM_STEP_FIELDS set, pre-filled from the applicant's own
// case: a default becomes a visible answer they can change, never an unasked question. The
// partition itself is untouched (still five steps, still the same field→step map) and so is
// the validator — a defaulted field is SHOWN, not made blocking (the owner's launch-lenience
// policy). dm-steps.test.ts fences the partition; visa-cards.test.ts fences the coverage.
//
// ⚠️ Mirrors src/app/dashboard/visa/apply-client.tsx → PersonalStep + TripStep, in the
// dashboard's order, with the dashboard's controls (checkpoint pickers, yes/no reveals, date
// bounds). When a payload field is added, add it here — the coverage test fails otherwise.

type FormSection = 'identity' | 'passport' | 'declarations' | 'contact' | 'work' | 'visa' | 'stay' | 'money'

const SECTION_TITLE: Record<FormSection, [string, string]> = {
  identity: ['About you', 'Về bạn'],
  passport: ['Your passport', 'Hộ chiếu của bạn'],
  declarations: ['Declarations', 'Khai báo'],
  contact: ['Contact and emergency', 'Liên hệ và khẩn cấp'],
  work: ['Work', 'Công việc'],
  visa: ['Requested visa', 'Visa yêu cầu'],
  stay: ['Your stay in Vietnam', 'Lưu trú tại Việt Nam'],
  money: ['Expenses and insurance', 'Chi phí và bảo hiểm'],
}

/**
 * Why an answer may stay as it is. Rendered under the label in a QUIET colour — an issue hint
 * is a warning, this is not.
 *  · optional  — the official form accepts a blank here.
 *  · prefilled — the schema already holds a real answer, so the box is never empty and the
 *                applicant must be told it is a suggestion rather than something they said.
 */
type FieldNote = 'optional' | 'prefilled'

const NOTE_COPY: Record<FieldNote, [string, string]> = {
  optional: ['Optional', 'Không bắt buộc'],
  prefilled: ['Prefilled — change it if it is not right', 'Đã điền sẵn — hãy sửa nếu chưa đúng'],
}

export type VisaFormField = {
  field: string
  control: ControlKind
  section: FormSection
  /** Fixed choices, or choices that depend on another answer (see paymentMethod). */
  options?: readonly FieldChoice[] | ((draft: Record<string, string>) => readonly FieldChoice[])
  /** A standing explanation of the field itself (issue hints are merged in on top). */
  hint?: [string, string]
  note?: FieldNote
  /**
   * ⚠️ ONLY where the mapping is exact AND the value is the APPLICANT'S OWN — the same rule
   * apply-client.tsx documents. Never on the emergency / employer / local-contact / payer
   * numbers: those are somebody else's, and tagging them `tel` invites the browser to offer
   * the applicant's own.
   */
  autoComplete?: string
  /**
   * Rendered only when the DRAFT satisfies this — the dashboard's conditional follow-ups,
   * which appear the moment the answer flips rather than after a server round trip.
   */
  when?: (draft: Record<string, string>) => boolean
}

const answeredYes = (field: string) => (draft: Record<string, string>) => draft[field] === 'yes'

const YES_NO: readonly FieldChoice[] = [['yes', ['Yes', 'Có']], ['no', ['No', 'Không']]]

const PAYMENT_METHODS: readonly FieldChoice[] = [
  ['credit_card', ['Credit card', 'Thẻ tín dụng']],
  ['cash', ['Cash', 'Tiền mặt']],
  ['travellers_cheques', ['Traveller’s cheques', 'Séc du lịch']],
]

const PASSPORT_TYPES: readonly FieldChoice[] = [
  ['ordinary', ['Ordinary', 'Phổ thông']],
  ['official', ['Official', 'Công vụ']],
  ['diplomatic', ['Diplomatic', 'Ngoại giao']],
  ['other', ['Other', 'Khác']],
]

/** Only if somebody in Vietnam is inviting or hosting — but then all three are needed. */
const LOCAL_CONTACT_HINT: [string, string] = [
  'Only if someone in Vietnam is inviting or hosting you. Fill all three, or leave all three blank.',
  'Chỉ khi có người tại Việt Nam mời hoặc đón bạn. Điền cả ba mục, hoặc để trống cả ba.',
]

/**
 * ⚠️ THE ONE FIELD LIST THE CHAT RENDERS. Every entry must be a field the step OWNS
 * (VISA_DM_STEP_FIELDS) — the server refuses anything else, and visa-cards.test.ts proves
 * the two agree in BOTH directions: nothing writable is unasked, nothing asked is unwritable.
 *
 * Steps 1 and 5 are empty on purpose. Step 1 is the two uploads (the payload field it owns,
 * aiDocumentProcessingConsent, is stamped by the upload route itself — there is no question
 * to ask), step 5 is consent + payment and owns no payload field at all.
 */
export const VISA_STEP_FORM: Record<VisaDmStep, readonly VisaFormField[]> = {
  1: [],
  // ── 2 · confirm what we read off the passport ──
  2: [
    { field: 'surname', control: 'text', section: 'identity' },
    { field: 'givenNames', control: 'text', section: 'identity' },
    { field: 'dateOfBirth', control: 'date', section: 'identity' },
    { field: 'sex', control: 'sex', section: 'identity' },
    { field: 'nationality', control: 'text', section: 'identity' },
    { field: 'placeOfBirth', control: 'text', section: 'identity' },
    { field: 'identityNumber', control: 'text', section: 'identity', note: 'optional' },
    {
      field: 'email', control: 'email', section: 'identity', autoComplete: 'email',
      hint: ['The result is sent here.', 'Kết quả sẽ được gửi tới đây.'],
    },
    { field: 'passportNumber', control: 'text', section: 'passport' },
    { field: 'passportType', control: 'choice', section: 'passport', options: PASSPORT_TYPES, note: 'prefilled' },
    { field: 'passportIssuingAuthority', control: 'text', section: 'passport' },
    { field: 'passportIssueDate', control: 'date', section: 'passport' },
    { field: 'passportExpiryDate', control: 'date', section: 'passport' },
  ],
  // ── 3 · the rest of the applicant: declarations, home, next of kin, work ──
  3: [
    { field: 'hasOtherNationalities', control: 'yesno', section: 'declarations' },
    { field: 'otherNationalities', control: 'text', section: 'declarations', when: answeredYes('hasOtherNationalities') },
    { field: 'hasOtherPassports', control: 'yesno', section: 'declarations' },
    { field: 'otherPassportDetails', control: 'long', section: 'declarations', when: answeredYes('hasOtherPassports') },
    { field: 'usedOtherPassportsForVietnam', control: 'yesno', section: 'declarations' },
    { field: 'usedOtherPassportDetails', control: 'long', section: 'declarations', when: answeredYes('usedOtherPassportsForVietnam') },
    { field: 'hasVietnamLawViolation', control: 'yesno', section: 'declarations' },
    { field: 'vietnamLawViolationDetails', control: 'long', section: 'declarations', when: answeredYes('hasVietnamLawViolation') },
    { field: 'religion', control: 'text', section: 'declarations', note: 'prefilled' },
    { field: 'permanentAddress', control: 'long', section: 'contact' },
    { field: 'phone', control: 'tel', section: 'contact', autoComplete: 'tel' },
    { field: 'emergencyName', control: 'text', section: 'contact' },
    { field: 'emergencyRelationship', control: 'text', section: 'contact' },
    { field: 'emergencyPhone', control: 'tel', section: 'contact' },
    { field: 'emergencyAddress', control: 'long', section: 'contact', note: 'optional' },
    { field: 'occupation', control: 'text', section: 'work' },
    { field: 'employerName', control: 'text', section: 'work', note: 'optional' },
    { field: 'employerAddress', control: 'long', section: 'work', note: 'optional' },
    { field: 'employerPhone', control: 'tel', section: 'work', note: 'optional' },
  ],
  // ── 4 · the trip ──
  4: [
    {
      field: 'entryType', control: 'choice', section: 'visa', note: 'prefilled',
      options: [['single', ['Single entry', 'Nhập cảnh một lần']], ['multiple', ['Multiple entry', 'Nhập cảnh nhiều lần']]],
    },
    {
      field: 'visaValidFrom', control: 'date', section: 'visa',
      hint: ['Pick this first — the end date, entry date and length of stay fill in automatically.', 'Chọn ngày này trước — ngày kết thúc, ngày nhập cảnh và số ngày lưu trú sẽ tự điền.'],
    },
    {
      field: 'visaValidTo', control: 'date', section: 'visa',
      hint: [`Filled automatically: an e-Visa covers at most ${MAX_EVISA_VALIDITY_DAYS} days.`, `Tự động điền: E-Visa có thời hạn tối đa ${MAX_EVISA_VALIDITY_DAYS} ngày.`],
    },
    { field: 'purposeOfEntry', control: 'text', section: 'stay', note: 'prefilled' },
    { field: 'currentlyOutsideVietnam', control: 'yesno', section: 'stay' },
    { field: 'intendedEntryDate', control: 'date', section: 'stay' },
    { field: 'stayLengthDays', control: 'number', section: 'stay', note: 'prefilled' },
    { field: 'temporaryAddress', control: 'long', section: 'stay' },
    { field: 'temporaryProvince', control: 'text', section: 'stay' },
    { field: 'temporaryWard', control: 'text', section: 'stay', note: 'optional' },
    { field: 'entryGate', control: 'checkpoint', section: 'stay', note: 'prefilled' },
    { field: 'exitGate', control: 'checkpoint', section: 'stay', note: 'prefilled' },
    { field: 'localContactName', control: 'text', section: 'stay', note: 'optional', hint: LOCAL_CONTACT_HINT },
    { field: 'localContactAddress', control: 'long', section: 'stay', note: 'optional' },
    { field: 'localContactPhone', control: 'tel', section: 'stay', note: 'optional' },
    { field: 'visitedVietnamLastYear', control: 'yesno', section: 'stay' },
    { field: 'previousVisitDetails', control: 'long', section: 'stay', when: answeredYes('visitedVietnamLastYear') },
    { field: 'hasRelativesInVietnam', control: 'yesno', section: 'stay' },
    { field: 'relativesInVietnamDetails', control: 'long', section: 'stay', when: answeredYes('hasRelativesInVietnam') },
    { field: 'hasChildrenOnPassport', control: 'yesno', section: 'stay' },
    { field: 'childrenOnPassportDetails', control: 'long', section: 'stay', when: answeredYes('hasChildrenOnPassport') },
    { field: 'estimatedExpenses', control: 'number', section: 'money', note: 'prefilled' },
    { field: 'expensesCurrency', control: 'text', section: 'money', note: 'prefilled' },
    {
      field: 'expensesPayer', control: 'choice', section: 'money', note: 'prefilled',
      options: [['self', ['I pay', 'Tôi tự chi trả']], ['organization', ['An organization', 'Một tổ chức']], ['other', ['Someone else', 'Người khác']]],
    },
    {
      field: 'paymentMethod', control: 'choice', section: 'money', note: 'prefilled',
      // Traveller's cheques are only the applicant's OWN instrument — the dashboard drops the
      // option the moment somebody else is paying, and applyVisaDraftEdit moves the answer off
      // it at the same time, so the select can never hold a choice it no longer lists.
      options: (draft) => draft.expensesPayer === 'self' ? PAYMENT_METHODS : PAYMENT_METHODS.filter(([value]) => value !== 'travellers_cheques'),
    },
    { field: 'payerName', control: 'text', section: 'money', when: (draft) => draft.expensesPayer !== 'self' },
    { field: 'payerAddress', control: 'long', section: 'money', when: (draft) => draft.expensesPayer !== 'self' },
    { field: 'payerPhone', control: 'tel', section: 'money', when: (draft) => draft.expensesPayer !== 'self' },
    {
      field: 'payerDetails', control: 'long', section: 'money', note: 'optional',
      when: (draft) => draft.expensesPayer !== 'self',
      hint: ['Anything else about the person or organization paying.', 'Thông tin thêm về người hoặc tổ chức chi trả.'],
    },
    { field: 'hasTravelInsurance', control: 'yesno', section: 'money' },
    { field: 'insuranceDetails', control: 'long', section: 'money', when: answeredYes('hasTravelInsurance') },
    { field: 'applicantNotes', control: 'long', section: 'money', note: 'optional' },
  ],
  5: [],
}

/**
 * The fields this step shows for THIS draft — the whole set minus the follow-ups whose answer
 * has not been given yet. The card renders exactly this; visa-cards.test.ts drives it with
 * every combination of the step's own visible answers to prove no owned field is unreachable.
 */
export function visaStepFormFields(step: VisaDmStep, draft: Record<string, string>): readonly VisaFormField[] {
  return (VISA_STEP_FORM[step] ?? []).filter((entry) => !entry.when || entry.when(draft))
}

/**
 * Numeric fields and their schema bounds — the same clamp the dashboard applies inline.
 * Kept next to the form so a field can never be rendered as a number without one.
 */
const NUMBER_BOUNDS: Record<string, { min: number; max: number }> = {
  stayLengthDays: { min: 0, max: MAX_EVISA_VALIDITY_DAYS },
  estimatedExpenses: { min: 0, max: 1_000_000_000 },
}

/**
 * ONE EDIT INTO THE DRAFT, PLUS EVERYTHING IT IMPLIES.
 *
 * ⚠️ THE 90-DAY WINDOW IS NOT DEFINED HERE. visaDateDefaultsForStart and
 * visaEndDateFor90DayWindow (src/lib/visa/schema.ts) are the single definition of "what a
 * start date implies", and the dashboard's TripStep calls exactly the same two functions.
 * Two implementations WOULD drift, and a drifted visa window is a rejected application —
 * so this function must never grow its own arithmetic over dates.
 *
 * Pure and exported so the cascade is testable without a DOM: visa-cards.test.ts fails the
 * build the moment picking a start date stops filling the other three fields.
 */
export function applyVisaDraftEdit(
  draft: Record<string, string>,
  field: string,
  value: string,
): Record<string, string> {
  const next = { ...draft, [field]: value }

  if (field === 'visaValidFrom') {
    // The dashboard's setVisaStart, verbatim in behaviour: clearing the start clears the
    // window it implied, and only a real date rewrites the length of stay.
    const defaults = visaDateDefaultsForStart(value)
    next.visaValidFrom = defaults.visaValidFrom
    next.visaValidTo = defaults.visaValidTo
    next.intendedEntryDate = defaults.intendedEntryDate
    if (value) next.stayLengthDays = String(defaults.stayLengthDays)
    return next
  }

  if (field === 'intendedEntryDate') {
    // The dashboard's setEntryDate: an applicant who reaches for "when am I flying in"
    // first still ends up with a valid window, back-filled from that date.
    if (value && !draft.visaValidFrom) {
      next.visaValidFrom = value
      next.visaValidTo = visaEndDateFor90DayWindow(value)
    }
    return next
  }

  // The dashboard's payer select does this inline: traveller's cheques are only offered to
  // an applicant paying their own way, so a switch away from "I pay" cannot leave the form
  // holding a method the select no longer lists.
  if (field === 'expensesPayer' && value !== 'self' && draft.paymentMethod === 'travellers_cheques') {
    next.paymentMethod = 'credit_card'
    return next
  }

  const bounds = NUMBER_BOUNDS[field]
  if (bounds) {
    // Empty stays empty so the box can be cleared and retyped; anything else is clamped to
    // the schema's own range (the dashboard clamps identically on every keystroke).
    if (!value.trim()) return next
    const parsed = Number(value)
    next[field] = Number.isFinite(parsed)
      ? String(Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed))))
      : (draft[field] ?? '')
    return next
  }

  return next
}

/**
 * The min/max a date control carries, so a date outside the legal window cannot be typed.
 * Same bounds as the dashboard's TripStep, read off the DRAFT (not the saved case) — the
 * applicant is editing all four dates in one pass and the bounds must move with them.
 */
export function visaDateBounds(field: string, draft: Record<string, string>): { min?: string; max?: string } {
  if (field === 'visaValidTo') {
    const from = draft.visaValidFrom || ''
    return { min: from || undefined, max: visaEndDateFor90DayWindow(from) || undefined }
  }
  if (field === 'intendedEntryDate') {
    return { min: draft.visaValidFrom || undefined, max: draft.visaValidTo || undefined }
  }
  // The passport pair, from the validator's own rule (issue >= expiry ⇒ passport_dates_invalid).
  // Deliberately no arithmetic: the picker refuses everything BEFORE the other date, and the
  // one remaining case — the two dates equal — is left to the validator, which already says so
  // in the applicant's words rather than being silently un-pickable.
  if (field === 'passportExpiryDate') return { min: draft.passportIssueDate || undefined }
  if (field === 'passportIssueDate') return { max: draft.passportExpiryDate || undefined }
  return {}
}

/**
 * A draft value as the act route wants it. Only the numeric fields need anything: an empty
 * box means "none", which the payload schema spells 0 — the dashboard's own Number('') → 0.
 */
export function visaSubmitValue(field: string, value: string): string {
  if (NUMBER_BOUNDS[field] && !value.trim()) return '0'
  return value
}

/** The two document issues step 1 owns, in the applicant's words. */
const DOC_ISSUE_COPY: Record<string, [string, string]> = {
  passport_image_required: ['Send your passport data page.', 'Gửi trang thông tin hộ chiếu.'],
  passport_image_not_verified: ['The passport photo still has to pass the check.', 'Ảnh hộ chiếu vẫn cần vượt qua bước kiểm tra.'],
  portrait_required: ['Send your portrait photo.', 'Gửi ảnh chân dung.'],
  portrait_image_not_verified: ['The portrait still has to pass the check.', 'Ảnh chân dung vẫn cần vượt qua bước kiểm tra.'],
}

/** Why an uploaded image was refused. Same wording as the dashboard wizard. */
const IMAGE_ISSUE_COPY: Record<string, [string, string]> = {
  not_passport_biodata_page: ['Use the passport biodata page.', 'Hãy dùng trang thông tin hộ chiếu.'],
  use_one_passport_data_page: ['Show one passport page only.', 'Chỉ hiển thị một trang hộ chiếu.'],
  passport_image_blurry: ['Retake the passport photo in sharp focus.', 'Chụp lại hộ chiếu rõ nét.'],
  passport_image_has_glare: ['Move away from glare or reflections.', 'Tránh ánh chói hoặc phản chiếu.'],
  passport_page_cropped: ['Include the complete passport page.', 'Chụp đầy đủ toàn bộ trang hộ chiếu.'],
  passport_corners_missing: ['Keep all four passport corners visible.', 'Giữ đủ bốn góc hộ chiếu trong ảnh.'],
  passport_text_unreadable: ['Move closer so every printed field is readable.', 'Chụp gần hơn để đọc được mọi trường.'],
  passport_mrz_unreadable: ['Make both machine-readable lines at the bottom sharp.', 'Làm rõ hai dòng mã máy đọc ở cuối trang.'],
  passport_mrz_check_failed: ['Retake the page so passport numbers can be verified.', 'Chụp lại để có thể xác minh số hộ chiếu.'],
  // ⚠️ THE OLD TEXT ASKED FOR TWO THINGS WE CANNOT USE. "Recent" is unjudgeable — the extract
  // prompt explicitly forbids the model claiming a photo is recent — and "4×6" is already done for
  // the applicant, since normalizeVisaImage pads every portrait to 800×1200. So the one message
  // shown for the broadest blocking check named neither of the things that actually trip it. This
  // is the code that fired on BOTH attempts of the only real applicant, who then abandoned.
  not_compliant_portrait: ['This needs to be a photo of your face — not a screenshot, a document, or a full-length shot.', 'Cần là ảnh chụp khuôn mặt của bạn — không phải ảnh chụp màn hình, giấy tờ hay ảnh toàn thân.'],
  portrait_must_show_one_person: ['The portrait must show one person only.', 'Ảnh chỉ được có một người.'],
  portrait_image_blurry: ['Use a sharper portrait.', 'Dùng ảnh chân dung rõ nét hơn.'],
  face_must_look_straight: ['Look straight at the camera.', 'Nhìn thẳng vào máy ảnh.'],
  remove_hat: ['Remove the hat or head covering.', 'Bỏ mũ hoặc vật che đầu.'],
  remove_glasses: ['Remove glasses.', 'Bỏ kính.'],
  // ⚠️ THESE FOUR ARE WARNINGS NOW, NOT REFUSALS (image-quality.ts, owner 2026-07-29), so they are
  // phrased as advice rather than orders. They render in amber under the red blocking list and the
  // applicant can continue past them — the copy must not imply the upload was rejected, or the
  // amber list reads as a second wall and undoes the demotion.
  wear_formal_clothes: ['Neat clothing is preferred — avoid a uniform or camouflage.', 'Nên mặc trang phục gọn gàng — tránh đồng phục hoặc quần áo rằn ri.'],
  use_plain_white_background: ['A plainer, lighter background would be safer.', 'Nền trơn và sáng hơn sẽ an toàn hơn.'],
  center_face_in_photo: ['Your face sits off-centre — usually fine, but centred is safer.', 'Khuôn mặt hơi lệch — thường không sao, nhưng ở giữa thì an toàn hơn.'],
  show_head_and_shoulders: ['Show the full head and shoulders.', 'Hiển thị đầy đủ đầu và vai.'],
  portrait_lighting_uneven: ['The light is uneven — softer, flatter light is safer.', 'Ánh sáng chưa đều — ánh sáng dịu và đều hơn sẽ an toàn hơn.'],
  automatic_image_check_busy: ['Your image is saved. The checker is busy — try again in about a minute.', 'Ảnh đã được lưu. Hệ thống kiểm tra đang bận — thử lại sau khoảng một phút.'],
  automatic_image_check_rate_limited: ['Checking paused after too many attempts. Your image is saved.', 'Kiểm tra tạm dừng do quá nhiều lần thử. Ảnh của bạn đã được lưu.'],
  automatic_image_check_failed: ['Automatic checking failed. Try this image again.', 'Kiểm tra tự động thất bại. Hãy thử lại ảnh này.'],
}

/**
 * The issue codes that describe OUR checker failing, as opposed to something about the applicant's
 * photo. Exactly the three the extract route can write alongside `validation_status: 'unavailable'`.
 *
 * ⚠️ USED TO DECIDE WHETHER THE GENERIC OUTAGE LINE IS STILL NEEDED. An `unavailable` document can
 * carry a STALE report from an earlier failed run — the `getGemini()`-is-null path updates the
 * status column without touching the report — so "are there issues?" is the wrong question and
 * "is an outage already explained?" is the right one. Getting that backwards tells an applicant to
 * fix a photo when the check never ran.
 */
const OUTAGE_ISSUE_CODES = new Set([
  'automatic_image_check_busy',
  'automatic_image_check_rate_limited',
  'automatic_image_check_failed',
])

/**
 * Every refusal these cards can surface, in the applicant's words. The generic tail is a
 * humanised code — the same fallback the dashboard wizard uses, and better than a blank
 * toast when a new server code lands before its copy does.
 */
const ERROR_COPY: Record<string, [string, string]> = {
  auth_required: ['Please sign in again.', 'Vui lòng đăng nhập lại.'],
  not_your_card: ['That step belongs to another conversation.', 'Bước đó thuộc về cuộc trò chuyện khác.'],
  card_superseded: ['This step is out of date — scroll down for the current one.', 'Bước này đã cũ — hãy kéo xuống bước hiện tại.'],
  application_cancelled: ['This application was cancelled.', 'Hồ sơ này đã bị hủy.'],
  application_locked: ['This application is with eno now and can no longer be edited.', 'Hồ sơ đang ở chỗ eno và không thể chỉnh sửa nữa.'],
  application_changed_retry: ['Something else updated this application. Please try again.', 'Hồ sơ vừa được cập nhật ở nơi khác. Vui lòng thử lại.'],
  invalid_fields: ['Please check the highlighted answers.', 'Vui lòng kiểm tra lại các câu trả lời được đánh dấu.'],
  field_not_in_step: ['That answer belongs to another step.', 'Câu trả lời đó thuộc bước khác.'],
  rate_limited: ['Too many attempts — please try again shortly.', 'Quá nhiều lần thử — vui lòng thử lại sau.'],
  // The re-send chip's own refusals. `too_many` is deliberately its own sentence rather than
  // rate_limited's: this one is not "you did something wrong", it is "that card is already in
  // the chat a few times over", and it must say so without sounding like a failure.
  too_many: ['That form has just been sent a few times — please wait a moment before sending it again.', 'Biểu mẫu vừa được gửi lại vài lần — vui lòng chờ một chút rồi gửi tiếp.'],
  admin_takeover: ['A specialist is handling this chat, so the guided form is paused. End the takeover to send it again.', 'Chuyên viên đang phụ trách cuộc trò chuyện này nên biểu mẫu tự động đang tạm dừng. Kết thúc tiếp nhận để gửi lại.'],
  not_a_participant: ['That conversation is not yours.', 'Cuộc trò chuyện đó không phải của bạn.'],
  no_thread: ['This chat is not linked to an application yet.', 'Cuộc trò chuyện này chưa được liên kết với hồ sơ nào.'],
  not_found: ['We could not find that application.', 'Không tìm thấy hồ sơ đó.'],
  // The result download. `result_not_ready` is the ordinary "the desk has not sent it yet"
  // answer, not a failure — the card only exists once it has, so seeing this means the
  // document row was removed by hand (the one recovery path from a wrong upload).
  result_not_ready: ['Your visa is not ready to download yet.', 'Thị thực của bạn chưa sẵn sàng để tải về.'],
  result_unavailable: ['The file could not be opened just now. Please try again.', 'Chưa mở được tệp lúc này. Vui lòng thử lại.'],
  visa_database_unavailable: ['We could not reach your application just now. Please try again.', 'Chưa truy cập được hồ sơ của bạn lúc này. Vui lòng thử lại.'],
  shop_unavailable: ['The e-Visa desk is unavailable right now.', 'Bộ phận E-Visa hiện không khả dụng.'],
  internal_error: ['Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.'],
  thread_not_bound: ['This chat is not linked to an application yet.', 'Cuộc trò chuyện này chưa được liên kết với hồ sơ nào.'],
  thread_conflict: ['This application belongs to another chat.', 'Hồ sơ này thuộc về cuộc trò chuyện khác.'],
  product_not_selected: ['Choose an e-Visa service first.', 'Hãy chọn dịch vụ E-Visa trước.'],
  product_not_configured: ['That service is still being set up. Ask us for help.', 'Dịch vụ đó vẫn đang được thiết lập. Hãy nhờ chúng tôi hỗ trợ.'],
  product_not_for_sale: ['That service is not on sale right now.', 'Dịch vụ đó hiện không được bán.'],
  product_price_unavailable: ['That service has no usable price right now.', 'Dịch vụ đó hiện chưa có giá hợp lệ.'],
  product_entry_type_mismatch: ['The service you picked does not match the entry type on your form.', 'Dịch vụ bạn chọn không khớp với loại nhập cảnh trên hồ sơ.'],
  // The client's confirmation token no longer matches the case's canonical selection —
  // almost always a stale tab. A reload re-reads the canonical product and heals it.
  listing_selection_mismatch: ['Your selection changed in another tab. Reload and try again.', 'Lựa chọn của bạn đã thay đổi ở thẻ khác. Hãy tải lại và thử lại.'],
  // A forum-era case ciphered under the previous key — readable nowhere on this host.
  payload_unreadable: ['This application was filed under an older system and cannot be opened here. Start a new one in chat, or ask the desk.', 'Hồ sơ này được tạo trên hệ thống cũ nên không mở được tại đây. Hãy bắt đầu hồ sơ mới trong chat hoặc hỏi bộ phận hỗ trợ.'],
  submission_window_closed: ['The desk has closed for this speed today.', 'Hôm nay đã hết giờ nhận hồ sơ cho tốc độ này.'],
  payments_not_configured: ['Paying in chat is not switched on yet.', 'Thanh toán trong tin nhắn chưa được bật.'],
  fx_unavailable: ['The US dollar amount could not be worked out just now. Nothing has been charged — try again in a moment.', 'Hiện chưa tính được số tiền đô la Mỹ. Chưa có khoản nào bị trừ — vui lòng thử lại sau giây lát.'],
  quote_changed: ['The price just changed. Check the new amount and try again.', 'Giá vừa thay đổi. Hãy kiểm tra số tiền mới và thử lại.'],
  quote_expired: ['That price has expired. Check the new amount and try again.', 'Giá đó đã hết hạn. Hãy kiểm tra số tiền mới và thử lại.'],
  already_paid: ['This application is already paid.', 'Hồ sơ này đã được thanh toán.'],
  application_incomplete: ['Something earlier still needs an answer.', 'Vẫn còn phần trước đó cần trả lời.'],
  checkout_failed: ['Checkout could not be opened. Nothing has been charged.', 'Không mở được thanh toán. Chưa có khoản nào bị trừ.'],
  step_card_refused: ['We could not post the next step. Please try again.', 'Chưa gửi được bước tiếp theo. Vui lòng thử lại.'],
  checkout_card_refused: ['We could not post the payment step. Please try again.', 'Chưa gửi được bước thanh toán. Vui lòng thử lại.'],
  visa_encryption_not_configured: ['e-Visa assistance is not switched on for this site yet.', 'Dịch vụ hỗ trợ E-Visa chưa được bật trên trang này.'],
  visa_schema_not_ready: ['e-Visa assistance is not ready yet.', 'Dịch vụ hỗ trợ E-Visa chưa sẵn sàng.'],
  image_size_invalid: ['Use an image smaller than 15 MB.', 'Dùng ảnh nhỏ hơn 15 MB.'],
  large_image_could_not_be_prepared: ['That image could not be resized here. Export it as a JPG and try again.', 'Không thể thu nhỏ ảnh này. Hãy xuất ảnh thành JPG rồi thử lại.'],
  network: ['No connection — please try again.', 'Mất kết nối — vui lòng thử lại.'],
  unsupported_image_type: ['Use JPG, PNG, WebP, HEIC or HEIF.', 'Dùng JPG, PNG, WebP, HEIC hoặc HEIF.'],
  image_decode_failed: ['That image is damaged or unreadable.', 'Ảnh bị hỏng hoặc không đọc được.'],
  portrait_resolution_too_low: ['The portrait is too small — at least 480×600 pixels.', 'Ảnh chân dung quá nhỏ — ít nhất 480×600 pixel.'],
  passport_resolution_too_low: ['The passport image is too small — at least 900×600 pixels.', 'Ảnh hộ chiếu quá nhỏ — ít nhất 900×600 pixel.'],
  image_official_limit_failed: ['The image could not be reduced below the official 2 MB limit.', 'Không thể giảm ảnh xuống dưới giới hạn 2 MB.'],
  image_analysis_busy: ['The checker is busy. Your image is saved — try again in about a minute.', 'Hệ thống kiểm tra đang bận. Ảnh đã lưu — thử lại sau khoảng một phút.'],
  image_analysis_rate_limited: ['Checking paused after too many attempts. Your image is saved.', 'Kiểm tra tạm dừng do quá nhiều lần thử. Ảnh của bạn đã được lưu.'],
  image_analysis_failed: ['Automatic checking failed. Try the image again.', 'Kiểm tra tự động thất bại. Hãy thử lại ảnh.'],
  ai_unavailable: ['Automatic checking is unavailable right now.', 'Kiểm tra tự động hiện không khả dụng.'],
}

type Tr = (en: string, vi: string) => string

/** One refusal code → one sentence. Never echoes a value; codes only. */
export function visaErrorCopy(code: string | undefined, tr: Tr): string {
  const copy = code ? ERROR_COPY[code] : undefined
  if (copy) return tr(copy[0], copy[1])
  if (!code) return tr('Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.')
  return code.replaceAll('_', ' ')
}

/**
 * THE TWO UPLOAD TOASTS THE CHAT THREAD SHOWS WHILE A DOCUMENT IS BEING READ.
 *
 * ⚠️ THEY LIVE HERE RATHER THAN AT THE CALL SITE FOR ARTIFACT REASONS, NOT TIDINESS. These were
 * inline `tr()` literals in src/app/messages/[id]/page.tsx — a file BOTH editions compile, because
 * the chat page is the marketplace's most-used surface. Measured on a clean marketplace build
 * 2026-08-01: "Đang đọc hộ chiếu…" and "Đã đọc hộ chiếu…" were in eno.vn's client chunk with the
 * upload path unreachable (the visa routes do not exist and the desk's threads 404). Nothing
 * rendered them; they were simply in the bundle, which is the standard the edition split is held to
 * because it is the one a grep can check. next.config.ts aliases THIS module away on a marketplace
 * build, so behind the boundary the words are absent.
 *
 * ⚠️ THE WHOLE TERNARY MOVED, not just the passport half. Splitting it would have left "Checking the
 * portrait…" in the shared file for no reason and made the two branches drift apart.
 */
export function visaDocToastCopy(kind: 'passport' | 'portrait', phase: 'reading' | 'read', tr: Tr): string {
  if (phase === 'reading') {
    return kind === 'passport'
      ? tr('Reading your passport…', 'Đang đọc hộ chiếu…')
      : tr('Checking the portrait…', 'Đang kiểm tra ảnh chân dung…')
  }
  return kind === 'passport'
    ? tr('Passport read. Check the details below.', 'Đã đọc hộ chiếu. Hãy kiểm tra thông tin bên dưới.')
    : tr('Portrait accepted.', 'Đã nhận ảnh chân dung.')
}

/**
 * The inert bubble a visa card degrades to when this build cannot read its `meta`.
 *
 * ⚠️ IT MUST RETURN A NON-EMPTY SENTENCE ON BOTH EDITIONS. A card message's BODY is empty by design
 * — the payload is the meta — so a card the renderer cannot parse must not fall through to a blank
 * bubble. That is why the marketplace stub answers with a neutral sentence rather than `''`: the two
 * deployments share one database, so a thread can hold a card written by the other edition, and
 * "degrade, never crash" applies to the empty-looking case too.
 *
 * ⚠️ AND THAT IS ALSO WHY THE SENTENCE IS HERE. Inline in the chat page, "This e-Visa step could not
 * be shown here — open the full form to continue." shipped in 2 of eno.vn's client chunks (measured
 * 2026-08-01). The alias is what removes it; the stub supplies the edition's own wording, which
 * names no service the licensed marketplace may not offer.
 */
export function visaCardFallbackCopy(tr: Tr): string {
  return tr(
    'This e-Visa step could not be shown here — open the full form to continue.',
    'Không hiển thị được bước E-Visa này — hãy mở biểu mẫu đầy đủ để tiếp tục.',
  )
}

/** The rate the quote was issued at, as đồng per one dollar. Evidence, not a computation. */
const rateLabel = (quote: VisaQuoteWire, locale: ReturnType<typeof moneyLocale>) =>
  formatMoneyFull(Math.round(quote.vndPerUsd), '₫', locale)

const imageIssueCopy = (code: string, tr: Tr) => {
  const copy = IMAGE_ISSUE_COPY[code]
  return copy ? tr(copy[0], copy[1]) : code.replaceAll('_', ' ')
}

// ── Getting a phone photo to the desk ─────────────────────────────────────────────

/** Beyond this the image is re-encoded in the browser before it is POSTed. */
const MAX_BROWSER_IMAGE_BYTES = 3_700_000
/** The documents route's own ceiling — refuse locally rather than upload 20 MB to a 400. */
const MAX_INTAKE_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * A phone photo, shrunk to something the upload route will take.
 *
 * ⚠️ MIRRORS prepareImageForUpload in src/app/dashboard/visa/apply-client.tsx, which is
 * module-private there. The two must stay in step (same ceilings, same JPEG ladder) — the
 * right fix is to lift ONE copy into src/lib/visa/, which is a change outside this task's
 * file set. Purely local: nothing here uploads, and the image never leaves the browser until
 * the caller POSTs it to the documents endpoint.
 *
 * Throws a CODE (never a value): the caller renders it through visaErrorCopy.
 */
export async function prepareVisaImage(file: File): Promise<File> {
  if (file.size > MAX_INTAKE_IMAGE_BYTES) throw new Error('image_size_invalid')
  if (file.size <= MAX_BROWSER_IMAGE_BYTES) return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('large_image_could_not_be_prepared') }
  try {
    let scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height))
    let quality = 0.9
    for (let attempt = 0; attempt < 9; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('large_image_could_not_be_prepared')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) throw new Error('large_image_could_not_be_prepared')
      if (blob.size <= MAX_BROWSER_IMAGE_BYTES) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'visa-image'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
      }
      if (quality > 0.66) quality -= 0.08
      else { quality = 0.82; scale *= 0.8 }
    }
    throw new Error('large_image_could_not_be_prepared')
  } finally {
    bitmap.close()
  }
}

// ── The applicant's own case ──────────────────────────────────────────────────────

/**
 * Load the case this thread is bound to — the applicant's OWN, scoped by user_id on the
 * server, so the desk's session simply gets a 404 and the cards render value-free.
 *
 * `enabled` is the buyer test from the thread: the visa desk never fetches this.
 */
export function useVisaCase(applicationId: string | null, enabled: boolean) {
  const [kase, setKase] = useState<VisaCase | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  // Latest-wins: an upload and a card action can both refresh, and the older response must
  // not overwrite the newer one.
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!applicationId || !enabled) return
    const ticket = ++seq.current
    setLoading(true)
    try {
      const res = await fetch(`/api/visa/applications/${applicationId}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { application?: unknown; error?: string } | null
      if (ticket !== seq.current) return
      if (!res.ok) {
        // 404 is the ordinary answer for the DESK looking at an applicant's thread — not an
        // error state, just no values to render.
        setUnavailable(res.status === 404 || res.status === 403 ? null : body?.error || 'internal_error')
        setKase(null)
        return
      }
      const application = isRecord(body?.application) ? body.application : null
      if (!application || !isRecord(application.payload)) { setKase(null); return }
      setUnavailable(null)
      setKase({
        id: String(application.id || applicationId),
        status: typeof application.status === 'string' ? application.status : 'draft',
        paidAt: typeof application.paidAt === 'string' ? application.paidAt : null,
        payload: application.payload as unknown as VisaPayload,
        documents: Array.isArray(application.documents)
          ? application.documents.filter(isRecord).map((d) => ({
            id: String(d.id || ''),
            kind: String(d.kind || ''),
            validationStatus: d.validationStatus as VisaCaseDocument['validationStatus'],
            validationReport: isRecord(d.validationReport) ? (d.validationReport as VisaCaseDocument['validationReport']) : undefined,
          }))
          : [],
      })
    } catch {
      if (ticket === seq.current) setUnavailable('network')
    } finally {
      if (ticket === seq.current) setLoading(false)
    }
  }, [applicationId, enabled])

  useEffect(() => {
    if (!applicationId || !enabled) { setKase(null); return }
    void reload()
  }, [applicationId, enabled, reload])

  return { kase, loading, unavailable, reload }
}

/** The step's outstanding issues, computed from the applicant's own case. */
function stepIssues(kase: VisaCase | null, step: VisaDmStep): string[] {
  if (!kase) return []
  // dm-steps.ts is the SAME partition the server used to emit this card — one definition,
  // both sides. (It is a pure module: no server-only import, so it runs here.)
  return validateVisaDmStep(
    kase.payload,
    kase.documents.map((d) => ({ kind: d.kind, validation_status: d.validationStatus })),
    step,
  )
}

type FormSpec = {
  field: string
  control: ControlKind
  /** The field's own standing explanation, plus why its answer is outstanding. Warning tone. */
  hints: string[]
  /** Quiet line under the label — "Optional" / "Prefilled…". Never a warning. */
  note?: string
  /** Fixed choices, for a `choice` control (a `when`-dependent list is resolved by then). */
  options?: readonly FieldChoice[]
  autoComplete?: string
  /** Which of the step's sections this field belongs to. */
  section: FormSection
}

/** The dashboard's checkpoint list, in the shape ui/combobox groups want. */
const EVISA_COMBOBOX_GROUPS = EVISA_CHECKPOINT_GROUPS.map((group) => ({ ...group, items: group.options }))

/**
 * Outstanding-issue hints, BY FIELD: the sentence that says why an answer is still needed.
 *
 * Filtered through the step's own allowlist, so a hint can never introduce a field the step
 * does not own (the form is the only thing that decides what is rendered — see VISA_STEP_FORM).
 */
function issueHintsFor(step: VisaDmStep, issues: string[], tr: Tr): Map<string, string[]> {
  const allowed = new Set<string>(VISA_DM_STEP_FIELDS[step] ?? [])
  const hints = new Map<string, string[]>()
  const outstanding = new Set<string>()
  for (const issue of issues) {
    const mapped = VISA_ISSUE_FIELD[issue]
    if (!mapped || !allowed.has(mapped.field)) continue
    outstanding.add(mapped.field)
    if (!mapped.hint) continue
    const hint = tr(mapped.hint[0], mapped.hint[1])
    const existing = hints.get(mapped.field)
    if (!existing) hints.set(mapped.field, [hint])
    else if (!existing.includes(hint)) existing.push(hint)
  }
  // ⚠️ Most `*_required` codes carry no sentence of their own — they used to need none,
  // because the form held ONLY the missing fields. Now that a step renders all nineteen of
  // them, "which one is still missing?" cannot be left to the eye: every outstanding field
  // gets a warning line, its own if it has one and this one otherwise.
  for (const field of outstanding) {
    if (!hints.has(field)) hints.set(field, [tr('Still needed', 'Vẫn cần điền')])
  }
  return hints
}

/** A payload value as a form string. Numbers and yes/no are strings on the wire by design. */
function fieldValue(kase: VisaCase | null, field: string): string {
  const raw = (kase?.payload as unknown as Record<string, unknown> | undefined)?.[field]
  if (raw === undefined || raw === null) return ''
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  return String(raw)
}

// ── Shared chrome ─────────────────────────────────────────────────────────────────

/**
 * The card shell every visa card shares: the shop's side of the thread, a step counter.
 *
 * ⚠️ NOW A THIN ADAPTER over the shared `ChatCard` (chat-card-shell.tsx), which the trip cards also
 * render through — the owner asked for the two families to feel like one thing. The SIGNATURE is
 * deliberately unchanged, so all seven call sites in this money-path file are untouched: what a
 * card says, how its actions are wired, and the live/settled semantics are exactly as before. The
 * only difference a reader will see is chrome — the shadow is gone, per design-language §3b.
 */
function CardShell({
  step, title, tone = 'live', children, className,
}: {
  step: VisaDmStep | null
  title: string
  tone?: ChatCardTone
  children: React.ReactNode
  className?: string
}) {
  const { tr } = useLanguage()
  return (
    <ChatCard
      eyebrow={tr('e-Visa', 'E-Visa')}
      icon={Sparkles}
      title={title}
      step={step === null ? null : { current: step, total: STEP_COUNT }}
      tone={tone}
      className={className}
    >
      {children}
    </ChatCard>
  )
}

/**
 * The 5-step progress rail — and, since 2026-07-28, the GO-BACK control (owner: "make so user can
 * go back and check or edit previously given answers in cards"). Shared with the trip wizard.
 *
 * ⚠️ ONLY STEPS ALREADY REACHED ARE REACHABLE. Jumping forward would open a form for a stage the
 * server has not asked about, and the route refuses a step above the card's own anyway — offering
 * a tap that provably 400s is worse than not offering it.
 */
const StepDots = ({ step, current, onSelect }: { step: VisaDmStep; current: VisaDmStep; onSelect?: (n: number) => void }) => {
  const { tr } = useLanguage()
  return (
    <ChatCardSteps
      current={step}
      total={STEP_COUNT}
      labels={([1, 2, 3, 4, 5] as VisaDmStep[]).map((n) => tr(STEP_TITLE[n][0], STEP_TITLE[n][1]))}
      reachable={onSelect ? Array.from({ length: current }, (_, i) => i + 1) : undefined}
      onSelect={onSelect}
    />
  )
}

// ── The document step (step 1) ────────────────────────────────────────────────────

const DOC_KINDS = ['passport', 'portrait'] as const
type DocKind = (typeof DOC_KINDS)[number]

const DOC_TITLE: Record<DocKind, [string, string]> = {
  passport: ['Passport data page', 'Trang thông tin hộ chiếu'],
  portrait: ['Portrait photo', 'Ảnh chân dung'],
}
const DOC_HINT: Record<DocKind, [string, string]> = {
  passport: ['The page with your photo and the two machine-readable lines.', 'Trang có ảnh của bạn và hai dòng mã máy đọc.'],
  // ⚠️ THIS IS THE ONLY PRE-UPLOAD PORTRAIT INSTRUCTION IN THE PRODUCT — /dashboard/visa/apply is
  // a bare redirect, so there is no second surface. It has to lead with what will actually STOP
  // the upload (image-quality.ts's seven blocking checks) and mention the plain background as the
  // preference it now is. It used to say "plain white background" flatly, which would have sat in
  // the app demanding a wall on the same day the public page said a background is a warning.
  portrait: ['Your face, straight to camera, head and shoulders in frame — no hat, no glasses. A plain light background is best.', 'Khuôn mặt nhìn thẳng vào máy ảnh, thấy rõ đầu và vai — không đội mũ, không đeo kính. Nền sáng, trơn là tốt nhất.'],
}

function DocumentRow({
  kind, document, busy, onPick,
}: {
  kind: DocKind
  document: VisaCaseDocument | undefined
  busy: boolean
  onPick: (kind: DocKind, file: File) => void
}) {
  const { tr } = useLanguage()
  const status = document?.validationStatus
  const ready = status === 'passed'
  const failed = status === 'failed'
  const issues = document?.validationReport?.issues ?? []
  // Read from the STORED report, never from the extract response — the route returns the discarded
  // run's warnings as [] when a downgrade is suppressed, and the stored report is what the desk and
  // the admin page see. One source, so the two surfaces cannot disagree.
  const warnings = document?.validationReport?.warnings ?? []
  const inputId = `visa-doc-${kind}`

  return (
    <div className={cn('rounded-xl border p-2.5', ready ? 'border-success/40 bg-success/5' : failed ? 'border-destructive/40 bg-destructive/5' : 'border-line-strong')}>
      <div className="flex items-start gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', ready ? 'bg-success/15 text-success' : failed ? 'bg-destructive/10 text-destructive' : 'bg-accent text-accent-foreground')}>
          {ready ? <Check className="h-4 w-4" aria-hidden /> : <FileImage className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground">{tr(DOC_TITLE[kind][0], DOC_TITLE[kind][1])}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-body">{tr(DOC_HINT[kind][0], DOC_HINT[kind][1])}</p>
          {status === 'pending' && <p className="mt-1 text-2xs font-semibold text-warning">{tr('Checking…', 'Đang kiểm tra…')}</p>}
          {/* ⚠️ THIS LINE USED TO BLAME THE APPLICANT'S PHOTO FOR OUR OUTAGE. It read "send the
              photo again", which is both wrong and expensive: `unavailable` means the CHECK did
              not run — Gemini unreachable, the 10/h or 30/day per-user limit, or the shared
              ai-global daily budget — so re-uploading the same bytes burns another upload and
              another analysis slot and cannot change the outcome.

              It also CONTRADICTED the per-issue copy directly beneath it, which is accurate and
              distinguishes the three causes ("Your image is saved. The checker is busy — try
              again in about a minute", rate-limited, failed). Now that every issue renders rather
              than the first three, that copy always reaches the applicant, so this line steps
              aside whenever there is a specific reason to show.

              It cannot be deleted outright: the `getGemini()`-is-null path writes
              `validation_status: 'unavailable'` WITHOUT a validation_report, so the report keeps
              whatever it held before — either nothing at all, or the QUALITY issues from an
              earlier failed run. `issues.length === 0` was not enough for that second case: the
              stale quality bullets would render, this line would stay hidden, and the applicant
              would be told to fix a photo when in truth the check never ran. So the condition asks
              the precise question — is an outage already being explained? — rather than the
              convenient one. Caught by a reviewer. */}
          {status === 'unavailable' && !issues.some((i) => OUTAGE_ISSUE_CODES.has(i)) && (
            <p className="mt-1 text-2xs font-semibold text-warning">
              {tr('Your photo is saved. Our automatic check could not run just now — this is on us, not your photo. Please try again shortly.', 'Ảnh của bạn đã được lưu. Hệ thống kiểm tra tự động của chúng tôi chưa chạy được — đây là lỗi của chúng tôi, không phải ảnh của bạn. Vui lòng thử lại sau ít phút.')}
            </p>
          )}
          {/* ⚠️ EVERY ISSUE, NOT THE FIRST THREE. This used to `.slice(0, 3)`, which turned a
              strict gate into a re-upload treadmill: an applicant with four problems fixed the
              three they were shown, sent a new photo, and was told about a fourth they had never
              been given the chance to fix. Measured in production on 2026-07-28 — the only
              applicant who reached this step had FOUR issues on each of two attempts, saw three
              both times, and abandoned the application.

              The portrait gate can emit eleven codes, so a long list is possible in principle;
              in practice the model returns a handful. A list that is honestly long is still
              strictly better than one that hides the reason the next attempt will also fail.
              ⚠️ Do NOT re-add a cap here to tidy the layout — the cap IS the bug. */}
          {issues.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-2xs leading-relaxed text-destructive">
              {issues.map((issue) => <li key={issue}>• {imageIssueCopy(issue, tr)}</li>)}
            </ul>
          )}
          {/* ⚠️ THE WHOLE POINT OF THE DEMOTION. Four portrait checks stopped blocking on
              2026-07-29 (image-quality.ts), and `warnings` was a field this component DECLARED and
              never read — so demoting into it would have deleted those checks outright rather than
              softening them. The applicant is told, in amber, and can carry on.

              Rendered even when `ready`, and deliberately so: a passed portrait with a warning is
              now the NORMAL state, and it is the only case where this list carries real
              information — "we accepted this, and here is what a human should look at again". */}
          {warnings.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-2xs leading-relaxed text-warning">
              {warnings.map((warning) => <li key={warning}>• {imageIssueCopy(warning, tr)}</li>)}
            </ul>
          )}
        </div>
        {/* ⚠️ "Verified" IS DOWNGRADED WHEN THERE ARE WARNINGS. A green Verified badge stacked on
            top of amber "this would be safer" lines asserts a certainty we no longer have — the
            document passed OUR seven blocking checks, not the department's whole portrait rule.
            Flagged in review as the badge that would quietly contradict the new copy. */}
        {ready && (
          warnings.length > 0
            ? <Badge variant="warning" size="sm" className="shrink-0">{tr('Accepted', 'Đã nhận')}</Badge>
            : <Badge variant="success" size="sm" className="shrink-0">{tr('Verified', 'Đã xác minh')}</Badge>
        )}
      </div>
      {/*
        The <label> IS the control (the repo's documented file-picker idiom — see
        RAW_CONTROL_ALLOW in scripts/design-lint.mjs and the dashboard wizard's UploadCard):
        a hidden <input type=file> renders nothing, is opened by click-through containment,
        and needs its raw node for the value='' reset that lets the same file be picked twice.
        ui/label is a form label and ui/input is a visible field — neither can be this.
      */}
      <label
        className={cn(
          'mt-2 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs font-bold text-foreground transition-colors hover:border-brand focus-within:border-brand focus-within:ring-2 focus-within:ring-ring/30',
          busy && 'cursor-not-allowed opacity-60',
        )}
        htmlFor={inputId}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden /> : <Upload className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
        {document ? tr('Send a different photo', 'Gửi ảnh khác') : tr('Send photo', 'Gửi ảnh')}
        <input
          id={inputId}
          type="file"
          /* ⚠️ `image/*` FIRST, AND ON iOS IT IS THE DIFFERENCE BETWEEN A CAMERA AND A DEAD BUTTON.
             This was an explicit MIME list with no `image/*`, and a WKWebView narrows the picker to
             match: the "Take Photo" option disappears, and some iOS versions offer an empty
             library. For a passport page and a portrait, taking the photo right then IS the primary
             action — the applicant has the passport in their hand. The repo already knew this and
             wrote it down on the search camera button ("`accept="image/*"` (no `capture`) lets the
             OS picker offer camera OR library on mobile"); the visa card just never got the memo,
             and the post wizard uses `image/*,.heic,.heif` for the same reason.

             The explicit types stay AFTER it as a hint for desktop pickers, and the extensions
             because iOS reports HEIC inconsistently by MIME. ⚠️ NEVER `capture="camera"` — that
             forces the camera and removes the library, which would block anyone whose passport
             scan is already in their photos.

             This is only a picker hint and never a check: the server re-validates MIME AND
             extension in the documents route and sharp has to decode the bytes, so widening it
             here grants nothing. */
          accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Reset FIRST so re-picking the same file still fires a change event.
            event.target.value = ''
            if (file) onPick(kind, file)
          }}
        />
      </label>
    </div>
  )
}

// ── The step card ─────────────────────────────────────────────────────────────────

export type VisaStepCardProps = {
  meta: VisaStepCardMeta
  info: VisaThreadInfo | null
  kase: VisaCase | null
  /** Why the case could not be loaded, if it could not. A CODE — rendered via visaErrorCopy. */
  caseError?: string | null
  /** This card is the one currently being asked (newest, active, bound, AI-driven, mine to act on). */
  live: boolean
  busy: boolean
  /** Resolves TRUE when the server accepted the action — the editor only closes on true. */
  /** `step` names WHICH step's answers an edit is for — absent means this card's own step. */
  onAct: (action: 'acknowledge' | 'skip' | 'edit', fields?: Record<string, string>, step?: number) => boolean | Promise<boolean>
  onUpload: (kind: DocKind, file: File) => void | Promise<void>
}

/**
 * One of the five conversational pages.
 *
 * A card that is settled (done/skipped), superseded (a later case took the thread over) or
 * being read by anyone other than the applicant renders as HISTORY: a title and a state,
 * with no controls at all. That is requirement 2's "settled history, not a live prompt",
 * and it is also what makes an admin takeover honest — the wizard stops asking.
 */
export function VisaStepCard({ meta, info, kase, caseError, live, busy, onAct, onUpload }: VisaStepCardProps) {
  const { tr } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  /**
   * The EARLIER step being reviewed, or null to follow the server.
   *
   * ⚠️ SEPARATE FROM meta.step ON PURPOSE, and for a different reason than the trip wizard's. There
   * the answers live in a client draft; here they live in the applicant's encrypted case, and
   * meta.step is recomputed server-side from completeness on every advance. Shadowing it for
   * RENDERING only means a poll that moves the real step cannot yank somebody out of an answer they
   * are part-way through re-reading.
   */
  const [reviewStep, setReviewStep] = useState<VisaDmStep | null>(null)
  /** What this card renders: the step under review if there is one, else the server's. */
  const view: VisaDmStep = reviewStep ?? meta.step
  const reviewing = reviewStep !== null && reviewStep !== meta.step

  /**
   * End the detour when the card stops being about the same thing.
   *
   * ⚠️ THIS CANNOT WIPE A HALF-TYPED EDIT, and I checked rather than assumed, because closing the
   * editor on a background poll would be a nasty way to lose passport data. A visa_step card's
   * metaJson is never rewritten in place — `advanceVisaDmFlow` INSERTS the next step's card rather
   * than mutating this one — so `meta.step` is immutable for the life of this component, and the
   * 15s poll cannot move it underneath someone mid-form. The dep that actually fires is
   * `meta.applicationId`: switching to another case must not leave the previous case's step under
   * review.
   */
  useEffect(() => { setReviewStep(null); setEditing(false) }, [meta.step, meta.applicationId])

  const issues = useMemo(() => (live ? stepIssues(kase, view) : []), [live, kase, view])
  // Step 2 is the "confirm what we read off your passport" page: the card lists every field
  // the extraction filled in (meta.needsReview — names only) above the form.
  const confirmFields = useMemo(() => {
    if (view !== 2) return []
    const allowed = new Set<string>(VISA_DM_STEP_FIELDS[2] ?? [])
    return meta.needsReview.filter((name) => allowed.has(name))
  }, [view, meta.needsReview])

  /** Issue hints by field, so a field can still say WHY its answer is outstanding. */
  const issueHints = useMemo(() => issueHintsFor(view, issues, tr), [view, issues, tr])

  // ⚠️ THE WHOLE STEP, NOT THE GAPS. Every field the step owns is rendered and pre-filled from
  // the applicant's own case, so a schema default is an answer they can see and change rather
  // than a question nobody asked (see VISA_STEP_FORM). The conditional follow-ups resolve off
  // the DRAFT, so a "yes" reveals its detail field immediately instead of after a save, a
  // server revalidation and a fresh card.
  const editFields = useMemo((): FormSpec[] => (
    visaStepFormFields(view, draft).map((entry): FormSpec => ({
      field: entry.field,
      control: entry.control,
      section: entry.section,
      // "Optional" and "still needed" cannot both be true of the same box — an outstanding
      // answer silences the quiet note (localContact*: optional as a GROUP, required once one
      // of the three is filled).
      note: entry.note && !issueHints.has(entry.field) ? tr(NOTE_COPY[entry.note][0], NOTE_COPY[entry.note][1]) : undefined,
      autoComplete: entry.autoComplete,
      options: typeof entry.options === 'function' ? entry.options(draft) : entry.options,
      hints: [...new Set([
        ...(entry.hint ? [tr(entry.hint[0], entry.hint[1])] : []),
        ...(issueHints.get(entry.field) ?? []),
      ])],
    }))
  ), [view, draft, issueHints, tr])

  /** Does this step hold answers the SCHEMA wrote rather than the applicant? Then say so. */
  const hasPrefilled = useMemo(() => (VISA_STEP_FORM[view] ?? []).some((entry) => entry.note === 'prefilled'), [view])

  /** The step's own sections, as runs of consecutive fields — a long form you can navigate. */
  const editSections = useMemo(() => {
    const groups: Array<{ key: string; title: string; specs: FormSpec[] }> = []
    for (const spec of editFields) {
      const last = groups[groups.length - 1]
      if (last && last.key === spec.section) last.specs.push(spec)
      else groups.push({ key: spec.section, title: tr(SECTION_TITLE[spec.section][0], SECTION_TITLE[spec.section][1]), specs: [spec] })
    }
    return groups
  }, [editFields, tr])

  const openEditor = () => {
    const next: Record<string, string> = {}
    // ⚠️ SEED EVERY FIELD THE STEP RENDERS — including the ones a `when` currently hides and
    // the ones with no outstanding issue. The date cascade rewrites its siblings, and the
    // back-fill asks whether the start date is empty; a draft holding only the MISSING
    // fields would read a saved answer as blank and overwrite it.
    for (const entry of VISA_STEP_FORM[view] ?? []) next[entry.field] = fieldValue(kase, entry.field)
    setDraft(next)
    setEditing(true)
  }

  // Only ever send fields this step OWNS — the same allowlist the server enforces.
  const submitEdit = () => {
    const allowed = new Set<string>(VISA_DM_STEP_FIELDS[view] ?? [])
    const fields: Record<string, string> = {}
    for (const spec of editFields) {
      if (!allowed.has(spec.field)) continue
      const value = visaSubmitValue(spec.field, draft[spec.field] ?? '')
      // ONLY WHAT CHANGED. Every step now renders its whole field set, and resending thirty
      // untouched answers on every save would put a full payload through the encrypted
      // write — and let one unrelated stale value fail the save with invalid_fields.
      if (value === fieldValue(kase, spec.field)) continue
      fields[spec.field] = value
    }
    if (!Object.keys(fields).length) {
      // ⚠️ REVIEWING AN EARLIER STEP MUST NOT ADVANCE THE FLOW. On the live step, "nothing changed"
      // is exactly the acknowledge verb. On an earlier one it means "I looked at step 2 and it is
      // fine" — sending acknowledge there would push the wizard forward from a card the applicant
      // opened to LOOK at, which is the opposite of what they asked for.
      if (reviewing) { setEditing(false); setReviewStep(null); return }
      void Promise.resolve(onAct('acknowledge')).then((ok) => { if (ok) setEditing(false) })
      return
    }
    // Only close on success — a refused save must not throw away what was typed. `view` tells the
    // server WHICH step these fields belong to; it validates it against the card and refuses
    // anything ahead of it.
    void Promise.resolve(onAct('edit', fields, view)).then((ok) => { if (ok) { setEditing(false); setReviewStep(null) } })
  }

  const title = tr(STEP_TITLE[view][0], STEP_TITLE[view][1])

  if (!live) {
    // A card can be inert for four different reasons and they do not read the same:
    // answered, deliberately skipped, left behind by an EARLIER case (the thread was
    // rebound), or simply not this viewer's to act on (the desk's own side of the thread,
    // or a human takeover). Never guess "no longer active" for all of them.
    const superseded = !!info && meta.applicationId !== info.applicationId
    return (
      <CardShell step={meta.step} title={title} tone="settled">
        <p className="mt-1 flex items-center gap-1.5 text-2xs font-semibold text-ink-4">
          {meta.state === 'done' && <Check className="h-3 w-3 text-success" aria-hidden />}
          {meta.state === 'skipped'
            ? tr('Skipped', 'Đã bỏ qua')
            : meta.state === 'done'
              ? tr('Done', 'Đã xong')
              : superseded
                ? tr('From an earlier application', 'Thuộc hồ sơ trước đó')
                : tr('In progress', 'Đang thực hiện')}
        </p>
      </CardShell>
    )
  }

  return (
    <CardShell step={view} title={title}>
      <StepDots step={view} current={meta.step} onSelect={(n) => { setEditing(false); setReviewStep(n === meta.step ? null : (n as VisaDmStep)) }} />
      {reviewing && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tint px-3 py-2">
          <p className="text-2xs text-ink-3">
            {tr('Looking back at an earlier step — nothing is sent unless you save.',
                'Đang xem lại bước trước — sẽ không gửi gì trừ khi bạn lưu.')}
          </p>
          <Button variant="soft" size="none" className="relative tap-44 rounded-full px-3 py-1 text-2xs font-bold" onClick={() => { setEditing(false); setReviewStep(null) }}>
            {tr('Back to step', 'Về bước hiện tại')} {meta.step}
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs leading-relaxed text-body">{tr(STEP_HINT[view][0], STEP_HINT[view][1])}</p>

      {/* Step 1 — the uploads happen HERE, in the thread, through the same document +
          extract endpoints the dashboard wizard uses. */}
      {view === 1 && kase && (
        <div className="mt-3 space-y-2">
          {DOC_KINDS.map((kind) => (
            <DocumentRow
              key={kind}
              kind={kind}
              document={kase.documents.find((d) => d.kind === kind)}
              busy={busy}
              onPick={onUpload}
            />
          ))}
        </div>
      )}

      {/* ⚠️ WITHOUT THE CASE THERE ARE NO CONTROLS. Every affordance below is derived from
          the applicant's own answers — which fields are missing, what the passport read says.
          Rendering "yes, that is correct" while the case is still loading (or failed to load)
          would offer a button that provably cannot move the flow on: the server recomputes
          the step, finds it unsatisfied, and re-serves the SAME card. So: say what is
          happening, and offer nothing. */}
      {!kase && (
        <p className="mt-3 rounded-xl bg-tint p-2.5 text-2xs leading-relaxed text-body">
          {caseError ? visaErrorCopy(caseError, tr) : tr('Loading your application…', 'Đang tải hồ sơ của bạn…')}
        </p>
      )}

      {/* Step 2 — the AI-filled fields, named and shown for a yes/no confirmation. The card
          itself never carried these values: they come from the applicant's own case. */}
      {view === 2 && kase && confirmFields.length > 0 && !editing && (
        <dl className="mt-3 space-y-1.5 rounded-xl bg-tint p-2.5">
          {confirmFields.map((field) => (
            <div key={field} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-2xs font-semibold text-body">{fieldLabel(field, tr)}</dt>
              <dd className="min-w-0 truncate text-xs font-bold text-foreground">
                {fieldValue(kase, field) || <span className="font-medium text-ink-4">{tr('not read', 'chưa đọc được')}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* What is still needed — issue codes turned into sentences, never values. */}
      {issues.length > 0 && !editing && (
        <ul className="mt-3 space-y-1 rounded-xl bg-warning/10 p-2.5 text-2xs leading-relaxed text-warning">
          {issues.map((issue) => {
            const doc = DOC_ISSUE_COPY[issue]
            const mapped = VISA_ISSUE_FIELD[issue]
            return (
              <li key={issue}>
                • {doc
                  ? tr(doc[0], doc[1])
                  : mapped
                    ? `${fieldLabel(mapped.field, tr)}${mapped.hint ? ` — ${tr(mapped.hint[0], mapped.hint[1])}` : ''}`
                    : issue.replaceAll('_', ' ')}
              </li>
            )
          })}
        </ul>
      )}

      {editing && kase && (
        <div className="mt-3 space-y-4">
          {/* The dashboard's own prefill sentence, in one line. An answer the applicant never
              gave must not READ like one they did — that is the whole reason these fields are
              on screen at all. */}
          {hasPrefilled && (
            <p className="rounded-xl bg-tint p-2.5 text-2xs leading-relaxed text-body">
              {tr(
                'Some answers are already filled in with the most common ones. They are suggestions, not assumptions about you — change anything that is not right.',
                'Một số câu trả lời đã được điền sẵn theo lựa chọn phổ biến nhất. Đó là gợi ý, không phải giả định về bạn — hãy sửa bất kỳ mục nào chưa đúng.',
              )}
            </p>
          )}
          {editSections.map((section) => (
            // A long step stays navigable by being SECTIONED, never by hiding fields: a
            // collapsed panel is exactly the "never asked" failure this form exists to end.
            <div key={section.key} className="space-y-3">
              <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{section.title}</p>
              {section.specs.map((spec) => (
                <VisaFieldControl
                  key={spec.field}
                  spec={spec}
                  value={draft[spec.field] ?? ''}
                  bounds={visaDateBounds(spec.field, draft)}
                  // ⚠️ NOT a plain field write. applyVisaDraftEdit carries the dashboard's
                  // cross-field defaults — picking a start date fills the end date, the
                  // intended entry date and the length of stay, off the SHARED helper.
                  onChange={(value) => setDraft((current) => applyVisaDraftEdit(current, spec.field, value))}
                />
              ))}
            </div>
          ))}
          {/* STICKY, because these forms are now long: on a phone the applicant must be able to
              save from wherever they are in the card rather than scrolling back to the bottom.
              Pulled to the card's edges so the bar reads as chrome, not as another field. */}
          <div className="sticky bottom-0 -mx-3.5 flex flex-wrap gap-1.5 border-t border-border bg-card px-3.5 py-2.5">
            <Button variant="cta" size="none" disabled={busy} onClick={submitEdit} className="rounded-xl px-3 py-2 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {tr('Save and continue', 'Lưu và tiếp tục')}
            </Button>
            <Button variant="soft" size="none" disabled={busy} onClick={() => setEditing(false)} className="rounded-xl px-3 py-2 text-xs font-bold text-body">
              {tr('Cancel', 'Hủy')}
            </Button>
          </div>
        </div>
      )}

      {!editing && kase && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/* ACKNOWLEDGE only exists when there is genuinely nothing outstanding — the server
              keeps the same card active otherwise, and a button that cannot move the flow on
              is a lie. Same reason SKIP disappears: a required answer is not skippable. */}
          {/* ⚠️ ADVANCING VERBS BELONG TO THE LIVE STEP ONLY. Acknowledge and Skip move the flow
              on; offering them while the applicant is looking BACK at step 2 would turn "let me
              check what I put" into "confirm and go forward". Reviewing leaves only the editor. */}
          {!reviewing && issues.length === 0 && view !== 1 && (
            <Button variant="cta" size="none" disabled={busy} onClick={() => void onAct('acknowledge')} className="rounded-xl px-3 py-2 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {view === 2 ? tr('Yes, that is correct', 'Đúng, chính xác') : tr('Looks right — continue', 'Đúng rồi — tiếp tục')}
            </Button>
          )}
          {editFields.length > 0 && (
            <Button
              variant={issues.length ? 'cta' : 'soft'}
              size="none"
              disabled={busy}
              onClick={openEditor}
              className={cn('rounded-xl px-3 py-2 text-xs', issues.length ? '' : 'font-bold text-accent-foreground')}
            >
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              {/* "Check every answer", not "Change something": with the whole step on screen
                  the button opens answers the applicant has never seen, most of them prefilled
                  — inviting a change implies they already agreed to what is in there. */}
              {issues.length ? tr('Fill these in', 'Điền các mục này') : tr('Check every answer', 'Kiểm tra mọi câu trả lời')}
            </Button>
          )}
          {!reviewing && issues.length === 0 && view !== 1 && (
            <Button variant="soft" size="none" disabled={busy} onClick={() => void onAct('skip')} className="rounded-xl px-3 py-2 text-xs font-bold text-body">
              {tr('Skip', 'Bỏ qua')}
            </Button>
          )}
          {meta.step === 1 && issues.length === 0 && (
            <Button variant="cta" size="none" disabled={busy} onClick={() => void onAct('acknowledge')} className="rounded-xl px-3 py-2 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
              {tr('Continue', 'Tiếp tục')}
            </Button>
          )}
        </div>
      )}

      {/* ⚠️ NO ESCAPE HATCH TO A SECOND FORM — there isn't one any more. This used to link to
          the dashboard wizard ("the chat is the fast path, not a cage"), which the owner
          retired: "only 1 way should exist through the chat". A link to a deleted surface is
          the loudest kind of dead end, and it sat on EVERY step card. */}
    </CardShell>
  )
}

/** The <input type> and keyboard each typed control asks for. Anything absent is plain text. */
const INPUT_TYPE: Partial<Record<ControlKind, string>> = { date: 'date', number: 'number', email: 'email', tel: 'tel' }
const INPUT_MODE: Partial<Record<ControlKind, React.HTMLAttributes<HTMLInputElement>['inputMode']>> = {
  number: 'numeric', email: 'email', tel: 'tel',
}

/**
 * One answer. Text/date/number/email/phone through ui/field + ui/input; the enums through
 * ui/select; the two border gates through ui/combobox, exactly as the dashboard's
 * CheckpointCombobox — an 80-entry checkpoint list is not a thing to type from memory on a phone.
 */
function VisaFieldControl({ spec, value, bounds, onChange }: {
  spec: FormSpec
  value: string
  /** Date limits for this field, from visaDateBounds. Ignored by every other control. */
  bounds?: { min?: string; max?: string }
  onChange: (value: string) => void
}) {
  const { tr } = useLanguage()
  const id = `visa-field-${spec.field}`
  const label = fieldLabel(spec.field, tr)
  // A note is QUIET (this answer may stay as it is); a hint is a WARNING (this one may not).
  const note = spec.note
    ? <span className="text-2xs font-normal text-ink-4">{spec.note}</span>
    : null

  if (spec.control === 'checkpoint') {
    return (
      // Same <label htmlFor> + primitive idiom as the select below, and the same one the
      // dashboard's FormField uses around its own CheckpointCombobox.
      <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-foreground">
        {label}
        {note}
        {spec.hints.map((hint) => <span key={hint} className="text-2xs font-normal text-warning">{hint}</span>)}
        <Combobox
          items={EVISA_COMBOBOX_GROUPS}
          value={value || null}
          inputValue={value}
          onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}
          onInputValueChange={(next) => onChange(next)}
          autoHighlight
        >
          <ComboboxInputGroup>
            {/* text-base for the same reason as every other field here: under 16px iOS
                zooms the viewport on focus, and this form lives inside a chat thread. */}
            <ComboboxInput
              id={id}
              autoComplete="off"
              placeholder={tr('Type or choose a checkpoint', 'Nhập hoặc chọn cửa khẩu')}
              className="text-base font-normal lg:text-sm"
            />
            <ComboboxClear aria-label={tr(`Clear ${label}`, `Xóa ${label}`)} />
            <ComboboxTrigger aria-label={tr(`Open ${label} options`, `Mở lựa chọn ${label}`)} />
          </ComboboxInputGroup>
          <ComboboxContent>
            <ComboboxEmpty>{tr('No matching checkpoint. You can keep what you typed.', 'Không có cửa khẩu phù hợp. Bạn có thể giữ giá trị đã nhập.')}</ComboboxEmpty>
            <ComboboxList>
              {(group: (typeof EVISA_COMBOBOX_GROUPS)[number]) => (
                <ComboboxGroup key={group.id} items={group.items}>
                  <ComboboxGroupLabel>{tr(group.label, group.labelVi)}</ComboboxGroupLabel>
                  {group.items.map((checkpoint) => <ComboboxItem key={checkpoint} value={checkpoint}>{checkpoint}</ComboboxItem>)}
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </label>
    )
  }

  if (spec.control === 'yesno' || spec.control === 'sex' || spec.control === 'choice') {
    const options: Array<[string, string]> = spec.control === 'choice'
      ? (spec.options ?? []).map(([optionValue, copy]) => [optionValue, tr(copy[0], copy[1])])
      : spec.control === 'yesno'
        ? YES_NO.map(([optionValue, copy]) => [optionValue, tr(copy[0], copy[1])])
        : [['male', tr('Male', 'Nam')], ['female', tr('Female', 'Nữ')]]
    return (
      // A <label htmlFor> + ui/select is the repo's own pattern for this control (the visa
      // wizard's VisaSelect): Base UI's Field.Label registers against a Field.Control, and a
      // Select trigger is not one — an unregistered label emits a dangling htmlFor.
      <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-foreground">
        {label}
        {note}
        {spec.hints.map((hint) => <span key={hint} className="text-2xs font-normal text-warning">{hint}</span>)}
        {/* ⚠️ `items` is LOAD-BEARING: without it Base UI's Select.Value renders the RAW
            stored value — the owner saw "credit_card" where "Credit card" belongs. */}
        <Select items={Object.fromEntries(options)} value={value || null} onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}>
          <SelectTrigger id={id} className="min-h-11 w-full rounded-xl bg-card"><SelectValue placeholder={tr('Choose', 'Chọn')} /></SelectTrigger>
          <SelectContent>
            {options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    )
  }

  return (
    <Field className="gap-1">
      <FieldLabel className="text-xs font-semibold text-foreground">{label}</FieldLabel>
      {note}
      {spec.hints.map((hint) => <span key={hint} className="text-2xs text-warning">{hint}</span>)}
      {spec.control === 'long' ? (
        <FieldControl
          id={id}
          render={
            <Textarea
              id={id}
              variant="outline"
              rows={2}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className="text-base lg:text-sm"
            />
          }
        />
      ) : (
        <FieldControl
          id={id}
          render={
            <Input
              id={id}
              variant="outline"
              // The keyboard is part of the answer on a phone: a number pad for a number, an
              // @-key for the email, a dial pad for a phone. autoComplete is granted ONLY where
              // the form entry says so — i.e. only for the applicant's OWN email and phone.
              type={INPUT_TYPE[spec.control] ?? 'text'}
              inputMode={INPUT_MODE[spec.control]}
              autoComplete={spec.autoComplete}
              // ⚠️ THE LEGAL WINDOW, CARRIED BY THE CONTROL. A date outside it cannot be
              // picked at all — the same min/max pair the dashboard's TripStep sets, and the
              // reason the applicant meets "an e-Visa covers at most 90 days" while choosing
              // rather than as a refusal after saving. Numbers carry the schema's own range.
              min={spec.control === 'number' ? NUMBER_BOUNDS[spec.field]?.min : bounds?.min}
              max={spec.control === 'number' ? NUMBER_BOUNDS[spec.field]?.max : bounds?.max}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              // text-base is LOAD-BEARING on mobile: iOS zooms the viewport when focusing a
              // field under 16px, and this form lives inside a chat thread.
              className="text-base lg:text-sm"
            />
          }
        />
      )}
    </Field>
  )
}

// ── The checkout card ─────────────────────────────────────────────────────────────

export type VisaCheckoutCardProps = {
  meta: VisaCheckoutCardMeta
  info: VisaThreadInfo | null
  kase: VisaCase | null
  /** This is the current, unpaid pay card AND the viewer is the applicant. */
  live: boolean
  busy: boolean
  onPay: (provider: 'stripe' | 'paypal', quote: VisaQuoteWire) => void | Promise<void>
  /** Re-post the last form step so the applicant can correct something before paying. Optional so
   *  the desk's read-only render of this card carries no escape hatch it should not offer. */
  onReview?: () => void | Promise<void>
}

/**
 * "Lastly if user fills all should pay through paypal inside messaging app all checkout
 * stylized" — the pay card.
 *
 * TWO NUMBERS, NEITHER OF THEM COMPUTED HERE: the đồng price the desk set on its own
 * listing, and the SERVER-ISSUED dollar quote that PayPal will actually capture. If the
 * server could not issue a quote (FX down), the card SAYS SO and pays nothing — there is no
 * fallback rate on this surface and there must never be one.
 */
export function VisaCheckoutCard({ meta, info, kase, live, busy, onPay, onReview }: VisaCheckoutCardProps) {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  // ONE consent tick covering both legal acts (see the label below); the server still
  // receives + records them as two distinct versioned consents.
  const [consented, setConsented] = useState(false)

  const paid = meta.status === 'paid' || !!kase?.paidAt
  const product = info?.product ?? null
  // The quote must be for the product on screen, at the price on screen — otherwise the two
  // numbers are not one price and neither may be shown as the other's equivalent.
  const quote = info?.quote && product && info.quote.listingId === product.listingId && info.quote.priceVnd === product.priceVnd
    ? info.quote
    : null
  const providers = info?.providers ?? []
  const speedSpec = product?.speed ? VISA_SPEED_SPECS[product.speed] : null
  const closed = !!product && !product.acceptingNow
  // The REAL ready instant for a payment made right now, batched to the next working day by
  // expectedVisaReadyAt (weekend/holiday aware). Null when the tier or calendar makes no honest
  // promise — in which case the notice simply omits the date rather than inventing one.
  // ⚠️ SERVER VALUE, not a render-time clock. `new Date()` here hydrated differently and went
  // stale across a cutoff/midnight/weekend boundary while the card sat open (codex + Gemini).
  // `expectedReadyIso` is computed per request in the thread payload by the same pure function.
  const closedReadyIso = closed ? product?.expectedReadyIso ?? null : null
  const closedReadyAt = closedReadyIso
    ? new Date(closedReadyIso).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null
  // ⚠️ NO HONEST PROMISE ⇒ NO SALE. If the desk is closed and the server could not compute a
  // ready instant (an unknown tier, or a closure run longer than the calendar covers), we are
  // back to taking money for a date we cannot state — which is exactly what the removed 409
  // protected against. Paying stays disabled in that one case; the checkout route refuses it
  // server-side too, so this is a courtesy, not the guard.
  const unpromisable = closed && !closedReadyIso

  const title = tr('Pay for your e-Visa', 'Thanh toán E-Visa')

  if (paid) {
    return (
      <CardShell step={5} title={title} tone="settled">
        <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-success">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {tr('Paid', 'Đã thanh toán')} · {formatUsdCents(Math.round(meta.amountUsd * 100), locale)}
        </p>
        <p className="mt-1 text-2xs leading-relaxed text-body">
          {tr('Your application is with eno. We will message you here if anything needs changing.', 'Hồ sơ của bạn đang ở chỗ eno. Chúng tôi sẽ nhắn tại đây nếu cần chỉnh sửa gì.')}
        </p>
      </CardShell>
    )
  }

  return (
    <CardShell step={5} title={title} tone={live ? 'live' : 'settled'}>
      {/* Decorative here — no onSelect. The pay card is not a form to go back into, and once the
          case is paid the server refuses every field edit anyway (EDITABLE_STATUSES). */}
      <StepDots step={5} current={5} />

      <div className="mt-3 rounded-xl border border-line-strong bg-tint p-3">
        <p className="text-xs font-bold text-foreground">{product?.title || tr('e-Visa service', 'Dịch vụ E-Visa')}</p>
        {speedSpec && (
          <p className="mt-0.5 text-2xs leading-relaxed text-body">{tr(speedSpec.turnaround, speedSpec.turnaroundVi)}</p>
        )}
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-4">{tr('Price', 'Giá')}</p>
            <p className="text-base font-bold tabular-nums text-foreground">
              {product ? formatMoneyFull(product.priceVnd, '₫', locale) : '—'}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-4">{tr('You pay', 'Bạn trả')}</p>
            <p className={cn('text-base font-bold tabular-nums', quote ? 'text-accent-foreground' : 'text-ink-4')}>
              {quote ? formatUsdCents(quote.amountUsdCents, locale) : '—'}
            </p>
          </div>
        </div>
        {/* ⚠️ IF A PROCESSING FEE IS IN THE TOTAL, THE CARD MUST SAY SO. "You pay" is a gross-up
            (see src/lib/visa/fx.ts), so it is deliberately MORE than priceVnd ÷ rate — and the old
            copy explained the total as a pure currency conversion at that rate. A buyer checking
            the arithmetic found a gap the card could not account for, on the screen where they
            hand over money. Quotes issued before the fee change carry no breakdown and correctly
            fall back to the original sentence. */}
        {quote && (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-4">
            {quote.processingUsdCents != null && quote.serviceUsdCents != null && quote.processingUsdCents > 0
              ? tr(
                  `Service ${formatUsdCents(quote.serviceUsdCents, locale)} + payment processing ${formatUsdCents(quote.processingUsdCents, locale)}. Charged in US dollars at ${rateLabel(quote, locale)} per dollar.`,
                  `Dịch vụ ${formatUsdCents(quote.serviceUsdCents, locale)} + phí xử lý thanh toán ${formatUsdCents(quote.processingUsdCents, locale)}. Thu bằng đô la Mỹ theo tỷ giá ${rateLabel(quote, locale)} mỗi đô la.`,
                )
              : tr(
                  `Charged in US dollars at ${rateLabel(quote, locale)} per dollar.`,
                  `Thu bằng đô la Mỹ theo tỷ giá ${rateLabel(quote, locale)} mỗi đô la.`,
                )}
          </p>
        )}
      </div>

      {!quote && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-warning/10 p-2.5 text-2xs leading-relaxed text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {tr('The US dollar amount is not available right now, so paying is paused. Nothing has been charged — try again in a moment.', 'Hiện chưa có số tiền đô la Mỹ nên thanh toán tạm dừng. Chưa có khoản nào bị trừ — vui lòng thử lại sau giây lát.')}
        </p>
      )}
      {/* ⚠️ THE DISCLOSURE THAT REPLACED A REFUSAL (owner, 2026-07-24: "they can apply and pay
          but before pay warning it processes the next working day first hours so we dont lose
          clients"). Checkout used to 409 outside the window; it accepts now, so THIS notice is
          the whole consumer protection — it must state the real ready time BEFORE the pay
          buttons, never after, and never imply the headline turnaround. `readyAt` comes from
          expectedVisaReadyAt, which batches an out-of-window payment to the NEXT WORKING DAY's
          first cutoff (weekend- and holiday-aware), so this is the true date, not a guess. */}
      {closed && (
        <p className="mt-2 rounded-xl bg-warning/10 p-2.5 text-2xs leading-relaxed text-warning">
          <strong className="font-bold">
            {tr('Processed on the next working day.', 'Được xử lý vào ngày làm việc tiếp theo.')}
          </strong>{' '}
          {tr(
            'The desk is closed right now, so processing starts when it opens — not when you pay.',
            'Bộ phận hiện đã đóng, nên việc xử lý bắt đầu khi mở cửa — không phải khi bạn thanh toán.',
          )}
          {closedReadyAt ? ` ${tr('Expected ready', 'Dự kiến xong')}: ${closedReadyAt}.` : ''}
        </p>
      )}
      {live && !providers.length && (
        <p className="mt-2 rounded-xl bg-tint p-2.5 text-2xs leading-relaxed text-body">
          {tr('Paying in chat is not switched on yet — ask us and we will take it from here.', 'Thanh toán trong tin nhắn chưa được bật — hãy nhắn cho chúng tôi để được hỗ trợ.')}
        </p>
      )}

      {live && (
        <div className="mt-3 space-y-2">
          {/* ONE tick, both legal acts (owner 2026-07-24: "combine these into 1 shorter clearer").
              The two consents the SERVER records stay distinct — the checkout body still sends
              declarationAccepted AND prefillAuthorized, and visa_payments still stores both
              consent_*_version columns, so a dispute can still tell the truthfulness declaration
              from the prefill authorization. Only the applicant-facing wording is merged, and both
              version constants were bumped with it (src/lib/visa/schema.ts) — the stored version
              must always name text the applicant actually saw. Bundling is defensible here because
              NEITHER consent is optional: no visa can be prepared without both.
              The merged sentence deliberately keeps EVERY material element of the two originals —
              "every … approved", answers AND images, "true, complete and accurate", "prefill the
              official e-Visa form", "refusal and legal consequences", "a person still reviews the
              form before it is submitted" — so nothing is legally weaker than the two-tick version
              (codex made us restore each of those on review).
              The two consent_*_version columns sit on ONE visa_payments row, written in a single
              atomic checkout write with one timestamp — that row IS the evidence both were accepted
              in one act.
              ⚠️ The version constants are SHARED with the dashboard approve-for-prefill consent
              (cases-client.tsx), which is deliberately NOT merged: its authorization is a materially
              MORE specific disclosure (transfer into a temporary hosted browser, recording/session
              logs/CAPTCHA-solving disabled, human review before declaration, payment and submission)
              and collapsing it would destroy real safeguard disclosure. So the version is a POLICY
              date, not a per-surface text hash — do not suffix it with anything surface-specific. */}
          <label className="flex cursor-pointer items-start gap-2 text-2xs leading-relaxed text-body">
            <Checkbox checked={consented} onChange={setConsented} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{tr('I confirm that every answer and image I have approved is true, complete and accurate, and I authorise eno to use them to prefill the official e-Visa form. False information can cause refusal and legal consequences; a person still reviews the form before it is submitted.', 'Tôi xác nhận mọi câu trả lời và hình ảnh tôi đã duyệt đều trung thực, đầy đủ và chính xác, và tôi cho phép eno dùng chúng để điền trước biểu mẫu E-Visa chính thức. Thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý; vẫn có người kiểm tra biểu mẫu trước khi nộp.')}</span>
          </label>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {providers.includes('paypal') && (
              <Button
                variant="cta"
                size="none"
                disabled={busy || !quote || !consented || unpromisable}
                onClick={() => quote && void onPay('paypal', quote)}
                className="rounded-xl px-3.5 py-2.5 text-xs"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wallet className="h-3.5 w-3.5" aria-hidden />}
                {tr('Pay with PayPal', 'Thanh toán bằng PayPal')}
              </Button>
            )}
            {providers.includes('stripe') && (
              <Button
                variant="outline"
                size="none"
                disabled={busy || !quote || !consented || unpromisable}
                onClick={() => quote && void onPay('stripe', quote)}
                className="rounded-xl px-3.5 py-2.5 text-xs font-bold"
              >
                <CreditCard className="h-3.5 w-3.5" aria-hidden />
                {tr('Pay by card', 'Thanh toán bằng thẻ')}
              </Button>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-ink-4">
            <LockKeyhole className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {tr('You finish paying on the provider’s own secure page, then come back here.', 'Bạn hoàn tất thanh toán trên trang bảo mật của nhà cung cấp rồi quay lại đây.')}
          </p>
          {/* ⚠️ THE WAY BACK, AND IT DID NOT EXIST (owner, 2026-07-30: "when you go to checkout in
              thread for visa you cant go back and edit"). This card offered consent and pay, and
              the resend chip re-posts THIS card — so an applicant who spotted a wrong passport name
              at the last moment had no move at all, on the screen immediately before a
              non-refundable government fee. It re-posts the last form step, which already knows how
              to review and edit every earlier one.
              Quiet on purpose: paying is still the primary action, this is the escape hatch. */}
          {onReview && (
            <Button
              variant="bare"
              size="none"
              disabled={busy}
              onClick={() => void onReview()}
              className="mt-0.5 h-auto justify-start p-0 text-2xs font-bold text-accent-foreground underline-offset-2 hover:underline"
            >
              <PencilLine className="h-3 w-3 shrink-0" aria-hidden />
              {tr('Check or change my answers first', 'Kiểm tra hoặc sửa thông tin trước')}
            </Button>
          )}
        </div>
      )}

      {!live && !paid && (
        <p className="mt-2 text-2xs leading-relaxed text-ink-4">
          {info && meta.applicationId !== info.applicationId
            ? tr('From an earlier application.', 'Thuộc hồ sơ trước đó.')
            : tr('Waiting for payment.', 'Đang chờ thanh toán.')}
        </p>
      )}
    </CardShell>
  )
}

// ── The result card ───────────────────────────────────────────────────────────────

export type VisaResultCardProps = {
  meta: VisaResultCardMeta
  info: VisaThreadInfo | null
}

/**
 * "Upload final result to the chat as pdf user can download there" — the finished visa,
 * living in the conversation.
 *
 * ⚠️ FETCHED, NOT LINKED. The button pulls the bytes from
 * GET /api/visa/applications/[id]/result and clicks a temporary object URL, exactly like the
 * admin handover pack. Two reasons, and both matter more here: no URL that resolves to an
 * identity document is ever left in the DOM, in browser history or in a referrer, and a
 * refusal is a sentence inside the card instead of a raw JSON error page in a new tab. The
 * object URL is revoked on a timer rather than immediately — revoking in the same task
 * aborts the download in some browsers, and holding it forever leaves the visa alive in the
 * tab for the rest of the session.
 *
 * ⚠️ NOT A ONE-SHOT LINK. Nothing here is consumed by pressing it: the endpoint re-reads the
 * row and re-streams the file every time, so this card is still a working download a year
 * later. That is the point of putting it in the thread rather than only in an email.
 *
 * ⚠️ NO APPLICANT DATA. The card renders a case number and a document icon. The name of the
 * file is decided by the SERVER (Content-Disposition, built from the case reference alone);
 * the fallback below is a constant, never anything off the case.
 */
export function VisaResultCard({ meta, info }: VisaResultCardProps) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A card left behind by an earlier case (a repeat applicant rebinds the thread) is
  // history — it still downloads, because that visa is still theirs.
  const superseded = !!info && meta.applicationId !== info.applicationId

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/visa/applications/${meta.applicationId}/result`, { cache: 'no-store' })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || 'internal_error')
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      // The server names the file; this is only what the browser falls back to when the
      // header is stripped by a proxy. A constant — never the reference, never the case id.
      anchor.download = 'evisa.pdf'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('network')
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardShell step={null} title={tr('Your e-Visa is ready', 'Thị thực điện tử của bạn đã sẵn sàng')} tone={superseded ? 'settled' : 'live'}>
      <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-success">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {tr('Approved', 'Đã được duyệt')}
      </p>

      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-line-strong bg-tint p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
          <FileText className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-foreground">{tr('e-Visa (PDF)', 'Thị thực điện tử (PDF)')}</p>
          {meta.reference && (
            <p className="mt-0.5 font-mono text-2xs tracking-wide text-ink-4">{meta.reference}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5">
        <Button
          variant="cta"
          size="none"
          disabled={busy}
          onClick={() => void download()}
          className="rounded-xl px-3.5 py-2.5 text-xs"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
          {tr('Download your visa', 'Tải thị thực của bạn')}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-xl bg-destructive/10 p-2.5 text-2xs leading-relaxed text-destructive">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {visaErrorCopy(error, tr)}
        </p>
      )}

      <p className="mt-2 text-2xs leading-relaxed text-body">
        {tr(
          'We also emailed it to you. This card stays here, so you can download it again whenever you need it. Print a copy and keep it with your passport.',
          'Chúng tôi cũng đã gửi email cho bạn. Thẻ này vẫn ở đây, bạn có thể tải lại bất cứ khi nào cần. Hãy in một bản và mang theo cùng hộ chiếu.',
        )}
      </p>
    </CardShell>
  )
}

// ── The re-send chip ──────────────────────────────────────────────────────────────

/** draft / needs_changes — the statuses the CHAT can still write to (mirrors the dashboard). */
export const EDITABLE_VISA_STATUSES = new Set(['draft', 'needs_changes'])

/**
 * "Single entry · Within 1 hour" — the visa TYPE as one bilingual string.
 *
 * PUBLIC PRODUCT FACTS ONLY: an entry type and a speed tier, both from the canonical
 * selected_* columns. Never a payload value, so it is safe on any surface that lists cases.
 * Returns '' when the case has not chosen a product yet, so callers can fall back.
 */
export function visaTypeWords(entryType: unknown, speed: unknown, tr: (en: string, vi: string) => string): string {
  const entry = typeof entryType === 'string' ? VISA_ENTRY_TYPE_LABELS[entryType as VisaEntryType] : undefined
  const code = parseVisaSpeedCode(typeof speed === 'string' ? speed : null)
  const spec = code ? VISA_SPEED_SPECS[code] : null
  return [entry ? tr(entry.en, entry.vi) : null, spec ? tr(spec.label, spec.labelVi) : null]
    .filter(Boolean)
    .join(' · ')
}

export type VisaResendChipProps = {
  info: VisaThreadInfo
  /** The desk's side of the thread. Only changes the wording, never the entitlement. */
  isDesk: boolean
  busy: boolean
  /** The last refusal CODE, or null. Rendered as a sentence — never a raw server string. */
  error: string | null
  onResend: () => void | Promise<void>
  /**
   * The applicant's OTHER editable cases, for the "bring which form?" picker (owner,
   * 2026-07-24). Empty/absent ⇒ no dropdown at all: with one draft there is nothing to
   * choose between, and a menu with a single item is just a slower button.
   *
   * ⚠️ PUBLIC FACTS ONLY — an EV reference and the visa type. Nothing here decrypts a
   * payload, matching the rest of this surface.
   */
  otherCases?: Array<{ id: string; label: string }>
  /** Switch the thread to another case (rebind + bring its form down). */
  onSwitchCase?: (applicationId: string) => void | Promise<void>
  /**
   * Render the BUTTON ALONE, for a caller that owns the row and the explanatory line.
   *
   * The owner asked for the chips "in one neat row". Three labelled buttons, each carrying
   * its own helper sentence, stacked into three separate blocks above the composer — which
   * read as three unrelated features rather than one set of choices, and pushed the composer
   * down the screen on a phone.
   */
  compact?: boolean
  className?: string
}

/**
 * "Also admin can send visa application form from chip if the original one is way up in
 * conversation" (owner) — one tap that puts the CURRENT card back at the bottom of the thread.
 *
 * IT LIVES BY THE COMPOSER, NOT BY THE CARD, and that is the entire requirement: somebody who
 * has scrolled a hundred messages past the form cannot be asked to find the form in order to
 * ask for the form. The composer is the one part of a chat that is always on screen, so the
 * way back sits directly above it.
 *
 * BOTH SEATS SEE IT. The owner asked for the desk, but the applicant scrolled past the same
 * card and has the same problem; the route allows either participant, so hiding it from one of
 * them would only make the capability harder to discover, not safer.
 *
 * ⚠️ FAILURE IS SHOWN, NEVER SWALLOWED. A refused re-send (a 429 above all, which is the
 * likely one — the chip is deliberately capped) renders its sentence INLINE, right under the
 * chip the finger is still on, and stays there until the next attempt. A toast would slide
 * away from the exact place the user is looking.
 *
 * ⚠️ NO PII, as everywhere on this surface: this component renders a verb, a mode and an error
 * code. It never touches the case.
 */
export function VisaResendChip({ info, isDesk, busy, error, onResend, otherCases, onSwitchCase, compact, className }: VisaResendChipProps) {
  const { tr } = useLanguage()
  // An admin takeover pauses the guided form for the APPLICANT — dm-thread refuses to author
  // a step card in 'admin' mode, so a tap could only come back as a 409 — and the chip says
  // why rather than offering a dead button.
  //
  // ⚠️ NOT for the desk. The owner's ask was "admin can send visa application form from
  // chip", and a review caught that pausing both seats disabled the feature for exactly the
  // actor they named: the admin who took the thread over. The invariant being protected is
  // "the AUTOMATED flow must not post over a human" — during a takeover the desk IS that
  // human, so it may re-post deliberately (dm-flow passes byAdmin only after proving the
  // caller is the desk).
  const paused = info.mode === 'admin' && !isDesk

  return (
    <div className={cn(compact ? 'contents' : 'flex flex-col gap-1', className)}>
      <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-2'}>
        {/* ONE control (owner 2026-07-24: "send the form again is itself a dropdown and when opened
            upwards user can select from available options" — the resend chip + a separate chevron
            was two pills eating a phone's width). When the applicant has OTHER editable cases, the
            chip IS the dropdown: it opens UPWARD (side="top", it sits above the composer) to resend
            THIS form, or bring a different application's form down. With no other case (the common
            single-case applicant), it stays a plain one-tap button. */}
        {!paused && !!otherCases?.length && onSwitchCase ? (
          <DropdownMenu>
            {/* ⚠️ The icon+label live INSIDE the rendered Button, not as Trigger children — Base UI's
                `render` REPLACES the trigger, so any sibling children are dropped and the menu never
                opens (how this shipped broken once). */}
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="soft"
                  size="none"
                  disabled={busy}
                  aria-label={tr('Send a form to this chat', 'Gửi biểu mẫu vào cuộc trò chuyện này')}
                  className="relative tap-44 shrink-0 gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-2xs font-bold text-foreground active:scale-100"
                >
                  {busy
                    ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    : <RotateCcw className="size-3.5 shrink-0" aria-hidden />}
                  {tr('Send the form again', 'Gửi lại biểu mẫu')}
                  <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="max-w-[16rem]">
              <DropdownMenuItem disabled={busy} onClick={() => void onResend()}>
                <RotateCcw /> {tr('Send this form again', 'Gửi lại biểu mẫu này')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* ⚠️ DropdownMenuLabel (Base UI Menu.GroupLabel) THROWS "MenuGroupContext is missing"
                  unless it sits inside a Menu.Group — the throw happens on popup mount, so the menu
                  would never open. Keep the label inside the group. */}
              <DropdownMenuGroup>
                {/* ⚠️ THE LABEL USED TO PROMISE THE OPPOSITE OF WHAT HAPPENS. It read "Bring another
                    application" / "Đưa hồ sơ khác xuống" — bring it DOWN HERE — and the owner
                    reported the resulting behaviour as a bug three times, most recently "send form
                    again still creates new chat". Nothing is created: each case is welded to its
                    own conversation (`Conversation.visaApplicationId` is @unique, and the
                    application's `conversation_id` is immutable), so its form is re-posted THERE
                    and we follow it. Saying "open" is the truthful verb for that, and the arrow
                    says a move is coming before the tap rather than after it.

                    Bringing a case here for real would mean moving its binding AND its history
                    between threads; the honest fix for a traveller with several visa threads is to
                    consolidate them, which is a data decision on the backlog, not a label. */}
                <DropdownMenuLabel>{tr('Open another application', 'Mở hồ sơ khác')}</DropdownMenuLabel>
                {otherCases.map((c) => (
                  <DropdownMenuItem key={c.id} disabled={busy} onClick={() => void onSwitchCase(c.id)}>
                    <ArrowRight />
                    {c.label}
                    <span className="ml-auto text-2xs text-ink-4">{tr('in its own chat', 'trong chat riêng')}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="soft"
            size="none"
            disabled={busy || paused}
            onClick={() => void onResend()}
            title={tr('Post the current e-Visa step again at the bottom of this chat', 'Đăng lại bước E-Visa hiện tại ở cuối cuộc trò chuyện')}
            className="relative tap-44 shrink-0 gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-2xs font-bold text-foreground"
          >
            {busy
              ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              : <RotateCcw className="size-3.5 shrink-0" aria-hidden />}
            {/* Names what it does, not where it goes: "resend" reads as a retry after a failure,
                and nothing failed here — the card just scrolled away. */}
            {tr('Send the form again', 'Gửi lại biểu mẫu')}
          </Button>
        )}
        {!paused && !compact && (
          <span className="min-w-0 text-2xs leading-relaxed text-ink-4">
            {isDesk
              ? tr('Puts the applicant’s current step back at the bottom.', 'Đưa bước hiện tại của người nộp xuống cuối.')
              : tr('Lost the form above? This brings it back down here.', 'Không thấy biểu mẫu ở trên? Tùy chọn này đưa nó xuống đây.')}
          </span>
        )}
      </div>
      {/* basis-full in compact mode: the wrapper is display:contents, so these notes are flex
          items of the CALLER row — without it they would sit between the chips. */}
      {paused && (
        <p className={cn('text-2xs leading-relaxed text-body', compact && 'basis-full order-last')}>
          {tr('Paused while a specialist is in this chat.', 'Tạm dừng trong khi chuyên viên đang trong cuộc trò chuyện này.')}
        </p>
      )}
      {/* role="status" so a screen reader hears the refusal — the chip itself does not move. */}
      {error && (
        <p role="status" className={cn('flex items-start gap-1.5 text-2xs leading-relaxed text-warning', compact && 'basis-full order-last')}>
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {visaErrorCopy(error, tr)}
        </p>
      )}
    </div>
  )
}

// ── The thread strip: mode + "get a person" ───────────────────────────────────────

export function VisaThreadStrip({
  info, busy, onAskHuman, compact, className,
}: {
  info: VisaThreadInfo
  busy: boolean
  onAskHuman: () => void | Promise<void>
  /** Caller owns the row (see the composer chip row) — take a full line inside it. */
  compact?: boolean
  className?: string
}) {
  const { tr } = useLanguage()

  if (info.mode === 'admin') {
    return (
      <div className={cn('flex items-start gap-2 text-2xs leading-relaxed text-body', compact && 'basis-full', className)}>
        <UserRound className="mt-px h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden />
        <span>{tr('An eno specialist has taken over this chat. Just write to them below.', 'Chuyên viên eno đã tiếp nhận cuộc trò chuyện này. Bạn cứ nhắn trực tiếp bên dưới.')}</span>
      </div>
    )
  }

  if (info.mode === 'human_requested') {
    return (
      <div className={cn('flex items-start gap-2 text-2xs leading-relaxed text-body', compact && 'basis-full', className)}>
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <span>{tr('A person has been asked to look at this. You can keep filling the form while you wait.', 'Đã yêu cầu nhân viên xem hồ sơ này. Bạn vẫn có thể tiếp tục điền trong lúc chờ.')}</span>
      </div>
    )
  }

  return (
    <div className={cn(compact ? 'contents' : 'flex items-center justify-between gap-2', className)}>
      <span className="min-w-0 truncate text-2xs text-ink-4">{tr('Guided by eno’s assistant', 'Được trợ lý eno hướng dẫn')}</span>
      <Button
        variant="soft"
        size="none"
        disabled={busy}
        onClick={() => void onAskHuman()}
        className="shrink-0 gap-1 rounded-full border border-line-strong px-2.5 py-1 text-2xs font-bold text-foreground"
      >
        <UserRound className="h-3 w-3" aria-hidden />
        {tr('Talk to a person', 'Gặp nhân viên')}
      </Button>
    </div>
  )
}

// ── The product-picker card (step 0) ──────────────────────────────────────────────
//
// A GENERIC start has no product yet; this card is where the applicant chooses one, IN
// the thread (owner spec, Phase 2). It is deliberately a thin frame around the same
// catalogue building blocks the storefront picker uses (visa-start.tsx): the catalogue is
// FETCHED live per render of the live card — the message's metaJson carries no products
// and no prices, so a card authored yesterday can never advertise yesterday's price.
//
// ⚠️ A PRODUCT, NEVER A PRICE: a tap POSTs { listingId } to
// /api/visa/applications/[id]/select-product; every number on the rows came from the
// catalogue GET (đồng off the listing, dollars off a server-issued quote).

export type VisaPickerCardProps = {
  meta: VisaPickerCardMeta
  info: VisaThreadInfo | null
  /** This is the newest active picker AND the viewer is the applicant (not takeover). */
  live: boolean
  busy: boolean
  onSelect: (listingId: string) => boolean | Promise<boolean>
}

export function VisaPickerCard({ meta, info, live, busy, onSelect }: VisaPickerCardProps) {
  const { tr } = useLanguage()
  // Fetched only while the card is live — settled/historical pickers render static text
  // and cost nothing. Re-fetched when a thread re-render remounts the live card, which
  // keeps the 15-minute quote honesty of the storefront picker.
  const catalogue = useVisaCatalogue(live)
  const now = useMinuteTick()
  const done = meta.state === 'done'
  // The product this thread currently selects, for the settled line — from the canonical
  // thread context (survives product renames); meta.selectedListingId stays display-only.
  const chosenTitle = done && info?.product ? info.product.title : null

  if (done || !live) {
    return (
      <CardShell step={null} title={tr('Choose your e-Visa service', 'Chọn dịch vụ e-Visa')} tone="settled">
        {done ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {chosenTitle
              ? `${tr('Service chosen', 'Đã chọn dịch vụ')} · ${chosenTitle}`
              : tr('Service chosen', 'Đã chọn dịch vụ')}
          </p>
        ) : (
          <p className="mt-1 text-2xs leading-relaxed text-body">
            {tr('A service is being chosen for this application.', 'Dịch vụ cho hồ sơ này đang được chọn.')}
          </p>
        )}
      </CardShell>
    )
  }

  return (
    <CardShell step={null} title={tr('Choose your e-Visa service', 'Chọn dịch vụ e-Visa')} tone="live">
      <p className="mt-1 text-2xs leading-relaxed text-body">
        {tr(
          'Pick a service to continue — five short steps in this chat, then pay.',
          'Chọn một dịch vụ để tiếp tục — năm bước ngắn ngay trong chat, sau đó thanh toán.',
        )}
      </p>

      {catalogue.status === 'loading' && (
        <p className="mt-2.5 flex items-center gap-2 text-2xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {tr('Loading services…', 'Đang tải dịch vụ…')}
        </p>
      )}
      {(catalogue.status === 'error' || (catalogue.status === 'ready' && !catalogue.ready)) && (
        <p className="mt-2.5 text-2xs leading-relaxed text-body">
          {tr('The e-Visa desk is unavailable right now — please try again later.', 'Bộ phận e-Visa hiện không khả dụng — vui lòng thử lại sau.')}
        </p>
      )}
      {catalogue.status === 'ready' && catalogue.ready && !catalogue.products.length && (
        <p className="mt-2.5 text-2xs leading-relaxed text-body">
          {tr('No e-Visa services are on sale right now.', 'Hiện chưa có dịch vụ e-Visa nào được bán.')}
        </p>
      )}

      {catalogue.status === 'ready' && catalogue.ready && catalogue.products.length > 0 && (
        <div className="mt-2.5 space-y-2">
          {catalogue.products.map((product) => (
            <VisaProductRow
              key={product.listingId}
              product={product}
              now={now}
              disabled={busy}
              onPick={(listingId) => void onSelect(listingId)}
            />
          ))}
          {catalogue.status === 'ready' && !catalogue.payable && (
            <p className="text-2xs leading-relaxed text-muted-foreground">
              {tr(
                'Paying in chat is not switched on yet — pick a service and the desk will confirm how to pay.',
                'Thanh toán trong chat chưa được bật — bạn cứ chọn dịch vụ, bộ phận hỗ trợ sẽ hướng dẫn cách thanh toán.',
              )}
            </p>
          )}
        </div>
      )}
    </CardShell>
  )
}
