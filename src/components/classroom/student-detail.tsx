'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, Check, ChevronRight, Pause, Play, ShieldAlert, Trash2, UserRound } from '@/components/ui/icons'
import type { SeatSettings } from '@/lib/classroom/seats'
import type { FocusItem } from '@/lib/classroom/focus'
import type { PlanFocus } from '@/lib/classroom/plans'
import { api } from './api'
import { refusalCopy, sessionDate } from './classroom-copy'
import { SeatSheet } from './seat-sheet'
import { InviteShare } from './invite-share'
import { PlanEditor } from './plan-editor'
import { PANEL_BUTTON, Panel } from './panel'

type Detail = {
  seat: { id: string; status: string; settings: SeatSettings; learner: { displayName: string; kind: string; band: string } | null; workingOn: FocusItem[] }
  nextPlan: { id: string; source: string; status: string; brief: string; focus: PlanFocus; openingLine: string; updatedAt: string } | null
  sessions: { id: string; startedAt: string; status: string; feedbackStatus: string; talkSeconds: number; turns: number; scores: { pronunciation?: number | null } | null; mistakes: number; unseen: boolean; flagged: boolean }[]
}

/** A page action: a 44px target that shares its row, its label wrapping (Vietnamese runs long) rather than spilling. */
const ACTION = 'min-h-11 min-w-0 whitespace-normal'

/**
 * ONE STUDENT, FOR THE TEACHER (Preply's lesson notes, plan "Steal these" #5): the practice settings, the "Working on" list,
 * the NEXT session — the AI's draft from the last report, which the teacher can rewrite or approve — and every report.
 */
export function StudentDetail({ seatId }: { seatId: string }) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  // Signed out (C3c review, Opus: it waited forever on a skeleton): say so, with the way in.
  if (!loading && !user) {
    return <EmptyState icon={UserRound} title={tr('Sign in to see your class', 'Đăng nhập để xem lớp của bạn')} className="mt-12"
      action={<Button variant="cta" className="min-h-11" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>} />
  }
  if (!user) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  /**
   * ⛔ ONE MOUNT PER ACCOUNT (C3c round 2, codex + Opus): keyed by the account, another account starts from nothing — not
   * one frame of the previous account's student, and none of its open sheets, confirmations or invite code.
   */
  return <StudentDetailFor key={user.id} seatId={seatId} />
}

function StudentDetailFor({ seatId }: { seatId: string }) {
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  /** The first load failed: the page has nothing to show. */
  const [error, setError] = useState<string | null>(null)
  /** An action (or a later reload) failed: the page stays, with this line under the buttons (C3b review, Opus). */
  const [actionError, setActionError] = useState<string | null>(null)
  const hasData = useRef(false)
  hasData.current = d !== null
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  /** Dropped on unmount: an answer arriving after this account's page is gone sets nothing (C3c review, codex + Opus). */
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const load = useCallback(() => api<Detail>(`/api/classroom/seats/${seatId}/detail`).then((r) => {
    if (!live.current) return
    if (r.ok) { setD(r.data); setError(null) } else if (hasData.current) { setActionError(r.error) } else { setError(r.error) }
  }), [seatId])
  useEffect(() => { void load() }, [load])

  if (error && !d) {
    return <EmptyState icon={UserRound} title={tr(refusalCopy(error).en, refusalCopy(error).vi)} className="mt-12"
      action={<Button variant="outline" className="min-h-11" onClick={() => { setError(null); void load() }}>{tr('Try again', 'Thử lại')}</Button>} />
  }
  if (!d) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  const { seat } = d
  const name = seat.learner?.displayName ?? seat.settings.seatName

  const patch = async (body: Record<string, unknown>) => {
    setActionError(null)
    const r = await api<{ seats: { id: string; invite: { code: string } | null }[] }>(`/api/classroom/seats/${seatId}`, { method: 'PATCH', body })
    if (!r.ok) return setActionError(r.error)
    if (body.reinvite) setInvite(r.data.seats.find((s) => s.id === seatId)?.invite?.code ?? null)
    void load()
  }
  const remove = async () => {
    setActionError(null)
    const r = await api(`/api/classroom/seats/${seatId}`, { method: 'DELETE' })
    if (r.ok) router.push('/classroom')
    else { setConfirmRemove(false); setActionError(r.error) }
  }

  const open = seat.workingOn.filter((i) => !i.fixed)
  const fixed = seat.workingOn.filter((i) => i.fixed)
  return (
    <article className="flex flex-col gap-8 pt-2">
      <div className="flex items-center gap-3">
        {/* 44px, its arrow on the column's edge (-ml-3): the way back is the top-left thumb stretch, so it is a full target. */}
        <Button variant="ghost" size="icon" className="-ml-3 size-11" aria-label={tr('Back', 'Quay lại')} asChild><Link href="/classroom" prefetch={false}><ArrowLeft aria-hidden className="size-5" /></Link></Button>
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="h-title truncate">{name}</h1>
          {/* Wraps rather than truncates: on a 320px phone the ellipsis cut "Under 18", the one fact that changes how to teach. */}
          <p className="text-xs text-ink-4">
            {seat.settings.level} · {seat.settings.sessionMinutes} {tr('min', 'phút')} · {seat.settings.sessionsPerWeek}× {tr('a week', 'mỗi tuần')}
            {seat.learner && seat.learner.band !== 'adult' ? ` · ${tr('Under 18', 'Dưới 18')}` : ''}
          </p>
        </div>
        {seat.status === 'paused' && <Badge variant="warning" size="sm">{tr('Paused', 'Tạm dừng')}</Badge>}
      </div>

      {/* Two thumb-size actions side by side, and "Remove" on its own quiet row under them — apart from the controls a
          teacher taps every week, but still above the line where any action's error appears (mobile first, 2026-10-26). */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className={ACTION} onClick={() => setEditing(true)}>{tr('Practice settings', 'Cài đặt luyện tập')}</Button>
          {seat.status === 'active' && <Button variant="outline" className={ACTION} onClick={() => patch({ status: 'paused' })}><Pause aria-hidden />{tr('Pause', 'Tạm dừng')}</Button>}
          {seat.status === 'paused' && <Button variant="outline" className={ACTION} onClick={() => patch({ status: 'active' })}><Play aria-hidden />{tr('Resume', 'Tiếp tục')}</Button>}
          {seat.status === 'invited' && <Button variant="outline" className={ACTION} onClick={() => patch({ reinvite: true })}>{tr('New invite link', 'Tạo link mời mới')}</Button>}
        </div>
        <Button variant="ghost" className="-ml-3 min-h-11 self-start text-destructive" onClick={() => setConfirmRemove(true)}><Trash2 aria-hidden />{tr('Remove', 'Xoá')}</Button>
      </div>
      {actionError && <p role="alert" className="-mt-4 text-sm text-destructive">{tr(refusalCopy(actionError).en, refusalCopy(actionError).vi)}</p>}

      {seat.status === 'invited' && !invite && (
        <p className="text-sm text-body">{tr('Waiting for the student (or their parent) to open the invite. Lost the link? Make a new one — the old one stops working.', 'Đang chờ học viên (hoặc phụ huynh) mở link mời. Mất link? Hãy tạo link mới — link cũ sẽ ngừng hoạt động.')}</p>
      )}
      {invite && <InviteShare seatId={seat.id} code={invite} seatName={seat.settings.seatName} />}

      {seat.status !== 'invited' && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{tr('Working on', 'Đang luyện')}</h2>
            {open.length === 0 && fixed.length === 0 ? (
              <p className="text-sm text-body">{tr('Recurring mistakes show up here after the first sessions.', 'Các lỗi lặp lại sẽ hiện ở đây sau vài buổi đầu.')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {open.map((i) => <li key={i.key}><Badge variant="warning" size="md">{i.label} ×{i.count}</Badge></li>)}
                {fixed.map((i) => <li key={i.key}><Badge variant="success" size="md"><Check aria-hidden className="size-3.5" />{i.label}</Badge></li>)}
              </ul>
            )}
          </section>

          <PlanEditor seatId={seat.id} plan={d.nextPlan} onSaved={load} />

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{tr('Sessions', 'Các buổi luyện')}</h2>
            {d.sessions.length === 0 ? (
              <p className="text-sm text-body">{tr('No sessions yet.', 'Chưa có buổi luyện nào.')}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {d.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/classroom/reports/${s.id}`} prefetch={false} className="press flex items-center gap-3 py-3 hover:bg-tint">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">{sessionDate(s.startedAt, lang)}</p>
                        <p className="text-xs text-ink-4">
                          {Math.round(s.talkSeconds / 60)} {tr('min talking', 'phút nói')} · {s.mistakes} {tr('fixes', 'lỗi sửa')}
                          {s.scores?.pronunciation != null ? ` · ${tr('pronunciation', 'phát âm')} ${s.scores.pronunciation}` : ''}
                          {s.status === 'live' ? ` · ${tr('practising now', 'đang luyện')}` : s.feedbackStatus === 'pending' ? ` · ${tr('report on its way', 'đang làm nhận xét')}` : ''}
                        </p>
                      </div>
                      {s.flagged && <ShieldAlert aria-label={tr('Needs care', 'Cần quan tâm')} className="size-4 text-warning" />}
                      {s.unseen && <Badge variant="brand" size="sm">{tr('New', 'Mới')}</Badge>}
                      <ChevronRight aria-hidden className="size-4 text-ink-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <SeatSheet open={editing} onOpenChange={setEditing} onSaved={() => void load()} seatId={seat.id} initial={seat.settings} />
      <Panel open={confirmRemove} onOpenChange={setConfirmRemove} title={tr('Remove this student?', 'Xoá học viên này?')}
        description={tr('They leave the class at once and you will no longer see their reports.', 'Học viên rời lớp ngay và bạn sẽ không xem được nhận xét nữa.')}
        footer={<>
          <Button variant="outline" size="lg" className={PANEL_BUTTON} onClick={() => setConfirmRemove(false)}>{tr('Cancel', 'Huỷ')}</Button>
          <Button variant="destructive" size="lg" className={PANEL_BUTTON} onClick={remove}>{tr('Remove', 'Xoá')}</Button>
        </>}>
        <span className="sr-only">{name}</span>
      </Panel>
    </article>
  )
}
