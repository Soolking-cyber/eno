'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import { UserPlus } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { TrustScore } from '@/components/marketplace/trust-score'
import { lastSeenBucket } from '@/lib/last-seen'
import type { ResponseBucket } from '@/lib/seller-metrics'

type Props = {
  trustScore: number
  trustTier: string
  memberSinceYear: number
  responseBucket: ResponseBucket
  /** Account <30 days with no track record — show a neutral "New user" chip
   *  instead of a positive trust badge (asymmetric honesty). */
  isNew: boolean
  /** Counterpart presence, DAY-coarse ('YYYY-MM-DD') — bucketed at render like the
   *  PDP/storefront presence (owner 2026-07-23: bidirectional in threads). */
  lastSeenDay?: string | null
  /**
   * ONE LINE, NEVER A WRAP — the chat thread header's subtitle (inbox-01, 2026-10-04), and ONLY there. The
   * default (false) is the original wrapping meta, unchanged for every other surface that renders this.
   * In single-line mode: the chip, the badge, the year and the `·` separators never shrink; the TEXT spans
   * give, with an ellipsis (a bare overflow clip cut "Hoạt động hôm nay" mid-word at 360 in vi); the join
   * year steps out below sm (the least decision-relevant of the three); and `p-1 -m-1` keeps room INSIDE the
   * clip box for the trust chip's focus ring (2px outline + 2px offset).
   */
  singleLine?: boolean
}

/**
 * Muted single-line trust meta for the chat thread header, sitting under the
 * counterpart's name. Reuses the shared TrustScore chip. When `isNew`, shows a
 * neutral "New user" pill rather than a positive signal.
 */
export function TrustMeta({ trustScore, trustTier, memberSinceYear, responseBucket, isNew, lastSeenDay, singleLine = false }: Props) {
  const { tr } = useLanguage()
  void trustTier // tier is encoded by TrustScore's color; kept for caller symmetry
  // Thread data arrives via client fetch (never SSR HTML), so render-time bucketing
  // can't hydration-mismatch here — no mounted gate needed, unlike the ISR PDP.
  const lastSeen = lastSeenBucket(lastSeenDay)

  if (!singleLine) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs leading-none text-muted-foreground">
        {isNew ? (
          <Badge variant="neutral" size="sm" className="bg-muted px-1.5 font-semibold leading-none text-body">
            <UserPlus className="h-3 w-3" aria-hidden />
            {tr('New user', 'Người dùng mới')}
          </Badge>
        ) : (
          <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" />
        )}

        {memberSinceYear > 0 && (
          <span className="tabular-nums">{fillTemplate(tr('Joined {memberSinceYear}', 'Tham gia {memberSinceYear}'), 'Joined {memberSinceYear}', { memberSinceYear: String(memberSinceYear) })}</span>
        )}

        {responseBucket.key && (
          <>
            <span aria-hidden>·</span>
            <span>{tr(responseBucket.en, responseBucket.vi)}</span>
          </>
        )}

        {lastSeen.key && (
          <>
            <span aria-hidden>·</span>
            <span>{tr(lastSeen.en, lastSeen.vi)}</span>
          </>
        )}
      </div>
    )
  }

  // Single-line (the thread header) — see `singleLine`.
  return (
    <div data-trust-meta-line="" className="-m-1 flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden whitespace-nowrap p-1 text-2xs leading-none text-muted-foreground">
      {isNew ? (
        <Badge variant="neutral" size="sm" className="shrink-0 bg-muted px-1.5 font-semibold leading-none text-body">
          <UserPlus className="h-3 w-3" aria-hidden />
          {tr('New user', 'Người dùng mới')}
        </Badge>
      ) : (
        // A wrapper because TrustScore's className lands on the badge INSIDE its link — the flex item is this.
        <span className="inline-flex shrink-0">
          <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" />
        </span>
      )}

      {memberSinceYear > 0 && (
        <span className="shrink-0 tabular-nums max-sm:hidden">{fillTemplate(tr('Joined {memberSinceYear}', 'Tham gia {memberSinceYear}'), 'Joined {memberSinceYear}', { memberSinceYear: String(memberSinceYear) })}</span>
      )}

      {responseBucket.key && (
        <>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">{tr(responseBucket.en, responseBucket.vi)}</span>
        </>
      )}

      {lastSeen.key && (
        <>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">{tr(lastSeen.en, lastSeen.vi)}</span>
        </>
      )}
    </div>
  )
}
