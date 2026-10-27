'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Captions, Lightbulb, Mic, MicOff, PhoneOff, Video } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { hapticTap } from '@/lib/haptics'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import type { StartedSession } from '@/lib/classroom/session-start'
import type { AgeBand } from '@/lib/classroom/limits'
import { dayName, refusalCopy } from '../classroom-copy'
import { AvatarStage, FACE_RATE, audioNeedsGesture, type FaceConfig, type StageHandle } from './avatar-stage'
import { bufferFromPcm16, decodeLine, partPlayer, pcmFromBase64, resamplePcm16 } from './voice'
import { useRecorder } from './use-recorder'
import { isHesitation, openLiveStt, type LiveStt } from './live-stt'
import { streamTo16k } from '@/lib/classroom/wav'
import { LIMITS } from '@/lib/classroom/constants'
import { DEFAULT_BACKGROUND, backgroundImage, type Background } from '@/lib/classroom/backgrounds'
import { beginTrace, formatMark, mark, traceVisible, useTrace } from './trace'
import { useSelfView } from './use-self-view'

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
/** After the 45 s cap asked Soniox to end a turn, how long its words may take before the recording goes as the turn. */
const LIVE_WORDS_MS = 3_000
/** The longest transcript sent (the server takes the same: session-turn.ts LIVE_TEXT_MAX). */
const LIVE_TEXT_MAX_CHARS = 1_000
/**
 * Listening live, the first moments after the avatar's last sound are not streamed: its tail in the room (a Bluetooth
 * speaker's delay) would reach Soniox as the learner's words — no detector of ours stands in front of it any more
 * (2026-10-27 plan review, opus).
 */
const LIVE_TAIL_MS = 300
/** The turn's recording keeps this much from before Soniox first heard words (its answers trail the voice by ~1 s). */
const LIVE_CLIP_LEAD_MS = 1_500
/** Live listening broke (a stalled network, a closed socket — a phone moving from Wi-Fi to 4G): opened again after
 *  LIVE_REOPEN_MS, then twice as long each time, LIVE_REOPENS times (2 + 4 + 8 + 16 s ≈ half a minute of patience); each
 *  try spends one of the server's few keys an hour (stt-grant.ts STT_KEYS_PER_SESSION). */
const LIVE_REOPEN_MS = 2_000
const LIVE_REOPENS = 4
/** Nothing can hear the learner any more: the session ends this long after the screen says so. */
const GONE_END_MS = 12_000
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
  preview: { name: string; photoUrl: string | null; background?: Background }
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
  /** Soniox hears the learner (its socket is open) — 'off': not yet, or opening again; 'gone': refused, or the tries ran
   *  out — nothing can hear the learner for the rest of this session (Soniox only). */
  const [hearing, setHearing] = useState<'on' | 'off' | 'gone'>('off')
  /** The learner's own camera in a corner, like a video call (use-self-view.ts) — adults only, never sent. */
  // Remembered per learner: the seat — or, for a teacher's own test, the teacher's account (review, codex).
  const { user } = useAuth()
  const selfView = useSelfView(start?.band === 'adult', seatId ?? `test:${user?.id ?? ''}`)
  const { resume: resumeSelfView, stop: stopSelfView } = selfView
  const wordsBox = useRef<HTMLDivElement>(null)
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
  /** The cap asked Soniox to end the turn: after LIVE_WORDS_MS without its words, the recording goes as the turn. */
  const awaitingWords = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** This listening streams live (to Soniox) — false: the detector listens and the turn goes as a clip. */
  const liveUtterance = useRef(false)
  /** Live: frames reach Soniox from this moment (performance.now) — LIVE_TAIL_MS after the avatar's last sound. */
  const tailUntil = useRef(0)
  /** Live: the cap on one turn (LIMITS.turnSeconds) — then Soniox is asked to end it. */
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** How often live listening was opened again after it broke (LIVE_REOPENS at most), when it last opened, and the try
   *  waiting to run (one at a time). */
  const liveReopens = useRef(0)
  const liveOpenedAt = useRef(0)
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    utterance: (_text: string, _ms: number) => {}, liveFailed: () => {}, activity: (_speaking: boolean) => {},
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

  /** How long a silence ends the turn when the page's own detector listens (no live socket): the band's patience. */
  const patience = useCallback(() => PATIENCE_MS[startRef.current?.band ?? 'adult'], [])

  const clearCap = useCallback(() => {
    if (capTimer.current) clearTimeout(capTimer.current)
    capTimer.current = null
  }, [])

  /**
   * Wait for the learner to speak (unless muted). ⛔ LIVE, SONIOX DECIDES (owner, 2026-10-27, after "it cant hear me nor
   * transcribe what i say": "dont alter with code let the stt decide itself"): every frame streams to Soniox from
   * LIVE_TAIL_MS on and ITS end of utterance is the turn — no detector of ours in front of it (its noise floor kept soft
   * voices out; its silence cut turns). Without a live socket the detector listens and the turn goes as a clip, as before.
   */
  const listen = useCallback((from?: 'talk-over') => {
    if (ended.current) return
    go('listening')
    clearCap()
    lastVoiceAt.current = 0
    const l = liveStt.current
    if (mutedRef.current) { rec.unlisten(); l?.pause(); to16k.current = null; liveUtterance.current = false; return }
    if (l && ctxRef.current) {
      to16k.current = streamTo16k(ctxRef.current.sampleRate)
      pending16k.current = []
      pendingClip.current = null
      liveUtterance.current = true
      // A talk-over keeps its opening (review, codex + opus): the learner is already speaking — the detector's held
      // pre-roll streams next, and no tail is skipped (the avatar stopped at once; echo cancellation had its voice).
      tailUntil.current = from === 'talk-over' ? 0 : performance.now() + LIVE_TAIL_MS
      l.begin()
      rec.stream()
      mark(from === 'talk-over' ? 'listening (live, talked over)' : 'listening (live)')
      return
    }
    // ⛔ SONIOX ONLY (owner, 2026-10-27: "make sure parakeet is not used anywhere else only soniox"): no live socket yet
    // (opening, or opening again after a break) — nothing is recorded; the screen says it is connecting, and listening
    // goes live the moment the socket opens (openLive).
    liveUtterance.current = false
    rec.unlisten()
    mark('listening: waiting for live listening')
  }, [clearCap, go, rec])

  /** Open live listening (live-stt.ts) for this session; once open, listening goes live. */
  const openLive = (sessionId: string) => {
    void openLiveStt(sessionId, {
      utterance: (t, ms) => handlers.current.utterance(t, ms),
      failed: () => handlers.current.liveFailed(),
      activity: (speaking) => handlers.current.activity(speaking),
    }).then((l) => {
      // Another session's, a session over, or a socket already open: this one is not needed.
      if (ended.current || startRef.current?.id !== sessionId || liveStt.current) { if (l && l !== 'refused') l.close(); return }
      // Refused (the session is over, the switch is off, consent withdrawn, no keys left): final — the screen says so.
      if (l === 'refused') { setHearing('gone'); mark('live listening: refused'); return }
      // No socket (Soniox down, the network): a few more tries (retryLive).
      if (!l) { retryLive(sessionId); return }
      liveStt.current = l
      setHearing('on')
      if (liveReopens.current > 0) mark('live listening: open again')
      liveOpenedAt.current = Date.now()
      if (phaseRef.current === 'listening' && !liveUtterance.current && !mutedRef.current) listen()
    }, () => {
      // An open that threw (an API this browser lacks, a bug): one more failed try — never a screen stuck connecting.
      if (!ended.current && startRef.current?.id === sessionId && !liveStt.current) retryLive(sessionId)
    })
  }
  /**
   * Open live listening again after a failure: LIVE_REOPENS tries, one at a time — then the screen says it cannot hear
   * (Soniox is the only ear, owner 2026-10-27; the learner ends the session). Never a loop: each try spends one of the
   * server's few keys an hour (review, codex + opus).
   */
  const retryLive = (sessionId: string) => {
    if (ended.current || reopenTimer.current) return
    if (liveReopens.current >= LIVE_REOPENS) { setHearing('gone'); mark('live listening: given up'); return }
    const wait = LIVE_REOPEN_MS * 2 ** liveReopens.current
    liveReopens.current += 1
    setHearing('off')
    reopenTimer.current = setTimeout(() => {
      reopenTimer.current = null
      if (!ended.current && !liveStt.current && startRef.current?.id === sessionId) openLive(sessionId)
    }, wait)
  }

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
    if (reopenTimer.current) { clearTimeout(reopenTimer.current); reopenTimer.current = null }
    liveStt.current?.close()
    liveStt.current = null
    liveUtterance.current = false
    if (awaitingWords.current) clearTimeout(awaitingWords.current)
    awaitingWords.current = null
    if (capTimer.current) clearTimeout(capTimer.current)
    capTimer.current = null
    stopSpeaking()
    releaseRec()
    stopSelfView()
    const ctx = ctxRef.current
    ctxRef.current = null
    player.current = null
    void ctx?.close().catch(() => {})
  }, [releaseRec, stopSelfView, stopSpeaking])
  // A session started: the camera comes back on if the learner left it on — only where the browser already allows it.
  useEffect(() => { if (start) void resumeSelfView() }, [start, resumeSelfView])
  // Never on behind the intro or the blocked-microphone screen, where its button is not shown (review, opus).
  useEffect(() => { if (phase === 'intro' || phase === 'mic_denied') stopSelfView() }, [phase, stopSelfView])
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

  // ⛔ Nothing can hear the learner for the rest of this session (refused, or the tries ran out — Soniox is the only ear):
  // the face is let go at once (Spatius bills its connected time) and the session ends after GONE_END_MS, time to read why
  // (review, opus: it ran to its deadline with the face connected).
  const endRef = useRef(end)
  endRef.current = end
  useEffect(() => {
    if (hearing !== 'gone' || ended.current) return
    dropFace()
    // ('learner': the page ends it for them — the column's CHECK has no 'unheard', and nothing shows the reason.)
    const t = setTimeout(() => void endRef.current('learner'), GONE_END_MS)
    return () => clearTimeout(t)
  }, [dropFace, hearing])

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
    clearCap()
    liveStt.current?.pause()
    to16k.current = null
    liveUtterance.current = false
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
      // Nothing could hear the learner now (no live socket): the avatar talks on — a talk-over would cut it off for
      // nothing (review, opus).
      if (!liveStt.current || !ctxRef.current) return
      // Talked over: the avatar stops at once, the rest of its reply is dropped, the learner's turn is recording — and the
      // talked-over turn's late callbacks are disarmed.
      mark('talked over the avatar')
      turnGen.current += 1
      turnAbort.current?.abort()
      stopSpeaking()
      // ⛔ No drill from a reply the learner talked over (2026-10-26 review, codex + opus): the server withdraws it when the
      // page leaves, but its `no-drill` line goes to a reader that is gone — the page drops it here (no clip is sent).
      lastExpect.current = null
      // LIVE: the learner's turn streams from here — the detector's held pre-roll first (the recorder hands it over right
      // after this) — and Soniox ends it. (The face's "done" for the interrupted reply may have opened a plain listening
      // inside stopSpeaking: this one replaces it.)
      listen('talk-over')
    }
    // (The detector listens only while the avatar talks — for a talk-over. The learner's words are Soniox's alone.)
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
    const p = phaseRef.current
    if (!liveStt.current || !conv || !liveUtterance.current || (p !== 'listening' && p !== 'hearing')) return
    if (performance.now() < tailUntil.current) return // the avatar's tail in the room
    const pcm = conv(f)
    if (!pcm.length) return
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2
    if (Math.sqrt(sum / pcm.length) > VOICE_RMS) lastVoiceAt.current = performance.now()
    pending16k.current.push(pcm)
    if (pending16k.current.reduce((n, a) => n + a.length, 0) >= LIVE_CHUNK) flushLive()
  }
  // The detector's end of an utterance ends nothing: Soniox ends the turn (and there is no clip path — Soniox only).
  handlers.current.speechEnd = () => {}
  handlers.current.autoStop = () => {}
  /** Soniox hears the learner (words in progress) — or took back what it thought it heard: the screen says which. */
  handlers.current.activity = (speaking) => {
    if (ended.current || mutedRef.current || !liveUtterance.current) return
    const p = phaseRef.current
    if (speaking && p === 'listening') {
      beginTrace('learner speaking')
      go('hearing')
      // The turn's recording starts just before Soniox heard words (its answers come ~1 s behind the voice).
      rec.keepLast(LIVE_CLIP_LEAD_MS)
      armCap()
    } else if (!speaking && p === 'hearing' && !awaitingWords.current) {
      go('listening')
      clearCap()
    }
  }
  /** Live, one turn longer than LIMITS.turnSeconds: Soniox is asked to end it now (its words, else the recording, go). */
  const armCap = () => {
    if (capTimer.current) return
    capTimer.current = setTimeout(() => {
      capTimer.current = null
      if (ended.current || phaseRef.current !== 'hearing' || !liveUtterance.current) return
      mark('live: the turn reached its cap — Soniox ends it')
      flushLive()
      liveStt.current?.finalize()
      owe()
    }, LIMITS.turnSeconds * 1000)
  }
  /** The words are owed: if they do not come in time, the turn goes as a clip — never a learner left on "Listening…". */
  const owe = () => {
    if (awaitingWords.current) clearTimeout(awaitingWords.current)
    awaitingWords.current = setTimeout(() => {
      awaitingWords.current = null
      if (ended.current || phaseRef.current !== 'hearing') return
      mark('live listening: no words in time — listening again')
      // Whatever Soniox still says about this utterance is dropped (review, codex: late words became the NEXT turn); there
      // is no clip to send instead (Soniox only).
      liveStt.current?.cancel()
      pendingClip.current = null
      setNotice('speech_unavailable')
      listen()
    }, LIVE_WORDS_MS)
  }
  /** Soniox finished an utterance: its words are the turn (with the clip only for a drill — Azure scores it). */
  handlers.current.utterance = (text, ms) => {
    const p = phaseRef.current
    if (ended.current || !liveUtterance.current || (p !== 'listening' && p !== 'hearing')) return
    // A pure hesitation ("Um.", "Ờ") is not an answer — the stream simply goes on. (No begin(): moving the utterance's
    // start on the audio clock dropped the words already said after the "um" — the bug the owner heard, 2026-10-27.)
    if (text && isHesitation(text)) {
      mark('live: a hesitation — still listening', `${text.length} chars`)
      // (After the cap's finalize too: the hesitation is what it found — no recording goes as a turn 3 s later.)
      if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
      if (p === 'hearing') { go('listening'); clearCap() }
      return
    }
    if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
    clearCap()
    // Nothing at all (the cap's finalize found no words): listening goes on.
    if (!text) { mark('heard nothing (live)'); if (p === 'hearing') go('listening'); return }
    liveStt.current?.pause()
    to16k.current = null
    const clip = lastExpect.current ? pendingClip.current ?? rec.take() : undefined
    pendingClip.current = null
    mark('heard live', `${text.length} chars · ${lastVoiceAt.current ? Math.round(performance.now() - lastVoiceAt.current) : '?'} ms after the voice`)
    void sendTurn({ transcript: text.slice(0, LIVE_TEXT_MAX_CHARS), speechMs: ms, wav: clip })
  }
  /**
   * The live socket broke: from now on the clip goes whole. An utterance under way is recorded anyway, so the detector
   * ends it the old way — unless the learner had already stopped and its words were owed: then its clip goes now.
   */
  handlers.current.liveFailed = () => {
    liveStt.current = null
    to16k.current = null
    clearCap()
    mark('live listening: off')
    const wasLive = liveUtterance.current
    liveUtterance.current = false
    if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
    // ⛔ One broken socket is not the rest of the session (review, opus): it is opened again. A socket that stayed up a
    // minute earns its quick tries back; one that keeps dropping does not (each reopen spends one of the server's few keys
    // an hour — stt-grant.ts STT_KEYS_PER_SESSION).
    if (liveOpenedAt.current && Date.now() - liveOpenedAt.current >= 60_000) { liveReopens.current = 0; liveOpenedAt.current = 0 }
    const s = startRef.current
    if (s) retryLive(s.id)
    if (ended.current || !wasLive) return
    // The learner was speaking: those words are lost — say so; either way the screen waits for the socket (openLive).
    pendingClip.current = null
    if (phaseRef.current === 'hearing') setNotice('speech_unavailable')
    if (phaseRef.current === 'hearing' || phaseRef.current === 'listening') listen()
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
   * ⛔ THE PHONE STAYS AWAKE FOR THE SESSION (2026-10-27): an auto-lock mid-lesson takes the microphone away. And back from
   * another app or the lock screen, the audio iOS interrupted resumes. (No Wake Lock in the browser: the session goes on.)
   */
  useEffect(() => {
    if (!start) return
    type Lock = { release: () => Promise<void> }
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Lock> } }).wakeLock
    let lock: Lock | null = null
    let gone = false
    const keepAwake = () => {
      if (!wakeLock || document.visibilityState !== 'visible') return
      void wakeLock.request('screen').then((l) => { if (gone) void l.release().catch(() => {}); else lock = l }).catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || ended.current) return
      keepAwake()
      const ctx = ctxRef.current
      if (ctx && ctx.state !== 'running') void ctx.resume().then(() => mark('audio: resumed')).catch(() => mark('audio: could not resume'))
    }
    keepAwake()
    document.addEventListener('visibilitychange', onVisible)
    return () => { gone = true; document.removeEventListener('visibilitychange', onVisible); void lock?.release().catch(() => {}) }
  }, [start])

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
    // iOS suspends or interrupts it (a call, Siri, the lock screen): in the trace — and resumed on the way back (below).
    ctx.onstatechange = () => mark(`audio: ${ctx.state}`)
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
    // Live listening opens alongside (a key from the server, then Soniox's socket); until then the screen says connecting.
    liveReopens.current = 0
    liveOpenedAt.current = 0
    setHearing('off')
    openLive(s.id)
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
      // Muted: what was said so far is dropped — live, its words too, and nothing more streams.
      if (liveUtterance.current) { liveStt.current?.cancel(); to16k.current = null; liveUtterance.current = false }
      clearCap()
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
  // The room the teacher set behind the avatar (backgrounds.ts): the intro shows the preview's, the session its own.
  const room = backgroundImage(start?.avatar.background ?? preview.background ?? DEFAULT_BACKGROUND)
  // ⛔ 'gone' first, whatever the phase or the mute (review, codex + opus): the session is about to end — say why.
  const status = hearing === 'gone' && phase !== 'ending' ? tr("Can't hear you right now — the practice will end", 'Hiện không nghe được — buổi luyện tập sẽ kết thúc')
    : muted ? tr('Muted', 'Đã tắt micro')
    : phase === 'listening' && hearing === 'off' ? tr('Connecting…', 'Đang kết nối…')
    : phase === 'listening' ? tr('Listening — just talk', 'Đang nghe — cứ nói nhé')
      : phase === 'hearing' ? tr('Listening…', 'Đang nghe…')
        : phase === 'thinking' ? tr('{name} is thinking…', '{name} đang nghĩ…').replace('{name}', name)
          : phase === 'speaking' ? tr('{name} is talking', '{name} đang nói').replace('{name}', name)
            : ''
  const note = notice ? refusalCopy(notice) : null
  const live = phase === 'listening' || phase === 'hearing' || phase === 'thinking' || phase === 'speaking'

  // The words' box follows the newest line (review, opus: a short screen kept the oldest in view).
  useEffect(() => {
    const box = wordsBox.current
    if (box) box.scrollTop = box.scrollHeight
  }, [avatarLine, captions, hint, learnerLine, live, showHint, waiting])
  const onCamera = async () => {
    hapticTap()
    const r = await selfView.toggle()
    if (r === 'blocked' || r === 'unsupported' || r === 'unavailable') setNotice(`camera_${r}`)
    else setNotice((n) => (n?.startsWith('camera_') ? null : n)) // a retry that worked clears the camera's own message
  }
  const cameraOffered = start?.band === 'adult'
  /** The round see-through buttons over the face (Praktika's): a white glyph on a dark disc; pressed = a lighter disc and
   *  the bold glyph (`icon-own-ink`). No blur at this size — and a blurred material takes no tint variants (design-lint). */
  const glass = 'icon-own-ink size-11 rounded-full bg-brand-deeper/50 text-primary-foreground hover:bg-brand-deeper/70 aria-pressed:bg-primary-foreground/25'

  return (
    <Dialog open onOpenChange={() => { /* only End closes a session */ }}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-brand-deeper p-0 text-primary-foreground sm:max-w-none"
      >
        <DialogTitle className="sr-only">{tr('Speaking practice', 'Luyện nói')}</DialogTitle>
        <DialogDescription className="sr-only">{preview.name}</DialogDescription>
        {/* A VIDEO CALL (owner, 2026-10-27: "as close as possible to … praktika"): the avatar fills the screen edge to edge,
            the controls float over it. MOBILE-FIRST: one phone-width column; a wide window keeps dark sides instead of a
            portrait room stretched blurry (review, opus). */}
        <div className="relative mx-auto h-full w-full max-w-md overflow-hidden">
          {room && (
            // The room the teacher set (backgrounds.ts); the face's canvas is transparent — the avatar stands in it.
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${room})` }} />
          )}
          <div className="absolute inset-0">
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
          </div>
          {/* Shade only where words sit — the top bar and the captions — so the face stays bright. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand-deeper/70 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-brand-deeper via-brand-deeper/60 to-transparent" />

          {showTrace && trace.length > 0 && (
            <ol className="pointer-events-none absolute left-2 top-20 z-10 max-h-[50%] overflow-hidden rounded-lg bg-brand-deeper/80 p-2 font-mono text-xs leading-tight text-primary-foreground/90">
              {trace.map((m, i) => <li key={i}>{formatMark(m)}</li>)}
            </ol>
          )}

          {/* The call's top bar: the hint · the avatar and the time left · captions. */}
          {/* z-10: above the intro too — captions can be set before Start (review, codex). */}
          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <IconButton size="lg" aria-pressed={showHint} aria-label={tr('Hint', 'Gợi ý')} disabled={!hint || !live} onClick={() => setShowHint((v) => !v)}
              className={cn(glass, 'disabled:opacity-40')}>
              <Lightbulb className="size-6" />
            </IconButton>
            <div className="min-w-0 text-center">
              <p className="truncate text-base font-semibold">{name}</p>
              <p className="text-xs text-primary-foreground/75">
                {tr('AI avatar', 'Avatar AI')}
                {live && <> · <span className="sr-only">{tr('Time left', 'Thời gian còn lại')} </span><span role="timer" className="tabular-nums">{minutes}:{secs}</span></>}
              </p>
            </div>
            <IconButton size="lg" aria-pressed={captions} aria-label={tr('Captions', 'Phụ đề')} onClick={() => setCaptions((v) => !v)} className={glass}>
              <Captions className="size-6" />
            </IconButton>
          </header>

          {/* Bottom: the learner's own camera (corner), the words, then the call's three buttons — never above the top bar
              (top-20): on a short screen the words give way first, scrolling in their own box (review, codex + opus). */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-20 flex flex-col justify-end gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:pointer-events-auto">
            {/* Whenever the camera is on — connecting and ending too: a camera light with no picture is a camera nobody
                can see to turn off (review, opus). */}
            {selfView.stream && (
              // self-start: a flex column stretches its children across — the tile keeps its 3:4 corner (review, codex + opus).
              <div className="aspect-[3/4] h-36 max-h-[22dvh] shrink-0 self-start overflow-hidden rounded-2xl border border-primary-foreground/25 bg-brand-deeper shadow-overlay">
                <SelfView stream={selfView.stream} label={tr('You (only on this phone)', 'Bạn (chỉ hiện trên điện thoại này)')} />
              </div>
            )}
            {live && !waiting && (
              <>
                {/* The words: their own scrolling box that follows the newest line (wordsBox) — the notice and the status
                    below it never scroll away. */}
                {(captions || (showHint && hint)) && (
                  <div ref={wordsBox} className="flex min-h-0 shrink flex-col gap-2 overflow-y-auto" aria-live="polite">
                    {captions && learnerLine && <p className="self-end rounded-2xl bg-primary-foreground/15 px-4 py-2 text-sm text-primary-foreground/90">{learnerLine}</p>}
                    {captions && avatarLine && <p className="text-base leading-relaxed">{avatarLine}</p>}
                    {showHint && hint && (
                      <div className="rounded-2xl bg-primary-foreground/15 px-4 py-3 text-sm">
                        <p>{hint.en}</p>
                        {hint.vi && <p lang="vi" className="mt-1 text-primary-foreground/75">{hint.vi}</p>}
                      </div>
                    )}
                  </div>
                )}
                {note && <p role="status" className="shrink-0 text-center text-sm text-primary-foreground/85">{tr(note.en, note.vi)}</p>}
                <p aria-live="polite" className={cn('flex shrink-0 items-center justify-center gap-2 text-sm text-primary-foreground/80', phase === 'hearing' && !muted && 'text-primary-foreground')}>
                  {!muted && (phase === 'listening' || phase === 'hearing') && hearing === 'on' && (
                    <span aria-hidden className={cn('size-2 rounded-full bg-success', phase === 'hearing' && 'animate-pulse')} />
                  )}
                  {status}
                </p>
              </>
            )}
            {/* Pressed = a light fill + the bold glyph in the button's own white (`icon-own-ink`): the house accent-blue
                pressed glyph all but vanished on this dark screen (the 390px check). Not before Start: the intro's own
                buttons sit there. */}
            {phase !== 'intro' && phase !== 'mic_denied' && (
            <div className="flex shrink-0 items-center justify-between rounded-full bg-black/50 px-5 py-2.5 material backdrop-blur-md">
              {cameraOffered ? (
                <IconButton size="lg" aria-pressed={!!selfView.stream} disabled={(!live || waiting) && !selfView.stream} onClick={() => void onCamera()}
                  aria-label={selfView.stream ? tr('Hide my camera', 'Ẩn camera của tôi') : tr('Show my camera — only on this phone', 'Hiện camera của tôi — chỉ trên điện thoại này')}
                  className="icon-own-ink h-14 w-14 text-primary-foreground hover:bg-primary-foreground/10 disabled:opacity-40 aria-pressed:bg-primary-foreground/20">
                  <Video className="size-6" />
                </IconButton>
              ) : <span aria-hidden className="h-14 w-14" />}
              <Button
                size="none"
                variant="bare"
                onClick={toggleMute}
                disabled={!live}
                aria-label={muted ? tr('Unmute', 'Bật micro') : tr('Mute', 'Tắt micro')}
                aria-pressed={muted}
                className={cn('size-14 rounded-full disabled:opacity-40', muted ? 'bg-primary-foreground text-brand-deeper' : 'bg-primary-foreground/15 text-primary-foreground')}
              >
                {muted ? <MicOff className="size-7" strokeWidth={STROKE_UI} /> : <Mic className="size-7" strokeWidth={STROKE_UI} />}
              </Button>
              <IconButton size="lg" aria-label={tr('End', 'Kết thúc')} onClick={() => void end('learner')} disabled={phase === 'ending'}
                className="h-14 w-14 bg-destructive text-destructive-foreground hover:bg-destructive/90">
                <PhoneOff className="size-6" />
              </IconButton>
            </div>
            )}
          </div>

          {phase === 'intro' && (
            <div className="absolute inset-0 flex flex-col items-center justify-end gap-4 bg-brand-deeper/60 p-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center">
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
            <div className="absolute inset-x-0 top-24 flex justify-center" role="status">
              <span className="rounded-full bg-black/50 px-4 py-2 text-sm material backdrop-blur-md">{tr('Connecting to {name}…', 'Đang kết nối với {name}…').replace('{name}', name)}</span>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The learner's own camera, mirrored like a mirror (a call's self-view). Muted — it is a picture, never a microphone. */
function SelfView({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.srcObject = stream
    void v.play().catch(() => { /* autoplay of a muted inline video is allowed; a refusal leaves the first frame */ })
    return () => { v.srcObject = null }
  }, [stream])
  return <video ref={ref} aria-label={label} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
}
