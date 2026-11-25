import { COMPLETION_WINDOW_MS, isCountedGate, isSignInGate, type SignInGate, type SignInMethod } from '@/lib/signup-prompt'
import { countGateEvent } from '@/lib/signup-counters'

// ── Per-gate sign-in counters (UX3 J1, 2026-10-05) ────────────────────────────────────────────────
//
// Every place that asks a visitor to sign in is a GATE (signup-prompt.ts SIGNIN_GATES). Three anonymous
// daily totals per gate, split by the coarse context class: the sign-in opened there, a method chosen
// in it (Google or email, the first choice per opening), and a sign-in on this device within the hour
// after that choice. The week-one "13 new profiles" could not be traced to where they came from; this
// is what answers it at the 10-08 review.
//
// ⚠️ WHICH GATE, WITHOUT TOUCHING EVERY CALLER: the gates this work owns say so (SignInContext.gate);
// the rest are recognised by where they happen (the rental check's page, the post wizard) or by what
// was pressed (a control in the site header or the tab bar is the "nav" gate). A guess, stated as one:
// a sign-in opened by something else within 10 s of a header press would be credited to "nav".

/** localStorage — the gate where Google or email was last chosen, and when. Removed at the next sign-in. */
export const GATE_RECORD_KEY = 'eno:signin-gate'

/** How recent a press in the header/tab bar must be to explain a sign-in opened without a named gate. */
export const NAV_PRESS_WINDOW_MS = 10_000

/** The last press anywhere, reduced to the one fact classification needs. */
export type PressInfo = { at: number; inChrome: boolean }

/**
 * Was this element inside the SITE header (`#app-header`, header.tsx) or the phone's tab bar
 * (`nav.mobile-nav`, mobile-nav.tsx)? Those two only — a section `<header>` or a breadcrumb `<nav>` in the
 * page is not site chrome (review, 2026-10-05).
 */
export const CHROME_SELECTOR = '#app-header, nav.mobile-nav'
export function pressedInChrome(el: Element | null | undefined): boolean {
  try { return !!el?.closest?.(CHROME_SELECTOR) } catch { return false }
}

const pathIs = (p: string | null | undefined, base: string) => !!p && (p === base || p.startsWith(`${base}/`))

/**
 * Which gate opened a sign-in. Pure — auth-context feeds it.
 * Order: the prompt; a gate the caller named; the page it happened on; a fresh press in the header or
 * tab bar; a listing in hand (messaging a lister); else "other".
 */
export function classifyGate(o: {
  explicit?: SignInGate | null
  prompt?: boolean
  listing?: boolean
  pathname: string | null | undefined
  press: PressInfo | null | undefined
  now: number
}): SignInGate {
  if (o.prompt) return 'timed'
  if (o.explicit && isSignInGate(o.explicit)) return o.explicit
  if (pathIs(o.pathname, '/post')) return 'post'
  // The teacher profile form (2026-10-16): its own Sign in, the arrival's, the CV reader's — and the header's there too.
  if (pathIs(o.pathname, '/teachers/join') || pathIs(o.pathname, '/teachers/edit')) return 'teacher'
  if (o.press && o.press.inChrome && o.now - o.press.at >= 0 && o.now - o.press.at <= NAV_PRESS_WINDOW_MS) return 'nav'
  if (o.listing) return 'chat'
  return 'other'
}

/**
 * `m`: the way LAST chosen in the form (since 2026-11-17, /privacy says so — noteGateChoice keeps it current, so tapping Facebook,
 * backing out and finishing with the emailed code credits email). ⛔ THE CHOICE, NOT THE SESSION: GoTrue's identities do not reliably
 * stamp the one used (measured 11-17: an identity's last_sign_in_at matched the sign-in for Google 6/11, email 0/7, Facebook 0/1;
 * app_metadata.provider is the FIRST provider for ever — commit gate, opus). What we ask is "pressed Facebook in Facebook's
 * browser → signed in?", which is exactly the choice and its completion. Older records have none and complete without one.
 */
type GateRecord = { g: SignInGate; at: number; m: SignInMethod | null }

const METHODS: readonly SignInMethod[] = ['google', 'apple', 'facebook', 'email']

function readRecord(): GateRecord | null {
  try {
    const o = JSON.parse(localStorage.getItem(GATE_RECORD_KEY) || 'null') as { g?: unknown; at?: unknown; m?: unknown } | null
    if (!o || !isCountedGate(o.g) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
    return { g: o.g, at: o.at, m: METHODS.includes(o.m as SignInMethod) ? (o.m as SignInMethod) : null }
  } catch { return null }
}



/** The sign-in opened at this gate. */
export function noteGateOpen(gate: SignInGate): void {
  countGateEvent(gate, 'open')
}

/**
 * Google, Apple or email was chosen in a sign-in opened at this gate: count it, and remember the gate so the
 * sign-in that follows within the hour — in this tab, after the Google or Apple round trip, or in the tab a
 * magic link opens — is counted once as that gate's completion.
 */
export function noteGateMethod(gate: SignInGate, method: SignInMethod, now: number = Date.now()): void {
  if (!isCountedGate(gate)) return
  writeRecord(gate, method, now)
  countGateEvent(gate, method)
}

/**
 * A later choice in the same form: no count (one start per ask) — the CURRENT record of this gate now carries this way and this
 * time. No record (spent by a sign-in, or never written) or another gate's → nothing: a completion is never credited without its
 * counted start (commit gate, opus).
 */
export function noteGateChoice(gate: SignInGate, method: SignInMethod, now: number = Date.now()): void {
  if (!isCountedGate(gate)) return
  const r = readRecord()
  if (!r || r.g !== gate) return
  writeRecord(gate, method, now)
}

function writeRecord(gate: SignInGate, method: SignInMethod, now: number): void {
  try { localStorage.setItem(GATE_RECORD_KEY, JSON.stringify({ g: gate, at: now, m: method })) } catch { /* private mode: the count still lands */ }
}

/**
 * Someone is signed in on this device: if a method was chosen at a gate within the hour, that gate's
 * sign-in completed — counted once (the record is spent), whichever tab sees the session first.
 * A record older than the hour, or from a clock that ran backwards, is dropped without a count.
 * ⚠️ Every open tab hears the sign-in at almost the same moment, and a read-then-remove on localStorage
 * is not atomic across tabs — so the spend runs under a Web Lock where the browser has them (one tab at
 * a time; the second finds the record gone). Without the API it is best-effort, as before.
 */
export function settleGateSignIn(now: number = Date.now()): void {
  const run = () => { spendGateRecord(now) }
  try {
    const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => void) => Promise<unknown> } }).locks
    if (locks?.request) { void locks.request(GATE_RECORD_KEY, run).catch(() => run()); return }
  } catch { /* no Web Locks — fall through */ }
  run()
}

/** The spend itself: read, remove, and count when fresh. Exported for the tests. */
export function spendGateRecord(now: number = Date.now()): SignInGate | null {
  const r = readRecord()
  try { localStorage.removeItem(GATE_RECORD_KEY) } catch { /* nothing to spend */ }
  if (!r) return null
  const since = now - r.at
  if (since < 0 || since > COMPLETION_WINDOW_MS) return null
  countGateEvent(r.g, 'completed')
  // …and the way that had been chosen (the record's `m`): the same anonymous daily total, one more action name, never more
  // than the gate's own completion.
  if (r.m) countGateEvent(r.g, `completed_${r.m}`)
  return r.g
}
