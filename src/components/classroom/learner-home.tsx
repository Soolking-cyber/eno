'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChevronRight, Cog, Mic } from '@/components/ui/icons'
import type { ClassroomMe } from '@/lib/classroom/me'
import { cn } from '@/lib/utils'
import { SessionLauncher } from './session-launcher'
import { ParentGate } from './parent-gate'
import { LearnerControls } from './learner-controls'
import { sessionDate } from './classroom-copy'

type Learner = ClassroomMe['learners'][number]
type Seat = Learner['seats'][number]

/**
 * A learner's side of /classroom (Praktika's home, plan "Steal these" #2): who is practising (a switcher when one phone
 * holds a parent and their children), ONE "Today's practice" card per class, 7 dots for the week, and the reports.
 * The parent's controls sit behind the parent gate.
 */
export function LearnerHome({ me, onChanged }: { me: ClassroomMe; onChanged: () => void }) {
  const { tr } = useLanguage()
  /**
   * ⛔ EVERY LEARNER THE ACCOUNT OWNS, WITH A CLASS OR WITHOUT (C3a review, codex): a child who left their last class used
   * to vanish from here — and with them the only way to the parent's controls, "delete this child's profile" included.
   * A learner in no class shows that, and keeps Manage.
   */
  const learners = me.learners
  const [who, setWho] = useState(learners.find((l) => l.seats.length > 0)?.id ?? learners[0]?.id ?? '')
  const [gate, setGate] = useState(false)
  const [manage, setManage] = useState(false)
  const learner = learners.find((l) => l.id === who) ?? learners[0]
  if (!learner) return null

  return (
    <section aria-labelledby="practice-title" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 id="practice-title" className="h-title">
          {learner.kind === 'child' ? learner.displayName : tr('Your practice', 'Luyện tập của bạn')}
        </h1>
        {/* -mr-3: the 44px button's padding hangs into the gutter, so its label still ends on the column's edge. */}
        <Button variant="ghost" className="-mr-3 min-h-11" onClick={() => setGate(true)}>
          <Cog aria-hidden />
          {tr('Manage', 'Quản lý')}
        </Button>
      </div>
      {learners.length > 1 && (
        <ToggleGroup<string> aria-label={tr('Who is practising?', 'Ai đang luyện tập?')} value={[learner.id]} onValueChange={(v) => v[0] && setWho(v[0])}>
          {learners.map((l) => (
            <ToggleGroupItem key={l.id} value={l.id}>{l.kind === 'self' ? tr('Me', 'Tôi') : l.displayName}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {learner.seats.map((seat) => <TodayCard key={seat.id} seat={seat} />)}
      {learner.seats.length === 0 && (
        <div className="flex flex-col gap-1 rounded-2xl bg-tint px-5 py-6 text-center">
          <p className="text-base font-semibold text-ink">{tr('Not in a class right now', 'Hiện chưa ở lớp nào')}</p>
          <p className="text-sm text-body">{tr('To practise again, ask the teacher for a new invite link.', 'Để luyện tập lại, hãy xin giáo viên một link mời mới.')}</p>
        </div>
      )}
      <ParentGate open={gate} onOpenChange={setGate} onPass={() => { setGate(false); setManage(true) }} />
      <LearnerControls open={manage} onOpenChange={setManage} learner={learner} onChanged={onChanged} />
    </section>
  )
}

function TodayCard({ seat }: { seat: Seat }) {
  const { tr, lang } = useLanguage()
  const weekDone = seat.sessionsThisWeek >= seat.sessionsPerWeek
  const blocked = !seat.open ? tr('Practice opens soon.', 'Sắp mở luyện tập.')
    : seat.status === 'paused' ? tr('Your teacher has paused practice.', 'Giáo viên đã tạm dừng luyện tập.')
      : seat.liveSessionId ? null
        : weekDone ? tr('All done for this week — great work!', 'Đã xong tuần này — giỏi lắm!')
          : seat.practisedToday ? tr('Done for today. See you tomorrow!', 'Hôm nay xong rồi. Hẹn gặp ngày mai!')
            : null
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-brand-deeper px-6 py-8 text-center text-primary-foreground">
        <Avatar name={seat.avatarName} url={seat.teacherPhotoUrl} size="2xl" />
        <div>
          <p className="text-lg font-bold">{seat.avatarName}</p>
          <p className="text-xs text-primary-foreground/70">{tr('AI avatar of', 'Avatar AI của')} {seat.teacherName}</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-primary-foreground/80">{tr("Today's practice", 'Bài luyện hôm nay')} · {seat.minutes} {tr('min', 'phút')}</p>
          {seat.nextTopic && <p className="max-w-xs text-base font-semibold">{seat.nextTopic}</p>}
        </div>
        {blocked ? (
          <p className="text-sm text-primary-foreground/90">{blocked}</p>
        ) : (
          <SessionLauncher
            seatId={seat.id}
            preview={{ name: seat.avatarName, photoUrl: seat.teacherPhotoUrl }}
            variant="cta"
            size="lg"
            className="min-h-12 w-full max-w-xs"
            label={<><Mic aria-hidden />{seat.liveSessionId ? tr('Continue', 'Tiếp tục') : tr('Start practice', 'Bắt đầu luyện')}</>}
          />
        )}
        <WeekDots done={seat.sessionsThisWeek} of={seat.sessionsPerWeek} />
      </div>
      {seat.reports.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-ink">{tr('Reports', 'Nhận xét')}</h2>
          <ul className="divide-y divide-border border-y border-border">
            {seat.reports.map((r) => (
              <li key={r.id}>
                <Link href={`/classroom/reports/${r.id}`} prefetch={false} className="press flex items-center gap-3 py-3 hover:bg-tint">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{sessionDate(r.startedAt, lang)}</p>
                    <p className="truncate text-xs text-ink-4">{r.feedbackStatus === 'ready' ? r.summary || tr('No speaking this time', 'Lần này chưa nói') : tr('Report on its way…', 'Đang chuẩn bị nhận xét…')}</p>
                  </div>
                  {r.unseen && <Badge variant="brand" size="sm">{tr('New', 'Mới')}</Badge>}
                  <ChevronRight aria-hidden className="size-4 text-ink-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

/** The week at a glance: one dot per session the teacher set, filled for each one done (Mon–Sun, ICT). */
function WeekDots({ done, of }: { done: number; of: number }) {
  const { tr } = useLanguage()
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${done}/${of} ${tr('sessions this week', 'buổi tuần này')}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} aria-hidden className={cn('size-2.5 rounded-full', i < done ? 'bg-primary-foreground' : 'bg-primary-foreground/25')} />
      ))}
    </div>
  )
}
