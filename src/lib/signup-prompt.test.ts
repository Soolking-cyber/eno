// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  AGAIN_AFTER_MS,
  COMPLETION_WINDOW_MS,
  DISMISSALS_BEFORE_PAUSE,
  FIRST_AFTER_MS,
  MAX_PER_TAB,
  MAX_TICK_CREDIT_MS,
  PAUSE_MS,
  PROMPT_METHOD_EVENT,
  afterDismissed,
  afterMethod,
  afterShown,
  afterSignedIn,
  UNKNOWN_CONTEXT,
  contextClassOf,
  contextParts,
  counterKey,
  creditTick,
  gateCounterKey,
  isCountedGate,
  isGateAction,
  parseContextClass,
  parseGateCounterKey,
  promptAsGate,
  summariseGates,
  freshDevice,
  freshTab,
  isDue,
  isExcludedPath,
  isSignupPromptEvent,
  isTypingTarget,
  pageBusy,
  parseCounterKey,
  parseDevice,
  parseTab,
  parseTestOverride,
  signupPromptRates,
  summariseSignupPrompt,
  vnDay,
  zeroTotals,
} from './signup-prompt'

// ── The "Join eno" prompt's schedule (owner, 2026-10-01: after a minute; dismissible; it returns) ──

const T0 = 1_800_000_000_000
const at = (ms: number) => ({ ...freshTab(), ms })

describe('signup-prompt — the visible-time clock', () => {
  it('credits only time the page was visible', () => {
    expect(creditTick(freshTab(), 1_000, true).ms).toBe(1_000)
    expect(creditTick(freshTab(), 1_000, false).ms).toBe(0)
  })

  it('⛔ a sleeping laptop resumes without being paid for the nap (one tick credits at most 2s)', () => {
    expect(creditTick(freshTab(), 3 * 60 * 60 * 1000, true).ms).toBe(MAX_TICK_CREDIT_MS)
  })

  it('ignores a clock that ran backwards or stood still', () => {
    expect(creditTick(at(5_000), -1_000, true).ms).toBe(5_000)
    expect(creditTick(at(5_000), 0, true).ms).toBe(5_000)
    expect(creditTick(at(5_000), Number.NaN, true).ms).toBe(5_000)
  })
})

describe('signup-prompt — when it is due', () => {
  it('first after 60s of visible browsing, not a millisecond before', () => {
    expect(FIRST_AFTER_MS).toBe(60_000)
    expect(isDue(at(59_999), freshDevice(), T0)).toBe(false)
    expect(isDue(at(60_000), freshDevice(), T0)).toBe(true)
  })

  it('after a close (×, Esc, backdrop), again after 3 MORE minutes of visible browsing — counted from the dismissal', () => {
    expect(AGAIN_AFTER_MS).toBe(180_000)
    const shown = afterShown(at(60_000), freshDevice(), T0)
    // The prompt stayed open for 20s of visible time before the visitor closed it.
    const later = afterDismissed({ ...shown.tab, ms: 80_000 }, shown.device, T0 + 20_000)
    expect(later.tab.nextAt).toBe(80_000 + AGAIN_AFTER_MS)
    const wall = T0 + 20_000 + AGAIN_AFTER_MS
    expect(isDue({ ...later.tab, ms: 80_000 + AGAIN_AFTER_MS - 1 }, later.device, wall)).toBe(false)
    expect(isDue({ ...later.tab, ms: 80_000 + AGAIN_AFTER_MS }, later.device, wall)).toBe(true)
  })

  it('⛔ at most twice per tab session', () => {
    expect(MAX_PER_TAB).toBe(2)
    let s = afterShown(at(60_000), freshDevice(), T0)
    s = afterDismissed(s.tab, s.device, T0)
    s = afterShown({ ...s.tab, ms: 240_000 }, s.device, T0 + 300_000)
    s = afterDismissed(s.tab, s.device, T0 + 300_000)
    expect(s.tab.shown).toBe(2)
    expect(isDue({ ...s.tab, ms: 10 * 60 * 60 * 1000 }, s.device, T0 + 10 * 60 * 60 * 1000)).toBe(false)
  })

  it('a NEW tab session asks again after 60s — the device remembers dismissals, not the tab count', () => {
    let s = afterShown(at(60_000), freshDevice(), T0)
    s = afterDismissed(s.tab, s.device, T0)
    // Next day, a new tab: fresh sessionStorage, same localStorage.
    expect(isDue(at(60_000), s.device, T0 + 24 * 60 * 60 * 1000)).toBe(true)
  })

  it('⛔ the 3rd dismissal overall pauses it for 7 days — then it starts over', () => {
    expect(DISMISSALS_BEFORE_PAUSE).toBe(3)
    let device = freshDevice()
    for (let i = 0; i < 3; i++) device = afterDismissed(at(60_000), device, T0).device
    expect(device.pausedUntil).toBe(T0 + PAUSE_MS)
    expect(device.dismissals).toBe(0)
    const nextDay = T0 + 24 * 60 * 60 * 1000
    expect(isDue(at(60_000), device, nextDay)).toBe(false)
    expect(isDue(at(60_000), device, T0 + PAUSE_MS - 1)).toBe(false)
    expect(isDue(at(60_000), device, T0 + PAUSE_MS)).toBe(true)
  })

  it('two dismissals do not pause it', () => {
    let device = freshDevice()
    for (let i = 0; i < 2; i++) device = afterDismissed(at(60_000), device, T0).device
    expect(device.pausedUntil).toBe(0)
    expect(isDue(at(60_000), device, T0 + 24 * 60 * 60 * 1000)).toBe(true)
  })

  it('⛔ signing in stops it for good', () => {
    const { device } = afterSignedIn(freshDevice(), T0)
    expect(isDue(at(10 * FIRST_AFTER_MS), device, T0 + 365 * 24 * 60 * 60 * 1000)).toBe(false)
  })

  it('a dismissal marks the tab "closed, not yet moved on" (for dismissed_then_continued)', () => {
    const once = afterDismissed(at(60_000), freshDevice(), T0)
    expect(once.tab.cont).toBe(1)
    // two closes on the same page are two dismissals waiting — one page change then resolves both
    expect(afterDismissed(once.tab, once.device, T0 + 1).tab.cont).toBe(2)
    expect(freshTab().cont).toBe(0)
  })

  it('⛔ another tab asked less than 3 minutes ago (wall clock): this one waits — five tabs are not five prompts', () => {
    const { device } = afterShown(at(60_000), freshDevice(), T0)
    expect(isDue(at(60_000), device, T0 + AGAIN_AFTER_MS - 1)).toBe(false)
    expect(isDue(at(60_000), device, T0 + AGAIN_AFTER_MS)).toBe(true)
  })

  it('a clock moved backwards cannot silence it: a future lastShownAt or an over-long pause is ignored', () => {
    expect(isDue(at(60_000), { ...freshDevice(), lastShownAt: T0 + 10 * 60 * 60 * 1000 }, T0)).toBe(true)
    expect(isDue(at(60_000), { ...freshDevice(), pausedUntil: T0 + 30 * PAUSE_MS }, T0)).toBe(true)
  })
})

describe('signup-prompt — what it stores, and reading it back', () => {
  it('round-trips both states and holds nothing but numbers and one flag', () => {
    const { tab, device } = afterShown(at(61_000), freshDevice(), T0)
    expect(parseTab(JSON.stringify(tab))).toEqual(tab)
    expect(parseDevice(JSON.stringify(device))).toEqual(device)
    expect(Object.keys(tab).sort()).toEqual(['cont', 'ms', 'nextAt', 'shown'])
    expect(Object.keys(device).sort()).toEqual(['dismissals', 'lastShownAt', 'member', 'methodAt', 'pausedUntil'])
    for (const v of [...Object.values(tab), ...Object.values(device)]) expect(['number', 'boolean']).toContain(typeof v)
  })

  it('anything malformed reads as fresh, never as a throw', () => {
    for (const raw of [null, '', 'nope', '{"ms":-1,"shown":0,"nextAt":60000}', '{"ms":"5"}', '[]']) {
      expect(parseTab(raw)).toEqual(freshTab())
    }
    expect(parseDevice('{"member":"yes","dismissals":-2}')).toEqual(freshDevice())
    expect(parseDevice('garbage')).toEqual(freshDevice())
  })

  it('the test override is a bounded number of ms, or nothing', () => {
    expect(parseTestOverride('1500')).toBe(1500)
    for (const raw of [null, '', '0', '99', 'fast', '-5', '3600001']) expect(parseTestOverride(raw)).toBeNull()
  })
})

describe('signup-prompt — where it never appears', () => {
  it.each([
    '/signin', '/signin/x', '/onboard', '/onboard/business', '/auth/callback', '/auth/escape',
    '/privacy', '/privacy/', '/terms', '/terms/v1', '/regulations', '/regulations/v1', '/returns', '/prohibited',
    '/legal/ranking', '/account-deletion', '/post', '/listings/abc-123/edit', '/messages', '/messages/abc',
    '/dashboard', '/dashboard/listings', '/admin', '/account', '/checkout/x', '/unsubscribe',
    '/post/details', '/terms/v2', '/regulations/v2',
  ])('excluded: %s', (p) => {
    expect(isExcludedPath(p)).toBe(true)
  })

  it.each(['/', '/listings/abc-123', '/c/phones', '/rentals', '/saved', '/help', '/signin-help', '/postcards', '/visas-guide', '/vietnam-evisa', '/terms-of-trade', '/accounting'])(
    'allowed: %s',
    (p) => { expect(isExcludedPath(p)).toBe(false) },
  )

  it('no path at all is treated as excluded (fail closed)', () => {
    expect(isExcludedPath('')).toBe(true)
    expect(isExcludedPath(null)).toBe(true)
  })
})

describe('signup-prompt — a calm screen', () => {
  const add = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d }

  it('a plain page is calm', () => {
    expect(pageBusy(document)).toBe(false)
  })

  it.each([
    ['the cookie bar (a non-modal Base UI dialog, open)', '<div role="dialog" data-open=""></div>'],
    ['an alert dialog', '<div role="alertdialog" data-open=""></div>'],
    ['an open menu', '<div role="menu" data-open=""></div>'],
    ['an open select', '<div role="listbox" data-open=""></div>'],
    ['a hand-rolled modal (account rail on mobile, PDP lightbox)', '<div role="dialog" aria-modal="true"></div>'],
    ['a 404 / error page', '<main data-error-page=""></main>'],
  ])('busy: %s', (_n, html) => {
    const el = add(html)
    expect(pageBusy(document)).toBe(true)
    el.remove()
  })

  it('⚠️ the desktop account rail (a role=dialog that stays mounted, not modal) does NOT park it forever', () => {
    const el = add('<aside role="dialog" aria-label="Account"></aside>')
    expect(pageBusy(document)).toBe(false)
    el.remove()
  })

  it('a focused text field is busy; a focused checkbox or button is not', () => {
    const el = add('<input id="q" type="search"><textarea id="t"></textarea><input id="c" type="checkbox"><button id="b">x</button>')
    for (const id of ['q', 't']) {
      ;(document.getElementById(id) as HTMLElement).focus()
      expect(pageBusy(document), id).toBe(true)
    }
    for (const id of ['c', 'b']) {
      ;(document.getElementById(id) as HTMLElement).focus()
      expect(pageBusy(document), id).toBe(false)
    }
    el.remove()
  })

  it('isTypingTarget: contenteditable counts, nothing focused does not', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(isTypingTarget(div)).toBe(true)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('signup-prompt — a completed sign-up is the prompt’s only if a method was chosen in it', () => {
  it('⛔ a sign-in within the hour after choosing Google or email counts once — then the mark is spent', () => {
    const chose = afterMethod(freshDevice(), T0)
    const first = afterSignedIn(chose, T0 + 10 * 60_000)
    expect(first.completed).toBe(true)
    expect(first.device).toMatchObject({ member: true, methodAt: 0 })
    expect(afterSignedIn(first.device, T0 + 11 * 60_000).completed).toBe(false)
  })

  it('a sign-in with no method chosen in the prompt, or more than an hour later, is not counted', () => {
    expect(afterSignedIn(freshDevice(), T0).completed).toBe(false)
    expect(afterSignedIn(afterMethod(freshDevice(), T0), T0 + COMPLETION_WINDOW_MS + 1).completed).toBe(false)
    // A clock that ran backwards is not a completion either.
    expect(afterSignedIn(afterMethod(freshDevice(), T0), T0 - 1).completed).toBe(false)
  })
})

describe('signup-prompt — the anonymous daily totals', () => {
  it('eight events (left_open since UX3 J1, apple_click since Sign in with Apple), and nothing else is a counter', () => {
    for (const e of ['shown', 'dismissed', 'dismissed_then_continued', 'google_click', 'apple_click', 'email_click', 'signup_completed', 'left_open']) expect(isSignupPromptEvent(e)).toBe(true)
    for (const e of ['', 'Shown', 'shown ', 'published', '__proto__', 'constructor', 42, null]) expect(isSignupPromptEvent(e)).toBe(false)
  })

  it('the day is Vietnam’s (UTC+7): 23:30 UTC is already tomorrow there', () => {
    expect(vnDay(Date.UTC(2026, 9, 1, 16, 59))).toBe('2026-10-01')
    expect(vnDay(Date.UTC(2026, 9, 1, 17, 0))).toBe('2026-10-02')
    expect(vnDay(Date.UTC(2026, 9, 1, 23, 30))).toBe('2026-10-02')
  })

  it('⛔ a key holds the day, the edition, the event and the coarse class — nothing about anyone — and reads back', () => {
    const k = counterKey('2026-10-01', 'marketplace', 'dismissed_then_continued', 'inapp-zalo.phone.vi')
    expect(k).toBe('signup-prompt:2026-10-01:marketplace:dismissed_then_continued:inapp-zalo.phone.vi')
    expect(parseCounterKey(k)).toEqual({ day: '2026-10-01', site: 'marketplace', event: 'dismissed_then_continued', ctx: 'inapp-zalo.phone.vi' })
    // No class → "unknown"; a made-up class can never reach a key.
    expect(counterKey('2026-10-01', 'marketplace', 'shown')).toBe('signup-prompt:2026-10-01:marketplace:shown:unknown')
    expect(counterKey('2026-10-01', 'marketplace', 'shown', 'Mozilla/5.0 iPhone')).toBe('signup-prompt:2026-10-01:marketplace:shown:unknown')
    for (const bad of [
      'site-stats:salt:2026-10-01', 'signup-prompt:2026-10-01:marketplace:hacked', 'signup-prompt:yesterday:marketplace:shown',
      'signup-prompt:2026-10-01:marketplace:shown:browser.tablet.en', 'signup-prompt:2026-10-01:marketplace:shown:x.y.z',
    ]) expect(parseCounterKey(bad)).toBeNull()
  })

  it('⛔ a week-one key (before the class existed) still reads back — as "unknown" — so the totals keep adding up', () => {
    expect(parseCounterKey('signup-prompt:2026-10-01:marketplace:shown')).toEqual({ day: '2026-10-01', site: 'marketplace', event: 'shown', ctx: UNKNOWN_CONTEXT })
  })

  it('⛔ the context class is a closed set of 24: 6 kinds of browser × phone/desktop × vi/en', () => {
    const all: string[] = []
    for (const c of ['native', 'inapp-fb', 'inapp-zalo', 'inapp-other', 'pwa', 'browser'] as const) {
      for (const d of ['phone', 'desktop'] as const) for (const l of ['vi', 'en'] as const) all.push(contextClassOf(c, d, l))
    }
    expect(new Set(all).size).toBe(24)
    for (const c of all) expect(parseContextClass(c)).toBe(c)
    for (const bad of [null, '', 'browser', 'browser.phone', 'browser.phone.ko', 'safari.phone.vi', 'browser.phone.vi.extra', '__proto__', 7]) {
      expect(parseContextClass(bad)).toBe(UNKNOWN_CONTEXT)
      expect(contextParts(bad)).toBeNull()
    }
  })

  it('summarises per day and over the window, for one edition, ignoring foreign and junk rows', () => {
    const days = ['2026-10-01', '2026-10-02']
    const rows = [
      { key: counterKey('2026-10-01', 'marketplace', 'shown'), n: 10 },
      { key: counterKey('2026-10-02', 'marketplace', 'shown'), n: '5' },
      { key: counterKey('2026-10-02', 'marketplace', 'dismissed'), n: BigInt(3) },
      { key: counterKey('2026-10-02', 'services', 'shown'), n: 99 },
      { key: counterKey('2026-09-01', 'marketplace', 'shown'), n: 99 },
      { key: counterKey('2026-10-01', 'marketplace', 'google_click'), n: -4 },
      { key: 'kv:other', n: 7 },
    ]
    const s = summariseSignupPrompt(rows, { site: 'marketplace', days })
    expect(s.days.map((d) => [d.day, d.totals.shown, d.totals.dismissed])).toEqual([['2026-10-01', 10, 0], ['2026-10-02', 5, 3]])
    expect(s.total).toEqual({ ...zeroTotals(), shown: 15, dismissed: 3 })
    expect(summariseSignupPrompt(rows, { days }).total.shown).toBe(15 + 99)
  })

  it('splits the window by context class, and a week-one row joins the "unknown" bucket', () => {
    const days = ['2026-10-05']
    const rows = [
      { key: counterKey('2026-10-05', 'marketplace', 'shown', 'browser.phone.vi'), n: 4 },
      { key: counterKey('2026-10-05', 'marketplace', 'left_open', 'browser.phone.vi'), n: 2 },
      { key: counterKey('2026-10-05', 'marketplace', 'shown', 'pwa.phone.en'), n: 1 },
      { key: 'signup-prompt:2026-10-05:marketplace:shown', n: 3 },
    ]
    const s = summariseSignupPrompt(rows, { site: 'marketplace', days })
    expect(s.total.shown).toBe(8)
    expect(s.byContext['browser.phone.vi']).toEqual({ ...zeroTotals(), shown: 4, left_open: 2 })
    expect(s.byContext['pwa.phone.en'].shown).toBe(1)
    expect(s.byContext[UNKNOWN_CONTEXT].shown).toBe(3)
  })

  it('the rates the owner asked for — and "no data" rather than 0% when nothing was shown', () => {
    const r = signupPromptRates({ ...zeroTotals(), shown: 200, dismissed: 120, dismissed_then_continued: 90, google_click: 30, email_click: 10, signup_completed: 12 })
    expect(r.closeRate).toBeCloseTo(0.6)
    expect(r.bounceAfterClose).toBeCloseTo(30 / 120)
    expect(r.startRate).toBeCloseTo(0.2)
    expect(r.completionRate).toBeCloseTo(0.3)
    expect(r.signupPerShow).toBeCloseTo(0.06)
    expect(signupPromptRates({ ...zeroTotals(), shown: 200, left_open: 50 }).leftOpenRate).toBeCloseTo(0.25)
    expect(signupPromptRates(zeroTotals())).toEqual({ closeRate: null, bounceAfterClose: null, startRate: null, completionRate: null, signupPerShow: null, leftOpenRate: null })
  })
})

describe('signup-prompt — per-gate sign-in counters (UX3 J1)', () => {
  it('every gate but the timed prompt sends its own events; five actions (apple since 2026-10-08) and nothing else', () => {
    for (const g of ['first_save', 'chat', 'offer', 'rental_check', 'save_search', 'post', 'nav', 'page', 'other']) expect(isCountedGate(g)).toBe(true)
    for (const g of ['timed', '', 'Chat', 'checkout', null]) expect(isCountedGate(g)).toBe(false)
    for (const a of ['open', 'google', 'apple', 'email', 'completed']) expect(isGateAction(a)).toBe(true)
    for (const a of ['shown', 'Open', '', null]) expect(isGateAction(a)).toBe(false)
  })

  it('⛔ a gate key holds the day, the edition, the gate, the action and the class — and reads back', () => {
    const k = gateCounterKey('2026-10-05', 'marketplace', 'save_search', 'completed', 'inapp-fb.phone.vi')
    expect(k).toBe('signin-gate:2026-10-05:marketplace:save_search:completed:inapp-fb.phone.vi')
    expect(parseGateCounterKey(k)).toEqual({ day: '2026-10-05', site: 'marketplace', gate: 'save_search', action: 'completed', ctx: 'inapp-fb.phone.vi' })
    expect(gateCounterKey('2026-10-05', 'marketplace', 'chat', 'open', 'nonsense')).toBe('signin-gate:2026-10-05:marketplace:chat:open:unknown')
    for (const bad of [
      'signin-gate:2026-10-05:marketplace:timed:open:unknown', 'signin-gate:2026-10-05:marketplace:chat:shown:unknown',
      'signin-gate:2026-10-05:marketplace:chat:open', 'signup-prompt:2026-10-05:marketplace:shown:unknown',
    ]) expect(parseGateCounterKey(bad)).toBeNull()
  })

  it('summarises per gate and per gate × class over the window, for one edition', () => {
    const days = ['2026-10-04', '2026-10-05']
    const rows = [
      { key: gateCounterKey('2026-10-05', 'marketplace', 'chat', 'open', 'inapp-zalo.phone.vi'), n: 6 },
      { key: gateCounterKey('2026-10-05', 'marketplace', 'chat', 'email', 'inapp-zalo.phone.vi'), n: 3 },
      { key: gateCounterKey('2026-10-04', 'marketplace', 'chat', 'completed', 'inapp-zalo.phone.vi'), n: '2' },
      { key: gateCounterKey('2026-10-05', 'marketplace', 'chat', 'open', 'browser.desktop.en'), n: 1 },
      { key: gateCounterKey('2026-10-05', 'services', 'chat', 'open', 'browser.desktop.en'), n: 50 },
      { key: gateCounterKey('2026-09-01', 'marketplace', 'chat', 'open', 'browser.desktop.en'), n: 50 },
      { key: counterKey('2026-10-05', 'marketplace', 'shown', 'browser.desktop.en'), n: 9 },
    ]
    const g = summariseGates(rows, { site: 'marketplace', days })
    expect(g.byGate.chat).toEqual({ open: 7, google: 0, apple: 0, email: 3, completed: 2 })
    expect(g.byGateContext.chat['inapp-zalo.phone.vi']).toEqual({ open: 6, google: 0, apple: 0, email: 3, completed: 2 })
    expect(g.byGate.offer).toBeUndefined()
  })

  it('the timed prompt reads as a gate row from its own events', () => {
    expect(promptAsGate({ ...zeroTotals(), shown: 10, google_click: 2, apple_click: 3, email_click: 1, signup_completed: 1 })).toEqual({ open: 10, google: 2, apple: 3, email: 1, completed: 1 })
  })

  it('an Apple choice is counted and read back like the others (Sign in with Apple)', () => {
    const k = gateCounterKey('2026-10-08', 'marketplace', 'chat', 'apple', 'browser.phone.vi')
    expect(parseGateCounterKey(k)).toEqual({ day: '2026-10-08', site: 'marketplace', gate: 'chat', action: 'apple', ctx: 'browser.phone.vi' })
    expect(parseCounterKey(counterKey('2026-10-08', 'marketplace', 'apple_click', 'native.phone.en'))).toEqual({ day: '2026-10-08', site: 'marketplace', event: 'apple_click', ctx: 'native.phone.en' })
    expect(PROMPT_METHOD_EVENT).toEqual({ google: 'google_click', apple: 'apple_click', email: 'email_click' })
    // apple counts as a start, so the rates stay shares of the same asks
    const r = signupPromptRates({ ...zeroTotals(), shown: 10, google_click: 1, apple_click: 2, email_click: 1, signup_completed: 2 })
    expect(r.startRate).toBeCloseTo(0.4)
    expect(r.completionRate).toBeCloseTo(0.5)
  })
})
