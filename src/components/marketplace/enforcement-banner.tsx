'use client'

import { useState } from 'react'
import { AlertTriangle, ShieldAlert, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

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
  openReports: { id: string; reason: string; detail: string | null; createdAt: string; listing: { id: string; title: string; image: string | null } | null }[]
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

/** One open report → inline reply form (buyer-king SLA: answer within 72h). */
function RespondForm({ report, onDone }: { report: EnforcementInfo['openReports'][number]; onDone: () => void }) {
  const { tr, lang } = useLanguage()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const send = async () => {
    const t = text.trim()
    if (t.length < 2 || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/enforcement/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, text: t }),
      })
      if (res.ok || res.status === 409) { setSent(true); onDone() } // 409 = already answered elsewhere — same outcome
      else if (res.status === 503) toast.error(tr("Couldn't send right now — please try again later.", 'Chưa gửi được — vui lòng thử lại sau.'))
      else toast.error(tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.'))
    } catch {
      toast.error(tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
        <Check className="h-4 w-4" /> {tr('Your reply was sent to our review team.', 'Phản hồi của bạn đã được gửi đến đội xem xét.')}
      </p>
    )
  }
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">
        {tr('A buyer reported', 'Một người mua đã báo cáo')} {reportReasonLabel(tr, report.reason)}
        {!report.listing && <span className="ml-1 font-normal">{tr('about your account', 'về tài khoản của bạn')}</span>}
        <span className="ml-1.5 font-normal text-muted-foreground">{new Date(report.createdAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short' })}</span>
      </p>
      {/* WHICH listing — thumbnail + title, linked. A report card without the product
          left sellers guessing ("its not what product"). */}
      {report.listing && (
        <a href={`/listings/${report.listing.id}`} className="mt-1.5 flex items-center gap-2.5 rounded-xl py-1 transition-colors hover:bg-muted">
          {report.listing.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={report.listing.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="h-10 w-10 shrink-0 rounded-lg bg-tint" />
          )}
          <span className="min-w-0 truncate text-sm font-semibold text-accent-foreground">{report.listing.title}</span>
        </a>
      )}
      {/* WHAT the buyer said — the complaint itself (never the reporter's identity). */}
      {report.detail && (
        <p className="mt-1.5 text-sm text-body">
          <span className="font-semibold text-muted-foreground">{tr('Buyer says:', 'Người mua nói:')}</span>{' '}
          <span className="italic">“{report.detail.slice(0, 300)}”</span>
        </p>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">{tr('Your side of the story goes straight to the reviewer.', 'Lời giải thích của bạn sẽ được gửi thẳng đến người xem xét.')}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder={tr('What happened, from your side…', 'Sự việc theo góc nhìn của bạn…')}
        className="mt-2 w-full resize-none rounded-xl bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          onClick={send}
          disabled={busy || text.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-40 cursor-pointer"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />} {tr('Send reply', 'Gửi phản hồi')}
        </button>
        <span className="text-[11px] text-muted-foreground">{tr('Replying within 72 hours keeps your standing.', 'Phản hồi trong 72 giờ giúp giữ uy tín của bạn.')}</span>
      </div>
    </div>
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
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-foreground underline-offset-2 hover:underline cursor-pointer">
        {tr('This is a mistake? Appeal the decision.', 'Có nhầm lẫn? Gửi khiếu nại.')}
      </button>
    )
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground">{tr('One appeal per decision — tell us what we got wrong.', 'Mỗi quyết định được khiếu nại một lần — hãy cho chúng tôi biết điều gì chưa đúng.')}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={tr('Explain what happened…', 'Giải thích sự việc…')}
        className="mt-2 w-full resize-none rounded-xl bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={send}
          disabled={busy || text.trim().length < 5}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-40 cursor-pointer"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />} {tr('Submit appeal', 'Gửi khiếu nại')}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer">{tr('Cancel', 'Hủy')}</button>
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

      {/* ONE next action: an unanswered report is the action; otherwise the appeal. */}
      {openReports.length > 0 && (
        <div className="mt-3 space-y-3 pl-8">
          {openReports.map((r) => <RespondForm key={r.id} report={r} onDone={() => onChanged?.()} />)}
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
