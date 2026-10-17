// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk, maySessionAsk, noteSessionAsk, notePageView, sessionAsk, SESSION_ASK_KEY, VISIT_IDLE_MS } from './page-asks'

// ── UX3 J7f: never two asks in one page view — the "Join eno" prompt and the app-install card ──────
// ── and, since 2026-10-18, one interruption per VISIT (owner: "one per visit, no floaters") ─────────

beforeEach(() => __resetPageAsksForTests())

/** A new browsing session in the same page life: the tab's session record is gone (a reload would also reset the module). */
const newSession = () => window.sessionStorage.removeItem(SESSION_ASK_KEY)

describe('page-asks — one ask per page view', () => {
  it('either ask may appear on a page nothing else has asked on', () => {
    expect(mayAsk('join', '/')).toBe(true)
    expect(mayAsk('install', '/')).toBe(true)
  })

  it('⛔ while one is on screen the other waits — and still waits in the same page view after it is gone', () => {
    askShown('install', '/')
    expect(mayAsk('join', '/')).toBe(false)
    askHidden('install')
    expect(mayAsk('join', '/')).toBe(false)
    // The next page view frees it as far as THIS rule goes — the session rule (below) is what still says no.
    newSession()
    expect(mayAsk('join', '/c/phones')).toBe(true)
  })

  it('an ask still on screen when the route changes has appeared in the new page view too', () => {
    askShown('install', '/')
    notePageView('/rentals')
    askHidden('install')
    newSession()
    expect(mayAsk('join', '/rentals')).toBe(false)
    expect(mayAsk('join', '/c/phones')).toBe(true)
  })

  it('A → B → A is three page views, not one', () => {
    askShown('join', '/')
    askHidden('join')
    newSession()
    expect(mayAsk('install', '/')).toBe(false)
    notePageView('/c/phones')
    notePageView('/')
    expect(mayAsk('install', '/')).toBe(true)
  })

  it('the same ask again is not blocked by itself', () => {
    askShown('join', '/')
    expect(mayAsk('join', '/')).toBe(true)
  })
})

describe('page-asks — one interruption per visit (owner, 2026-10-18)', () => {
  it('⛔ the cookie bar took the session: neither the install card nor the join prompt asks again in it, on any page', () => {
    noteSessionAsk('consent')
    expect(sessionAsk()).toBe('consent')
    for (const path of ['/', '/c/phones', '/listings/x']) {
      expect(mayAsk('install', path)).toBe(false)
      expect(mayAsk('join', path)).toBe(false)
    }
  })

  it('⛔ the install card took it: the join prompt waits for a later session — not just for the next page', () => {
    askShown('install', '/')
    askHidden('install')
    notePageView('/c/phones')
    notePageView('/rentals')
    expect(mayAsk('join', '/rentals')).toBe(false)
    newSession()
    expect(mayAsk('join', '/rentals')).toBe(true)
  })

  it('⛔ the join prompt took it: the install card waits for a later session', () => {
    askShown('join', '/')
    askHidden('join')
    notePageView('/c/phones')
    expect(mayAsk('install', '/c/phones')).toBe(false)
  })

  it('the first one keeps it — a later appearance never overwrites the record', () => {
    noteSessionAsk('consent')
    noteSessionAsk('install')
    expect(sessionAsk()).toBe('consent')
    expect(maySessionAsk('consent')).toBe(true)
    expect(maySessionAsk('install')).toBe(false)
  })

  it('the push card is no interruption: it neither takes the session nor is held back by it', () => {
    askShown('push', '/post')
    expect(sessionAsk()).toBeNull()
    askHidden('push')
    noteSessionAsk('consent')
    notePageView('/messages')
    expect(mayAsk('push', '/messages')).toBe(true)
  })

  it('the record lives in this tab\'s sessionStorage — and in memory when storage is blocked', () => {
    noteSessionAsk('install')
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_ASK_KEY)!)).toMatchObject({ k: 'install', t: expect.any(Number) })
    __resetPageAsksForTests()
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    vi.stubGlobal('sessionStorage', throwing)
    try {
      expect(sessionAsk()).toBeNull()
      noteSessionAsk('join')
      expect(sessionAsk()).toBe('join')
      expect(mayAsk('install', '/')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      __resetPageAsksForTests()
    }
  })

  it('⛔ a storage that READS but refuses to WRITE (a full quota) still keeps the visit to one ask (gate 2026-10-18)', () => {
    const quotaFull = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
      removeItem: () => {},
    }
    vi.stubGlobal('sessionStorage', quotaFull)
    try {
      noteSessionAsk('consent')
      expect(sessionAsk()).toBe('consent')
      expect(mayAsk('install', '/')).toBe(false)
      expect(mayAsk('join', '/c/phones')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      __resetPageAsksForTests()
    }
  })

  it('a value that is not the record (an older bare string, a hand edit) leaves the visit unclaimed', () => {
    window.sessionStorage.setItem(SESSION_ASK_KEY, 'consent')
    expect(sessionAsk()).toBeNull()
    expect(mayAsk('install', '/')).toBe(true)
  })

  describe('⛔ a visit ends after 30 minutes AWAY, not with the tab — and never while the page is in front (gate 2026-10-18)', () => {
    const T0 = new Date('2026-10-18T09:00:00Z').getTime()
    const MIN = 60_000
    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    /** The tab goes to the background at the current time, and is back in front at `at`. */
    const awayUntil = (at: number) => { setVisibility('hidden'); vi.setSystemTime(at); setVisibility('visible') }
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0) })
    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(document, 'visibilityState') // back to jsdom's own getter
    })

    it('the next morning in the same tab is a new visit: the install card may ask again', () => {
      noteSessionAsk('consent')
      expect(mayAsk('install', '/')).toBe(false)
      awayUntil(T0 + 14 * 60 * MIN)
      expect(sessionAsk()).toBeNull()
      expect(mayAsk('install', '/c/phones')).toBe(true)
    })

    it('⛔ an hour of scrolling ONE page, never leaving it, is still one visit (codex + opus, round 3)', () => {
      notePageView('/')
      noteSessionAsk('consent')
      vi.setSystemTime(T0 + 61 * MIN)
      expect(sessionAsk()).toBe('consent')
      expect(mayAsk('join', '/')).toBe(false)
      expect(mayAsk('install', '/')).toBe(false)
    })

    it('away 29 minutes is the same visit; away 31 is a new one — time away, measured from when they left', () => {
      noteSessionAsk('join')
      vi.setSystemTime(T0 + 50 * MIN) // fifty minutes in front: no clock runs while the page is in use
      awayUntil(T0 + 79 * MIN)
      expect(sessionAsk()).toBe('join')
      awayUntil(T0 + 79 * MIN + 31 * MIN)
      expect(sessionAsk()).toBeNull()
    })

    it('exactly 30 minutes away is already a new visit', () => {
      noteSessionAsk('install')
      awayUntil(T0 + VISIT_IDLE_MS)
      expect(sessionAsk()).toBeNull()
    })

    it('⛔ a background timer while the tab is hidden does not count as the visitor coming back (codex, round 6)', () => {
      noteSessionAsk('consent')
      setVisibility('hidden')
      vi.setSystemTime(T0 + 75_000)
      expect(mayAsk('install', '/')).toBe(false) // the install card's timer, firing in the background: still claimed
      vi.setSystemTime(T0 + 5 * 60 * MIN)
      setVisibility('visible')
      expect(sessionAsk()).toBeNull()
      expect(mayAsk('install', '/')).toBe(true)
    })

    it('a reload a moment later (pagehide, a new page life) is the same visit', () => {
      noteSessionAsk('install')
      window.dispatchEvent(new Event('pagehide'))
      vi.setSystemTime(T0 + 5_000)
      expect(sessionAsk()).toBe('install')
    })

    it('a long-dormant record is not revived by leaving again before anything looked at it', () => {
      noteSessionAsk('consent')
      setVisibility('hidden')
      vi.setSystemTime(T0 + 3 * 24 * 60 * MIN)
      setVisibility('visible')
      setVisibility('hidden') // gone again before any ask was evaluated
      vi.setSystemTime(T0 + 3 * 24 * 60 * MIN + MIN)
      setVisibility('visible')
      expect(sessionAsk()).toBeNull()
    })
  })

  it('a claim the LAST page life wrote survives a storage that stops answering after it was read (gate round 4)', () => {
    window.sessionStorage.setItem(SESSION_ASK_KEY, JSON.stringify({ k: 'consent', t: Date.now() }))
    expect(sessionAsk()).toBe('consent')
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} })
    try {
      expect(sessionAsk()).toBe('consent')
      expect(mayAsk('install', '/')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      __resetPageAsksForTests()
    }
  })

  it('a storage that refuses reads AFTER a successful write still knows the claim (memory mirrors every write)', () => {
    noteSessionAsk('install')
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} })
    try {
      expect(sessionAsk()).toBe('install')
      expect(mayAsk('join', '/')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      __resetPageAsksForTests()
    }
  })
})
