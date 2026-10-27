'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { CircleHelp, Mic, MicOff, MessageSquareText, PhoneOff } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { hapticTap } from '@/lib/haptics'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import type { StartedSession } from '@/lib/classroom/session-start'
import type { AgeBand } from '@/lib/classroom/limits'
import { dayName, refusalCopy } from '../classroom-copy'
import { AvatarStage, FACE_RATE, audioNeedsGesture, type FaceConfig, type StageHandle } from './avatar-stage'
import { bufferFromPcm16, decodeLine, partPlayer, pcmFromBase64, resamplePcm16 } from './voice'
import { useRecorder } from './use-recorder'
import { isFiller, openLiveStt, type LiveStt } from './live-stt'
import { streamTo16k } from '@/lib/classroom/wav'
import { beginTrace, formatMark, mark, traceVisible, useTrace } from './trace'

/**
 * intro (the face draws; Start waits for it) → (Start) connecting (the face connects; the opening waits for it) → speaking
 * → listening ⇄ hearing → thinking → speaking → listening …
 * `hearing` = the learner is talking (the detector heard speech start); `listening` = waiting for them to.
 */
type Phase = 'intro' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ending' | 'mic_denied'

/**
 * One line of the turn route's answer (application/x-ndjson; a plain JSON answer is read as the same shape). Streamed
 * turns: `heard` (the learner's words), then per sentence `say` + its voice as raw `pcm` frames + `part-end`, then
 * `reply` (the saved turn: hint, time left) and `end`. Part-by-part MP3 (`audio`) is the older shape, still read.
 */
type TurnLine =
  | { kind: 'silence' }
  | { kind: 'heard'; learnerText: string }
  | { kind: 'say'; part: number; text: string }
  | { kind: 'pcm'; part: number; rate: number; data: string }
  | { kind: 'part-end'; part: number; last: boolean }
  | { kind: 'drill'; expect: string }
  | { kind: 'reply'; learnerText: string; reply: string; hint: string; hintVi: string; secondsLeft: number; expect?: string | null; parts?: number; audio?: string | null }
  | { kind: 'audio'; part: number; audio: string }
  | { kind: 'audio-failed'; part: number }
  | { kind: 'error'; error: string }
  | { kind: 'no-drill' }
  | { kind: 'end' }

/**
 * How long the page waits for one turn's answer: the turn route may run 40 s (its maxDuration) plus the trip. Past this
 * the request is dropped like a network failure, so a turn that never answers cannot hold the screen past the deadline
 * (C3a round 2, codex: the clock waits while 'thinking').
 */
const TURN_WAIT_MS = 50_000

/**
 * The silence that ends the learner's turn. Long on purpose — learners stop mid-sentence to find a word — and longer for
 * the young (src/components/classroom/session/use-recorder.ts says why).
 */
const PATIENCE_MS: Record<AgeBand, number> = { 'child-young': 1800, child: 1600, teen: 1300, adult: 1200 }

/** The learner may talk over the avatar (it stops, like a person). The detector is stricter while the avatar talks. */
const BARGE_IN = true

/** Past a reply's own length, how long its end may take to be reported (the face starts ~1–2 s late) before the
 *  learner's turn comes back anyway. */
const REPLY_GRACE_MS = 5_000

/**
 * ⚡ ALL AT ONCE (owner, 2026-10-26: "make sure all ai avatar voice etc loads at once when its ready now voice loads first
 * avatar is not there bad experience"). The face is DRAWN while the intro is up and Start waits for it — at most this long,
 * then the session is voice-only — so its 11–20 s first draw (measured on the owner's loaded Mac) never runs on the
 * session's clock.
 */
const FACE_PREP_MS = 20_000
/** How long the question "is there a face for this learner?" may take (api/classroom/face; ~50 ms measured). */
const FACE_ASK_MS = 6_000
/** After the session exists, how long the drawn face may take to connect (its token, its websocket: ~1 s measured). */
const FACE_CONNECT_MS = 8_000
/** Handed the opening, how long the face may take to START it (its motion comes ~1.3–1.6 s after its audio, measured)
 *  before it is cut and the speakers say it. */
const OPENING_PLAY_MS = 5_000
/** A reply handed to the face can be talked over once it sounds (onPlaying) — or after this long whatever the face says
 *  (2026-10-26 review round 2, opus: a reply the face never starts must not be beyond the learner's reach). */
const FACE_TALKOVER_GRACE_MS = 3_000

/** The reply being played: which one, its parts, how many reached the face or the speakers, whether the last did, whether
 *  the face has started playing it, and how much audio it holds since when (the watchdog's clock). */
const freshReply = (id: number) => ({ id, parts: 0, given: 0, lastGiven: false, played: false, audioMs: 0, startedAt: 0, toFace: false, armed: false })

/** Live listening sends the learner's speech ~100 ms at a time (16 kHz samples). */
const LIVE_CHUNK = 1_600
/** After the detector heard the learner stop, how long Soniox's words may take before the clip goes the old way. */
const LIVE_WORDS_MS = 3_000
/** The longest transcript sent (the server takes the same: session-turn.ts LIVE_TEXT_MAX). */
const LIVE_TEXT_MAX_CHARS = 1_000
/**
 * Listening live, the page's own silence timer waits this long past Soniox's cap before it ends the turn itself. For a teen
 * or an adult 200 ms (was 600 — owner, 2026-10-27: "need super fast response"): measured, Soniox's own end came 1.4–2.2 s
 * after the speech in a noisy room when it had made up a last word ("…yesterday and") — the page's finalize ends those
 * sooner, without it. A child keeps 600 (2026-10-27 review, opus): the young pause longest to find a word.
 */
const LIVE_BACKSTOP_MS: Record<AgeBand, number> = { 'child-young': 600, child: 600, teen: 200, adult: 200 }
/** A 16 kHz mic chunk louder than this (RMS) is the learner's voice — for the trace's "words came N ms after the voice". */
const VOICE_RMS = 0.012

/** The learner's words for the `x-transcript` header: UTF-8 in base64url (a header carries no raw UTF-8). */
function base64url(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The previous turn is still being saved (talked over before its reply was written — or, since the reply's voice closes
 * before its save (2026-10-27), answered quickly): the same upload is sent again after a moment, up to this many times
 * (~15 s in all), rather than losing what the learner said. The first waits are short — the save is usually a few hundred
 * ms away — then they grow to 1.25 s: every try counts against the turn route's hourly limit (2026-10-27 review, opus).
 */
const BUSY_RETRIES = 15
const busyWaitMs = (tries: number) => Math.min(1_250, Math.round(150 * 1.6 ** tries))

const turnId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

/**
 * THE PRACTICE SESSION — LIKE A VIDEO CALL WITH THE TEACHER (owner, 2026-10-26: "there shouldnt be a tap to speak button
 * once all loaded show avatar and student can talk directly like in a video call"). One Start tap; then the learner just
 * talks: the microphone listens hands-free, a turn ends when they stop (patiently — PATIENCE_MS), the avatar answers
 * sentence by sentence as the server makes it, and talking over the avatar stops it. Mute and End, like a call.
 * MOBILE-FIRST: a phone-width column (the dark screen fills the window around it on a desktop).
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
  const [muted, setMuted] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [avatarLine, setAvatarLine] = useState('')
  const [learnerLine, setLearnerLine] = useState('')
  const [hint, setHint] = useState<{ en: string; vi: string } | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The 3D face a start would give (api/classroom/face), drawn while the intro is up — null: voice-only. */
  const [face, setFace] = useState<FaceConfig | null>(null)
  const faceRef = useRef<FaceConfig | null>(null)
  /** Start waits for the face: 'asking' (is there one?) → 'drawing' → 'ready' (drawn — or voice-only). */
  const [prep, setPrep] = useState<'asking' | 'drawing' | 'ready'>('asking')
  /** From Start until the avatar's first words SOUND: "Connecting…", no captions — the face and its voice begin together. */
  const [waiting, setWaiting] = useState(false)
  const [left, setLeft] = useState(0)
  const [showTrace] = useState(traceVisible)
  const trace = useTrace()
  const total = useRef(1)
  const startRef = useRef<StartedSession | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const player = useRef<ReturnType<typeof partPlayer> | null>(null)
  const stage = useRef<StageHandle>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /**
   * Every phase change goes through here: the ref moves AT ONCE, not at the next render. The detector, the turn's stream and
   * the face all read it from callbacks — talked over, the aborted stream's error must already see 'hearing', or it would
   * pull the screen back to 'listening' over the learner's own turn.
   */
  const go = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p) }, [])
  const modeRef = useRef(mode)
  modeRef.current = mode
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  /** The opening line's audio, held until the face can say it (decoded once). */
  const opening = useRef<AudioBuffer | null>(null)
  /**
   * The current reply: how many parts it has, how many reached the face or the speakers, whether the last one did, and
   * whether the face has started playing it. ⛔ The face reports 'idle' the moment a reply is handed over, BEFORE it
   * plays (measured 2026-10-26) — only an idle AFTER 'playing' means the reply is over.
   */
  const reply = useRef(freshReply(0))
  /**
   * ⛔ ONCE ENDED, NOTHING EARLIER MAY SPEAK OR RE-ARM THE MIC (C3a review, codex): a turn still in flight when End was
   * tapped used to land afterwards — play its reply and set the phase back. End aborts that request, and every await
   * below checks this before touching the screen.
   */
  const ended = useRef(false)
  const turnAbort = useRef<AbortController | null>(null)
  /** Live listening for this session once its socket is open (live-stt.ts) — null: each turn's clip goes whole. */
  const liveStt = useRef<LiveStt | null>(null)
  /** The current utterance's stream to 16 kHz, and its samples not yet sent (~100 ms at a time). */
  const to16k = useRef<((f: Float32Array) => Int16Array) | null>(null)
  const pending16k = useRef<Int16Array[]>([])
  /** The clip the 45 s cap took while live listening still owed the words. */
  const pendingClip = useRef<Uint8Array | null>(null)
  /** The learner stopped and Soniox owes the words: after LIVE_WORDS_MS without them, the clip goes the old way. */
  const awaitingWords = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The current utterance is streaming live (it began after live listening opened). */
  const liveUtterance = useRef(false)
  /** The detector has heard the learner stop (a silence of its patience) during the current utterance. */
  const vadEnded = useRef(false)
  /** Words Soniox ended early on (a lone filler while the learner still spoke): they lead the utterance's next words. */
  const held = useRef({ text: '', ms: 0 })
  /**
   * WHICH TURN THE PAGE IS ON (2026-10-26 review round 2, codex): everything a turn schedules — its lines, its decoded
   * parts, its close — checks this first, so a talked-over turn's late callbacks can never touch the next one.
   */
  const turnGen = useRef(0)
  /** The face can take replies (its audio started). A reply goes to the face only if it was live when the reply BEGAN. */
  const faceLive = useRef(false)
  /** The face was given up for this screen (failed, too slow, not this session's): voice-only from here on. */
  const faceGone = useRef(false)
  /** The opening was said (by the face or the speakers): sayOpening runs once. */
  const openingSaid = useRef(false)
  /** The opening handed to the face and not yet sounding — its one owner until it starts (sayOpening). */
  const openingAtFace = useRef<{ id: number; buffer: AudioBuffer; timer: ReturnType<typeof setTimeout> } | null>(null)
  /** The sentence the last reply asked to be repeated: the next turn sends its clip too, for Azure to score. */
  const lastExpect = useRef<string | null>(null)
  /** When the learner's voice was last heard in the mic (live listening) — the trace's endpoint delay. */
  const lastVoiceAt = useRef(0)
  /** A Start under way (begin): the ref guards synchronously, the state disables the button. */
  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)

  const handlers = useRef({
    speechStart: () => {}, speechEnd: () => {}, autoStop: (_wav: Uint8Array) => {}, frames: (_f: Float32Array) => {},
    utterance: (_text: string, _ms: number) => {}, liveFailed: () => {},
  })
  const rec = useRecorder({
    speechStart: () => handlers.current.speechStart(),
    speechEnd: () => handlers.current.speechEnd(),
    autoStop: (wav) => handlers.current.autoStop(wav),
    frames: (f) => handlers.current.frames(f),
  })
  const releaseRec = rec.release

  /** The face is given up for the rest of this screen: voice-only (the photo), nothing more from Spatius. */
  const dropFace = useCallback(() => {
    faceGone.current = true
    faceLive.current = false
    modeRef.current = 'voice'
    setMode('voice')
    setPrep('ready')
  }, [])

  // ⚡ The face a start would give is asked for at once and DRAWN while the intro is up (avatar-stage.tsx says why). Start
  // waits for it — FACE_PREP_MS at most, then voice-only — so the session's clock never runs while it loads. ⛔ No face
  // (an under-13 without Spatius's written OK, a 2D look, no consent): nothing is loaded from Spatius at all.
  useEffect(() => {
    let live = true
    const q = test ? 'test=1' : seatId ? `seatId=${encodeURIComponent(seatId)}` : ''
    // The question itself is bounded too (2026-10-26 review, codex + opus): a lookup that never answers is voice-only, never a
    // Start that stays "Getting ready…".
    const ask = q
      ? fetch(`/api/classroom/face?${q}`, { signal: AbortSignal.timeout(FACE_ASK_MS) }).then(async (r) => (r.ok ? (((await r.json()) as { face?: FaceConfig | null }).face ?? null) : null)).catch(() => null)
      : Promise.resolve(null)
    void ask.then((f) => {
      if (!live) return
      if (!f || faceGone.current) { setPrep('ready'); return }
      faceRef.current = f
      setFace(f)
      modeRef.current = 'avatar'
      setMode('avatar')
      setPrep('drawing')
    })
    return () => { live = false }
  }, [seatId, test])
  useEffect(() => {
    if (prep !== 'drawing') return
    const t = setTimeout(() => { mark('face: not drawn in time — voice-only'); dropFace() }, FACE_PREP_MS)
    return () => clearTimeout(t)
  }, [dropFace, prep])

  /**
   * How long a silence ends the turn: the band's patience — or, listening live, only a BACKSTOP behind Soniox, which ends
   * the utterance itself on meaning and pauses within its own cap (soniox.ts sttSettingsFor).
   */
  const patience = useCallback(() => {
    const band = startRef.current?.band ?? 'adult'
    const own = PATIENCE_MS[band]
    const l = liveStt.current
    return l ? Math.max(own, l.maxDelayMs + LIVE_BACKSTOP_MS[band]) : own
  }, [])

  /** Hands-free: wait for the learner to speak (unless muted). */
  const listen = useCallback(() => {
    if (ended.current) return
    go('listening')
    if (mutedRef.current) { rec.unlisten(); return }
    rec.listen({ endMs: patience(), barge: false })
    mark('listening')
  }, [go, patience, rec])

  const stopSpeaking = useCallback(() => {
    player.current?.stop()
    stage.current?.interrupt()
  }, [])

  /** The learner's talk-over is heard from here on (the detector is stricter while the avatar talks) — once per reply. */
  const armBargeIn = useCallback(() => {
    const r = reply.current
    if (r.armed || !BARGE_IN || mutedRef.current || ended.current || phaseRef.current !== 'speaking') return
    r.armed = true
    rec.listen({ endMs: patience(), barge: true })
  }, [patience, rec])

  /**
   * Some of the avatar's line — a decoded part, or raw PCM frames streamed from the voice server — to the face when it is
   * live, else to the speakers. `last` closes the line.
   */
  const give = useCallback((audio: AudioBuffer | { pcm: Int16Array; rate: number }, last: boolean) => {
    if (ended.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    const r = reply.current
    // ⛔ NOTHING AFTER THE REPLY'S END (2026-10-27 plan review, codex + opus): to the face, a send after its end flag would
    // start a new reply over the one still playing.
    if (r.lastGiven) { mark('audio after the reply ended — dropped'); return }
    if (r.given === 0) {
      r.startedAt = performance.now()
      r.toFace = modeRef.current === 'avatar' && faceLive.current
      if (r.toFace) { const id = r.id; setTimeout(() => { if (reply.current.id === id) armBargeIn() }, FACE_TALKOVER_GRACE_MS) }
    }
    if (phaseRef.current !== 'speaking') {
      go('speaking')
      mark('first sound out')
    }
    // ⛔ Talking over the avatar counts once its voice SOUNDS: on the speakers, now — also for a reply moved there while
    // the phase was already 'speaking' (the opening the face never started; review, codex); on the face, when it starts
    // playing (onPlaying) — ~1.3 s later, when its motion has come. A word in that gap never cuts a reply that has not begun.
    if (!r.toFace) armBargeIn()
    r.given += 1
    r.audioMs += audio instanceof AudioBuffer ? audio.duration * 1000 : (audio.pcm.length / audio.rate) * 1000
    if (last) {
      r.lastGiven = true
      // ⛔ NEVER STUCK ON "TALKING" (2026-10-26 review, codex + opus): whatever the face or the speakers fail to report, the
      // learner's turn comes back once this reply's audio has had its time, and a margin for the face's start.
      const id = r.id
      const left = r.audioMs - (performance.now() - r.startedAt)
      setTimeout(() => {
        if (reply.current.id !== id || ended.current || phaseRef.current !== 'speaking') return
        mark('watchdog: the reply never reported its end')
        stopSpeaking()
        listen()
      }, Math.max(0, left) + REPLY_GRACE_MS)
    }
    if (r.toFace) {
      const ok = audio instanceof AudioBuffer
        ? stage.current?.speakPart(audio, last)
        : stage.current?.speakPcm(resamplePcm16(audio.pcm, audio.rate, FACE_RATE), last)
      if (ok) return // the face reports its end (onPlaying)
      // The face is gone: this reply goes on — and is talked over — on the speakers.
      r.toFace = false
      armBargeIn()
    }
    setWaiting(false)
    const buffer = audio instanceof AudioBuffer ? audio : bufferFromPcm16(ctx, audio.pcm, audio.rate)
    player.current ??= partPlayer(ctx)
    void player.current.play(buffer).then(() => {
      // The last part has played on the speakers: the learner's turn.
      if (last && !ended.current && phaseRef.current === 'speaking') { mark('voice: done'); listen() }
    })
  }, [armBargeIn, go, listen, stopSpeaking])

  /**
   * ⛔ HOWEVER THIS SCREEN CLOSES — End, "Not now", a refused start, navigating away — the microphone and the audio
   * context go with it (C3a review, codex + Opus: a refused start left the mic indicator on behind the refusal, and the
   * context was only ever closed on a successful End; iOS caps how many a page may hold).
   */
  const releaseAll = useCallback(() => {
    turnAbort.current?.abort()
    turnAbort.current = null
    liveStt.current?.close()
    liveStt.current = null
    if (awaitingWords.current) clearTimeout(awaitingWords.current)
    awaitingWords.current = null
    stopSpeaking()
    releaseRec()
    const ctx = ctxRef.current
    ctxRef.current = null
    player.current = null
    void ctx?.close().catch(() => {})
  }, [releaseRec, stopSpeaking])
  useEffect(() => releaseAll, [releaseAll])

  /**
   * ⛔ LEAVING WITHOUT END STILL ENDS THE SESSION (C3a round 2, Opus): back, closing the tab or any other way out used to
   * leave it live on the server until the sweep — holding its minutes, and refusing practice in another class
   * ("session_live"). On the way out (pagehide, or this screen unmounting) one keepalive POST ends it, unless End already
   * did.
   */
  const leftPage = useRef(false)
  /**
   * ⛔ LEAVING MARKS THE SCREEN GONE WHETHER OR NOT A SESSION EXISTS YET (C3b round 2, codex + Opus): left during Start —
   * the session POST still in flight — the old early return kept `ended` false, so the answer arriving later was adopted
   * by a screen that no longer existed. Now begin() sees `ended` and ends the session it was given.
   */
  const endOnLeave = useCallback(() => {
    if (ended.current) return
    ended.current = true
    leftPage.current = true
    const s = startRef.current
    if (s) void fetch(`/api/classroom/sessions/${s.id}/end`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'learner' }) }).catch(() => {})
  }, [])
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const releaseAllRef = useRef(releaseAll)
  releaseAllRef.current = releaseAll
  // ⚠️ MOUNT-ONCE (empty deps, the callbacks through refs): this cleanup ENDS the session, so it must run on a real unmount
  // only — never because a dependency changed identity mid-session (C3b round 2, Opus). The body resets the flags so a
  // development double-mount does not start out "gone".
  useEffect(() => {
    ended.current = false
    leftPage.current = false
    // Back to a page the browser kept (back-forward cache) after leaving: close the dead screen instead of leaving
    // controls that can no longer do anything (C3b review, codex + Opus).
    const onShow = (e: PageTransitionEvent) => { if (e.persisted && leftPage.current) { releaseAllRef.current(); closeRef.current() } }
    window.addEventListener('pagehide', endOnLeave)
    window.addEventListener('pageshow', onShow)
    return () => { window.removeEventListener('pagehide', endOnLeave); window.removeEventListener('pageshow', onShow); endOnLeave() }
  }, [endOnLeave])

  const end = useCallback(async (reason: 'learner' | 'time') => {
    if (ended.current) return
    // No session yet (the mic was refused, or Start was never tapped): End simply closes the screen.
    if (!start) { ended.current = true; releaseAll(); onClose(); return }
    ended.current = true
    go('ending')
    releaseAll()
    await fetch(`/api/classroom/sessions/${start.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) }).catch(() => {})
    router.push(`/classroom/reports/${start.id}`)
    onClose()
  }, [go, onClose, releaseAll, router, start])

  const close = () => { ended.current = true; releaseAll(); onClose() }

  /** A turn's answer: the reply's words at once, then its voice part by part (or a plain JSON answer, whole). */
  const readAnswer = async (res: Response, onLine: (l: TurnLine) => void) => {
    if (!(res.headers.get('content-type') ?? '').includes('ndjson')) { onLine((await res.json()) as TurnLine); return }
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) onLine(JSON.parse(line) as TurnLine)
      }
    }
  }

  /**
   * One turn: the learner's words heard live (`transcript`, with the clip only when the last reply set a drill — Azure scores
   * it), or the clip alone, the old way.
   */
  const sendTurn = async (turn: { wav?: Uint8Array; transcript?: string; speechMs?: number }) => {
    const s = startRef.current
    if (!s || ended.current) return
    const gen = ++turnGen.current
    rec.unlisten()
    go('thinking')
    setShowHint(false)
    mark('sent', turn.transcript !== undefined ? `${turn.transcript.length} chars${turn.wav ? ' + clip' : ''}` : `${Math.round((turn.wav?.length ?? 0) / 32)}ms of speech`)
    const abort = new AbortController()
    turnAbort.current = abort
    const timer = setTimeout(() => abort.abort(), TURN_WAIT_MS)
    reply.current = freshReply(reply.current.id + 1)
    // The last reply's drill was answered by this turn (its clip, if one was owed, is in it): this reply says its own.
    // A turn the server never took (refused, the network, no answer) answered nothing: the drill is owed again — the next
    // utterance sends its clip (2026-10-27 review, codex). The server's own history decides what a clip is scored against.
    const owed = lastExpect.current
    let settled = false
    const stillOwed = () => { if (!settled && gen === turnGen.current && lastExpect.current === null) lastExpect.current = owed }
    lastExpect.current = null
    // Parts are decoded as they arrive but handed over strictly in order.
    let chain: Promise<void> = Promise.resolve()
    let answered = false
    try {
      const id = turnId()
      const headers: Record<string, string> = { 'x-turn-id': id }
      if (turn.wav) headers['content-type'] = 'audio/wav'
      if (turn.transcript !== undefined) {
        headers['x-transcript'] = base64url(turn.transcript)
        headers['x-speech-ms'] = String(Math.max(0, Math.round(turn.speechMs ?? 0)))
      }
      const body = turn.wav ? new Blob([new Uint8Array(turn.wav)]) : undefined
      const post = () => fetch(`/api/classroom/sessions/${s.id}/turns`, { method: 'POST', headers, body, signal: abort.signal })
      let res = await post()
      for (let tries = 0; res.status === 409 && tries < BUSY_RETRIES; tries++) {
        const why = (await res.clone().json().catch(() => ({}))) as { error?: string }
        if (why.error !== 'turn_in_progress') break
        mark('previous turn still saving — retrying')
        await new Promise((r) => setTimeout(r, busyWaitMs(tries)))
        if (ended.current || abort.signal.aborted || gen !== turnGen.current) return
        res = await post()
      }
      if (!res.ok) {
        clearTimeout(timer)
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (ended.current) return
        // A session that may no longer be heard (a withdrawal, a removed seat, the switch) is not heard live either: the
        // socket closes on the first refusal (review, codex + opus).
        if (body.error === 'consent_required' || body.error === 'seat_inactive' || body.error === 'classroom_closed' || body.error === 'session_over') {
          liveStt.current?.close()
          liveStt.current = null
        }
        if (body.error === 'session_over' || body.error === 'turn_cap') return void end('time')
        // The practice notice changed while this session was open: no turn can be taken until the family agrees again —
        // the session ends (rather than refusing every turn to the end of its time) and the screen says why (review, opus).
        if (body.error === 'consent_required') {
          ended.current = true
          void fetch(`/api/classroom/sessions/${s.id}/end`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'learner' }) }).catch(() => {})
          // The face's connection goes with the session (a billed websocket never waits on the intro): a new Start on this
          // screen is voice-only.
          dropFace()
          releaseAll()
          setWaiting(false)
          setRefused({ code: 'consent_required' })
          go('intro')
          return
        }
        setNotice(body.error ?? 'unknown')
        stillOwed()
        listen()
        return
      }
      let streamed = false
      let spokenText = ''
      await readAnswer(res, (l) => {
        if (ended.current || gen !== turnGen.current) return
        if (l.kind === 'silence') { answered = true; mark('heard nothing'); return }
        if (l.kind === 'heard') { mark('heard', `${l.learnerText.length} chars`); setLearnerLine(l.learnerText); setAvatarLine(''); return }
        if (l.kind === 'error') { mark('no answer', l.error); setNotice(l.error); return }
        if (l.kind === 'no-drill') { settled = true; lastExpect.current = null; return }
        // The reply's drill, sent with its end — before the saved turn: the learner may answer before `reply` arrives.
        if (l.kind === 'drill') { settled = true; lastExpect.current = l.expect; return }
        if (l.kind === 'say') {
          answered = true
          streamed = true
          if (!spokenText) mark('first sentence')
          spokenText = spokenText ? `${spokenText} ${l.text}` : l.text
          setAvatarLine(spokenText)
          return
        }
        if (l.kind === 'pcm') {
          if (phaseRef.current === 'hearing') return
          chain = chain.then(() => { if (!ended.current && gen === turnGen.current && phaseRef.current !== 'hearing') give({ pcm: pcmFromBase64(l.data), rate: l.rate }, false) })
          return
        }
        if (l.kind === 'part-end') {
          if (l.last) chain = chain.then(() => { if (gen === turnGen.current) closeReply() })
          return
        }
        if (l.kind === 'reply') {
          answered = true
          settled = true
          mark('reply saved', `${l.reply.length} chars`)
          setLearnerLine(l.learnerText)
          setHint(l.hint ? { en: l.hint, vi: l.hintVi } : null)
          setLeft(l.secondsLeft)
          lastExpect.current = l.expect ?? null
          // Streamed: the captions grow sentence by sentence with the voice (`say`) — the whole reply is not shown ahead of it.
          if (streamed) return
          setAvatarLine(l.reply)
          reply.current.parts = l.parts ?? (l.audio ? 1 : 0)
          if (l.audio) { const a = l.audio; chain = chain.then(() => decodeAndGive(a, true, gen)) }
          return
        }
        if (l.kind === 'audio') {
          const last = l.part === reply.current.parts - 1
          mark(`voice part ${l.part + 1}/${reply.current.parts}`)
          const a = l.audio
          chain = chain.then(() => decodeAndGive(a, last, gen))
          return
        }
        if (l.kind === 'audio-failed') {
          mark(`voice part ${l.part + 1} FAILED`)
          // The face waits for a reply's last part: a failed last part still closes the reply.
          if (l.part === reply.current.parts - 1) chain = chain.then(() => { if (gen === turnGen.current) closeReply() })
        }
      })
      clearTimeout(timer)
      await chain
      if (gen !== turnGen.current) return // talked over meanwhile: the next turn owns the screen
      // A reply cut off before its last part (the stream ended without "end" — a server bug, a dropped proxy): closed here,
      // so the face or the speakers hand the turn back after what did arrive (2026-10-26 review, codex + opus).
      if (!ended.current && reply.current.given > 0 && !reply.current.lastGiven && (phaseRef.current as Phase) !== 'hearing') {
        mark('reply cut off — closing it')
        closeReply()
      }
    } catch {
      clearTimeout(timer)
      if (ended.current || gen !== turnGen.current || abort.signal.aborted && phaseRef.current === 'hearing') return // talked over
      // ⛔ The voice stops BEFORE the microphone listens at full sensitivity again (2026-10-26 review, opus): what was still
      // queued would otherwise play into the open mic and start a turn of its own.
      stopSpeaking()
      setNotice('network')
      stillOwed()
      listen()
      return
    }
    if (ended.current || gen !== turnGen.current) return
    // No saved turn came (silence, an error): the drill it answered is still owed.
    stillOwed()
    // Nothing to say (silence, an error, or a reply with no voice): straight back to listening — once.
    if ((!answered || reply.current.given === 0) && phaseRef.current !== 'listening') listen()
  }

  const decodeAndGive = async (b64: string, last: boolean, gen: number) => {
    const ctx = ctxRef.current
    if (!ctx || ended.current || gen !== turnGen.current || phaseRef.current === 'hearing') return
    try {
      const buffer = await decodeLine(ctx, b64)
      // Read again after the await (TypeScript keeps the first read's narrowing): the learner may have talked meanwhile.
      if (ended.current || gen !== turnGen.current || (phaseRef.current as Phase) === 'hearing') return
      give(buffer, last)
    } catch {
      if (last && gen === turnGen.current) closeReply()
    }
  }

  /** The reply is over (its last frames came, or its last part never did): close it so the face — or the speakers — hand
   *  the turn back after what is still playing. */
  const closeReply = () => {
    const ctx = ctxRef.current
    // Once (2026-10-27 plan review, opus): a second end would reach the face as a new reply.
    if (!ctx || ended.current || phaseRef.current === 'hearing' || reply.current.lastGiven) return
    if (reply.current.given === 0) { listen(); return }
    give({ pcm: new Int16Array(Math.round(ctx.sampleRate * 0.02)), rate: ctx.sampleRate }, true)
  }

  // ── the detector's events (refs: the recorder calls these from its worklet messages) ──
  handlers.current.speechStart = () => {
    const p = phaseRef.current
    if (ended.current || mutedRef.current) return
    if (p === 'speaking') {
      // Talked over: the avatar stops at once, the rest of its reply is dropped, the learner's turn is recording — and the
      // talked-over turn's late callbacks are disarmed.
      mark('talked over the avatar')
      turnGen.current += 1
      turnAbort.current?.abort()
      stopSpeaking()
      // ⛔ No drill from a reply the learner talked over (2026-10-26 review, codex + opus): the server withdraws it when the
      // page leaves, but its `no-drill` line goes to a reader that is gone — the page drops it here (no clip is sent).
      lastExpect.current = null
    } else if (p !== 'listening') return
    beginTrace('learner speaking')
    lastVoiceAt.current = 0
    go('hearing')
    // ⚡ LIVE LISTENING: this utterance streams to Soniox from its pre-roll on (the recorder sends that right after this).
    const l = liveStt.current
    liveUtterance.current = !!(l && ctxRef.current)
    vadEnded.current = false
    held.current = { text: '', ms: 0 }
    if (l && ctxRef.current) {
      to16k.current = streamTo16k(ctxRef.current.sampleRate)
      pending16k.current = []
      pendingClip.current = null
      l.begin()
    }
  }
  /** The learner's speech so far, to Soniox (live listening) — ~100 ms at a time. */
  const flushLive = () => {
    const l = liveStt.current
    const parts = pending16k.current
    pending16k.current = []
    if (!l || !parts.length) return
    const all = new Int16Array(parts.reduce((n, a) => n + a.length, 0))
    let at = 0
    for (const a of parts) { all.set(a, at); at += a.length }
    l.push(all)
  }
  handlers.current.frames = (f) => {
    const conv = to16k.current
    if (!liveStt.current || !conv || phaseRef.current !== 'hearing') return
    const pcm = conv(f)
    if (!pcm.length) return
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2
    if (Math.sqrt(sum / pcm.length) > VOICE_RMS) lastVoiceAt.current = performance.now()
    pending16k.current.push(pcm)
    if (pending16k.current.reduce((n, a) => n + a.length, 0) >= LIVE_CHUNK) flushLive()
  }
  handlers.current.speechEnd = () => {
    if (ended.current || phaseRef.current !== 'hearing') return
    mark('learner stopped')
    vadEnded.current = true
    // Live: Soniox usually ended the utterance already; if not, it ends it now — its words arrive as `utterance`. An
    // utterance that began before live listening opened was never streamed: it goes as a clip, at once.
    if (liveStt.current && liveUtterance.current) { flushLive(); liveStt.current.finalize(); owe(); return }
    void sendTurn({ wav: rec.take() })
  }
  handlers.current.autoStop = (wav) => {
    if (ended.current || phaseRef.current !== 'hearing') return
    if (liveStt.current && liveUtterance.current) { flushLive(); pendingClip.current = wav; liveStt.current.finalize(); owe(); return }
    void sendTurn({ wav })
  }
  /** The words are owed: if they do not come in time, the turn goes as a clip — never a learner left on "Listening…". */
  const owe = () => {
    if (awaitingWords.current) clearTimeout(awaitingWords.current)
    awaitingWords.current = setTimeout(() => {
      awaitingWords.current = null
      if (ended.current || phaseRef.current !== 'hearing') return
      mark('live listening: no words in time — sending the clip')
      // The utterance is the clip's now: whatever Soniox still says about it is dropped (review, codex: late words
      // became the NEXT turn).
      liveStt.current?.cancel()
      to16k.current = null
      const clip = pendingClip.current ?? rec.take()
      pendingClip.current = null
      void sendTurn({ wav: clip })
    }, LIVE_WORDS_MS)
  }
  /** Soniox finished an utterance: its words are the turn (with the clip only for a drill — Azure scores it). */
  handlers.current.utterance = (text, ms) => {
    if (ended.current || phaseRef.current !== 'hearing' || !liveUtterance.current) return
    const words = [held.current.text, text].filter(Boolean).join(' ').trim()
    const speechMs = held.current.ms + ms
    // ⛔ A LONE FILLER IS NOT A TURN (2026-10-26 review, opus): Soniox may end on "Um" while the learner is still talking —
    // the detector has not heard them stop. Kept, and the stream goes on: those words lead what comes next.
    if (text && !vadEnded.current && isFiller(text)) {
      held.current = { text: words, ms: speechMs }
      mark('live: a filler — still listening', `${text.length} chars`)
      liveStt.current?.begin()
      return
    }
    if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
    held.current = { text: '', ms: 0 }
    liveStt.current?.pause()
    flushLive()
    to16k.current = null
    const clip = pendingClip.current ?? rec.take()
    pendingClip.current = null
    // Nothing at all was heard (the page's finalize found no words — a cough): back to listening.
    if (!words) { mark('heard nothing (live)'); listen(); return }
    mark('heard live', `${words.length} chars · ${lastVoiceAt.current ? Math.round(performance.now() - lastVoiceAt.current) : '?'} ms after the voice`)
    void sendTurn({ transcript: words.slice(0, LIVE_TEXT_MAX_CHARS), speechMs, wav: lastExpect.current ? clip : undefined })
  }
  /**
   * The live socket broke: from now on the clip goes whole. An utterance under way is recorded anyway, so the detector
   * ends it the old way — unless the learner had already stopped and its words were owed: then its clip goes now.
   */
  handlers.current.liveFailed = () => {
    liveStt.current = null
    to16k.current = null
    mark('live listening: off — back to clips')
    if (awaitingWords.current && !ended.current && phaseRef.current === 'hearing') {
      clearTimeout(awaitingWords.current)
      awaitingWords.current = null
      void sendTurn({ wav: pendingClip.current ?? rec.take() })
      pendingClip.current = null
    }
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

  /** The opening the face was given but has not started: cut, the face given up, and the speakers say it (sayOpening). */
  const openingToSpeakers = useCallback((id: number, why: string): boolean => {
    const o = openingAtFace.current
    if (!o || o.id !== id) return false
    openingAtFace.current = null
    clearTimeout(o.timer)
    if (ended.current || reply.current.id !== id || reply.current.played || !reply.current.toFace) return false
    mark(why)
    stage.current?.interrupt()
    dropFace()
    reply.current = { ...freshReply(id + 1), parts: 1 }
    give(o.buffer, true)
    return true
  }, [dropFace, give])

  /**
   * The opening line — ONE OWNER (plan review, codex + opus): the face when it is live, else the speakers; then the
   * learner's turn. Handed to the face, it must START sounding within OPENING_PLAY_MS (its motion comes ~1.3 s after its
   * audio) — or the face is cut and the speakers say it. Never both, never twice, never not at all.
   */
  const sayOpening = useCallback(() => {
    if (ended.current || openingSaid.current) return
    openingSaid.current = true
    const b = opening.current
    opening.current = null
    if (!b) { setWaiting(false); listen(); return }
    reply.current = { ...freshReply(reply.current.id + 1), parts: 1 }
    give(b, true)
    if (!reply.current.toFace) return
    const id = reply.current.id
    openingAtFace.current = { id, buffer: b, timer: setTimeout(() => { openingToSpeakers(id, 'face: the opening never started — the speakers say it') }, OPENING_PLAY_MS) }
  }, [give, listen, openingToSpeakers])

  /**
   * The face's playback: its first sound REVEALS the session (the face and its voice begin together), lets the learner
   * talk over it, and settles the opening's owner; an idle AFTER playing ends the reply.
   */
  const onPlaying = useCallback((on: boolean) => {
    if (on) {
      if (phaseRef.current !== 'speaking' || !reply.current.toFace) return
      reply.current.played = true
      const o = openingAtFace.current
      if (o && o.id === reply.current.id) { clearTimeout(o.timer); openingAtFace.current = null }
      setWaiting(false)
      armBargeIn()
      return
    }
    // The face finished the reply's last part (an idle AFTER playing): the learner's turn.
    if (phaseRef.current === 'speaking' && reply.current.lastGiven && reply.current.played) { mark('face: done'); listen() }
  }, [armBargeIn, listen])

  /**
   * ⛔ ONE START AT A TIME (owner's iPhone, 2026-10-27, `?trace=1`: every step of the start ran TWICE — two "mic ready",
   * two "session started", two face connects — and the second connect failed "Connection already in progress", so the
   * face fell back to voice). A second tap while a start is under way does nothing; the button shows it is busy.
   */
  const begin = async () => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(true)
    try {
      await beginOnce()
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }
  /**
   * The Start tap: the face's audio (inside this tap — iOS), the microphone (a gesture too) — then the session is started
   * (or resumed: the server returns a live one). ⚡ ALL AT ONCE: the face was drawn before Start was offered; now it
   * CONNECTS while the opening's audio decodes, and the opening waits for it — "Connecting to {name}…" until the face's
   * voice and lips start together. Not connected within FACE_CONNECT_MS (or failed): voice-only for the whole session, the
   * opening on the speakers. The face no longer joins a conversation already under way.
   */
  const beginOnce = async () => {
    hapticTap()
    setRefused(null)
    ended.current = false
    leftPage.current = false
    beginTrace('start')
    // A new attempt on this screen (after a session the notice ended) says its own opening (2026-10-26 review round 2,
    // codex + opus: the first attempt's "said" kept the second on "Connecting…").
    openingSaid.current = false
    if (openingAtFace.current) { clearTimeout(openingAtFace.current.timer); openingAtFace.current = null }
    // ⛔ BEFORE ANY AWAIT: the face's audio may start only inside this tap on iOS and Safari — where it could not, the
    // session is voice-only (lips without a voice would be worse; review, opus).
    const primed = modeRef.current === 'avatar' && !!stage.current?.prime()
    if (primed) mark('face: audio started in the tap')
    else if (modeRef.current === 'avatar' && audioNeedsGesture()) { mark('face: audio not started in the tap — voice-only'); dropFace() }
    const ctx = ctxRef.current ?? new AudioContext()
    ctxRef.current = ctx
    try {
      await ctx.resume()
      await rec.prepare(ctx)
    } catch {
      if (ended.current) return // closed while the permission prompt was up: nothing more to do
      releaseAll()
      go('mic_denied')
      return
    }
    // ⛔ Closed during the prompt or the worklet's load: no session is started for a screen that is gone (C3a round 2).
    if (ended.current) return
    mark('mic ready')
    go('connecting')
    setWaiting(true)
    const r = await fetch('/api/classroom/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(test ? { test: true } : { seatId }) }).catch(() => null)
    const body = (await r?.json().catch(() => ({}))) as { session?: StartedSession; error?: string; nextAt?: string }
    if (ended.current) {
      // ⛔ Closed while the start was in flight (C3b review, Opus): the session it made has no screen — end it now, or it
      // holds its minutes and refuses practice in another class until the sweep.
      if (body?.session) void fetch(`/api/classroom/sessions/${body.session.id}/end`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'learner' }) }).catch(() => {})
      return
    }
    if (!r?.ok || !body.session) {
      // Refused (a limit, the budget, the switch): the mic and the audio context go back now — the next Start asks again.
      releaseAll()
      setWaiting(false)
      setRefused({ code: body?.error ?? 'network', nextAt: body?.nextAt })
      go('intro')
      return
    }
    const s = body.session
    mark('session started', s.mode)
    startRef.current = s
    total.current = Math.max(1, Math.round((Date.parse(s.endsAt) - Date.now()) / 1000))
    setLeft(total.current)
    setAvatarLine(s.opening.text)
    setStart(s)
    lastExpect.current = s.opening.expect ?? null
    // Live listening opens alongside (a key from the server, then Soniox's socket); until it is open, turns go as clips.
    void openLiveStt(s.id, { utterance: (t, ms) => handlers.current.utterance(t, ms), failed: () => handlers.current.liveFailed() }).then((l) => {
      if (ended.current) { l?.close(); return }
      liveStt.current = l
    })
    const audio = s.opening.audio ? decodeLine(ctx, s.opening.audio).catch(() => null) : Promise.resolve(null)
    // The face drawn for this screen speaks only for its own session: the server's mode, the same avatar.
    const withFace = s.mode === 'avatar' && modeRef.current === 'avatar' && !faceGone.current && faceRef.current?.avatarId === s.avatar.spatiusAvatarId
    if (modeRef.current === 'avatar' && !withFace) { mark('face: not this session’s — voice-only'); dropFace() }
    const connected = withFace
      ? await Promise.race([stage.current?.connect(s.id) ?? Promise.resolve(false), new Promise<boolean>((res) => setTimeout(() => res(false), FACE_CONNECT_MS))])
      : false
    opening.current = await audio
    if (ended.current) return
    if (connected && modeRef.current === 'avatar' && !faceGone.current) { faceLive.current = true; mark('face: live — it says the opening') }
    else if (withFace && !faceGone.current) { mark('face: not connected in time — voice-only'); dropFace() }
    sayOpening()
  }

  const onFallback = useCallback(() => {
    if (faceGone.current) return
    mark('face: fell back to voice')
    // The opening it held but had not started: the speakers say it now (sayOpening's one owner).
    const o = openingAtFace.current
    if (o && openingToSpeakers(o.id, 'face: failed before the opening sounded — the speakers say it')) return
    const wasFace = reply.current.toFace
    dropFace()
    // ⛔ The face failed WHILE it spoke (2026-10-26 review, codex): what it held is gone with it, and nothing would ever
    // report the reply's end — the learner's turn now. The rest of a reply still arriving plays on the speakers.
    if (phaseRef.current === 'speaking' && wasFace) { stopSpeaking(); listen() }
  }, [dropFace, listen, openingToSpeakers, stopSpeaking])

  const toggleMute = () => {
    hapticTap()
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    if (next) {
      // Muted mid-sentence: what was said so far is dropped — live, its words too.
      if (phaseRef.current === 'hearing') { liveStt.current?.cancel(); to16k.current = null }
      if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
      rec.unlisten()
      if (phaseRef.current === 'hearing') go('listening')
    } else if (phaseRef.current === 'listening') {
      listen()
    } else if (phaseRef.current === 'speaking' && BARGE_IN) {
      rec.listen({ endMs: patience(), barge: true })
    }
  }

  const minutes = Math.floor(left / 60)
  const secs = String(left % 60).padStart(2, '0')
  const name = start?.avatar.name ?? preview.name
  const status = muted ? tr('Muted', 'Đã tắt micro')
    : phase === 'listening' ? tr('Listening — just talk', 'Đang nghe — cứ nói nhé')
      : phase === 'hearing' ? tr('Listening…', 'Đang nghe…')
        : phase === 'thinking' ? tr('{name} is thinking…', '{name} đang nghĩ…').replace('{name}', name)
          : phase === 'speaking' ? tr('{name} is talking', '{name} đang nói').replace('{name}', name)
            : ''
  const note = notice ? refusalCopy(notice) : null
  const live = phase === 'listening' || phase === 'hearing' || phase === 'thinking' || phase === 'speaking'

  return (
    <Dialog open onOpenChange={() => { /* only End closes a session */ }}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-brand-deeper p-0 text-primary-foreground sm:max-w-none"
      >
        <DialogTitle className="sr-only">{tr('Speaking practice', 'Luyện nói')}</DialogTitle>
        <DialogDescription className="sr-only">{preview.name}</DialogDescription>
        {/* MOBILE-FIRST: one phone-width column; on a wide window the dark screen fills the rest. */}
        <div className="mx-auto flex h-full w-full max-w-md flex-col">
          <header className="flex flex-col gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <Progress tone="onDark" value={total.current - left} max={total.current}
              aria-label={tr('Time', 'Thời gian')} valueText={`${minutes}:${secs}`} />
            <div className="flex items-center justify-between text-xs text-primary-foreground/70">
              <span className="truncate">{name} · {tr('AI avatar', 'Avatar AI')}</span>
              <span className="tabular-nums" aria-hidden>{minutes}:{secs}</span>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            <AvatarStage
              ref={stage}
              mode={mode}
              face={face}
              photoUrl={start?.avatar.photoUrl ?? preview.photoUrl}
              name={name}
              speaking={phase === 'speaking'}
              onDrawn={() => setPrep('ready')}
              onFallback={onFallback}
              onPlaying={onPlaying}
            />

            {showTrace && trace.length > 0 && (
              <ol className="pointer-events-none absolute left-2 top-2 max-h-[60%] overflow-hidden rounded-lg bg-brand-deeper/80 p-2 font-mono text-xs leading-tight text-primary-foreground/90">
                {trace.map((m, i) => <li key={i}>{formatMark(m)}</li>)}
              </ol>
            )}

            {phase === 'intro' && (
              <div className="absolute inset-0 flex flex-col items-center justify-end gap-4 bg-brand-deeper/60 p-6 pb-10 text-center">
                <p className="max-w-xs text-base">{tr('Find a quiet place, then tap Start. Then just talk, like a video call.', 'Hãy tìm chỗ yên tĩnh rồi chạm Bắt đầu. Sau đó cứ nói chuyện, như gọi video.')}</p>
                {refused && (
                  <p role="alert" className="max-w-xs text-sm text-primary-foreground/80">
                    {tr(refusalCopy(refused.code).en, refusalCopy(refused.code).vi)}
                    {/* The day practice opens again (C3a review: dayName was written for this and never used). */}
                    {refused.nextAt && dayName(refused.nextAt, lang) && (
                      <> {tr('You can practise again on {day}.', 'Bạn có thể luyện tập lại vào {day}.').replace('{day}', dayName(refused.nextAt, lang))}</>
                    )}
                  </p>
                )}
                {/* Start waits for the face (FACE_PREP_MS at most): the face and its voice begin together. */}
                {!refused?.nextAt && (
                  <Button variant="cta" size="lg" className="w-full max-w-xs" onClick={begin} disabled={prep !== 'ready' || starting}>
                    {prep !== 'ready' ? tr('Getting ready…', 'Đang chuẩn bị…') : starting ? tr('Starting…', 'Đang bắt đầu…') : tr('Start', 'Bắt đầu')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-primary-foreground/80" onClick={close}>{tr('Not now', 'Để sau')}</Button>
              </div>
            )}
            {(phase === 'connecting' || (waiting && phase === 'speaking')) && (
              <div className="absolute inset-x-0 bottom-6 flex justify-center" role="status">
                <span className="rounded-full bg-primary-foreground/15 px-4 py-2 text-sm">{tr('Connecting to {name}…', 'Đang kết nối với {name}…').replace('{name}', name)}</span>
              </div>
            )}
            {phase === 'mic_denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-brand-deeper/80 p-6 text-center">
                <p className="max-w-xs text-base font-semibold">{tr('The microphone is blocked', 'Micro đang bị chặn')}</p>
                <p className="max-w-xs text-sm text-primary-foreground/80">{tr('Allow the microphone for this site in your browser settings, then try again. In Zalo or Facebook, open the link in Safari or Chrome.', 'Hãy cho phép micro cho trang này trong cài đặt trình duyệt rồi thử lại. Nếu đang ở Zalo hoặc Facebook, hãy mở link bằng Safari hoặc Chrome.')}</p>
                <Button variant="cta" onClick={() => { go('intro') }}>{tr('Try again', 'Thử lại')}</Button>
                <Button variant="ghost" size="sm" className="text-primary-foreground/80" onClick={close}>{tr('Not now', 'Để sau')}</Button>
              </div>
            )}

            {live && !waiting && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-brand-deeper via-brand-deeper/80 to-transparent px-4 pb-3 pt-10" aria-live="polite">
                {captions && learnerLine && <p className="self-end rounded-2xl bg-primary-foreground/10 px-4 py-2 text-sm text-primary-foreground/80">{learnerLine}</p>}
                {captions && avatarLine && <p className="text-base leading-relaxed">{avatarLine}</p>}
                {showHint && hint && (
                  <div className="rounded-2xl bg-primary-foreground/10 px-4 py-3 text-sm">
                    <p>{hint.en}</p>
                    {hint.vi && <p lang="vi" className="mt-1 text-primary-foreground/70">{hint.vi}</p>}
                  </div>
                )}
                {note && <p role="status" className="text-center text-sm text-primary-foreground/80">{tr(note.en, note.vi)}</p>}
                <p className={cn('flex items-center justify-center gap-2 text-sm text-primary-foreground/80', phase === 'hearing' && !muted && 'text-primary-foreground')}>
                  {!muted && (phase === 'listening' || phase === 'hearing') && (
                    <span aria-hidden className={cn('size-2 rounded-full bg-success', phase === 'hearing' && 'animate-pulse')} />
                  )}
                  {status}
                </p>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-around gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
            {/* Pressed = a light fill + the bold glyph in the button's own white (`icon-own-ink`): the house accent-blue
                pressed glyph all but vanished on this dark screen (the 390px check). */}
            <IconButton size="lg" aria-pressed={showHint} aria-label={tr('Hint', 'Gợi ý')} disabled={!hint || !live} onClick={() => setShowHint((v) => !v)}
              className="icon-own-ink text-primary-foreground hover:bg-primary-foreground/10 aria-pressed:bg-primary-foreground/20">
              <CircleHelp className="size-6" />
            </IconButton>
            <IconButton size="lg" aria-pressed={captions} aria-label={tr('Captions', 'Phụ đề')} onClick={() => setCaptions((v) => !v)}
              className="icon-own-ink text-primary-foreground hover:bg-primary-foreground/10 aria-pressed:bg-primary-foreground/20">
              <MessageSquareText className="size-6" />
            </IconButton>
            <Button
              size="none"
              variant="bare"
              onClick={toggleMute}
              disabled={!live}
              aria-label={muted ? tr('Unmute', 'Bật micro') : tr('Mute', 'Tắt micro')}
              aria-pressed={muted}
              className={cn('size-16 rounded-full disabled:opacity-40', muted ? 'bg-primary-foreground text-brand-deeper' : 'bg-primary-foreground/15 text-primary-foreground')}
            >
              {muted ? <MicOff className="size-7" strokeWidth={STROKE_UI} /> : <Mic className="size-7" strokeWidth={STROKE_UI} />}
            </Button>
            <IconButton size="lg" aria-label={tr('End', 'Kết thúc')} onClick={() => void end('learner')} disabled={phase === 'ending'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <PhoneOff className="size-6" />
            </IconButton>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
