'use client'

import { UserPlus } from 'lucide-react'
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
}

/**
 * Muted single-line trust meta for the chat thread header, sitting under the
 * counterpart's name. Reuses the shared TrustScore chip. When `isNew`, shows a
 * neutral "New user" pill rather than a positive signal.
 */
export function TrustMeta({ trustScore, trustTier, memberSinceYear, responseBucket, isNew, lastSeenDay }: Props) {
  const { lang, tr } = useLanguage()
  void trustTier // tier is encoded by TrustScore's color; kept for caller symmetry
  // Thread data arrives via client fetch (never SSR HTML), so render-time bucketing
  // can't hydration-mismatch here — no mounted gate needed, unlike the ISR PDP.
  const lastSeen = lastSeenBucket(lastSeenDay)

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
        <span className="tabular-nums">{tr(`Joined ${memberSinceYear}`, `Tham gia ${memberSinceYear}`)}</span>
      )}

      {responseBucket.key && (
        <>
          <span aria-hidden>·</span>
          <span>{lang === 'vi' ? responseBucket.vi : responseBucket.en}</span>
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
