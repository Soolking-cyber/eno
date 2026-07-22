'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowRight, Check, CreditCard, FileImage, Loader2, LockKeyhole,
  PencilLine, ShieldCheck, Sparkles, Upload, UserRound, Wallet,
} from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { formatMoneyFull, formatUsdCents, moneyLocale } from '@/lib/vnd'
import { VISA_DM_STEP_FIELDS, validateVisaDmStep, type VisaDmStep } from '@/lib/visa/dm-steps'
import { VISA_SPEED_SPECS, type VisaSpeedCode } from '@/lib/visa/speed'
import type { VisaPayload } from '@/lib/visa/schema'

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
  return { listingId: listingId.trim(), priceVnd, amountUsdCents, vndPerUsd, quotedAt, expiresAt }
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
  3: ['A few details we cannot read from a document.', 'Một vài thông tin không thể đọc được từ giấy tờ.'],
  4: ['When you are coming and where you will stay.', 'Bạn đến khi nào và ở đâu.'],
  5: ['Everything is filled in. Pay to send your application to eno.', 'Đã điền xong. Thanh toán để gửi hồ sơ đến eno.'],
}

/**
 * Payload FIELD NAME → label. The vocabulary a card is allowed to speak: names, never
 * values. Every key here is a real key of visaPayloadSchema (dm-steps.ts owns the
 * per-step allowlists these are drawn from).
 */
const FIELD_LABEL: Record<string, [string, string]> = {
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
  emergencyPhone: ['Emergency contact phone', 'Điện thoại liên hệ khẩn cấp'],
  occupation: ['Occupation', 'Nghề nghiệp'],
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
}

const fieldLabel = (name: string, tr: Tr) => {
  const copy = FIELD_LABEL[name]
  return copy ? tr(copy[0], copy[1]) : name.replace(/([A-Z])/g, ' $1').toLowerCase()
}

type ControlKind = 'text' | 'long' | 'date' | 'number' | 'yesno' | 'sex'

/**
 * Validation ISSUE CODE → the payload field that answers it, and how to ask for it.
 *
 * The codes are exactly the ones dm-steps.ts routes to steps 2–4 (step 1 is documents, and
 * step 5 owns none). The FIELD is what the card writes back through the encrypted path, and
 * it is re-checked against VISA_DM_STEP_FIELDS before anything is sent — so this map can
 * never widen what a step may write.
 */
const ISSUE_FIELD: Record<string, { field: string; control: ControlKind; hint?: [string, string] }> = {
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
  not_compliant_portrait: ['Use a recent 4×6-style portrait.', 'Dùng ảnh chân dung 4×6 mới chụp.'],
  portrait_must_show_one_person: ['The portrait must show one person only.', 'Ảnh chỉ được có một người.'],
  portrait_image_blurry: ['Use a sharper portrait.', 'Dùng ảnh chân dung rõ nét hơn.'],
  face_must_look_straight: ['Look straight at the camera.', 'Nhìn thẳng vào máy ảnh.'],
  remove_hat: ['Remove the hat or head covering.', 'Bỏ mũ hoặc vật che đầu.'],
  remove_glasses: ['Remove glasses.', 'Bỏ kính.'],
  wear_formal_clothes: ['Wear neat, formal clothing.', 'Mặc trang phục lịch sự.'],
  use_plain_white_background: ['Use a plain white background.', 'Dùng nền trắng trơn.'],
  center_face_in_photo: ['Center the face in the portrait.', 'Đặt khuôn mặt ở giữa ảnh.'],
  show_head_and_shoulders: ['Show the full head and shoulders.', 'Hiển thị đầy đủ đầu và vai.'],
  portrait_lighting_uneven: ['Use even light without strong shadows.', 'Dùng ánh sáng đều, không có bóng mạnh.'],
  automatic_image_check_busy: ['Your image is saved. The checker is busy — try again in about a minute.', 'Ảnh đã được lưu. Hệ thống kiểm tra đang bận — thử lại sau khoảng một phút.'],
  automatic_image_check_rate_limited: ['Checking paused after too many attempts. Your image is saved.', 'Kiểm tra tạm dừng do quá nhiều lần thử. Ảnh của bạn đã được lưu.'],
  automatic_image_check_failed: ['Automatic checking failed. Try this image again.', 'Kiểm tra tự động thất bại. Hãy thử lại ảnh này.'],
}

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
  thread_not_bound: ['This chat is not linked to an application yet.', 'Cuộc trò chuyện này chưa được liên kết với hồ sơ nào.'],
  thread_conflict: ['This application belongs to another chat.', 'Hồ sơ này thuộc về cuộc trò chuyện khác.'],
  product_not_selected: ['Choose an e-Visa service first.', 'Hãy chọn dịch vụ E-Visa trước.'],
  product_not_configured: ['That service is still being set up. Ask us for help.', 'Dịch vụ đó vẫn đang được thiết lập. Hãy nhờ chúng tôi hỗ trợ.'],
  product_not_for_sale: ['That service is not on sale right now.', 'Dịch vụ đó hiện không được bán.'],
  product_price_unavailable: ['That service has no usable price right now.', 'Dịch vụ đó hiện chưa có giá hợp lệ.'],
  product_entry_type_mismatch: ['The service you picked does not match the entry type on your form.', 'Dịch vụ bạn chọn không khớp với loại nhập cảnh trên hồ sơ.'],
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

type FormSpec = { field: string; control: ControlKind; hints: string[] }

/**
 * The fields this card should ASK for: one per outstanding issue, de-duplicated, and
 * filtered through the step's own allowlist so a card can never write outside its step
 * (the server refuses it anyway — this keeps the refusal from ever being needed).
 */
function formSpecsFor(step: VisaDmStep, issues: string[], tr: Tr): FormSpec[] {
  const allowed = new Set<string>(VISA_DM_STEP_FIELDS[step] ?? [])
  const specs = new Map<string, FormSpec>()
  for (const issue of issues) {
    const mapped = ISSUE_FIELD[issue]
    if (!mapped || !allowed.has(mapped.field)) continue
    const existing = specs.get(mapped.field)
    const hint = mapped.hint ? tr(mapped.hint[0], mapped.hint[1]) : null
    if (existing) {
      if (hint && !existing.hints.includes(hint)) existing.hints.push(hint)
      continue
    }
    specs.set(mapped.field, { field: mapped.field, control: mapped.control, hints: hint ? [hint] : [] })
  }
  return [...specs.values()]
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

/** The card shell every visa card shares: the shop's side of the thread, a step counter. */
function CardShell({
  step, title, tone = 'live', children, className,
}: {
  step: VisaDmStep | null
  title: string
  tone?: 'live' | 'settled'
  children: React.ReactNode
  className?: string
}) {
  const { tr } = useLanguage()
  return (
    <div
      className={cn(
        'allow-select w-[92%] max-w-md rounded-2xl border px-3.5 py-3',
        tone === 'live' ? 'border-brand/30 bg-card shadow-pop' : 'border-border bg-card/70',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className={cn('h-3.5 w-3.5 shrink-0', tone === 'live' ? 'text-accent-foreground' : 'text-ink-4')} aria-hidden />
        <span className={cn('text-2xs font-bold uppercase tracking-wide', tone === 'live' ? 'text-accent-foreground' : 'text-ink-4')}>
          {tr('e-Visa', 'E-Visa')}
        </span>
        {step !== null && (
          <Badge variant="neutral" size="sm" className="ml-auto shrink-0">
            {tr(`Step ${step} of ${STEP_COUNT}`, `Bước ${step}/${STEP_COUNT}`)}
          </Badge>
        )}
      </div>
      <h3 className={cn('mt-1.5 text-sm font-bold', tone === 'live' ? 'text-foreground' : 'text-body')}>{title}</h3>
      {children}
    </div>
  )
}

/** The 5-dot progress rail — "not more than 5 pages", made visible. */
function StepDots({ step }: { step: VisaDmStep }) {
  const { tr } = useLanguage()
  return (
    <div className="mt-2 flex items-center gap-1" role="img" aria-label={tr(`Step ${step} of ${STEP_COUNT}`, `Bước ${step}/${STEP_COUNT}`)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn('h-1 flex-1 rounded-full', n < step ? 'bg-brand/40' : n === step ? 'bg-brand' : 'bg-tint')}
          aria-hidden
        />
      ))}
    </div>
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
  portrait: ['4×6 style, plain white background, no hat or glasses.', 'Kiểu 4×6, nền trắng trơn, không đội mũ hay đeo kính.'],
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
          {status === 'unavailable' && <p className="mt-1 text-2xs font-semibold text-warning">{tr('The automatic check could not finish — send the photo again.', 'Kiểm tra tự động chưa hoàn tất — hãy gửi lại ảnh.')}</p>}
          {issues.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-2xs leading-relaxed text-destructive">
              {issues.slice(0, 3).map((issue) => <li key={issue}>• {imageIssueCopy(issue, tr)}</li>)}
            </ul>
          )}
        </div>
        {ready && <Badge variant="success" size="sm" className="shrink-0">{tr('Verified', 'Đã xác minh')}</Badge>}
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
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
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
  onAct: (action: 'acknowledge' | 'skip' | 'edit', fields?: Record<string, string>) => boolean | Promise<boolean>
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

  const issues = useMemo(() => (live ? stepIssues(kase, meta.step) : []), [live, kase, meta.step])
  const specs = useMemo(() => formSpecsFor(meta.step, issues, tr), [meta.step, issues, tr])
  // Step 2 is the "confirm what we read off your passport" page: its EDIT form offers every
  // field the extraction filled in (meta.needsReview — names only), plus anything missing.
  const confirmFields = useMemo(() => {
    if (meta.step !== 2) return []
    const allowed = new Set<string>(VISA_DM_STEP_FIELDS[2] ?? [])
    return meta.needsReview.filter((name) => allowed.has(name))
  }, [meta.step, meta.needsReview])

  const editFields = useMemo(() => {
    const seen = new Set(specs.map((s) => s.field))
    const extra = confirmFields.filter((f) => !seen.has(f)).map((field): FormSpec => ({
      field,
      control: field === 'sex' ? 'sex' : field.endsWith('Date') || field === 'dateOfBirth' ? 'date' : 'text',
      hints: [],
    }))
    return [...specs, ...extra]
  }, [specs, confirmFields])

  const openEditor = () => {
    const next: Record<string, string> = {}
    for (const spec of editFields) next[spec.field] = fieldValue(kase, spec.field)
    setDraft(next)
    setEditing(true)
  }

  // Only ever send fields this step OWNS — the same allowlist the server enforces.
  const submitEdit = () => {
    const allowed = new Set<string>(VISA_DM_STEP_FIELDS[meta.step] ?? [])
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(draft)) {
      if (allowed.has(key)) fields[key] = value
    }
    if (!Object.keys(fields).length) return
    // Only close on success — a refused save must not throw away what was typed.
    void Promise.resolve(onAct('edit', fields)).then((ok) => { if (ok) setEditing(false) })
  }

  const title = tr(STEP_TITLE[meta.step][0], STEP_TITLE[meta.step][1])

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
    <CardShell step={meta.step} title={title}>
      <StepDots step={meta.step} />
      <p className="mt-2 text-xs leading-relaxed text-body">{tr(STEP_HINT[meta.step][0], STEP_HINT[meta.step][1])}</p>

      {/* Step 1 — the uploads happen HERE, in the thread, through the same document +
          extract endpoints the dashboard wizard uses. */}
      {meta.step === 1 && kase && (
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
      {meta.step === 2 && kase && confirmFields.length > 0 && !editing && (
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
            const mapped = ISSUE_FIELD[issue]
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
        <div className="mt-3 space-y-3">
          {editFields.map((spec) => (
            <VisaFieldControl
              key={spec.field}
              spec={spec}
              value={draft[spec.field] ?? ''}
              onChange={(value) => setDraft((current) => ({ ...current, [spec.field]: value }))}
            />
          ))}
          <div className="flex flex-wrap gap-1.5">
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
          {issues.length === 0 && meta.step !== 1 && (
            <Button variant="cta" size="none" disabled={busy} onClick={() => void onAct('acknowledge')} className="rounded-xl px-3 py-2 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {meta.step === 2 ? tr('Yes, that is correct', 'Đúng, chính xác') : tr('Looks right — continue', 'Đúng rồi — tiếp tục')}
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
              {issues.length ? tr('Fill these in', 'Điền các mục này') : tr('Change something', 'Sửa lại')}
            </Button>
          )}
          {issues.length === 0 && meta.step !== 1 && (
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

      {/* The full dashboard wizard stays one tap away — the chat is the fast path, not a
          cage. Same case, same encrypted row. */}
      {info && (
        <Link href="/dashboard/visa" className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-accent-foreground hover:underline">
          {tr('Open the full form instead', 'Mở biểu mẫu đầy đủ')}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </CardShell>
  )
}

/** One answer. Text/date/number through ui/field + ui/input; the enums through ui/select. */
function VisaFieldControl({ spec, value, onChange }: { spec: FormSpec; value: string; onChange: (value: string) => void }) {
  const { tr } = useLanguage()
  const id = `visa-field-${spec.field}`
  const label = fieldLabel(spec.field, tr)

  if (spec.control === 'yesno' || spec.control === 'sex') {
    const options: Array<[string, string]> = spec.control === 'yesno'
      ? [['yes', tr('Yes', 'Có')], ['no', tr('No', 'Không')]]
      : [['male', tr('Male', 'Nam')], ['female', tr('Female', 'Nữ')]]
    return (
      // A <label htmlFor> + ui/select is the repo's own pattern for this control (the visa
      // wizard's VisaSelect): Base UI's Field.Label registers against a Field.Control, and a
      // Select trigger is not one — an unregistered label emits a dangling htmlFor.
      <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-foreground">
        {label}
        {spec.hints.map((hint) => <span key={hint} className="text-2xs font-normal text-warning">{hint}</span>)}
        <Select value={value || null} onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}>
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
              type={spec.control === 'date' ? 'date' : 'text'}
              inputMode={spec.control === 'number' ? 'numeric' : undefined}
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
export function VisaCheckoutCard({ meta, info, kase, live, busy, onPay }: VisaCheckoutCardProps) {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const [declaration, setDeclaration] = useState(false)
  const [authorization, setAuthorization] = useState(false)

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
      <StepDots step={5} />

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
        {quote && (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-4">
            {tr(
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
      {closed && (
        <p className="mt-2 rounded-xl bg-warning/10 p-2.5 text-2xs leading-relaxed text-warning">
          {tr('Today’s cut-off for this speed has passed.', 'Đã qua giờ chốt hôm nay cho tốc độ này.')}
          {product?.nextOpensIso ? ` ${tr('Opens again', 'Mở lại')} ${new Date(product.nextOpensIso).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : ''}
        </p>
      )}
      {live && !providers.length && (
        <p className="mt-2 rounded-xl bg-tint p-2.5 text-2xs leading-relaxed text-body">
          {tr('Paying in chat is not switched on yet — ask us and we will take it from here.', 'Thanh toán trong tin nhắn chưa được bật — hãy nhắn cho chúng tôi để được hỗ trợ.')}
        </p>
      )}

      {live && (
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-2xs leading-relaxed text-body">
            <Checkbox checked={declaration} onChange={setDeclaration} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-2xs leading-relaxed text-body">
            <Checkbox checked={authorization} onChange={setAuthorization} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{tr('I authorize eno to use these approved answers and images to prefill the official e-Visa form. A person still reviews the form before it is submitted.', 'Tôi cho phép eno dùng các câu trả lời và hình ảnh đã duyệt để điền trước biểu mẫu E-Visa chính thức. Vẫn có người kiểm tra biểu mẫu trước khi nộp.')}</span>
          </label>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {providers.includes('paypal') && (
              <Button
                variant="cta"
                size="none"
                disabled={busy || !quote || closed || !declaration || !authorization}
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
                disabled={busy || !quote || closed || !declaration || !authorization}
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

// ── The thread strip: mode + "get a person" ───────────────────────────────────────

export function VisaThreadStrip({
  info, busy, onAskHuman, className,
}: {
  info: VisaThreadInfo
  busy: boolean
  onAskHuman: () => void | Promise<void>
  className?: string
}) {
  const { tr } = useLanguage()

  if (info.mode === 'admin') {
    return (
      <div className={cn('flex items-start gap-2 text-2xs leading-relaxed text-body', className)}>
        <UserRound className="mt-px h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden />
        <span>{tr('An eno specialist has taken over this chat. Just write to them below.', 'Chuyên viên eno đã tiếp nhận cuộc trò chuyện này. Bạn cứ nhắn trực tiếp bên dưới.')}</span>
      </div>
    )
  }

  if (info.mode === 'human_requested') {
    return (
      <div className={cn('flex items-start gap-2 text-2xs leading-relaxed text-body', className)}>
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <span>{tr('A person has been asked to look at this. You can keep filling the form while you wait.', 'Đã yêu cầu nhân viên xem hồ sơ này. Bạn vẫn có thể tiếp tục điền trong lúc chờ.')}</span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
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
