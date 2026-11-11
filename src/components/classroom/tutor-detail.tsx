'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, Check, Mic, Pencil, Trash2, UserRound } from '@/components/ui/icons'
import { voiceFor } from '@/lib/classroom/voices'
import { parseTraits } from '@/lib/classroom/persona'
import type { RosterSeat } from '@/lib/classroom/seats'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { SessionLauncher } from './session-launcher'
import { TutorFace } from './tutor-card'
import { PANEL_BUTTON, Panel } from './panel'
import { SwitchRow } from '@/components/ui/switch'

type Loaded = {
  teacher: { fullName: string; photoUrl: string | null; nationality: string; open: boolean }
  tutor: { id: string; name: string; bestFor: string; voice: string; ownVoice?: boolean; look: string; libraryAvatarId: string | null; customStatus: string; traits: unknown; students: number; backgroundUrl: string | null; backgroundThumbUrl: string | null }
}

/** A page action: a 44px target that shares its row, its label wrapping (Vietnamese runs long) rather than spilling. */
const ACTION = 'min-h-11 min-w-0 whitespace-normal'

/**
 * ONE TUTOR, FOR ITS TEACHER (owner, 2026-11-09: "teachers assign and manage ai tutor for each of their students"): the
 * tutor as students see it, Try it, Edit, and the students — each one can be given this tutor with one tap (a student has
 * one tutor; the next session meets the new one). Archive when no student has it any more.
 */
export function TutorDetail({ tutorId }: { tutorId: string }) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  if (!loading && !user) {
    return <EmptyState icon={UserRound} title={tr('Sign in to see your class', 'Đăng nhập để xem lớp của bạn')} className="mt-12"
      action={<Button variant="cta" className="min-h-11" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>} />
  }
  if (!user) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  // One mount per account: another account never sees one frame of this one's tutor or students.
  return <TutorDetailFor key={user.id} tutorId={tutorId} />
}

function TutorDetailFor({ tutorId }: { tutorId: string }) {
  const { tr } = useLanguage()
  const router = useRouter()
  const [d, setD] = useState<Loaded | null>(null)
  const [seats, setSeats] = useState<RosterSeat[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  /** The teacher's own voice (own-voice.ts): may they make one, and is it ready — the "Your voice" row below. */
  const [own, setOwn] = useState<{ open: boolean; status: string } | null>(null)
  const [ownSaving, setOwnSaving] = useState(false)

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      api<Loaded>(`/api/classroom/tutors/${encodeURIComponent(tutorId)}`),
      api<{ seats: RosterSeat[] }>('/api/classroom/seats'),
    ])
    if (!t.ok) { setError(t.error); return }
    setD(t.data)
    void api<{ voice: { status: string }; open: boolean }>('/api/classroom/own-voice').then((r) => { if (r.ok) setOwn({ open: r.data.open, status: r.data.voice.status }) })
    if (s.ok) setSeats(s.data.seats)
    else setActionError(s.error)
  }, [tutorId])
  useEffect(() => { void load() }, [load])

  if (error) return <EmptyState icon={UserRound} title={tr(refusalCopy(error).en, refusalCopy(error).vi)} className="mt-12" />
  if (!d) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />

  const { tutor, teacher } = d
  const voice = voiceFor(tutor.voice)
  const background = parseTraits(tutor.traits).background
  const mine = (seats ?? []).filter((s) => s.tutor.id === tutor.id)
  const others = (seats ?? []).filter((s) => s.tutor.id !== tutor.id)

  const give = async (seat: RosterSeat) => {
    setMoving(seat.id)
    setActionError(null)
    const r = await api<{ seats: RosterSeat[] }>(`/api/classroom/seats/${encodeURIComponent(seat.id)}`, { method: 'PATCH', body: { tutorId: tutor.id } })
    setMoving(null)
    if (!r.ok) return setActionError(r.error)
    setSeats(r.data.seats)
    setD((cur) => cur && { ...cur, tutor: { ...cur.tutor, students: r.data.seats.filter((s) => s.tutor.id === tutor.id).length } })
  }
  const setOwnVoice = async (on: boolean) => {
    setOwnSaving(true)
    setActionError(null)
    const r = await api<{ ownVoiceTutorIds: string[] }>('/api/classroom/own-voice/tutors', { body: { tutorIds: [tutor.id], on } })
    setOwnSaving(false)
    if (!r.ok) return setActionError(r.error)
    setD((cur) => cur && { ...cur, tutor: { ...cur.tutor, ownVoice: r.data.ownVoiceTutorIds.includes(tutor.id) } })
  }
  const archive = async () => {
    setArchiving(true)
    setActionError(null)
    const r = await api(`/api/classroom/tutors/${encodeURIComponent(tutor.id)}`, { method: 'DELETE' })
    setArchiving(false)
    setConfirmArchive(false)
    if (!r.ok) return setActionError(r.error)
    router.push('/classroom')
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Link href="/classroom" prefetch={false} className="press -ml-1 flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-ink-2">
        <ArrowLeft aria-hidden className="size-4" />{tr('Your class', 'Lớp của bạn')}
      </Link>

      <div className="flex flex-col items-center gap-3 text-center">
        <TutorFace tutor={{ name: tutor.name, look: tutor.look, libraryAvatarId: tutor.libraryAvatarId, background, backgroundThumbUrl: tutor.backgroundThumbUrl }} photoUrl={teacher.photoUrl} size="lg" className="max-w-44" />
        <div className="flex min-w-0 max-w-full flex-col items-center gap-1">
          <h1 className="h-title min-w-0 max-w-full truncate">{tutor.name}</h1>
          {tutor.bestFor && <p className="text-sm text-body">{tutor.bestFor}</p>}
          <p className="text-xs text-ink-4">
            {/* "· voice: Imogen" — a bare "Imogen" did not say it was the voice (gap 8). */}
            {tr('AI avatar', 'Avatar AI')}{tutor.ownVoice && own?.status === 'ready' ? ` · ${tr('your voice', 'giọng của bạn')}` : voice ? ` · ${tr('voice:', 'giọng')} ${voice.name}` : ''}
            {tutor.customStatus === 'requested' ? ` · ${tr('your 3D face is being made', 'đang tạo khuôn mặt 3D của bạn')}` : ''}
          </p>
        </div>
        <div className="flex w-full max-w-sm gap-2">
          {teacher.open && (
            <SessionLauncher test tutorId={tutor.id} preview={{ name: tutor.name, photoUrl: teacher.photoUrl, background, backgroundUrl: tutor.backgroundUrl }}
              variant="cta" className={`${ACTION} flex-1`} label={<><Mic aria-hidden />{tr('Try it', 'Thử ngay')}</>} />
          )}
          <Button variant="outline" className={`${ACTION} flex-1`} asChild>
            <Link href={`/classroom/tutors/${encodeURIComponent(tutor.id)}/edit`} prefetch={false}><Pencil aria-hidden />{tr('Edit', 'Chỉnh sửa')}</Link>
          </Button>
        </div>
      </div>

      {/* The teacher's own voice: switch it on for this tutor once it is ready, or go and make it (staff pilot first). */}
      {own?.status === 'ready' ? (
        <SwitchRow checked={!!tutor.ownVoice} disabled={ownSaving} onChange={(on) => void setOwnVoice(on)} label={tr('Speaks in your voice', 'Nói bằng giọng của bạn')}
          description={<span className="flex flex-col gap-1">
            {voice && <span>{tr('If your voice can’t be reached, it speaks as', 'Nếu không dùng được giọng của bạn, gia sư nói bằng giọng')} {voice.name}.</span>}
            <Link href="/classroom/voice" prefetch={false} className="press self-start font-semibold text-brand">{tr('Manage your voice', 'Quản lý giọng nói')}</Link>
          </span>} />
      ) : own?.open || (own && own.status !== 'none') ? (
        <Link href="/classroom/voice" prefetch={false} className="press flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-tint px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-ink">{tr('Use your own voice', 'Dùng giọng của chính bạn')}</span>
            <span className="text-xs text-ink-4">{own.status === 'making' || own.status === 'checking' ? tr('Being made…', 'Đang tạo…') : tr('Read a few sentences, about a minute', 'Đọc vài câu, khoảng một phút')}</span>
          </span>
          <Mic aria-hidden className="size-5 shrink-0 text-brand" />
        </Link>
      ) : null}

      <section aria-labelledby="tutor-students" className="flex flex-col gap-3">
        <h2 id="tutor-students" className="text-lg font-bold text-ink">{tr('Students', 'Học viên')}</h2>
        {seats === null ? <Skeleton className="h-24 w-full rounded-2xl" /> : seats.length === 0 ? (
          <p className="text-sm text-body">{tr('No students yet. Add one from your class page.', 'Chưa có học viên. Hãy thêm từ trang lớp của bạn.')}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {[...mine, ...others].map((s) => {
              const name = s.learner?.displayName ?? s.seatName
              const has = s.tutor.id === tutor.id
              return (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <Avatar name={name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink-4">{has ? tr('Has this tutor', 'Đang học với gia sư này') : `${tr('Tutor', 'Gia sư')}: ${s.tutor.name}`}</p>
                  </div>
                  {has
                    ? <Check aria-label={tr('Has this tutor', 'Đang học với gia sư này')} className="size-5 shrink-0 text-brand" />
                    : <Button variant="outline" className="min-h-11 shrink-0" loading={moving === s.id} disabled={moving !== null} onClick={() => void give(s)}>{tr('Give this tutor', 'Giao gia sư này')}</Button>}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-xs text-ink-4">{tr('A student has one tutor. Their next session meets the one you give them.', 'Mỗi học viên có một gia sư. Buổi tiếp theo sẽ học với gia sư bạn giao.')}</p>
      </section>

      {actionError && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(actionError).en, refusalCopy(actionError).vi)}</p>}

      <div className="border-t border-border pt-4">
        {tutor.students > 0
          ? <p className="text-xs text-ink-4">{tr('To archive this tutor, give its students another tutor first.', 'Để lưu trữ gia sư này, hãy giao gia sư khác cho học viên của nó trước.')}</p>
          : (
            <Button variant="ghost" className="-ml-3 min-h-11 text-destructive" onClick={() => setConfirmArchive(true)}>
              <Trash2 aria-hidden />{tr('Archive tutor', 'Lưu trữ gia sư')}
            </Button>
          )}
      </div>

      <Panel open={confirmArchive} onOpenChange={setConfirmArchive} title={tr('Archive this tutor?', 'Lưu trữ gia sư này?')}
        description={tr('It leaves your tutors. Past reports keep its name.', 'Gia sư sẽ rời danh sách của bạn. Các nhận xét cũ vẫn giữ tên.')}
        footer={<>
          <Button variant="outline" size="lg" className={PANEL_BUTTON} onClick={() => setConfirmArchive(false)}>{tr('Cancel', 'Huỷ')}</Button>
          <Button variant="destructive" size="lg" className={PANEL_BUTTON} loading={archiving} onClick={() => void archive()}>{tr('Archive', 'Lưu trữ')}</Button>
        </>}>
        <Badge variant="neutral" size="md">{tutor.name}</Badge>
      </Panel>
    </div>
  )
}
