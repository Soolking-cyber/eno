'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronRight, Mic, Pencil, Sparkles, UserPlus } from '@/components/ui/icons'
import { refusalCopy } from './classroom-copy'
import type { ClassroomMe } from '@/lib/classroom/me'
import type { RosterSeat } from '@/lib/classroom/seats'
import { voiceFor } from '@/lib/classroom/voices'
import { api } from './api'
import { SeatSheet } from './seat-sheet'
import { SessionLauncher } from './session-launcher'

type Teacher = NonNullable<ClassroomMe['teacher']>

/** The teacher's side of /classroom: their avatar, and their class — one row per seat, newest report first. */
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
  useEffect(() => { if (teacher.avatar) load() }, [teacher.avatar, load])

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
            'eno Classroom is in a small pilot. You can set up your avatar now — we’ll tell you when your class can start practising.',
            'eno Classroom đang thử nghiệm với số ít giáo viên. Bạn có thể tạo avatar ngay — chúng tôi sẽ báo khi lớp của bạn bắt đầu luyện tập được.',
          )}
        </p>
      )}

      {teacher.avatar ? <AvatarCard teacher={teacher} /> : <CreateAvatar />}

      {teacher.avatar && (
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
              {seats.map((s) => <SeatRow key={s.id} seat={s} />)}
            </ul>
          )}
        </div>
      )}
      <SeatSheet open={adding} onOpenChange={setAdding} onSaved={() => { load(); onChanged() }} />
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
        <h2 className="text-lg font-bold text-ink">{tr('Create your AI avatar', 'Tạo avatar AI của bạn')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-body">
          {tr(
            'Your students talk with it at home. You choose how it looks, sounds and teaches.',
            'Học viên trò chuyện với avatar tại nhà. Bạn chọn diện mạo, giọng nói và cách dạy.',
          )}
        </p>
      </div>
      <Button variant="cta" size="lg" className="min-h-12 w-full max-w-xs" asChild><Link href="/classroom/avatar" prefetch={false}>
        {tr('Get started', 'Bắt đầu')}
      </Link></Button>
    </div>
  )
}

function AvatarCard({ teacher }: { teacher: Teacher }) {
  const { tr } = useLanguage()
  const avatar = teacher.avatar!
  const voice = voiceFor(avatar.voice)
  return (
    <div className="flex items-center gap-4 border-y border-border py-4">
      <Avatar name={avatar.name} url={teacher.photoUrl} size="xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-ink">{avatar.name}</p>
        <p className="text-xs text-ink-4">
          {tr('AI avatar', 'Avatar AI')}{voice ? ` · ${voice.name}` : ''}
          {avatar.customStatus === 'requested' ? ` · ${tr('your 3D face is being made', 'đang tạo khuôn mặt 3D của bạn')}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" asChild><Link href="/classroom/avatar" prefetch={false}>
            <Pencil aria-hidden />
            {tr('Edit', 'Chỉnh sửa')}
          </Link></Button>
          {teacher.open && (
            <SessionLauncher test preview={{ name: avatar.name, photoUrl: teacher.photoUrl }} className="min-h-11" label={<><Mic aria-hidden />{tr('Try it', 'Thử ngay')}</>} />
          )}
        </div>
      </div>
    </div>
  )
}

function SeatRow({ seat }: { seat: RosterSeat }) {
  const { tr } = useLanguage()
  const name = seat.learner?.displayName ?? seat.seatName
  const sub = seat.status === 'invited'
    ? tr('Invite sent — waiting to join', 'Đã gửi link mời — đang chờ tham gia')
    : seat.status === 'paused'
      ? tr('Paused', 'Tạm dừng')
      : `${seat.sessionsThisWeek}/${seat.settings.sessionsPerWeek} ${tr('this week', 'tuần này')}`
  return (
    <li>
      <Link href={`/classroom/students/${seat.id}`} prefetch={false} className="press flex items-center gap-3 py-3 hover:bg-tint">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1">
          {/* The name truncates on its own, the badge never: `truncate` on the flex row itself could not cut a long name. */}
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{name}</span>
            {seat.learner && seat.learner.band !== 'adult' && <Badge variant="neutral" size="sm" className="shrink-0">{tr('Under 18', 'Dưới 18')}</Badge>}
          </p>
          {/* The status FIRST: after a long seat name it was the part the ellipsis cut ("… evening group · Pa…"). */}
          <p className="truncate text-xs text-ink-4">{sub}{seat.seatName !== name ? ` · ${seat.seatName}` : ''}</p>
        </div>
        {seat.unseenReports > 0 && (
          <Badge variant="brand" size="sm" aria-label={tr('New report', 'Nhận xét mới')}>{seat.unseenReports}</Badge>
        )}
        <ChevronRight aria-hidden className="size-4 text-ink-4" />
      </Link>
    </li>
  )
}
