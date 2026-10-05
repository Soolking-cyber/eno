// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPLETION_WINDOW_MS } from '@/lib/signup-prompt'
import { GATE_RECORD_KEY, NAV_PRESS_WINDOW_MS, classifyGate, noteGateMethod, noteGateOpen, pressedInChrome, settleGateSignIn, spendGateRecord } from './signin-gates'

// ── UX3 J1: per-gate sign-in counters ─────────────────────────────────────────────────────────────

const T0 = new Date('2026-10-05T09:00:00Z').getTime()

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
let beacons: Array<Record<string, string>> = []

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.stubGlobal('localStorage', memoryStorage())
  beacons = []
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_url: string, b: Blob) => { void b.text().then((t) => beacons.push(JSON.parse(t))); return true },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
const flush = () => vi.waitFor(() => Promise.resolve())

describe('classifyGate — which gate asked', () => {
  const base = { pathname: '/', press: null, now: T0 }
  it('the timed prompt is itself; a named gate is what it says', () => {
    expect(classifyGate({ ...base, prompt: true, explicit: 'chat' })).toBe('timed')
    expect(classifyGate({ ...base, explicit: 'save_search' })).toBe('save_search')
  })

  it('the rental check and the post wizard are recognised by their page', () => {
    expect(classifyGate({ ...base, pathname: '/rentals/check' })).toBe('rental_check')
    expect(classifyGate({ ...base, pathname: '/post' })).toBe('post')
    expect(classifyGate({ ...base, pathname: '/post/details' })).toBe('post')
    expect(classifyGate({ ...base, pathname: '/postcards' })).toBe('other')
  })

  it('a press in the header or the tab bar within 10 s is the "nav" gate; an old one is not', () => {
    expect(classifyGate({ ...base, press: { at: T0 - 500, inChrome: true } })).toBe('nav')
    expect(classifyGate({ ...base, press: { at: T0 - NAV_PRESS_WINDOW_MS - 1, inChrome: true } })).toBe('other')
    expect(classifyGate({ ...base, press: { at: T0 - 500, inChrome: false } })).toBe('other')
  })

  it('a listing in hand with no named gate is messaging a lister ("chat"); anything else is "other"', () => {
    expect(classifyGate({ ...base, listing: true })).toBe('chat')
    expect(classifyGate(base)).toBe('other')
  })

  it('pressedInChrome: the SITE header and the tab bar only — not a section header or a breadcrumb nav', () => {
    document.body.innerHTML = [
      '<header id="app-header"><button id="h">Sign in</button></header>',
      '<nav class="mobile-nav"><button id="t">Tab</button></nav>',
      '<main><section><header><button id="sh">Save search</button></header></section>',
      '<nav aria-label="Breadcrumb"><button id="bc">x</button></nav><button id="m">Chat</button></main>',
    ].join('')
    expect(pressedInChrome(document.getElementById('h'))).toBe(true)
    expect(pressedInChrome(document.getElementById('t'))).toBe(true)
    expect(pressedInChrome(document.getElementById('sh'))).toBe(false)
    expect(pressedInChrome(document.getElementById('bc'))).toBe(false)
    expect(pressedInChrome(document.getElementById('m'))).toBe(false)
    expect(pressedInChrome(null)).toBe(false)
  })
})

describe('the gate counters — open, method, completed', () => {
  it('an opening is one beacon with the gate, the action and the coarse class', async () => {
    noteGateOpen('chat')
    await flush()
    expect(beacons).toEqual([{ g: 'chat', a: 'open', c: 'browser.desktop.en' }])
  })

  it('⛔ the timed prompt never sends gate events (it counts itself)', async () => {
    noteGateOpen('timed')
    noteGateMethod('timed', 'google')
    await flush()
    expect(beacons).toEqual([])
    expect(localStorage.getItem(GATE_RECORD_KEY)).toBeNull()
  })

  it('⛔ a method leaves a record; the next sign-in within the hour is that gate’s completion — once', async () => {
    noteGateMethod('save_search', 'google')
    expect(JSON.parse(localStorage.getItem(GATE_RECORD_KEY)!)).toEqual({ g: 'save_search', at: T0 })
    expect(spendGateRecord(T0 + 10 * 60_000)).toBe('save_search')
    expect(spendGateRecord(T0 + 11 * 60_000)).toBeNull()
    await flush()
    expect(beacons.map((b) => `${b.g}:${b.a}`)).toEqual(['save_search:google', 'save_search:completed'])
  })

  it('a sign-in more than an hour later, or from a clock that ran backwards, is not counted — and the record is spent', async () => {
    noteGateMethod('offer', 'email')
    expect(spendGateRecord(T0 + COMPLETION_WINDOW_MS + 1)).toBeNull()
    expect(localStorage.getItem(GATE_RECORD_KEY)).toBeNull()
    noteGateMethod('offer', 'email')
    expect(spendGateRecord(T0 - 1)).toBeNull()
    await flush()
    expect(beacons.map((b) => b.a)).toEqual(['email', 'email'])
  })

  it('⛔ two tabs hearing the same sign-in count it once — the spend runs under a Web Lock', async () => {
    // A minimal exclusive lock: callbacks for one name run strictly one after another.
    let chain = Promise.resolve()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_n: string, cb: () => void) => (chain = chain.then(() => cb())) },
    })
    noteGateMethod('chat', 'email')
    settleGateSignIn(T0 + 60_000) // tab A
    settleGateSignIn(T0 + 60_000) // tab B, the same moment
    await chain
    await flush()
    expect(beacons.filter((b) => b.a === 'completed')).toEqual([{ g: 'chat', a: 'completed', c: 'browser.desktop.en' }])
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  })

  it('⛔ never under automation (navigator.webdriver)', async () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
    noteGateOpen('nav')
    await flush()
    expect(beacons).toEqual([])
  })
})
