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
import { Camera, Check, Mic, Play, Sparkles, UserRound, Volume2 } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { LIBRARY_AVATARS } from '@/lib/classroom/library-avatars'
import { ACCENT_LABEL, VOICES } from '@/lib/classroom/voices'
import {
  AVATAR_NAME_MAX, DEFAULT_TRAITS, MAX_TOPICS, PACES, PACE_LABEL, PERSONA_MAX, TONES, TONE_LABEL, TOPICS, TOPIC_LABEL,
  type Pace, type Tone, type Topic, type Traits,
} from '@/lib/classroom/persona'
import { PERSONA_AI_ACTION, PERSONA_AI_NOTICE, PERSONA_AI_NOTICE_VERSION, PHOTO_ACTION, PHOTO_NOTICE, PHOTO_NOTICE_VERSION } from '@/lib/classroom/notices'
import type { AvatarLook } from '@/lib/classroom/constants'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { SessionLauncher } from './session-launcher'

type Loaded = {
  teacher: { fullName: string; photoUrl: string | null; nationality: string }
  avatar: null | { name: string; persona: string; greeting: string; traits: unknown; voice: string; look: string; libraryAvatarId: string | null; customStatus: string }
  defaults: { name: string; voice: string; traits: Traits }
}
type Draft = { name: string; persona: string; greeting: string; traits: Traits; voice: string; look: AvatarLook; libraryAvatarId: string | null }

/**
 * CREATE / EDIT THE AVATAR (plan "MVP scope › Teacher › 1"): Look → Character → Voice → Try it. Saved at the end of Voice
 * (one PUT — the API validates everything again); Try it runs a 3-minute test session as a student would hear it.
 */
export function AvatarWizard() {
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
    api<Loaded>('/api/classroom/avatar').then((r) => {
      if (gone) return
      if (!r.ok) return setFailed(r.error)
      setData(r.data)
      const a = r.data.avatar
      setCustomStatus(a?.customStatus ?? 'none')
      setD({
        name: a?.name ?? r.data.defaults.name,
        persona: a?.persona ?? '',
        greeting: a?.greeting ?? '',
        traits: (a?.traits as Traits | undefined) ?? r.data.defaults.traits ?? DEFAULT_TRAITS,
        voice: a?.voice ?? r.data.defaults.voice,
        look: (a?.look as AvatarLook | undefined) ?? 'photo',
        libraryAvatarId: a?.libraryAvatarId ?? null,
      })
    })
    return () => { gone = true }
  }, [user?.id])

  if (loading) return <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
  if (!user) return <EmptyState icon={UserRound} title={tr('Sign in to create your avatar', 'Đăng nhập để tạo avatar')} action={<Button variant="cta" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>} className="mt-12" />
  if (failed) return <EmptyState icon={UserRound} title={tr(refusalCopy(failed).en, refusalCopy(failed).vi)} className="mt-12" />
  if (!data || !d) return <Skeleton className="mt-4 h-64 w-full rounded-2xl" />

  const steps: WizardStep[] = [
    { key: 'look', icon: <Camera className="size-4" />, label: tr('Look', 'Diện mạo') },
    { key: 'character', icon: <Sparkles className="size-4" />, label: tr('Character', 'Tính cách') },
    { key: 'voice', icon: <Volume2 className="size-4" />, label: tr('Voice', 'Giọng nói') },
    { key: 'try', icon: <Mic className="size-4" />, label: tr('Try it', 'Thử ngay') },
  ]

  const save = async () => {
    setBusy(true)
    setError(null)
    const r = await api('/api/classroom/avatar', { method: 'PUT', body: d })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      if (['name_required', 'contact_in_text', 'banned_words'].includes(r.error)) setStep('character')
      return false
    }
    return true
  }

  const next = async () => {
    setError(null)
    if (step === 'look') return setStep('character')
    if (step === 'character') return d.name.trim() ? setStep('voice') : setError('name_required')
    if (step === 'voice') { if (await save()) setStep('try'); return }
    router.push('/classroom')
  }

  return (
    <StepWizard
      steps={steps}
      current={step}
      // StepWizard only offers steps already done (no `allowForward`), and "Try it" is reached through Save alone — this
      // guard just says so where a reader can see it.
      onStepSelect={(key) => { if (key !== 'try') setStep(key) }}
      header={<h1 className="h-title">{data.avatar ? tr('Your avatar', 'Avatar của bạn') : tr('Create your avatar', 'Tạo avatar của bạn')}</h1>}
      primaryAction={{
        label: step === 'voice' ? tr('Save', 'Lưu') : step === 'try' ? tr('Done', 'Xong') : tr('Next', 'Tiếp'),
        onClick: () => { void next() },
        loading: busy,
      }}
      actionNote={error ? <span role="alert" className="text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</span> : null}
    >
      {step === 'look' && <LookStep d={d} setD={setD} photoUrl={data.teacher.photoUrl} customStatus={customStatus} setCustomStatus={setCustomStatus} />}
      {step === 'character' && <CharacterStep d={d} setD={setD} />}
      {step === 'voice' && <VoiceStep d={d} setD={setD} />}
      {step === 'try' && <TryStep name={d.name} photoUrl={data.teacher.photoUrl} />}
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
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-body">{tr('How your students see the avatar.', 'Học viên sẽ thấy avatar như thế nào.')}</p>
      <Button variant="bare" size="none" aria-pressed={d.look === 'photo'} className={option(d.look === 'photo')} onClick={() => setD({ ...d, look: 'photo', libraryAvatarId: null })}>
        <Avatar name={d.name} url={photoUrl} size="xl" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{tr('Your profile photo', 'Ảnh hồ sơ của bạn')}</span>
          <span className="block text-xs text-ink-4">{tr('Your photo with a voice. Works on every phone.', 'Ảnh của bạn kèm giọng nói. Chạy trên mọi điện thoại.')}</span>
        </span>
        {d.look === 'photo' && <Check aria-hidden className="size-5 text-brand" />}
      </Button>
      {LIBRARY_AVATARS.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">{tr('Ready-made 3D avatars', 'Avatar 3D có sẵn')}</p>
          <div className="grid grid-cols-3 gap-3">
            {LIBRARY_AVATARS.map((a) => (
              <Button variant="bare" size="none" key={a.id} aria-pressed={d.look === 'library' && d.libraryAvatarId === a.id}
                className={cn('press flex min-w-0 flex-col items-center gap-2 whitespace-normal rounded-2xl p-2 text-center hover:bg-tint', d.look === 'library' && d.libraryAvatarId === a.id && 'bg-accent')}
                onClick={() => setD({ ...d, look: 'library', libraryAvatarId: a.id })}>
                <img src={a.preview} alt="" width={96} height={96} className="size-24 rounded-2xl object-cover" />
                <span className="text-xs text-ink-2">{tr(a.label.en, a.label.vi)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink">{tr('Your own face in 3D', 'Khuôn mặt 3D của chính bạn')}</p>
          {customStatus === 'requested' && <Badge variant="warning" size="sm">{tr('Being made', 'Đang tạo')}</Badge>}
          {customStatus === 'ready' && <Badge variant="success" size="sm">{tr('Ready', 'Sẵn sàng')}</Badge>}
        </div>
        {customStatus === 'ready' && (
          <Button variant={d.look === 'custom' ? 'cta' : 'outline'} onClick={() => setD({ ...d, look: 'custom', libraryAvatarId: null })}>
            {d.look === 'custom' ? <><Check aria-hidden />{tr('Using your 3D face', 'Đang dùng khuôn mặt 3D')}</> : tr('Use my 3D face', 'Dùng khuôn mặt 3D')}
          </Button>
        )}
        {(customStatus === 'none' || customStatus === 'removed') && (
          <>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-body">
              {PHOTO_NOTICE.map((n) => <li key={n.en}>{tr(n.en, n.vi)}</li>)}
            </ul>
            <Button variant="outline" loading={busy} onClick={ask} disabled={!photoUrl}>{tr(PHOTO_ACTION.en, PHOTO_ACTION.vi)}</Button>
            {!photoUrl && <p className="text-xs text-ink-4">{tr('Add a photo to your teacher profile first.', 'Hãy thêm ảnh vào hồ sơ giáo viên trước.')}</p>}
          </>
        )}
        {customStatus === 'requested' && <p className="text-xs text-body">{tr('We make it by hand from your profile photo and tell you when it is ready. Your class uses your current look until then.', 'Chúng tôi tạo thủ công từ ảnh hồ sơ và báo bạn khi xong. Trong lúc chờ, lớp vẫn dùng diện mạo hiện tại.')}</p>}
        {(customStatus === 'requested' || customStatus === 'ready') && (
          <Button variant="ghost" size="sm" className="self-start text-destructive" loading={busy} onClick={withdraw}>{tr('Remove my 3D face', 'Gỡ khuôn mặt 3D')}</Button>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(err).en, refusalCopy(err).vi)}</p>}
      </div>
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
    const sent = { name: d.name, persona: d.persona }
    const r = await api<{ persona: string; greeting: string }>('/api/classroom/avatar/persona-ai', { body: { notice: PERSONA_AI_NOTICE_VERSION, name: d.name, traits: d.traits, persona: d.persona } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    const now = latest.current
    // Written for a name or a character the teacher has since changed (C3c review): it would introduce the old name, or
    // replace what they typed meanwhile — so it is not used, and they are told why.
    if (now.name !== sent.name || now.persona !== sent.persona) return setErr('persona_stale')
    setD({ ...now, persona: r.data.persona, greeting: now.greeting || r.data.greeting })
  }
  const setTraits = (t: Partial<Traits>) => setD({ ...d, traits: { ...d.traits, ...t } })
  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('Avatar name', 'Tên avatar')}</span>
        <Input value={d.name} maxLength={AVATAR_NAME_MAX} placeholder={tr('e.g. Ms Anna', 'VD: Ms Anna')} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <span className="text-xs text-ink-4">{tr('Students always see it as an AI avatar of you.', 'Học viên luôn thấy đây là avatar AI của bạn.')}</span>
      </label>
      <Chips label={tr('Tone', 'Giọng điệu')}>
        <ToggleGroup<Tone> aria-label={tr('Tone', 'Giọng điệu')} value={[d.traits.tone]} onValueChange={(v) => v[0] && setTraits({ tone: v[0] })}>
          {TONES.map((t) => <ToggleGroupItem key={t} value={t} size="sm">{tr(TONE_LABEL[t].en, TONE_LABEL[t].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <Chips label={tr('Pace', 'Tốc độ')}>
        <ToggleGroup<Pace> aria-label={tr('Pace', 'Tốc độ')} value={[d.traits.pace]} onValueChange={(v) => v[0] && setTraits({ pace: v[0] })}>
          {PACES.map((p) => <ToggleGroupItem key={p} value={p} size="sm">{tr(PACE_LABEL[p].en, PACE_LABEL[p].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <Chips label={tr('Likes to talk about', 'Thích nói về')} hint={tr('Up to 5', 'Tối đa 5')}>
        <ToggleGroup<Topic> multiple aria-label={tr('Likes to talk about', 'Thích nói về')} value={d.traits.topics}
          onValueChange={(v) => setTraits({ topics: v.slice(0, MAX_TOPICS) })}>
          {TOPICS.map((t) => <ToggleGroupItem key={t} value={t} size="sm">{tr(TOPIC_LABEL[t].en, TOPIC_LABEL[t].vi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Chips>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">{tr('Character', 'Tính cách')}</span>
        <Textarea value={d.persona} maxLength={PERSONA_MAX} rows={6}
          placeholder={tr('How does your avatar teach? e.g. “You are Anna, a patient teacher from Manchester who loves football…”', 'Avatar dạy thế nào? VD: “Bạn là Anna, giáo viên kiên nhẫn đến từ Manchester, yêu bóng đá…”')}
          onChange={(e) => setD({ ...d, persona: e.target.value })} />
        <Button variant="outline" loading={busy} onClick={write} className="self-start">
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
  const [playing, setPlaying] = useState<string | null>(null)
  const play = (id: string) => {
    audio.current?.pause()
    const a = new Audio(`/api/classroom/voices/${encodeURIComponent(id)}/sample`)
    audio.current = a
    setPlaying(id)
    a.onended = () => setPlaying(null)
    a.onerror = () => setPlaying(null)
    void a.play().catch(() => setPlaying(null))
  }
  useEffect(() => () => audio.current?.pause(), [])
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-sm text-body">{tr('Pick the voice your avatar speaks with. Tap ▶ to listen.', 'Chọn giọng nói cho avatar. Chạm ▶ để nghe thử.')}</p>
      <ul className="divide-y divide-border border-y border-border">
        {VOICES.map((v) => (
          <li key={v.id} className={cn('flex items-center gap-3 py-2', d.voice === v.id && 'bg-accent')}>
            <Button variant="bare" size="none" aria-pressed={d.voice === v.id} onClick={() => setD({ ...d, voice: v.id })} className="press flex min-w-0 flex-1 items-center justify-start gap-3 whitespace-normal rounded-xl px-2 py-1 text-left">
              <span className="text-sm font-semibold text-ink">{v.name}</span>
              <span className="text-xs text-ink-4">{tr(ACCENT_LABEL[v.accent].en, ACCENT_LABEL[v.accent].vi)}</span>
              {d.voice === v.id && <Check aria-hidden className="ml-auto size-5 text-brand" />}
            </Button>
            <Button variant="ghost" size="icon" aria-label={tr('Listen', 'Nghe thử')} onClick={() => play(v.id)} disabled={playing === v.id}>
              <Play aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TryStep({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const { tr } = useLanguage()
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <Avatar name={name} url={photoUrl} size="2xl" />
      <p className="text-lg font-bold text-ink">{tr('Saved! Try your avatar', 'Đã lưu! Thử avatar của bạn')}</p>
      <p className="max-w-sm text-sm text-body">{tr('A 3-minute session, exactly as a student hears it. You get a report too.', 'Một buổi 3 phút, đúng như học viên trải nghiệm. Bạn cũng nhận được nhận xét.')}</p>
      <SessionLauncher test preview={{ name, photoUrl }} variant="cta" size="lg" label={<><Mic aria-hidden />{tr('Try it now', 'Thử ngay')}</>} />
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
