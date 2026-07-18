'use client'

import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, CreditCard, Download, FileCheck2, FileImage, Loader2, LockKeyhole, ShieldCheck, Sparkles, Trash2, Upload, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { validateVisaStep, visaDateDefaultsForStart, visaEndDateFor90DayWindow, type VisaPayload } from '@/lib/visa/schema'
import { DEFAULT_EVISA_ENTRY_GATE, EVISA_CHECKPOINT_GROUPS } from '@/lib/visa/checkpoints'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { SectionHeader } from '@/components/marketplace/section-header'
import { cn } from '@/lib/utils'

// /dashboard/visa/apply — the Vietnam e-Visa ASSISTANT, ported from the forum
// (apps/forum/src/components/visa/visa-assistant.tsx) to run INSIDE the eno.vn dashboard:
// same wizard, same copy, same server contract — but against eno.vn's own /api/visa/*
// applicant routes (cookie session, no cross-site Bearer, no iframe/redirect to eno.forum).
// Both surfaces read/write the SAME shared visa tables + storage bucket, so an application
// started on either site continues seamlessly on the other.
//
// eno.vn adaptations, deliberate and complete:
//   · forumApi/Bearer → same-origin visaApi with the cookie session;
//   · openSignIn → the sibling dashboard sections' auth gate (redirect to /signin?next=…);
//   · forum <main>+chrome → dashboard layout's main + SectionHeader (back → /dashboard/visa);
//   · raw consent checkbox → ui/checkbox; selects keep 44px via min-h-11 (the size-variant
//     attribute selector outranks a plain h-11);
//   · NEW "not configured on this host yet" state — payloads are encrypted with
//     VISA_DATA_ENCRYPTION_KEY (see src/lib/visa/crypto.ts); until the owner copies it from
//     the forum env, the API answers 503 and this client renders the honest empty state.
// The hosted-prefill operator flow (BROWSERBASE) is forum-only and intentionally absent —
// prefill status renders read-only from the application row like every other status.

type VisaImageReport = {
  issues?: string[]
  warnings?: string[]
  corrections?: string[]
  normalized?: { format?: string; sizeBytes?: number; width?: number | null; height?: number | null }
}
type VisaDocument = {
  id: string; kind: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null
  validationStatus?: 'pending' | 'passed' | 'failed' | 'unavailable'
  validationReport?: VisaImageReport
  createdAt: string
}
type VisaEvent = { id: string; actorType: string; event: string; metadata: Record<string, unknown>; createdAt: string }
type VisaApplication = {
  id: string; status: string; payload?: VisaPayload; checklist: string[]; applicantConfirmedAt: string | null;
  authorizedAt: string | null; assignedAdmin: string | null; submittedAt: string | null; resolvedAt: string | null;
  paidAt: string | null; paymentProvider?: string | null;
  createdAt: string; updatedAt: string; documents: VisaDocument[]; events?: VisaEvent[]
}
// The service-fee gate the list GET reports — null while payments are dormant
// (no provider/fee env), in which case submit works without payment as before.
type VisaPaymentsInfo = { providers: Array<'stripe' | 'paypal'>; feeCents: number; currency: string } | null
type VisaAnalysis = {
  document: Pick<VisaDocument, 'id' | 'validationStatus' | 'validationReport'>
  payload?: VisaPayload
  suggestions: string[]
  issues: string[]
  warnings?: string[]
}

class VisaApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

// Same-origin replacement for the forum's forumApi: the httpOnly Supabase cookie session
// authenticates every call — no token ever reaches this bundle.
async function visaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, cache: 'no-store', credentials: 'same-origin' })
  let body: unknown = null
  try { body = await response.json() } catch { body = null }
  if (!response.ok) throw new VisaApiError(response.status, (body as { error?: string } | null)?.error || `request_failed_${response.status}`)
  return body as T
}

const STEPS = ['Documents', 'Your details', 'Vietnam trip', 'Review'] as const
const EDITABLE = new Set(['draft', 'needs_changes'])
const EVISA_COMBOBOX_GROUPS = EVISA_CHECKPOINT_GROUPS.map((group) => ({ ...group, items: group.options }))
const MAX_BROWSER_IMAGE_BYTES = 3_700_000
const MAX_INTAKE_IMAGE_BYTES = 15 * 1024 * 1024

async function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

async function prepareImageForUpload(file: File) {
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
      const blob = await canvasJpeg(canvas, quality)
      if (!blob) throw new Error('large_image_could_not_be_prepared')
      if (blob.size <= MAX_BROWSER_IMAGE_BYTES) return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'visa-image'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
      if (quality > 0.66) quality -= 0.08
      else { quality = 0.82; scale *= 0.8 }
    }
    throw new Error('large_image_could_not_be_prepared')
  } finally { bitmap.close() }
}

function imageIssueCopy(issue: string, tr: (en: string, vi: string) => string) {
  const copy: Record<string, [string, string]> = {
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
    automatic_image_check_busy: ['Your image is saved. The automatic checker is busy—retry in about one minute.', 'Ảnh đã được lưu. Hệ thống kiểm tra tự động đang bận—hãy thử lại sau khoảng một phút.'],
    automatic_image_check_rate_limited: ['Automatic checking paused after too many attempts. Your image is saved; retry once in a few minutes.', 'Kiểm tra tự động đã tạm dừng do có quá nhiều lần thử. Ảnh đã được lưu; hãy thử lại một lần sau vài phút.'],
    automatic_image_check_failed: ['Automatic checking failed. Retry the image.', 'Kiểm tra tự động thất bại. Hãy thử lại ảnh.'],
  }
  const value = copy[issue] || [issue.replaceAll('_', ' '), issue.replaceAll('_', ' ')]
  return tr(value[0], value[1])
}

function uploadErrorCopy(error: unknown, tr: (en: string, vi: string) => string) {
  const code = error instanceof VisaApiError ? error.code : error instanceof Error ? error.message : 'upload_failed'
  const copy: Record<string, [string, string]> = {
    image_size_invalid: ['Use an image smaller than 15 MB.', 'Dùng ảnh nhỏ hơn 15 MB.'],
    large_image_could_not_be_prepared: ['This large image could not be resized. Export it as JPG and try again.', 'Không thể thu nhỏ ảnh lớn này. Hãy xuất ảnh thành JPG rồi thử lại.'],
    unsupported_image_type: ['Use JPG, PNG, WebP, HEIC, or HEIF.', 'Dùng JPG, PNG, WebP, HEIC hoặc HEIF.'],
    image_decode_failed: ['The image is damaged or unreadable. Choose another copy.', 'Ảnh bị hỏng hoặc không đọc được. Hãy chọn bản khác.'],
    portrait_resolution_too_low: ['The portrait is too small. Use at least 480×600 pixels.', 'Ảnh chân dung quá nhỏ. Dùng ít nhất 480×600 pixel.'],
    passport_resolution_too_low: ['The passport image is too small. Use at least 900×600 pixels.', 'Ảnh hộ chiếu quá nhỏ. Dùng ít nhất 900×600 pixel.'],
    image_official_limit_failed: ['The image could not be reduced below the official 2 MB limit.', 'Không thể giảm ảnh xuống dưới giới hạn chính thức 2 MB.'],
    ai_unavailable: ['Automatic checking is temporarily unavailable. Please retry shortly.', 'Kiểm tra tự động tạm thời không khả dụng. Vui lòng thử lại sau.'],
    rate_limited: ['Your image is saved. Automatic checking paused after too many attempts—use Retry once in a few minutes.', 'Ảnh đã được lưu. Kiểm tra tự động đã tạm dừng do có quá nhiều lần thử—hãy dùng Thử lại một lần sau vài phút.'],
    image_analysis_rate_limited: ['Your image is saved. Automatic checking paused after too many attempts—use Retry once in a few minutes.', 'Ảnh đã được lưu. Kiểm tra tự động đã tạm dừng do có quá nhiều lần thử—hãy dùng Thử lại một lần sau vài phút.'],
    image_analysis_busy: ['Your image is saved. eno will retry across two checkers; if they remain busy, retry in about one minute.', 'Ảnh đã được lưu. eno sẽ thử lại qua hai hệ thống kiểm tra; nếu vẫn bận, hãy thử lại sau khoảng một phút.'],
    image_analysis_failed: ['Automatic checking failed. Please retry this image.', 'Kiểm tra tự động thất bại. Vui lòng thử lại ảnh này.'],
    visa_encryption_not_configured: ['The assistant is not configured on this host yet.', 'Trợ lý chưa được thiết lập trên máy chủ này.'],
  }
  const value = copy[code] || [code.replaceAll('_', ' '), code.replaceAll('_', ' ')]
  return tr(value[0], value[1])
}

function statusCopy(status: string, tr: (en: string, vi: string) => string) {
  const map: Record<string, [string, string, string, string]> = {
    ready_for_review: ['Submitted for review', 'Đã gửi để xem xét', 'Your complete application and prefill permission are with an eno specialist. We will contact you only if something needs to change.', 'Hồ sơ hoàn chỉnh và quyền điền trước đã được gửi đến chuyên viên eno. Chúng tôi chỉ liên hệ nếu cần thay đổi.'],
    under_review: ['Being reviewed', 'Đang xem xét', 'We are comparing your answers with the source documents.', 'Chúng tôi đang đối chiếu câu trả lời với giấy tờ gốc.'],
    applicant_approval: ['Your final approval', 'Bạn cần duyệt lần cuối', 'Review the prepared case and authorize prefill only when every answer is correct.', 'Kiểm tra hồ sơ và chỉ cho phép điền trước khi mọi câu trả lời đều đúng.'],
    ready_to_submit: ['Ready for official prefill', 'Sẵn sàng điền hồ sơ chính thức', 'Your authorization is recorded. An operator will prepare the official form for human review.', 'Đã ghi nhận ủy quyền. Nhân viên sẽ chuẩn bị biểu mẫu chính thức để kiểm tra.'],
    submitted: ['Submitted to the authority', 'Đã nộp cho cơ quan chức năng', 'We will keep the government reference and status here.', 'Mã hồ sơ và trạng thái sẽ được cập nhật tại đây.'],
    payment_required: ['Payment action needed', 'Cần thực hiện thanh toán', 'Follow the private instructions shown below. Government fees are separate from eno service fees.', 'Làm theo hướng dẫn bên dưới. Lệ phí nhà nước tách biệt với phí dịch vụ eno.'],
    processing: ['Government processing', 'Cơ quan chức năng đang xử lý', 'No result yet. We will deliver the official PDF here when issued.', 'Chưa có kết quả. Tệp PDF chính thức sẽ xuất hiện tại đây khi được cấp.'],
    approved: ['e-Visa ready', 'E-Visa đã sẵn sàng', 'Download the official result and check every detail before travel.', 'Tải kết quả chính thức và kiểm tra mọi thông tin trước chuyến đi.'],
    rejected: ['Application not approved', 'Hồ sơ không được chấp thuận', 'Read the case update below. Approval is always decided by the Vietnamese authority.', 'Đọc cập nhật bên dưới. Quyết định luôn thuộc cơ quan chức năng Việt Nam.'],
    cancelled: ['Application cancelled', 'Hồ sơ đã hủy', 'This case is closed.', 'Hồ sơ này đã đóng.'],
  }
  const value = map[status] || ['Draft', 'Bản nháp', 'Continue when you are ready.', 'Tiếp tục khi bạn sẵn sàng.']
  return { title: tr(value[0], value[1]), detail: tr(value[2], value[3]) }
}

const STEP_ISSUE_COPY: Record<string, [string, string, string?]> = {
  passport_image_required: ['Upload the passport data page.', 'Tải lên trang thông tin hộ chiếu.'],
  passport_image_not_verified: ['Finish the passport image check.', 'Hoàn tất kiểm tra ảnh hộ chiếu.'],
  portrait_required: ['Upload the portrait photo.', 'Tải lên ảnh chân dung.'],
  portrait_image_not_verified: ['Finish the portrait image check.', 'Hoàn tất kiểm tra ảnh chân dung.'],
  surname_required: ['Enter the surname.', 'Nhập họ.', 'surname'],
  given_names_required: ['Enter the given and middle names.', 'Nhập tên đệm và tên.', 'givenNames'],
  date_of_birth_required: ['Choose the date of birth.', 'Chọn ngày sinh.', 'dateOfBirth'],
  sex_required: ['Choose the sex.', 'Chọn giới tính.', 'sex'],
  nationality_required: ['Enter the current nationality.', 'Nhập quốc tịch hiện tại.', 'nationality'],
  email_required: ['Enter the email address.', 'Nhập địa chỉ email.', 'email'],
  email_invalid: ['Enter a valid email address.', 'Nhập địa chỉ email hợp lệ.', 'email'],
  place_of_birth_required: ['Enter the place of birth.', 'Nhập nơi sinh.', 'placeOfBirth'],
  other_nationalities_details_required: ['List the other nationalities.', 'Liệt kê các quốc tịch khác.', 'otherNationalities'],
  law_violation_details_required: ['Describe the law violation.', 'Mô tả vi phạm pháp luật.', 'violationDetails'],
  passport_number_required: ['Enter the passport number.', 'Nhập số hộ chiếu.', 'passportNumber'],
  passport_authority_required: ['Enter the passport issuing authority.', 'Nhập cơ quan cấp hộ chiếu.', 'passportAuthority'],
  passport_issue_date_required: ['Choose the passport issue date.', 'Chọn ngày cấp hộ chiếu.', 'passportIssue'],
  passport_expiry_date_required: ['Choose the passport expiry date.', 'Chọn ngày hết hạn hộ chiếu.', 'passportExpiry'],
  passport_dates_invalid: ['Passport expiry must be after its issue date.', 'Ngày hết hạn hộ chiếu phải sau ngày cấp.', 'passportExpiry'],
  other_passport_details_required: ['Describe the other valid passport.', 'Mô tả hộ chiếu hợp lệ khác.', 'otherPassportDetails'],
  permanent_address_required: ['Enter the permanent address.', 'Nhập địa chỉ thường trú.', 'permanentAddress'],
  phone_required: ['Enter the telephone number.', 'Nhập số điện thoại.', 'phone'],
  emergency_contact_required: ['Enter the emergency contact name.', 'Nhập tên liên hệ khẩn cấp.', 'emergencyName'],
  emergency_relationship_required: ['Enter the emergency contact relationship.', 'Nhập mối quan hệ của liên hệ khẩn cấp.', 'emergencyRelationship'],
  emergency_phone_required: ['Enter the emergency contact phone.', 'Nhập số điện thoại liên hệ khẩn cấp.', 'emergencyPhone'],
  occupation_required: ['Enter the occupation.', 'Nhập nghề nghiệp.', 'occupation'],
  visa_start_required: ['Choose when the visa should start.', 'Chọn ngày visa bắt đầu.', 'visaFrom'],
  visa_end_required: ['Choose when the visa should end.', 'Chọn ngày visa kết thúc.', 'visaTo'],
  visa_dates_invalid: ['Visa end must be after its start.', 'Ngày kết thúc visa phải sau ngày bắt đầu.', 'visaTo'],
  visa_period_exceeds_90_days: ['Keep the visa period within 90 inclusive days.', 'Giữ thời hạn visa trong 90 ngày tính cả ngày đầu và cuối.', 'visaTo'],
  purpose_required: ['Enter the purpose of entry.', 'Nhập mục đích nhập cảnh.', 'purpose'],
  entry_date_required: ['Choose the intended entry date.', 'Chọn ngày dự kiến nhập cảnh.', 'entryDate'],
  stay_length_invalid: ['Choose a stay from 1 to 90 days.', 'Chọn thời gian lưu trú từ 1 đến 90 ngày.', 'stayLength'],
  applicant_must_be_outside_vietnam: ['The official e-Visa form requires the applicant to be outside Vietnam.', 'Biểu mẫu E-Visa chính thức yêu cầu người nộp đang ở ngoài Việt Nam.', 'outsideVietnam'],
  vietnam_address_required: ['Enter the first Vietnam address or hotel.', 'Nhập địa chỉ hoặc khách sạn đầu tiên tại Việt Nam.', 'temporaryAddress'],
  vietnam_province_required: ['Enter the Vietnam province or city.', 'Nhập tỉnh hoặc thành phố tại Việt Nam.', 'province'],
  entry_gate_required: ['Choose the entry checkpoint.', 'Chọn cửa khẩu nhập cảnh.', 'entryGate'],
  exit_gate_required: ['Choose the exit checkpoint.', 'Chọn cửa khẩu xuất cảnh.', 'exitGate'],
  previous_visit_details_required: ['Add the previous visit details.', 'Thêm thông tin lần đến trước.', 'previousVisits'],
  relatives_details_required: ['Add the relative details.', 'Thêm thông tin người thân.', 'relativeDetails'],
  insurance_details_required: ['Add the travel insurance details.', 'Thêm thông tin bảo hiểm du lịch.', 'insuranceDetails'],
  children_details_required: ['Add each accompanying child’s details.', 'Thêm thông tin của từng trẻ đi kèm.', 'childrenDetails'],
}

function stepIssueCopy(issue: string, tr: (en: string, vi: string) => string) {
  const copy = STEP_ISSUE_COPY[issue] || [issue.replaceAll('_', ' '), issue.replaceAll('_', ' ')]
  return tr(copy[0], copy[1])
}

function issueFieldId(issue: string) {
  return STEP_ISSUE_COPY[issue]?.[2] || ''
}

function FormField({ id, label, required, children }: { id: string; label: string; required?: boolean; children: React.ReactNode }) {
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground">{label}{required && <span className="sr-only"> required</span>}{children}</label>
}

// Adapter kept from the forum port: reads plain <option> children as DATA (they never
// reach the DOM) and renders eno.vn's ui/select. min-h-11 keeps the 44px tap target —
// a plain h-11 would lose to the trigger's data-[size=default]:h-8 attribute selector.
function VisaSelect({ id, value, onChange, children }: { id: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: React.ReactNode }>(child)) return []
    return [{ value: child.props.value || '', label: child.props.children }]
  })
  const placeholder = options.find((option) => option.value === '')?.label

  return <Select value={value || null} onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}>
    <SelectTrigger id={id} className="min-h-11 w-full rounded-xl bg-card"><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>{options.filter((option) => option.value).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function VisaApplyClient() {
  const { tr } = useLanguage()
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [application, setApplication] = useState<VisaApplication | null>(null)
  const [applications, setApplications] = useState<VisaApplication[]>([])
  const [payload, setPayload] = useState<VisaPayload | null>(null)
  const [payments, setPayments] = useState<VisaPaymentsInfo>(null)
  const [loading, setLoading] = useState(true)
  const [notConfigured, setNotConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [stepIssues, setStepIssues] = useState<string[]>([])
  const [declaration, setDeclaration] = useState(false)
  const [authorization, setAuthorization] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const analysisInFlight = useRef(new Map<string, Promise<VisaAnalysis>>())
  const analysisAttempted = useRef(new Set<string>())
  // Latest tr for callbacks that must NOT re-mint on language change (see loadApplication).
  const trRef = useRef(tr)
  trRef.current = tr

  // Sibling dashboard sections' auth gate — signed-out users go to sign-in and back.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/signin?next=/dashboard/visa')
  }, [authLoading, user, router])

  const analyzeDocument = useCallback((applicationId: string, kind: 'portrait' | 'passport', documentId: string) => {
    const existing = analysisInFlight.current.get(documentId)
    if (existing) return existing
    analysisAttempted.current.add(documentId)
    const request = visaApi<VisaAnalysis>(`/api/visa/applications/${applicationId}/extract`, {
      method: 'POST', body: JSON.stringify({ kind, documentId }),
    })
    analysisInFlight.current.set(documentId, request)
    void request.then(
      () => analysisInFlight.current.delete(documentId),
      () => analysisInFlight.current.delete(documentId),
    )
    return request
  }, [])

  const loadApplication = useCallback(async (background = false) => {
    if (!user) { setApplication(null); setPayload(null); setLoading(false); return }
    if (!background) setLoading(true)
    try {
      const list = await visaApi<{ applications: VisaApplication[]; encryptionReady?: boolean; payments?: VisaPaymentsInfo }>('/api/visa/applications')
      setPayments(list.payments ?? null)
      if (list.encryptionReady === false) { setNotConfigured(true); setApplication(null); setPayload(null); return }
      setNotConfigured(false)
      setApplications(list.applications)
      const active = list.applications.find((item) => !['cancelled'].includes(item.status)) || list.applications[0]
      if (!active) { setApplication(null); setPayload(null); return }
      const detail = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${active.id}`)
      const loadedPayload = detail.application.payload
      setApplication(detail.application); setPayload(loadedPayload ? {
        ...loadedPayload,
        entryGate: loadedPayload.entryGate || DEFAULT_EVISA_ENTRY_GATE,
        exitGate: loadedPayload.exitGate || DEFAULT_EVISA_ENTRY_GATE,
      } : null)
    } catch (error) {
      if (error instanceof VisaApiError && error.code === 'visa_encryption_not_configured') setNotConfigured(true)
      else if (!(error instanceof VisaApiError && error.status === 401)) toast.error(trRef.current('Could not load visa assistance.', 'Không thể tải dịch vụ hỗ trợ visa.'))
    } finally { if (!background) setLoading(false) }
  // ⚠️ tr is deliberately consumed via a ref: the language context re-mints tr on
  // every language/dictionary change, and having it in the deps re-fired the mount
  // effect below as a FOREGROUND load that replaced the in-memory payload with the
  // last-saved server copy — silently discarding unsaved answers on a long
  // government form whenever the user switched language (audit P1 #5).
  }, [user])

  useEffect(() => { if (!authLoading) void loadApplication() }, [authLoading, loadApplication])
  useEffect(() => {
    if (!application || EDITABLE.has(application.status) || ['approved', 'rejected', 'cancelled'].includes(application.status)) return
    const timer = window.setInterval(() => void loadApplication(true), 30_000)
    return () => window.clearInterval(timer)
  }, [application, loadApplication])

  const create = async () => {
    if (!user) return
    setBusy(true)
    try {
      const result = await visaApi<{ application: VisaApplication }>('/api/visa/applications', { method: 'POST' })
      setApplication(result.application); setPayload(result.application.payload || null)
      setStep(0); setStepIssues([]); setDeclaration(false); setAuthorization(false)
    } catch (error) {
      if (error instanceof VisaApiError && error.code === 'visa_encryption_not_configured') setNotConfigured(true)
      else toast.error((error as Error).message.replaceAll('_', ' '))
    } finally { setBusy(false) }
  }

  const deleteAndRestart = async () => {
    if (!application) return
    const applicationId = application.id
    let deleted = false
    setBusy(true)
    try {
      await visaApi<{ deleted: true; id: string }>(`/api/visa/applications/${applicationId}`, { method: 'DELETE' })
      deleted = true
      analysisInFlight.current.clear()
      analysisAttempted.current.clear()
      setApplication(null); setPayload(null); setStep(0); setStepIssues([])
      setDeclaration(false); setAuthorization(false); setDeleteOpen(false)
      const result = await visaApi<{ application: VisaApplication }>('/api/visa/applications', { method: 'POST' })
      setApplication(result.application); setPayload(result.application.payload || null)
      toast.success(tr('Old application deleted. Your new blank application is ready.', 'Đã xóa hồ sơ cũ. Hồ sơ mới trống đã sẵn sàng.'))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      if (deleted) {
        toast.error(tr('The old application was deleted, but a new one could not be started. Use “Start private application” to try again.', 'Hồ sơ cũ đã được xóa nhưng chưa thể tạo hồ sơ mới. Hãy dùng “Bắt đầu hồ sơ riêng tư” để thử lại.'))
      } else {
        toast.error(tr('Could not finish deleting this application. Please retry.', 'Chưa thể hoàn tất việc xóa hồ sơ này. Vui lòng thử lại.'))
      }
    } finally { setBusy(false) }
  }

  const deleteDialog = application ? (
    <Dialog open={deleteOpen} onOpenChange={(open) => { if (!busy) setDeleteOpen(open) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
          <DialogTitle className="text-lg font-bold">{tr('Delete and start over?', 'Xóa và bắt đầu lại?')}</DialogTitle>
          <DialogDescription>{tr('This permanently removes this application, its answers, uploaded documents, and case history from eno. A new blank application will open. This cannot be undone.', 'Thao tác này xóa vĩnh viễn hồ sơ, câu trả lời, giấy tờ đã tải lên và lịch sử xử lý khỏi eno. Một hồ sơ mới trống sẽ mở ra. Không thể hoàn tác.')}</DialogDescription>
        </DialogHeader>
        {['submitted', 'payment_required', 'processing', 'approved'].includes(application.status) && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">{tr('Deleting eno’s copy does not withdraw or erase an application already sent to the Vietnamese authority.', 'Việc xóa bản lưu tại eno không rút lại hoặc xóa hồ sơ đã gửi đến cơ quan chức năng Việt Nam.')}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => setDeleteOpen(false)}>{tr('Keep application', 'Giữ hồ sơ')}</Button>
          <Button type="button" variant="destructive" className="h-11" data-testid="delete-visa-application-confirm" disabled={busy} onClick={() => void deleteAndRestart()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{tr('Delete and start over', 'Xóa và bắt đầu lại')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null

  const set = <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => {
    setStepIssues([])
    setPayload((current) => current ? { ...current, [key]: value } : current)
  }

  const save = async (announce = true) => {
    if (!application || !payload) return null
    const result = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}`, {
      method: 'PATCH', body: JSON.stringify({ payload }),
    })
    setApplication(result.application); setPayload(result.application.payload || payload)
    if (announce) toast.success(tr('Draft saved privately.', 'Bản nháp đã được lưu riêng tư.'))
    return result.application
  }

  const next = async () => {
    if (!application || !payload || step > 2) return
    const issues = validateVisaStep(payload, application.documents.map((document) => ({ kind: document.kind, validation_status: document.validationStatus })), step as 0 | 1 | 2)
    if (issues.length) {
      setStepIssues(issues)
      toast.error(tr('Finish this page before continuing.', 'Hoàn thành trang này trước khi tiếp tục.'))
      window.requestAnimationFrame(() => document.getElementById(issueFieldId(issues[0]))?.focus())
      return
    }
    setStepIssues([])
    setBusy(true)
    try { await save(false); setStep((value) => Math.min(3, value + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }

  const upload = async (kind: 'portrait' | 'passport', file: File | null) => {
    if (!file || !application || !payload) return
    setStepIssues([])
    setBusy(true)
    const toastId = `visa-${kind}-upload`
    try {
      toast.loading(tr('Preparing image automatically…', 'Đang tự động chuẩn bị ảnh…'), { id: toastId })
      const preparedFile = await prepareImageForUpload(file)
      const form = new FormData(); form.set('kind', kind); form.set('file', preparedFile)
      const result = await visaApi<{ document: VisaDocument }>(`/api/visa/applications/${application.id}/documents`, { method: 'POST', body: form })
      setApplication((current) => current ? { ...current, documents: [...current.documents.filter((item) => item.kind !== kind), result.document] } : current)
      toast.loading(kind === 'passport' ? tr('Checking the page and filling passport fields…', 'Đang kiểm tra trang và điền thông tin hộ chiếu…') : tr('Checking the portrait against official rules…', 'Đang kiểm tra ảnh chân dung theo quy định chính thức…'), { id: toastId })
      const analyzed = await analyzeDocument(application.id, kind, result.document.id)
      const checkedDocument = { ...result.document, ...analyzed.document }
      setApplication((current) => current ? { ...current, documents: [...current.documents.filter((item) => item.kind !== kind), checkedDocument] } : current)
      if (analyzed.payload) setPayload(analyzed.payload)
      if (analyzed.document.validationStatus === 'passed') {
        const message = kind === 'passport' && analyzed.warnings?.length
          ? tr(`Passport accepted and ${analyzed.suggestions.length} fields filled. eno will verify the page framing during review.`, `Đã chấp nhận hộ chiếu và điền ${analyzed.suggestions.length} trường. eno sẽ kiểm tra khung trang khi xem xét.`)
          : kind === 'passport'
          ? tr(`Passport verified and ${analyzed.suggestions.length} fields filled. Check them before submission.`, `Đã xác minh hộ chiếu và điền ${analyzed.suggestions.length} trường. Hãy kiểm tra trước khi nộp.`)
          : tr('Portrait verified and formatted for the official upload.', 'Ảnh chân dung đã được xác minh và định dạng cho cổng chính thức.')
        toast.success(message, { id: toastId })
      } else {
        toast.error(analyzed.issues.length ? imageIssueCopy(analyzed.issues[0], tr) : tr('Use another image.', 'Hãy dùng ảnh khác.'), { id: toastId })
      }
    } catch (error) {
      toast.error(uploadErrorCopy(error, tr), { id: toastId })
      await loadApplication(true).catch(() => undefined)
    } finally { setBusy(false) }
  }

  const pendingDocument = application?.documents.find((document) => (document.kind === 'passport' || document.kind === 'portrait') && document.validationStatus === 'pending')

  useEffect(() => {
    if (!application || !EDITABLE.has(application.status) || !pendingDocument || analysisAttempted.current.has(pendingDocument.id)) return
    const pending = pendingDocument
    let active = true
    const check = async () => {
      setBusy(true)
      const toastId = `visa-${pending.kind}-upload`
      toast.loading(tr('Finishing the automatic image check…', 'Đang hoàn tất kiểm tra ảnh tự động…'), { id: toastId })
      try {
        const analyzed = await analyzeDocument(application.id, pending.kind as 'portrait' | 'passport', pending.id)
        if (!active) return
        setApplication((current) => current ? { ...current, documents: current.documents.map((document) => document.id === pending.id ? { ...document, ...analyzed.document } : document) } : current)
        if (analyzed.payload) setPayload(analyzed.payload)
        if (analyzed.document.validationStatus === 'passed') toast.success(tr('Image verified.', 'Ảnh đã được xác minh.'), { id: toastId })
        else toast.error(analyzed.issues.length ? imageIssueCopy(analyzed.issues[0], tr) : tr('Use another image.', 'Hãy dùng ảnh khác.'), { id: toastId })
      } catch (error) {
        if (active) {
          toast.error(uploadErrorCopy(error, tr), { id: toastId })
          await loadApplication(true)
        }
      } finally { if (active) setBusy(false) }
    }
    void check()
    return () => { active = false }
  }, [analyzeDocument, application, loadApplication, pendingDocument, tr])

  const retryImageAnalysis = async (kind: 'portrait' | 'passport', documentId: string) => {
    if (!application) return
    setStepIssues([])
    setBusy(true)
    const toastId = `visa-${kind}-upload`
    toast.loading(tr('Retrying the automatic image check…', 'Đang thử lại kiểm tra ảnh tự động…'), { id: toastId })
    try {
      const analyzed = await analyzeDocument(application.id, kind, documentId)
      setApplication((current) => current ? { ...current, documents: current.documents.map((document) => document.id === documentId ? { ...document, ...analyzed.document } : document) } : current)
      if (analyzed.payload) setPayload(analyzed.payload)
      if (analyzed.document.validationStatus === 'passed') toast.success(tr('Image verified.', 'Ảnh đã được xác minh.'), { id: toastId })
      else toast.error(analyzed.issues.length ? imageIssueCopy(analyzed.issues[0], tr) : tr('Use another image.', 'Hãy dùng ảnh khác.'), { id: toastId })
    } catch (error) {
      toast.error(uploadErrorCopy(error, tr), { id: toastId })
      await loadApplication(true)
    } finally { setBusy(false) }
  }

  // Server said application_incomplete → jump to the first failing step and focus its
  // field (shared by direct submit and checkout — both validate server-side first).
  const jumpToIncompleteStep = () => {
    if (!application || !payload) return
    const documents = application.documents.map((document) => ({ kind: document.kind, validation_status: document.validationStatus }))
    const incompleteStep = ([0, 1, 2] as const).find((candidate) => validateVisaStep(payload, documents, candidate).length)
    if (incompleteStep !== undefined) {
      const issues = validateVisaStep(payload, documents, incompleteStep)
      setStep(incompleteStep); setStepIssues(issues)
      window.requestAnimationFrame(() => document.getElementById(issueFieldId(issues[0]))?.focus())
    }
    toast.error(tr('One earlier page needs attention.', 'Một trang trước đó cần được kiểm tra.'))
  }

  const submitForReview = async () => {
    if (!application || !payload || !declaration || !authorization) return
    setBusy(true)
    try {
      await save(false)
      const result = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}/submit`, { method: 'POST', body: JSON.stringify({ action: 'send_for_review', declarationAccepted: true, prefillAuthorized: true }) })
      setApplication(result.application); setPayload(result.application.payload || payload); toast.success(tr('Complete application submitted to eno.', 'Đã gửi hồ sơ hoàn chỉnh đến eno.'))
    } catch (error) {
      if (error instanceof VisaApiError && error.code === 'application_incomplete') jumpToIncompleteStep()
      else toast.error((error as Error).message.replaceAll('_', ' '))
      const detail = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}`).catch(() => null)
      if (detail) setApplication(detail.application)
    } finally { setBusy(false) }
  }

  // Pay-and-submit: save the draft, open the provider's hosted checkout, and let the
  // SERVER complete the review handoff once the provider confirms payment (webhook or
  // the confirm-on-return effect below). Consents are required here exactly like the
  // direct submit — they are stamped server-side onto the payment row at checkout.
  const startCheckout = async (provider: 'stripe' | 'paypal') => {
    if (!application || !payload || !declaration || !authorization) return
    setBusy(true)
    try {
      await save(false)
      const result = await visaApi<{ url: string }>(`/api/visa/applications/${application.id}/checkout`, {
        method: 'POST', body: JSON.stringify({ provider, declarationAccepted: true, prefillAuthorized: true }),
      })
      // Leaving for the provider — keep busy=true so the CTA can't double-fire.
      window.location.assign(result.url)
    } catch (error) {
      if (error instanceof VisaApiError && error.code === 'application_incomplete') jumpToIncompleteStep()
      else if (error instanceof VisaApiError && error.code === 'already_paid') {
        toast.message(tr('Your service fee is already paid — submit the application below.', 'Phí dịch vụ đã được thanh toán — hãy gửi hồ sơ bên dưới.'))
        await loadApplication(true).catch(() => undefined)
      }
      else toast.error(tr('The payment page could not be opened. Please try again.', 'Không thể mở trang thanh toán. Vui lòng thử lại.'))
      setBusy(false)
    }
  }

  // Back from Stripe/PayPal: ?paid=<provider>&aid=<application>&sid|token=<ref>.
  // The provider is re-verified SERVER-side (confirm route) — these params only tell
  // the client which confirmation to ask for. Runs once, then cleans the URL. The
  // Stripe webhook makes this a fallback: whichever lands first wins, idempotently.
  const search = useSearchParams()
  const returnHandled = useRef(false)
  useEffect(() => {
    if (authLoading || !user || returnHandled.current) return
    const paid = search.get('paid')
    const cancelled = search.get('pay') === 'cancelled'
    if (!paid && !cancelled) return
    returnHandled.current = true
    const aid = search.get('aid') || ''
    const ref = paid === 'stripe' ? search.get('sid') : search.get('token')
    router.replace('/dashboard/visa')
    if (cancelled) {
      toast.message(tr('Payment cancelled — your application is unchanged.', 'Đã hủy thanh toán — hồ sơ của bạn không thay đổi.'))
      return
    }
    if ((paid !== 'stripe' && paid !== 'paypal') || !aid || !ref) return
    void (async () => {
      const toastId = 'visa-pay-confirm'
      toast.loading(tr('Confirming your payment…', 'Đang xác nhận thanh toán…'), { id: toastId })
      try {
        const result = await visaApi<{ application: VisaApplication; handedOff: boolean }>(`/api/visa/applications/${aid}/payment/confirm`, {
          method: 'POST', body: JSON.stringify({ provider: paid, ref }),
        })
        setApplication(result.application)
        if (result.application.payload) setPayload(result.application.payload)
        toast.success(result.handedOff
          ? tr('Payment received — your application is now with eno for review.', 'Đã nhận thanh toán — hồ sơ của bạn đang được eno xem xét.')
          : tr('Payment received.', 'Đã nhận thanh toán.'), { id: toastId })
        await loadApplication(true).catch(() => undefined)
      } catch {
        toast.error(tr('Payment could not be confirmed yet. If you completed it, it will be recorded automatically in a moment.', 'Chưa thể xác nhận thanh toán. Nếu bạn đã hoàn tất, hệ thống sẽ tự động ghi nhận trong giây lát.'), { id: toastId })
        await loadApplication(true).catch(() => undefined)
      }
    })()
  }, [authLoading, user, search, router, loadApplication, tr])

  const approvePrefill = async () => {
    if (!application || !declaration || !authorization) return
    setBusy(true)
    try {
      const result = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}/submit`, { method: 'POST', body: JSON.stringify({ action: 'approve_for_prefill', declarationAccepted: true, prefillAuthorized: true }) })
      setApplication(result.application); toast.success(tr('Final approval recorded.', 'Đã ghi nhận phê duyệt cuối cùng.'))
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }

  const downloadResult = async () => {
    if (!application) return
    const result = application.documents.find((item) => item.kind === 'result')
    if (!result) return
    const preview = window.open('about:blank', '_blank')
    if (preview) preview.opener = null
    try {
      const signed = await visaApi<{ url: string }>(`/api/visa/applications/${application.id}/documents/${result.id}`)
      if (preview) preview.location.href = signed.url
      else window.location.assign(signed.url)
    } catch (error) {
      preview?.close()
      toast.error((error as Error).message.replaceAll('_', ' '))
    }
  }

  // Native stack-nav title bar (mobile only) — this IS the /dashboard/visa section
  // (the assistant opens directly, owner 2026-07-18), so Back falls to the default.
  const sectionHeader = <SectionHeader title={tr('Vietnam e-Visa', 'E-Visa Việt Nam')} />

  if (authLoading || !user || (loading && user)) {
    return (
      <>
        {sectionHeader}
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      </>
    )
  }

  if (notConfigured) {
    // Honest env-absent state: the shared visa rows are ENCRYPTED and this host has no
    // VISA_DATA_ENCRYPTION_KEY yet (src/lib/visa/crypto.ts) — never broken crypto UI.
    return (
      <>
        {sectionHeader}
        <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Vietnam e-Visa', 'E-Visa Việt Nam')}</h1>
        <div className="mt-6">
          <EmptyState
            icon={LockKeyhole}
            title={tr('The e-Visa assistant is not configured on this host yet', 'Trợ lý e-Visa chưa được thiết lập trên máy chủ này')}
            subtitle={tr(
              'Your applications and documents are safe and encrypted. An administrator must finish setting up the assistant on eno.vn before it can open here.',
              'Hồ sơ và giấy tờ của bạn vẫn an toàn và được mã hóa. Quản trị viên cần hoàn tất thiết lập trợ lý trên eno.vn trước khi mở được tại đây.',
            )}
            action={
              <Button variant="outline" asChild>
                <Link href="/dashboard">{tr('Back to your dashboard', 'Quay lại bảng điều khiển')}</Link>
              </Button>
            }
          />
        </div>
      </>
    )
  }

  if (!application || !payload) return (
    <>
      {sectionHeader}
      <div className="mx-auto w-full max-w-5xl py-4 sm:py-8">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <Badge variant="brand"><FileCheck2 className="h-3.5 w-3.5" />{tr('Assisted Vietnam e-Visa', 'Hỗ trợ E-Visa Việt Nam')}</Badge>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{tr('One guided application. Every answer stays yours.', 'Một hồ sơ có hướng dẫn. Mọi câu trả lời vẫn thuộc về bạn.')}</h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-body">{tr('Upload the two required images, let eno draft clearly visible passport fields, review the official answers, and receive the result in one private place.', 'Tải lên hai ảnh bắt buộc, để eno tạo nháp các trường rõ ràng trên hộ chiếu, kiểm tra câu trả lời chính thức và nhận kết quả tại một nơi riêng tư.')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" variant="cta" size="lg" disabled={busy} onClick={() => void create()}>{tr('Start private application', 'Bắt đầu hồ sơ riêng tư')}<ChevronRight className="h-4 w-4" /></Button>
              <a href="https://evisa.gov.vn/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-xl border border-line-strong bg-card px-4 text-sm font-semibold text-body hover:border-brand">{tr('Official e-Visa website', 'Trang E-Visa chính thức')}</a>
            </div>
          </div>
          <Card className="bg-card">
            <CardContent className="space-y-5 py-2">
              {[['1', 'Passport + portrait', 'Hộ chiếu + ảnh chân dung'], ['2', 'Review extracted fields', 'Kiểm tra trường đã trích xuất'], ['3', 'Submit once for eno review', 'Gửi một lần để eno xem xét'], ['4', 'Track and download', 'Theo dõi và tải kết quả']].map(([number, en, vi]) => <div key={number} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{number}</span><p className="pt-1 text-sm font-semibold text-foreground">{tr(en, vi)}</p></div>)}
              <p className="border-t border-border pt-4 text-xs leading-relaxed text-body">{tr('eno is an independent assistance service, not a government agency. Approval is decided only by Vietnamese authorities. Official fees and eno service fees are confirmed separately in writing before payment.', 'eno là dịch vụ hỗ trợ độc lập, không phải cơ quan nhà nước. Việc phê duyệt chỉ do cơ quan chức năng Việt Nam quyết định. Lệ phí chính thức và phí dịch vụ eno được xác nhận riêng bằng văn bản trước thanh toán.')}</p>
            </CardContent>
          </Card>
        </div>
        <PastApplications applications={applications} activeId={null} tr={tr} />
      </div>
    </>
  )

  if (!EDITABLE.has(application.status)) {
    const copy = statusCopy(application.status, tr)
    const result = application.documents.find((item) => item.kind === 'result')
    return (
      <>
        {sectionHeader}
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'destructive' : 'brand'}>{copy.title}</Badge>{application.paidAt && <Badge variant="success"><Check className="h-3 w-3" />{tr('Service fee paid', 'Đã thanh toán phí dịch vụ')}</Badge>}<span className="text-xs text-ink-4">{application.id.slice(0, 8)}</span></div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">{copy.title}</h1><p className="mt-2 text-body">{copy.detail}</p>
          {payload.adminMessage && <Card className="mt-6"><CardHeader><CardTitle>{tr('Private update from eno', 'Cập nhật riêng từ eno')}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-body">{payload.adminMessage}</p></CardContent></Card>}
          {application.status === 'applicant_approval' && (
            <Card className="mt-6">
              <CardHeader><CardTitle>{tr('Final applicant authorization', 'Ủy quyền cuối cùng của người nộp')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-body">{tr('Compare the details below with your passport and trip. eno will use only this approved snapshot to prepare the official form.', 'Đối chiếu thông tin bên dưới với hộ chiếu và chuyến đi. eno chỉ dùng bản đã duyệt này để chuẩn bị biểu mẫu chính thức.')}</p>
                <ReviewGrid payload={payload} tr={tr} />
                <Consent checked={declaration} onChange={setDeclaration}>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</Consent>
                <Consent checked={authorization} onChange={setAuthorization}>{tr('I authorize eno to transfer these approved answers and images into a temporary secure hosted browser and prefill the official website. Browser recording, session logs, and automatic CAPTCHA solving are disabled. A person must still review the official form before declaration, payment, and submission.', 'Tôi cho phép eno chuyển các câu trả lời và hình ảnh đã duyệt này vào trình duyệt lưu trữ bảo mật tạm thời và điền trước trang web chính thức. Tính năng ghi hình trình duyệt, nhật ký phiên và tự động giải CAPTCHA đều bị tắt. Một người vẫn phải kiểm tra biểu mẫu chính thức trước khi xác nhận, thanh toán và nộp hồ sơ.')}</Consent>
                <Button type="button" variant="cta" className="h-11" disabled={busy || !declaration || !authorization} onClick={() => void approvePrefill()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{tr('Approve for official prefill', 'Duyệt để điền biểu mẫu chính thức')}</Button>
              </CardContent>
            </Card>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            {result && <Button type="button" variant="cta" size="lg" onClick={() => void downloadResult()}><Download className="h-4 w-4" />{tr('Download official e-Visa PDF', 'Tải PDF E-Visa chính thức')}</Button>}
            {['approved', 'rejected', 'cancelled'].includes(application.status) && <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => void create()}>{tr('Start a new application', 'Bắt đầu hồ sơ mới')}</Button>}
            <Button type="button" variant="outline" size="lg" className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />{tr('Delete application', 'Xóa hồ sơ')}</Button>
          </div>
          <Card className="mt-6"><CardHeader><CardTitle>{tr('Case timeline', 'Tiến trình hồ sơ')}</CardTitle></CardHeader><CardContent><ol className="space-y-4">{(application.events || []).map((event) => <li key={event.id} className="flex items-start justify-between gap-4 border-l-2 border-brand/30 pl-3"><span className="text-sm font-medium capitalize text-foreground">{event.event.replaceAll('_', ' ')}</span><time className="shrink-0 text-xs text-ink-4">{new Date(event.createdAt).toLocaleDateString()}</time></li>)}</ol></CardContent></Card>
          <PastApplications applications={applications} activeId={application.id} tr={tr} />
          {deleteDialog}
        </div>
      </>
    )
  }

  return (
    <>
      {sectionHeader}
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge variant="brand"><LockKeyhole className="h-3.5 w-3.5" />{tr('Private application', 'Hồ sơ riêng tư')}</Badge>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">{tr('Vietnam e-Visa assistance', 'Hỗ trợ E-Visa Việt Nam')}</h1>
            <p className="mt-2 max-w-3xl text-sm text-body">{tr('Four short stages. Submit once, then eno reviews and prepares the official form. Nothing is finally submitted to the government without a human accuracy check.', 'Bốn bước ngắn. Gửi một lần, sau đó eno xem xét và chuẩn bị biểu mẫu chính thức. Không hồ sơ nào được nộp chính thức cho cơ quan chức năng nếu chưa được kiểm tra thủ công.')}</p>
          </div>
          <Button type="button" variant="outline" className="h-11 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" data-testid="delete-visa-application" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />{tr('Delete application', 'Xóa hồ sơ')}</Button>
        </div>
        {application.status === 'needs_changes' && payload.adminMessage && <div className="mb-5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"><strong>{tr('Changes requested:', 'Yêu cầu chỉnh sửa:')}</strong> {payload.adminMessage}</div>}

        <div className="mb-5 flex gap-3 rounded-2xl border border-brand/20 bg-accent/40 p-4 text-sm leading-relaxed text-body">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
          <p><strong className="text-foreground">{tr('Common traveler answers are prefilled.', 'Các câu trả lời phổ biến của du khách đã được điền sẵn.')}</strong> {tr('They are suggestions, not assumptions about you. Change any answer that differs before confirming: ordinary passport, no additional passport or nationality, no legal violations, single-entry tourism, currently outside Vietnam, self-funded by credit card, no recent visit, relatives, accompanying children, or insurance, a 90-day validity and stay, USD 1,000 estimated expenses, and religion None.', 'Đây là gợi ý, không phải giả định về bạn. Hãy thay đổi mọi câu trả lời không đúng trước khi xác nhận: hộ chiếu phổ thông, không có hộ chiếu hoặc quốc tịch khác, không vi phạm pháp luật, du lịch nhập cảnh một lần, hiện ở ngoài Việt Nam, tự chi trả bằng thẻ tín dụng, không đến Việt Nam gần đây, không có người thân, trẻ đi kèm hoặc bảo hiểm, thời hạn và lưu trú 90 ngày, chi phí dự kiến 1.000 USD và tôn giáo Không.')}</p>
        </div>

        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label={tr('Application progress', 'Tiến trình hồ sơ')}>
          {STEPS.map((label, index) => <li key={label}><Button type="button" variant="bare" size="none" aria-current={index === step ? 'step' : undefined} disabled={index > step} onClick={() => { if (index < step) { setStepIssues([]); setStep(index) } }} className={cn('flex h-11 w-full items-center justify-center rounded-xl border px-2 text-xs font-bold transition-[border-color,background-color,color,box-shadow,transform] duration-200 disabled:cursor-not-allowed', index === step ? 'border-brand bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_var(--brand)]' : index < step ? 'border-line-strong bg-card text-foreground hover:border-brand/60 hover:bg-accent/30' : 'border-border bg-tint text-body')}><span className="sm:hidden">{index + 1}</span><span className="hidden sm:inline">{index + 1}. {tr(label, ['Giấy tờ', 'Thông tin', 'Chuyến đi', 'Kiểm tra'][index])}</span></Button></li>)}
        </ol>

        {stepIssues.length > 0 && <StepIssues issues={stepIssues} tr={tr} />}
        <div key={step} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          {step === 0 && <DocumentsStep application={application} upload={upload} retry={retryImageAnalysis} busy={busy} tr={tr} />}
          {step === 1 && <PersonalStep payload={payload} set={set} tr={tr} />}
          {step === 2 && <TripStep payload={payload} set={set} tr={tr} />}
          {step === 3 && (
            <div className="space-y-5">
            <Card><CardHeader><CardTitle>{tr('Review everything', 'Kiểm tra mọi thông tin')}</CardTitle></CardHeader><CardContent><ReviewGrid payload={payload} tr={tr} /></CardContent></Card>
            <Consent checked={declaration} onChange={setDeclaration}>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</Consent>
            <Consent checked={authorization} onChange={setAuthorization}>{tr('I authorize eno to transfer this approved snapshot and its images into a private hosted browser to prefill the official e-Visa form after eno review. A person must still compare the form and handle the declaration, CAPTCHA, payment, and submission.', 'Tôi cho phép eno chuyển bản thông tin đã duyệt và hình ảnh vào trình duyệt riêng để điền trước biểu mẫu E-Visa chính thức sau khi eno xem xét. Một người vẫn phải đối chiếu biểu mẫu và thực hiện xác nhận, CAPTCHA, thanh toán và nộp hồ sơ.')}</Consent>
            <p className="text-xs leading-relaxed text-body">{tr('This is the only approval eno normally needs. We will contact you only if information or an image must be corrected.', 'Đây thường là lần phê duyệt duy nhất eno cần. Chúng tôi chỉ liên hệ nếu thông tin hoặc hình ảnh cần chỉnh sửa.')}</p>
            {payments && !application.paidAt ? (
              // Pay-before-review gate: the case reaches eno review only after the
              // service fee is paid. Checkout is the provider's HOSTED page (redirect);
              // the server verifies payment and completes the handoff itself.
              <div className="rounded-2xl border border-brand/20 bg-accent/40 p-4">
                <p className="text-sm font-bold text-foreground">
                  {tr('eno service fee', 'Phí dịch vụ eno')}: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(payments.feeCents / 100)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-body">{tr('Paid once, securely, on the provider’s own page. Your application reaches eno review right after payment. Government e-Visa fees are separate and paid to the authority.', 'Thanh toán một lần, an toàn, trên trang của nhà cung cấp. Hồ sơ được chuyển cho eno xem xét ngay sau khi thanh toán. Lệ phí e-Visa của nhà nước là khoản riêng, nộp cho cơ quan chức năng.')}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {payments.providers.includes('stripe') && (
                    <Button type="button" variant="cta" size="lg" className="h-11 w-full sm:w-auto" disabled={busy || !declaration || !authorization} onClick={() => void startCheckout('stripe')}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}{tr('Pay by card & submit', 'Thanh toán thẻ & gửi hồ sơ')}
                    </Button>
                  )}
                  {payments.providers.includes('paypal') && (
                    <Button type="button" variant="outline" size="lg" className="h-11 w-full sm:w-auto" disabled={busy || !declaration || !authorization} onClick={() => void startCheckout('paypal')}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}{tr('Pay with PayPal & submit', 'Thanh toán PayPal & gửi hồ sơ')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="cta" size="lg" className="h-11 w-full sm:w-auto" disabled={busy || !declaration || !authorization} onClick={() => void submitForReview()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}{tr('Submit complete application', 'Gửi hồ sơ hoàn chỉnh')}</Button>
                {application.paidAt && <Badge variant="success"><Check className="h-3 w-3" />{tr('Service fee paid', 'Đã thanh toán phí dịch vụ')}</Badge>}
              </div>
            )}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="outline" className="h-11" disabled={busy || step === 0} onClick={() => { setStepIssues([]); setStep((value) => Math.max(0, value - 1)) }}><ChevronLeft className="h-4 w-4" />{tr('Back', 'Quay lại')}</Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void save()}>{tr('Save draft', 'Lưu bản nháp')}</Button>
            {step < 3 && <Button type="button" variant="cta" className="h-11" disabled={busy} onClick={() => void next()}>{tr('Save and continue', 'Lưu và tiếp tục')}<ChevronRight className="h-4 w-4" /></Button>}
          </div>
        </div>
        <PastApplications applications={applications} activeId={application.id} tr={tr} />
        {deleteDialog}
      </div>
    </>
  )
}

// Status → badge tone for the history rows below the assistant. Keys are the statuses
// the visa routes actually write; anything unrecognized falls back to a neutral chip
// showing the raw word, so a NEW status degrades to ugly-but-honest instead of crashing.
// (Ported from the retired /dashboard/visa list client, 2026-07-18.)
const HISTORY_STATUS: Record<string, { en: string; vi: string; variant: 'neutral' | 'brand' | 'success' | 'warning' | 'destructive' }> = {
  draft: { en: 'Draft', vi: 'Bản nháp', variant: 'neutral' },
  needs_changes: { en: 'Changes requested', vi: 'Cần chỉnh sửa', variant: 'warning' },
  ready_for_review: { en: 'In review', vi: 'Đang xem xét', variant: 'brand' },
  under_review: { en: 'In review', vi: 'Đang xem xét', variant: 'warning' },
  applicant_approval: { en: 'Awaiting your approval', vi: 'Chờ bạn duyệt', variant: 'warning' },
  ready_to_submit: { en: 'Ready to submit', vi: 'Sẵn sàng nộp', variant: 'brand' },
  processing: { en: 'Processing', vi: 'Đang xử lý', variant: 'warning' },
  submitted: { en: 'Submitted', vi: 'Đã nộp', variant: 'brand' },
  payment_required: { en: 'Payment needed', vi: 'Cần thanh toán', variant: 'warning' },
  approved: { en: 'Approved', vi: 'Đã duyệt', variant: 'success' },
  rejected: { en: 'Rejected', vi: 'Bị từ chối', variant: 'destructive' },
  cancelled: { en: 'Cancelled', vi: 'Đã hủy', variant: 'neutral' },
}

/** Compact history of the account's OTHER applications (the active one renders above
 *  as the assistant itself) — the trips-section "saved feed" idiom. Rows are static:
 *  there is no per-application page; the assistant always resumes the active case. */
function PastApplications({ applications, activeId, tr }: {
  applications: VisaApplication[]
  activeId: string | null
  tr: (en: string, vi: string) => string
}) {
  const rows = applications.filter((item) => item.id !== activeId)
  if (!rows.length) return null
  return (
    <section aria-labelledby="visa-history-title" className="mt-10 border-t border-border pt-6">
      <h2 id="visa-history-title" className="text-base font-bold text-foreground">{tr('Previous applications', 'Hồ sơ trước đây')}</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((item) => {
          const s = HISTORY_STATUS[item.status]
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint"><FileCheck2 className="h-4 w-4 text-ink-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={s?.variant ?? 'neutral'}>{s ? tr(s.en, s.vi) : item.status}</Badge>
                  {item.paidAt && <Badge variant="success">{tr('Fee paid', 'Đã trả phí')}</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-4">
                  {tr('Updated', 'Cập nhật')} {new Date(item.updatedAt).toLocaleDateString()} · {item.documents.length} {tr('documents', 'tài liệu')} · {item.id.slice(0, 8)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  // ui/checkbox (Base UI) instead of the forum's raw <input type="checkbox">: the label
  // wrap keeps the whole card clickable — label activation lands on Base UI's hidden
  // form input, which toggles the Root.
  return <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-card p-4 text-sm leading-relaxed text-body"><Checkbox checked={checked} onChange={onChange} className="mt-1" /><span>{children}</span></label>
}

function StepIssues({ issues, tr }: { issues: string[]; tr: (en: string, vi: string) => string }) {
  return <div role="alert" className="mb-5 animate-in fade-in slide-in-from-top-1 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 duration-200">
    <p className="text-sm font-bold text-destructive">{tr('Complete this page to continue', 'Hoàn thành trang này để tiếp tục')}</p>
    <ul className="mt-2 grid gap-1.5 text-sm text-destructive sm:grid-cols-2">{issues.map((issue) => <li key={issue}>• {stepIssueCopy(issue, tr)}</li>)}</ul>
  </div>
}

function DocumentsStep({ application, upload, retry, busy, tr }: { application: VisaApplication; upload: (kind: 'portrait' | 'passport', file: File | null) => void; retry: (kind: 'portrait' | 'passport', documentId: string) => void; busy: boolean; tr: (en: string, vi: string) => string }) {
  const documentFor = (kind: string) => application.documents.find((item) => item.kind === kind)
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2">
      <UploadCard kind="passport" title={tr('Passport data page', 'Trang thông tin hộ chiếu')} detail={tr('One clear, complete page with all four corners and both MRZ lines visible. We convert and compress it automatically.', 'Một trang đầy đủ, rõ nét, thấy đủ bốn góc và hai dòng MRZ. Chúng tôi tự động chuyển đổi và nén ảnh.')} document={documentFor('passport')} busy={busy} onFile={(file) => upload('passport', file)} onRetry={(documentId) => retry('passport', documentId)} tr={tr} />
      <UploadCard kind="portrait" title={tr('Portrait photo', 'Ảnh chân dung')} detail={tr('Recent 4×6 portrait: straight face, no hat or glasses, formal clothes, plain white background. We format it automatically.', 'Ảnh 4×6 mới chụp: nhìn thẳng, không mũ hoặc kính, trang phục lịch sự, nền trắng trơn. Chúng tôi tự động định dạng.')} document={documentFor('portrait')} busy={busy} onFile={(file) => upload('portrait', file)} onRetry={(documentId) => retry('portrait', documentId)} tr={tr} />
    </div>
    <p className="flex gap-2 rounded-2xl border border-brand/20 bg-accent/40 p-4 text-sm leading-relaxed text-body"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" /><span>{tr('Uploading starts a private automatic check. eno converts each image to the official JPG and size, checks visible requirements, reads every usable passport field, cross-checks the MRZ, and fills your draft immediately. Unclear values stay blank; you review all answers before anything is submitted.', 'Khi tải lên, hệ thống bắt đầu kiểm tra tự động riêng tư. eno chuyển từng ảnh sang JPG và kích thước chính thức, kiểm tra yêu cầu hiển thị, đọc mọi trường hộ chiếu có thể dùng, đối chiếu MRZ và điền ngay vào bản nháp. Giá trị không rõ sẽ để trống; bạn kiểm tra tất cả trước khi nộp.')}</span></p>
    <p className="flex gap-2 rounded-2xl bg-tint p-4 text-xs leading-relaxed text-body"><LockKeyhole className="h-4 w-4 shrink-0" />{tr('Documents are stored in a private bucket and opened only through short-lived owner/admin links. Do not upload a document that is not yours.', 'Giấy tờ được lưu trong kho riêng tư và chỉ mở qua liên kết ngắn hạn cho chủ sở hữu/quản trị viên. Không tải lên giấy tờ không thuộc về bạn.')}</p>
  </div>
}

function UploadCard({ kind, title, detail, document, busy, onFile, onRetry, tr }: { kind: 'portrait' | 'passport'; title: string; detail: string; document?: VisaDocument; busy: boolean; onFile: (file: File | null) => void; onRetry: (documentId: string) => void; tr: (en: string, vi: string) => string }) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const ready = document?.validationStatus === 'passed'
  const failed = document?.validationStatus === 'failed'
  const unavailable = document?.validationStatus === 'unavailable'
  const issues = document?.validationReport?.issues || []
  const warnings = document?.validationReport?.warnings || []
  const corrections = document?.validationReport?.corrections || []

  const receiveFile = (file: File | null) => {
    dragDepth.current = 0
    setDragging(false)
    if (!file || busy) return
    const acceptedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    const acceptedExtension = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
    if (!acceptedMime.includes(file.type.toLowerCase()) && !acceptedExtension) {
      toast.error(tr('Use JPG, PNG, WebP, HEIC, or HEIF.', 'Vui lòng dùng JPG, PNG, WebP, HEIC hoặc HEIF.'))
      return
    }
    onFile(file)
  }

  return (
    <Card
      data-testid={`visa-${kind}-dropzone`}
      onDragEnter={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (busy) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        event.stopPropagation()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        receiveFile(event.dataTransfer.files?.[0] || null)
      }}
      className={cn(
        'border transition-[border-color,background-color,box-shadow,transform,opacity] duration-200',
        ready ? 'border-success/40' : failed ? 'border-destructive/40' : unavailable ? 'border-warning/40' : 'border-line-strong',
        dragging && '-translate-y-0.5 border-brand bg-accent/40 shadow-md ring-2 ring-brand/20',
        busy && 'opacity-60',
      )}
    >
      <CardContent className="flex h-full flex-col gap-4 py-1">
        <div className="flex items-start justify-between gap-3">
          <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl transition-[background-color,color,transform] duration-200', dragging && 'scale-105', ready ? 'bg-success/15 text-success' : failed ? 'bg-destructive/10 text-destructive' : unavailable ? 'bg-warning/15 text-warning' : 'bg-accent text-accent-foreground')}>{ready ? <Check className="h-5 w-5 animate-in zoom-in-50 duration-300" /> : <FileImage className="h-5 w-5" />}</span>
          {ready && <Badge variant="success">{tr('Verified', 'Đã xác minh')}</Badge>}
          {failed && <Badge variant="destructive">{tr('New image needed', 'Cần ảnh mới')}</Badge>}
          {unavailable && <Badge variant="warning">{tr('Check interrupted', 'Kiểm tra bị gián đoạn')}</Badge>}
          {document?.validationStatus === 'pending' && <Badge variant="warning">{tr('Checking', 'Đang kiểm tra')}</Badge>}
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-foreground">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-body">{detail}</p>
          {issues.length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-destructive/5 p-3 text-xs text-destructive">{issues.map((issue) => <li key={issue}>• {imageIssueCopy(issue, tr)}</li>)}</ul>}
          {warnings.length > 0 && <div className="mt-3 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning"><p className="font-bold">{tr('Accepted with a review note', 'Đã chấp nhận, cần lưu ý khi xem xét')}</p><ul className="mt-1 space-y-1">{warnings.map((warning) => <li key={warning}>• {imageIssueCopy(warning, tr)}</li>)}</ul></div>}
          {ready && corrections.length > 0 && <p className="mt-3 text-xs leading-relaxed text-success">{tr('Automatically prepared:', 'Đã tự động chuẩn bị:')} {tr('JPG, correct orientation, official dimensions, metadata removed, under 2 MB.', 'JPG, đúng chiều, kích thước chính thức, xóa siêu dữ liệu, dưới 2 MB.')}</p>}
        </div>
        <label className={cn('flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong bg-background px-4 py-3 text-center text-sm text-foreground transition-[border-color,background-color,box-shadow,transform] duration-200 hover:border-brand focus-within:border-brand focus-within:ring-2 focus-within:ring-ring/30 active:scale-[0.99]', dragging && 'border-brand bg-accent/30', busy && 'cursor-not-allowed')}>
          <Upload className={cn('h-5 w-5 shrink-0 text-brand transition-transform duration-200', dragging && '-translate-y-1 scale-110')} />
          <span>
            <span className="block font-bold">{dragging ? tr('Drop image to upload', 'Thả ảnh để tải lên') : ready ? tr('Replace image', 'Thay ảnh') : tr('Choose image', 'Chọn ảnh')}</span>
            <span className="mt-0.5 block text-xs font-normal text-body">{tr('or drag and drop it here', 'hoặc kéo và thả ảnh vào đây')}</span>
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="sr-only"
            aria-label={tr(`Choose ${kind} image`, `Chọn ảnh ${kind === 'passport' ? 'hộ chiếu' : 'chân dung'}`)}
            disabled={busy}
            onChange={(event) => {
              receiveFile(event.target.files?.[0] || null)
              event.target.value = ''
            }}
          />
        </label>
        {unavailable && document && <Button type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={() => onRetry(document.id)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tr('Retry automatic check', 'Thử lại kiểm tra tự động')}</Button>}
      </CardContent>
    </Card>
  )
}

function PersonalStep({ payload, set, tr }: { payload: VisaPayload; set: <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => void; tr: (en: string, vi: string) => string }) {
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{tr('Personal details', 'Thông tin cá nhân')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Text id="surname" label={tr('Surname', 'Họ')} value={payload.surname} onChange={(v) => set('surname', v)} />
      <Text id="givenNames" label={tr('Given and middle names', 'Tên đệm và tên')} value={payload.givenNames} onChange={(v) => set('givenNames', v)} />
      <Text id="dateOfBirth" type="date" label={tr('Date of birth', 'Ngày sinh')} value={payload.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} />
      <FormField id="sex" label={tr('Sex', 'Giới tính')}><VisaSelect id="sex" value={payload.sex} onChange={(v) => set('sex', v as VisaPayload['sex'])}><option value="">{tr('Choose', 'Chọn')}</option><option value="male">{tr('Male', 'Nam')}</option><option value="female">{tr('Female', 'Nữ')}</option></VisaSelect></FormField>
      <Text id="nationality" label={tr('Current nationality', 'Quốc tịch hiện tại')} value={payload.nationality} onChange={(v) => set('nationality', v)} />
      <Text id="placeOfBirth" label={tr('Place of birth', 'Nơi sinh')} value={payload.placeOfBirth} onChange={(v) => set('placeOfBirth', v)} />
      <Text id="identityNumber" label={tr('National ID (if any)', 'Số định danh (nếu có)')} value={payload.identityNumber} onChange={(v) => set('identityNumber', v)} />
      <Text id="email" type="email" label="Email" value={payload.email} onChange={(v) => set('email', v)} />
      <Text id="religion" label={tr('Religion', 'Tôn giáo')} value={payload.religion} onChange={(v) => set('religion', v)} />
      <YesNo id="otherNationality" label={tr('Any other nationality?', 'Có quốc tịch khác?')} value={payload.hasOtherNationalities} onChange={(v) => set('hasOtherNationalities', v)} />
      {payload.hasOtherNationalities === 'yes' && <Text id="otherNationalities" label={tr('Other nationalities', 'Quốc tịch khác')} value={payload.otherNationalities} onChange={(v) => set('otherNationalities', v)} />}
      <YesNo id="violation" label={tr('Violated Vietnamese law?', 'Đã vi phạm pháp luật Việt Nam?')} value={payload.hasVietnamLawViolation} onChange={(v) => set('hasVietnamLawViolation', v)} />
      {payload.hasVietnamLawViolation === 'yes' && <Text id="violationDetails" label={tr('Violation details', 'Chi tiết vi phạm')} value={payload.vietnamLawViolationDetails} onChange={(v) => set('vietnamLawViolationDetails', v)} />}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tr('Passport', 'Hộ chiếu')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Text id="passportNumber" label={tr('Passport number', 'Số hộ chiếu')} value={payload.passportNumber} onChange={(v) => set('passportNumber', v)} />
      <FormField id="passportType" label={tr('Passport type', 'Loại hộ chiếu')}><VisaSelect id="passportType" value={payload.passportType} onChange={(v) => set('passportType', v as VisaPayload['passportType'])}><option value="ordinary">{tr('Ordinary', 'Phổ thông')}</option><option value="official">{tr('Official', 'Công vụ')}</option><option value="diplomatic">{tr('Diplomatic', 'Ngoại giao')}</option><option value="other">{tr('Other', 'Khác')}</option></VisaSelect></FormField>
      <Text id="passportAuthority" label={tr('Issuing authority/place', 'Nơi/cơ quan cấp')} value={payload.passportIssuingAuthority} onChange={(v) => set('passportIssuingAuthority', v)} />
      <Text id="passportIssue" type="date" label={tr('Issue date', 'Ngày cấp')} value={payload.passportIssueDate} onChange={(v) => set('passportIssueDate', v)} />
      <Text id="passportExpiry" type="date" label={tr('Expiry date', 'Ngày hết hạn')} value={payload.passportExpiryDate} onChange={(v) => set('passportExpiryDate', v)} />
      <YesNo id="usedOtherPassportsForVietnam" label={tr('Ever used another passport to enter Vietnam?', 'Đã từng dùng hộ chiếu khác để nhập cảnh Việt Nam?')} value={payload.usedOtherPassportsForVietnam} onChange={(v) => set('usedOtherPassportsForVietnam', v)} />
      {payload.usedOtherPassportsForVietnam === 'yes' && <Text id="usedOtherPassportDetails" label={tr('Previously used passport details', 'Thông tin hộ chiếu đã dùng trước đây')} value={payload.usedOtherPassportDetails} onChange={(v) => set('usedOtherPassportDetails', v)} />}
      <YesNo id="otherPassports" label={tr('Any other valid passports?', 'Có hộ chiếu hợp lệ khác?')} value={payload.hasOtherPassports} onChange={(v) => set('hasOtherPassports', v)} />
      {payload.hasOtherPassports === 'yes' && <Text id="otherPassportDetails" label={tr('Other passport details', 'Thông tin hộ chiếu khác')} value={payload.otherPassportDetails} onChange={(v) => set('otherPassportDetails', v)} />}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tr('Contact and work', 'Liên hệ và công việc')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
      <Text id="permanentAddress" label={tr('Permanent address', 'Địa chỉ thường trú')} value={payload.permanentAddress} onChange={(v) => set('permanentAddress', v)} />
      <Text id="phone" type="tel" label={tr('Phone', 'Điện thoại')} value={payload.phone} onChange={(v) => set('phone', v)} />
      <Text id="emergencyName" label={tr('Emergency contact name', 'Tên liên hệ khẩn cấp')} value={payload.emergencyName} onChange={(v) => set('emergencyName', v)} />
      <Text id="emergencyRelationship" label={tr('Relationship', 'Mối quan hệ')} value={payload.emergencyRelationship} onChange={(v) => set('emergencyRelationship', v)} />
      <Text id="emergencyAddress" label={tr('Emergency contact address', 'Địa chỉ liên hệ khẩn cấp')} value={payload.emergencyAddress} onChange={(v) => set('emergencyAddress', v)} />
      <Text id="emergencyPhone" type="tel" label={tr('Emergency contact phone', 'Điện thoại liên hệ khẩn cấp')} value={payload.emergencyPhone} onChange={(v) => set('emergencyPhone', v)} />
      <Text id="occupation" label={tr('Occupation', 'Nghề nghiệp')} value={payload.occupation} onChange={(v) => set('occupation', v)} />
      <Text id="employerName" label={tr('Employer/school (if any)', 'Cơ quan/trường học (nếu có)')} value={payload.employerName} onChange={(v) => set('employerName', v)} />
      <Text id="employerAddress" label={tr('Employer address', 'Địa chỉ cơ quan')} value={payload.employerAddress} onChange={(v) => set('employerAddress', v)} />
      <Text id="employerPhone" type="tel" label={tr('Employer phone', 'Điện thoại cơ quan')} value={payload.employerPhone} onChange={(v) => set('employerPhone', v)} />
    </CardContent></Card>
  </div>
}

function TripStep({ payload, set, tr }: { payload: VisaPayload; set: <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => void; tr: (en: string, vi: string) => string }) {
  const setVisaStart = (value: string) => {
    const defaults = visaDateDefaultsForStart(value)
    set('visaValidFrom', defaults.visaValidFrom)
    set('visaValidTo', defaults.visaValidTo)
    set('intendedEntryDate', defaults.intendedEntryDate)
    if (value) set('stayLengthDays', defaults.stayLengthDays)
  }
  const setEntryDate = (value: string) => {
    set('intendedEntryDate', value)
    if (value && !payload.visaValidFrom) {
      set('visaValidFrom', value)
      set('visaValidTo', visaEndDateFor90DayWindow(value))
    }
  }
  const maximumVisaEnd = visaEndDateFor90DayWindow(payload.visaValidFrom)

  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{tr('Requested visa', 'Visa yêu cầu')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="entryType" label={tr('Entry type', 'Loại nhập cảnh')}><VisaSelect id="entryType" value={payload.entryType} onChange={(v) => set('entryType', v as VisaPayload['entryType'])}><option value="single">{tr('Single entry', 'Nhập cảnh một lần')}</option><option value="multiple">{tr('Multiple entry', 'Nhập cảnh nhiều lần')}</option></VisaSelect></FormField>
      <Text id="visaFrom" type="date" label={tr('Visa valid from', 'Visa có hiệu lực từ')} value={payload.visaValidFrom} onChange={setVisaStart} />
      <Text id="visaTo" type="date" min={payload.visaValidFrom || undefined} max={maximumVisaEnd || undefined} label={tr('Visa valid to · 90 days filled automatically', 'Visa có hiệu lực đến · tự động điền 90 ngày')} value={payload.visaValidTo} onChange={(v) => set('visaValidTo', v)} />
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tr('Vietnam stay', 'Lưu trú tại Việt Nam')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Text id="purpose" label={tr('Purpose of entry', 'Mục đích nhập cảnh')} value={payload.purposeOfEntry} onChange={(v) => set('purposeOfEntry', v)} />
      <YesNo id="outsideVietnam" label={tr('Are you currently outside Vietnam?', 'Hiện bạn có ở ngoài Việt Nam?')} value={payload.currentlyOutsideVietnam} onChange={(v) => set('currentlyOutsideVietnam', v)} />
      <Text id="entryDate" type="date" min={payload.visaValidFrom || undefined} max={payload.visaValidTo || undefined} label={tr('Intended entry date', 'Ngày dự kiến nhập cảnh')} value={payload.intendedEntryDate} onChange={setEntryDate} />
      <FormField id="stayLength" label={tr('Length of stay (days)', 'Thời gian lưu trú (ngày)')}><Input id="stayLength" variant="outline" type="number" min={1} max={90} value={payload.stayLengthDays || ''} onChange={(event) => set('stayLengthDays', Math.min(90, Math.max(0, Number(event.target.value))))} className="h-11 py-0" /></FormField>
      <Text id="temporaryAddress" label={tr('First Vietnam address/hotel', 'Địa chỉ/khách sạn đầu tiên')} value={payload.temporaryAddress} onChange={(v) => set('temporaryAddress', v)} />
      <Text id="province" label={tr('Province/city', 'Tỉnh/thành phố')} value={payload.temporaryProvince} onChange={(v) => set('temporaryProvince', v)} />
      <Text id="ward" label={tr('Ward/commune (if known)', 'Phường/xã (nếu biết)')} value={payload.temporaryWard} onChange={(v) => set('temporaryWard', v)} />
      <CheckpointCombobox id="entryGate" label={tr('Entry checkpoint', 'Cửa khẩu nhập cảnh')} value={payload.entryGate} onChange={(v) => set('entryGate', v)} tr={tr} />
      <CheckpointCombobox id="exitGate" label={tr('Exit checkpoint', 'Cửa khẩu xuất cảnh')} value={payload.exitGate} onChange={(v) => set('exitGate', v)} tr={tr} />
      <Text id="localContactName" label={tr('Inviting/local contact (if any)', 'Liên hệ tại Việt Nam (nếu có)')} value={payload.localContactName} onChange={(v) => set('localContactName', v)} />
      <Text id="localContactAddress" label={tr('Local contact address', 'Địa chỉ liên hệ tại Việt Nam')} value={payload.localContactAddress} onChange={(v) => set('localContactAddress', v)} />
      <Text id="localContactPhone" type="tel" label={tr('Local contact phone', 'Điện thoại liên hệ tại Việt Nam')} value={payload.localContactPhone} onChange={(v) => set('localContactPhone', v)} />
      <YesNo id="visited" label={tr('Visited Vietnam in the last year?', 'Đã đến Việt Nam trong năm qua?')} value={payload.visitedVietnamLastYear} onChange={(v) => set('visitedVietnamLastYear', v)} />
      {payload.visitedVietnamLastYear === 'yes' && <Text id="previousVisits" label={tr('Previous visit dates/places', 'Ngày/nơi từng đến')} value={payload.previousVisitDetails} onChange={(v) => set('previousVisitDetails', v)} />}
      <YesNo id="relatives" label={tr('Relatives in Vietnam?', 'Có người thân tại Việt Nam?')} value={payload.hasRelativesInVietnam} onChange={(v) => set('hasRelativesInVietnam', v)} />
      {payload.hasRelativesInVietnam === 'yes' && <Text id="relativeDetails" label={tr('Relative details', 'Thông tin người thân')} value={payload.relativesInVietnamDetails} onChange={(v) => set('relativesInVietnamDetails', v)} />}
      <YesNo id="childrenOnPassport" label={tr('Children under 14 on this passport?', 'Có trẻ dưới 14 tuổi chung hộ chiếu?')} value={payload.hasChildrenOnPassport} onChange={(v) => set('hasChildrenOnPassport', v)} />
      {payload.hasChildrenOnPassport === 'yes' && <Text id="childrenDetails" label={tr('Each child’s full name, date of birth, and sex', 'Họ tên, ngày sinh và giới tính của từng trẻ')} value={payload.childrenOnPassportDetails} onChange={(v) => set('childrenOnPassportDetails', v)} />}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tr('Expenses and insurance', 'Chi phí và bảo hiểm')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="expenses" label={tr('Estimated expenses', 'Chi phí dự kiến')}><Input id="expenses" variant="outline" type="number" min={0} value={payload.estimatedExpenses || ''} onChange={(event) => set('estimatedExpenses', Math.max(0, Number(event.target.value)))} className="h-11 py-0" /></FormField>
      <Text id="currency" label={tr('Currency', 'Tiền tệ')} value={payload.expensesCurrency} onChange={(v) => set('expensesCurrency', v.toUpperCase().slice(0, 3))} />
      <FormField id="payer" label={tr('Who pays?', 'Ai chi trả?')}><VisaSelect id="payer" value={payload.expensesPayer} onChange={(v) => { set('expensesPayer', v as VisaPayload['expensesPayer']); if (v !== 'self' && payload.paymentMethod === 'travellers_cheques') set('paymentMethod', 'credit_card') }}><option value="self">{tr('Self', 'Tự chi trả')}</option><option value="organization">{tr('Organization', 'Tổ chức')}</option><option value="other">{tr('Other person', 'Người khác')}</option></VisaSelect></FormField>
      <FormField id="paymentMethod" label={tr('Payment method', 'Hình thức chi trả')}><VisaSelect id="paymentMethod" value={payload.paymentMethod} onChange={(v) => set('paymentMethod', v as VisaPayload['paymentMethod'])}><option value="credit_card">{tr('Credit card', 'Thẻ tín dụng')}</option><option value="cash">{tr('Cash', 'Tiền mặt')}</option>{payload.expensesPayer === 'self' && <option value="travellers_cheques">{tr("Traveller's cheques", 'Séc du lịch')}</option>}</VisaSelect></FormField>
      {payload.expensesPayer !== 'self' && <>
        <Text id="payerName" label={tr('Payer name', 'Tên người/tổ chức chi trả')} value={payload.payerName} onChange={(v) => set('payerName', v)} />
        <Text id="payerAddress" label={tr('Payer address', 'Địa chỉ người/tổ chức chi trả')} value={payload.payerAddress} onChange={(v) => set('payerAddress', v)} />
        <Text id="payerPhone" type="tel" label={tr('Payer phone', 'Điện thoại người/tổ chức chi trả')} value={payload.payerPhone} onChange={(v) => set('payerPhone', v)} />
      </>}
      <YesNo id="insurance" label={tr('Travel insurance?', 'Có bảo hiểm du lịch?')} value={payload.hasTravelInsurance} onChange={(v) => set('hasTravelInsurance', v)} />
      {payload.hasTravelInsurance === 'yes' && <Text id="insuranceDetails" label={tr('Insurance provider/policy', 'Nhà cung cấp/hợp đồng bảo hiểm')} value={payload.insuranceDetails} onChange={(v) => set('insuranceDetails', v)} />}
      <FormField id="notes" label={tr('Anything eno should know?', 'Thông tin thêm cho eno?')}><Textarea id="notes" variant="outline" size="compact" rows={3} value={payload.applicantNotes} onChange={(event) => set('applicantNotes', event.target.value)} /></FormField>
    </CardContent></Card>
  </div>
}

function Text({ id, label, value, onChange, type = 'text', min, max }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; max?: string }) {
  return <FormField id={id} label={label}><Input id={id} variant="outline" type={type} min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 py-0" /></FormField>
}

function CheckpointCombobox({ id, label, value, onChange, tr }: { id: string; label: string; value: string; onChange: (value: string) => void; tr: (en: string, vi: string) => string }) {
  return <FormField id={id} label={label}>
    <Combobox
      items={EVISA_COMBOBOX_GROUPS}
      value={value || null}
      inputValue={value}
      onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}
      onInputValueChange={(next) => onChange(next)}
      autoHighlight
    >
      <ComboboxInputGroup>
        <ComboboxInput id={id} autoComplete="off" placeholder={tr('Type or choose a checkpoint', 'Nhập hoặc chọn cửa khẩu')} />
        <ComboboxClear aria-label={tr(`Clear ${label}`, `Xóa ${label}`)} />
        <ComboboxTrigger aria-label={tr(`Open ${label} options`, `Mở lựa chọn ${label}`)} />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>{tr('No matching checkpoint. You can keep your typed value.', 'Không có cửa khẩu phù hợp. Bạn có thể giữ giá trị đã nhập.')}</ComboboxEmpty>
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
  </FormField>
}

function YesNo({ id, label, value, onChange }: { id: string; label: string; value: '' | 'yes' | 'no'; onChange: (value: '' | 'yes' | 'no') => void }) {
  const { tr } = useLanguage()
  return <FormField id={id} label={label}><VisaSelect id={id} value={value} onChange={(v) => onChange(v as '' | 'yes' | 'no')}><option value="">{tr('Choose', 'Chọn')}</option><option value="no">{tr('No', 'Không')}</option><option value="yes">{tr('Yes', 'Có')}</option></VisaSelect></FormField>
}

function ReviewGrid({ payload, tr }: { payload: VisaPayload; tr: (en: string, vi?: string) => string }) {
  const omit = new Set(['schemaVersion', 'aiDocumentProcessingConsent', 'adminMessage', 'governmentRegistrationCode', 'governmentApplicationStatus'])
  const items = Object.entries(payload)
    .filter(([key]) => !omit.has(key))
    .map(([key, value]): [string, unknown] => [key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()), value])
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-4">{tr(label)}</dt><dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{String(value || '—')}</dd></div>)}</dl>
}
