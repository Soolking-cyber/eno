'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, FileCheck2, FileImage, Loader2, LockKeyhole, ShieldCheck, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { forumApi, ForumApiError } from '@/lib/api'
import type { VisaPayload } from '@/lib/visa/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type VisaDocument = { id: string; kind: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; createdAt: string }
type VisaEvent = { id: string; actorType: string; event: string; metadata: Record<string, unknown>; createdAt: string }
type VisaApplication = {
  id: string; status: string; payload?: VisaPayload; checklist: string[]; applicantConfirmedAt: string | null;
  authorizedAt: string | null; assignedAdmin: string | null; submittedAt: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; documents: VisaDocument[]; events?: VisaEvent[]
}

const STEPS = ['Documents', 'Your details', 'Vietnam trip', 'Review'] as const
const EDITABLE = new Set(['draft', 'needs_changes'])

function statusCopy(status: string, tr: (en: string, vi: string) => string) {
  const map: Record<string, [string, string, string, string]> = {
    ready_for_review: ['Ready for review', 'Sẵn sàng xem xét', 'Your case is waiting for an eno specialist.', 'Hồ sơ đang chờ chuyên viên eno xem xét.'],
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

const control = 'h-11 w-full rounded-xl border border-line-strong bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-ring/30 disabled:opacity-50'

function FormField({ id, label, required, children }: { id: string; label: string; required?: boolean; children: React.ReactNode }) {
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground">{label}{required && <span className="sr-only"> required</span>}{children}</label>
}

function VisaSelect({ id, value, onChange, children }: { id: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={control}>{children}</select>
}

export function VisaAssistant() {
  const { tr } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const [application, setApplication] = useState<VisaApplication | null>(null)
  const [payload, setPayload] = useState<VisaPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [declaration, setDeclaration] = useState(false)
  const [authorization, setAuthorization] = useState(false)

  const loadApplication = useCallback(async (background = false) => {
    if (!user) { setApplication(null); setPayload(null); setLoading(false); return }
    if (!background) setLoading(true)
    try {
      const list = await forumApi<{ applications: VisaApplication[] }>('/api/visa/applications', { auth: 'required', direct: true })
      const active = list.applications.find((item) => !['cancelled'].includes(item.status)) || list.applications[0]
      if (!active) { setApplication(null); setPayload(null); return }
      const detail = await forumApi<{ application: VisaApplication }>(`/api/visa/applications/${active.id}`, { auth: 'required', direct: true })
      setApplication(detail.application); setPayload(detail.application.payload || null)
    } catch (error) {
      if (!(error instanceof ForumApiError && error.status === 401)) toast.error(tr('Could not load visa assistance.', 'Không thể tải dịch vụ hỗ trợ visa.'))
    } finally { if (!background) setLoading(false) }
  }, [tr, user])

  useEffect(() => { if (!authLoading) void loadApplication() }, [authLoading, loadApplication])
  useEffect(() => {
    if (!application || EDITABLE.has(application.status) || ['approved', 'rejected', 'cancelled'].includes(application.status)) return
    const timer = window.setInterval(() => void loadApplication(true), 30_000)
    return () => window.clearInterval(timer)
  }, [application, loadApplication])

  const create = async () => {
    if (!user) return openSignIn()
    setBusy(true)
    try {
      const result = await forumApi<{ application: VisaApplication }>('/api/visa/applications', { method: 'POST', auth: 'required', direct: true })
      setApplication(result.application); setPayload(result.application.payload || null)
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }

  const set = <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => setPayload((current) => current ? { ...current, [key]: value } : current)

  const save = async (announce = true) => {
    if (!application || !payload) return null
    const result = await forumApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}`, {
      method: 'PATCH', body: JSON.stringify({ payload }), auth: 'required', direct: true,
    })
    setApplication(result.application); setPayload(result.application.payload || payload)
    if (announce) toast.success(tr('Draft saved privately.', 'Bản nháp đã được lưu riêng tư.'))
    return result.application
  }

  const next = async () => {
    setBusy(true)
    try { await save(false); setStep((value) => Math.min(3, value + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }

  const upload = async (kind: 'portrait' | 'passport', file: File | null) => {
    if (!file || !application || !payload) return
    setBusy(true)
    try {
      if (kind === 'passport' && payload.aiDocumentProcessingConsent) await save(false)
      const form = new FormData(); form.set('kind', kind); form.set('file', file)
      const result = await forumApi<{ document: VisaDocument }>(`/api/visa/applications/${application.id}/documents`, { method: 'POST', body: form, auth: 'required', direct: true })
      setApplication((current) => current ? { ...current, documents: [...current.documents.filter((item) => item.kind !== kind), result.document] } : current)
      toast.success(tr(`${kind === 'passport' ? 'Passport' : 'Portrait'} uploaded securely.`, `${kind === 'passport' ? 'Hộ chiếu' : 'Ảnh chân dung'} đã được tải lên an toàn.`))
      if (kind === 'passport' && payload.aiDocumentProcessingConsent) {
        toast.loading(tr('Reading clearly visible passport fields…', 'Đang đọc các trường rõ ràng trên hộ chiếu…'), { id: 'visa-extract' })
        const extracted = await forumApi<{ payload: VisaPayload; suggestions: string[]; warnings: string[] }>(`/api/visa/applications/${application.id}/extract`, { method: 'POST', auth: 'required', direct: true })
        setPayload(extracted.payload)
        toast.success(tr(`Drafted ${extracted.suggestions.length} fields—please check every one.`, `Đã tạo nháp ${extracted.suggestions.length} trường—vui lòng kiểm tra tất cả.`), { id: 'visa-extract' })
      }
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' '), { id: 'visa-extract' }) } finally { setBusy(false) }
  }

  const submitForReview = async () => {
    if (!application || !declaration) return
    setBusy(true)
    try {
      await save(false)
      const result = await forumApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}/submit`, { method: 'POST', body: JSON.stringify({ action: 'send_for_review', declarationAccepted: true }), auth: 'required', direct: true })
      setApplication(result.application); setPayload(result.application.payload || payload); toast.success(tr('Sent to eno for review.', 'Đã gửi eno xem xét.'))
    } catch (error) {
      if (error instanceof ForumApiError && error.code === 'application_incomplete') toast.error(tr('Complete the highlighted required information first.', 'Vui lòng hoàn thành các thông tin bắt buộc.'))
      else toast.error((error as Error).message.replaceAll('_', ' '))
      const detail = await forumApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}`, { auth: 'required', direct: true }).catch(() => null)
      if (detail) setApplication(detail.application)
    } finally { setBusy(false) }
  }

  const approvePrefill = async () => {
    if (!application || !declaration || !authorization) return
    setBusy(true)
    try {
      const result = await forumApi<{ application: VisaApplication }>(`/api/visa/applications/${application.id}/submit`, { method: 'POST', body: JSON.stringify({ action: 'approve_for_prefill', declarationAccepted: true, prefillAuthorized: true }), auth: 'required', direct: true })
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
      const signed = await forumApi<{ url: string }>(`/api/visa/applications/${application.id}/documents/${result.id}`, { auth: 'required', direct: true })
      if (preview) preview.location.href = signed.url
      else window.location.assign(signed.url)
    } catch (error) {
      preview?.close()
      toast.error((error as Error).message.replaceAll('_', ' '))
    }
  }

  if (loading && user) return <main className="flex flex-1 items-center justify-center py-32"><Loader2 className="h-7 w-7 animate-spin text-accent-foreground" aria-label="Loading" /></main>

  if (!application || !payload) return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-10 sm:px-6 sm:py-16 lg:px-8">
      <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <Badge variant="brand"><FileCheck2 className="h-3.5 w-3.5" />{tr('Assisted Vietnam e-Visa', 'Hỗ trợ E-Visa Việt Nam')}</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">{tr('One guided application. Every answer stays yours.', 'Một hồ sơ có hướng dẫn. Mọi câu trả lời vẫn thuộc về bạn.')}</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-body">{tr('Upload the two required images, let eno draft clearly visible passport fields, review the official answers, and receive the result in one private place.', 'Tải lên hai ảnh bắt buộc, để eno tạo nháp các trường rõ ràng trên hộ chiếu, kiểm tra câu trả lời chính thức và nhận kết quả tại một nơi riêng tư.')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="button" variant="cta" size="lg" disabled={busy} onClick={() => void create()}>{user ? tr('Start private application', 'Bắt đầu hồ sơ riêng tư') : tr('Sign in to start', 'Đăng nhập để bắt đầu')}<ChevronRight className="h-4 w-4" /></Button>
            <a href="https://evisa.gov.vn/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-xl border border-line-strong bg-card px-4 text-sm font-semibold text-body hover:border-brand">{tr('Official e-Visa website', 'Trang E-Visa chính thức')}</a>
          </div>
        </div>
        <Card className="bg-card">
          <CardContent className="space-y-5 py-2">
            {[['1', 'Passport + portrait', 'Hộ chiếu + ảnh chân dung'], ['2', 'Review extracted fields', 'Kiểm tra trường đã trích xuất'], ['3', 'eno human review', 'eno kiểm tra thủ công'], ['4', 'Track and download', 'Theo dõi và tải kết quả']].map(([number, en, vi]) => <div key={number} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{number}</span><p className="pt-1 text-sm font-semibold text-foreground">{tr(en, vi)}</p></div>)}
            <p className="border-t border-border pt-4 text-xs leading-relaxed text-body">{tr('eno is an independent assistance service, not a government agency. Approval is decided only by Vietnamese authorities. Official fees and eno service fees are confirmed separately in writing before payment.', 'eno là dịch vụ hỗ trợ độc lập, không phải cơ quan nhà nước. Việc phê duyệt chỉ do cơ quan chức năng Việt Nam quyết định. Lệ phí chính thức và phí dịch vụ eno được xác nhận riêng bằng văn bản trước thanh toán.')}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  )

  if (!EDITABLE.has(application.status)) {
    const copy = statusCopy(application.status, tr)
    const result = application.documents.find((item) => item.kind === 'result')
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'destructive' : 'brand'}>{copy.title}</Badge><span className="text-xs text-ink-4">{application.id.slice(0, 8)}</span></div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">{copy.title}</h1><p className="mt-2 text-body">{copy.detail}</p>
        {payload.adminMessage && <Card className="mt-6"><CardHeader><CardTitle>{tr('Private update from eno', 'Cập nhật riêng từ eno')}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-body">{payload.adminMessage}</p></CardContent></Card>}
        {application.status === 'applicant_approval' && (
          <Card className="mt-6">
            <CardHeader><CardTitle>{tr('Final applicant authorization', 'Ủy quyền cuối cùng của người nộp')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-body">{tr('Compare the details below with your passport and trip. eno will use only this approved snapshot to prepare the official form.', 'Đối chiếu thông tin bên dưới với hộ chiếu và chuyến đi. eno chỉ dùng bản đã duyệt này để chuẩn bị biểu mẫu chính thức.')}</p>
              <ReviewGrid payload={payload} tr={tr} />
              <Consent checked={declaration} onChange={setDeclaration}>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</Consent>
              <Consent checked={authorization} onChange={setAuthorization}>{tr('I authorize eno to prefill these approved answers and upload these approved images to the official website. A person must still review the official form before submission and payment.', 'Tôi cho phép eno điền trước các câu trả lời và tải ảnh đã duyệt lên trang chính thức. Một người vẫn phải kiểm tra biểu mẫu chính thức trước khi nộp và thanh toán.')}</Consent>
              <Button type="button" variant="cta" className="h-11" disabled={busy || !declaration || !authorization} onClick={() => void approvePrefill()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{tr('Approve for official prefill', 'Duyệt để điền biểu mẫu chính thức')}</Button>
            </CardContent>
          </Card>
        )}
        {result && <Button type="button" variant="cta" size="lg" className="mt-6" onClick={() => void downloadResult()}><Download className="h-4 w-4" />{tr('Download official e-Visa PDF', 'Tải PDF E-Visa chính thức')}</Button>}
        {['approved', 'rejected', 'cancelled'].includes(application.status) && <Button type="button" variant="outline" size="lg" className="mt-6 sm:ml-2" disabled={busy} onClick={() => void create()}>{tr('Start a new application', 'Bắt đầu hồ sơ mới')}</Button>}
        <Card className="mt-6"><CardHeader><CardTitle>{tr('Case timeline', 'Tiến trình hồ sơ')}</CardTitle></CardHeader><CardContent><ol className="space-y-4">{(application.events || []).map((event) => <li key={event.id} className="flex items-start justify-between gap-4 border-l-2 border-brand/30 pl-3"><span className="text-sm font-medium capitalize text-foreground">{event.event.replaceAll('_', ' ')}</span><time className="shrink-0 text-xs text-ink-4">{new Date(event.createdAt).toLocaleDateString()}</time></li>)}</ol></CardContent></Card>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Badge variant="brand"><LockKeyhole className="h-3.5 w-3.5" />{tr('Private application', 'Hồ sơ riêng tư')}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{tr('Vietnam e-Visa assistance', 'Hỗ trợ E-Visa Việt Nam')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-body">{tr('Four short stages. Save anytime. Nothing is submitted to the government until after your final approval and human review.', 'Bốn bước ngắn. Có thể lưu bất cứ lúc nào. Không nội dung nào được nộp cho cơ quan chức năng trước phê duyệt cuối cùng và kiểm tra thủ công.')}</p>
      </div>
      {application.status === 'needs_changes' && payload.adminMessage && <div className="mb-5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"><strong>{tr('Changes requested:', 'Yêu cầu chỉnh sửa:')}</strong> {payload.adminMessage}</div>}

      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Application progress">
        {STEPS.map((label, index) => <li key={label}><button type="button" onClick={() => setStep(index)} className={cn('flex h-11 w-full items-center justify-center rounded-xl border px-2 text-xs font-bold transition-colors', index === step ? 'border-brand bg-accent text-accent-foreground' : index < step ? 'border-line-strong bg-card text-foreground' : 'border-border bg-tint text-body')}><span className="sm:hidden">{index + 1}</span><span className="hidden sm:inline">{index + 1}. {tr(label, ['Giấy tờ', 'Thông tin', 'Chuyến đi', 'Kiểm tra'][index])}</span></button></li>)}
      </ol>

      {step === 0 && <DocumentsStep application={application} payload={payload} set={set} upload={upload} busy={busy} tr={tr} />}
      {step === 1 && <PersonalStep payload={payload} set={set} tr={tr} />}
      {step === 2 && <TripStep payload={payload} set={set} tr={tr} />}
      {step === 3 && (
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>{tr('Review everything', 'Kiểm tra mọi thông tin')}</CardTitle></CardHeader><CardContent><ReviewGrid payload={payload} tr={tr} /></CardContent></Card>
          {application.checklist.length > 0 && <Card className="border border-destructive/30"><CardHeader><CardTitle>{tr('Still needed', 'Còn thiếu')}</CardTitle></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{application.checklist.map((issue) => <li key={issue} className="text-sm text-destructive">• {issue.replaceAll('_', ' ')}</li>)}</ul></CardContent></Card>}
          <Consent checked={declaration} onChange={setDeclaration}>{tr('I confirm that every answer is complete, true, and accurate. I understand false information can cause refusal and legal consequences.', 'Tôi xác nhận mọi câu trả lời đầy đủ, trung thực và chính xác. Tôi hiểu thông tin sai có thể dẫn đến từ chối và hậu quả pháp lý.')}</Consent>
          <Button type="button" variant="cta" size="lg" className="h-11 w-full sm:w-auto" disabled={busy || !declaration} onClick={() => void submitForReview()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}{tr('Send to eno for review', 'Gửi eno xem xét')}</Button>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button type="button" variant="outline" className="h-11" disabled={busy || step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ChevronLeft className="h-4 w-4" />{tr('Back', 'Quay lại')}</Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void save()}>{tr('Save draft', 'Lưu bản nháp')}</Button>
          {step < 3 && <Button type="button" variant="cta" className="h-11" disabled={busy} onClick={() => void next()}>{tr('Save and continue', 'Lưu và tiếp tục')}<ChevronRight className="h-4 w-4" /></Button>}
        </div>
      </div>
    </main>
  )
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-card p-4 text-sm leading-relaxed text-body"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{children}</span></label>
}

function DocumentsStep({ application, payload, set, upload, busy, tr }: { application: VisaApplication; payload: VisaPayload; set: <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => void; upload: (kind: 'portrait' | 'passport', file: File | null) => void; busy: boolean; tr: (en: string, vi: string) => string }) {
  const has = (kind: string) => application.documents.some((item) => item.kind === kind)
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2">
      <UploadCard kind="passport" title={tr('Passport data page', 'Trang thông tin hộ chiếu')} detail={tr('Clear, full page, no missing corners. JPG, PNG, or WebP; eno converts it to the official JPG limit.', 'Rõ nét, đầy đủ trang, không mất góc. JPG, PNG hoặc WebP; eno chuyển sang giới hạn JPG chính thức.')} ready={has('passport')} busy={busy} onFile={(file) => upload('passport', file)} />
      <UploadCard kind="portrait" title={tr('Portrait photo', 'Ảnh chân dung')} detail={tr('4×6 portrait, straight face, no hat or glasses, formal clothes, white background.', 'Ảnh 4×6, nhìn thẳng, không đội mũ hoặc đeo kính, trang phục lịch sự, nền trắng.')} ready={has('portrait')} busy={busy} onFile={(file) => upload('portrait', file)} />
    </div>
    <Consent checked={payload.aiDocumentProcessingConsent} onChange={(value) => set('aiDocumentProcessingConsent', value)}><span className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />{tr('Allow eno AI to read clearly visible passport fields into this private draft. AI may be wrong; I will compare every suggestion with my passport before confirming.', 'Cho phép AI eno đọc các trường rõ ràng trên hộ chiếu vào bản nháp riêng tư này. AI có thể sai; tôi sẽ đối chiếu mọi gợi ý với hộ chiếu trước khi xác nhận.')}</span></Consent>
    <p className="flex gap-2 rounded-2xl bg-tint p-4 text-xs leading-relaxed text-body"><LockKeyhole className="h-4 w-4 shrink-0" />{tr('Documents are stored in a private bucket and opened only through short-lived owner/admin links. Do not upload a document that is not yours.', 'Giấy tờ được lưu trong kho riêng tư và chỉ mở qua liên kết ngắn hạn cho chủ sở hữu/quản trị viên. Không tải lên giấy tờ không thuộc về bạn.')}</p>
  </div>
}

function UploadCard({ title, detail, ready, busy, onFile }: { kind: string; title: string; detail: string; ready: boolean; busy: boolean; onFile: (file: File | null) => void }) {
  return <Card className={cn('border', ready ? 'border-success/40' : 'border-line-strong')}><CardContent className="flex h-full flex-col gap-4 py-1"><div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">{ready ? <Check className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}</span>{ready && <Badge variant="success">Ready</Badge>}</div><div className="flex-1"><h2 className="font-bold text-foreground">{title}</h2><p className="mt-1 text-xs leading-relaxed text-body">{detail}</p></div><label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-strong bg-background px-4 text-sm font-bold text-foreground hover:border-brand"><Upload className="h-4 w-4" />{ready ? 'Replace image' : 'Choose image'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => onFile(event.target.files?.[0] || null)} /></label></CardContent></Card>
}

function PersonalStep({ payload, set, tr }: { payload: VisaPayload; set: <K extends keyof VisaPayload>(key: K, value: VisaPayload[K]) => void; tr: (en: string, vi: string) => string }) {
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{tr('Personal details', 'Thông tin cá nhân')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Text id="surname" label={tr('Surname', 'Họ')} value={payload.surname} onChange={(v) => set('surname', v)} />
      <Text id="givenNames" label={tr('Given and middle names', 'Tên đệm và tên')} value={payload.givenNames} onChange={(v) => set('givenNames', v)} />
      <Text id="dateOfBirth" type="date" label={tr('Date of birth', 'Ngày sinh')} value={payload.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} />
      <FormField id="sex" label={tr('Sex', 'Giới tính')}><VisaSelect id="sex" value={payload.sex} onChange={(v) => set('sex', v as VisaPayload['sex'])}><option value="">Choose</option><option value="male">Male</option><option value="female">Female</option></VisaSelect></FormField>
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
      <FormField id="passportType" label={tr('Passport type', 'Loại hộ chiếu')}><VisaSelect id="passportType" value={payload.passportType} onChange={(v) => set('passportType', v as VisaPayload['passportType'])}><option value="ordinary">Ordinary</option><option value="official">Official</option><option value="diplomatic">Diplomatic</option><option value="other">Other</option></VisaSelect></FormField>
      <Text id="passportAuthority" label={tr('Issuing authority/place', 'Nơi/cơ quan cấp')} value={payload.passportIssuingAuthority} onChange={(v) => set('passportIssuingAuthority', v)} />
      <Text id="passportIssue" type="date" label={tr('Issue date', 'Ngày cấp')} value={payload.passportIssueDate} onChange={(v) => set('passportIssueDate', v)} />
      <Text id="passportExpiry" type="date" label={tr('Expiry date', 'Ngày hết hạn')} value={payload.passportExpiryDate} onChange={(v) => set('passportExpiryDate', v)} />
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
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{tr('Requested visa', 'Visa yêu cầu')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="entryType" label={tr('Entry type', 'Loại nhập cảnh')}><VisaSelect id="entryType" value={payload.entryType} onChange={(v) => set('entryType', v as VisaPayload['entryType'])}><option value="single">Single entry</option><option value="multiple">Multiple entry</option></VisaSelect></FormField>
      <Text id="visaFrom" type="date" label={tr('Visa valid from', 'Visa có hiệu lực từ')} value={payload.visaValidFrom} onChange={(v) => set('visaValidFrom', v)} />
      <Text id="visaTo" type="date" label={tr('Visa valid to', 'Visa có hiệu lực đến')} value={payload.visaValidTo} onChange={(v) => set('visaValidTo', v)} />
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tr('Vietnam stay', 'Lưu trú tại Việt Nam')}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Text id="purpose" label={tr('Purpose of entry', 'Mục đích nhập cảnh')} value={payload.purposeOfEntry} onChange={(v) => set('purposeOfEntry', v)} />
      <YesNo id="outsideVietnam" label={tr('Are you currently outside Vietnam?', 'Hiện bạn có ở ngoài Việt Nam?')} value={payload.currentlyOutsideVietnam} onChange={(v) => set('currentlyOutsideVietnam', v)} />
      <Text id="entryDate" type="date" label={tr('Intended entry date', 'Ngày dự kiến nhập cảnh')} value={payload.intendedEntryDate} onChange={(v) => set('intendedEntryDate', v)} />
      <FormField id="stayLength" label={tr('Length of stay (days)', 'Thời gian lưu trú (ngày)')}><Input id="stayLength" variant="outline" type="number" min={1} max={90} value={payload.stayLengthDays || ''} onChange={(event) => set('stayLengthDays', Math.min(90, Math.max(0, Number(event.target.value))))} className="h-11 py-0" /></FormField>
      <Text id="temporaryAddress" label={tr('First Vietnam address/hotel', 'Địa chỉ/khách sạn đầu tiên')} value={payload.temporaryAddress} onChange={(v) => set('temporaryAddress', v)} />
      <Text id="province" label={tr('Province/city', 'Tỉnh/thành phố')} value={payload.temporaryProvince} onChange={(v) => set('temporaryProvince', v)} />
      <Text id="ward" label={tr('Ward/commune (if known)', 'Phường/xã (nếu biết)')} value={payload.temporaryWard} onChange={(v) => set('temporaryWard', v)} />
      <Text id="entryGate" label={tr('Entry checkpoint', 'Cửa khẩu nhập cảnh')} value={payload.entryGate} onChange={(v) => set('entryGate', v)} />
      <Text id="exitGate" label={tr('Exit checkpoint', 'Cửa khẩu xuất cảnh')} value={payload.exitGate} onChange={(v) => set('exitGate', v)} />
      <Text id="localContactName" label={tr('Inviting/local contact (if any)', 'Liên hệ tại Việt Nam (nếu có)')} value={payload.localContactName} onChange={(v) => set('localContactName', v)} />
      <Text id="localContactAddress" label={tr('Local contact address', 'Địa chỉ liên hệ tại Việt Nam')} value={payload.localContactAddress} onChange={(v) => set('localContactAddress', v)} />
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
      <FormField id="payer" label={tr('Who pays?', 'Ai chi trả?')}><VisaSelect id="payer" value={payload.expensesPayer} onChange={(v) => set('expensesPayer', v as VisaPayload['expensesPayer'])}><option value="self">Self</option><option value="organization">Organization</option><option value="other">Other person</option></VisaSelect></FormField>
      {payload.expensesPayer !== 'self' && <Text id="payerDetails" label={tr('Payer name/contact', 'Tên/liên hệ người chi trả')} value={payload.payerDetails} onChange={(v) => set('payerDetails', v)} />}
      <YesNo id="insurance" label={tr('Travel insurance?', 'Có bảo hiểm du lịch?')} value={payload.hasTravelInsurance} onChange={(v) => set('hasTravelInsurance', v)} />
      {payload.hasTravelInsurance === 'yes' && <Text id="insuranceDetails" label={tr('Insurance provider/policy', 'Nhà cung cấp/hợp đồng bảo hiểm')} value={payload.insuranceDetails} onChange={(v) => set('insuranceDetails', v)} />}
      <FormField id="notes" label={tr('Anything eno should know?', 'Thông tin thêm cho eno?')}><Textarea id="notes" variant="outline" size="compact" rows={3} value={payload.applicantNotes} onChange={(event) => set('applicantNotes', event.target.value)} /></FormField>
    </CardContent></Card>
  </div>
}

function Text({ id, label, value, onChange, type = 'text' }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <FormField id={id} label={label}><Input id={id} variant="outline" type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 py-0" /></FormField>
}

function YesNo({ id, label, value, onChange }: { id: string; label: string; value: '' | 'yes' | 'no'; onChange: (value: '' | 'yes' | 'no') => void }) {
  return <FormField id={id} label={label}><VisaSelect id={id} value={value} onChange={(v) => onChange(v as '' | 'yes' | 'no')}><option value="">Choose</option><option value="no">No</option><option value="yes">Yes</option></VisaSelect></FormField>
}

function ReviewGrid({ payload }: { payload: VisaPayload; tr: (en: string, vi: string) => string }) {
  const omit = new Set(['schemaVersion', 'aiDocumentProcessingConsent', 'adminMessage', 'governmentRegistrationCode', 'governmentApplicationStatus'])
  const items = Object.entries(payload)
    .filter(([key]) => !omit.has(key))
    .map(([key, value]): [string, unknown] => [key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()), value])
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-4">{label}</dt><dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{String(value || '—')}</dd></div>)}</dl>
}
