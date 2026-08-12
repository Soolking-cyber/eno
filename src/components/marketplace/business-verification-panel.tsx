'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from '@/components/ui/icons'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { EnoSeal } from './eno-seal'

// The seller's own "get verified" surface (mounts under the business profile editor).
// One badge, granted after >=2 channels: the tax-registry check (Channel 1, automatic,
// keyed off the tax code above) plus this human document review (Channel 2). The seller
// uploads a business/identity document and a bank document (holder name = legal name),
// consents (PDPL), and submits; an admin reviews. The badge is identity-hash-derived, so
// editing the legal details after approval quietly drops it until re-verified.

type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected'
type CaseView = { status: CaseStatus; documentKinds: string[]; submittedAt: string | null; note: string | null } | null
type LiveView = 'unverified' | 'pending' | 'verified' | 'expired' | 'rejected' | 'changes_needed'

const ERROR_COPY: Record<string, [string, string]> = {
  missing_legal_fields: ['Fill in and save your legal name, address, ID and tax code above first.', 'Hãy điền và lưu tên pháp lý, địa chỉ, số giấy tờ và mã số thuế ở trên trước.'],
  missing_identity_doc: ['Upload a business/identity document.', 'Hãy tải lên giấy tờ kinh doanh/định danh.'],
  missing_bank_doc: ['Upload a bank document showing the account-holder name.', 'Hãy tải lên giấy tờ ngân hàng có tên chủ tài khoản.'],
  duplicate_tax: ['This tax code is already verified on another storefront.', 'Mã số thuế này đã được xác minh trên một gian hàng khác.'],
  consent_required: ['Please tick the consent box.', 'Vui lòng tích vào ô đồng ý.'],
  rate_limited: ['Too many attempts — try again in a little while.', 'Thử quá nhiều lần — vui lòng thử lại sau ít phút.'],
  file_too_large: ['That file is over 15 MB.', 'Tệp vượt quá 15 MB.'],
  unsupported_file_type: ['Use a JPG, PNG or PDF.', 'Dùng JPG, PNG hoặc PDF.'],
}

export function BusinessVerificationPanel() {
  const { tr } = useLanguage()
  const [view, setView] = useState<CaseView>(null)
  const [live, setLive] = useState<LiveView>('unverified')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false)
  const idInput = useRef<HTMLInputElement>(null)
  const bankInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/seller/verification', { cache: 'no-store' })
      if (res.ok) { const b = (await res.json()) as { case: CaseView; view: LiveView }; setView(b.case); setLive(b.view ?? 'unverified') }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const errCopy = (code: string | undefined) => {
    const c = code ? ERROR_COPY[code] : undefined
    return c ? tr(c[0], c[1]) : tr('Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.')
  }

  const upload = async (kind: 'identity' | 'bank', file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', file)
      const res = await fetch('/api/seller/verification/documents', { method: 'POST', body: form })
      const b = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) { toast.error(errCopy(b?.error)); return }
      toast.success(tr('Document uploaded.', 'Đã tải lên giấy tờ.'))
      await load()
    } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!consent) { toast.error(errCopy('consent_required')); return }
    setBusy(true)
    try {
      const res = await fetch('/api/seller/verification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }),
      })
      const b = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) { toast.error(errCopy(b?.error)); return }
      toast.success(tr('Submitted for review.', 'Đã gửi để xét duyệt.'))
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return (
    <div role="status" className="mt-6 rounded-2xl bg-tint p-4">
      <Skeleton className="h-5 w-40 rounded-lg" />
      <Skeleton className="mt-3 h-4 w-full rounded-lg" />
      <Skeleton className="mt-2 h-4 w-2/3 rounded-lg" />
    </div>
  )

  // Drive the panel off the LIVE view (verified/pending/expired/…), not the raw case
  // status — an approved case whose badge dropped (identity edited / expired) reads
  // 'expired' and re-opens the upload flow rather than falsely showing "verified".
  const isVerified = live === 'verified'
  const isPending = live === 'pending'
  const hasId = view?.documentKinds.includes('identity')
  const hasBank = view?.documentKinds.includes('bank')

  return (
    <div className="mt-6 rounded-2xl bg-tint p-4">
      {/* First-party verification is a SEAL moment (icon-language §0b): the eno seal replaces
          lucide ShieldCheck + BadgeCheck here — this panel claims eno's own trust, not a generic one. */}
      {/* text-foreground on the WRAPPER so the seal's line inherits the heading ink (§0 —
          the wash in the chief is the brand note; a blue outline is §6's link signal). */}
      <div className="flex items-center gap-2 text-foreground">
        <EnoSeal className="h-4 w-4" />
        <h3 className="text-sm font-bold text-foreground">{tr('Get your business verified', 'Xác minh doanh nghiệp')}</h3>
      </div>

      {isVerified ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-success">
          {/* Success ink on the line, brand wash in the chief — §0's "same line, one wash". */}
          <EnoSeal className="h-4 w-4" /> {tr('Your business is verified.', 'Doanh nghiệp của bạn đã được xác minh.')}
        </p>
      ) : isPending ? (
        <p className="mt-2 text-sm text-body">
          {tr('Your documents are under review. We will update this once a specialist has checked them.', 'Giấy tờ của bạn đang được xét duyệt. Chúng tôi sẽ cập nhật sau khi chuyên viên kiểm tra.')}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-body">
            {live === 'expired'
              ? tr(
                'Your verification no longer matches your current details (or has expired). Re-submit the two documents to verify again.',
                'Xác minh không còn khớp với thông tin hiện tại (hoặc đã hết hạn). Hãy gửi lại hai giấy tờ để xác minh lại.',
              )
              : tr(
                'Add two proofs and a specialist confirms them: a business or ID document, and a bank document whose account-holder name matches your legal name. Your tax code is checked automatically.',
                'Thêm hai giấy tờ để chuyên viên xác nhận: giấy tờ kinh doanh hoặc định danh, và giấy tờ ngân hàng có tên chủ tài khoản trùng với tên pháp lý của bạn. Mã số thuế được kiểm tra tự động.',
              )}
          </p>
          {live === 'rejected' && view?.note && (
            <p className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
              {tr('A specialist asked for a change:', 'Chuyên viên yêu cầu chỉnh sửa:')} {view.note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <input ref={idInput} type="file" accept="image/jpeg,image/png,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('identity', f); e.target.value = '' }} />
            <input ref={bankInput} type="file" accept="image/jpeg,image/png,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('bank', f); e.target.value = '' }} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => idInput.current?.click()}>
              <Upload className="h-4 w-4" /> {hasId ? tr('Business / ID ✓', 'Giấy tờ KD/định danh ✓') : tr('Business / ID document', 'Giấy tờ KD/định danh')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => bankInput.current?.click()}>
              <Upload className="h-4 w-4" /> {hasBank ? tr('Bank document ✓', 'Giấy tờ ngân hàng ✓') : tr('Bank document', 'Giấy tờ ngân hàng')}
            </Button>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-body">
            {/* h-5: matches the listing-row/availability rounded-square check boxes — the h-4
                default turns the 7px radius token into a circle and forks the checkbox family. */}
            <Checkbox checked={consent} onChange={setConsent} className="mt-0.5 h-5 w-5" />
            <span>{tr('I allow eno to process these documents to verify my business. They are deleted after review.', 'Tôi cho phép eno xử lý các giấy tờ này để xác minh doanh nghiệp. Chúng sẽ được xóa sau khi xét duyệt.')}</span>
          </label>

          <div className="mt-3">
            <Button variant="cta" size="sm" disabled={busy || !hasId || !hasBank || !consent} onClick={() => void submit()}>
              {/* line variant: on the solid brand CTA the ink already carries the meaning (§0b). */}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <EnoSeal variant="line" className="h-4 w-4" />}
              {tr('Submit for verification', 'Gửi để xác minh')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
