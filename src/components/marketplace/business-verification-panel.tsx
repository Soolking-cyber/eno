'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Upload, ShieldCheck, Check } from "@/components/ui/icons"
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

// The seller's own "get verified" surface (mounts under the business profile editor).
// One badge, granted after >=2 channels: the tax-registry check (Channel 1, automatic,
// keyed off the tax code above) plus this human document review (Channel 2). The seller
// uploads a business/identity document and a bank document (holder name = legal name),
// consents (PDPL), and submits; an admin reviews. The badge is identity-hash-derived, so
// editing the legal details after approval quietly drops it until re-verified.

type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected'
type CaseView = { status: CaseStatus; documentKinds: string[]; submittedAt: string | null; note: string | null } | null
type LiveView = 'unverified' | 'pending' | 'verified' | 'expired' | 'rejected' | 'changes_needed'

// ⚠️ MODULE CONSTANTS, NOT JSX LITERALS. `react/jsx-no-literals` guards against untranslated copy
// in markup, and a step NUMERAL is not copy — it reads identically in both languages and must never
// be routed through tr(). Naming them keeps the lint honest instead of disabling it.
const STEP_ONE = '1'
const STEP_TWO = '2'

const ERROR_COPY: Record<string, [string, string]> = {
  missing_legal_fields: ['Fill in and save your legal name, address, ID and tax code above first.', 'Hãy điền và lưu tên pháp lý, địa chỉ, số giấy tờ và mã số thuế ở trên trước.'],
  missing_identity_doc: ['Upload a business/identity document.', 'Hãy tải lên giấy tờ kinh doanh/định danh.'],
  missing_bank_doc: ['Upload a bank document showing the account-holder name.', 'Hãy tải lên giấy tờ ngân hàng có tên chủ tài khoản.'],
  duplicate_tax: ['This tax code is already verified on another storefront.', 'Mã số thuế này đã được xác minh trên một gian hàng khác.'],
  consent_required: ['Please tick the consent box.', 'Vui lòng tích vào ô đồng ý.'],
  // ⚠️ THE SEQUENCING REFUSAL. A seller reaches it only by racing their own verification expiring
  // between opening this panel and submitting, since the UI locks step 2 until step 1 is done — so
  // the copy has to make sense to someone who believed they had already verified.
  person_unverified: ['Verify yourself first — step 1 above.', 'Hãy xác minh bản thân trước — bước 1 ở trên.'],
  rate_limited: ['Too many attempts — try again in a little while.', 'Thử quá nhiều lần — vui lòng thử lại sau ít phút.'],
  file_too_large: ['That file is over 15 MB.', 'Tệp vượt quá 15 MB.'],
  unsupported_file_type: ['Use a JPG, PNG or PDF.', 'Dùng JPG, PNG hoặc PDF.'],
}

export function BusinessVerificationPanel({ showPersonSteps = true }: { showPersonSteps?: boolean } = {}) {
  const { tr } = useLanguage()
  const [view, setView] = useState<CaseView>(null)
  const [live, setLive] = useState<LiveView>('unverified')
  /**
   * ⛔ TWO SEPARATE FACTS, AND COLLAPSING THEM WOULD DRAW A LOCK THAT DOES NOT EXIST. `personGate`
   * says whether the sequencing is ENFORCED here at all — it is marketplace-only and behind its own
   * env switch — and `personVerified` says whether this person has done it. On eno.forum, or with
   * the flag off, the gate is false and step 1 must not be shown as a barrier.
   */
  const [personGate, setPersonGate] = useState(false)
  const [personVerified, setPersonVerified] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false)
  const idInput = useRef<HTMLInputElement>(null)
  const bankInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/seller/verification', { cache: 'no-store' })
      if (res.ok) {
        const b = (await res.json()) as { case: CaseView; view: LiveView; personGate?: boolean; personVerified?: boolean }
        setView(b.case)
        setLive(b.view ?? 'unverified')
        setPersonGate(b.personGate === true)
        // ⚠️ DEFAULTS TO TRUE, so an older server that does not send the field cannot silently lock
        // every seller out of a flow that worked yesterday. The server is the gate; this is chrome.
        setPersonVerified(b.personVerified !== false)
      }
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
  // ⛔ THE REAL STEP-2 LOCK (the comment used to claim one that did not exist — reviewer-caught).
  // When the person gate is on and stage 1 is not done, step 2's uploads and submit are genuinely
  // disabled here, not just dimmed — so the flow can't be filled in and then refused at the end,
  // which the panel's own copy calls the worst ordering. The server gate stays the authority.
  const stepOneIncomplete = personGate && !personVerified
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
      {/**
        * ⛔ THE INVITATION DISAPPEARS ONCE IT HAS BEEN ACCEPTED. Owner, 2026-08-17: "once verified
        * remove the get your ....". This heading was unconditional, so a verified seller read
        * "Get your business verified" directly above "Your business is verified." — an instruction
        * to do a thing they had already done, in bolder type than the confirmation.
        * A panel in a terminal state should state that state, not keep advertising the journey.
        */}
      {!isVerified && (
        <div className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4" />
          <h3 className="text-sm font-bold text-foreground">{tr('Get your business verified', 'Xác minh doanh nghiệp')}</h3>
        </div>
      )}

      {/**
        * ⛔ STEP 1 IS SHOWN AS A PREREQUISITE, NOT DISCOVERED AS A REFUSAL. Owner, 2026-08-31: a
        * person verifies themselves, THEN their business. Before this the panel opened straight into
        * uploads, so someone could fill in a tax code, photograph a business licence and a bank
        * statement, tick consent, press submit — and only then be told none of it counted. The
        * server refusal (`person_unverified`) still exists and is the real gate; this is what stops
        * anyone reaching it.
        * ⚠️ RENDERED ONLY WHEN THE GATE IS ACTUALLY ON. `personGate` is marketplace-only and behind
        * its own env switch, so on eno.forum — where the sequencing deliberately does not apply —
        * this whole block is absent rather than showing a lock nothing enforces.
        */}
      {/* ⚠️ SUPPRESSED WHEN EMBEDDED IN THE VERIFICATION HUB, which draws its OWN step 1/step 2
          rail around this panel — rendering the panel's rail too stacked the sequence twice on
          the one screen built to make it legible (reviewer-caught). Standalone in Settings the
          panel keeps its rail (default true). */}
      {showPersonSteps && personGate && !isVerified && (
        <ol className="mt-3 space-y-2">
          <li className={cn(
            'flex items-start gap-3 rounded-xl p-3',
            personVerified ? 'bg-success/10' : 'bg-card',
          )}>
            <span className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              personVerified ? 'bg-success text-success-foreground' : 'bg-muted text-body',
            )}>
              {personVerified ? <Check className="size-3" aria-hidden="true" /> : <span>{STEP_ONE}</span>}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {tr('Step 1 — verify yourself', 'Bước 1 — xác minh bản thân')}
              </p>
              <p className="mt-0.5 text-xs text-body">
                {personVerified
                  ? tr('Done. Your identity is verified.', 'Hoàn tất. Danh tính của bạn đã được xác minh.')
                  : tr(
                      'A named person has to stand behind a business storefront. This takes a few minutes and only has to be done once.',
                      'Một cá nhân có danh tính phải đứng sau gian hàng doanh nghiệp. Việc này mất vài phút và chỉ cần làm một lần.',
                    )}
              </p>
              {!personVerified && (
                <Button variant="cta" size="sm" asChild className="mt-2">
                  <a href="/dashboard/account/verify">{tr('Verify yourself', 'Xác minh bản thân')}</a>
                </Button>
              )}
            </div>
          </li>

          <li className={cn('flex items-start gap-3 rounded-xl p-3', personVerified ? 'bg-card' : 'bg-card opacity-60')}>
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-body">
              {STEP_TWO}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {tr('Step 2 — verify your business', 'Bước 2 — xác minh doanh nghiệp')}
              </p>
              <p className="mt-0.5 text-xs text-body">
                {personVerified
                  ? tr('Tax code, business licence and a bank document — below.', 'Mã số thuế, giấy phép kinh doanh và giấy tờ ngân hàng — ở bên dưới.')
                  : tr('Available once step 1 is done.', 'Khả dụng sau khi hoàn tất bước 1.')}
              </p>
            </div>
          </li>
        </ol>
      )}

      {isVerified ? (
        /* ⚠️ NO `mt-2` HERE ANY MORE — it was spacing this line BELOW the heading that is now gone,
           so keeping it would leave a gap at the top of the card with nothing above it. */
        <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
          {/* Success ink on the line, brand wash in the chief — §0's "same line, one wash". */}
          <ShieldCheck className="h-4 w-4" /> {tr('Your business is verified.', 'Doanh nghiệp của bạn đã được xác minh.')}
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
            <Button variant="outline" size="sm" disabled={busy || stepOneIncomplete} onClick={() => idInput.current?.click()}>
              <Upload className="h-4 w-4" /> {hasId ? tr('Business / ID ✓', 'Giấy tờ KD/định danh ✓') : tr('Business / ID document', 'Giấy tờ KD/định danh')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy || stepOneIncomplete} onClick={() => bankInput.current?.click()}>
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
            <Button variant="cta" size="sm" disabled={busy || !hasId || !hasBank || !consent || stepOneIncomplete} onClick={() => void submit()}>
              {/* line variant: on the solid brand CTA the ink already carries the meaning (§0b). */}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {tr('Submit for verification', 'Gửi để xác minh')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
