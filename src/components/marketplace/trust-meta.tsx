'use client'

import { UserPlus } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { TrustScore } from '@/components/marketplace/trust-score'
import type { ResponseBucket } from '@/lib/seller-metrics'

type Props = {
  trustScore: number
  trustTier: string
  memberSinceYear: number
  responseBucket: ResponseBucket
  /** Account <30 days with no track record — show a neutral "New user" chip
   *  instead of a positive trust badge (asymmetric honesty). */
  isNew: boolean
}

/**
 * Muted single-line trust meta for the chat thread header, sitting under the
 * counterpart's name. Reuses the shared TrustScore chip. When `isNew`, shows a
 * neutral "New user" pill rather than a positive signal.
 */
export function TrustMeta({ trustScore, trustTier, memberSinceYear, responseBucket, isNew }: Props) {
  const { lang, tr } = useLanguage()
  void trustTier // tier is encoded by TrustScore's color; kept for caller symmetry

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-none text-muted-foreground">
      {isNew ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-semibold text-body">
          <UserPlus className="h-3 w-3" aria-hidden />
          {tr('New user', 'Người dùng mới')}
        </span>
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
    </div>
  )
}
