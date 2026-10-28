'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** This learner left their camera on last time, on this device — per learner (`who`: the seat, or the teacher's own
 *  test): a family phone or a school computer never turns on the NEXT adult's camera (review, opus). */
const KEY = 'eno-classroom-self-view:'

function recall(who: string): boolean {
  try { return localStorage.getItem(KEY + who) === 'on' } catch { return false }
}
function remember(who: string, on: boolean) {
  try { if (on) localStorage.setItem(KEY + who, 'on'); else localStorage.removeItem(KEY + who) } catch { /* private mode: not kept */ }
}

/**
 * THE LEARNER'S OWN CAMERA, AS A VIDEO CALL'S SELF-VIEW (owner, 2026-10-27: the session screen "as close as possible" to
 * Praktika's — the learner sees themself in a corner while the avatar fills the screen).
 * ⛔ THE PICTURE NEVER LEAVES THE PHONE: the stream goes to one muted <video> on this page and nowhere else — nothing
 * uploads it, records it or reads a frame of it.
 * Off until the learner turns it on (no camera prompt they did not ask for); remembered on this device, and back on at the
 * next Start only when the browser ALREADY allows the camera — never a prompt at Start. Adults only (`allowed`): for anyone
 * under 18 the family agreed to VOICE practice.
 */
export function useSelfView(allowed: boolean, who: string) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  /** Bumped by every stop: a camera request still waiting (the permission prompt is up) when the learner turned it off or
   *  the screen went is let go the moment it arrives — never a camera left on with no button to turn it off (review,
   *  codex + opus). */
  const generation = useRef(0)
  /** A request is waiting: another press cancels it rather than asking twice. */
  const pending = useRef(false)

  const stop = useCallback(() => {
    generation.current += 1
    pending.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const open = useCallback(async (): Promise<'on' | 'off' | 'blocked' | 'unsupported' | 'unavailable'> => {
    // No camera API at all (an in-app browser, an insecure page): a different message from "blocked".
    if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
    const mine = generation.current
    pending.current = true
    try {
      // Small and front-facing: a corner tile, never the bandwidth or the battery of a real call.
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 360 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
        audio: false,
      })
      if (generation.current !== mine) { s.getTracks().forEach((t) => t.stop()); return 'off' }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = s
      // The camera unplugged, or its permission taken back mid-practice: the tile goes too (review, codex).
      for (const t of s.getVideoTracks?.() ?? []) t.addEventListener?.('ended', () => { if (streamRef.current === s) stop() })
      setStream(s)
      return 'on'
    } catch (e) {
      if (generation.current !== mine) return 'off'
      // Said no (the learner or the browser) vs no camera that can start — a different thing to do about it (review, codex).
      const name = (e as { name?: unknown } | null)?.name
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'unavailable'
    } finally {
      if (generation.current === mine) pending.current = false
    }
  }, [stop])

  /** The camera button: on (asking the browser the first time) or off — a press while it is still asking cancels.
   *  'blocked': the browser said no; 'unsupported': this browser has no camera for pages; 'unavailable': none could start. */
  const toggle = useCallback(async (): Promise<'on' | 'off' | 'blocked' | 'unsupported' | 'unavailable'> => {
    if (streamRef.current || pending.current) { stop(); remember(who, false); return 'off' }
    if (!allowed) return 'off'
    // The learner's own press decides: an automatic resume still checking permission stands down (review, codex).
    generation.current += 1
    const r = await open()
    if (r === 'on') remember(who, true)
    return r
  }, [allowed, open, stop, who])

  /** At Start: back on if the learner left it on — only when the browser already allows the camera (no prompt). */
  const resume = useCallback(async () => {
    if (!allowed || !recall(who) || streamRef.current || pending.current) return
    const mine = generation.current
    const state = await navigator.permissions?.query({ name: 'camera' as PermissionName }).then((p) => p.state).catch(() => null)
    // Re-checked after the wait (review, codex): a press meanwhile — on or off — decides, never a second request.
    if (state === 'granted' && generation.current === mine && !streamRef.current && !pending.current) await open()
  }, [allowed, open, who])

  // No longer allowed: the camera goes, and a request still waiting with it.
  useEffect(() => { if (!allowed) stop() }, [allowed, stop])
  // Another learner on the same screen, or the screen gone, however it goes: the camera goes with it (review, codex).
  useEffect(() => stop, [stop, who])

  return { stream, toggle, resume, stop }
}
