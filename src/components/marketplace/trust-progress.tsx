'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Mirrors the REAL tier gates in src/lib/trust.ts (server-only, so the numbers are
// restated here — keep in sync): <60 Restricted · 60–84 Building · ≥85 + track
// record Good standing (trusted) · ≥110 + track record + clean 90 days Exceptional.
// Track record = 5 positive interactions OR a 30-day-old account.
const TIER_SCORE_TARGET: Record<string, number> = { restricted: 60, standard: 85, trusted: 110 }
const TRACK_RECORD_INTERACTIONS = 5
const TRACK_RECORD_DAYS = 30

export type TrustProgressData = {
  positiveInteractions: number
  accountAgeDays: number
  hasRecentConfirmedReport: boolean
  phoneVerified: boolean
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
 * One borderless row per REAL tier criterion (from src/lib/trust.ts): plain label,
 * thin progress bar, current vs target, and one action sentence. Never punitive —
 * every gap comes with the single thing that closes it.
 */
export function TrustProgress({
  score,
  tier,
  staleCount,
  positiveInteractions,
  accountAgeDays,
  hasRecentConfirmedReport,
  phoneVerified,
}: TrustProgressData & { score: number; tier: string; staleCount: number }) {
  const { tr } = useLanguage()

  const trustLink = (
    <p className="mt-3 text-xs text-muted-foreground">
      <Link href="/trust" className="font-semibold text-accent-foreground hover:underline">
        {tr('How trust works on eno', 'Cách điểm uy tín hoạt động trên eno')}
      </Link>
    </p>
  )

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
        {trustLink}
      </section>
    )
  }

  const nextName =
    tier === 'restricted' ? tr('Building', 'Đang xây dựng')
    : tier === 'standard' ? tr('Good standing', 'Uy tín tốt')
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
    tr('Reply quickly and complete deals on eno — every good interaction adds up.', 'Trả lời nhanh và hoàn tất giao dịch trên eno — mỗi tương tác tốt đều cộng điểm.')
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

  // Track record gates the Good-standing badge (already satisfied once Trusted).
  if (tier === 'restricted' || tier === 'standard') {
    const met = positiveInteractions >= TRACK_RECORD_INTERACTIONS || accountAgeDays >= TRACK_RECORD_DAYS
    rows.push({
      key: 'track',
      label: tr('Positive interactions', 'Tương tác tích cực'),
      current: met
        ? tr('Done', 'Hoàn thành')
        : `${Math.min(positiveInteractions, TRACK_RECORD_INTERACTIONS)} / ${TRACK_RECORD_INTERACTIONS}`,
      pct: met ? 1 : Math.max(positiveInteractions / TRACK_RECORD_INTERACTIONS, accountAgeDays / TRACK_RECORD_DAYS),
      met,
      action: tr('Reply to first messages within 24h.', 'Trả lời tin nhắn đầu tiên trong 24h.'),
    })
  }

  // Exceptional additionally needs a clean recent record — framed as recoverable.
  if (tier === 'trusted') {
    const met = !hasRecentConfirmedReport
    rows.push({
      key: 'clean',
      label: tr('A clean recent record', 'Hồ sơ gần đây tốt'),
      current: met ? tr('All good', 'Đang tốt') : tr('Recovering', 'Đang hồi phục'),
      pct: met ? 1 : 0.25,
      met,
      action: met
        ? tr('Keep sorting out buyer questions quickly.', 'Tiếp tục giải đáp nhanh thắc mắc của người mua.')
        : tr('Resolve any buyer concerns — this clears on its own after 90 days.', 'Giải quyết vướng mắc với người mua — mục này tự xóa sau 90 ngày.'),
    })
  }

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
      {trustLink}
    </section>
  )
}
