'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { trackSignupPrompt } from '@/lib/analytics'
import {
  AGAIN_AFTER_MS,
  DEVICE_KEY,
  FIRST_AFTER_MS,
  TAB_KEY,
  TEST_KEY,
  TICK_MS,
  afterDismissed,
  afterMethod,
  afterShown,
  afterSignedIn,
  creditTick,
  isDue,
  isExcludedPath,
  pageBusy,
  parseDevice,
  parseTab,
  parseTestOverride,
  type DeviceState,
  type SignupPromptCounterEvent,
  type TabState,
} from '@/lib/signup-prompt'
import { screenBusy } from './cookie-consent'

/**
 * ⛔ STORAGE CAN THROW OR BE MISSING (private windows, blocked site data, previews) — so every read and
 * write is wrapped, and the controller keeps its own copy in memory. Blocked storage costs the
 * cross-reload memory, never the prompt's correctness inside one page life (opus, plan review).
 */
function store(kind: 'local' | 'session'): Storage | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage } catch { return null }
}
function readKey(kind: 'local' | 'session', key: string): string | null {
  try { return store(kind)?.getItem(key) ?? null } catch { return null }
}
function writeKey(kind: 'local' | 'session', key: string, value: string): void {
  try { store(kind)?.setItem(key, value) } catch { /* memory copy still holds it */ }
}

/** The in-memory copy — one object in a ref, so every effect and callback shares it. */
type Mem = { tab: TabState | null; device: DeviceState | null }
/** This tab's state. A fresh tab starts its first ask at the test override when one is set. */
function getTab(mem: Mem): TabState {
  if (!mem.tab) mem.tab = parseTab(readKey('session', TAB_KEY), parseTestOverride(readKey('local', TEST_KEY)) ?? FIRST_AFTER_MS)
  return mem.tab
}
function saveTab(mem: Mem, t: TabState): void { mem.tab = t; writeKey('session', TAB_KEY, JSON.stringify(t)) }
/** This device's state. Another tab may have changed it: the stored copy wins whenever there is one. */
function getDevice(mem: Mem): DeviceState {
  const raw = readKey('local', DEVICE_KEY)
  if (raw !== null) mem.device = parseDevice(raw)
  return mem.device ?? (mem.device = parseDevice(null))
}
function saveDevice(mem: Mem, d: DeviceState): void { mem.device = d; writeKey('local', DEVICE_KEY, JSON.stringify(d)) }

/**
 * ONE ANONYMOUS +1 ON TODAY'S TOTAL (POST /api/signup-prompt → src/lib/signup-prompt-counter.ts) — the
 * owner's week-one numbers (2026-10-01: "how many pressed x, bounced, and how many signed up").
 * ⚠️ NOT CONSENT-GATED, ON PURPOSE, AND THAT IS ONLY HONEST BECAUSE OF WHAT THE SERVER KEEPS: one integer
 * per (day, edition, event) — no IP, no id, no cookie, no user agent, no page — so there is no personal
 * data to ask consent for. The body is the event name and nothing else. /privacy says so. The GA events
 * (trackSignupPrompt) are the consent-gated half and stay that way.
 * A beacon, so a Google click that leaves the page at once still lands. Fails silently: a dropped count
 * never becomes a visitor's problem.
 */
export function countSignupPrompt(event: SignupPromptCounterEvent): void {
  try {
    const body = JSON.stringify({ e: event })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/signup-prompt', new Blob([body], { type: 'application/json' }))) return
    // ⚠️ SILENCE IS CORRECT HERE, as in analytics.ts's beacon: client-side counter plumbing has no
    // server log to reach, and a lost +1 is not an incident.
    fetch('/api/signup-prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch { /* a counter must never break the page */ }
}

/** How this document was loaded — a reload is not "moving on" after closing the prompt. */
function navigationType(): string {
  try { return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? 'navigate' } catch { return 'navigate' }
}

/** The native iOS app's embedded web tabs: Google sign-in cannot run there at all (sign-in-form.tsx). */
const NATIVE_TABS_UA = /EnoNativeTabs/

/**
 * THE "JOIN ENO" PROMPT — the controller. Renders nothing: it counts visible browsing time and, when the
 * schedule in src/lib/signup-prompt.ts says so and the screen is calm, opens THE sign-in popup in its
 * join presentation (`openSignIn({ prompt })` — owner, 2026-08-28: "only 1 popup").
 *
 * Owner, 2026-10-01: "after 1 minute browsing ask user to sign up with google … we need to boost
 * signups", and chose a prompt that is dismissible and returns — never a wall. So:
 * · signed-out visitors only — and never once anyone has signed in on this device;
 * · never for automation (`navigator.webdriver` — every e2e suite) or a crawler (bot-ua.ts, loaded only
 *   at the moment it would show), unless the test override (TEST_KEY) is set;
 * · never on an excluded route (sign-in, onboarding, legal pages, the post form, signed-in surfaces) or
 *   an error page, and never over anything else — the cookie bar, any dialog/sheet/menu, the keyboard,
 *   a focused field. It waits for the next calm second instead.
 * It also reports the owner's numbers: GA events through the consent-gated helper, and the anonymous
 * daily totals through `countSignupPrompt`.
 *
 * ⚠️ MOUNTED ONCE, IN providers.tsx, UNDER THE ROOT LAYOUT THAT NEVER UNMOUNTS — which is what makes the
 * count survive client navigations; sessionStorage carries it across reloads in the same tab.
 */
export function SignupPrompt() {
  const { user, loading, openSignIn } = useAuth()
  const pathname = usePathname()
  /** Read by callbacks that outlive a render (the dialog's onDismiss) — always the current user. */
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])
  const memRef = useRef<Mem>({ tab: null, device: null })

  /**
   * A signed-in user on this device: never again here, sign-out included (they have an account) — and
   * if Google or email was chosen in the prompt within the hour, that sign-in is the prompt's:
   * `signup_completed`, counted once (afterSignedIn spends the mark).
   */
  useEffect(() => {
    if (!user) return
    const mem = memRef.current
    const d = getDevice(mem)
    if (d.member && d.methodAt === 0) return
    const { device, completed } = afterSignedIn(d, Date.now())
    saveDevice(mem, device)
    if (completed) countSignupPrompt('signup_completed')
  }, [user])

  /**
   * `dismissed_then_continued`: after a dismissal, the next page this tab opens — a client navigation,
   * or a new document that is not a reload of the same one. Once per dismissal (the flag is spent).
   * Bounce = dismissed − this.
   */
  const lastPath = useRef<string | null>(null)
  useEffect(() => {
    const first = lastPath.current === null
    const moved = !first && lastPath.current !== pathname
    lastPath.current = pathname
    if (!first && !moved) return
    const mem = memRef.current
    const tab = getTab(mem)
    if (!tab.cont) return
    if (first && navigationType() === 'reload') return
    saveTab(mem, { ...tab, cont: 0 })
    // One continuation per dismissal still waiting — so bounce = dismissed − continued stays per dismissal.
    for (let i = 0; i < tab.cont; i++) countSignupPrompt('dismissed_then_continued')
  }, [pathname])

  useEffect(() => {
    // ⚠️ `loading` FIRST: before the session is known a signed-in visitor looks exactly like a guest.
    if (loading || user) return
    const mem = memRef.current
    const override = parseTestOverride(readKey('local', TEST_KEY))
    let automated = true
    try { automated = navigator.webdriver === true || NATIVE_TABS_UA.test(navigator.userAgent || '') } catch { /* stays true */ }
    if (automated && override === null) return
    const againMs = override ?? AGAIN_AFTER_MS
    if (getDevice(mem).member) return

    let last = Date.now()
    /**
     * Was the page visible for the interval since `last`? Settled on every tick and on every
     * visibilitychange BEFORE it flips, so the second in which a tab is hidden is paid at the old state
     * and nothing after it is.
     */
    let wasVisible = document.visibilityState === 'visible'
    const credit = (): number => {
      const now = Date.now()
      saveTab(mem, creditTick(getTab(mem), now - last, wasVisible))
      last = now
      wasVisible = document.visibilityState === 'visible'
      return now
    }

    let stopped = false
    let inFlight = false
    /** Crawler verdict, decided once, lazily: bot-ua.ts is a server-side list and stays out of first load. */
    let isBot: boolean | null = override !== null ? false : null
    const eligible = (now: number) =>
      !stopped && !userRef.current
      && isDue(getTab(mem), getDevice(mem), now, againMs)
      && !isExcludedPath(window.location.pathname)
      && !screenBusy() && !pageBusy(document)

    const tryShow = async (now: number) => {
      if (inFlight || !eligible(now)) return
      inFlight = true
      try {
        if (isBot === null) {
          try { isBot = (await import('@/lib/bot-ua')).isBotUserAgent(navigator.userAgent || '') } catch { isBot = false }
        }
        if (isBot) { stopped = true; return }
        // The await gave the page a moment: everything is re-checked against now.
        const at = Date.now()
        if (!eligible(at)) return
        const shown = afterShown(getTab(mem), getDevice(mem), at, againMs)
        saveTab(mem, shown.tab)
        saveDevice(mem, shown.device)
        const count = shown.tab.shown
        trackSignupPrompt('shown', { count })
        countSignupPrompt('shown')
        /** A method was chosen in THIS ask — a close after that is the visitor answering, not a dismissal. */
        let answered = false
        openSignIn({
          prompt: {
            onMethod: (method) => {
              // ONE outcome per ask: a second press (email, then Google) must not count twice — the week-one
              // start rate adds the two as exclusive outcomes (codex, 2026-10-01).
              if (answered) return
              answered = true
              trackSignupPrompt(method, { count })
              countSignupPrompt(method === 'google' ? 'google_click' : 'email_click')
              saveDevice(mem, afterMethod(getDevice(mem), Date.now()))
            },
            onDismiss: () => {
              // A sign-in that closed it is not a dismissal (opus, plan review).
              if (userRef.current) return
              const tab = getTab(mem)
              if (answered) {
                // Not signed in yet (a magic link on its way, say): ask again on the usual schedule,
                // but this was an answer — it does not count toward the pause or as a ×.
                saveTab(mem, { ...tab, nextAt: tab.ms + againMs })
                return
              }
              const next = afterDismissed(tab, getDevice(mem), Date.now(), againMs)
              saveTab(mem, next.tab)
              saveDevice(mem, next.device)
              trackSignupPrompt('dismissed', { count })
              countSignupPrompt('dismissed')
            },
          },
        })
      } finally {
        inFlight = false
      }
    }

    const iv = window.setInterval(() => { void tryShow(credit()) }, TICK_MS)
    const settle = () => { credit() }
    document.addEventListener('visibilitychange', settle)
    window.addEventListener('pagehide', settle)
    return () => {
      stopped = true
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', settle)
      window.removeEventListener('pagehide', settle)
      credit()
    }
  }, [loading, user, openSignIn])

  return null
}
