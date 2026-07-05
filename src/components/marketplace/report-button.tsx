'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Flag, Loader2, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = { listingId?: string; sellerId?: string; conversationId?: string; className?: string }

const REASONS: { value: string; vi: string; en: string }[] = [
  { value: 'scam', vi: 'Lừa đảo', en: 'Scam' },
  { value: 'counterfeit', vi: 'Hàng giả / nhái', en: 'Counterfeit / fake goods' },
  { value: 'sold', vi: 'Đã bán / hết hàng', en: 'Already sold / unavailable' },
  { value: 'wrong-info', vi: 'Thông tin sai (giá, ảnh…)', en: 'Wrong info (price, photos…)' },
  { value: 'duplicate', vi: 'Tin trùng lặp', en: 'Duplicate listing' },
  { value: 'offensive', vi: 'Nội dung phản cảm / quấy rối', en: 'Offensive / harassment' },
  { value: 'other', vi: 'Khác', en: 'Other' },
]
// A chat report is about the person/exchange, not a listing — only these reasons apply.
const CHAT_REASON_VALUES = new Set(['scam', 'offensive', 'other'])

export function ReportButton({ listingId, sellerId, conversationId, className }: Props) {
  const { tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)
  const { openSignIn } = useAuth()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!reason) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, sellerId, conversationId, reason, detail: detail.trim() || undefined }),
      })
      // Reporting requires an account — bounce anonymous users to sign-in.
      if (res.status === 401) { setOpen(false); openSignIn(); return }
      if (res.status === 429) { setError(t('Bạn đã báo cáo quá nhiều. Thử lại sau.', 'Too many reports — please try again later.')); return }
      if (!res.ok) {
        // Surface WHY instead of a generic failure — a self-report or non-participant
        // report otherwise just looks broken.
        const code = (await res.json().catch(() => null))?.error as string | undefined
        setError(
          code === 'cannot_report_self'
            ? t('Bạn không thể báo cáo nội dung của chính mình.', "You can't report your own listing or account.")
            : code === 'not_participant'
              ? t('Bạn chỉ có thể báo cáo cuộc trò chuyện của mình.', 'You can only report a conversation you are part of.')
              : code === 'reporting_blocked'
                // Calm, non-punitive copy (Phase 3 reporter ladder ≥3 strikes): states
                // the fact + the appeal path, never scolds.
                ? t('Tài khoản của bạn hiện không gửi được báo cáo, vì một số báo cáo trước đây được xác định là không chính xác. Nếu bạn cho rằng có nhầm lẫn, hãy liên hệ qua mục Trợ giúp.', 'Reporting is currently unavailable for your account after several earlier reports were reviewed and not upheld. If you think this is a mistake, reach us through Help.')
                : t('Không gửi được. Thử lại.', 'Could not send. Try again.'),
        )
        return
      }
      setDone(true)
    } catch {
      setError(t('Không gửi được. Thử lại.', 'Could not send. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setReason(''); setDetail(''); setDone(false); setError('') }

  const isChat = !!conversationId
  const title = isChat
    ? t('Báo cáo cuộc trò chuyện', 'Report this conversation')
    : sellerId && !listingId
      ? t('Báo cáo người bán', 'Report this seller')
      : t('Báo cáo tin đăng', 'Report this listing')
  const reasons = isChat ? REASONS.filter((r) => CHAT_REASON_VALUES.has(r.value)) : REASONS

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1 text-[11px] text-ink-4 hover:text-destructive transition-colors cursor-pointer tap-44 relative', className)}
      >
        <Flag className="h-3 w-3" /> {t('Báo cáo', 'Report')}
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="bg-card rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              {title}
            </DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="mt-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-accent-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">{t('Cảm ơn bạn', 'Thanks for the heads-up')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('Đội ngũ eno.vn sẽ xem xét báo cáo này.', 'The eno.vn team will review this report.')}</p>
              <Button variant="cta" size="none" onClick={() => { setOpen(false); reset() }} className="mt-4 rounded-xl px-6 py-2 text-sm transition-colors cursor-pointer">
                {t('Đóng', 'Close')}
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                {reasons.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors cursor-pointer',
                      reason === r.value ? 'border-brand font-semibold text-accent-foreground' : 'border-border text-foreground hover:bg-muted',
                    )}
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', reason === r.value ? 'border-brand' : 'border-line-strong')}>
                      {reason === r.value && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    {t(r.vi, r.en)}
                  </button>
                ))}
              </div>

              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('Chi tiết (không bắt buộc)', 'Details (optional)')}
                className="w-full resize-none rounded-xl bg-tint px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />

              {error && <p role="alert" className="text-center text-xs font-semibold text-destructive">{error}</p>}

              <Button
                variant="cta"
                size="none"
                onClick={submit}
                disabled={loading || !reason}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi báo cáo', 'Submit report')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
