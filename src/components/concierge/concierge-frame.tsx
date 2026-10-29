'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Mic, MicOff } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { isNativeAppClient, isNativeVoiceClient } from '@/lib/app-review-gates'
import { framedByHost } from '@/lib/concierge/frame-head'
import { hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { streamTo16k } from '@/lib/classroom/wav'
import { audioNeedsGesture } from '@/components/classroom/session/avatar-stage'
import { bufferFromPcm16, decodeLine, partPlayer, pcmFromBase64, resamplePcm16 } from '@/components/classroom/session/voice'
import { useRecorder, type MicState } from '@/components/classroom/session/use-recorder'
import { isFiller, openLiveStt, type LiveStt } from '@/components/classroom/session/live-stt'
import { beginTrace, mark } from '@/components/classroom/session/trace'
import { guidedPageLang, type ConciergeMessage } from '@/lib/concierge/client'
import type { GuideFaceConfig } from '@/lib/concierge/guide-assets'
import { FACE_PCM_RATE, GuideFace, type GuideHandle } from './guide-face'

/**
 * THE VOICE CONCIERGE'S WINDOW — the page inside the floating frame (src/components/concierge/concierge-host.tsx). The
 * classroom session's turn-taking, kept as it was proven there (src/components/classroom/session/session-screen.tsx — every
 * guard below carries a fix from a review round), for eno's guide instead of a tutor: one Start tap, then the person just
 * talks; the answer moves the app (a `go` line → the host) while the avatar says what it did and asks one question.
 *
 * ⚠️ A COPY OF THE ENGINE, ON PURPOSE (plan review 2026-10-27: defensible for the MVP, a dated follow-up to extract it): the
 * classroom was deployed the same day for the owner's phone test, and its 1,000-line screen is not refactored under it.
 * Differences, each deliberate: no clip path (the turn route takes words only — without live listening the chips still
 * work), no drills, no clock on screen (the session ends itself — config.ts), and the window CLOSES after IDLE_MS of
 * silence or at the session's end: the listening stream is billed while it is open, idle included.
 * The face is the guide drawn in this browser (guide-face.tsx — TalkingHead, since 2026-10-28; Spatius before): it plays
 * the guide's voice itself and needs no token.
 */
type Phase = 'intro' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'mic_denied' | 'refused'

type Line =
  | { kind: 'heard'; learnerText: string }
  | { kind: 'go'; href: string; label: string; closes: boolean }
  | { kind: 'say'; part: number; text: string }
  | { kind: 'pcm'; part: number; rate: number; data: string }
  | { kind: 'part-end'; part: number; last: boolean }
  | { kind: 'audio-failed'; part: number }
  | { kind: 'chips'; chips: string[] }
  | { kind: 'error'; error: string }
  | { kind: 'bye' }
  | { kind: 'end' }

type Started = { session: string; deadline: number; face: GuideFaceConfig | null; opening: { text: string; audio: string | null } }
type HistoryItem = { role: 'user' | 'assistant'; text: string }

/** How long one answer may take (the route runs 40 s at most). */
const TURN_WAIT_MS = 45_000
/** The silence that ends a turn when Soniox has not ended it (adults — use-recorder.ts). */
const PATIENCE_MS = 1_200
/** Behind Soniox's own end-of-turn cap, the page's backstop (session-screen.tsx LIVE_BACKSTOP_MS, adults). */
const LIVE_BACKSTOP_MS = 200
const REPLY_GRACE_MS = 5_000
const FACE_PREP_MS = 20_000
const FACE_CONNECT_MS = 8_000
const OPENING_PLAY_MS = 5_000
const FACE_TALKOVER_GRACE_MS = 3_000
const LIVE_CHUNK = 1_600
const LIVE_WORDS_MS = 3_000
const LIVE_TEXT_MAX_CHARS = 1_000
/** Nobody spoke and nothing was said for this long: the window closes (an open listening stream is billed). */
const IDLE_MS = 90_000
const HISTORY_ITEMS = 12
/** How long the start (the session, the opening's voice) may take. */
const START_WAIT_MS = 15_000
/** How long each of eno's facts stays on the start screen. */
const FACT_MS = 5_000

const freshReply = (id: number) => ({ id, given: 0, lastGiven: false, played: false, audioMs: 0, startedAt: 0, toFace: false, armed: false })

/** The page under the window: its public path + query (same origin, so the frame may read it). */
function parentHref(): string {
  try { return `${window.parent.location.pathname}${window.parent.location.search}` } catch { return '/' }
}
/** To the host — never anywhere else (the host checks the sender is its frame, and the path again). */
function toHost(m: ConciergeMessage): void {
  if (window.parent === window) return
  window.parent.postMessage(m, window.location.origin)
}

export function ConciergeFrame({ face: initialFace, open }: { face: GuideFaceConfig | null; open: boolean }) {
  const { tr, lang } = useLanguage()
  const [phase, setPhase] = useState<Phase>('intro')
  const [mode, setMode] = useState<'avatar' | 'voice'>(initialFace ? 'avatar' : 'voice')
  const [prep, setPrep] = useState<'drawing' | 'ready'>(initialFace ? 'drawing' : 'ready')
  const [muted, setMuted] = useState(false)
  const [caption, setCaption] = useState('')
  const [heardLine, setHeardLine] = useState('')
  const [chips, setChips] = useState<string[]>([])
  /**
   * ⛔ NO LIVE LISTENING, NO DEAD END (review, codex): the window takes words only, so without its ears the person could
   * do nothing but close it. These taps go as what they said (the guide understands Vietnamese too) — only while no answer
   * has offered its own.
   */
  const offerStarters = () => setChips((c) => (c.length ? c : [
    tr('Find a teacher', 'Tìm giáo viên'), tr('Homes to rent', 'Nhà cho thuê'), tr('Jobs', 'Việc làm'), tr('How does eno work?', 'eno hoạt động thế nào?'),
  ]))
  const startersRef = useRef(offerStarters)
  startersRef.current = offerStarters
  const [notice, setNotice] = useState<string | null>(null)
  /** The microphone is down (use-recorder.ts MicState not 'on'): its line shows under no other notice. */
  const [micDown, setMicDown] = useState(false)
  /** Live listening is off for this window (refused, or failed): the chips still work, and so does the text assistant. */
  const [deaf, setDeaf] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  /**
   * THE START SCREEN'S FACTS (owner, 2026-10-28: "get rid of this message have something interesting about eno while user
   * waits"; the processor sentence it replaced lives on /privacy — owner: "processor not important add to privacy"). eno's
   * own facts, one at a time — each one the guide's brief already states (brief.ts KNOWLEDGE): never a promise of safety,
   * never a feature eno.vn does not have.
   */
  const facts = [
    tr('Browsing, posting and messaging sellers on eno are currently free, and eno takes no commission on a sale.', 'Xem tin, đăng tin và nhắn tin cho người bán trên eno hiện đều miễn phí, eno không thu hoa hồng khi bán.'),
    tr("Pick up to 5 rentals and tap Check these for me: eno's team asks the landlords for you, free.", 'Chọn tối đa 5 căn cho thuê rồi bấm Kiểm tra giúp tôi: đội ngũ eno hỏi chủ nhà giúp bạn, miễn phí.'),
    tr('The HCMC Rent Index shows the median asking rent in each district, updated daily.', 'Chỉ số giá thuê nhà TP.HCM cho biết giá chào thuê trung vị ở từng quận, cập nhật mỗi ngày.'),
    tr('See schools rated by teachers at eno.vn/schools.', 'Xem các trường được giáo viên đánh giá tại eno.vn/schools.'),
    tr('eno works in 11 languages, and chats are translated for you.', 'eno có 11 ngôn ngữ, và tin nhắn được dịch tự động cho bạn.'),
    tr('Make an offer in the chat: the seller can accept, decline or counter.', 'Trả giá ngay trong chat: người bán có thể đồng ý, từ chối hoặc trả giá lại.'),
    tr("A seller's phone shows only after they reply to you in the chat.", 'Số điện thoại của người bán chỉ hiện sau khi họ trả lời bạn trong chat.'),
    tr('Teachers can make a free profile at teacher.eno.vn.', 'Giáo viên có thể tạo hồ sơ miễn phí tại teacher.eno.vn.'),
    tr('eno never asks you for money for a listed item: no deposit, no holding fee.', 'eno không bao giờ đòi bạn trả tiền cho món hàng: không đặt cọc, không phí giữ chỗ.'),
  ]
  const [fact, setFact] = useState(0)
  useEffect(() => {
    if (phase !== 'intro') return
    const t = setInterval(() => setFact((n) => n + 1), FACT_MS)
    return () => clearInterval(t)
  }, [phase])
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const go = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p) }, [])
  const modeRef = useRef(mode)
  modeRef.current = mode
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const session = useRef<Started | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const player = useRef<ReturnType<typeof partPlayer> | null>(null)
  const stage = useRef<GuideHandle>(null)
  const opening = useRef<AudioBuffer | null>(null)
  const reply = useRef(freshReply(0))
  const ended = useRef(false)
  const turnAbort = useRef<AbortController | null>(null)
  const liveStt = useRef<LiveStt | null>(null)
  /**
   * The session's end on THIS device's monotonic clock (review, opus: comparing the server's deadline with a phone clock
   * running fast closed the window right after Start). From the start answer's own Date header — the server's "now".
   */
  const endsAt = useRef(0)
  /** Live listening is still connecting (the first second or two after Start): words said now are not lost to a fault. */
  const liveConnecting = useRef(false)
  const to16k = useRef<((f: Float32Array) => Int16Array) | null>(null)
  const pending16k = useRef<Int16Array[]>([])
  const awaitingWords = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveUtterance = useRef(false)
  const vadEnded = useRef(false)
  const held = useRef({ text: '', ms: 0 })
  const turnGen = useRef(0)
  const faceLive = useRef(false)
  const faceGone = useRef(!initialFace)
  const openingSaid = useRef(false)
  const openingAtFace = useRef<{ id: number; buffer: AudioBuffer; timer: ReturnType<typeof setTimeout> } | null>(null)
  const history = useRef<HistoryItem[]>([])
  const lastActivity = useRef(Date.now())
  /**
   * The turn whose answer was a GOODBYE (turn.ts `bye` — owner, 2026-10-28: "when someone says good bye it should turn off
   * itself"): when that answer's voice has played, the window closes instead of listening again. A newer turn — talking
   * over the thank-you, a chip — has another number, so a goodbye the person talked over is no goodbye (plan review, opus).
   */
  const byeTurn = useRef(0)
  /**
   * However the window closes — a goodbye, idle, the session's end, a hidden tab — it closes ONCE. ⚠️ Per OPENING: this frame
   * is the iframe's own document, which the host creates on open and removes on close (concierge-host.tsx renders nothing
   * while closed) — so `closed`, `byeTurn` and the hidden-tab listener live and die with one opening, never a next one.
   */
  const closed = useRef(false)
  const closeRef = useRef<(why: string) => void>(() => {})
  /** A Start under way (begin): a second tap is ignored. */
  const starting = useRef(false)
  const touch = () => { lastActivity.current = Date.now() }

  const handlers = useRef({
    speechStart: () => {}, speechEnd: () => {}, autoStop: (_wav: Uint8Array) => {}, frames: (_f: Float32Array) => {},
    utterance: (_text: string, _ms: number) => {}, liveFailed: () => {}, mic: (_m: MicState) => {},
  })
  const rec = useRecorder({
    speechStart: () => handlers.current.speechStart(),
    speechEnd: () => handlers.current.speechEnd(),
    autoStop: (wav) => handlers.current.autoStop(wav),
    frames: (f) => handlers.current.frames(f),
    // The microphone (use-recorder.ts MicState): stopped or blocked — said; never closes the window by itself.
    mic: (m) => handlers.current.mic(m),
  })
  const releaseRec = rec.release

  const dropFace = useCallback(() => {
    faceGone.current = true
    faceLive.current = false
    modeRef.current = 'voice'
    setMode('voice')
    setPrep('ready')
  }, [])

  useEffect(() => {
    if (prep !== 'drawing') return
    const t = setTimeout(() => { mark('face: not drawn in time — voice-only'); dropFace() }, FACE_PREP_MS)
    return () => clearTimeout(t)
  }, [dropFace, prep])

  const patience = useCallback(() => {
    const l = liveStt.current
    return l ? Math.max(PATIENCE_MS, l.maxDelayMs + LIVE_BACKSTOP_MS) : PATIENCE_MS
  }, [])

  const listen = useCallback(() => {
    if (ended.current) return
    // Every way an answer's voice finishes (the speakers, the face, the watchdog, nothing to say) comes back here.
    if (byeTurn.current && byeTurn.current === turnGen.current) { closeRef.current('goodbye'); return }
    go('listening')
    // Without its ears the window still offers something to tap after every answer (offerStarters keeps an answer's own).
    if (session.current && !liveStt.current) startersRef.current()
    if (mutedRef.current) { rec.unlisten(); return }
    rec.listen({ endMs: patience(), barge: false })
    mark('listening')
  }, [go, patience, rec])

  const stopSpeaking = useCallback(() => {
    player.current?.stop()
    stage.current?.interrupt()
  }, [])

  const armBargeIn = useCallback(() => {
    const r = reply.current
    if (r.armed || mutedRef.current || ended.current || phaseRef.current !== 'speaking') return
    r.armed = true
    rec.listen({ endMs: patience(), barge: true })
  }, [patience, rec])

  /** Some of the guide's line — raw PCM from the voice server, or the opening — to the face when it is live, else the speakers. */
  const give = useCallback((audio: AudioBuffer | { pcm: Int16Array; rate: number }, last: boolean) => {
    if (ended.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    const r = reply.current
    // ⛔ Nothing after the reply's end: to the face, a send after its end flag starts a new reply over this one.
    if (r.lastGiven) { mark('audio after the reply ended — dropped'); return }
    touch()
    if (r.given === 0) {
      r.startedAt = performance.now()
      r.toFace = modeRef.current === 'avatar' && faceLive.current
      if (r.toFace) { const id = r.id; setTimeout(() => { if (reply.current.id === id) armBargeIn() }, FACE_TALKOVER_GRACE_MS) }
    }
    if (phaseRef.current !== 'speaking') { go('speaking'); mark('first sound out') }
    if (!r.toFace) armBargeIn()
    r.given += 1
    r.audioMs += audio instanceof AudioBuffer ? audio.duration * 1000 : (audio.pcm.length / audio.rate) * 1000
    if (last) {
      r.lastGiven = true
      // ⛔ Never stuck on "talking": whatever the face or the speakers fail to report, the person's turn comes back.
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
      const ok = audio instanceof AudioBuffer ? stage.current?.speakPart(audio, last) : stage.current?.speakPcm(resamplePcm16(audio.pcm, audio.rate, FACE_PCM_RATE), last)
      if (ok) return
      r.toFace = false
      armBargeIn()
    }
    setWaiting(false)
    const buffer = audio instanceof AudioBuffer ? audio : bufferFromPcm16(ctx, audio.pcm, audio.rate)
    player.current ??= partPlayer(ctx)
    // ⛔ THIS reply's end only (pre-review, codex): a talked-over reply's late completion never hands back a newer one.
    const id = r.id
    void player.current.play(buffer).then(() => {
      if (last && reply.current.id === id && !ended.current && phaseRef.current === 'speaking') { mark('voice: done'); listen() }
    })
  }, [armBargeIn, go, listen, stopSpeaking])

  /** However the window goes — ✕ (the frame is removed), idle, the session's end — the microphone and the audio go with it. */
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

  /** The session ends now (its tokens stop being renewed) — once; on the way out, with keepalive. */
  const endSession = useCallback(() => {
    if (ended.current) return
    ended.current = true
    const s = session.current
    if (s) void fetch('/api/concierge/end', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: s.session }) }).catch(() => {})
  }, [])
  const releaseRef = useRef(releaseAll)
  releaseRef.current = releaseAll
  // ⚠️ MOUNT-ONCE: the frame being removed (✕) or the page leaving ends the session and frees the microphone.
  useEffect(() => {
    ended.current = false
    const leave = () => { endSession(); releaseRef.current() }
    // Back to a page the browser kept (back-forward cache): its session ended when it was hidden — the window closes
    // rather than show a guide that can no longer answer (review, codex).
    const back = (e: PageTransitionEvent) => { if (e.persisted) toHost({ type: 'eno-concierge:close' }) }
    // Escape with the focus in here: a key in a frame never reaches the page's dialog (review, codex + opus).
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') toHost({ type: 'eno-concierge:close' }) }
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', back)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('pageshow', back)
      window.removeEventListener('keydown', esc)
      leave()
    }
  }, [endSession])

  /**
   * THE TEXT ASSISTANT INSTEAD (owner, 2026-10-28: "fallback old verion eno ai in chat") — wherever the voice guide cannot
   * help: closed for this account, its day (or the site's) used up, no microphone, no ears. The window closes and the app
   * opens eno AI's chat (/messages/ai — the host navigates).
   */
  const toChat = useCallback(() => {
    hapticTap()
    mark('to the text assistant')
    endSession()
    releaseAll()
    toHost({ type: 'eno-concierge:chat' })
  }, [endSession, releaseAll])

  /** Done here (idle, the session's end, refused, a goodbye, a hidden tab): the host closes the window, which ends everything
   *  above. Once — whichever comes first; the microphone and the voice go even if the end's POST fails. */
  const closeWindow = useCallback((why: string) => {
    if (closed.current) return
    closed.current = true
    mark(`closing: ${why}`)
    endSession()
    releaseAll()
    toHost({ type: 'eno-concierge:close' })
  }, [endSession, releaseAll])
  closeRef.current = closeWindow

  // ⛔ A HIDDEN TAB CLOSES THE WINDOW (owner, 2026-10-28: "when user switches tab without closing concierge concierge should
  // close so it wont waste tokens and tts sst money"): live listening and the voice are billed while they are open, and a
  // phone suspends a hidden page's timers — so at once, not after a delay that may never run.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') closeRef.current('tab hidden') }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const readAnswer = async (res: Response, onLine: (l: Line) => void) => {
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
        if (line) onLine(JSON.parse(line) as Line)
      }
    }
  }

  /** The reply is over (its last frames came, or never will): close it once, so the face or the speakers hand the turn back. */
  const closeReply = () => {
    const ctx = ctxRef.current
    if (!ctx || ended.current || phaseRef.current === 'hearing' || reply.current.lastGiven) return
    if (reply.current.given === 0) { listen(); return }
    give({ pcm: new Int16Array(Math.round(ctx.sampleRate * 0.02)), rate: ctx.sampleRate }, true)
  }

  /** One thing the person said (live words, or a chip they tapped) → the answer: where the app goes, then the guide's voice. */
  const sendTurn = async (transcript: string) => {
    const s = session.current
    if (!s || ended.current) return
    const gen = ++turnGen.current
    // One answer at a time (pre-review, codex): a chip tapped while the last answer streams stops that one.
    turnAbort.current?.abort()
    rec.unlisten()
    go('thinking')
    setChips([])
    setHeardLine(transcript)
    touch()
    mark('sent', `${transcript.length} chars`)
    const abort = new AbortController()
    turnAbort.current = abort
    const timer = setTimeout(() => abort.abort(), TURN_WAIT_MS)
    reply.current = freshReply(reply.current.id + 1)
    let chain: Promise<void> = Promise.resolve()
    let spoken = ''
    try {
      const res = await fetch('/api/concierge/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: s.session, transcript, href: parentHref(), lang: guidedPageLang(lang), history: history.current }),
        signal: abort.signal,
      })
      if (!res.ok) {
        clearTimeout(timer)
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (ended.current || gen !== turnGen.current) return
        if (body.error === 'session_over' || body.error === 'forbidden') { closeWindow(body.error); return }
        setNotice(body.error ?? 'network')
        listen()
        return
      }
      await readAnswer(res, (l) => {
        if (ended.current || gen !== turnGen.current) return
        if (l.kind === 'heard') { setHeardLine(l.learnerText); setCaption(''); return }
        if (l.kind === 'go') {
          mark('go', l.label)
          toHost({ type: 'eno-concierge:go', href: l.href, closes: l.closes })
          return
        }
        if (l.kind === 'say') {
          if (!spoken) mark('first sentence')
          spoken = spoken ? `${spoken} ${l.text}` : l.text
          setCaption(spoken)
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
        if (l.kind === 'chips') { setChips(l.chips); return }
        if (l.kind === 'bye') {
          mark('goodbye')
          byeTurn.current = gen
          // Its voice already played (or there was none): nothing more comes back to listen() — closed now.
          if (phaseRef.current === 'listening') closeRef.current('goodbye')
          return
        }
        if (l.kind === 'error') { mark('no answer', l.error); setNotice(l.error) }
      })
      clearTimeout(timer)
      await chain
      if (gen !== turnGen.current) return
      history.current = [...history.current, { role: 'user' as const, text: transcript.slice(0, 600) }, ...(spoken ? [{ role: 'assistant' as const, text: spoken.slice(0, 600) }] : [])].slice(-HISTORY_ITEMS)
      if (!ended.current && reply.current.given > 0 && !reply.current.lastGiven && phaseRef.current !== 'hearing') {
        mark('reply cut off — closing it')
        closeReply()
      }
    } catch {
      clearTimeout(timer)
      if (ended.current || gen !== turnGen.current || (abort.signal.aborted && phaseRef.current === 'hearing')) return
      stopSpeaking()
      setNotice('network')
      listen()
      return
    }
    if (ended.current || gen !== turnGen.current) return
    if (reply.current.given === 0 && phaseRef.current !== 'listening') listen()
  }

  // ── the detector's events (refs: the recorder calls these from its worklet) ──
  handlers.current.speechStart = () => {
    const p = phaseRef.current
    if (ended.current || mutedRef.current) return
    if (p === 'speaking') {
      mark('talked over the guide')
      turnGen.current += 1
      turnAbort.current?.abort()
      stopSpeaking()
    } else if (p !== 'listening') return
    touch()
    beginTrace('speaking')
    go('hearing')
    const l = liveStt.current
    liveUtterance.current = !!(l && ctxRef.current)
    vadEnded.current = false
    held.current = { text: '', ms: 0 }
    if (l && ctxRef.current) {
      to16k.current = streamTo16k(ctxRef.current.sampleRate)
      pending16k.current = []
      l.begin()
    }
  }
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
    pending16k.current.push(pcm)
    if (pending16k.current.reduce((n, a) => n + a.length, 0) >= LIVE_CHUNK) flushLive()
  }
  /** The words are owed after the person stopped: if they never come, back to listening (no clip path here). */
  const owe = () => {
    if (awaitingWords.current) clearTimeout(awaitingWords.current)
    awaitingWords.current = setTimeout(() => {
      awaitingWords.current = null
      if (ended.current || phaseRef.current !== 'hearing') return
      mark('live listening: no words in time')
      liveStt.current?.cancel()
      to16k.current = null
      rec.take()
      listen()
    }, LIVE_WORDS_MS)
  }
  handlers.current.speechEnd = () => {
    if (ended.current || phaseRef.current !== 'hearing') return
    mark('person stopped')
    vadEnded.current = true
    if (liveStt.current && liveUtterance.current) { flushLive(); liveStt.current.finalize(); owe(); return }
    // Not heard live: the socket was still connecting (review, codex — then it is "say that again", not a fault), or it
    // is off (the chips still work).
    rec.take()
    setNotice(liveConnecting.current ? 'not_ready' : 'speech_unavailable')
    listen()
  }
  handlers.current.autoStop = () => {
    if (ended.current || phaseRef.current !== 'hearing') return
    if (liveStt.current && liveUtterance.current) { flushLive(); liveStt.current.finalize(); owe(); return }
    listen()
  }
  handlers.current.utterance = (text, ms) => {
    if (ended.current || phaseRef.current !== 'hearing' || !liveUtterance.current) return
    const words = [held.current.text, text].filter(Boolean).join(' ').trim()
    // ⛔ A lone filler while the person is still talking is not a turn: kept, and the stream goes on.
    if (text && !vadEnded.current && isFiller(text)) {
      held.current = { text: words, ms: held.current.ms + ms }
      liveStt.current?.begin()
      return
    }
    if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
    held.current = { text: '', ms: 0 }
    liveStt.current?.pause()
    flushLive()
    to16k.current = null
    rec.take()
    if (!words) { mark('heard nothing (live)'); listen(); return }
    mark('heard live', `${words.length} chars`)
    void sendTurn(words.slice(0, LIVE_TEXT_MAX_CHARS))
  }
  // The microphone's own line, KEPT while it is down — shown whenever no other notice is (commit review, codex + opus: a
  // notice slot it shared could hide it for good, or wipe another).
  handlers.current.mic = (m) => setMicDown(m !== 'on')
  handlers.current.liveFailed = () => {
    liveStt.current = null
    to16k.current = null
    mark('live listening: off')
    setNotice('speech_unavailable')
    setDeaf(true)
    offerStarters()
    if (awaitingWords.current && !ended.current && phaseRef.current === 'hearing') {
      clearTimeout(awaitingWords.current)
      awaitingWords.current = null
      rec.take()
      listen()
    }
  }

  // ── idle and the session's end: the window closes itself (an open listening stream is billed) ──
  useEffect(() => {
    const t = setInterval(() => {
      const s = session.current
      if (!s || ended.current) return
      if (performance.now() >= endsAt.current - 2_000) { closeWindow('session over'); return }
      const p = phaseRef.current
      if ((p === 'listening' || p === 'connecting') && Date.now() - lastActivity.current > IDLE_MS) closeWindow('idle')
    }, 5_000)
    return () => clearInterval(t)
  }, [closeWindow])

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4_000); return () => clearTimeout(t) }, [notice])

  const openingToSpeakers = useCallback((id: number, why: string): boolean => {
    const o = openingAtFace.current
    if (!o || o.id !== id) return false
    openingAtFace.current = null
    clearTimeout(o.timer)
    if (ended.current || reply.current.id !== id || reply.current.played || !reply.current.toFace) return false
    mark(why)
    stage.current?.interrupt()
    dropFace()
    reply.current = freshReply(id + 1)
    give(o.buffer, true)
    return true
  }, [dropFace, give])

  /** The opening line — ONE owner: the face when it is live, else the speakers; then the person's turn. */
  const sayOpening = useCallback(() => {
    if (ended.current || openingSaid.current) return
    openingSaid.current = true
    const b = opening.current
    opening.current = null
    if (!b) { setWaiting(false); listen(); return }
    reply.current = freshReply(reply.current.id + 1)
    give(b, true)
    if (!reply.current.toFace) return
    const id = reply.current.id
    openingAtFace.current = { id, buffer: b, timer: setTimeout(() => { openingToSpeakers(id, 'face: the opening never started — the speakers say it') }, OPENING_PLAY_MS) }
  }, [give, listen, openingToSpeakers])

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
    if (phaseRef.current === 'speaking' && reply.current.lastGiven && reply.current.played) { mark('face: done'); listen() }
  }, [armBargeIn, listen])

  /** The Start tap: the face's audio (inside this tap — iOS), the microphone, then the session, live listening and the face. */
  const begin = async () => {
    // ⛔ ONE START AT A TIME (pre-review, codex): a second tap while the first is starting would make a second session.
    if (starting.current || session.current) return
    starting.current = true
    try { await startOnce() } finally { starting.current = false }
  }
  const startOnce = async () => {
    /**
     * ⛔ IN THE APPS, ONLY THE HOST'S OWN WINDOW STARTS (owner, 2026-10-29; App Store 5.1.2(i)) — framed by the host, which
     * asked for the person's "yes" before opening it and closes it when the answer is taken back (frame-head.ts
     * framedByHost). A window reached any other way — a link straight to this page — and an app binary that cannot hear
     * never start, before the microphone: eno AI's text chat.
     */
    if (isNativeAppClient() && (!isNativeVoiceClient() || !framedByHost())) { toChat(); return }
    hapticTap()
    setRefusal(null)
    beginTrace('start')
    const primed = modeRef.current === 'avatar' && !!stage.current?.prime()
    if (primed) mark('face: audio started in the tap')
    else if (modeRef.current === 'avatar' && audioNeedsGesture()) { mark('face: audio not started in the tap — voice-only'); dropFace() }
    try {
      const ctx = ctxRef.current ?? new AudioContext()
      ctxRef.current = ctx
      await ctx.resume()
      await rec.prepare(ctx)
    } catch {
      if (ended.current) return
      releaseAll()
      go('mic_denied')
      return
    }
    const ctx = ctxRef.current
    if (ended.current || !ctx) { releaseAll(); return }
    mark('mic ready')
    go('connecting')
    setWaiting(true)
    // Bounded (pre-review, codex): a start that never answers must not hold the microphone open with no session.
    // The guided page's language: the guide's opening and voice are in it (src/lib/concierge/i18n).
    const r = await fetch(`/api/concierge/start?lang=${encodeURIComponent(guidedPageLang(lang))}`, { method: 'POST', signal: AbortSignal.timeout(START_WAIT_MS) }).catch(() => null)
    const body = (await r?.json().catch(() => ({}))) as Partial<Started> & { error?: string }
    if (ended.current) {
      // ⛔ The window closed while this start was in flight: the session it made has no window — ended now.
      if (body?.session) void fetch('/api/concierge/end', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: body.session }) }).catch(() => {})
      return
    }
    if (!r?.ok || !body.session || !body.opening) {
      releaseAll()
      setWaiting(false)
      setRefusal(body?.error ?? 'network')
      go('refused')
      return
    }
    const s = body as Started
    const serverNow = Date.parse(r.headers.get('date') ?? '')
    endsAt.current = performance.now() + (s.deadline - (Number.isFinite(serverNow) ? serverNow : Date.now()))
    session.current = s
    mark('session started')
    touch()
    setCaption(s.opening.text)
    liveConnecting.current = true
    void openLiveStt({
      grant: (signal) => fetch('/api/concierge/stt-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: s.session, lang: guidedPageLang(lang) }), signal }),
      check: () => fetch(`/api/concierge/stt-token?session=${encodeURIComponent(s.session)}`, { method: 'GET' }),
    }, { utterance: (t, ms) => handlers.current.utterance(t, ms), failed: () => handlers.current.liveFailed() }).then((l) => {
      liveConnecting.current = false
      if (ended.current) { if (l && l !== 'refused') l.close(); return }
      // The server's own final no (the session is over): nothing more can be heard — the window closes.
      if (l === 'refused') { closeWindow('listening refused'); return }
      liveStt.current = l
      if (!l) { setNotice('speech_unavailable'); setDeaf(true); offerStarters() }
    })
    const audio = s.opening.audio ? decodeLine(ctx, s.opening.audio).catch(() => null) : Promise.resolve(null)
    const withFace = modeRef.current === 'avatar' && !faceGone.current && !!s.face
    // The drawn face opens its stream (no token: it is drawn in this browser) — bounded, like any start step.
    const connected = withFace
      ? await Promise.race([stage.current?.connect() ?? Promise.resolve(false), new Promise<boolean>((res) => setTimeout(() => res(false), FACE_CONNECT_MS))])
      : false
    opening.current = await audio
    if (ended.current) return
    if (connected && modeRef.current === 'avatar' && !faceGone.current) { faceLive.current = true; mark('face: live') }
    else if (withFace && !faceGone.current) { mark('face: not connected in time — voice-only'); dropFace() }
    sayOpening()
  }

  const onFallback = useCallback(() => {
    if (faceGone.current) return
    mark('face: fell back to voice')
    const o = openingAtFace.current
    if (o && openingToSpeakers(o.id, 'face: failed before the opening sounded — the speakers say it')) return
    const wasFace = reply.current.toFace
    dropFace()
    if (phaseRef.current === 'speaking' && wasFace) { stopSpeaking(); listen() }
  }, [dropFace, listen, openingToSpeakers, stopSpeaking])

  const toggleMute = () => {
    hapticTap()
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    if (next) {
      if (phaseRef.current === 'hearing') { liveStt.current?.cancel(); to16k.current = null }
      if (awaitingWords.current) { clearTimeout(awaitingWords.current); awaitingWords.current = null }
      rec.unlisten()
      if (phaseRef.current === 'hearing') go('listening')
    } else if (phaseRef.current === 'listening') {
      listen()
    } else if (phaseRef.current === 'speaking') {
      rec.listen({ endMs: patience(), barge: true })
    }
  }

  /** A quick reply tapped: sent as what the person said (a fresh tap — the app's Back gets a real entry for its move). */
  const sendChip = (text: string) => {
    hapticTap()
    if (phaseRef.current === 'speaking') { turnGen.current += 1; turnAbort.current?.abort(); stopSpeaking() }
    void sendTurn(text)
  }

  const live = phase === 'listening' || phase === 'hearing' || phase === 'thinking' || phase === 'speaking'
  const status = muted ? tr('Muted', 'Đã tắt micro')
    : phase === 'listening' ? tr('Listening', 'Đang nghe')
      : phase === 'hearing' ? tr('Hearing you…', 'Đang nghe bạn…')
        : phase === 'thinking' ? tr('Thinking…', 'Đang nghĩ…')
          : phase === 'speaking' ? tr('Talking', 'Đang nói')
            : ''
  const noticeText = !notice && micDown ? tr("Your microphone stopped. If I can't hear you, close me and open me again.", 'Micro đã dừng. Nếu tôi không nghe được, hãy đóng và mở lại.')
    : notice === 'speech_unavailable' ? tr("I can't hear right now — tap a reply below.", 'Hiện không nghe được — hãy chạm một câu trả lời.')
    : notice === 'not_ready' ? tr('One moment — I was still connecting. Say that again?', 'Đợi chút — tôi vẫn đang kết nối. Bạn nói lại nhé?')
    : notice === 'rate_limited' ? tr('Too many questions — try again in a minute.', 'Quá nhiều câu hỏi — thử lại sau một phút.')
      : notice ? tr('Something went wrong — try again.', 'Đã có lỗi — hãy thử lại.') : null

  const chatButton = (
    <Button size="sm" variant="secondary" onClick={toChat}>{tr('Chat with eno AI', 'Chat với eno AI')}</Button>
  )

  if (!open) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-primary-foreground/80">
        {tr('The voice guide is not available for this account.', 'Trợ lý giọng nói chưa mở cho tài khoản này.')}
        {chatButton}
      </div>
    )
  }
  /** Nothing to retry: the account's day, or the site's, is used up — only the text assistant is offered. */
  const capped = phase === 'refused' && (refusal === 'limit_reached' || refusal === 'guide_busy')

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        <GuideFace
          ref={stage}
          mode={mode}
          face={initialFace}
          name={tr('eno guide', 'Trợ lý eno')}
          speaking={phase === 'speaking'}
          onDrawn={() => setPrep('ready')}
          onFallback={onFallback}
          onPlaying={onPlaying}
        />
      </div>

      {live && (
        <div className="absolute left-1 top-1 flex items-center gap-1">
          <IconButton
            size="sm"
            variant="overlay"
            aria-pressed={muted}
            aria-label={muted ? tr('Unmute', 'Bật micro') : tr('Mute', 'Tắt micro')}
            onClick={toggleMute}
            className={cn(phase === 'hearing' && !muted && 'ring-2 ring-primary-foreground')}
          >
            {muted ? <MicOff /> : <Mic />}
          </IconButton>
          <span className="rounded-full bg-brand-deeper/70 px-1.5 py-0.5 text-3xs font-medium text-primary-foreground">{status}</span>
        </div>
      )}

      {(phase === 'intro' || phase === 'refused' || phase === 'mic_denied') && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 bg-gradient-to-t from-brand-deeper/90 to-transparent p-2 pt-6 text-center">
          {phase === 'intro' && (
            <p key={fact % facts.length} className="text-3xs leading-snug text-primary-foreground/85">{facts[fact % facts.length]}</p>
          )}
          {phase === 'refused' && (
            <p className="text-3xs leading-snug text-primary-foreground/85">
              {refusal === 'limit_reached' ? tr("You've used today's 10 minutes with the guide.", 'Bạn đã dùng hết 10 phút hôm nay với trợ lý.')
                : refusal === 'guide_busy' ? tr('The voice guide is busy today.', 'Trợ lý giọng nói hôm nay đang bận.')
                  : tr("The guide couldn't start — try again.", 'Không bắt đầu được — hãy thử lại.')}
            </p>
          )}
          {phase === 'mic_denied' && (
            <p className="text-3xs leading-snug text-primary-foreground/85">
              {tr('Allow the microphone to talk to the guide.', 'Hãy cho phép micro để nói với trợ lý.')}
            </p>
          )}
          {!capped && (
            <Button size="sm" variant="cta" disabled={prep !== 'ready'} onClick={() => void begin()}>
              {prep !== 'ready' ? tr('Getting ready…', 'Đang chuẩn bị…') : tr('Start talking', 'Bắt đầu nói')}
            </Button>
          )}
          {phase !== 'intro' && chatButton}
          {/* The text assistant one tap away from the start too — the fallback, never only for a failure (owner, 2026-10-28:
              "the message one is fallback"). */}
          {phase === 'intro' && (
            <Button size="none" variant="link" className="text-3xs font-normal text-primary-foreground/85 underline" onClick={toChat}>
              {tr('Prefer typing? Chat with eno AI', 'Muốn gõ chữ? Chat với eno AI')}
            </Button>
          )}
        </div>
      )}

      {phase === 'connecting' && waiting && (
        <div className="absolute inset-x-0 bottom-2 text-center text-3xs text-primary-foreground/85">{tr('Connecting…', 'Đang kết nối…')}</div>
      )}

      {live && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-brand-deeper/90 to-transparent p-1.5 pt-6">
          {noticeText && <p className="text-3xs leading-snug text-primary-foreground">{noticeText}</p>}
          {(deaf || micDown) && phase !== 'hearing' && (
            <Button size="sm" variant="secondary" className="h-6 min-h-6 self-start rounded-full px-2 text-3xs" onClick={toChat}>
              {tr('Chat with eno AI', 'Chat với eno AI')}
            </Button>
          )}
          {(phase === 'thinking' || phase === 'hearing') && heardLine
            ? <p className="line-clamp-2 text-3xs italic leading-snug text-primary-foreground/80">{heardLine}</p>
            : caption && <p className="line-clamp-3 text-2xs leading-snug text-primary-foreground">{caption}</p>}
          {chips.length > 0 && phase !== 'hearing' && (
            <div className="flex flex-wrap gap-1">
              {chips.map((c) => (
                <Button key={c} size="sm" variant="secondary" className="h-6 min-h-6 rounded-full px-2 text-3xs" onClick={() => sendChip(c)}>{c}</Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
