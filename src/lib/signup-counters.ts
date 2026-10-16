import { browserContext, deviceClass } from '@/lib/in-app-browser'
import {
  contextClassOf,
  isCountedGate,
  type GateAction,
  type SignInGate,
  type SignupPromptCounterEvent,
  type TeacherFormEvent,
} from '@/lib/signup-prompt'

// ── The CLIENT half of the anonymous sign-up counters ─────────────────────────────────────────────
//
// POST /api/signup-prompt → src/lib/signup-prompt-counter.ts. One anonymous +1 on a daily total, with
// the coarse context class (UX3 J1, 2026-10-05). ⚠️ NOT CONSENT-GATED, ON PURPOSE, AND THAT IS ONLY
// HONEST BECAUSE OF WHAT THE SERVER KEEPS: one integer per (day, edition, event, class) — no IP, no id,
// no cookie, no user agent, no page. The body is the event name and one of 24 fixed classes, nothing
// else. /privacy says so ("Sign-up reminder counts"). The GA events (analytics.ts) are the
// consent-gated half and stay that way.

/** Vietnamese or English, coarsely: the page's own `<html lang>` (a machine-translated language reads as en). */
export function pageLang(): 'vi' | 'en' {
  try { return (document.documentElement.lang || '').toLowerCase().startsWith('vi') ? 'vi' : 'en' } catch { return 'en' }
}

/** This page's class: `<context>.<device>.<lang>`, e.g. `inapp-zalo.phone.vi`. */
export function currentContextClass(): string {
  return contextClassOf(browserContext(), deviceClass(), pageLang())
}

/**
 * A beacon, so an event right before a navigation (a Google tap, a page being closed) still lands.
 * Fails silently: a dropped count never becomes a visitor's problem.
 * ⛔ NEVER UNDER AUTOMATION (`navigator.webdriver` — every e2e suite): a test run is not a visitor, and
 * a suite pointed at the live site would otherwise count itself.
 */
function beacon(payload: Record<string, string>): void {
  try {
    if (typeof navigator === 'undefined' || navigator.webdriver === true) return
    const body = JSON.stringify(payload)
    if (typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/signup-prompt', new Blob([body], { type: 'application/json' }))) return
    // ⚠️ SILENCE IS CORRECT HERE, as in analytics.ts's beacon: client-side counter plumbing has no
    // server log to reach, and a lost +1 is not an incident.
    // eslint-disable-next-line no-restricted-syntax -- browser code: a failed beacon has no server log to reach
    fetch('/api/signup-prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch { /* a counter must never break the page */ }
}

/** One "Join eno" prompt event. */
export function countPromptEvent(e: SignupPromptCounterEvent): void {
  beacon({ e, c: currentContextClass() })
}

/** What this page has counted for the teacher form — each event at most once per page load. */
const teacherCounted = new Set<TeacherFormEvent>()
/** One step of the teacher sign-up form (signup-prompt.ts TEACHER_FORM_EVENTS) — once per page load: a re-render, a
 *  second tap or a step revisited never counts twice. */
export function countTeacherFormEvent(t: TeacherFormEvent): void {
  if (teacherCounted.has(t)) return
  teacherCounted.add(t)
  beacon({ t, c: currentContextClass() })
}
/** Tests only. */
export function resetTeacherFormCountsForTests(): void { teacherCounted.clear() }

/** One sign-in gate action. The timed prompt counts itself through its own events, never here. */
export function countGateEvent(g: SignInGate, a: GateAction): void {
  if (!isCountedGate(g)) return
  beacon({ g, a, c: currentContextClass() })
}
