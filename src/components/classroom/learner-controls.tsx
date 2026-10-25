'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import type { ClassroomMe } from '@/lib/classroom/me'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { Panel } from './panel'

type Learner = ClassroomMe['learners'][number]
type Action = { kind: 'leave'; seatId: string; label: string } | { kind: 'withdraw' } | { kind: 'delete' }

/**
 * The account holder's controls over a learner (behind the parent gate): leave a class, stop practising (withdraw both
 * consents — every class), and for a child, delete the profile with everything in it. Each asks once more before it acts.
 * ⛔ These always work, whatever the classroom's mode — taking consent back is never switched off (the routes agree).
 */
export function LearnerControls({ open, onOpenChange, learner, onChanged }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  learner: Learner
  onChanged: () => void
}) {
  const { tr } = useLanguage()
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (a: Action) => {
    setBusy(true)
    setError(null)
    const r = a.kind === 'delete'
      ? await api(`/api/classroom/learners/${learner.id}`, { method: 'DELETE' })
      : await api(`/api/classroom/learners/${learner.id}`, { method: 'PATCH', body: a.kind === 'leave' ? { action: 'leave', seatId: a.seatId } : { action: 'withdraw' } })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setConfirm(null)
    onOpenChange(false)
    onChanged()
  }

  const what = (a: Action) => a.kind === 'leave'
    ? tr('Leave this class? The teacher will no longer see the reports.', 'Rời lớp này? Giáo viên sẽ không xem được nhận xét nữa.')
    : a.kind === 'withdraw'
      ? tr('Stop practising in every class? This withdraws your agreement; reports are deleted after 90 days.', 'Dừng luyện tập ở mọi lớp? Thao tác này rút lại sự đồng ý; nhận xét sẽ bị xoá sau 90 ngày.')
      : tr('Delete this child’s profile and everything in it — sessions, reports, plans — now? This cannot be undone.', 'Xoá hồ sơ của trẻ và mọi dữ liệu — buổi luyện, nhận xét, kế hoạch — ngay bây giờ? Không thể hoàn tác.')

  return (
    <Panel open={open} onOpenChange={(o) => { setConfirm(null); setError(null); onOpenChange(o) }}
      title={learner.kind === 'child' ? learner.displayName : tr('Your practice', 'Luyện tập của bạn')}>
      {confirm ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2">{what(confirm)}</p>
          {error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setConfirm(null)}>{tr('Cancel', 'Huỷ')}</Button>
            <Button variant="destructive" className="flex-1" loading={busy} onClick={() => run(confirm)}>{tr('Confirm', 'Xác nhận')}</Button>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {learner.seats.map((s) => (
            <li key={s.id} className="py-1">
              <Button variant="ghost" className="w-full justify-start" onClick={() => setConfirm({ kind: 'leave', seatId: s.id, label: s.teacherName })}>
                {tr('Leave the class of', 'Rời lớp của')} {s.teacherName}
              </Button>
            </li>
          ))}
          <li className="py-1">
            <Button variant="ghost" className="w-full justify-start" onClick={() => setConfirm({ kind: 'withdraw' })}>
              {tr('Stop practising and withdraw my agreement', 'Dừng luyện tập và rút lại sự đồng ý')}
            </Button>
          </li>
          {learner.kind === 'child' && (
            <li className="py-1">
              <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => setConfirm({ kind: 'delete' })}>
                {tr('Delete this child’s profile', 'Xoá hồ sơ của trẻ')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  )
}
