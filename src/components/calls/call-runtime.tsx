'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { callEngine, type CallView } from '@/lib/calls/client/engine'
import { joinChannel, ringTopic } from '@/lib/calls/client/realtime'
import { setRuntimeMounted } from '@/lib/calls/client/presence'
import { logError } from '@/lib/log'
import { CallScreen } from './call-screen'

/**
 * In-app calls — the runtime the host loads for people who can call (call-host.tsx): it listens on ring:<me>,
 * keeps the page-level duties of a live call, and draws the ring and call screens from the engine's view.
 *
 * Page duties (DESIGN.md v3 §3.2 step 7, §5):
 *   · pagehide → hang up by beacon (no resume across a reload); beforeunload → ask before leaving a live call;
 *   · visibility → visible: take the wake lock again and resync;
 *   · the ringtone and the ringback tone come from Web Audio, unlocked by the first tap on the page (autoplay rules);
 *     vibration on phones that allow it; the tab title flashes while ringing in the background.
 */

export function useCallView(): CallView {
  return useSyncExternalStore(callEngine.subscribe, callEngine.getView, callEngine.getView)
}

export function CallRuntime({ userId }: { userId: string }) {
  const view = useCallView()

  // The call screen exists from here on: the thread's call buttons render only while it does (presence.ts).
  useEffect(() => {
    setRuntimeMounted(true)
    return () => setRuntimeMounted(false)
  }, [])

  // ring:<me> — ring / cancel / answered_elsewhere for every tab of this person.
  useEffect(() => {
    let channel: { close(): void } | null = null
    let closed = false
    let retry: number | undefined
    const askTheBox = () => {
      void import('@/lib/calls/client/api').then(({ getRingingCall }) => getRingingCall())
        .then((callId) => { if (callId && !closed) void callEngine.onRing(callId) })
    }
    const join = (attempt: number) => void joinChannel(ringTopic(userId), {
      onEvent: (ev) => {
        if (ev.kind === 'ring') void callEngine.onRing(ev.callId)
        else if (ev.kind === 'cancel') callEngine.stopRinging(ev.callId, 'cancelled')
        else if (ev.kind === 'answered_elsewhere') callEngine.stopRinging(ev.callId, 'answered_elsewhere')
      },
      // On every (re)subscribe, ask the box: a ring broadcast while this page loaded or its socket was down was never
      // heard (client review). Postgres is the truth, the broadcast only the fast path.
      onStatus: (s) => { if (s === 'SUBSCRIBED' && !closed) askTheBox() },
    }).then((c) => { if (closed) c.close(); else channel = c }).catch((e) => {
      // A join that failed (a chunk, a refused subscribe) is retried with a growing pause — never a silent tab
      // (client review) — and the box is asked meanwhile.
      logError(e, { op: 'calls.ringChannel' })
      if (closed) return
      askTheBox()
      retry = window.setTimeout(() => join(attempt + 1), Math.min(60_000, 5_000 * 2 ** attempt))
    })
    join(0)
    return () => { closed = true; window.clearTimeout(retry); channel?.close() }
  }, [userId])

  // Page duties of a live call.
  useEffect(() => {
    const onPageHide = () => callEngine.onPageHide()
    const onVisible = () => { if (document.visibilityState === 'visible') callEngine.onVisible() }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const phase = callEngine.getView().phase
      if (phase === 'connected' || phase === 'connecting' || phase === 'reconnecting' || phase === 'outgoing') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useTones(view.phase)
  useTitleFlash(view.phase === 'incoming', view.peer?.name ?? null)

  return <CallScreen view={view} />
}

/** Ringtone (incoming) and ringback (outgoing), synthesised — no audio asset to fetch or to fail to autoplay. */
function useTones(phase: CallView['phase']) {
  const ctxRef = useRef<AudioContext | null>(null)
  /** A ring or a ringback is playing now — the only time the context may run. */
  const toneDue = useRef(false)
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!ctxRef.current && Ctor) ctxRef.current = new Ctor()
        const ctx = ctxRef.current
        if (!ctx) return
        // Unlocked by this gesture, then put back to SLEEP unless a tone is due right now (client review): a running
        // context holds the phone's audio session — iOS pauses the person's music — and costs battery for nothing.
        void ctx.resume().then(() => { if (!toneDue.current) void ctx.suspend() })
      } catch { /* no audio — the screen still shows the ring */ }
    }
    // Every kind of first touch: iOS Safari only lets audio start inside a real user activation (touchend / click /
    // keydown) — pointerdown alone is not one there (client review: the ringtone stayed silent on iPhones).
    const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const
    for (const ev of events) window.addEventListener(ev, unlock, { passive: true })
    return () => {
      for (const ev of events) window.removeEventListener(ev, unlock)
      // One context per runtime, closed with it (client review: each remount — a change of account — leaked one, until
      // the browser's limit left later rings silent).
      const ctx = ctxRef.current
      ctxRef.current = null
      void ctx?.close().catch((e) => logError(e, { op: 'calls.audioClose' }))
    }
  }, [])

  useEffect(() => {
    if (phase !== 'incoming' && phase !== 'outgoing') return
    // Awake for the tone only (the unlock above put it to sleep).
    toneDue.current = true
    void ctxRef.current?.resume()
    let stopped = false
    const nodes: OscillatorNode[] = []
    const burst = () => {
      // Read NOW, not when the ring began (client review): the first tap on the page may create the context while it
      // is already ringing, and the next burst must use it.
      const ctx = ctxRef.current
      if (stopped || !ctx || ctx.state !== 'running') return
      const gain = ctx.createGain()
      gain.gain.value = phase === 'incoming' ? 0.18 : 0.08
      gain.connect(ctx.destination)
      for (const f of phase === 'incoming' ? [440, 480] : [425]) {
        const o = ctx.createOscillator()
        o.frequency.value = f
        o.connect(gain)
        o.start()
        o.stop(ctx.currentTime + (phase === 'incoming' ? 1.2 : 1.0))
        nodes.push(o)
      }
      if (phase === 'incoming' && 'vibrate' in navigator) navigator.vibrate?.([400, 200, 400])
    }
    burst()
    const timer = window.setInterval(burst, phase === 'incoming' ? 3_000 : 4_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
      for (const o of nodes) { try { o.stop() } catch { /* already stopped */ } }
      if ('vibrate' in navigator) navigator.vibrate?.(0)
      toneDue.current = false
      void ctxRef.current?.suspend()
    }
  }, [phase])
}

/** While ringing in a background tab, the title alternates so the tab strip says why it is making noise. */
function useTitleFlash(on: boolean, name: string | null) {
  useEffect(() => {
    if (!on) return
    const flash = `📞 ${name ?? 'eno'}`
    // The page's own title as it is NOW — a navigation during the ring sets a new one (client review).
    let base = document.title
    let flip = false
    const timer = window.setInterval(() => {
      if (document.title !== flash) base = document.title
      flip = !flip
      document.title = flip ? flash : base
    }, 1_000)
    return () => { window.clearInterval(timer); if (document.title === flash) document.title = base }
  }, [on, name])
}
