import { useEffect, useSyncExternalStore } from 'react'
import { logWarn } from '@/lib/log'

/**
 * Is "Continue with Facebook" switched on? (src/lib/facebook-signin.ts) — one answer per tab, shared by every sign-in
 * form in it (the header's, the dialog's, /signin's).
 *   · A page the server renders dynamically says so itself (`<FacebookSignInSeed>` — the teacher join page, where the
 *     sign-in opens on its own after the hand-off: the answer is there as the page hydrates, before that dialog mounts,
 *     with no request). The server's word wins: a probe already in flight does not overwrite it.
 *   · Anywhere else a form that mounts asks GET /api/auth/providers — once per TTL_MS (failure = off until the next ask),
 *     and the answer is kept in sessionStorage for the same time so the next pages know it before they paint.
 * ⚠️ AN ANSWER EXPIRES (gate review, 2026-10-16): a tab open across the owner switching Facebook on or off asks again when
 * it next opens a sign-in form after TTL_MS (the popup mounts a fresh form on every open), never keeping the first answer
 * for its whole life. A form already on screen keeps its button; pressed after a switch-off, it says Facebook sign-in did
 * not start.
 * Unknown reads as off: a button that appears late beats one that appears and then fails.
 */
const STORE_KEY = 'eno:signin-providers'
const TTL_MS = 5 * 60_000
let state: boolean | null = null
/** When this tab last had an answer, or asked for one (ms) — 0: never. */
let askedAt = 0
/** The server seeded this page: its word stands until it expires like any other. */
let seeded = false
const subscribers = new Set<() => void>()

function set(on: boolean) {
  if (state === on) return
  state = on
  subscribers.forEach((notify) => notify())
}

function readStored(now: number): boolean | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { facebook?: unknown; at?: unknown }
    if (typeof v.at !== 'number' || now - v.at > TTL_MS || v.at > now) return null
    return v.facebook === true
  } catch { return null }
}

function store(on: boolean, now: number) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ facebook: on, at: now })) } catch { /* private mode */ }
}

/** The server's word for this page — it wins over a stored or fetched one. */
export function seedFacebookSignIn(on: boolean): void {
  const now = Date.now()
  seeded = true
  askedAt = now
  store(on, now)
  set(on)
}

function ask() {
  const now = Date.now()
  if (askedAt && now - askedAt <= TTL_MS && now >= askedAt) return
  askedAt = now
  seeded = false
  const stored = readStored(now)
  if (stored !== null) { set(stored); return }
  void fetch('/api/auth/providers', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { facebook?: unknown } | null) => {
      if (seeded) return // the server seeded this page while the probe was out: its word stands
      const on = d?.facebook === true
      if (d) store(on, Date.now())
      set(on)
    })
    // Off until the next ask — an expired "on" must not outlive a failed refresh (gate review, 2026-10-16) — and said so in
    // the console, never a quiet stand-in for a broken endpoint.
    .catch((e) => {
      if (!seeded) set(false)
      logWarn('[facebook] providers probe failed', { name: (e as Error)?.name })
    })
}

export function useFacebookSignInOn(): boolean {
  useEffect(() => { ask() }, [])
  return useSyncExternalStore(
    (notify) => { subscribers.add(notify); return () => { subscribers.delete(notify) } },
    () => state === true,
    () => false,
  )
}

/**
 * Warm the flag on PAGE LOAD (auth-context mounts this app-wide), so the shared module `state` is known before any
 * sign-in popup opens — the popup's form then reads it synchronously from `state` at first paint instead of starting the
 * GET when it mounts and showing Facebook ~1s later (the "Facebook joins late" jitter). Same `ask()` path, so the TTL,
 * sessionStorage and seed rules all still hold; a no-op after the first call in the TTL window.
 */
export function warmFacebookSignIn(): void { ask() }

/** Tests only. */
export function resetFacebookFlagForTests() { state = null; askedAt = 0; seeded = false; subscribers.clear() }
