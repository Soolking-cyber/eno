'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronRight, Plus, Sparkles, UserPlus } from '@/components/ui/icons'
import { refusalCopy } from './classroom-copy'
import type { ClassroomMe } from '@/lib/classroom/me'
import type { RosterSeat, SeatProgress } from '@/lib/classroom/seats'
import { LIMITS } from '@/lib/classroom/constants'
import { api } from './api'
import { SeatSheet } from './seat-sheet'
import { Avatar } from '@/components/ui/avatar'
import { TutorBadge, TutorFace } from './tutor-card'

type Teacher = NonNullable<ClassroomMe['teacher']>

/**
 * The teacher's side of /classroom (owner, 2026-11-09: "teachers assign and manage ai tutor for each of their students",
 * Praktika's look): their TUTORS in a row, then their STUDENTS — each with their tutor and where they stand this week
 * (On track · Behind · Not started · Inactive — Praktika's business view), one row per seat.
 */
export function TeacherHome({ teacher, onChanged, secondary }: {
  teacher: Teacher
  onChanged: () => void
  /** The page already has its <h1> (the learner's side, above): this title is an <h2>. */
  secondary?: boolean
}) {
  const { tr } = useLanguage()
  const [seats, setSeats] = useState<RosterSeat[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // ⛔ A failed load is NOT an empty class (C3b review, Opus): it used to show "Add a student" over a class that has some.
  const load = useCallback(() => {
    api<{ seats: RosterSeat[] }>('/api/classroom/seats').then((r) => {
      if (r.ok) { setSeats(r.data.seats); setFailed(null) } else setFailed(r.error)
    })
  }, [])
  const hasTutor = teacher.tutors.length > 0
  useEffect(() => { if (hasTutor) load() }, [hasTutor, load])

  return (
    <section aria-labelledby="teacher-class" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        {secondary
          ? <h2 id="teacher-class" className="h-title">{tr('Your class', 'Lớp của bạn')}</h2>
          : <h1 id="teacher-class" className="h-title">{tr('Your class', 'Lớp của bạn')}</h1>}
        {!teacher.open && <Badge variant="warning" size="md">{tr('Pilot', 'Thử nghiệm')}</Badge>}
      </div>
      {!teacher.open && (
        <p className="text-sm text-body">
          {tr(
            'eno Classroom is in a small pilot. You can make your tutors now — we’ll tell you when your class can start practising.',
            'eno Classroom đang thử nghiệm với số ít giáo viên. Bạn có thể tạo gia sư ngay — chúng tôi sẽ báo khi lớp của bạn bắt đầu luyện tập được.',
          )}
        </p>
      )}

      {hasTutor ? <TutorsRow teacher={teacher} /> : <CreateAvatar />}

      {hasTutor && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">{tr('Students', 'Học viên')}</h2>
            <Button variant="cta" className="min-h-11" onClick={() => setAdding(true)} disabled={!teacher.open}>
              <UserPlus aria-hidden />
              {tr('Add student', 'Thêm học viên')}
            </Button>
          </div>
          {failed && seats === null ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p role="alert" className="text-sm text-body">{tr(refusalCopy(failed).en, refusalCopy(failed).vi)}</p>
              <Button variant="outline" className="min-h-11" onClick={() => { setFailed(null); load() }}>{tr('Try again', 'Thử lại')}</Button>
            </div>
          ) : seats === null ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : seats.length === 0 ? (
            <p className="py-6 text-center text-sm text-body">
              {tr('Add a student to get an invite link for them (or their parent).', 'Thêm học viên để nhận link mời gửi cho họ (hoặc phụ huynh).')}
            </p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {/* A stable sort: within a status, the order the teacher added them. */}
              {[...seats].sort((a, b) => PROGRESS_ORDER[a.progress] - PROGRESS_ORDER[b.progress]).map((s) => <SeatRow key={s.id} seat={s} photoUrl={teacher.photoUrl} />)}
            </ul>
          )}
        </div>
      )}
      <SeatSheet open={adding} onOpenChange={setAdding} onSaved={() => { load(); onChanged() }} tutors={teacher.tutors} />
    </section>
  )
}

function CreateAvatar() {
  const { tr } = useLanguage()
  return (
    <div className="flex flex-col items-center gap-4 border-y border-border py-10 text-center">
      <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Sparkles className="size-8" />
      </span>
      <div>
        <h2 className="text-lg font-bold text-ink">{tr('Make your first AI tutor', 'Tạo gia sư AI đầu tiên')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-body">
          {tr(
            'Your students talk with it at home. You choose how it looks, sounds and teaches — and which student gets which tutor.',
            'Học viên trò chuyện với gia sư tại nhà. Bạn chọn diện mạo, giọng nói, cách dạy — và học viên nào học với gia sư nào.',
          )}
        </p>
      </div>
      <Button variant="cta" size="lg" className="min-h-12 w-full max-w-xs" asChild><Link href="/classroom/tutors/new" prefetch={false}>
        {tr('Get started', 'Bắt đầu')}
      </Link></Button>
    </div>
  )
}

/** The teacher's tutors, side by side (Praktika's tutor cards): the room and face, the name, who it suits, its students. */
function TutorsRow({ teacher }: { teacher: Teacher }) {
  const { tr } = useLanguage()
  const full = teacher.tutors.length >= LIMITS.tutorsPerTeacher
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-ink">{tr('Tutors', 'Gia sư')}</h2>
      {/* Scrolls sideways on a phone; the cards never squeeze. */}
      <ul className="flex snap-x gap-3 overflow-x-auto pb-1">
        {teacher.tutors.map((t) => (
          <li key={t.id} className="snap-start">
            <Link href={`/classroom/tutors/${encodeURIComponent(t.id)}`} prefetch={false} className="press flex w-28 flex-col gap-1.5">
              <TutorFace tutor={t} photoUrl={teacher.photoUrl} />
              <span className="truncate text-sm font-semibold text-ink">{t.name}</span>
              <span className="line-clamp-2 text-xs text-ink-4">{t.bestFor || (t.students === 1 ? tr('1 student', '1 học viên') : `${t.students} ${tr('students', 'học viên')}`)}</span>
            </Link>
          </li>
        ))}
        {!full && (
          <li className="snap-start">
            <Link href="/classroom/tutors/new" prefetch={false} className="press flex w-28 flex-col gap-1.5">
              <span className="flex aspect-[3/4] w-28 items-center justify-center rounded-2xl border border-dashed border-border text-ink-4 hover:bg-tint">
                <Plus aria-hidden className="size-6" />
              </span>
              <span className="text-sm font-semibold text-ink">{tr('New tutor', 'Gia sư mới')}</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
  )
}

const PROGRESS_LABEL: Record<SeatProgress, { en: string; vi: string }> = {
  on_track: { en: 'On track', vi: 'Đúng tiến độ' },
  behind: { en: 'Behind', vi: 'Chậm tiến độ' },
  not_started: { en: 'Not started', vi: 'Chưa bắt đầu' },
  inactive: { en: 'Inactive', vi: 'Không hoạt động' },
  paused: { en: 'Paused', vi: 'Tạm dừng' },
}
/** Each its own tone (gap 8: Behind and Inactive shared one tan pill) — Inactive, a student who has stopped, the strongest. */
const PROGRESS_TONE: Record<SeatProgress, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  on_track: 'success', behind: 'warning', not_started: 'neutral', inactive: 'destructive', paused: 'neutral',
}
/** The roster's order — who needs the teacher first (gap 8: "Behind first"); the class's own order within each. */
const PROGRESS_ORDER: Record<SeatProgress, number> = { behind: 0, inactive: 1, not_started: 2, on_track: 3, paused: 4 }

function SeatRow({ seat, photoUrl }: { seat: RosterSeat; photoUrl: string | null }) {
  const { tr } = useLanguage()
  const name = seat.learner?.displayName ?? seat.seatName
  // The week in minutes against its target (Praktika's "speaking minutes vs target"), after the tutor's name.
  const sub = seat.status === 'invited'
    ? tr('Invite sent — waiting to join', 'Đã gửi link mời — đang chờ tham gia')
    : `${seat.tutor.name} · ${seat.minutesThisWeek}/${seat.minutesTarget} ${tr('min this week', 'phút tuần này')}`
  return (
    <li>
      <Link href={`/classroom/students/${seat.id}`} prefetch={false} className="press flex items-center gap-3 py-3 hover:bg-tint">
        {/* The STUDENT, with their tutor at the corner (gap 8). */}
        <span className="relative shrink-0">
          {/* Initials a size down and the badge hung past the corner: at text-base the badge covered the second letter. */}
          <Avatar name={name} size="lg" className="text-sm" />
          <TutorBadge tutor={seat.tutor} photoUrl={photoUrl} className="absolute -bottom-1.5 -right-1.5" />
        </span>
        <div className="min-w-0 flex-1">
          {/* The name truncates on its own, the badge never: `truncate` on the flex row itself could not cut a long name. */}
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{name}</span>
            {seat.learner && seat.learner.band !== 'adult' && <Badge variant="neutral" size="sm" className="shrink-0">{tr('Under 18', 'Dưới 18')}</Badge>}
          </p>
          <Badge variant={PROGRESS_TONE[seat.progress]} size="sm" className="mt-0.5">{tr(PROGRESS_LABEL[seat.progress].en, PROGRESS_LABEL[seat.progress].vi)}</Badge>
          {/* The status FIRST: after a long seat name it was the part the ellipsis cut ("… evening group · Pa…"). */}
          <p className="truncate text-xs text-ink-4">{sub}{seat.seatName !== name ? ` · ${seat.seatName}` : ''}</p>
        </div>
        {/* Says what the number is (gap 8: a bare blue "1") — "1 new" in words, read as part of the row's link; a screen
            reader hears the whole: "2 new reports". (An aria-label on a plain span is not announced.) */}
        {seat.unseenReports > 0 && (
          <Badge variant="brand" size="sm" className="shrink-0">
            <span aria-hidden>{seat.unseenReports} {tr('new', 'mới')}</span>
            <span className="sr-only">{seat.unseenReports === 1 ? tr('1 new report', '1 nhận xét mới') : `${seat.unseenReports} ${tr('new reports', 'nhận xét mới')}`}</span>
          </Badge>
        )}
        <ChevronRight aria-hidden className="size-4 text-ink-4" />
      </Link>
    </li>
  )
}
