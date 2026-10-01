import { IS_SERVICES } from '@/lib/edition'
// ── The "Join eno" prompt — the PURE rules: when it may appear, and what it remembers ─────────────
//
// Owner, 2026-10-01: "after 1 minute browsing ask user to sign up with google to continue browsing, we
// need to boost signups" — and, asked, chose a prompt that is DISMISSIBLE AND RETURNS, not a wall. So it
// never says browsing is blocked, and the × to close it is always one tap.
//
// The controller (src/components/marketplace/signup-prompt.tsx) does the DOM and the timers; this file
// only decides, so the schedule is unit-testable without React, a DOM or a clock (every function takes
// `now` as an argument). The surface it opens is THE sign-in popup (sign-in-dialog.tsx, owner
// 2026-08-28: "only 1 popup") in its join presentation — see SignInPrompt in auth-context.tsx.
//
// THE SCHEDULE (all of it is here, nowhere else):
//   · first ask after FIRST_AFTER_MS of VISIBLE browsing in this tab — a hidden tab does not count, and
//     the count survives client navigations and reloads (sessionStorage = this tab's session);
//   · after it is closed (×, Esc, backdrop), again after AGAIN_AFTER_MS more visible browsing — at most MAX_PER_TAB asks
//     per tab session; a NEW tab session starts again from FIRST_AFTER_MS;
//   · the DISMISSALS_BEFORE_PAUSE-th dismissal on this device pauses it for PAUSE_MS (then the count
//     starts over);
//   · two tabs never ask within AGAIN_AFTER_MS of each other (wall clock, `lastShownAt`) — five open
//     tabs must not mean five prompts (opus, plan review);
//   · a signed-in user on this device ends it for good, sign-out included: they have an account, and
//     "Join eno" to someone who already joined is wrong.
//
// ⛔ NOTHING HERE IS PERSONAL DATA, AND THE PRIVACY PAGE SAYS SO (src/app/[lang]/privacy/page.tsx, the
// "Sign-up reminder" row): milliseconds of browsing, counts, timestamps and two flags. No page, no
// listing, no identifier. Keep it that way — a richer record would need a new disclosure.
//
// THE OWNER'S WEEK-ONE NUMBERS (2026-10-01: "how many pressed x, bounced, and how many signed up"):
// SIGNUP_PROMPT_EVENTS below, counted as anonymous per-day totals on our own server
// (src/lib/signup-prompt-counter.ts) with no consent needed because nothing about the visitor is
// kept, and read back by scripts/signup-prompt-report.ts through `summariseSignupPrompt`.

/** Visible browsing before the first ask. */
export const FIRST_AFTER_MS = 60_000
/** Visible browsing after a close (×, Esc, backdrop) before asking again. Also the cross-tab spacing. */
export const AGAIN_AFTER_MS = 180_000
/** Asks per tab session. */
export const MAX_PER_TAB = 2
/** The dismissal that pauses it… */
export const DISMISSALS_BEFORE_PAUSE = 3
/** …for this long. */
export const PAUSE_MS = 7 * 24 * 60 * 60 * 1000
/** How often the visible-time clock ticks. */
export const TICK_MS = 1_000
/**
 * ⚠️ THE MOST ONE TICK CAN CREDIT. A laptop that sleeps with the tab in front resumes the interval with
 * a wall-clock gap of hours; crediting it would ask the moment the lid opens, for "browsing" nobody did.
 * Two ticks' worth absorbs ordinary timer jitter and throttling and nothing more.
 */
export const MAX_TICK_CREDIT_MS = 2 * TICK_MS

/** sessionStorage — this tab's visible time, asks and next threshold. Gone when the tab closes. */
export const TAB_KEY = 'eno:signup-prompt-tab'
/** localStorage — dismissals, the pause, the last ask (any tab), and "this device has signed in". */
export const DEVICE_KEY = 'eno:signup-prompt'
/**
 * localStorage — ⚠️ TEST OVERRIDE, NOT A FEATURE. A positive number of milliseconds (100 … 3,600,000)
 * replaces BOTH delays and lets the prompt run under automation (`navigator.webdriver`) and a crawler
 * user-agent, which it otherwise never does. It exists for e2e/guest/signup-prompt.spec.ts, which sets
 * it from an init script; every other e2e run leaves it unset, so the prompt never interrupts a suite.
 * A real visitor has no way to set it short of devtools, and all it does there is ask sooner.
 */
export const TEST_KEY = 'eno:signup-prompt-test'

/**
 * This tab: visible ms, asks, the next threshold — and `cont`, "closed with × and not yet moved on":
 * set by a dismissal, cleared (and counted as `dismissed_then_continued`) by the next page this tab
 * opens. A flag, deliberately, never the page it was closed on.
 */
export type TabState = { ms: number; shown: number; nextAt: number; cont: number }
/**
 * This device: dismissals toward the pause, the pause, the last ask (any tab), "someone has signed in
 * here" — and `methodAt`, when Google or email was last chosen FROM THE PROMPT, so a sign-in that
 * follows within COMPLETION_WINDOW_MS is counted once as `signup_completed`. localStorage, not this
 * tab: a magic link opens a new tab, and that sign-in is still the prompt's.
 */
export type DeviceState = { dismissals: number; pausedUntil: number; lastShownAt: number; member: boolean; methodAt: number }

export const freshTab = (firstMs: number = FIRST_AFTER_MS): TabState => ({ ms: 0, shown: 0, nextAt: firstMs, cont: 0 })
export const freshDevice = (): DeviceState => ({ dismissals: 0, pausedUntil: 0, lastShownAt: 0, member: false, methodAt: 0 })

/** A sign-in this long after choosing Google or email in the prompt still counts as the prompt's. */
export const COMPLETION_WINDOW_MS = 60 * 60 * 1000

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** A stored tab state, or a fresh one for anything missing or malformed. */
export function parseTab(raw: string | null | undefined, firstMs: number = FIRST_AFTER_MS): TabState {
  try {
    const o = raw ? JSON.parse(raw) : null
    const ms = num(o?.ms), shown = num(o?.shown), nextAt = num(o?.nextAt)
    if (ms === null || shown === null || nextAt === null) return freshTab(firstMs)
    // A COUNT of dismissals still waiting for this tab to move on — a single flag scored two closes on one page
    // followed by one page change as a 50% bounce (opus, 2026-10-01). A legacy `true` reads as one.
    const cont = typeof o.cont === 'number' && Number.isFinite(o.cont) ? Math.max(0, Math.floor(o.cont)) : o.cont === true ? 1 : 0
    return { ms, shown: Math.floor(shown), nextAt, cont }
  } catch { return freshTab(firstMs) }
}

/** A stored device state; any malformed field falls back to its fresh value. */
export function parseDevice(raw: string | null | undefined): DeviceState {
  try {
    const o = raw ? JSON.parse(raw) : null
    if (!o || typeof o !== 'object') return freshDevice()
    return {
      dismissals: Math.floor(num(o.dismissals) ?? 0),
      pausedUntil: num(o.pausedUntil) ?? 0,
      lastShownAt: num(o.lastShownAt) ?? 0,
      member: o.member === true,
      methodAt: num(o.methodAt) ?? 0,
    }
  } catch { return freshDevice() }
}

/** The test override in ms, or null. Out-of-range or non-numeric values are ignored (null). */
export function parseTestOverride(raw: string | null | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 100 && n <= 3_600_000 ? Math.round(n) : null
}

/**
 * Credit one tick of the clock. `wasVisible` is whether the page was visible for the interval being
 * credited — the controller tracks it across visibilitychange, so a tab hidden mid-interval is not paid
 * for time nobody saw.
 */
export function creditTick(tab: TabState, elapsedMs: number, wasVisible: boolean): TabState {
  if (!wasVisible || !(elapsedMs > 0)) return tab
  return { ...tab, ms: tab.ms + Math.min(elapsedMs, MAX_TICK_CREDIT_MS) }
}

/** Is it time to ask, by the schedule alone? (Route, auth and a calm screen are the controller's.) */
export function isDue(tab: TabState, device: DeviceState, now: number, againMs: number = AGAIN_AFTER_MS): boolean {
  if (device.member) return false
  if (now < device.pausedUntil && device.pausedUntil - now <= PAUSE_MS) return false
  if (tab.shown >= MAX_PER_TAB) return false
  if (tab.ms < tab.nextAt) return false
  // ⚠️ A `lastShownAt` IN THE FUTURE (a clock moved back) is ignored rather than honoured: honouring it
  // would silence the prompt until the clock caught up, for as long as that takes. Same for a pause
  // longer than PAUSE_MS above — no write here can produce one, so it is a clock change, not a choice.
  const since = now - device.lastShownAt
  if (device.lastShownAt > 0 && since >= 0 && since < againMs) return false
  return true
}

/** The prompt was just shown. The next threshold is provisional — a dismissal moves it again. */
export function afterShown(tab: TabState, device: DeviceState, now: number, againMs: number = AGAIN_AFTER_MS): { tab: TabState; device: DeviceState } {
  return {
    tab: { ...tab, shown: tab.shown + 1, nextAt: tab.ms + againMs },
    device: { ...device, lastShownAt: now },
  }
}

/** Closed with × (or Esc / the backdrop): count it, and schedule the next ask from now. */
export function afterDismissed(tab: TabState, device: DeviceState, now: number, againMs: number = AGAIN_AFTER_MS): { tab: TabState; device: DeviceState } {
  const dismissals = device.dismissals + 1
  const pause = dismissals >= DISMISSALS_BEFORE_PAUSE
  return {
    tab: { ...tab, nextAt: tab.ms + againMs, cont: tab.cont + 1 },
    device: { ...device, dismissals: pause ? 0 : dismissals, pausedUntil: pause ? now + PAUSE_MS : device.pausedUntil },
  }
}

/** Google or email was chosen in the prompt. */
export const afterMethod = (device: DeviceState, now: number): DeviceState => ({ ...device, methodAt: now })

/**
 * Someone signed in on this device: never ask here again — and say whether it was the prompt's
 * sign-in (Google or email chosen in it within COMPLETION_WINDOW_MS), which is then spent so it is
 * counted once however many tabs see the session.
 */
export function afterSignedIn(device: DeviceState, now: number): { device: DeviceState; completed: boolean } {
  const since = now - device.methodAt
  const completed = device.methodAt > 0 && since >= 0 && since <= COMPLETION_WINDOW_MS
  return { device: { ...device, member: true, methodAt: 0 }, completed }
}

// ── The owner's numbers: anonymous per-day totals ────────────────────────────────────────────────

/**
 * What is counted, one total per (day, edition, event). Each ask ends in at most one of `dismissed`,
 * `google_click`, `email_click` (a close after choosing a method is not a dismissal: the visitor
 * answered), so the rates below are shares of the same asks.
 *   shown                     — the prompt opened
 *   dismissed                 — closed with ×, Esc or the backdrop without choosing a method
 *   dismissed_then_continued  — after a dismissal, the same tab opened another page (once per dismissal);
 *                               bounce = dismissed − dismissed_then_continued
 *   google_click / email_click — the method chosen in the prompt
 *   signup_completed          — a sign-in (new or returning account) on this device within an hour of
 *                               choosing a method in the prompt, counted once
 */
export const SIGNUP_PROMPT_EVENTS = ['shown', 'dismissed', 'dismissed_then_continued', 'google_click', 'email_click', 'signup_completed'] as const
export type SignupPromptCounterEvent = (typeof SIGNUP_PROMPT_EVENTS)[number]
export const isSignupPromptEvent = (v: unknown): v is SignupPromptCounterEvent =>
  typeof v === 'string' && (SIGNUP_PROMPT_EVENTS as readonly string[]).includes(v)

/** The calendar day in Vietnam (UTC+7, no daylight saving) — the owner's day, not UTC's. */
export function vnDay(now: number): string {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** The kv_store key for one day's total of one event on one edition. Prefix is what the report scans. */
export const COUNTER_PREFIX = 'signup-prompt:'
export const counterKey = (day: string, site: string, event: SignupPromptCounterEvent) => `${COUNTER_PREFIX}${day}:${site}:${event}`

/** Read a key back into its parts, or null for anything that is not one of ours. */
export function parseCounterKey(key: string): { day: string; site: string; event: SignupPromptCounterEvent } | null {
  const m = /^signup-prompt:(\d{4}-\d{2}-\d{2}):([a-z]+):([a-z_]+)$/.exec(key)
  if (!m || !isSignupPromptEvent(m[3])) return null
  return { day: m[1], site: m[2], event: m[3] }
}

export type SignupPromptTotals = Record<SignupPromptCounterEvent, number>
export const zeroTotals = (): SignupPromptTotals =>
  Object.fromEntries(SIGNUP_PROMPT_EVENTS.map((e) => [e, 0])) as SignupPromptTotals

/** The derived rates, as fractions (null when the denominator is zero — "no data", not 0%). */
export type SignupPromptRates = {
  /** dismissed / shown */
  closeRate: number | null
  /** (dismissed − continued) / dismissed — left the site after closing it */
  bounceAfterClose: number | null
  /** (google + email) / shown */
  startRate: number | null
  /** completed / (google + email) */
  completionRate: number | null
  /** completed / shown — the end-to-end conversion */
  signupPerShow: number | null
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function signupPromptRates(t: SignupPromptTotals): SignupPromptRates {
  const starts = t.google_click + t.email_click
  return {
    closeRate: ratio(t.dismissed, t.shown),
    bounceAfterClose: ratio(Math.max(0, t.dismissed - t.dismissed_then_continued), t.dismissed),
    startRate: ratio(starts, t.shown),
    completionRate: ratio(t.signup_completed, starts),
    signupPerShow: ratio(t.signup_completed, t.shown),
  }
}

/**
 * Raw kv rows → per-day totals (oldest first) and the window's sum, for ONE edition or both.
 * Ignores foreign keys, other editions when one is asked for, and non-positive / non-numeric counts.
 */
export function summariseSignupPrompt(
  rows: ReadonlyArray<{ key: string; n: number | bigint | string | null }>,
  opts: { site?: string; days: readonly string[] },
): { days: Array<{ day: string; totals: SignupPromptTotals }>; total: SignupPromptTotals } {
  const byDay = new Map(opts.days.map((d) => [d, zeroTotals()]))
  const total = zeroTotals()
  for (const r of rows) {
    const k = parseCounterKey(r.key)
    if (!k || (opts.site && k.site !== opts.site)) continue
    const day = byDay.get(k.day)
    if (!day) continue
    const n = Number(r.n)
    if (!Number.isFinite(n) || n <= 0) continue
    day[k.event] += Math.trunc(n)
    total[k.event] += Math.trunc(n)
  }
  return { days: opts.days.map((d) => ({ day: d, totals: byDay.get(d)! })), total }
}

// ── Where it never appears ───────────────────────────────────────────────────────────────────────

/** Matched EXACTLY (after a trailing slash is dropped). */
const EXCLUDED_EXACT = new Set([
  // Legal pages — someone reading the terms is not someone to interrupt with a sign-up.
  '/privacy', '/returns', '/prohibited', '/account-deletion',
])
/** Matched as a whole path segment prefix — `/signin` and `/signin/…`, never `/signin-help`. */
const EXCLUDED_PREFIX = [
  '/signin', '/onboard', '/auth', '/legal',
  // Terms and the Quy chế with every archived/future version (/terms/v1, /regulations/v2 …).
  '/terms', '/regulations',
  // The listing wizard (and any /post/… step): a seller mid-form is asked to sign in at Publish, in place.
  '/post',
  // eno.forum's own forms — the e-visa application (photo upload) and the trip builder. Services edition only:
  // they 404 on eno.vn, and the marketplace bundle must not carry those route names at all (licensing boundary).
  ...(IS_SERVICES ? ['/visa', '/itinerary'] : []),
  // Signed-in surfaces: a guest there is already being sent to sign in.
  '/messages', '/dashboard', '/admin', '/account', '/checkout',
  // Arrived from an email link; not browsing.
  '/unsubscribe',
]
const LISTING_EDIT = /^\/listings\/[^/]+\/edit(?:\/|$)/

/** True on a route where the prompt must never appear. Reads the PUBLIC path (no /en|/vi prefix). */
export function isExcludedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (EXCLUDED_EXACT.has(p)) return true
  if (EXCLUDED_PREFIX.some((x) => p === x || p.startsWith(`${x}/`))) return true
  return LISTING_EDIT.test(p)
}

// ── A calm screen ────────────────────────────────────────────────────────────────────────────────

/**
 * Something else is open: every Base UI floating layer while open (Dialog/AlertDialog/Sheet/Drawer/
 * Popover = dialog|alertdialog, Menu = menu, Select/Combobox = listbox) — which includes the cookie bar,
 * a non-modal Base UI dialog — plus the two hand-rolled modals (the mobile account rail, the PDP
 * lightbox), the only elements in src carrying `aria-modal`. The same set native-bootstrap.tsx lets
 * swallow the Android back press; kept as its own string here so that module is not dragged in.
 * ⚠️ NOT a bare `[role="dialog"]`: the desktop account rail is a role=dialog that stays mounted, and
 * matching it would park the prompt forever.
 */
export const OPEN_LAYER_SELECTOR = [
  '[data-open][role="dialog"]:not([data-consent-auto])',
  '[data-open][role="alertdialog"]',
  '[data-open][role="menu"]',
  '[data-open][role="listbox"]',
  '[role="dialog"][aria-modal="true"]:not([data-open])',
].join(',')

/** Input types a person TYPES into — a focused checkbox or button is not "mid-form". */
const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** Is this element a field someone is typing into? */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUT.has(((el as HTMLInputElement).type || 'text').toLowerCase())
  return (el as HTMLElement).isContentEditable === true || el.getAttribute('contenteditable') === 'true'
}

/**
 * Anything on this page that the prompt must wait for — beyond cookie-consent's `screenBusy()` (an
 * overlay scrim or the keyboard), which the controller checks first. An error or 404 page is never
 * calm: it marks itself with `data-error-page` (not-found.tsx, error.tsx).
 */
export function pageBusy(doc: Document): boolean {
  if (doc.querySelector('[data-error-page]')) return true
  if (doc.querySelector(OPEN_LAYER_SELECTOR)) return true
  return isTypingTarget(doc.activeElement)
}
