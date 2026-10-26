'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Check, PencilLine, Sparkles } from '@/components/ui/icons'
import { PLAN_LIMITS, type PlanFocus } from '@/lib/classroom/plans'
import { api } from './api'
import { refusalCopy } from './classroom-copy'

type Plan = { id: string; source: string; status: string; brief: string; focus: PlanFocus; openingLine: string; updatedAt: string } | null

/** A plan action: a 44px target sharing the row equally, its label wrapping (Vietnamese runs long) rather than spilling. */
const ACTION = 'min-h-11 min-w-0 flex-1 whitespace-normal'

const lines = (s: string, n: number) => s.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, n)
const words = (s: string, n: number) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, n)

/**
 * THE NEXT SESSION (owner: "teacher can have a look and adjust the next sessions prompt"): the plan waiting — the AI's
 * draft from the last report, or the teacher's own — readable at a glance and editable in place. Saving makes it the
 * teacher's: the AI never overwrites it (feedback.ts), and the next session runs on it. With nothing written yet, the
 * first session is a get-to-know-you talk at the seat's level (plans.ts firstPlan).
 * ⛔ The save carries the plan the teacher SAW (baseId + updatedAt): if a newer report drafted another meanwhile, the
 * server refuses (plan_changed) and this reloads the newer one instead of overwriting what the teacher never read.
 */
export function PlanEditor({ seatId, plan, onSaved }: { seatId: string; plan: Plan; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [edit, setEdit] = useState(false)
  const [brief, setBrief] = useState(plan?.brief ?? '')
  const [focusWords, setFocusWords] = useState(plan?.focus.focusWords.join(', ') ?? '')
  const [drill, setDrill] = useState(plan?.focus.drill.join('\n') ?? '')
  const [goals, setGoals] = useState(plan?.focus.goals.join('\n') ?? '')
  const [opening, setOpening] = useState(plan?.openingLine ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * ⛔ THE PLAN THE TEACHER STARTED FROM (C3b round 2, codex): a reload while editing (a pause, a new report) used to move
   * the save's baseline to a plan they never saw, so the version check passed and their old text overwrote it. The base
   * is taken when editing starts, and moves to a newer plan only once "plan_changed" has shown it beside their text.
   */
  const [base, setBase] = useState<{ id: string; updatedAt: string } | null>(null)
  const startEdit = () => { setError(null); setBase(plan ? { id: plan.id, updatedAt: plan.updatedAt } : null); setEdit(true) }
  /**
   * The version this save may replace — what the teacher SAW (C3c review, codex): the plan they started from, or, after
   * "plan_changed", the newer plan on screen beside their text at the moment they tap Save (so each later revision has to
   * be seen too). `baseId: null` says they started from no plan; the server then refuses if one has arrived.
   */
  const baseline = () => {
    const b = error === 'plan_changed' ? (plan ? { id: plan.id, updatedAt: plan.updatedAt } : null) : base
    return b ? { baseId: b.id, baseUpdatedAt: b.updatedAt } : { baseId: null }
  }
  /**
   * ⛔ THE FIELDS FOLLOW THE PLAN ONLY WHILE NOBODY IS TYPING (C3b review): they re-sync when a NEW plan arrives (another id or
   * a newer save) and whenever editing ends — so Cancel restores the saved plan — but never mid-edit: a reload (after a
   * pause, a re-invite, or "plan_changed") used to wipe what the teacher was writing.
   */
  const planRef = useRef(plan)
  planRef.current = plan
  useEffect(() => {
    if (edit) return
    const p = planRef.current
    setBrief(p?.brief ?? ''); setFocusWords(p?.focus.focusWords.join(', ') ?? ''); setDrill(p?.focus.drill.join('\n') ?? '')
    setGoals(p?.focus.goals.join('\n') ?? ''); setOpening(p?.openingLine ?? '')
  }, [plan?.id, plan?.updatedAt, edit])

  const save = async (asIs: boolean) => {
    setBusy(true)
    setError(null)
    const body = asIs && plan
      ? { seatId, brief: plan.brief, focus: plan.focus, openingLine: plan.openingLine, baseId: plan.id, baseUpdatedAt: plan.updatedAt }
      : {
        seatId, brief, openingLine: opening,
        focus: { goals: lines(goals, PLAN_LIMITS.goals), focusWords: words(focusWords, PLAN_LIMITS.focusWords), recycle: plan?.focus.recycle ?? [], drill: lines(drill, PLAN_LIMITS.drill) },
        ...baseline(),
      }
    const r = await api('/api/classroom/plans', { method: 'PUT', body })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      if (r.error === 'plan_changed') onSaved()
      return
    }
    setEdit(false)
    onSaved()
  }

  const mine = plan?.source === 'teacher'
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{tr('Next session', 'Buổi tiếp theo')}</h2>
        {plan && (mine
          ? <Badge variant="success" size="sm"><Check aria-hidden className="size-3.5" />{tr('Your plan', 'Kế hoạch của bạn')}</Badge>
          : <Badge variant="brand" size="sm"><Sparkles aria-hidden className="size-3.5" />{tr('AI draft', 'Bản nháp AI')}</Badge>)}
      </div>

      {!edit ? (
        <div className="flex flex-col gap-3 border-y border-border py-4">
          {plan ? (
            <>
              <p className="text-base text-ink">{plan.brief}</p>
              {plan.focus.goals.length > 0 && <Row label={tr('Goals', 'Mục tiêu')} value={plan.focus.goals.join(' · ')} />}
              {plan.focus.focusWords.length > 0 && <Row label={tr('Focus words', 'Từ trọng tâm')} value={plan.focus.focusWords.join(', ')} />}
              {plan.focus.recycle.length > 0 && <Row label={tr('Brings back', 'Ôn lại')} value={plan.focus.recycle.join(' · ')} />}
              {plan.focus.drill.length > 0 && <Row label={tr('Repeat-after-me', 'Câu nhắc lại')} value={plan.focus.drill.map((s) => `“${s}”`).join('  ')} />}
            </>
          ) : (
            <p className="text-sm text-body">{tr('First session: a get-to-know-you conversation at the student’s level. After it, the AI drafts the next one from the report.', 'Buổi đầu: trò chuyện làm quen theo trình độ học viên. Sau đó AI sẽ soạn buổi tiếp theo dựa trên nhận xét.')}</p>
          )}
          {/* Side by side and equal on a phone, each a 44px target; alone, the one action takes the row. */}
          <div className="flex gap-3">
            <Button variant="outline" className={ACTION} onClick={startEdit}><PencilLine aria-hidden />{plan ? tr('Edit', 'Chỉnh sửa') : tr('Write the next session', 'Soạn buổi tiếp theo')}</Button>
            {plan && !mine && <Button variant="cta" className={ACTION} loading={busy} onClick={() => save(true)}><Check aria-hidden />{tr('Approve', 'Duyệt')}</Button>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 border-y border-border py-4">
          <Field label={tr('What to practise', 'Nội dung luyện tập')} hint={tr('A scenario or topic, in a sentence or two — the avatar plays it.', 'Một tình huống hoặc chủ đề trong một hai câu — avatar sẽ đóng vai.')}>
            <Textarea value={brief} rows={3} maxLength={PLAN_LIMITS.brief} onChange={(e) => setBrief(e.target.value)} />
          </Field>
          <Field label={tr('Goals', 'Mục tiêu')} hint={tr('One per line.', 'Mỗi dòng một mục.')}>
            <Textarea value={goals} rows={2} onChange={(e) => setGoals(e.target.value)} />
          </Field>
          <Field label={tr('Focus words', 'Từ trọng tâm')} hint={tr('Separated by commas.', 'Cách nhau bằng dấu phẩy.')}>
            <Input value={focusWords} onChange={(e) => setFocusWords(e.target.value)} />
          </Field>
          <Field label={tr('Repeat-after-me sentences', 'Câu nhắc lại')} hint={tr('Up to 3 short sentences, one per line. Their pronunciation is scored most reliably.', 'Tối đa 3 câu ngắn, mỗi dòng một câu. Phát âm các câu này được chấm chính xác nhất.')}>
            <Textarea value={drill} rows={3} onChange={(e) => setDrill(e.target.value)} />
          </Field>
          <Field label={tr('First line', 'Câu mở đầu')}>
            <Input value={opening} maxLength={200} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>}
          {/* "plan_changed": the newer plan, beside the teacher's own text (kept) — Save again replaces it. */}
          {error === 'plan_changed' && plan && (
            <p className="rounded-xl bg-tint px-3 py-2 text-sm text-body"><span className="font-semibold text-ink">{tr('The newer plan:', 'Kế hoạch mới hơn:')}</span> {plan.brief}</p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="min-h-12" onClick={() => { setError(null); setEdit(false) }}>{tr('Cancel', 'Huỷ')}</Button>
            <Button variant="cta" size="lg" className="min-h-12 min-w-0 flex-1 whitespace-normal" loading={busy} disabled={!brief.trim()} onClick={() => save(false)}>{tr('Save plan', 'Lưu kế hoạch')}</Button>
          </div>
        </div>
      )}
      {!edit && error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>}
    </section>
  )
}

/** One line of the plan — content the teacher reads before approving, so body-size type on a phone, not a 12px caption. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm text-body"><span className="font-semibold text-ink-2">{label}:</span> {value}</p>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-4">{hint}</span>}
    </label>
  )
}
