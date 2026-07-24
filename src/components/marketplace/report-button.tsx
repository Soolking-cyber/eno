'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Flag, Loader2, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import { RadioGroup, Radio, RadioDot } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
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
  // Distinguishes the reporter-ladder block from ordinary failures, so only that
  // message grows the Help link its own copy promises.
  const [blocked, setBlocked] = useState(false)

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
        setBlocked(code === 'reporting_blocked')
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
      {/* Borderless safety action (user 2026-07-08 — one-canvas philosophy): flush at rest
          (no border, no fill), red flag + label so it's the recognisable red sibling of the
          blue "Safe trading tips" link; colour fills in only on hover. font-semibold + red
          keep it findable without a box. text-destructive passes AA on the bg-destructive/10
          hover tint (it carries its own dark value — no dark: twin). */}
      <Button
        type="button"
        variant="bare"
        size="none"
        onClick={() => setOpen(true)}
        className={cn(
          'gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 tap-44 relative',
          className,
        )}
      >
        <Flag className="h-3.5 w-3.5" /> {t('Report', 'Báo cáo')}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="bg-popover rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
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
                <Button asChild variant="cta" size="none">
                  <Link
                    href={`/disputes/${caseId}`}
                    onClick={() => { setOpen(false); reset() }}
                    className="mt-4 w-full px-6 py-2.5 cursor-pointer"
                  >
                    {t('Add evidence & follow progress', 'Bổ sung bằng chứng & theo dõi')}
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="soft"
                size="none"
                onClick={() => { setOpen(false); reset() }}
                className="mt-2 w-full px-6 py-2 font-semibold text-muted-foreground transition-colors"
              >
                {t('Close', 'Đóng')}
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {/* A REAL radio group. These reasons are mutually exclusive and used to be
                  <Button>s with a hand-drawn circle: it LOOKED like a radio and reported
                  nothing — no group, no aria-checked, no "3 of 7", no arrow keys, and seven
                  separate tab stops. ui/radio-group is Base UI's, so the circle (RadioDot) is
                  now the RadioIndicator and the selected state lives in the accessibility tree
                  rather than only in paint. Visually identical — same classes, same circle. */}
              <RadioGroup
                value={reason}
                onValueChange={setReason}
                aria-label={t('Reason', 'Lý do')}
                // ⚠️ `flex flex-col gap-1.5`, NOT `space-y-1.5`. Base UI's Radio.Root renders the
                // <span role="radio"> AND a hidden <input> as SIBLINGS, so this group has 14 children,
                // not 7 — and the LAST one is a hidden input. Tailwind v4 compiles space-y-* to
                // `> :not(:last-child)`, so the 7th visible row stops being :last-child and picks up a
                // 6px margin it never had. A flex `gap` only applies between in-flow items, and the
                // hidden inputs are position:fixed — so it produces exactly the original 6 gaps and is
                // immune to the shift.
                className="flex flex-col gap-1.5"
              >
                {reasons.map((r) => (
                  <Radio
                    key={r.value}
                    value={r.value}
                    className={cn(
                      'flex w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl border px-3 py-2.5 text-left text-sm font-normal transition-colors',
                      reason === r.value ? 'border-brand font-semibold text-accent-foreground' : 'border-border text-foreground hover:bg-muted',
                    )}
                  >
                    <RadioDot />
                    {t(r.en, r.vi)}
                  </Radio>
                ))}
              </RadioGroup>

              <Textarea
                variant="filled"
                size="compact"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('Details (optional)', 'Chi tiết (không bắt buộc)')}
                className="px-3 py-2 focus:ring-brand/20"
              />

              {error && (
                <p role="alert" className="text-center text-xs font-semibold text-destructive">
                  {error}
                  {/* The blocked-reporter copy tells the user to "reach us through Help"
                      but shipped with no way to get there — a dead end in the one flow
                      where someone most needs support. Give the sentence its link. */}
                  {blocked && (
                    <>
                      {' '}
                      <Link href="/help" className="underline underline-offset-2">
                        {t('Open the Help center', 'Mở Trung tâm trợ giúp')}
                      </Link>
                    </>
                  )}
                </p>
              )}

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
