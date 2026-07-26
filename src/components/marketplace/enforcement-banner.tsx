'use client'

import { useState } from 'react'
import { AlertTriangle, ShieldAlert, Loader2, Scale, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// Dashboard enforcement banner (trust Phase 2). Renders at the top of the Listings
// tab when the account isn't in good standing, or when an open report awaits the
// seller's reply. Voice: calm, specific, exactly ONE next action — never
// punitive-corporate. Borderless tinted panel per the design system.

export type EnforcementInfo = {
  state: 'good_standing' | 'warned' | 'throttled' | 'held' | 'suspended'
  until: string | null
  action: {
    id: string
    state: string
    reason: string // slug — mapped to copy here (server stores slugs, not prose)
    notice: string | null // optional admin-written note shown verbatim
    createdAt: string
    expiresAt: string | null
    appealedAt: string | null
    appealOutcome: string | null // 'upheld' | 'overturned' | null
  } | null
  openReports: { id: string; reason: string; detail: string | null; createdAt: string; evidenceUntil: string | null; listing: { id: string; title: string; image: string | null } | null }[]
}

// Buyer report reasons → labels (mirrors the report form's options). Literal tr()
// calls so gen-ui-strings harvests them for the warm-translation batch.
function reportReasonLabel(tr: (en: string, vi?: string) => string, reason: string): string {
  switch (reason) {
    case 'scam': return tr('a possible scam', 'nghi ngờ lừa đảo')
    case 'counterfeit': return tr('a counterfeit item', 'hàng giả')
    case 'sold': return tr('an already-sold item', 'món hàng đã bán')
    case 'wrong-info': return tr('wrong information', 'thông tin sai')
    case 'duplicate': return tr('a duplicate listing', 'tin đăng trùng lặp')
    case 'offensive': return tr('offensive behavior', 'hành vi xúc phạm')
    default: return tr('a problem', 'một vấn đề')
  }
}

/** One open report → a prominent link into the dedicated dispute case. The seller's
 *  reply + evidence now live ENTIRELY in the dispute room (one statement + photos per
 *  side), so this is a highlight + one CTA, not an inline reply form. */
function ReportAlert({ report }: { report: EnforcementInfo['openReports'][number] }) {
  const { tr, lang } = useLanguage()
  // Once the 72h evidence window has closed, the seller can no longer add their side —
  // relabel so the CTA isn't a dead end (they can still open the case to follow it).
  const windowOpen = !report.evidenceUntil || new Date(report.evidenceUntil).getTime() > Date.now()
  return (
    <a
      href={`/disputes/${report.id}`}
      className="block rounded-xl bg-card/70 p-3 transition-colors hover:bg-card"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15"><Scale className="h-4 w-4 text-warning" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {tr('A buyer reported', 'Một người mua đã báo cáo')} {reportReasonLabel(tr, report.reason)}
            {!report.listing && <span className="ml-1 font-normal">{tr('about your account', 'về tài khoản của bạn')}</span>}
            <span className="ml-1.5 font-normal text-muted-foreground">{new Date(report.createdAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short' })}</span>
          </p>
          {/* WHICH listing — thumbnail + title. A report without the product left
              sellers guessing ("its not what product"). */}
          {report.listing && (
            <span className="mt-1.5 flex items-center gap-2.5">
              {report.listing.image ? (
                <img src={report.listing.image} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-9 w-9 shrink-0 rounded-lg bg-tint" />
              )}
              <span className="min-w-0 truncate text-sm font-semibold text-accent-foreground">{report.listing.title}</span>
            </span>
          )}
          {/* WHAT the buyer said — the complaint itself (never the reporter's identity). */}
          {report.detail && (
            <p className="mt-1.5 text-sm text-body">
              <span className="font-semibold text-muted-foreground">{tr('Buyer says:', 'Người mua nói:')}</span>{' '}
              <span className="italic">“{report.detail.slice(0, 300)}”</span>
            </p>
          )}
          <p className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-accent-foreground">
            {windowOpen
              ? tr('Open the dispute case to add your side', 'Mở hồ sơ khiếu nại để trình bày')
              : tr('Open the dispute case to follow it', 'Mở hồ sơ khiếu nại để theo dõi')} <ChevronRight className="h-4 w-4" />
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {windowOpen
              ? tr('You get one statement with photos — add it within 72 hours to keep your standing.', 'Bạn được trình bày một lần kèm ảnh — gửi trong 72 giờ để giữ uy tín.')
              : tr('The response window has closed — the case is with the eno.vn team.', 'Đã hết thời gian phản hồi — hồ sơ đang chờ đội ngũ eno.vn.')}
          </p>
        </div>
      </div>
    </a>
  )
}

/** One-shot appeal against the caller's active action. */
function AppealPanel({ action, onChanged }: { action: NonNullable<EnforcementInfo['action']>; onChanged?: () => void }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Outcome states first — an answered appeal never re-opens the form.
  if (action.appealOutcome === 'upheld') {
    return <p className="text-xs text-muted-foreground">{tr('Your appeal was reviewed and the decision stands. It lifts automatically as your record improves.', 'Khiếu nại của bạn đã được xem xét và quyết định được giữ nguyên. Hạn chế sẽ tự gỡ khi hồ sơ của bạn cải thiện.')}</p>
  }
  if (submitted || (action.appealedAt && !action.appealOutcome)) {
    return <p className="text-xs text-muted-foreground">{tr("Appeal submitted — a person will review it and reply here.", 'Đã gửi khiếu nại — sẽ có người xem xét và trả lời tại đây.')}</p>
  }

  const send = async () => {
    const t = text.trim()
    if (t.length < 5 || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/enforcement/appeal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      })
      if (res.ok || res.status === 409) { setSubmitted(true); onChanged?.() } // 409 = already appealed
      else if (res.status === 503) toast.error(tr("Couldn't send right now — please try again later.", 'Chưa gửi được — vui lòng thử lại sau.'))
      else toast.error(tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.'))
    } catch {
      toast.error(tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <Button
        variant="bare" size="none"
        onClick={() => setOpen(true)}
        className="whitespace-normal text-left text-xs font-semibold text-foreground underline-offset-2 hover:underline cursor-pointer"
      >
        {tr('This is a mistake? Appeal the decision.', 'Có nhầm lẫn? Gửi khiếu nại.')}
      </Button>
    )
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground">{tr('One appeal per decision — tell us what we got wrong.', 'Mỗi quyết định được khiếu nại một lần — hãy cho chúng tôi biết điều gì chưa đúng.')}</p>
      <Textarea
        size="compact"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={tr('Explain what happened…', 'Giải thích sự việc…')}
        className="mt-2 bg-card px-3 py-2 focus:ring-brand/20"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          variant="cta" size="none"
          onClick={send}
          disabled={busy || text.trim().length < 5}
          className="gap-1.5 px-4 py-1.5 text-xs disabled:opacity-40 cursor-pointer"
        >
          {busy && <Loader2 className="size-4 animate-spin" />} {tr('Submit appeal', 'Gửi khiếu nại')}
        </Button>
        <Button
          variant="ghost" size="none"
          onClick={() => setOpen(false)}
          className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-muted-foreground cursor-pointer"
        >
          {tr('Cancel', 'Hủy')}
        </Button>
      </div>
    </div>
  )
}

export function EnforcementBanner({ enforcement, onChanged }: { enforcement: EnforcementInfo; onChanged?: () => void }) {
  const { tr, lang } = useLanguage()
  const { state, action, openReports } = enforcement

  if (state === 'good_standing' && openReports.length === 0) return null

  // What happened + what it means — keyed by the action's reason slug, falling back
  // to state-level copy for free-form admin reasons. Calm and specific.
  const reason = action?.reason ?? ''
  const [what, means] =
    reason === 'conduct_warning' ? [
      tr('A report about your account was reviewed and confirmed.', 'Một báo cáo về tài khoản của bạn đã được xem xét và xác nhận.'),
      tr('Nothing is hidden — this is a note on your record, and it fades as you keep trading well.', 'Không có gì bị ẩn — đây là một ghi chú trên hồ sơ và sẽ mờ dần khi bạn tiếp tục giao dịch tốt.'),
    ] : reason === 'insurance_grace' ? [
      tr('We found an issue that would normally limit your account.', 'Chúng tôi phát hiện một vấn đề thường sẽ khiến tài khoản bị hạn chế.'),
      tr('Because of your long good record, nothing changes for 72 hours.', 'Vì bạn có quá trình bán hàng tốt, tài khoản chưa bị ảnh hưởng trong 72 giờ.'),
    ] : reason === 'conduct_restricted' || state === 'throttled' ? [
      tr('Confirmed reports have lowered your trust score.', 'Các báo cáo đã được xác nhận làm giảm điểm uy tín của bạn.'),
      tr('Your listings stay visible with a caution note while your score recovers.', 'Tin đăng của bạn vẫn hiển thị kèm một lưu ý thận trọng trong khi điểm phục hồi.'),
    ] : reason === 'scam_hold' ? [
      tr('Your listings are paused while we review a serious report.', 'Tin đăng của bạn tạm dừng trong khi chúng tôi xem xét một báo cáo nghiêm trọng.'),
      tr('They return automatically when the review clears — completed sales also work the hold off.', 'Tin sẽ tự hiển thị lại khi việc xem xét kết thúc ổn — các giao dịch hoàn tất cũng giúp gỡ tạm dừng.'),
    ] : reason === 'ban_evasion_review' ? [
      // Phase 3: held for a HUMAN identity review. Never accusatory — VN families
      // share numbers, so this is often a relative on the household SIM.
      tr('Your account needs a quick manual review.', 'Tài khoản của bạn cần được xem xét thủ công nhanh.'),
      tr('Posting is paused while a person double-checks your account details — this usually clears quickly. If it takes too long, appeal below.', 'Đăng tin tạm dừng trong khi nhân viên kiểm tra lại thông tin tài khoản — việc này thường hoàn tất nhanh. Nếu chờ quá lâu, hãy khiếu nại bên dưới.'),
    ] : state === 'suspended' ? [
      tr('Your account is suspended while we review it.', 'Tài khoản của bạn tạm ngưng trong khi chúng tôi xem xét.'),
      tr('Posting and messaging are paused — everything else stays exactly as you left it.', 'Đăng tin và nhắn tin tạm dừng — mọi thứ khác vẫn giữ nguyên như cũ.'),
    ] : state === 'held' ? [
      tr('Your listings are paused while we review your account.', 'Tin đăng của bạn tạm dừng trong khi chúng tôi xem xét tài khoản.'),
      tr('They return automatically when the review clears.', 'Tin sẽ tự hiển thị lại khi việc xem xét kết thúc ổn.'),
    ] : state === 'warned' ? [
      tr('There is a note on your account.', 'Có một lưu ý trên tài khoản của bạn.'),
      tr('Nothing is hidden or blocked — this is a heads-up.', 'Không có gì bị ẩn hay chặn — đây chỉ là một nhắc nhở.'),
    ] : [
      tr('A buyer reported a problem with one of your listings.', 'Một người mua đã báo cáo vấn đề với tin đăng của bạn.'),
      tr('A quick reply from you helps us resolve it fairly.', 'Bạn phản hồi sớm sẽ giúp chúng tôi giải quyết công bằng.'),
    ]

  const severe = state === 'held' || state === 'suspended'
  const expiry = action?.expiresAt ?? enforcement.until
  const Icon = severe ? ShieldAlert : AlertTriangle

  return (
    <section
      className={cn('mt-5 rounded-2xl p-4 sm:p-5', severe ? 'bg-destructive/10' : 'bg-warning/10')}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', severe ? 'text-destructive' : 'text-warning')} />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-bold text-foreground">{what}</h2>
          <p className="text-sm text-body">{means}</p>
          {action?.notice && <p className="text-sm text-body">“{action.notice}”</p>}
          {expiry && (
            <p className="text-xs text-muted-foreground">
              {tr('Lifts automatically on', 'Tự gỡ vào')} {new Date(expiry).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.
            </p>
          )}
        </div>
      </div>

      {/* ONE next action: an open report routes to its dispute case; otherwise appeal. */}
      {openReports.length > 0 && (
        <div className="mt-3 space-y-2 pl-8">
          {openReports.map((r) => <ReportAlert key={r.id} report={r} />)}
        </div>
      )}
      {action && (
        <div className={cn('pl-8', openReports.length > 0 ? 'mt-3' : 'mt-2')}>
          <AppealPanel action={action} onChanged={onChanged} />
        </div>
      )}
    </section>
  )
}
