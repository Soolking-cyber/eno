'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type State = {
  tables: true
  mode: 'off' | 'staff' | 'allowlist' | 'all'
  cohort: { id: string; email: string | null }[]
  dayMinutes: number; monthMinutes: number; teacherMonthMinutes: number
  spatiusChildrenOk: boolean
  updatedAt: string | null; updatedBy: string | null; sweptAt: string | null
  use: { todayMinutes: number; monthMinutes: number }
  last31Days: { sessions: number; costUsd: number; minutes: number }
  likeness: { avatarId: string; avatarName: string; teacher: string; email: string | null; photoUrl: string | null; consentAt: string | null }[]
  deletions: { spatiusAvatarId: string; reason: string; queuedAt: string }[]
  failedReports: { sessionId: string; startedAt: string; avatar: string }[]
  flagged: { sessionId: string; at: string; avatar: string; teacher: string; teacherEmail: string | null; learner: string; said: string; reply: string }[]
} | { tables: false }

/** The classroom's admin console (src/app/api/admin/classroom). English-only, like every admin surface. */
export function ClassroomAdminClient() {
  const [s, setS] = useState<State | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [cohort, setCohort] = useState('')
  const [readyIds, setReadyIds] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const r = await fetch('/api/admin/classroom', { cache: 'no-store' })
    const j = (await r.json()) as State
    setS(j)
    if (j.tables) setCohort(j.cohort.map((c) => c.email ?? c.id).join('\n'))
  }, [])
  useEffect(() => { void load() }, [load])

  const call = async (method: 'PUT' | 'POST', body: unknown) => {
    setMsg(null)
    const r = await fetch('/api/admin/classroom', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setMsg(`Refused: ${(j as { error?: string }).error ?? r.status}${(j as { error?: string }).error === 'not_configured' ? ' — enable eno-cron-classroom-sweep.timer first (the sweep must be running)' : ''}`)
    setS(j as State)
    // The cohort as SAVED (2c round 2, opus): an email with no account disappears here instead of looking saved.
    const st = j as State
    if (st.tables) setCohort(st.cohort.map((c) => c.email ?? c.id).join('\n'))
    setMsg('Saved.')
  }

  if (!s) return <p className="text-sm text-body">Loading…</p>
  if (!s.tables) return <p className="text-sm text-body">The classroom tables are not on this database yet — run scripts/classroom-ddl.mjs.</p>

  // Only the mode control sends `mode` (2c round 2, codex): a cap saved from a stale tab must not re-send its old mode.
  const save = (patch: Partial<{ mode: string; dayMinutes: number; monthMinutes: number; teacherMonthMinutes: number; spatiusChildrenOk: boolean }>) =>
    call('PUT', patch)
  return (
    <div className="flex flex-col gap-8">
      {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Switch</h2>
        <ToggleGroup<string> aria-label="Mode" value={[s.mode]} onValueChange={(v) => v[0] && save({ mode: v[0] })}>
          {(['off', 'staff', 'allowlist', 'all'] as const).map((m) => <ToggleGroupItem key={m} value={m} size="sm">{m}</ToggleGroupItem>)}
        </ToggleGroup>
        <p className="text-xs text-ink-4">
          Sweep last ran {s.sweptAt ? new Date(s.sweptAt).toLocaleString() : 'never'} · changed {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '—'} by {s.updatedBy ?? '—'}
        </p>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">Pilot teachers (one email per line) — used in “allowlist”</span>
          <Textarea rows={4} value={cohort} onChange={(e) => setCohort(e.target.value)} />
          <Button size="sm" variant="outline" className="self-start" onClick={() => call('PUT', { cohortEmails: cohort.split(/\s+/).filter(Boolean) })}>Save teachers</Button>
        </label>
        <div className="flex items-center gap-3">
          <Switch checked={s.spatiusChildrenOk} onChange={(v) => { void save({ spatiusChildrenOk: v }) }} aria-label="3D avatars for under-13s" />
          <span className="text-sm text-ink-2">3D avatars for under-13s — ONLY after Spatius has confirmed in writing (Terms §11)</span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Minutes</h2>
        <p className="text-sm text-body">
          Today {s.use.todayMinutes}/{s.dayMinutes} · this month {s.use.monthMinutes}/{s.monthMinutes} · last 31 days: {s.last31Days.sessions} sessions, {s.last31Days.minutes} min, ≈ ${s.last31Days.costUsd} (estimate — compare Spatius’s console).
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Cap label="Per day" value={s.dayMinutes} onSave={(n) => save({ dayMinutes: n })} />
          <Cap label="Per month" value={s.monthMinutes} onSave={(n) => save({ monthMinutes: n })} />
          <Cap label="Per teacher / month" value={s.teacherMonthMinutes} onSave={(n) => save({ teacherMonthMinutes: n })} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">3D likenesses to make ({s.likeness.length})</h2>
        <p className="text-xs text-ink-4">Make each in Spatius Studio from the teacher’s profile photo and NAME IT with the eno id shown (eno-…), then paste its Spatius id. The teacher is emailed. A Spatius id is used once, ever: one that was let go is refused.</p>
        <ul className="divide-y divide-border border-y border-border">
          {s.likeness.map((l) => (
            <li key={l.avatarId} className="flex flex-wrap items-center gap-3 py-3">
              {l.photoUrl && <a href={l.photoUrl} target="_blank" rel="noreferrer" className="text-sm text-brand underline">photo</a>}
              <span className="text-sm text-ink">{l.teacher} — “{l.avatarName}”</span>
              <code className="text-xs text-ink-4">eno-{l.avatarId}</code>
              <span className="text-xs text-ink-4">consented {l.consentAt ? new Date(l.consentAt).toLocaleDateString() : '—'}</span>
              <Input className="max-w-56" placeholder="Spatius avatar id" value={readyIds[l.avatarId] ?? ''} onChange={(e) => setReadyIds({ ...readyIds, [l.avatarId]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={!readyIds[l.avatarId]} onClick={() => call('POST', { action: 'likeness-ready', avatarId: l.avatarId, spatiusAvatarId: readyIds[l.avatarId] })}>Mark ready</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Likenesses to DELETE at Spatius ({s.deletions.length})</h2>
        {/* The photo notice promises BOTH go ("we ask Spatius to delete both"): the queue holds the likeness id, the step holds the photo. */}
        <p className="text-xs text-ink-4">In Spatius Studio, delete the avatar AND the source photo it was made from, then tick it here. A “request:” line is a request withdrawn before its id was pasted: delete whatever was made for it (named eno-… with the id after “request:”), if anything.</p>
        <ul className="divide-y divide-border border-y border-border">
          {s.deletions.map((d) => (
            <li key={d.spatiusAvatarId} className="flex flex-wrap items-center gap-3 py-3">
              <code className="text-sm">{d.spatiusAvatarId}</code>
              <span className="text-xs text-ink-4">{d.reason} · {new Date(d.queuedAt).toLocaleDateString()}</span>
              <Button size="sm" variant="outline" onClick={() => call('POST', { action: 'likeness-deleted', spatiusAvatarId: d.spatiusAvatarId })}>Deleted in Studio</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Safety flags ({s.flagged.length})</h2>
        <ul className="divide-y divide-border border-y border-border">
          {s.flagged.map((f) => (
            <li key={`${f.sessionId}-${f.at}`} className="flex flex-col gap-1 py-3 text-sm">
              <span className="text-ink-4">{new Date(f.at).toLocaleString()} · {f.learner} · {f.teacher} ({f.teacherEmail ?? 'no email'}) · “{f.avatar}” · <code>{f.sessionId}</code></span>
              <span className="text-ink">Learner: “{f.said}”</span>
              <span className="text-ink-3">Avatar: “{f.reply}”</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Failed reports ({s.failedReports.length})</h2>
        <ul className="divide-y divide-border border-y border-border">
          {s.failedReports.map((f) => (
            <li key={f.sessionId} className="flex items-center gap-3 py-2 text-sm">
              {new Date(f.startedAt).toLocaleString()} — {f.avatar}
              <Button size="sm" variant="outline" onClick={() => call('POST', { action: 'retry-report', sessionId: f.sessionId })}>Retry</Button>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/classroom" className="text-sm text-brand underline">Open eno Classroom</Link>
    </div>
  )
}

function Cap({ label, value, onSave }: { label: string; value: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-4">{label}</span>
      {/* An emptied field is no "0" (2c round 1, opus): it goes back to the saved value instead of closing the classroom's budget. */}
      <Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={() => { if (v === '') setV(String(value)); else if (Number(v) !== value) onSave(Number(v)) }} />
    </label>
  )
}
