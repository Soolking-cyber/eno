'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { StepWizard, type WizardStep } from '@/components/ui/step-wizard'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Camera, Check, Pause, Play, Sparkles, UserRound, Volume2 } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { LIBRARY_AVATARS } from '@/lib/classroom/library-avatars'
import { ACCENT_LABEL, VOICES } from '@/lib/classroom/voices'
import {
  AVATAR_NAME_MAX, BEST_FOR_MAX, DEFAULT_TRAITS, MAX_TOPICS, PACES, PACE_LABEL, PERSONA_MAX, TONES, TONE_LABEL, TOPICS, TOPIC_LABEL,
  parseTraits, type Pace, type Tone, type Topic, type Traits,
} from '@/lib/classroom/persona'
import { BACKGROUNDS, BACKGROUND_LABEL, backgroundThumb, isBackground } from '@/lib/classroom/backgrounds'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { PERSONA_AI_ACTION, PERSONA_AI_NOTICE, PERSONA_AI_NOTICE_VERSION, PHOTO_ACTION, PHOTO_NOTICE, PHOTO_NOTICE_VERSION } from '@/lib/classroom/notices'
import { LIKENESS_REQUESTS_OPEN, type AvatarLook } from '@/lib/classroom/constants'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { TutorFace } from './tutor-card'

type SavedTutor = { id: string; name: string; bestFor: string; persona: string; greeting: string; traits: unknown; voice: string; look: string; libraryAvatarId: string | null; customStatus: string }
type Loaded = {
  teacher: { fullName: string; photoUrl: string | null; nationality: string }
  tutor: null | SavedTutor
  defaults: { name: string; voice: string; traits: Traits }
  /** A new tutor: how many the teacher has and may keep — at the cap the page says so before any step (commit gate round 2). */
  tutors?: unknown[]
  limit?: number
}
type Draft = { name: string; bestFor: string; persona: string; greeting: string; traits: Traits; voice: string; look: AvatarLook; libraryAvatarId: string | null }

/**
 * MAKE / EDIT A TUTOR (owner, 2026-11-09: a tutor for each student, "take teacher through process nicely", Praktika's
 * minimal look): Look (face + room) → Voice → Personality, then Save — three screens, each with a default, under a preview
 * of the tutor as students will see it. Saved once at the end (the API validates everything again); trying it and giving it
 * to students happen on the tutor's own page after (plan review: not steps of making it).
 */
export function TutorWizard({ tutorId }: { tutorId?: string }) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [step, setStep] = useState('look')
  const [d, setD] = useState<Draft | null>(null)
  const [customStatus, setCustomStatus] = useState('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Per account (C3b review, codex): another account's draft never stays on screen, and a late answer for the previous
    // account is dropped — a Save would have sent it under this one.
    setData(null)
    setD(null)
    setFailed(null)
    setStep('look')
    if (!user) return
    let gone = false
    const url = tutorId ? `/api/classroom/tutors/${encodeURIComponent(tutorId)}` : '/api/classroom/tutors'
    api<Omit<Loaded, 'tutor'> & { tutor?: SavedTutor }>(url).then((r) => {
      if (gone) return
      if (!r.ok) return setFailed(r.error)
      const a = tutorId ? r.data.tutor ?? null : null
      setData({ ...r.data, tutor: a })
      setCustomStatus(a?.customStatus ?? 'none')
      setD({
        name: a?.name ?? r.data.defaults.name,
        bestFor: a?.bestFor ?? '',
        persona: a?.persona ?? '',
        greeting: a?.greeting ?? '',
        // Parsed here too: an avatar saved before a trait existed (the background) gets its default, shown as picked.
        traits: parseTraits(a?.traits ?? r.data.defaults.traits ?? DEFAULT_TRAITS),
        voice: a?.voice ?? r.data.defaults.voice,
        look: (a?.look as AvatarLook | undefined) ?? 'photo',
        // A new tutor starts on the first ready-made face: the preview shows a tutor at once, and the teacher changes it.
        libraryAvatarId: a ? a.libraryAvatarId : LIBRARY_AVATARS[0]?.id ?? null,
        ...(a ? {} : LIBRARY_AVATARS[0] ? { look: 'library' as const } : {}),
      })
    })
    return () => { gone = true }
  }, [user?.id, tutorId])

  if (loading) return <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
  if (!user) return <EmptyState icon={UserRound} title={tr('Sign in to make a tutor', 'Đăng nhập để tạo gia sư')} action={<Button variant="cta" className="min-h-11" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>} className="mt-12" />
  if (failed) return <EmptyState icon={UserRound} title={tr(refusalCopy(failed).en, refusalCopy(failed).vi)} className="mt-12" />
  if (!data || !d) return <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
  if (!tutorId && data.limit !== undefined && (data.tutors?.length ?? 0) >= data.limit) {
    return <EmptyState icon={UserRound} title={tr(refusalCopy('tutor_limit').en, refusalCopy('tutor_limit').vi)} className="mt-12"
      action={<Button variant="outline" className="min-h-11" onClick={() => router.push('/classroom')}>{tr('Your class', 'Lớp của bạn')}</Button>} />
  }

  const steps: WizardStep[] = [
    { key: 'look', icon: <Camera className="size-4" />, label: tr('Look', 'Diện mạo') },
    { key: 'voice', icon: <Volume2 className="size-4" />, label: tr('Voice', 'Giọng nói') },
    { key: 'character', icon: <Sparkles className="size-4" />, label: tr('Personality', 'Tính cách') },
  ]

  const save = async () => {
    setBusy(true)
    setError(null)
    const r = tutorId
      ? await api<{ tutor: { id: string } }>(`/api/classroom/tutors/${encodeURIComponent(tutorId)}`, { method: 'PUT', body: d })
      : await api<{ tutor: { id: string } }>('/api/classroom/tutors', { body: d })
    if (!r.ok) {
      setBusy(false)
      setError(r.error)
      if (['look_invalid'].includes(r.error)) setStep('look')
      else if (['voice_invalid'].includes(r.error)) setStep('voice')
      return
    }
    // Busy until the tutor's page takes over: a second tap must not make a second tutor.
    router.push(`/classroom/tutors/${encodeURIComponent(r.data.tutor.id)}`)
  }

  const next = async () => {
    setError(null)
    if (step === 'look') return setStep('voice')
    if (step === 'voice') return setStep('character')
    if (!d.name.trim()) return setError('name_required')
    await save()
  }

  return (
    <StepWizard
      steps={steps}
      current={step}
      onStepSelect={(key) => setStep(key)}
      header={(
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <h1 className="h-title self-start">{data.tutor ? tr('Edit tutor', 'Sửa gia sư') : tr('New tutor', 'Gia sư mới')}</h1>
          {/* The tutor as students will see it, on every step (plan: a live preview card). */}
          <TutorFace tutor={{ name: d.name, look: d.look, libraryAvatarId: d.libraryAvatarId, background: d.traits.background }} photoUrl={data.teacher.photoUrl} size="lg" className="max-w-32" />
          <p className="min-w-0 max-w-full truncate text-base font-bold text-ink">{d.name || tr('Your tutor', 'Gia sư của bạn')}</p>
        </div>
      )}
      primaryAction={{
        label: step === 'character' ? tr('Save', 'Lưu') : tr('Next', 'Tiếp'),
        onClick: () => { void next() },
        loading: busy,
      }}
      actionNote={error ? <span role="alert" className="text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</span> : null}
    >
      {step === 'look' && <LookStep d={d} setD={setD} photoUrl={data.teacher.photoUrl} customStatus={customStatus} setCustomStatus={setCustomStatus} />}
      {step === 'voice' && <VoiceStep d={d} setD={setD} />}
      {step === 'character' && <CharacterStep d={d} setD={setD} />}
    </StepWizard>
  )
}

function LookStep({ d, setD, photoUrl, customStatus, setCustomStatus }: {
  d: Draft; setD: (d: Draft) => void; photoUrl: string | null; customStatus: string; setCustomStatus: (s: string) => void
}) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ask = async () => {
    setBusy(true); setErr(null)
    const r = await api<{ customStatus: string }>('/api/classroom/avatar/photo', { body: { notice: PHOTO_NOTICE_VERSION } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setCustomStatus(r.data.customStatus)
  }
  const withdraw = async () => {
    setBusy(true); setErr(null)
    const r = await api<{ customStatus: string }>('/api/classroom/avatar/photo', { method: 'DELETE' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setCustomStatus(r.data.customStatus)
    if (d.look === 'custom') setD({ ...d, look: 'photo', libraryAvatarId: null })
  }
  // whitespace-normal: ui/button's base is nowrap, and a two-line label ran past the card at 390px.
  const option = (selected: boolean) => cn('press flex w-full items-center gap-4 whitespace-normal rounded-2xl p-3 text-left hover:bg-tint', selected && 'bg-accent')
  // The own-face section: offered while requests are open, and always shown to a teacher who already has a request or a
  // likeness, so they can still use or withdraw it (LIKENESS_REQUESTS_OPEN — closed for the MVP).
  const ownFace = LIKENESS_REQUESTS_OPEN || customStatus === 'requested' || customStatus === 'ready'
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-body">{tr('The face and the room your students see.', 'Khuôn mặt và căn phòng học viên nhìn thấy.')}</p>
      {LIBRARY_AVATARS.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">{tr('Ready-made 3D avatars', 'Avatar 3D có sẵn')}</p>
          <div className="grid grid-cols-3 gap-3">
            {LIBRARY_AVATARS.map((a) => (
              <Button variant="bare" size="none" key={a.id} aria-pressed={d.look === 'library' && d.libraryAvatarId === a.id}
                className={cn('press flex min-w-0 flex-col items-center gap-2 whitespace-normal rounded-2xl p-2 text-center hover:bg-tint', d.look === 'library' && d.libraryAvatarId === a.id && 'bg-accent')}
                onClick={() => setD({ ...d, look: 'library', libraryAvatarId: a.id })}>
                {/* Square at any width: a fixed 96px box was squeezed to 72×96 by the 3 columns of a 320px phone. */}
                <img src={a.preview} alt="" width={96} height={96} className="aspect-square h-auto w-full max-w-24 rounded-2xl object-cover" />
                <span className="text-xs text-ink-2">{tr(a.label.en, a.label.vi)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <Button variant="bare" size="none" aria-pressed={d.look === 'photo'} className={option(d.look === 'photo')} onClick={() => setD({ ...d, look: 'photo', libraryAvatarId: null })}>
        <Avatar name={d.name} url={photoUrl} size="xl" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{tr('Your profile photo', 'Ảnh hồ sơ của bạn')}</span>
          <span className="block text-xs text-ink-4">{tr('Your photo with a voice. Works on every phone.', 'Ảnh của bạn kèm giọng nói. Chạy trên mọi điện thoại.')}</span>
        </span>
        {d.look === 'photo' && <Check aria-hidden className="size-5 text-brand" />}
      </Button>
      {/* The room behind the avatar (owner, 2026-10-27: "so students feel like they are in classroom with teacher"). */}
      <div className="flex flex-col gap-2 border-t border-border pt-5">
        <p className="text-sm font-semibold text-ink">{tr('Background', 'Phông nền')}</p>
        <p className="text-xs text-ink-4">{tr('The room your students see behind the avatar.', 'Căn phòng học viên nhìn thấy phía sau avatar.')}</p>
        {/* ONE choice of seven — the ui/radio-group primitive (Base UI), not pressed buttons (review, opus). */}
        <RadioGroup value={d.traits.background} aria-label={tr('Background', 'Phông nền')} className="grid grid-cols-4 gap-2"
          onValueChange={(v) => { if (isBackground(v)) setD({ ...d, traits: { ...d.traits, background: v } }) }}>
          {BACKGROUNDS.map((b) => {
            const thumb = backgroundThumb(b)
            return (
              <Radio key={b} value={b}
                className={cn('flex min-w-0 flex-col items-center justify-start gap-1 whitespace-normal rounded-2xl p-1.5 text-center hover:bg-tint', d.traits.background === b && 'bg-accent')}>
                {thumb
                  ? <img src={thumb} alt="" width={72} height={126} loading="lazy" className="aspect-[4/7] h-auto w-full rounded-xl object-cover" />
                  : <span aria-hidden className="aspect-[4/7] w-full rounded-xl bg-brand-deeper" />}
                <span className="text-xs text-ink-2">{tr(BACKGROUND_LABEL[b].en, BACKGROUND_LABEL[b].vi)}</span>
              </Radio>
            )
          })}
        </RadioGroup>
      </div>
      {ownFace && <div className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink">{tr('Your own face in 3D', 'Khuôn mặt 3D của chính bạn')}</p>
          {customStatus === 'requested' && <Badge variant="warning" size="sm">{tr('Being made', 'Đang tạo')}</Badge>}
          {customStatus === 'ready' && <Badge variant="success" size="sm">{tr('Ready', 'Sẵn sàng')}</Badge>}
        </div>
        {customStatus === 'ready' && (
          <Button variant={d.look === 'custom' ? 'cta' : 'outline'} className="min-h-11" onClick={() => setD({ ...d, look: 'custom', libraryAvatarId: null })}>
            {d.look === 'custom' ? <><Check aria-hidden />{tr('Using your 3D face', 'Đang dùng khuôn mặt 3D')}</> : tr('Use my 3D face', 'Dùng khuôn mặt 3D')}
          </Button>
        )}
        {(customStatus === 'none' || customStatus === 'removed') && (
          <>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-body">
              {PHOTO_NOTICE.map((n) => <li key={n.en}>{tr(n.en, n.vi)}</li>)}
            </ul>
            <Button variant="outline" className="min-h-11 whitespace-normal" loading={busy} onClick={ask} disabled={!photoUrl}>{tr(PHOTO_ACTION.en, PHOTO_ACTION.vi)}</Button>
            {!photoUrl && <p className="text-xs text-ink-4">{tr('Add a photo to your teacher profile first.', 'Hãy thêm ảnh vào hồ sơ giáo viên trước.')}</p>}
          </>
        )}
        {customStatus === 'requested' && <p className="text-xs text-body">{tr('We make it by hand from your profile photo and tell you when it is ready. Your class uses your current look until then.', 'Chúng tôi tạo thủ công từ ảnh hồ sơ và báo bạn khi xong. Trong lúc chờ, lớp vẫn dùng diện mạo hiện tại.')}</p>}
        {(customStatus === 'requested' || customStatus === 'ready') && (
          <Button variant="ghost" className="-ml-3 min-h-11 self-start text-destructive" loading={busy} onClick={withdraw}>{tr('Remove my 3D face', 'Gỡ khuôn mặt 3D')}</Button>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(err).en, refusalCopy(err).vi)}</p>}
      </div>}
    </div>
  )
}

function CharacterStep({ d, setD }: { d: Draft; setD: (d: Draft) => void }) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The draft as it is NOW: the name, chips or first words changed while the AI was writing stay (C3b round 2, codex).
  const latest = useRef(d)
  latest.current = d
  const write = async () => {
    setBusy(true); setErr(null)
    const sent = { name: d.name, persona: d.persona, traits: JSON.stringify(d.traits) }
    const r = await api<{ persona: string; greeting: string }>('/api/classroom/avatar/persona-ai', { body: { notice: PERSONA_AI_NOTICE_VERSION, name: d.name, traits: d.traits, persona: d.persona } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    const now = latest.current
    // Written for a name, chips or a character the teacher has since changed (C3c reviews): it would introduce the old
    // name, contradict the new chips, or replace what they typed meanwhile — so it is not used, and they are told why.
    if (now.name !== sent.name || now.persona !== sent.persona || JSON.stringify(now.traits) !== sent.traits) return setErr('persona_stale')
    setD({ ...now, persona: r.data.persona, greeting: now.greeting || r.data.greeting })
  }
  const setTraits = (t: Partial<Traits>) => setD({ ...d, traits: { ...d.traits, ...t } })
  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('Tutor name', 'Tên gia sư')}</span>
        <Input value={d.name} maxLength={AVATAR_NAME_MAX} placeholder={tr('e.g. Ms Anna', 'VD: Ms Anna')} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <span className="text-xs text-ink-4">{tr('Students always see it as an AI avatar of you.', 'Học viên luôn thấy đây là avatar AI của bạn.')}</span>
      </label>
      {/* Praktika's "best for" line: which students this tutor suits — what a teacher reads when giving one to a student. */}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('Best for', 'Phù hợp với')}</span>
        <Input value={d.bestFor} maxLength={BEST_FOR_MAX} placeholder={tr('e.g. Shy beginners who need a calm pace', 'VD: Học viên mới, nhút nhát, cần nhịp chậm')} onChange={(e) => setD({ ...d, bestFor: e.target.value })} />
      </label>
      <Chips label={tr('Tone', 'Giọng điệu')}>
        <ToggleGroup<Tone> aria-label={tr('Tone', 'Giọng điệu')} value={[d.traits.tone]} onValueChange={(v) => v[0] && setTraits({ tone: v[0] })}>
          {TONES.map((t) => <ToggleGroupItem key={t} value={t}>{tr(TONE_LABEL[t].en, TONE_LABEL[t].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <Chips label={tr('Pace', 'Tốc độ')}>
        <ToggleGroup<Pace> aria-label={tr('Pace', 'Tốc độ')} value={[d.traits.pace]} onValueChange={(v) => v[0] && setTraits({ pace: v[0] })}>
          {PACES.map((p) => <ToggleGroupItem key={p} value={p}>{tr(PACE_LABEL[p].en, PACE_LABEL[p].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <Chips label={tr('Likes to talk about', 'Thích nói về')} hint={tr('Up to 5', 'Tối đa 5')}>
        <ToggleGroup<Topic> multiple aria-label={tr('Likes to talk about', 'Thích nói về')} value={d.traits.topics}
          onValueChange={(v) => setTraits({ topics: v.slice(0, MAX_TOPICS) })}>
          {TOPICS.map((t) => <ToggleGroupItem key={t} value={t}>{tr(TOPIC_LABEL[t].en, TOPIC_LABEL[t].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('Character', 'Tính cách')}</span>
        <Textarea value={d.persona} maxLength={PERSONA_MAX} rows={6}
          placeholder={tr('How does your avatar teach? e.g. “You are Anna, a patient teacher from Manchester who loves football…”', 'Avatar dạy thế nào? VD: “Bạn là Anna, giáo viên kiên nhẫn đến từ Manchester, yêu bóng đá…”')}
          onChange={(e) => setD({ ...d, persona: e.target.value })} />
        <Button variant="outline" loading={busy} onClick={write} className="min-h-11 self-start">
          <Sparkles aria-hidden />{tr(PERSONA_AI_ACTION.en, PERSONA_AI_ACTION.vi)}
        </Button>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-ink-4">
          {PERSONA_AI_NOTICE.map((n) => <li key={n.en}>{tr(n.en, n.vi)}</li>)}
        </ul>
        {err && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(err).en, refusalCopy(err).vi)}</p>}
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('First words to a new student', 'Câu chào học viên mới')}</span>
        <Input value={d.greeting} maxLength={200} placeholder={tr('e.g. Hi! I’m Ms Anna. What did you do today?', 'VD: Hi! I’m Ms Anna. What did you do today?')}
          onChange={(e) => setD({ ...d, greeting: e.target.value })} />
      </label>
    </div>
  )
}

function VoiceStep({ d, setD }: { d: Draft; setD: (d: Draft) => void }) {
  const { tr } = useLanguage()
  const audio = useRef<HTMLAudioElement | null>(null)
  /** The sample being heard and how far along it is: fetching its sound, or playing (owner, 2026-10-28: "play button
   *  doesnt show play state"). Tapping it again stops it; another voice's ▶ switches. */
  const [sample, setSample] = useState<{ id: string; state: 'loading' | 'playing' } | null>(null)
  const stop = () => { audio.current?.pause(); audio.current = null; setSample(null) }
  const play = (v: (typeof VOICES)[number]) => {
    if (sample?.id === v.id) { stop(); return }
    audio.current?.pause()
    // The sample made ONCE as a static file (voices.ts VOICE_SAMPLE_LINE — it starts at once; `v` keys it to the Soniox
    // voice, so a changed voice is never a stale cached file); the live route only when the file cannot be had.
    const a = new Audio(`/classroom/voices/${encodeURIComponent(v.id)}.mp3?v=${encodeURIComponent(v.soniox)}`)
    audio.current = a
    setSample({ id: v.id, state: 'loading' })
    const mine = () => audio.current === a
    a.onplaying = () => { if (mine()) setSample({ id: v.id, state: 'playing' }) }
    a.onended = () => { if (mine()) { audio.current = null; setSample(null) } }
    let fellBack = false
    a.onerror = () => {
      if (!mine()) return
      if (fellBack) { audio.current = null; setSample(null); return }
      fellBack = true
      a.src = `/api/classroom/voices/${encodeURIComponent(v.id)}/sample`
      void a.play().catch(() => { if (mine()) { audio.current = null; setSample(null) } })
    }
    void a.play().catch(() => { /* a load error is onerror's; a refused autoplay leaves the button ready again */ if (mine() && !fellBack && a.error === null) { audio.current = null; setSample(null) } })
  }
  // Leaving the step stops the sample FOR GOOD: no handler still owns it, so a late fallback never plays on a later step.
  useEffect(() => () => { audio.current?.pause(); audio.current = null }, [])
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-sm text-body">{tr('Pick the voice your avatar speaks with. Tap ▶ to listen.', 'Chọn giọng nói cho avatar. Chạm ▶ để nghe thử.')}</p>
      <ul className="divide-y divide-border border-y border-border">
        {VOICES.map((v) => (
          <li key={v.id} className={cn('flex items-center gap-2 py-1', d.voice === v.id && 'bg-accent')}>
            {/* The whole row picks the voice (a 48px target), ▶ beside it only plays — two thumb-size targets per row. */}
            <Button variant="bare" size="none" aria-pressed={d.voice === v.id} onClick={() => setD({ ...d, voice: v.id })} className="press flex min-h-12 min-w-0 flex-1 flex-wrap items-center justify-start gap-x-3 gap-y-0.5 whitespace-normal rounded-xl px-2 py-1 text-left">
              <span className="text-sm font-semibold text-ink">{v.name}</span>
              <span className="text-xs text-ink-4">{tr(ACCENT_LABEL[v.accent].en, ACCENT_LABEL[v.accent].vi)}</span>
              {v.note === 'young-learners' && <span className="text-xs text-ink-4">{tr('playful, for young learners', 'vui tươi, hợp với các em nhỏ')}</span>}
              {d.voice === v.id && <Check aria-hidden className="ml-auto size-5 text-brand" />}
            </Button>
            {/* ▶ → the house busy state while the sound loads (Button `loading`) → ❚❚ while it plays: tap to stop. */}
            <Button variant="ghost" size="icon" className="size-11" onClick={() => play(v)} aria-pressed={sample?.id === v.id && sample.state === 'playing'}
              loading={sample?.id === v.id && sample.state === 'loading'}
              aria-label={sample?.id === v.id && sample.state === 'playing' ? tr('Stop', 'Dừng') : tr('Listen', 'Nghe thử')}>
              {sample?.id === v.id && sample.state === 'playing' ? <Pause aria-hidden className="size-5 text-brand" /> : <Play aria-hidden className="size-5" />}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chips({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">{label}{hint && <span className="ml-2 text-xs font-normal text-ink-4">{hint}</span>}</span>
      {children}
    </div>
  )
}
