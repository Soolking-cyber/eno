'use client'

import { useLanguage } from '@/context/language-context'
import { CalendarCheck } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

/**
 * THE WEEK, SAID IN WORDS (Praktika comparison 2026-11-11, gap 4): "2/5 this week" over one segment per session the teacher
 * set, and "3 weeks in a row" once there is a run worth naming (limits.ts weeksInARow). It replaced seven unlabelled dots
 * the judges read as a carousel's. On a dark card (the learner home's tutor card, the report's celebration).
 * The text carries it for a screen reader; the segments are decoration. A target lowered mid-week never reads "4/2".
 */
export function WeekLine({ done, of, streak, className }: { done: number; of: number; streak: number; className?: string }) {
  const { tr } = useLanguage()
  const shown = Math.min(done, of)
  return (
    <div className={cn('flex w-full max-w-xs flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold tabular-nums">
          {shown}/{of} <span className="font-normal text-primary-foreground/80">{tr('this week', 'tuần này')}</span>
        </span>
        {streak >= 2 && (
          <span className="flex items-center gap-1.5 font-semibold">
            <CalendarCheck aria-hidden className="size-4" />
            {streak} {tr('weeks in a row', 'tuần liên tiếp')}
          </span>
        )}
      </div>
      <div aria-hidden className="flex gap-1">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < shown ? 'bg-primary-foreground' : 'bg-primary-foreground/25')} />
        ))}
      </div>
    </div>
  )
}
