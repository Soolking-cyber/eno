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
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ArrowLeft, Check, ChevronDown, FileText, ShieldAlert } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { api } from './api'
import { refusalCopy, sessionDate } from './classroom-copy'

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
  transcript: { seq: number; learner: string | null; avatar: string; flag?: string }[]
  heardAs: { heard: string; meant: string }[]
}

/**
 * THE REPORT (plan "MVP scope › Learner › 4", Praktika's end report): the numbers (Azure's, never the model's), what went
 * well, "Say it better" — their words beside the better ones — words to practise coloured by score, new words, and the
 * whole transcript. The teacher sees the same, plus their private note and a safety flag when there is one.
 */
export function ReportView({ sessionId }: { sessionId: string }) {
  const { tr, lang } = useLanguage()
  const [data, setData] = useState<{ viewer: string; report: Report } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

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
        setError(null)
        if (r.data.report.feedbackStatus === 'pending' && ++tries < 30) t = setTimeout(tick, 4_000)
        return
      }
      setError(r.error)
      const lasting = r.status === 401 || r.status === 403 || r.status === 404
      if (!lasting && ++tries < 30) t = setTimeout(tick, 8_000)
    }
    void tick()
    return () => { gone = true; if (t) clearTimeout(t) }
  }, [sessionId, attempt])

  if (error && !data) {
    return (
      <EmptyState icon={FileText} title={tr(refusalCopy(error).en, refusalCopy(error).vi)} className="mt-12"
        action={<Button variant="outline" onClick={() => { setError(null); setAttempt((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>} />
    )
  }
  if (!data) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  const { report: r, viewer } = data
  const teacherSide = viewer !== 'learner'
  const f = r.feedback
  const back = teacherSide && r.learner ? `/classroom/students/${r.learner.seatId}` : '/classroom'

  return (
    <article className="flex flex-col gap-8 pt-2">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label={tr('Back', 'Quay lại')} asChild><Link href={back} prefetch={false}><ArrowLeft aria-hidden /></Link></Button>
        <Avatar name={r.teacher.avatarName} url={r.teacher.photoUrl} size="md" />
        <div className="min-w-0">
          <h1 className="h-title truncate">{tr('Session report', 'Nhận xét buổi luyện')}</h1>
          <p className="text-xs text-ink-4">
            {sessionDate(r.startedAt, lang, 'long')}
            {r.learner ? ` · ${r.learner.name}` : ''}
          </p>
        </div>
      </div>

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
          <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">
            <Stat label={tr('Pronunciation', 'Phát âm')} value={f.scores.pronunciation != null ? String(f.scores.pronunciation) : '—'} />
            <Stat label={tr('Fluency', 'Độ trôi chảy')} value={f.scores.fluency != null ? String(f.scores.fluency) : '—'} />
            <Stat label={tr('Grammar fixes', 'Lỗi ngữ pháp')} value={String(f.scores.grammarFixes)} />
            <Stat label={tr('Talk time', 'Thời gian nói')} value={`${Math.floor(r.talkSeconds / 60)}:${String(r.talkSeconds % 60).padStart(2, '0')}`} />
          </dl>

          {f.summary && (
            <section className="flex flex-col gap-2">
              <p className="text-base text-ink">{f.summary}</p>
              {f.summaryVi && <p lang="vi" className="text-sm text-body">{f.summaryVi}</p>}
              {f.wins.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {f.wins.map((w) => <li key={w} className="flex items-start gap-2 text-sm text-ink-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />{w}</li>)}
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
                    {m.why && <p className="text-xs text-body">{m.why}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {f.pronunciation.length > 0 && (
            <Section title={tr('Words to practise', 'Từ cần luyện phát âm')}
              hint={tr('Scored by speech recognition. Words from a repeat-after-me sentence are the most reliable.', 'Do hệ thống nhận dạng giọng nói chấm. Từ trong câu nhắc lại là chính xác nhất.')}>
              <ul className="flex flex-col gap-3">
                {f.pronunciation.map((w) => (
                  <li key={w.word} className="flex items-start gap-3">
                    <Badge variant={w.score < 60 ? 'destructive' : 'warning'} size="md" className="min-w-14 justify-center tabular-nums">{w.score}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{w.word}{w.reliable && <span className="ml-2 text-xs font-normal text-ink-4">{tr('repeat sentence', 'câu nhắc lại')}</span>}</p>
                      {w.tip && <p className="text-xs text-body">{w.tip}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {r.heardAs.length > 0 && (
            <Section title={tr('Did you mean…?', 'Có phải bạn muốn nói…?')}>
              <ul className="flex flex-col gap-2">
                {r.heardAs.map((h) => (
                  <li key={`${h.heard}-${h.meant}`} className="text-sm text-body">
                    {tr('We heard', 'Chúng tôi nghe thành')} <span className="font-semibold text-ink">“{h.heard}”</span> — {tr('did you mean', 'có phải bạn muốn nói')} <span className="font-semibold text-ink">“{h.meant}”</span>?
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(f.vocabulary.new?.length ?? 0) > 0 && (
            <Section title={tr('New words', 'Từ mới')}>
              <ul className="flex flex-col gap-2">
                {f.vocabulary.new!.map((w) => <li key={w.word} className="text-sm"><span className="font-semibold text-ink">{w.word}</span> <span className="text-body">— {w.meaning}</span></li>)}
              </ul>
            </Section>
          )}

          {teacherSide && viewer === 'teacher' && <TeacherNote sessionId={r.id} initial={f.teacherNote ?? ''} />}
        </>
      )}

      <Collapsible className="border-t border-border pt-4">
        <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-between" />}>
          {tr('Transcript', 'Bản ghi chữ')}
          <ChevronDown aria-hidden />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ol className="flex flex-col gap-3 pt-3">
            {r.transcript.map((t) => (
              <li key={t.seq} className="flex flex-col gap-1">
                {t.learner && <p className={cn('self-end rounded-2xl bg-tint px-3 py-2 text-sm text-ink-2', t.flag && 'ring-2 ring-warning')}>{t.learner}</p>}
                <p className="text-sm text-ink">{t.avatar}</p>
              </li>
            ))}
          </ol>
        </CollapsiblePanel>
      </Collapsible>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums text-ink">{value}</dd>
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
        <Button size="sm" variant="outline" loading={state === 'saving'} onClick={save}>{tr('Save note', 'Lưu ghi chú')}</Button>
        {state === 'saved' && <span className="text-xs text-success">{tr('Saved', 'Đã lưu')}</span>}
        {state === 'error' && <span className="text-xs text-destructive">{tr('Not saved — try again.', 'Chưa lưu — thử lại.')}</span>}
      </div>
    </section>
  )
}
