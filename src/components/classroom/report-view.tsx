'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Meter } from '@/components/ui/meter'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ArrowLeft, Check, ChevronDown, FileText, ShieldAlert } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { api } from './api'
import { refusalCopy, sessionDate } from './classroom-copy'
import { WeekLine } from './week-line'

type Mistake = { said: string; better: string; type: string; why: string }
type Word = { word: string; score: number; reliable: boolean; tip: string | null }
type Report = {
  id: string
  startedAt: string
  feedbackStatus: string
  talkSeconds: number
  teacher: { name: string; photoUrl: string | null; avatarName: string }
  learner: { name: string; seatId: string } | null
  feedback: null | {
    summary: string; summaryVi: string; wins: string[]; mistakes: Mistake[]; pronunciation: Word[]
    vocabulary: { used?: string[]; missed?: string[]; new?: { word: string; meaning: string }[] }
    scores: { pronunciation: number | null; fluency: number | null; grammarFixes: number; talkSeconds: number }
    teacherNote?: string; safetyFlag?: string | null
  }
  /** `avatarVi`: the tutor's Vietnamese help, said before `avatar` (tutor-ai.ts `support`). */
  transcript: { seq: number; learner: string | null; avatar: string; avatarVi?: string; flag?: string }[]
  heardAs: { heard: string; meant: string }[]
  /** Each score's last value in an earlier session of the same seat and learner (report.ts previousScores). */
  previous: { pronunciation: number | null; fluency: number | null } | null
  /** Right after a lesson, on the family's side: the week for the celebration (report.ts celebrationFor) — else null. */
  celebrate: { done: number; of: number; streak: number } | null
}

/**
 * THE REPORT (plan "MVP scope › Learner › 4", Praktika's end report): the numbers (Azure's, never the model's), what went
 * well, "Say it better" — their words beside the better ones — words to practise coloured by score, new words, and the
 * whole transcript. The teacher sees the same, plus their private note and a safety flag when there is one.
 */
export function ReportView({ sessionId, justEnded = false }: { sessionId: string; justEnded?: boolean }) {
  const { tr, lang } = useLanguage()
  const [data, setData] = useState<{ viewer: string; report: Report } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /**
   * The celebration as first granted: the report keeps polling for up to ~17 minutes while it is built, and the server's
   * window is 15 (report.ts CELEBRATE_WITHIN_MS) — a card already on screen never vanishes under the reader.
   */
  // Held WITH its session id (commit review, codex): a grant never carries over to another report this view is given.
  const [granted, setGranted] = useState<{ id: string; c: NonNullable<Report['celebrate']> } | null>(null)
  // …and let go of when the view is given another session (commit review round 2, codex), so no grant outlives its own
  // report. (Next mounts a fresh view per session id today — layout-router keys a dynamic segment by its value, measured
  // 2026-10-06 — so this is a guard on the celebration only; the rest of the view's state assumes that remount.)
  useEffect(() => { setGranted((g) => (g && g.id !== sessionId ? null : g)) }, [sessionId])

  /**
   * The report is built just after the session ends (feedback.ts): poll gently until it is there.
   * ⛔ A FAILED POLL NEVER TAKES AWAY WHAT IS ON SCREEN (C3a review, codex + Opus): it used to replace a loaded report with
   * the error and stop polling for good. Now a network blip or a server error is tried again; only a FIRST load that
   * failed shows the error (with "Try again"), and a refusal that will not change (not found, not yours) stops at once.
   */
  useEffect(() => {
    let tries = 0
    let gone = false
    let t: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const r = await api<{ viewer: string; report: Report }>(`/api/classroom/sessions/${sessionId}`)
      if (gone) return
      if (r.ok) {
        setData(r.data)
        const c = r.data.report.celebrate
        if (r.data.viewer === 'learner' && c) setGranted((g) => (g?.id === sessionId ? g : { id: sessionId, c }))
        setError(null)
        // Every 4 s for two minutes, then every 15 s for about fifteen more: the sweep retries a stuck report every 5 min
        // (C3a round 2, Opus — polling used to stop at two minutes on "Building your report…").
        if (r.data.report.feedbackStatus === 'pending' && ++tries < 90) t = setTimeout(tick, tries < 30 ? 4_000 : 15_000)
        return
      }
      setError(r.error)
      const lasting = r.status === 401 || r.status === 403 || r.status === 404
      if (!lasting && ++tries < 90) t = setTimeout(tick, tries < 30 ? 8_000 : 15_000)
    }
    void tick()
    return () => { gone = true; if (t) clearTimeout(t) }
  }, [sessionId, attempt])

  // ⛔ A WAY BACK IN EVERY STATE (commit review round 2, opus): a report page has no classroom bar (globals.css, gap 10), so
  // while it loads, and when it cannot load, the arrow home is still there.
  const homeArrow = (
    <Button variant="ghost" size="icon" className="-ml-3 size-11 self-start" aria-label={tr('Back', 'Quay lại')} asChild><Link href="/classroom" prefetch={false}><ArrowLeft aria-hidden className="size-5" /></Link></Button>
  )
  if (error && !data) {
    return (
      <div className="flex flex-col pt-2">
        {homeArrow}
        <EmptyState icon={FileText} title={tr(refusalCopy(error).en, refusalCopy(error).vi)} className="mt-8"
          action={<Button variant="outline" className="min-h-11" onClick={() => { setError(null); setAttempt((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>} />
      </div>
    )
  }
  if (!data) return <div className="flex flex-col gap-4 pt-2">{homeArrow}<Skeleton className="h-96 w-full rounded-2xl" /></div>
  const { report: r, viewer } = data
  const teacherSide = viewer !== 'learner'
  const f = r.feedback
  const back = teacherSide && r.learner ? `/classroom/students/${r.learner.seatId}` : '/classroom'
  // The lesson that just ended asked for it (`?done=1`), and the server agreed (report.ts celebrationFor).
  const celebrate = justEnded && viewer === 'learner' && granted?.id === r.id ? granted.c : null
  const talk = `${Math.floor(r.talkSeconds / 60)}:${String(r.talkSeconds % 60).padStart(2, '0')}`

  return (
    <article className="flex flex-col gap-8 pt-2">
      <div className="flex items-center gap-3">
        {/* 44px, its arrow on the column's edge (-ml-3): the way back is the top-left thumb stretch, so it is a full target. */}
        <Button variant="ghost" size="icon" className="-ml-3 size-11" aria-label={tr('Back', 'Quay lại')} asChild><Link href={back} prefetch={false}><ArrowLeft aria-hidden className="size-5" /></Link></Button>
        <Avatar name={r.teacher.avatarName} url={r.teacher.photoUrl} size="md" />
        <div className="min-w-0">
          <h1 className="h-title truncate">{tr('Session report', 'Nhận xét buổi luyện')}</h1>
          <p className="text-xs text-ink-4">
            {sessionDate(r.startedAt, lang, 'long')}
            {r.learner ? ` · ${r.learner.name}` : ''}
          </p>
        </div>
      </div>

      {/* THE CELEBRATION (gap 4), under the way back: the first thing a learner sees after End, while the report is built. */}
      {celebrate && (
        <section aria-label={tr('Lesson done', 'Đã xong buổi luyện')} className="celebrate-in flex flex-col items-center gap-4 rounded-3xl bg-brand-deeper px-6 py-8 text-center text-primary-foreground">
          <Avatar name={r.teacher.avatarName} url={r.teacher.photoUrl} size="2xl" className="ring-4 ring-primary-foreground/90" />
          <div className="flex flex-col gap-1">
            <p className="h-display">{tr('Well done!', 'Giỏi lắm!')}</p>
            <p className="text-base text-primary-foreground/85">
              {tr('You spoke with', 'Bạn đã nói chuyện với')} {r.teacher.avatarName} · <span className="tabular-nums">{talk}</span>
            </p>
          </div>
          <WeekLine done={celebrate.done} of={celebrate.of} streak={celebrate.streak} />
        </section>
      )}

      {r.feedbackStatus === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Skeleton className="size-12 rounded-full" />
          <p className="text-sm text-body">{tr('Building your report…', 'Đang chuẩn bị nhận xét…')}</p>
        </div>
      )}
      {r.feedbackStatus === 'failed' && <p className="text-sm text-body">{tr('The report could not be made this time. The transcript is below.', 'Lần này chưa tạo được nhận xét. Bản ghi chữ ở bên dưới.')}</p>}

      {teacherSide && f?.safetyFlag && (
        <div role="note" className="flex items-start gap-3 rounded-2xl bg-warning/10 p-4 text-sm text-ink-2">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <span>{tr('The learner mentioned something that may need care. The avatar suggested talking to a trusted adult. Please read the transcript.', 'Học viên nhắc đến điều có thể cần quan tâm. Avatar đã khuyên nói chuyện với người lớn đáng tin cậy. Vui lòng đọc bản ghi chữ.')}</span>
        </div>
      )}

      {f && (
        <>
          {/* THE SCALE (gap 7): the two scores out of 100 with a bar and the change since an earlier session; the counts on a
              smaller second row. Two by two at every size: the page is a phone-width column even on a wide window (column.ts). */}
          <div className="flex flex-col gap-4 border-y border-border py-4">
            <dl className="grid grid-cols-2 gap-4">
              <ScoreStat label={tr('Pronunciation', 'Phát âm')} value={f.scores.pronunciation} previous={r.previous?.pronunciation ?? null} />
              <ScoreStat label={tr('Fluency', 'Độ trôi chảy')} value={f.scores.fluency} previous={r.previous?.fluency ?? null} />
            </dl>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <div className="flex gap-1.5"><dt className="text-ink-4">{tr('Grammar fixes', 'Lỗi ngữ pháp')}</dt><dd className="font-semibold tabular-nums text-ink">{f.scores.grammarFixes}</dd></div>
              <div className="flex gap-1.5"><dt className="text-ink-4">{tr('Talk time', 'Thời gian nói')}</dt><dd className="font-semibold tabular-nums text-ink">{talk}</dd></div>
            </dl>
          </div>

          {f.summary && (
            <section className="flex flex-col gap-2">
              <p className="text-base text-ink">{f.summary}</p>
              {f.summaryVi && <p lang="vi" className="text-sm text-body">{f.summaryVi}</p>}
              {f.wins.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {f.wins.map((w, i) => <li key={`${i}-${w}`} className="flex items-start gap-2 text-sm text-ink-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />{w}</li>)}
                </ul>
              )}
            </section>
          )}

          {f.mistakes.length > 0 && (
            <Section title={tr('Say it better', 'Nói hay hơn')}>
              <ul className="divide-y divide-border border-y border-border">
                {f.mistakes.map((m, i) => (
                  <li key={i} className="flex flex-col gap-1 py-3">
                    <p className="text-sm text-ink-4 line-through decoration-destructive/60">{m.said}</p>
                    <p className="text-base font-semibold text-ink">{m.better}</p>
                    {m.why && <p className="text-sm text-body">{m.why}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {f.pronunciation.length > 0 && (
            <Section title={tr('Words to practise', 'Từ cần luyện phát âm')}
              hint={tr('Scored by speech recognition. Words from a repeat-after-me sentence are the most reliable.', 'Do hệ thống nhận dạng giọng nói chấm. Từ trong câu nhắc lại là chính xác nhất.')}>
              <ul className="flex flex-col gap-3">
                {f.pronunciation.map((w, i) => (
                  <li key={`${i}-${w.word}`} className="flex items-start gap-3">
                    <Badge variant={w.score < 60 ? 'destructive' : 'warning'} size="md" className="min-w-14 justify-center tabular-nums">{w.score}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{w.word}{w.reliable && <span className="ml-2 text-xs font-normal text-ink-4">{tr('repeat sentence', 'câu nhắc lại')}</span>}</p>
                      {w.tip && <p className="text-sm text-body">{w.tip}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {r.heardAs.length > 0 && (
            <Section title={tr('Did you mean…?', 'Có phải bạn muốn nói…?')}>
              <ul className="flex flex-col gap-2">
                {r.heardAs.map((h, i) => (
                  <li key={`${i}-${h.heard}-${h.meant}`} className="text-sm text-body">
                    {tr('We heard', 'Chúng tôi nghe thành')} <span className="font-semibold text-ink">“{h.heard}”</span> — {tr('did you mean', 'có phải bạn muốn nói')} <span className="font-semibold text-ink">“{h.meant}”</span>?
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(f.vocabulary.new?.length ?? 0) > 0 && (
            <Section title={tr('New words', 'Từ mới')}>
              <ul className="flex flex-col gap-2">
                {f.vocabulary.new!.map((w, i) => <li key={`${i}-${w.word}`} className="text-sm"><span className="font-semibold text-ink">{w.word}</span> <span className="text-body">— {w.meaning}</span></li>)}
              </ul>
            </Section>
          )}

          {teacherSide && viewer === 'teacher' && <TeacherNote key={r.id} sessionId={r.id} initial={f.teacherNote ?? ''} />}
        </>
      )}

      <Collapsible className="border-t border-border pt-4">
        <CollapsibleTrigger render={<Button variant="ghost" className="min-h-12 w-full justify-between" />}>
          {tr('Transcript', 'Bản ghi chữ')}
          <ChevronDown aria-hidden />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ol className="flex flex-col gap-3 pt-3">
            {r.transcript.map((t) => (
              <li key={t.seq} className="flex flex-col gap-1">
                {t.learner && <p className={cn('self-end rounded-2xl bg-tint px-3 py-2 text-sm text-ink-2', t.flag && 'ring-2 ring-warning')}>{t.learner}</p>}
                {t.avatarVi && <p lang="vi" className="text-sm text-ink-3">{t.avatarVi}</p>}
                <p className="text-sm text-ink">{t.avatar}</p>
              </li>
            ))}
          </ol>
        </CollapsiblePanel>
      </Collapsible>
    </article>
  )
}

/** The scale beside a score — a number, the same in every language (react/jsx-no-literals wants it out of the markup). */
const OUT_OF = '/100'

/** A change smaller than this is the noise of a few scored sentences, not progress (plan review, opus). */
const DELTA_MIN = 3

/** A score out of 100: the number, its scale, a bar, and the change since an earlier session when there is one worth saying. */
function ScoreStat({ label, value, previous }: { label: string; value: number | null; previous: number | null }) {
  const { tr } = useLanguage()
  const v = value == null ? null : Math.max(0, Math.min(100, Math.round(value)))
  // Both ends on the same 0–100 scale (commit review round 2, opus): a stored score outside it never skews the change.
  const before = previous == null ? null : Math.max(0, Math.min(100, Math.round(previous)))
  const delta = v != null && before != null ? v - before : null
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className="flex flex-col gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-ink">
          {v ?? '—'}{v != null && <span className="ml-0.5 text-sm font-semibold text-ink-4">{OUT_OF}</span>}
        </span>
        {v != null && <Meter value={v} aria-label={label} valueText={`${v}/100`} />}
        {/* A drop is said plainly, never in red — the reader may be a child. */}
        {delta != null && Math.abs(delta) >= DELTA_MIN && (
          <span className={cn('text-xs tabular-nums', delta > 0 ? 'text-success' : 'text-ink-4')}>
            {delta > 0 ? '+' : '−'}{Math.abs(delta)} {tr('since last time', 'so với lần trước')}
          </span>
        )}
      </dd>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {hint && <p className="text-xs text-ink-4">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function TeacherNote({ sessionId, initial }: { sessionId: string; initial: string }) {
  const { tr } = useLanguage()
  const [note, setNote] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const save = async () => {
    setState('saving')
    const r = await api(`/api/classroom/sessions/${sessionId}`, { method: 'PATCH', body: { teacherNote: note } })
    setState(r.ok ? 'saved' : 'error')
  }
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h2 className="text-base font-bold text-ink">{tr('Your private note', 'Ghi chú riêng của bạn')}</h2>
      <p className="text-xs text-ink-4">{tr('Only you see this.', 'Chỉ bạn thấy ghi chú này.')}</p>
      <Textarea value={note} rows={3} maxLength={2000} onChange={(e) => { setNote(e.target.value); setState('idle') }} />
      <div className="flex items-center gap-3">
        <Button variant="outline" className="min-h-11" loading={state === 'saving'} onClick={save}>{tr('Save note', 'Lưu ghi chú')}</Button>
        {state === 'saved' && <span className="text-xs text-success">{tr('Saved', 'Đã lưu')}</span>}
        {state === 'error' && <span className="text-xs text-destructive">{tr('Not saved — try again.', 'Chưa lưu — thử lại.')}</span>}
      </div>
    </section>
  )
}
