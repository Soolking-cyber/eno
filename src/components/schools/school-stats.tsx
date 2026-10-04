'use client'

import { useLanguage } from '@/context/language-context'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { positivePct } from '@/lib/schools/logic'
import { useSchoolLive } from './school-live'
import { VoteControl } from './vote-control'
import { PCT_MIN_VOTES } from './school-bits'

/** The score block on a school page: ▲ n ▼ plus "% recommend · n votes", on LIVE eligible counts. */
export function SchoolScore({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const { tr, lang } = useLanguage()
  const live = useSchoolLive()
  const c = live.counts[schoolId] ?? { up: 0, down: 0 }
  const votes = c.up + c.down
  const pct = votes >= PCT_MIN_VOTES ? positivePct(c.up, c.down) : null
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-card p-3 ring-1 ring-border">
      <VoteControl schoolId={schoolId} schoolName={schoolName} size="lg" />
      <div>
        <p className={cn('text-2xl font-bold tabular-nums', pct === null ? 'text-muted-foreground' : pct >= 60 ? 'text-success' : pct >= 40 ? 'text-foreground' : 'text-destructive')}>
          {pct === null ? '—' : `${pct}%`}
        </p>
        <p className="text-sm text-muted-foreground">
          {votes === 0
            ? tr('No votes yet', 'Chưa có bình chọn')
            : pct === null
              ? (votes === 1 ? tr('1 vote so far', 'Mới có 1 phiếu') : tr('{n} votes so far', 'Mới có {n} phiếu').replace('{n}', formatInteger(votes, moneyLocale(lang))))
              : tr('recommend · {n} votes', 'đề xuất · {n} phiếu').replace('{n}', formatInteger(votes, moneyLocale(lang)))}
        </p>
      </div>
    </div>
  )
}
