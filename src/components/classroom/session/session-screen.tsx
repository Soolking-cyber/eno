'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { CircleHelp, Mic, MessageSquareText, PhoneOff } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { hapticTap } from '@/lib/haptics'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import type { StartedSession } from '@/lib/classroom/session-start'
import { dayName, refusalCopy } from '../classroom-copy'
import { AvatarStage, type StageHandle } from './avatar-stage'
import { decodeLine, playLine } from './voice'
import { useRecorder } from './use-recorder'

type Phase = 'intro' | 'speaking' | 'ready' | 'listening' | 'thinking' | 'ending' | 'mic_denied'
type TurnAnswer = { kind: 'silence' } | { kind: 'reply'; learnerText: string; reply: string; hint: string; hintVi: string; audio: string | null; secondsLeft: number }

const turnId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

/**
 * THE PRACTICE SESSION (plan "MVP scope › Learner › 3"): the avatar fills a dark screen; a thin countdown at the top;
 * captions you can hide; Hint · Mic · End at the bottom. TAP TO TALK — tap, speak, tap again (learners pause mid-sentence;
 * a silence detector cuts them off). Tapping the mic while the avatar talks interrupts it.
 * A Base UI Dialog, full-screen, dark in both themes (`brand-deeper`) like the call screen (src/components/calls).
 */
export function SessionScreen({ seatId, test, preview, onClose }: {
  /** A learner's seat — or `test` for a teacher trying their own avatar. */
  seatId?: string
  test?: boolean
  /** Shown before the session exists: the avatar's name and the teacher's photo. */
  preview: { name: string; photoUrl: string | null }
  onClose: () => void
}) {
  const { tr, lang } = useLanguage()
  const router = useRouter()
  // ⛔ THE SESSION STARTS ON THE START TAP, NOT WHEN THIS SCREEN OPENS: "Not now" must never spend the day's session or
  // reserve minutes (session-start.ts counts every start).
  const [start, setStart] = useState<StartedSession | null>(null)
  const [refused, setRefused] = useState<{ code: string; nextAt?: string } | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [mode, setMode] = useState<'avatar' | 'voice'>('voice')
  const [captions, setCaptions] = useState(true)
  const [avatarLine, setAvatarLine] = useState('')
  const [learnerLine, setLearnerLine] = useState('')
  const [hint, setHint] = useState<{ en: string; vi: string } | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const total = useRef(1)
  const ctxRef = useRef<AudioContext | null>(null)
  const stage = useRef<StageHandle>(null)
  const stopVoice = useRef<(() => void) | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /**
   * ⛔ ONCE ENDED, NOTHING EARLIER MAY SPEAK OR RE-ARM THE MIC (C3a review, codex): a turn still in flight when End was
   * tapped used to land afterwards — play its reply and set the phase back to 'ready' (End live again, the recorder gone).
   * End aborts that request, and every await below checks this before touching the screen.
   */
  const ended = useRef(false)
  const turnAbort = useRef<AbortController | null>(null)

  const sendTurn = useRef<(wav: Uint8Array) => void>(() => {})
  const rec = useRecorder((wav) => sendTurn.current(wav))
  const releaseRec = rec.release

  // ── the avatar speaks one line (decoded once; AvatarKit plays it in avatar mode, the page plays it otherwise) ──
  const speak = useCallback(async (audio: string | null) => {
    const ctx = ctxRef.current
    if (ended.current) return
    if (!audio || !ctx) { setPhase('ready'); return }
    try {
      const buffer = await decodeLine(ctx, audio)
      if (ended.current) return
      setPhase('speaking')
      if (stage.current?.speak(buffer)) return // AvatarKit reports the end through onPlaying(false)
      const p = playLine(ctx, buffer)
      stopVoice.current = p.stop
      await p.done
      stopVoice.current = null
      if (!ended.current && phaseRef.current === 'speaking') setPhase('ready')
    } catch {
      if (!ended.current) setPhase('ready')
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    stopVoice.current?.()
    stopVoice.current = null
    stage.current?.interrupt()
  }, [])

  /**
   * ⛔ HOWEVER THIS SCREEN CLOSES — End, "Not now", a refused start, navigating away — the microphone and the audio
   * context go with it (C3a review, codex + Opus: a refused start left the mic indicator on behind the refusal, and the
   * context was only ever closed on a successful End; iOS caps how many a page may hold).
   */
  const releaseAll = useCallback(() => {
    turnAbort.current?.abort()
    turnAbort.current = null
    stopSpeaking()
    releaseRec()
    const ctx = ctxRef.current
    ctxRef.current = null
    void ctx?.close().catch(() => {})
  }, [releaseRec, stopSpeaking])
  useEffect(() => releaseAll, [releaseAll])

  const end = useCallback(async (reason: 'learner' | 'time') => {
    if (ended.current) return
    // No session yet (the mic was refused, or Start was never tapped): End simply closes the screen.
    if (!start) { ended.current = true; releaseAll(); onClose(); return }
    ended.current = true
    setPhase('ending')
    releaseAll()
    await fetch(`/api/classroom/sessions/${start.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) }).catch(() => {})
    router.push(`/classroom/reports/${start.id}`)
    onClose()
  }, [onClose, releaseAll, router, start])

  const close = () => { ended.current = true; releaseAll(); onClose() }

  sendTurn.current = async (wav: Uint8Array) => {
    if (!start || ended.current) return
    setPhase('thinking')
    setShowHint(false)
    const abort = new AbortController()
    turnAbort.current = abort
    let res: Response
    try {
      res = await fetch(`/api/classroom/sessions/${start.id}/turns`, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-turn-id': turnId() }, body: new Blob([new Uint8Array(wav)]), signal: abort.signal })
    } catch {
      if (ended.current) return
      setNotice('network')
      setPhase('ready')
      return
    }
    const body = (await res.json().catch(() => ({}))) as TurnAnswer & { error?: string }
    if (ended.current) return
    if (!res.ok) {
      if (body.error === 'session_over' || body.error === 'turn_cap') return void end('time')
      setNotice(body.error ?? 'unknown')
      setPhase('ready')
      return
    }
    if (body.kind === 'silence') {
      setNotice('silence')
      setPhase('ready')
      return
    }
    setLearnerLine(body.learnerText)
    setAvatarLine(body.reply)
    setHint(body.hint ? { en: body.hint, vi: body.hintVi } : null)
    setLeft(body.secondsLeft)
    await speak(body.audio)
  }

  // ── the clock: the server's deadline is the truth; the page ends the session when it runs out ──
  useEffect(() => {
    if (!start) return
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((Date.parse(start.endsAt) - Date.now()) / 1000))
      setLeft(s)
      if (s === 0 && phaseRef.current !== 'thinking') void end('time')
    }, 1000)
    return () => clearInterval(t)
  }, [end, start])

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t) }, [notice])

  /**
   * The first tap: audio and the microphone both need a user gesture (iOS) — then the session is started (or resumed: the
   * server returns a live one), then the opening line.
   */
  const begin = async () => {
    hapticTap()
    setRefused(null)
    ended.current = false
    const ctx = ctxRef.current ?? new AudioContext()
    ctxRef.current = ctx
    try {
      await ctx.resume()
      await rec.prepare(ctx)
    } catch {
      releaseAll()
      setPhase('mic_denied')
      return
    }
    setPhase('thinking')
    const r = await fetch('/api/classroom/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(test ? { test: true } : { seatId }) }).catch(() => null)
    const body = (await r?.json().catch(() => ({}))) as { session?: StartedSession; error?: string; nextAt?: string }
    if (ended.current) return
    if (!r?.ok || !body.session) {
      // Refused (a limit, the budget, the switch): the mic and the audio context go back now — the next Start asks again.
      releaseAll()
      setRefused({ code: body?.error ?? 'network', nextAt: body?.nextAt })
      setPhase('intro')
      return
    }
    const s = body.session
    total.current = Math.max(1, Math.round((Date.parse(s.endsAt) - Date.now()) / 1000))
    setLeft(total.current)
    setMode(s.mode)
    setAvatarLine(s.opening.text)
    setStart(s)
    await speak(s.opening.audio)
  }

  const onMic = () => {
    hapticTap()
    // AvatarKit's audio may only start inside a user gesture (its own docs; iOS keeps it silent otherwise): the first mic
    // tap after the face has loaded is that gesture. Until then the page itself plays the avatar's voice.
    stage.current?.unlock()
    if (phase === 'speaking') { stopSpeaking(); rec.start(); setPhase('listening'); return }
    if (phase === 'ready') { rec.start(); setPhase('listening'); return }
    if (phase === 'listening') void sendTurn.current(rec.stop())
  }

  const minutes = Math.floor(left / 60)
  const secs = String(left % 60).padStart(2, '0')
  const micLabel = phase === 'listening' ? tr('Tap to send', 'Chạm để gửi')
    : phase === 'thinking' ? tr('Thinking…', 'Đang nghĩ…')
      : phase === 'speaking' ? tr('Tap to interrupt', 'Chạm để ngắt lời')
        : tr('Tap to talk', 'Chạm để nói')
  const notes: Record<string, { en: string; vi: string }> = {
    silence: { en: 'I didn’t hear anything. Tap the mic and speak a bit louder.', vi: 'Chưa nghe thấy gì. Chạm micro và nói to hơn một chút nhé.' },
  }
  const note = notice ? (notes[notice] ?? refusalCopy(notice)) : null

  return (
    <Dialog open onOpenChange={() => { /* only End closes a session */ }}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-brand-deeper p-0 text-primary-foreground sm:max-w-none"
      >
        <DialogTitle className="sr-only">{tr('Speaking practice', 'Luyện nói')}</DialogTitle>
        <DialogDescription className="sr-only">{preview.name}</DialogDescription>
        <div className="flex h-full flex-col">
          <header className="flex flex-col gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <Progress tone="onDark" value={total.current - left} max={total.current}
              aria-label={tr('Time', 'Thời gian')} valueText={`${minutes}:${secs}`} />
            <div className="flex items-center justify-between text-xs text-primary-foreground/70">
              <span className="truncate">{preview.name} · {tr('AI avatar', 'Avatar AI')}</span>
              <span className="tabular-nums" aria-hidden>{minutes}:{secs}</span>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            <AvatarStage
              ref={stage}
              mode={start ? mode : 'voice'}
              sessionId={start?.id ?? ''}
              spatiusAvatarId={start?.avatar.spatiusAvatarId ?? null}
              photoUrl={start?.avatar.photoUrl ?? preview.photoUrl}
              name={start?.avatar.name ?? preview.name}
              speaking={phase === 'speaking'}
              sampleRate={ctxRef.current?.sampleRate ?? 48_000}
              onFallback={() => setMode('voice')}
              onPlaying={(on) => { if (!on && phaseRef.current === 'speaking') setPhase('ready') }}
            />
            {phase === 'intro' && (
              <div className="absolute inset-0 flex flex-col items-center justify-end gap-4 bg-brand-deeper/60 p-6 pb-10 text-center">
                <p className="max-w-xs text-base">{tr('Find a quiet place, then tap Start. Tap the mic each time you speak.', 'Hãy tìm chỗ yên tĩnh rồi chạm Bắt đầu. Mỗi lần nói, hãy chạm micro.')}</p>
                {refused && (
                  <p role="alert" className="max-w-xs text-sm text-primary-foreground/80">
                    {tr(refusalCopy(refused.code).en, refusalCopy(refused.code).vi)}
                    {/* The day practice opens again (C3a review: dayName was written for this and never used). */}
                    {refused.nextAt && dayName(refused.nextAt, lang) && (
                      <> {tr('You can practise again on {day}.', 'Bạn có thể luyện tập lại vào {day}.').replace('{day}', dayName(refused.nextAt, lang))}</>
                    )}
                  </p>
                )}
                {!refused?.nextAt && <Button variant="cta" size="lg" className="w-full max-w-xs" onClick={begin}>{tr('Start', 'Bắt đầu')}</Button>}
                <Button variant="ghost" size="sm" className="text-primary-foreground/80" onClick={close}>{tr('Not now', 'Để sau')}</Button>
              </div>
            )}
            {phase === 'mic_denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-brand-deeper/80 p-6 text-center">
                <p className="max-w-xs text-base font-semibold">{tr('The microphone is blocked', 'Micro đang bị chặn')}</p>
                <p className="max-w-xs text-sm text-primary-foreground/80">{tr('Allow the microphone for this site in your browser settings, then try again. In Zalo or Facebook, open the link in Safari or Chrome.', 'Hãy cho phép micro cho trang này trong cài đặt trình duyệt rồi thử lại. Nếu đang ở Zalo hoặc Facebook, hãy mở link bằng Safari hoặc Chrome.')}</p>
                <Button variant="cta" onClick={() => { setPhase('intro') }}>{tr('Try again', 'Thử lại')}</Button>
                <Button variant="ghost" size="sm" className="text-primary-foreground/80" onClick={close}>{tr('Not now', 'Để sau')}</Button>
              </div>
            )}
          </div>

          {captions && phase !== 'intro' && (
            <div className="flex flex-col gap-2 px-5 pb-3" aria-live="polite">
              {learnerLine && <p className="self-end rounded-2xl bg-primary-foreground/10 px-4 py-2 text-sm text-primary-foreground/80">{learnerLine}</p>}
              {avatarLine && <p className="text-base leading-relaxed">{avatarLine}</p>}
            </div>
          )}
          {showHint && hint && (
            <div className="mx-5 mb-3 rounded-2xl bg-primary-foreground/10 px-4 py-3 text-sm">
              <p>{hint.en}</p>
              {hint.vi && <p lang="vi" className="mt-1 text-primary-foreground/70">{hint.vi}</p>}
            </div>
          )}
          {note && <p role="status" className="mx-5 mb-3 text-center text-sm text-primary-foreground/80">{tr(note.en, note.vi)}</p>}

          <footer className="flex items-center justify-around gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
            <div className="flex w-16 flex-col items-center gap-1">
              {/* Pressed = a light fill + the bold glyph in the button's own white (`icon-own-ink`): the house accent-blue
                  pressed glyph all but vanished on this dark screen (the 390px check). */}
              <IconButton size="lg" aria-pressed={showHint} aria-label={tr('Hint', 'Gợi ý')} disabled={!hint || phase === 'intro'} onClick={() => setShowHint((v) => !v)}
                className="icon-own-ink text-primary-foreground hover:bg-primary-foreground/10 aria-pressed:bg-primary-foreground/20">
                <CircleHelp className="size-6" />
              </IconButton>
              <IconButton size="lg" aria-pressed={captions} aria-label={tr('Captions', 'Phụ đề')} onClick={() => setCaptions((v) => !v)}
                className="icon-own-ink text-primary-foreground hover:bg-primary-foreground/10 aria-pressed:bg-primary-foreground/20">
                <MessageSquareText className="size-6" />
              </IconButton>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Button
                size="none"
                variant="bare"
                onClick={onMic}
                disabled={phase === 'intro' || phase === 'thinking' || phase === 'ending' || phase === 'mic_denied'}
                aria-label={micLabel}
                aria-pressed={phase === 'listening'}
                className={cn(
                  'size-20 rounded-full bg-primary-foreground text-brand-deeper disabled:opacity-50',
                  phase === 'listening' && 'animate-pulse',
                )}
              >
                <Mic className="size-9" strokeWidth={STROKE_UI} />
              </Button>
              <span className="text-xs text-primary-foreground/80" aria-hidden>{micLabel}</span>
            </div>
            <div className="flex w-16 flex-col items-center gap-1">
              <IconButton size="lg" aria-label={tr('End', 'Kết thúc')} onClick={() => void end('learner')} disabled={phase === 'ending'}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                <PhoneOff className="size-6" />
              </IconButton>
              <span className="text-xs text-primary-foreground/80" aria-hidden>{tr('End', 'Kết thúc')}</span>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
