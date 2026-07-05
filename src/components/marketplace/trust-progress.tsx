'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Mirrors the REAL v2 tier gates in src/lib/trust-math.ts tierFor (server-only, so
// the numbers are restated here — keep in sync):
//   Trusted     ≥85 ∧ ≥3 transactions (365d) ∧ (≥60d age ∨ ≥3 distinct-buyer reviews) ∧ clean 90d
//   Exceptional ≥110 ∧ ≥10 transactions ∧ ≥5 distinct-buyer reviews ∧ replies ≥85% (Wilson) ∧ clean 180d
// Tiers are volume-gated: the badge certifies a track record, not just a number.
const TIER_SCORE_TARGET: Record<string, number> = { restricted: 60, standard: 85, trusted: 110 }
const TRUSTED_TX = 3
const TRUSTED_AGE_DAYS = 60
const TRUSTED_ALT_REVIEWS = 3
const EXCEPTIONAL_TX = 10
const EXCEPTIONAL_REVIEWS = 5
const EXCEPTIONAL_WILSON = 0.85

export type TrustProgressData = {
  transactions365: number // completed transactions in the trailing year (sold + accepted offers)
  distinctBuyerReviews: number // distinct buyers with verified reviews
  responseWilson: number // Wilson lower bound (0..1) on replied-within-24h, last 90d
  accountAgeDays: number
  phoneVerified: boolean
  hasRecentConfirmedReport: boolean // a confirmed report inside the tier's clean window
  hasScamHold?: boolean // a confirmed scam not yet worked off (5 clean deals lift it)
}

type Row = {
  key: string
  label: string
  current: React.ReactNode
  pct: number // 0..1 fill of the progress bar
  met: boolean
  action: React.ReactNode // exactly ONE plain-language action per criterion
}

/**
 * "Your path to {next tier}" — the Etsy-Star-Seller-style transparency panel.
 * One borderless row per REAL v2 tier criterion (src/lib/trust-math.ts tierFor):
 * plain label, thin progress bar, current vs target, and one action sentence.
 * Never punitive — every gap comes with the single thing that closes it.
 */
export function TrustProgress({
  score,
  tier,
  staleCount,
  transactions365 = 0,
  distinctBuyerReviews = 0,
  responseWilson = 0,
  accountAgeDays = 0,
  phoneVerified = false,
  hasRecentConfirmedReport = false,
  hasScamHold = false,
}: Partial<TrustProgressData> & { score: number; tier: string; staleCount: number }) {
  const { tr } = useLanguage()

  // 'How trust works' now rides the trust BADGE itself (dashboard header) — no duplicate text link here.

  // Already at the top — a quiet maintain state, not another ladder.
  if (tier === 'exceptional') {
    return (
      <section className="mt-8 max-w-xl">
        <h2 className="h-section text-foreground">{tr('Exceptional — the highest tier', 'Xuất sắc — hạng cao nhất')}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {tr(
            'You keep it the same way you earned it: reply quickly, confirm your listings are available, and keep buyers happy.',
            'Bạn giữ hạng theo đúng cách đã đạt được: trả lời nhanh, xác nhận tin còn hàng và làm người mua hài lòng.',
          )}
        </p>
      </section>
    )
  }

  const towardExceptional = tier === 'trusted'
  const nextName =
    tier === 'restricted' ? tr('Building', 'Đang tích lũy')
    : tier === 'standard' ? tr('Trusted', 'Đáng tin cậy')
    : tr('Exceptional', 'Xuất sắc')
  const scoreTarget = TIER_SCORE_TARGET[tier] ?? 85

  // The single most useful next step for growing the SCORE (one action, not a menu).
  const scoreAction = !phoneVerified ? (
    tr('Verify your phone number — the quickest step.', 'Xác minh số điện thoại — bước nhanh nhất.')
  ) : staleCount > 0 ? (
    <>
      {tr('Confirm your listings are still available.', 'Xác nhận tin của bạn vẫn còn hàng.')}{' '}
      <Link href="/dashboard/availability" className="font-semibold text-accent-foreground hover:underline">
        {tr('Confirm now', 'Xác nhận ngay')}
      </Link>
    </>
  ) : (
    tr('Complete deals on eno and keep buyers happy — recent good work counts most.', 'Hoàn tất giao dịch trên eno và làm người mua hài lòng — thành tích gần đây được tính nhiều nhất.')
  )

  const rows: Row[] = [
    {
      key: 'score',
      label: tr('Trust score', 'Điểm uy tín'),
      current: `${score} / ${scoreTarget}`,
      pct: Math.min(score / scoreTarget, 1),
      met: score >= scoreTarget,
      action: scoreAction,
    },
  ]

  // Completed transactions — the volume gate (sold listings + accepted offers, last 365d).
  const txTarget = towardExceptional ? EXCEPTIONAL_TX : TRUSTED_TX
  rows.push({
    key: 'tx',
    label: tr('Completed deals (last 12 months)', 'Giao dịch hoàn tất (12 tháng qua)'),
    current: transactions365 >= txTarget ? tr('Done', 'Hoàn thành') : `${Math.min(transactions365, txTarget)} / ${txTarget}`,
    pct: Math.min(transactions365 / txTarget, 1),
    met: transactions365 >= txTarget,
    action: tr(
      'Mark listings as sold or accept offers in chat — real deals are the strongest signal.',
      'Đánh dấu tin đã bán hoặc chấp nhận đề nghị trong chat — giao dịch thật là tín hiệu mạnh nhất.',
    ),
  })

  if (towardExceptional) {
    // Exceptional: ≥5 distinct-buyer verified reviews.
    rows.push({
      key: 'reviews',
      label: tr('Reviews from different buyers', 'Đánh giá từ nhiều người mua khác nhau'),
      current:
        distinctBuyerReviews >= EXCEPTIONAL_REVIEWS
          ? tr('Done', 'Hoàn thành')
          : `${Math.min(distinctBuyerReviews, EXCEPTIONAL_REVIEWS)} / ${EXCEPTIONAL_REVIEWS}`,
      pct: Math.min(distinctBuyerReviews / EXCEPTIONAL_REVIEWS, 1),
      met: distinctBuyerReviews >= EXCEPTIONAL_REVIEWS,
      action: tr('Ask buyers to leave a review after the deal closes.', 'Nhờ người mua để lại đánh giá sau khi chốt giao dịch.'),
    })
    // Exceptional: replied-within-24h at ≥85% (Wilson lower bound — needs volume too).
    rows.push({
      key: 'response',
      label: tr('Fast replies (proven rate)', 'Trả lời nhanh (tỷ lệ đã chứng minh)'),
      current: `${Math.round(responseWilson * 100)}% / ${Math.round(EXCEPTIONAL_WILSON * 100)}%`,
      pct: Math.min(responseWilson / EXCEPTIONAL_WILSON, 1),
      met: responseWilson >= EXCEPTIONAL_WILSON,
      action: tr(
        'Reply to new buyers within 24 hours — a few perfect replies aren’t enough, keep it up over many chats.',
        'Trả lời người mua mới trong 24 giờ — vài lần chưa đủ, hãy duy trì qua nhiều cuộc trò chuyện.',
      ),
    })
  } else {
    // Trusted: ≥60d account age OR ≥3 distinct-buyer reviews (either satisfies the gate).
    const ageMet = accountAgeDays >= TRUSTED_AGE_DAYS
    const revMet = distinctBuyerReviews >= TRUSTED_ALT_REVIEWS
    rows.push({
      key: 'standing',
      label: tr('Time on eno — or buyer reviews', 'Thời gian trên eno — hoặc đánh giá từ người mua'),
      current:
        ageMet || revMet
          ? tr('Done', 'Hoàn thành')
          : `${Math.min(Math.floor(accountAgeDays), TRUSTED_AGE_DAYS)} / ${TRUSTED_AGE_DAYS} ${tr('days', 'ngày')}`,
      pct: Math.max(Math.min(accountAgeDays / TRUSTED_AGE_DAYS, 1), Math.min(distinctBuyerReviews / TRUSTED_ALT_REVIEWS, 1)),
      met: ageMet || revMet,
      action: tr(
        '60 days on eno — or 3 reviews from different verified buyers, whichever comes first.',
        '60 ngày trên eno — hoặc 3 đánh giá từ những người mua đã xác minh khác nhau, cái nào đến trước cũng được.',
      ),
    })
  }

  // The clean-window gate (90d to Trusted, 180d to Exceptional) — framed as recoverable.
  // Fair by design: one report from one buyer never blocks you alone (dual threshold);
  // this row appears met unless the record actually demotes.
  const cleanMet = !hasRecentConfirmedReport && !hasScamHold
  rows.push({
    key: 'clean',
    label: tr('A clean recent record', 'Hồ sơ gần đây tốt'),
    current: cleanMet ? tr('All good', 'Đang tốt') : tr('Recovering', 'Đang hồi phục'),
    pct: cleanMet ? 1 : 0.25,
    met: cleanMet,
    action: cleanMet
      ? tr('Keep sorting out buyer questions quickly.', 'Tiếp tục giải đáp nhanh thắc mắc của người mua.')
      : hasScamHold
        ? tr(
            'Complete 5 new clean deals — a confirmed scam only starts to fade after that, never by waiting.',
            'Hoàn tất 5 giao dịch sạch mới — lừa đảo đã xác nhận chỉ bắt đầu phai sau đó, không bao giờ tự hết theo thời gian.',
          )
        : towardExceptional
          ? tr(
              'Resolve any buyer concerns — recent reports stop counting after 180 days of clean trading.',
              'Giải quyết vướng mắc với người mua — báo cáo gần đây hết hiệu lực sau 180 ngày giao dịch sạch.',
            )
          : tr(
              'Resolve any buyer concerns — recent reports stop counting after 90 days of clean trading.',
              'Giải quyết vướng mắc với người mua — báo cáo gần đây hết hiệu lực sau 90 ngày giao dịch sạch.',
            ),
  })

  return (
    <section className="mt-8 max-w-xl">
      <h2 className="h-section text-foreground">
        {tr(`Your path to ${nextName}`, `Chặng đường tới hạng ${nextName}`)}
      </h2>
      <div className="mt-3 space-y-4">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{r.label}</span>
              <span className={cn('inline-flex items-center gap-1 text-xs', r.met ? 'font-semibold text-success' : 'text-muted-foreground')}>
                {r.met && <Check className="h-3 w-3" aria-hidden />}
                {r.current}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-tint">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(r.pct * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{r.action}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
