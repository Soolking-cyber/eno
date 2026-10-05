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
//     the count survives client navigations and reloads (sessionStorage = this tab's session); since
//     UX3 J7a (2026-10-05) time is only counted once the cookie consent has been answered (the controller
//     reads consentAnswered(); nothing here changed);
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
 * What is counted, one total per (day, edition, event, context class). Each ask ends in at most one of
 * `dismissed`, `google_click`, `email_click` (a close after choosing a method is not a dismissal: the
 * visitor answered), so the rates below are shares of the same asks.
 *   shown                     — the prompt opened
 *   dismissed                 — closed with ×, Esc or the backdrop without choosing a method
 *   dismissed_then_continued  — after a dismissal, the same tab opened another page (once per dismissal);
 *                               bounce = dismissed − dismissed_then_continued
 *   google_click / email_click — the method chosen in the prompt
 *   signup_completed          — a sign-in (new or returning account) on this device within an hour of
 *                               choosing a method in the prompt, counted once
 *   left_open                 — (UX3 J1, 2026-10-05) the page was hidden or closed while the prompt was
 *                               still open and unanswered — the week-one "45% of shows end with no
 *                               event" bucket, now recorded. AT MOST ONCE PER SHOW: a bfcache restore
 *                               keeps the controller's memory, so a second hide of the same show is
 *                               silent. ⚠️ NOT exclusive with `dismissed`: a visitor who switches away
 *                               and comes back to close it is counted in both.
 */
export const SIGNUP_PROMPT_EVENTS = ['shown', 'dismissed', 'dismissed_then_continued', 'google_click', 'email_click', 'signup_completed', 'left_open'] as const
export type SignupPromptCounterEvent = (typeof SIGNUP_PROMPT_EVENTS)[number]
export const isSignupPromptEvent = (v: unknown): v is SignupPromptCounterEvent =>
  typeof v === 'string' && (SIGNUP_PROMPT_EVENTS as readonly string[]).includes(v)

// ── The coarse context class every counter carries (UX3 J1) ─────────────────────────────────────

/**
 * ⛔ COARSE ON PURPOSE, AND A CLOSED SET — 6 contexts × phone/desktop × vi/en = 24 values, validated
 * here on the server so nothing but one of them can ever reach a key. It says what KIND of browser an
 * event happened in (an in-app Facebook visitor meets a different sign-in than a Chrome one), never
 * which one: no user agent, version, model or page. src/lib/in-app-browser.ts `browserContext` and
 * `deviceClass` produce it on the client; /privacy names it.
 */
export const CONTEXTS = ['native', 'inapp-fb', 'inapp-zalo', 'inapp-other', 'pwa', 'browser'] as const
export const DEVICES = ['phone', 'desktop'] as const
export const LANGS = ['vi', 'en'] as const
export type CounterContext = (typeof CONTEXTS)[number]
/** A key written by a client that sent no class, or before the class existed (rows from 10-01 on). */
export const UNKNOWN_CONTEXT = 'unknown'

export function contextClassOf(context: CounterContext, device: (typeof DEVICES)[number], lang: (typeof LANGS)[number]): string {
  return `${context}.${device}.${lang}`
}

/** A valid context class, or null. */
export function contextParts(v: unknown): { context: CounterContext; device: (typeof DEVICES)[number]; lang: (typeof LANGS)[number] } | null {
  if (typeof v !== 'string') return null
  const [context, device, lang, ...rest] = v.split('.')
  if (rest.length) return null
  if (!(CONTEXTS as readonly string[]).includes(context)) return null
  if (!(DEVICES as readonly string[]).includes(device)) return null
  if (!(LANGS as readonly string[]).includes(lang)) return null
  return { context: context as CounterContext, device: device as (typeof DEVICES)[number], lang: lang as (typeof LANGS)[number] }
}

/** Whatever a client sent, as the class a key may carry: a valid class, else UNKNOWN_CONTEXT. */
export const parseContextClass = (v: unknown): string => (contextParts(v) ? (v as string) : UNKNOWN_CONTEXT)

// ── Per-gate counters: every place that asks a visitor to sign in (UX3 J1) ───────────────────────

/**
 * Where a sign-in was asked for. `timed` is the "Join eno" prompt itself — its own events above ARE its
 * gate counters, so it never sends gate events; it is in this list so the report can show it in the same
 * table and so auth-context can name it.
 *   first_save   — the note after a guest's first heart (save-signup-sheet.tsx)
 *   chat / offer — a listing's contact: the PDP composer, a card's or a list row's quick action
 *   rental_check — the free availability check's send (/rentals/check)
 *   save_search  — saving a search for alerts (use-explorer.ts)
 *   post         — the listing wizard (/post: Publish, AI autofill)
 *   nav          — the header's Sign in, the phone's tab bar (Messages / Account)
 *   page         — the /signin page itself (a server guard's redirect, or a link opened in a new tab)
 *   other        — everything else (bell, AI chat, help, report, visual search …)
 */
export const SIGNIN_GATES = ['timed', 'first_save', 'chat', 'offer', 'rental_check', 'save_search', 'post', 'nav', 'page', 'other'] as const
export type SignInGate = (typeof SIGNIN_GATES)[number]
export const isSignInGate = (v: unknown): v is SignInGate => typeof v === 'string' && (SIGNIN_GATES as readonly string[]).includes(v)
/** A gate that sends its own gate events — every one but the timed prompt (see above). */
export const isCountedGate = (v: unknown): v is Exclude<SignInGate, 'timed'> => isSignInGate(v) && v !== 'timed'

/**
 * What happens at a gate: the sign-in opened there, Google or email chosen in it (the first choice per
 * opening, as for the prompt), and a sign-in on this device within COMPLETION_WINDOW_MS of that choice.
 */
export const GATE_ACTIONS = ['open', 'google', 'email', 'completed'] as const
export type GateAction = (typeof GATE_ACTIONS)[number]
export const isGateAction = (v: unknown): v is GateAction => typeof v === 'string' && (GATE_ACTIONS as readonly string[]).includes(v)

// ── Keys ─────────────────────────────────────────────────────────────────────────────────────────

/** The calendar day in Vietnam (UTC+7, no daylight saving) — the owner's day, not UTC's. */
export function vnDay(now: number): string {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** The kv_store key for one day's total of one prompt event on one edition, in one context class. */
export const COUNTER_PREFIX = 'signup-prompt:'
export const counterKey = (day: string, site: string, event: SignupPromptCounterEvent, ctx: string = UNKNOWN_CONTEXT) =>
  `${COUNTER_PREFIX}${day}:${site}:${event}:${parseContextClass(ctx)}`

/** The kv_store key for one day's total of one gate action on one edition, in one context class. */
export const GATE_COUNTER_PREFIX = 'signin-gate:'
export const gateCounterKey = (day: string, site: string, gate: Exclude<SignInGate, 'timed'>, action: GateAction, ctx: string = UNKNOWN_CONTEXT) =>
  `${GATE_COUNTER_PREFIX}${day}:${site}:${gate}:${action}:${parseContextClass(ctx)}`

/**
 * Read a prompt key back into its parts, or null for anything that is not one of ours. A key from before
 * the context class existed (`signup-prompt:<day>:<site>:<event>`, 2026-10-01 → J1's deploy) reads as
 * the UNKNOWN_CONTEXT, so the week-one totals keep adding up.
 */
export function parseCounterKey(key: string): { day: string; site: string; event: SignupPromptCounterEvent; ctx: string } | null {
  const m = /^signup-prompt:(\d{4}-\d{2}-\d{2}):([a-z]+):([a-z_]+)(?::([a-z.-]+))?$/.exec(key)
  if (!m || !isSignupPromptEvent(m[3])) return null
  const ctx = m[4] ?? UNKNOWN_CONTEXT
  if (ctx !== UNKNOWN_CONTEXT && !contextParts(ctx)) return null
  return { day: m[1], site: m[2], event: m[3], ctx }
}

export function parseGateCounterKey(key: string): { day: string; site: string; gate: Exclude<SignInGate, 'timed'>; action: GateAction; ctx: string } | null {
  const m = /^signin-gate:(\d{4}-\d{2}-\d{2}):([a-z]+):([a-z_]+):([a-z]+):([a-z.-]+)$/.exec(key)
  if (!m || !isCountedGate(m[3]) || !isGateAction(m[4])) return null
  if (m[5] !== UNKNOWN_CONTEXT && !contextParts(m[5])) return null
  return { day: m[1], site: m[2], gate: m[3], action: m[4], ctx: m[5] }
}

// ── Reading them back (scripts/signup-prompt-report.ts) ─────────────────────────────────────────

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
  /** left_open / shown — hidden or closed with the prompt still open and unanswered */
  leftOpenRate: number | null
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
    leftOpenRate: ratio(t.left_open, t.shown),
  }
}

/** A positive integer count from a kv row, or null to skip it. */
function rowCount(n: number | bigint | string | null): number | null {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : null
}

/**
 * Raw kv rows → per-day totals (oldest first), the window's sum, and the window's sum per context class,
 * for ONE edition or both. Ignores foreign keys, other editions when one is asked for, and non-positive /
 * non-numeric counts.
 */
export function summariseSignupPrompt(
  rows: ReadonlyArray<{ key: string; n: number | bigint | string | null }>,
  opts: { site?: string; days: readonly string[] },
): { days: Array<{ day: string; totals: SignupPromptTotals }>; total: SignupPromptTotals; byContext: Record<string, SignupPromptTotals> } {
  const byDay = new Map(opts.days.map((d) => [d, zeroTotals()]))
  const total = zeroTotals()
  const byContext: Record<string, SignupPromptTotals> = {}
  for (const r of rows) {
    const k = parseCounterKey(r.key)
    if (!k || (opts.site && k.site !== opts.site)) continue
    const day = byDay.get(k.day)
    if (!day) continue
    const n = rowCount(r.n)
    if (n === null) continue
    day[k.event] += n
    total[k.event] += n
    ;(byContext[k.ctx] ??= zeroTotals())[k.event] += n
  }
  return { days: opts.days.map((d) => ({ day: d, totals: byDay.get(d)! })), total, byContext }
}

export type GateTotals = Record<GateAction, number>
export const zeroGateTotals = (): GateTotals => Object.fromEntries(GATE_ACTIONS.map((a) => [a, 0])) as GateTotals

/** The timed prompt's own events, read as a gate row: shown / google / email / completed. */
export function promptAsGate(t: SignupPromptTotals): GateTotals {
  return { open: t.shown, google: t.google_click, email: t.email_click, completed: t.signup_completed }
}

/**
 * Raw kv rows → the window's per-gate totals, and per gate per context class. Same filters as the
 * prompt's summary. (The timed prompt's row is `promptAsGate` over its own events.)
 */
export function summariseGates(
  rows: ReadonlyArray<{ key: string; n: number | bigint | string | null }>,
  opts: { site?: string; days: readonly string[] },
): { byGate: Record<string, GateTotals>; byGateContext: Record<string, Record<string, GateTotals>> } {
  const days = new Set(opts.days)
  const byGate: Record<string, GateTotals> = {}
  const byGateContext: Record<string, Record<string, GateTotals>> = {}
  for (const r of rows) {
    const k = parseGateCounterKey(r.key)
    if (!k || (opts.site && k.site !== opts.site) || !days.has(k.day)) continue
    const n = rowCount(r.n)
    if (n === null) continue
    ;(byGate[k.gate] ??= zeroGateTotals())[k.action] += n
    ;((byGateContext[k.gate] ??= {})[k.ctx] ??= zeroGateTotals())[k.action] += n
  }
  return { byGate, byGateContext }
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
