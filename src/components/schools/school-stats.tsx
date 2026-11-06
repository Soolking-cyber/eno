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
    // ▲ n ▼ in a row beside the words, not stacked in a ringed box: the box stood taller than the school's name and left a dead
    // band under the title on desktop. Below the floor the first line asks what the arrows answer, where a 24px dash read
    // as a loading bar (2026-11-06 audit).
    <div className="flex items-center gap-4">
      <VoteControl schoolId={schoolId} schoolName={schoolName} size="lg" layout="row" />
      <div>
        {pct === null ? (
          <p className="text-sm font-semibold text-foreground">{tr('Recommend working here?', 'Có nên làm việc ở đây?')}</p>
        ) : (
          <p className={cn('text-2xl font-bold tabular-nums', pct >= 60 ? 'text-success' : pct >= 40 ? 'text-foreground' : 'text-destructive')}>{pct}%</p>
        )}
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
