'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { SwitchRow } from '@/components/ui/switch'
import { AlertCircle, ArrowLeft, Mic, Pause, Play, RotateCcw, Trash2, UserRound } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { VOICE_ATTESTATION, VOICE_NOTICE, VOICE_NOTICE_VERSION } from '@/lib/classroom/notices'
import { LIMITS, type VoiceFailReason } from '@/lib/classroom/constants'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { PANEL_BUTTON, Panel } from './panel'
import { useVoiceTake } from './use-voice-take'

type View =
  | { status: 'none' }
  | { status: 'script'; id: string; sentences: string[]; expiresAt: string }
  | { status: 'checking' | 'making'; id: string }
  | { status: 'ready'; id: string; sampleUrl: string }
  | { status: 'failed'; id: string; reason: VoiceFailReason }
type Loaded = { voice: View; open: boolean; noticeVersion: string }
type TutorRow = { id: string; name: string; ownVoice?: boolean }

/** Why an attempt failed, in the teacher's words (the API's refusal copy for the same reasons). */
const FAIL_COPY: Record<VoiceFailReason, string> = {
  not_script: 'voice_not_script', too_quiet: 'voice_too_quiet', slots_full: 'voice_slots_full',
  soniox: 'voice_unavailable', unusable: 'voice_unusable', gone: 'voice_unavailable', timeout: 'voice_unavailable',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * "YOUR OWN VOICE" (owner, 2026-11-09: "they can create their own avatar … voice creation … take teacher through process
 * nicely"). Praktika-minimal, one decision a screen: agree → read the sentences aloud → we make it → hear it, choose the
 * tutors that speak in it. Delete any time. The server decides every state (own-voice.ts); this page shows it.
 */
export function OwnVoiceFlow() {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  if (!loading && !user) {
    return <EmptyState icon={UserRound} title={tr('Sign in to make your voice', 'Đăng nhập để tạo giọng nói')} className="mt-12"
      action={<Button variant="cta" className="min-h-11" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>} />
  }
  if (!user) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  return <Flow key={user.id} />
}

function Flow() {
  const { tr } = useLanguage()
  const [d, setD] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  /** Past the agreement (Continue): the read screen shows only then, even when a script is already waiting. */
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const take = useVoiceTake()

  const load = useCallback(async () => {
    const r = await api<Loaded>('/api/classroom/own-voice')
    if (!r.ok) { setFailed(r.error); return }
    setD(r.data)
  }, [])
  useEffect(() => { void load() }, [load])

  // Being checked or made: ask again every few seconds (the server asks Soniox).
  const making = d?.voice.status === 'making' || d?.voice.status === 'checking'
  useEffect(() => {
    if (!making) return
    const t = setInterval(() => { void load() }, 3_000)
    return () => clearInterval(t)
  }, [making, load])

  if (failed) return <EmptyState icon={UserRound} title={tr(refusalCopy(failed).en, refusalCopy(failed).vi)} className="mt-12" />
  if (!d) return <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
  const v = d.voice

  const newScript = async () => {
    setBusy(true)
    setError(null)
    const r = await api<{ voice: View }>('/api/classroom/own-voice', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    take.reset()
    setStarted(true)
    setD({ ...d, voice: r.data.voice })
  }
  const send = async () => {
    if (v.status !== 'script') return
    const { wav, peak } = take.take()
    if (!wav) return
    if (peak < 0.06) return setError('voice_too_quiet')
    setBusy(true)
    setError(null)
    const q = new URLSearchParams({ id: v.id, consent: VOICE_NOTICE_VERSION, own: '1' })
    const r = await api<{ voice: View }>(`/api/classroom/own-voice/recording?${q}`, { raw: wav as Uint8Array<ArrayBuffer>, headers: { 'content-type': 'audio/wav' } })
    setBusy(false)
    if (!r.ok) {
      // Expired or used: new sentences at once, as the message says (commit gate, opus) — the agreement still stands.
      if (r.error === 'voice_script_expired') { await newScript(); setError('voice_script_expired'); return }
      setError(r.error)
      // A failed check: the next step starts from what the server now says.
      if (r.error === 'voice_not_script' || r.error === 'voice_unavailable' || r.error === 'voice_slots_full') void load()
      return
    }
    take.reset()
    setD({ ...d, voice: r.data.voice })
  }

  const header = (
    <>
      <Link href="/classroom" prefetch={false} className="press -ml-1 flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-ink-2">
        <ArrowLeft aria-hidden className="size-4" />{tr('Your class', 'Lớp của bạn')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="h-title">{tr('Your own voice', 'Giọng nói của bạn')}</h1>
        <p className="text-sm text-body">{tr('Your tutors can speak to your students in your voice.', 'Các gia sư AI có thể nói với học viên bằng giọng của bạn.')}</p>
      </div>
    </>
  )
  const alert = error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>

  // ── Ready: hear it, choose the tutors ────────────────────────────────────────────────────────────────────────────────
  if (v.status === 'ready') return <div className="flex flex-col gap-5 pb-8">{header}<Ready sampleUrl={v.sampleUrl} onDeleted={() => { setAgreed(false); setStarted(false); setD({ ...d, voice: { status: 'none' } }) }} /></div>

  // ── Being checked / made ──────────────────────────────────────────────────────────────────────────────────────────────
  if (making) {
    return (
      <div className="flex flex-col gap-5 pb-8">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-tint px-4 py-10 text-center">
          <Spinner size="lg" />
          <p className="text-base font-semibold text-ink">{v.status === 'checking' ? tr('Checking your recording…', 'Đang kiểm tra bản ghi…') : tr('Making your voice…', 'Đang tạo giọng nói…')}</p>
          <p className="text-sm text-body">{tr('Usually under a minute. You can leave this page — it carries on.', 'Thường dưới một phút. Bạn có thể rời trang — quá trình vẫn tiếp tục.')}</p>
        </div>
      </div>
    )
  }

  if (!d.open) {
    return <div className="flex flex-col gap-5 pb-8">{header}<p className="rounded-2xl bg-tint p-4 text-sm text-body">{tr('Your own voice is in a small pilot and isn’t open for your class yet.', 'Giọng nói riêng đang thử nghiệm và chưa mở cho lớp của bạn.')}</p></div>
  }

  // ── Agree first (also when a script is waiting: the consent goes with the recording) ──────────────────────────────────
  if (!started || !agreed || v.status === 'none' || v.status === 'failed') {
    return (
      <div className="flex flex-col gap-5 pb-8">
        {header}
        {v.status === 'failed' && (
          <p role="status" className="flex items-start gap-2 rounded-2xl bg-tint p-3 text-sm text-ink">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            {tr(refusalCopy(FAIL_COPY[v.reason]).en, refusalCopy(FAIL_COPY[v.reason]).vi)}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {[
            [tr('Read a few sentences aloud', 'Đọc to vài câu'), tr('About a minute, in your normal lesson voice.', 'Khoảng một phút, bằng giọng dạy thường ngày.')],
            [tr('We make your voice', 'Chúng tôi tạo giọng nói'), tr('Usually in under a minute.', 'Thường dưới một phút.')],
            [tr('Choose your tutors', 'Chọn gia sư'), tr('They speak in your voice from their next reply.', 'Gia sư nói bằng giọng của bạn từ câu trả lời tiếp theo.')],
          ].map(([t, s], i) => (
            <li key={t} className="flex items-start gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-primary-foreground">{i + 1}</span>
              <span className="flex flex-col"><span className="text-sm font-semibold text-ink">{t}</span><span className="text-sm text-body">{s}</span></span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-4">{tr('Use a quiet room and your phone’s own microphone, not Bluetooth earphones.', 'Hãy ở phòng yên tĩnh và dùng micro của điện thoại, không dùng tai nghe Bluetooth.')}</p>
        <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4">
          <Checkbox checked={agreed} onChange={setAgreed} className="mt-0.5 h-5 w-5" />
          <span className="flex flex-col gap-1.5">
            <span className="text-base font-semibold text-ink">{tr(VOICE_ATTESTATION.en, VOICE_ATTESTATION.vi)}</span>
            {VOICE_NOTICE.map((l) => <span key={l.en} className="text-sm text-body">{tr(l.en, l.vi)}</span>)}
          </span>
        </label>
        {alert}
        <Button variant="cta" size="lg" className="min-h-12" disabled={!agreed} loading={busy}
          onClick={() => { setError(null); if (v.status === 'script' && new Date(v.expiresAt) > new Date()) setStarted(true); else void newScript() }}>
          {tr('Continue', 'Tiếp tục')}
        </Button>
      </div>
    )
  }

  // ── Read the sentences ────────────────────────────────────────────────────────────────────────────────────────────────
  if (v.status !== 'script') return null
  const s = take.state
  return (
    <div className="flex flex-col gap-5 pb-8">
      {header}
      <p className="text-sm font-semibold text-ink">{tr('Read these aloud, in order:', 'Hãy đọc to theo thứ tự:')}</p>
      <ol className="flex flex-col gap-3 rounded-2xl bg-tint p-4">
        {v.sentences.map((t, i) => <li key={i} className="text-lg leading-snug text-ink">{t}</li>)}
      </ol>
      <div className="flex flex-col items-center gap-3">
        {s === 'recording' ? (
          <>
            <span className="text-2xl font-bold tabular-nums text-ink" aria-live="off">{clock(take.seconds)}</span>
            {/* The level, so a silent microphone shows itself before a minute is wasted. */}
            <span aria-hidden className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-brand transition-[width] duration-100" style={{ width: `${Math.round(take.level * 100)}%` }} /></span>
            <Button variant="destructive" size="lg" className="min-h-14 min-w-40 rounded-full" onClick={take.stop} disabled={take.seconds < LIMITS.voiceMinSeconds}>
              <span aria-hidden className="size-4 rounded-lg bg-current" />{tr('Stop', 'Dừng')}
            </Button>
            {take.seconds < LIMITS.voiceMinSeconds && <span className="text-xs text-ink-4">{tr('Read all the sentences, then tap Stop.', 'Đọc hết các câu, rồi chạm Dừng.')}</span>}
          </>
        ) : s === 'done' ? (
          <div className="flex w-full gap-2">
            <Button variant="outline" size="lg" className="min-h-12 flex-1" onClick={() => { setError(null); take.reset() }} disabled={busy}><RotateCcw aria-hidden />{tr('Read again', 'Đọc lại')}</Button>
            <Button variant="cta" size="lg" className="min-h-12 flex-1" loading={busy} onClick={() => void send()}>{tr('Send', 'Gửi')}</Button>
          </div>
        ) : (
          <>
            <Button variant="cta" size="lg" className={cn('size-20 rounded-full p-0')} loading={s === 'starting'} onClick={() => { setError(null); void take.start() }} aria-label={tr('Start reading', 'Bắt đầu đọc')}>
              <Mic aria-hidden className="size-8" />
            </Button>
            <span className="text-sm text-body">
              {s === 'interrupted' ? tr('The recording stopped. Tap to read again.', 'Bản ghi đã dừng. Chạm để đọc lại.')
                : s === 'denied' ? tr('Allow the microphone for eno, then tap again.', 'Hãy cho phép eno dùng micro, rồi chạm lại.')
                  : tr('Tap, then read', 'Chạm, rồi đọc')}
            </span>
          </>
        )}
      </div>
      {alert}
    </div>
  )
}

function Ready({ sampleUrl, onDeleted }: { sampleUrl: string; onDeleted: () => void }) {
  const { tr } = useLanguage()
  const [tutors, setTutors] = useState<TutorRow[] | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    void api<{ tutors: TutorRow[] }>('/api/classroom/tutors').then((r) => { if (r.ok) setTutors(r.data.tutors); else setError(r.error) })
    return () => { audio.current?.pause(); audio.current = null }
  }, [])

  const play = () => {
    if (playing) { audio.current?.pause(); audio.current = null; setPlaying(false); return }
    const a = new Audio(sampleUrl)
    audio.current = a
    const done = () => { if (audio.current === a) { audio.current = null; setPlaying(false) } }
    a.onended = done
    a.onerror = done
    setPlaying(true)
    void a.play().catch(() => { if (audio.current === a) { audio.current = null; setPlaying(false) } })
  }
  const set = async (t: TutorRow, on: boolean) => {
    setSaving(t.id)
    setError(null)
    const r = await api<{ ownVoiceTutorIds: string[] }>('/api/classroom/own-voice/tutors', { body: { tutorIds: [t.id], on } })
    setSaving(null)
    if (!r.ok) return setError(r.error)
    const ids = new Set(r.data.ownVoiceTutorIds)
    setTutors((cur) => cur && cur.map((x) => ({ ...x, ownVoice: ids.has(x.id) })))
  }
  const remove = async () => {
    setDeleting(true)
    const r = await api('/api/classroom/own-voice', { method: 'DELETE' })
    setDeleting(false)
    setConfirm(false)
    if (!r.ok) return setError(r.error)
    onDeleted()
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl bg-tint p-4">
        <Button variant="cta" size="icon" className="size-12 shrink-0 rounded-full" onClick={play} aria-pressed={playing} aria-label={playing ? tr('Stop', 'Dừng') : tr('Listen', 'Nghe thử')}>
          {playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
        </Button>
        <span className="flex flex-col"><span className="text-base font-semibold text-ink">{tr('Your voice is ready', 'Giọng nói của bạn đã sẵn sàng')}</span><span className="text-sm text-body">{tr('Tap to hear it', 'Chạm để nghe')}</span></span>
      </div>
      <section aria-labelledby="own-voice-tutors" className="flex flex-col gap-2">
        <h2 id="own-voice-tutors" className="text-lg font-bold text-ink">{tr('Tutors that speak in it', 'Gia sư nói bằng giọng này')}</h2>
        {tutors === null ? <Skeleton className="h-24 w-full rounded-2xl" /> : tutors.length === 0 ? (
          <p className="text-sm text-body">{tr('Make a tutor first.', 'Hãy tạo gia sư trước.')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tutors.map((t) => (
              <SwitchRow key={t.id} checked={!!t.ownVoice} disabled={saving !== null} onChange={(on) => void set(t, on)} label={t.name} />
            ))}
          </div>
        )}
        <p className="text-xs text-ink-4">{tr('If your voice can’t be reached, a tutor speaks in its usual voice.', 'Nếu không dùng được giọng của bạn, gia sư nói bằng giọng thường.')}</p>
      </section>
      {error && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p>}
      <div className="border-t border-border pt-4">
        <Button variant="ghost" className="-ml-3 min-h-11 text-destructive" onClick={() => setConfirm(true)}><Trash2 aria-hidden />{tr('Delete my voice', 'Xoá giọng nói của tôi')}</Button>
      </div>
      <Panel open={confirm} onOpenChange={setConfirm} title={tr('Delete your voice?', 'Xoá giọng nói của bạn?')}
        description={tr('It is deleted at Soniox, and your tutors go back to their usual voice. You can make it again later.', 'Giọng sẽ bị xoá tại Soniox, và gia sư quay lại giọng thường. Bạn có thể tạo lại sau.')}
        footer={<>
          <Button variant="outline" size="lg" className={PANEL_BUTTON} onClick={() => setConfirm(false)}>{tr('Cancel', 'Huỷ')}</Button>
          <Button variant="destructive" size="lg" className={PANEL_BUTTON} loading={deleting} onClick={() => void remove()}>{tr('Delete', 'Xoá')}</Button>
        </>}>{null}</Panel>
    </>
  )
}
