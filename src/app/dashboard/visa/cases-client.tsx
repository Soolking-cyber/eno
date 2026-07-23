'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Clock, Download, FileCheck2, Loader2, LockKeyhole, MessagesSquare, ShieldCheck, Stamp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { useLanguage } from '@/context/language-context'
import type { VisaPayload } from '@/lib/visa/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { SectionHeader } from '@/components/marketplace/section-header'
import { useMinuteTick, VisaStart } from '@/components/marketplace/visa-start'
import { expectedVisaReadyAt } from '@/lib/visa/eta'
import { parseVisaSpeedCode } from '@/lib/visa/speed'

// ── /dashboard/visa — YOUR e-VISA CASES: MANAGEMENT ONLY (Phase 3). ────────────────
//
// Owner, 2026-07-23 (on seeing the picker still here): "this part is still not user visa
// applications management tab — remove these". The product list is GONE from this page:
// choosing a service happens IN the chat now (the Phase-2 step-0 picker card), and the
// only start affordance here is the one-tap generic <VisaStart /> that opens that thread.
//
// What this page IS: every case the applicant has, each with its EV-#### reference,
// status, the way back into the thread it lives in ("request an update"), the official
// PDF once one exists, and deletion. Cases are linked to their threads via the IMMUTABLE
// visa_applications.conversation_id (resolved server-side in page.tsx) — a repeat
// applicant's earlier case keeps its chat link even after the live binding moved on.
//
// ⚠️ THREE THINGS ON THIS PAGE HAVE NO CHAT EQUIVALENT, and that is why they live here
// rather than being deleted with the old wizard/picker:
//   1. THE PAYMENT RETURN. Stripe and PayPal are told to come back to /dashboard/visa
//      (src/lib/visa/payments.ts success_url/return_url), including for a checkout started
//      from a chat card. Stripe also has a webhook, but PAYPAL HAS NONE: the capture only
//      happens when this page posts /payment/confirm. Deleting this handler would take
//      money and never capture it.
//   2. THE FINAL AUTHORIZATION. An admin can move a case to `applicant_approval`
//      (src/app/admin/visas/visa-status.ts); the applicant must then re-consent before
//      prefill. No card asks for that, so this is the only surface that can.
//   3. THE RESULT PDF. The issued e-Visa arrives as a `result` document; this page (and
//      the thread's result card) are where it downloads.
// Anything else — asking, uploading, validating, submitting, paying, CHOOSING A
// PRODUCT — belongs to the thread. Do not re-add a field, and do not re-add the picker.

type VisaDocument = { id: string; kind: string; createdAt: string }
type VisaEvent = { id: string; event: string; createdAt: string }
type VisaApplication = {
  id: string
  status: string
  /** The human case number (`EV-1042`), or null for cases predating the column. */
  reference?: string | null
  /** The canonical product choice's speed tier (Phase 2) — the ETA's input. */
  selectedSpeed?: string | null
  payload?: VisaPayload
  paidAt: string | null
  createdAt: string
  updatedAt: string
  documents: VisaDocument[]
  events?: VisaEvent[]
}

class VisaApiError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

// Same-origin, cookie-session JSON. Identical posture to the retired client's helper: no
// token reaches this bundle and a refusal surfaces as a CODE, never a driver message.
async function visaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, cache: 'no-store', credentials: 'same-origin' })
  let body: unknown = null
  try { body = await response.json() } catch { body = null }
  if (!response.ok) {
    const failure = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as { error?: string }
    throw new VisaApiError(response.status, failure.error || `request_failed_${response.status}`)
  }
  return body as T
}

/** draft / needs_changes — the statuses the CHAT can still write to. */
const EDITABLE = new Set(['draft', 'needs_changes'])

// Status → chip. Keys are the statuses the visa routes actually write; anything
// unrecognized falls back to a neutral chip showing the raw word, so a NEW status degrades
// to ugly-but-honest instead of crashing.
const STATUS_CHIP: Record<string, { en: string; vi: string; variant: 'neutral' | 'brand' | 'success' | 'warning' | 'destructive' }> = {
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

type Tr = (en: string, vi: string) => string

/** The sentence under the chip — what is happening to this case, and who is holding it. */
function statusCopy(status: string, tr: Tr) {
  const map: Record<string, [string, string, string, string]> = {
    draft: ['Not finished yet', 'Chưa hoàn tất', 'Your answers are saved. Continue in your chat with the e-Visa desk.', 'Câu trả lời của bạn đã được lưu. Hãy tiếp tục trong cuộc trò chuyện với bộ phận e-Visa.'],
    needs_changes: ['Changes requested', 'Cần chỉnh sửa', 'eno asked for a correction. Open your chat to make it.', 'eno yêu cầu chỉnh sửa. Hãy mở cuộc trò chuyện để sửa.'],
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
  const value = map[status] || ['Your application', 'Hồ sơ của bạn', 'Open your chat with the e-Visa desk to continue.', 'Mở cuộc trò chuyện với bộ phận e-Visa để tiếp tục.']
  return { title: tr(value[0], value[1]), detail: tr(value[2], value[3]) }
}

/**
 * The approved snapshot, read-only — the LAST thing an applicant sees before authorizing
 * prefill. It renders the decrypted payload the server sent for this case and writes
 * nothing: no input, no onChange, no save. (The wizard's identical grid was the only part
 * of it that was never a form.)
 */
function ReviewGrid({ payload, tr }: { payload: VisaPayload; tr: (en: string, vi?: string) => string }) {
  const omit = new Set(['schemaVersion', 'aiDocumentProcessingConsent', 'adminMessage', 'governmentRegistrationCode', 'governmentApplicationStatus'])
  const items = Object.entries(payload)
    .filter(([key]) => !omit.has(key))
    .map(([key, value]): [string, unknown] => [key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()), value])
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-4">{tr(label)}</dt><dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{String(value || '—')}</dd></div>)}</dl>
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-card p-4 text-sm leading-relaxed text-body"><Checkbox checked={checked} onChange={onChange} className="mt-1" /><span>{children}</span></label>
}

/** `EV-1042`, or the id stub for a case that predates the reference column. */
const caseLabel = (item: VisaApplication) => item.reference || item.id.slice(0, 8)

// ── The delivery promise (Phase 4) ──────────────────────────────────────────────────
// Shown ONLY while the case is with the DESK and the fee is PAID (external review: a
// confirmed-but-unpaid case bought nothing, and `applicant_approval` is blocked on the
// TRAVELLER — a countdown there would blame the desk for the applicant's own wait).
const ETA_STATUSES = new Set(['ready_for_review', 'under_review', 'ready_to_submit', 'processing', 'submitted'])

/** "Mon, 27 Jul, 08:45" on the Vietnamese wall clock, whatever zone the viewer is in. */
const hcmPromise = (instant: Date, lang: string) =>
  new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant)

/** Coarse honest remainder — "about 3 h" / "about 2 days"; null once under a minute. */
function remainingCopy(ms: number, tr: Tr): string | null {
  if (ms < 60_000) return null
  if (ms < 3_600_000) return tr(`about ${Math.round(ms / 60_000)} min left`, `còn khoảng ${Math.round(ms / 60_000)} phút`)
  if (ms < 48 * 3_600_000) return tr(`about ${Math.round(ms / 3_600_000)} h left`, `còn khoảng ${Math.round(ms / 3_600_000)} giờ`)
  return tr(`about ${Math.round(ms / 86_400_000)} days left`, `còn khoảng ${Math.round(ms / 86_400_000)} ngày`)
}

/** The case's promise line, or null when no honest one exists (fails closed with eta.ts). */
function CaseEta({ item, now, lang, tr }: { item: VisaApplication; now: Date | null; lang: string; tr: Tr }) {
  if (!now || !item.paidAt || !ETA_STATUSES.has(item.status)) return null
  const speed = parseVisaSpeedCode(item.selectedSpeed)
  if (!speed) return null
  const readyAt = expectedVisaReadyAt({ startedAt: item.paidAt, speed })
  if (!readyAt) return null
  const remaining = readyAt.getTime() - now.getTime()
  if (remaining <= 0) {
    // The first promise was missed. No silent re-promise — the desk owns that
    // conversation, and the row's "Request an update" is one tap away.
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {tr('Taking longer than expected — ask the desk in your chat.', 'Lâu hơn dự kiến — hãy hỏi bộ phận hỗ trợ trong chat.')}
      </p>
    )
  }
  const left = remainingCopy(remaining, tr)
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-body">
      <Clock className="h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden />
      {tr('Expected by', 'Dự kiến trước')} {hcmPromise(readyAt, lang)} {tr('(Vietnam time)', '(giờ Việt Nam)')}
      {left ? <span className="text-ink-4">· {left}</span> : null}
    </p>
  )
}

// ── The customer-facing timeline ────────────────────────────────────────────────────
// visa_events is an INTERNAL audit log — its raw codes ("dm_card_resent",
// "dm_product_selected", "dm_concierge_answered") leaked to the applicant as
// "Dm Card Resent" × N (owner's screenshot). Two rules make it a milestone timeline
// instead of a debug dump:
//   1. Only MEANINGFUL milestones are shown — the DM plumbing (card resends, concierge
//      replies, per-step saves, product re-picks) is noise here and is dropped.
//   2. Each surviving code gets a HUMAN, bilingual label. An unmapped code is dropped, not
//      titlecased — a new internal event must never appear raw again.
// The label AND the dedup key. `paid`/`payment_recorded` share a key so two rows never both
// say "Payment received" (external review, GPT-5.6 2026-07-23). result_uploaded is here but
// GATED at render on an actual result document — the audit event survives a rolled-back
// delivery, so the event alone must not promise "your visa is ready".
const VISA_MILESTONES: Record<string, { key: string; en: string; vi: string }> = {
  application_created: { key: 'created', en: 'Application started', vi: 'Đã bắt đầu hồ sơ' },
  prefill_authorized: { key: 'authorized', en: 'You authorized us to file', vi: 'Bạn đã cho phép nộp hồ sơ' },
  payment_recorded: { key: 'paid', en: 'Payment received', vi: 'Đã nhận thanh toán' },
  paid: { key: 'paid', en: 'Payment received', vi: 'Đã nhận thanh toán' },
  sent_for_review: { key: 'review', en: 'Sent to our team', vi: 'Đã gửi cho đội ngũ' },
  human_help_requested: { key: 'human', en: 'You asked for a person', vi: 'Bạn đã yêu cầu nhân viên' },
  admin_takeover_started: { key: 'specialist', en: 'A specialist joined the chat', vi: 'Chuyên viên đã tham gia' },
  admin_takeover_ended: { key: 'specialist_end', en: 'The specialist handed the chat back', vi: 'Chuyên viên đã trả lại cuộc trò chuyện' },
  application_cancelled: { key: 'cancelled', en: 'Application cancelled', vi: 'Đã hủy hồ sơ' },
  result_uploaded: { key: 'ready', en: 'Your visa is ready', vi: 'Visa của bạn đã sẵn sàng' },
}

/**
 * One case, managed: reference, status, the way back into its thread, the PDF once it
 * exists, deletion. `detailFor` marks the case whose attention blocks (admin message /
 * final authorization / timeline) render below the list — the row says so.
 */
function CaseRow({ item, conversationId, deskThreadId, isDetail, busy, now, lang, tr, onDownload, onDelete }: {
  item: VisaApplication
  conversationId: string | undefined
  /** ANY thread of the viewer's — there is exactly ONE buyer↔desk conversation (cases
   *  rebind it in turn), so an unbound row still gets a truthful way to ask the desk. */
  deskThreadId: string | undefined
  isDetail: boolean
  busy: boolean
  /** Minute tick — null until the first client tick, so the promise line never asserts
   *  during SSR/hydration (the useMinuteTick contract). */
  now: Date | null
  lang: string
  tr: Tr
  onDownload: (item: VisaApplication) => void
  onDelete: (item: VisaApplication) => void
}) {
  const chip = STATUS_CHIP[item.status]
  const copy = statusCopy(item.status, tr)
  const editable = EDITABLE.has(item.status)
  const hasResult = item.documents.some((document) => document.kind === 'result')
  // The row's own thread first (immutable link); the shared desk thread as the fallback
  // (external review: a row with NO chat action strands its case, and a per-row generic
  // START could open/rebind a DIFFERENT editable draft than the one on this row).
  const threadId = conversationId ?? deskThreadId
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint"><FileCheck2 className="h-4 w-4 text-ink-4" /></span>
        <span className="font-mono text-sm font-bold tracking-wide text-foreground">{caseLabel(item)}</span>
        <Badge variant={chip?.variant ?? 'neutral'}>{chip ? tr(chip.en, chip.vi) : item.status}</Badge>
        {item.paidAt && <Badge variant="success"><Check className="h-3 w-3" />{tr('Fee paid', 'Đã trả phí')}</Badge>}
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{copy.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-body">{copy.detail}</p>
      <CaseEta item={item} now={now} lang={lang} tr={tr} />
      <p className="mt-1.5 text-xs text-ink-4">
        {tr('Updated', 'Cập nhật')} {new Date(item.updatedAt).toLocaleDateString()} · {item.documents.length} {tr('documents', 'tài liệu')}
        {isDetail && <> · {tr('details below', 'chi tiết bên dưới')}</>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {threadId ? (
          <Button variant={editable ? 'cta' : 'outline'} size="sm" asChild>
            <Link href={`/messages/${threadId}`}>
              <MessagesSquare className="h-4 w-4" />
              {editable ? tr('Continue in chat', 'Tiếp tục trong chat') : tr('Request an update', 'Yêu cầu cập nhật')}
            </Link>
          </Button>
        ) : editable ? (
          // No thread ANYWHERE (legacy dashboard-only account): the generic start is the
          // one honest affordance left. Labelled generically on purpose — it opens the
          // e-Visa chat (reusing the newest editable draft), not necessarily THIS row.
          <VisaStart label={tr('Open the e-Visa chat', 'Mở chat e-Visa')} />
        ) : null}
        {hasResult && (
          <Button type="button" variant="cta" size="sm" onClick={() => onDownload(item)}>
            <Download className="h-4 w-4" />{tr('Download e-Visa PDF', 'Tải PDF E-Visa')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
          data-testid="delete-visa-application"
          disabled={busy}
          onClick={() => onDelete(item)}
        >
          <Trash2 className="h-4 w-4" />{tr('Delete', 'Xóa')}
        </Button>
      </div>
    </li>
  )
}

export function VisaCasesClient({ threads }: {
  /** applicationId → the conversation it lives in — the IMMUTABLE
   *  visa_applications.conversation_id first, live binding as the legacy fallback
   *  (resolved server-side in page.tsx). Missing means "no thread": the generic start
   *  re-binds the newest editable draft. */
  threads: Record<string, string>
}) {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading } = useAuth()
  const { refresh: refreshDashboard } = useDashboard()
  // One minute tick for every row's promise line — never an interval per row.
  const now = useMinuteTick()
  const router = useRouter()
  const search = useSearchParams()
  const [application, setApplication] = useState<VisaApplication | null>(null)
  const [applications, setApplications] = useState<VisaApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [notConfigured, setNotConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [declaration, setDeclaration] = useState(false)
  const [authorization, setAuthorization] = useState(false)
  /** The case a delete was asked for — per case now, not "the active one". */
  const [deleteTarget, setDeleteTarget] = useState<VisaApplication | null>(null)
  // Latest tr for callbacks that must NOT re-mint on a language change (the load effect
  // would otherwise re-fire on every switch — audit P1 #5's smaller cousin).
  const trRef = useRef(tr)
  trRef.current = tr

  // Sibling dashboard sections' auth gate — signed-out users go to sign-in and back.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/signin?next=/dashboard/visa')
  }, [authLoading, user, router])

  const loadApplications = useCallback(async (background = false) => {
    if (!user) { setApplication(null); setApplications([]); setLoading(false); return }
    if (!background) setLoading(true)
    try {
      // ?active=1 — the history list PLUS the newest open case in DETAIL form (decrypted
      // payload + events). The payload is read for exactly two things here: the admin's
      // message, and the read-only grid the final authorization is given against.
      const list = await visaApi<{ application: VisaApplication | null; applications: VisaApplication[]; encryptionReady?: boolean }>('/api/visa/applications?active=1')
      if (list.encryptionReady === false) { setNotConfigured(true); setApplication(null); setApplications([]); return }
      setNotConfigured(false)
      setApplications(list.applications || [])
      setApplication(list.application)
    } catch (error) {
      if (error instanceof VisaApiError && error.code === 'visa_encryption_not_configured') setNotConfigured(true)
      // ⚠️ SILENT ON A BACKGROUND RELOAD. This runs after a delete and on a poll; a transient
      // failure there must not throw a red "could not load" toast on top of the green "deleted"
      // one (owner's screenshot showed exactly that double message). The foreground load still
      // surfaces a real error.
      else if (!background && !(error instanceof VisaApiError && error.status === 401)) toast.error(trRef.current('Could not load visa assistance.', 'Không thể tải dịch vụ hỗ trợ visa.'))
    } finally { if (!background) setLoading(false) }
  }, [user])

  useEffect(() => { if (!authLoading) void loadApplications() }, [authLoading, loadApplications])

  // The desk moves a case while the applicant watches — most importantly INTO
  // `applicant_approval`, which this page is the only surface able to answer. Kept from the
  // retired client, and on the same terms: never while the case is still being filled in
  // (that happens in the thread now) and never once it is finished.
  const pollStatus = application?.status
  useEffect(() => {
    if (!pollStatus || EDITABLE.has(pollStatus) || ['approved', 'rejected', 'cancelled'].includes(pollStatus)) return
    const timer = window.setInterval(() => void loadApplications(true), 30_000)
    return () => window.clearInterval(timer)
  }, [pollStatus, loadApplications])

  /**
   * BACK FROM STRIPE / PAYPAL — the one piece of money handling left on the dashboard.
   *
   * ⚠️ THIS RUNS FOR CHECKOUTS STARTED IN THE CHAT TOO. src/lib/visa/payments.ts sends both
   * providers back to /dashboard/visa?paid=<provider>&aid=<application>&sid|token=<ref>,
   * whichever surface opened the checkout. Stripe has a webhook that records the payment
   * even if the applicant never comes back; PAYPAL HAS NO WEBHOOK, so the capture happens
   * only when the confirm route below is posted. Removing this effect would let a buyer
   * approve a PayPal payment that is never captured.
   *
   * The provider is re-verified SERVER-side (the confirm route re-reads the session /
   * captures the order); these params only say which confirmation to ask for. Runs once,
   * then cleans the URL — and hands the applicant back to the thread the case lives in,
   * because that is where the paid card and the desk are.
   */
  const returnHandled = useRef(false)
  useEffect(() => {
    if (authLoading || !user || returnHandled.current) return
    const paid = search.get('paid')
    const cancelled = search.get('pay') === 'cancelled'
    if (!paid && !cancelled) return
    returnHandled.current = true
    const aid = search.get('aid') || ''
    const ref = paid === 'stripe' ? search.get('sid') : search.get('token')
    // Strip the provider's params first: a refresh must never re-post a confirmation.
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
        toast.success(result.handedOff
          ? tr('Payment received — your application is now with eno for review.', 'Đã nhận thanh toán — hồ sơ của bạn đang được eno xem xét.')
          : tr('Payment received.', 'Đã nhận thanh toán.'), { id: toastId })
        await loadApplications(true).catch(() => undefined)
        // Home is the thread: the paid checkout card and the desk are both in it.
        const conversationId = threads[aid]
        if (conversationId) router.replace(`/messages/${conversationId}`)
      } catch {
        toast.error(tr('Payment could not be confirmed yet. If you completed it, it will be recorded automatically in a moment.', 'Chưa thể xác nhận thanh toán. Nếu bạn đã hoàn tất, hệ thống sẽ tự động ghi nhận trong giây lát.'), { id: toastId })
        await loadApplications(true).catch(() => undefined)
      }
    })()
  }, [authLoading, user, search, router, loadApplications, threads, tr])

  /**
   * The FINAL AUTHORIZATION, once an admin has moved the case to `applicant_approval`.
   * It is not the application form: the answers are already fixed, this is the applicant
   * re-reading them and consenting to prefill. No card asks for it, so this page must.
   */
  const approvePrefill = async () => {
    if (!application || !declaration || !authorization) return
    setBusy(true)
    try {
      const result = await visaApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}/submit`, {
        method: 'POST', body: JSON.stringify({ action: 'approve_for_prefill', declarationAccepted: true, prefillAuthorized: true }),
      })
      setApplication(result.application)
      toast.success(tr('Final approval recorded.', 'Đã ghi nhận phê duyệt cuối cùng.'))
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }

  /** The issued e-Visa, for ANY of the viewer's cases. The signed URL is minted per
   *  request and opened in a fresh tab with no opener — the file is passport-grade and
   *  never becomes a shareable link here. */
  const downloadResult = async (item: VisaApplication) => {
    const result = item.documents.find((document) => document.kind === 'result')
    if (!result) return
    const preview = window.open('about:blank', '_blank')
    if (preview) preview.opener = null
    try {
      const signed = await visaApi<{ url: string }>(`/api/visa/applications/${item.id}/documents/${result.id}`)
      if (preview) preview.location.href = signed.url
      else window.location.assign(signed.url)
    } catch (error) {
      preview?.close()
      toast.error((error as Error).message.replaceAll('_', ' '))
    }
  }

  /**
   * Delete eno's copy — the applicant's own erasure control over the most concentrated PII
   * we hold, now per CASE. Nothing is minted in its place: the list re-renders without the
   * row, and a next case starts the one supported way (the chat).
   */
  const deleteApplication = async () => {
    if (!deleteTarget) return
    setBusy(true)
    const deletedId = deleteTarget.id
    try {
      await visaApi<{ deleted: true; id: string }>(`/api/visa/applications/${deletedId}`, { method: 'DELETE' })
      // ⚠️ CLEAR THE SCREEN FROM THE SUCCESS, not from a reload. External review (GPT-5.6,
      // 2026-07-23) caught that this relied entirely on loadApplications() to reconcile — so a
      // failed reload left "deleted" on screen next to the still-rendered case AND its delete
      // button. The DELETE succeeded; drop the case now.
      setApplication((cur) => (cur?.id === deletedId ? null : cur))
      setApplications((prev) => prev.filter((a) => a.id !== deletedId))
      setDeleteTarget(null)
      setDeclaration(false); setAuthorization(false)
      toast.success(tr('Application deleted.', 'Đã xóa hồ sơ.'))
      // The rail's "My e-Visa" row is gated on hasVisa; deleting the last case must drop it.
      refreshDashboard()
      // Reconcile in the background (picks up any OTHER case); its failure is now cosmetic
      // because the deleted one is already gone from view, and it stays quiet (see loadApplications).
      void loadApplications(true).catch(() => undefined)
    } catch {
      toast.error(tr('Could not finish deleting this application. Please retry.', 'Chưa thể hoàn tất việc xóa hồ sơ này. Vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  const sectionHeader = <SectionHeader title={tr('My e-Visa', 'E-Visa của tôi')} />

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
    // Honest env-absent state: the visa rows are ENCRYPTED and this host has no
    // VISA_DATA_ENCRYPTION_KEY yet (src/lib/visa/crypto.ts) — never broken crypto UI.
    return (
      <>
        {sectionHeader}
        <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('My e-Visa', 'E-Visa của tôi')}</h1>
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

  // NO CASES AT ALL — the one start affordance, and it goes straight to the chat: the
  // Phase-2 picker card in the thread is where a service gets chosen, not this page.
  if (!applications.length) {
    return (
      <>
        {sectionHeader}
        <div className="mx-auto w-full max-w-3xl py-4 sm:py-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tr('My e-Visa applications', 'Hồ sơ E-Visa của tôi')}</h1>
          <div className="mt-6">
            <EmptyState
              icon={Stamp}
              title={tr('No applications yet', 'Chưa có hồ sơ nào')}
              subtitle={tr(
                'Start in chat: pick a service on the card eno sends you, upload your passport and portrait, answer the trip questions, then pay — all in one conversation.',
                'Bắt đầu trong chat: chọn dịch vụ trên thẻ eno gửi, tải lên hộ chiếu và ảnh chân dung, trả lời câu hỏi về chuyến đi rồi thanh toán — tất cả trong một cuộc trò chuyện.',
              )}
              action={<VisaStart />}
            />
          </div>
          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-body">{tr('eno is an independent assistance service, not a government agency. Approval is decided only by Vietnamese authorities. Official fees and eno service fees are confirmed separately in writing before payment.', 'eno là dịch vụ hỗ trợ độc lập, không phải cơ quan nhà nước. Việc phê duyệt chỉ do cơ quan chức năng Việt Nam quyết định. Lệ phí chính thức và phí dịch vụ eno được xác nhận riêng bằng văn bản trước thanh toán.')}</p>
          <p className="mt-3 text-xs leading-relaxed text-body">
            <a href="https://evisa.gov.vn/" target="_blank" rel="noreferrer" className="font-semibold text-accent-foreground hover:underline">{tr('Official e-Visa website', 'Trang E-Visa chính thức')}</a>
          </p>
        </div>
      </>
    )
  }

  const adminMessage = application?.payload?.adminMessage

  return (
    <>
      {sectionHeader}
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight text-foreground max-lg:sr-only">{tr('My e-Visa applications', 'Hồ sơ E-Visa của tôi')}</h1>

        {/* EVERY case, newest first — reference, status, its thread, its PDF, deletion. */}
        <ul className="mt-4 space-y-3">
          {applications.map((item) => (
            <CaseRow
              key={item.id}
              item={item}
              conversationId={threads[item.id]}
              deskThreadId={Object.values(threads)[0]}
              isDetail={!!application && item.id === application.id && (item.status === 'applicant_approval' || !!adminMessage)}
              busy={busy}
              now={now}
              lang={lang}
              tr={tr}
              onDownload={(target) => void downloadResult(target)}
              onDelete={setDeleteTarget}
            />
          ))}
        </ul>

        {/* ── The active case's attention blocks (the parts only this page can do) ── */}

        {application && adminMessage && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {application.status === 'needs_changes' ? tr('Changes requested', 'Yêu cầu chỉnh sửa') : tr('Private update from eno', 'Cập nhật riêng từ eno')}
                <span className="ml-2 font-mono text-xs font-semibold text-ink-4">{caseLabel(application)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-body">{adminMessage}</p></CardContent>
          </Card>
        )}

        {application && application.status === 'applicant_approval' && application.payload && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {tr('Final applicant authorization', 'Ủy quyền cuối cùng của người nộp')}
                <span className="ml-2 font-mono text-xs font-semibold text-ink-4">{caseLabel(application)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-body">{tr('Compare the details below with your passport and trip. eno will use only this approved snapshot to prepare the official form.', 'Đối chiếu thông tin bên dưới với hộ chiếu và chuyến đi. eno chỉ dùng bản đã duyệt này để chuẩn bị biểu mẫu chính thức.')}</p>
              <ReviewGrid payload={application.payload} tr={tr} />
              <Consent checked={declaration} onChange={setDeclaration}>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</Consent>
              <Consent checked={authorization} onChange={setAuthorization}>{tr('I authorize eno to transfer these approved answers and images into a temporary secure hosted browser and prefill the official website. Browser recording, session logs, and automatic CAPTCHA solving are disabled. A person must still review the official form before declaration, payment, and submission.', 'Tôi cho phép eno chuyển các câu trả lời và hình ảnh đã duyệt này vào trình duyệt lưu trữ bảo mật tạm thời và điền trước trang web chính thức. Tính năng ghi hình trình duyệt, nhật ký phiên và tự động giải CAPTCHA đều bị tắt. Một người vẫn phải kiểm tra biểu mẫu chính thức trước khi xác nhận, thanh toán và nộp hồ sơ.')}</Consent>
              <Button type="button" variant="cta" className="h-11" disabled={busy || !declaration || !authorization} onClick={() => void approvePrefill()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{tr('Approve for official prefill', 'Duyệt để điền biểu mẫu chính thức')}
              </Button>
            </CardContent>
          </Card>
        )}

        {application && (() => {
          // "Your visa is ready" must reflect a real download, not just the audit event — a
          // rolled-back delivery leaves the event behind (external review). Gate it on the case
          // actually holding a result document.
          const hasResult = (application.documents ?? []).some((d) => d.kind === 'result')
          const milestones = (application.events ?? [])
            .map((e) => ({ e, m: VISA_MILESTONES[e.event] }))
            .filter((x): x is { e: VisaEvent; m: NonNullable<typeof x.m> } => !!x.m)
            .filter((x) => x.m.key !== 'ready' || hasResult)
            // ⚠️ SORT (newest first) BEFORE dedup, so a repeated code keeps its LATEST date.
            // Deduping first kept the oldest occurrence and then sorting could not recover it.
            .sort((a, b) => new Date(b.e.createdAt).getTime() - new Date(a.e.createdAt).getTime())
            .filter((x, i, arr) => arr.findIndex((y) => y.m.key === x.m.key) === i)
          if (!milestones.length) return null
          return (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>
                  {tr('Progress', 'Tiến trình')}
                  <span className="ml-2 font-mono text-xs font-semibold text-ink-4">{caseLabel(application)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {milestones.map(({ e, m }) => (
                    <li key={e.id} className="flex items-start justify-between gap-4 border-l-2 border-brand/30 pl-3">
                      <span className="text-sm font-medium text-foreground">{tr(m.en, m.vi)}</span>
                      <time className="shrink-0 text-xs text-ink-4">{new Date(e.createdAt).toLocaleDateString()}</time>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )
        })()}

        <p className="mt-8 border-t border-border pt-4 text-xs leading-relaxed text-body">{tr('eno is an independent assistance service, not a government agency. Approval is decided only by Vietnamese authorities.', 'eno là dịch vụ hỗ trợ độc lập, không phải cơ quan nhà nước. Việc phê duyệt chỉ do cơ quan chức năng Việt Nam quyết định.')}</p>

        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!busy && !open) setDeleteTarget(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
              <DialogTitle className="text-lg font-bold">
                {tr('Delete this application?', 'Xóa hồ sơ này?')}
                {deleteTarget && <span className="ml-2 font-mono text-sm font-semibold text-ink-4">{caseLabel(deleteTarget)}</span>}
              </DialogTitle>
              <DialogDescription>{tr('This permanently removes this application, its answers, uploaded documents, and case history from eno. This cannot be undone.', 'Thao tác này xóa vĩnh viễn hồ sơ, câu trả lời, giấy tờ đã tải lên và lịch sử xử lý khỏi eno. Không thể hoàn tác.')}</DialogDescription>
            </DialogHeader>
            {deleteTarget && ['submitted', 'payment_required', 'processing', 'approved'].includes(deleteTarget.status) && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">{tr('Deleting eno’s copy does not withdraw or erase an application already sent to the Vietnamese authority.', 'Việc xóa bản lưu tại eno không rút lại hoặc xóa hồ sơ đã gửi đến cơ quan chức năng Việt Nam.')}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => setDeleteTarget(null)}>{tr('Keep application', 'Giữ hồ sơ')}</Button>
              <Button type="button" variant="destructive" className="h-11" data-testid="delete-visa-application-confirm" disabled={busy} onClick={() => void deleteApplication()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{tr('Delete application', 'Xóa hồ sơ')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
