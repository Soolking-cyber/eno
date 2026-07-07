'use client'

import { useState } from 'react'
import Link from 'next/link'
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
  const t = (en: string, vi: string) => tr(en, vi)
  const { openSignIn } = useAuth()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)
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
      if (res.status === 429) {
        // Two different 429s deserve different words: the hourly rate limit vs the
        // false-report cooldown (a prior report of yours was reviewed as inaccurate).
        const code = (await res.json().catch(() => null))?.error as string | undefined
        setError(code === 'report_cooldown'
          ? t('Reporting is paused on your account for now — a recent report was reviewed and found inaccurate. It re-opens automatically.', 'Tài khoản của bạn tạm dừng báo cáo — một báo cáo gần đây được xem xét là không chính xác. Sẽ tự mở lại.')
          : t('Too many reports — please try again later.', 'Bạn đã báo cáo quá nhiều. Thử lại sau.'))
        return
      }
      if (!res.ok) {
        // Surface WHY instead of a generic failure — a self-report or non-participant
        // report otherwise just looks broken.
        const code = (await res.json().catch(() => null))?.error as string | undefined
        setError(
          code === 'cannot_report_self'
            ? t("You can't report your own listing or account.", 'Bạn không thể báo cáo nội dung của chính mình.')
            : code === 'not_participant'
              ? t('You can only report a conversation you are part of.', 'Bạn chỉ có thể báo cáo cuộc trò chuyện của mình.')
              : code === 'reporting_blocked'
                // Calm, non-punitive copy (Phase 3 reporter ladder ≥3 strikes): states
                // the fact + the appeal path, never scolds.
                ? t('Reporting is currently unavailable for your account after several earlier reports were reviewed and not upheld. If you think this is a mistake, reach us through Help.', 'Tài khoản của bạn hiện không gửi được báo cáo, vì một số báo cáo trước đây được xác định là không chính xác. Nếu bạn cho rằng có nhầm lẫn, hãy liên hệ qua mục Trợ giúp.')
                : t('Could not send. Try again.', 'Không gửi được. Thử lại.'),
        )
        return
      }
      // The report opened (or re-surfaced) a dispute case — keep the id so the
      // success state can route the reporter into their case room.
      const d = (await res.json().catch(() => null)) as { id?: string } | null
      setCaseId(d?.id ?? null)
      setDone(true)
    } catch {
      setError(t('Could not send. Try again.', 'Không gửi được. Thử lại.'))
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setReason(''); setDetail(''); setDone(false); setCaseId(null); setError('') }

  const isChat = !!conversationId
  const title = isChat
    ? t('Report this conversation', 'Báo cáo cuộc trò chuyện')
    : sellerId && !listingId
      ? t('Report this seller', 'Báo cáo người bán')
      : t('Report this listing', 'Báo cáo tin đăng')
  const reasons = isChat ? REASONS.filter((r) => CHAT_REASON_VALUES.has(r.value)) : REASONS

  return (
    <>
      {/* Prominent-at-rest safety chip (user ask 2026-07-07): a soft red-tinted pill
          (fill + hairline + flag) so Report is findable at a glance EVERYWHERE without
          hover, yet calm — font-semibold + low-saturation tint keep it subordinate to
          the Contact/Buy CTAs (over-prominence invites frivolous reports). Reads as the
          red safety sibling of the blue "Safe trading tips" link. text-red-700/red-300
          (not the red-600 destructive token) is the AA-forced foreground on the tint:
          red-700 on red-50 = 5.9:1 light, red-300 on red-950 ≈ 9:1 dark (both pass AA). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/40 cursor-pointer tap-44 relative',
          className,
        )}
      >
        <Flag className="h-3.5 w-3.5" /> {t('Report', 'Báo cáo')}
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
              <p className="mt-3 text-sm font-semibold text-foreground">{t('Dispute case opened', 'Đã mở hồ sơ khiếu nại')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('You can add evidence and follow progress. The eno.vn team will review and decide.', 'Bạn có thể bổ sung bằng chứng và theo dõi tiến trình. Đội ngũ eno.vn sẽ xem xét và quyết định.')}
              </p>
              {caseId ? (
                <Link
                  href={`/disputes/${caseId}`}
                  onClick={() => { setOpen(false); reset() }}
                  className="mt-4 inline-block w-full rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark cursor-pointer"
                >
                  {t('Add evidence & follow progress', 'Bổ sung bằng chứng & theo dõi')}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => { setOpen(false); reset() }}
                className="mt-2 w-full rounded-xl px-6 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted cursor-pointer"
              >
                {t('Close', 'Đóng')}
              </button>
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
                    {t(r.en, r.vi)}
                  </button>
                ))}
              </div>

              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('Details (optional)', 'Chi tiết (không bắt buộc)')}
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
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Submit report', 'Gửi báo cáo')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
