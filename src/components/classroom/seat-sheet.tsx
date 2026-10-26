'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LEVELS, LIMITS, SESSION_MINUTES, STRICTNESS, type Level, type SessionMinutes, type Strictness } from '@/lib/classroom/constants'
import type { SeatSettings } from '@/lib/classroom/seats'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { PANEL_BUTTON, Panel } from './panel'
import { InviteShare } from './invite-share'

const STRICT_LABEL: Record<Strictness, { en: string; vi: string }> = {
  soft: { en: 'Gentle', vi: 'Nhẹ nhàng' },
  balanced: { en: 'Balanced', vi: 'Cân bằng' },
  strict: { en: 'Strict', vi: 'Nghiêm khắc' },
}
const DEFAULTS: SeatSettings = { seatName: '', level: 'A2', sessionMinutes: 10, sessionsPerWeek: 3, strictness: 'balanced', focusNote: '' }

/**
 * Add a student (or change a seat's settings): who it is for, the level, how long and how often they practise, and how
 * hard the avatar corrects them. A new seat ends on its invite — the link, a QR code, the share sheet (Zalo, Messenger).
 * On a phone it is a bottom sheet: the chips are the full 36px size (each with its 44px hit area) and the one action sits
 * in the pinned footer, under the thumb.
 */
export function SeatSheet({ open, onOpenChange, onSaved, seatId, initial }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /** Editing an existing seat; absent = a new one. */
  seatId?: string
  initial?: SeatSettings
}) {
  const { tr } = useLanguage()
  const [v, setV] = useState<SeatSettings>(initial ?? DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ seatId: string; code: string } | null>(null)
  useEffect(() => { if (open) { setV(initial ?? DEFAULTS); setError(null); setInvite(null) } }, [open, initial])

  const save = async () => {
    setBusy(true)
    setError(null)
    type Saved = { id?: string; seats: { id: string; invite: { code: string } | null }[] }
    const r = await api<Saved>(seatId ? `/api/classroom/seats/${seatId}` : '/api/classroom/seats', { method: seatId ? 'PATCH' : 'POST', body: v })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onSaved()
    if (seatId) return onOpenChange(false)
    const id = r.data.id
    const code = id ? r.data.seats.find((s) => s.id === id)?.invite?.code : undefined
    // The seat EXISTS now: with no invite in the answer, close rather than leave a filled form whose second tap makes a
    // second seat (C3b review, Opus) — the student's page makes a new link.
    if (!id || !code) return onOpenChange(false)
    setInvite({ seatId: id, code })
  }

  if (invite) {
    return (
      <Panel open={open} onOpenChange={onOpenChange} title={tr('Send the invite', 'Gửi link mời')}
        description={tr('One use only, for 14 days. Send it to the student — or to their parent for a child.', 'Chỉ dùng một lần, trong 14 ngày. Gửi cho học viên — hoặc phụ huynh nếu là trẻ em.')}
        footer={<Button variant="cta" size="lg" className={PANEL_BUTTON} onClick={() => onOpenChange(false)}>{tr('Done', 'Xong')}</Button>}>
        <InviteShare seatId={invite.seatId} code={invite.code} seatName={v.seatName} />
      </Panel>
    )
  }

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title={seatId ? tr('Practice settings', 'Cài đặt luyện tập') : tr('Add a student', 'Thêm học viên')}
      footer={
        <Button variant="cta" size="lg" className={PANEL_BUTTON} loading={busy} onClick={save} disabled={!v.seatName.trim()}>
          {seatId ? tr('Save', 'Lưu') : tr('Create invite', 'Tạo link mời')}
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">{tr('Student', 'Học viên')}</span>
          <Input value={v.seatName} maxLength={60} placeholder={tr('e.g. Minh — Grade 3', 'VD: Minh — Lớp 3')}
            onChange={(e) => setV({ ...v, seatName: e.target.value })} />
        </label>
        <Field label={tr('Level', 'Trình độ')}>
          <ToggleGroup<Level> aria-label={tr('Level', 'Trình độ')} value={[v.level]} onValueChange={(x) => x[0] && setV({ ...v, level: x[0] })}>
            {LEVELS.map((l) => <ToggleGroupItem key={l} value={l}>{l}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <Field label={tr('Minutes per session', 'Số phút mỗi buổi')}>
          <ToggleGroup<string> aria-label={tr('Minutes per session', 'Số phút mỗi buổi')} value={[String(v.sessionMinutes)]}
            onValueChange={(x) => x[0] && setV({ ...v, sessionMinutes: Number(x[0]) as SessionMinutes })}>
            {SESSION_MINUTES.map((m) => <ToggleGroupItem key={m} value={String(m)}>{m}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <Field label={tr('Sessions per week', 'Số buổi mỗi tuần')} hint={tr('At most one a day.', 'Tối đa một buổi mỗi ngày.')}>
          <ToggleGroup<string> aria-label={tr('Sessions per week', 'Số buổi mỗi tuần')} value={[String(v.sessionsPerWeek)]}
            onValueChange={(x) => x[0] && setV({ ...v, sessionsPerWeek: Number(x[0]) })}>
            {Array.from({ length: LIMITS.sessionsPerWeekMax }, (_, i) => i + 1).map((n) => <ToggleGroupItem key={n} value={String(n)}>{n}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <Field label={tr('Corrections', 'Cách sửa lỗi')}>
          <ToggleGroup<Strictness> aria-label={tr('Corrections', 'Cách sửa lỗi')} value={[v.strictness]} onValueChange={(x) => x[0] && setV({ ...v, strictness: x[0] })}>
            {STRICTNESS.map((s) => <ToggleGroupItem key={s} value={s}>{tr(STRICT_LABEL[s].en, STRICT_LABEL[s].vi)}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">{tr('Note for the avatar', 'Ghi chú cho avatar')}</span>
          <Textarea value={v.focusNote} maxLength={500} rows={3}
            placeholder={tr('e.g. Shy at first — praise before correcting. Working on past tense.', 'VD: Lúc đầu hơi ngại — hãy khen trước khi sửa. Đang học thì quá khứ.')}
            onChange={(e) => setV({ ...v, focusNote: e.target.value })} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>}
      </div>
    </Panel>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-4">{hint}</span>}
    </div>
  )
}
