import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE CONCIERGE'S SWITCH AND SESSIONS (config.ts; PLAN §10 "The switch" and "Server-side session"). kv is an in-memory
 * stand-in with the real one's shapes (JSON in, JSON out; incrby returns the new count) and a switch per call to make it
 * throw — kv_store is UNLOGGED, so every reading of it must fail CLOSED: an unreadable switch is `off`, an unreadable
 * session is over, an unreadable offer was never made. No database.
 */
const h = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  const down = { get: false, set: false, incrby: false, del: false }
  const json = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
  const kv = {
    get: vi.fn(async (k: string) => {
      if (down.get) throw new Error(`kv down (${k})`)
      return store.has(k) ? json(store.get(k)) : null
    }),
    set: vi.fn(async (k: string, v: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (down.set) throw new Error('kv down')
      if (opts?.nx && store.has(k)) return null // kv_set's NX (TTL expiry is not modelled)
      store.set(k, json(v))
      return 'OK' as const
    }),
    incrby: vi.fn(async (k: string, by: number, _exSec?: number) => {
      if (down.incrby) throw new Error('kv down')
      const n = Number(store.get(k) ?? 0) + by
      store.set(k, n)
      return n
    }),
    del: vi.fn(async (k: string) => {
      if (down.del) throw new Error('kv down')
      store.delete(k)
    }),
  }
  return { store, down, kv, isStaff: vi.fn(async (id: string) => id.startsWith('staff-')), logError: vi.fn(), services: false }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({ kv: h.kv }))
vi.mock('@/lib/user-blocks', () => ({ isStaffProfile: h.isStaff }))
vi.mock('@/lib/log', () => ({ logError: h.logError }))
// The edition is read at each call through the getter: eno.vn by default, eno.forum where a test says so.
vi.mock('@/lib/edition', () => ({ get IS_SERVICES() { return h.services } }))

import {
  DAILY_SECONDS, MIN_CHARGE_SECONDS, MIN_SESSION_SECONDS, MODE_KEY, SESSION_MINUTES, SITE_SESSIONS_PER_DAY, VOICE_GUIDE_IN_PRIVACY, conciergeOpenFor, endSession, liveSession, readConciergeMode,
  rememberOffer, resetConciergeModeCache, startSession, takeOffer,
} from './config'

afterEach(() => {
  h.store.clear()
  Object.assign(h.down, { get: false, set: false, incrby: false, del: false })
  h.services = false
  vi.clearAllMocks()
  resetConciergeModeCache()
})

/** 2026-10-27 10:00 ICT. */
const T = Date.UTC(2026, 9, 27, 3, 0)

describe('readConciergeMode — the switch (fails closed)', () => {
  it('reads the kv key concierge:mode; `staff` / `all` ONLY when it holds exactly "staff" / "all"', async () => {
    expect(MODE_KEY).toBe('concierge:mode')
    h.store.set(MODE_KEY, 'staff')
    expect(await readConciergeMode({ fresh: true })).toBe('staff')
    expect(h.kv.get).toHaveBeenLastCalledWith('concierge:mode')
    h.store.set(MODE_KEY, 'all')
    expect(await readConciergeMode({ fresh: true })).toBe('all')
    for (const v of ['off', 'STAFF', ' staff', 'staff ', 'ALL', ' all', 'everyone', 'on', true, 1, { mode: 'staff' }, ['all'], null]) {
      h.store.set(MODE_KEY, v)
      expect(await readConciergeMode({ fresh: true }), JSON.stringify(v)).toBe('off')
    }
  })

  it('missing → off', async () => {
    expect(await readConciergeMode({ fresh: true })).toBe('off')
  })

  it('an unreadable kv → off, the failure logged (op only)', async () => {
    h.store.set(MODE_KEY, 'staff')
    h.down.get = true
    expect(await readConciergeMode({ fresh: true })).toBe('off')
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { op: 'concierge.mode' })
  })

  it('cached 30 s per process: no read inside the window, a re-read at its end; fresh:true re-reads at once', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await readConciergeMode({}, T)).toBe('staff')
    expect(h.kv.get).toHaveBeenCalledTimes(1)
    h.store.set(MODE_KEY, 'off') // the owner switches it off
    expect(await readConciergeMode({}, T + 29_999)).toBe('staff')
    expect(h.kv.get).toHaveBeenCalledTimes(1)
    expect(await readConciergeMode({}, T + 30_000)).toBe('off')
    expect(h.kv.get).toHaveBeenCalledTimes(2)
    // a fresh read (a session start) sees a change at once, and the cache with it
    h.store.set(MODE_KEY, 'staff')
    expect(await readConciergeMode({ fresh: true }, T + 30_001)).toBe('staff')
    expect(await readConciergeMode({}, T + 30_002)).toBe('staff')
    expect(h.kv.get).toHaveBeenCalledTimes(3)
  })

  it('⚠️ a failed read is cached as `off` too — a kv hiccup can close the concierge for ≤ 30 s, never open it', async () => {
    h.down.get = true
    expect(await readConciergeMode({}, T)).toBe('off')
    h.down.get = false
    h.store.set(MODE_KEY, 'staff')
    expect(await readConciergeMode({}, T + 1_000)).toBe('off')
    expect(await readConciergeMode({ fresh: true }, T + 2_000)).toBe('staff')
  })
})

/** A browser's user agent — the website (the switch's own rule). */
const WEB = { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }
/** The apps as they ship today (iOS build 4, Android vc4/vc5): `EnoNativeApp/1` alone — and the shells built for the guide. */
const OLD_IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const OLD_ANDROID_APP = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 EnoNativeApp/1'
const VOICE_IOS_APP = `${OLD_IOS_APP} EnoVoice/1`
const VOICE_ANDROID_APP = `${OLD_ANDROID_APP} EnoVoice/1`

describe('⛔ the apps — only a binary built for the guide (owner, 2026-10-29: "also ios android apps add the live concierge to them too")', () => {
  it('an app without `EnoVoice` (today\'s iOS build 4, Android vc4/vc5) is CLOSED whatever the switch says — staff included', async () => {
    for (const mode of ['all', 'staff']) {
      h.store.set(MODE_KEY, mode)
      for (const ua of [OLD_IOS_APP, OLD_ANDROID_APP, 'Mozilla/5.0 EnoNativeTabs/1', 'Mozilla/5.0 EnoNativeTabs/1 EnoVoice/1']) {
        expect(await conciergeOpenFor('staff-1', { fresh: true, ua }), `${mode} ${ua}`).toBe(false)
      }
    }
  })

  it('a binary that carries it follows the website\'s own rule: `all` opens it for everyone, `staff` for the team, `off` for nobody', async () => {
    h.store.set(MODE_KEY, 'all')
    for (const ua of [VOICE_IOS_APP, VOICE_ANDROID_APP]) expect(await conciergeOpenFor('p-member', { fresh: true, ua })).toBe(VOICE_GUIDE_IN_PRIVACY)
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: VOICE_ANDROID_APP })).toBe(true)
    expect(await conciergeOpenFor('p-member', { fresh: true, ua: VOICE_ANDROID_APP })).toBe(false)
    h.store.set(MODE_KEY, 'off')
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: VOICE_IOS_APP })).toBe(false)
  })

  it('the token alone, outside an app, is just a browser (no app, nothing gained): the website\'s rule', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('p-member', { fresh: true, ua: 'Mozilla/5.0 EnoVoice/1' })).toBe(false)
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: 'Mozilla/5.0 EnoVoice/1' })).toBe(true)
  })
})

describe('conciergeOpenFor — who may use it now', () => {
  it('the switch at `staff` and a staff account → open', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(true)
    expect(h.isStaff).toHaveBeenCalledWith('staff-1')
  })

  it('anyone else → closed', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('p-member', WEB)).toBe(false)
  })

  it('the switch at `all` (owner, 2026-10-28: "open up new concierge for everyone"): every account once /privacy names the guide\'s recipients — the staff before it', async () => {
    h.store.set(MODE_KEY, 'all')
    if (VOICE_GUIDE_IN_PRIVACY) {
      expect(await conciergeOpenFor('p-member', { fresh: true, ua: null })).toBe(true)
      expect(h.isStaff).not.toHaveBeenCalled()
    } else {
      expect(await conciergeOpenFor('p-member', { fresh: true, ua: null })).toBe(false)
      expect(await conciergeOpenFor('staff-1', { fresh: true, ua: null })).toBe(true)
    }
  })

  it('⛔ VOICE_GUIDE_IN_PRIVACY is true only while /privacy names Soniox, OpenAI and Google', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/[lang]/privacy/page.tsx', 'utf8')
    // Soniox and OpenAI as recipients, and the voice guide named (Google is on the page for sign-in already — commit review, opus)
    if (VOICE_GUIDE_IN_PRIVACY) for (const name of ['Soniox', 'OpenAI', 'voice guide']) expect(page, name).toContain(name)
    else expect(page.includes('Soniox') && page.includes('OpenAI')).toBe(false)
  })

  it('⛔ `all` on eno.forum: still never', async () => {
    h.services = true
    h.store.set(MODE_KEY, 'all')
    expect(await conciergeOpenFor('p-member', { fresh: true, ua: null })).toBe(false)
  })

  it('the switch off (or missing): closed, and the account is never looked up', async () => {
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(false)
    h.store.set(MODE_KEY, 'off')
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: null })).toBe(false)
    expect(h.isStaff).not.toHaveBeenCalled()
  })

  it('the staff check failing → closed (fails closed)', async () => {
    h.store.set(MODE_KEY, 'staff')
    h.isStaff.mockRejectedValueOnce(new Error('db down'))
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(false)
  })

  it('⛔ eno.forum (the services edition): never — the switch is not even read', async () => {
    h.services = true
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: null })).toBe(false)
    expect(h.kv.get).not.toHaveBeenCalled()
    expect(h.isStaff).not.toHaveBeenCalled()
  })

  it('fresh:true reaches the switch past the cache (the start route); without it, the cached value', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(true)
    h.store.set(MODE_KEY, 'off')
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(true) // cached ≤ 30 s (PLAN §10: switching off refuses within that)
    expect(await conciergeOpenFor('staff-1', { fresh: true, ua: null })).toBe(false)
    expect(await conciergeOpenFor('staff-1', WEB)).toBe(false)
  })
})

const rows = () => [...h.store.keys()].filter((k) => k.startsWith('concierge:session:') && !k.endsWith(':ended')).length
const hold = (id: string) => (h.store.get(`concierge:live:${id}`) as { id: string } | undefined)?.id
const secondsKey = (id: string, day = '2026-10-27') => `concierge:seconds:${day}:${id}`

describe('startSession — the eno team: no day counter (owner, 2026-10-28: "unlimited for admin")', () => {
  it('a session of 15 minutes, stored with a TTL past its end — and no counter is touched', async () => {
    expect(SESSION_MINUTES).toBe(15)
    const s = await startSession('staff-1', T)
    expect(s).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), profileId: 'staff-1', deadline: T + 15 * 60_000, startedAt: T })
    expect(h.kv.set).toHaveBeenCalledWith(`concierge:session:${s!.id}`, s, { ex: 15 * 60 + 60 })
    expect(h.kv.incrby).not.toHaveBeenCalled()
  })

  it('as many as they like, even with the site\'s day used up; ids are random', async () => {
    h.store.set('concierge:starts:2026-10-27', SITE_SESSIONS_PER_DAY)
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) ids.add((await startSession('staff-1', T))!.id)
    expect(ids.size).toBe(50)
  })

  it('⛔ a staff check that fails is NOT staff: the account gets everyone\'s 10 minutes', async () => {
    h.isStaff.mockRejectedValueOnce(new Error('db down'))
    const s = await startSession('staff-1', T)
    expect(s!.deadline).toBe(T + DAILY_SECONDS * 1000)
    expect(h.store.get(secondsKey('staff-1'))).toBe(DAILY_SECONDS)
  })
})

describe('startSession — everyone else: 10 minutes a Vietnam day (owner, 2026-10-28: "10 minutes per user per day")', () => {
  it('the first session holds the day\'s 600 s: deadline = now + 10 min, the row carries what it holds', async () => {
    expect(DAILY_SECONDS).toBe(600)
    const s = await startSession('p-1', T)
    expect(s).toEqual({ id: expect.any(String), profileId: 'p-1', deadline: T + 600_000, startedAt: T, budgetKey: secondsKey('p-1'), reserved: 600 })
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
  })

  it('ended after 2 minutes: 8 minutes go back, and the next session gets exactly those 8', async () => {
    const a = (await startSession('p-1', T))!
    await endSession(a, T + 120_000)
    expect(h.store.get(secondsKey('p-1'))).toBe(120)
    const b = (await startSession('p-1', T + 200_000))!
    expect(b.reserved).toBe(480)
    expect(b.deadline).toBe(T + 200_000 + 480_000)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
  })

  it('one session at a time — the NEWEST window wins: a second start ends the first (refunded) and takes over', async () => {
    const a = (await startSession('p-1', T))!
    expect(hold('p-1')).toBe(a.id)
    expect(h.kv.set).toHaveBeenCalledWith('concierge:live:p-1', { id: a.id, at: T }, { ex: 600 })
    // a reload, a second tab, a swiped-away tab whose end never arrived: 2 minutes in
    const b = (await startSession('p-1', T + 120_000))!
    expect(b.reserved).toBe(480)
    expect(await liveSession(a.id, 'p-1', T + 121_000)).toBeNull()
    expect(hold('p-1')).toBe(b.id)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
    expect(rows()).toBe(1)
  })

  it('a hold with no session behind it: waited for while it is a start on its way (< 10 s), then refused; taken once older', async () => {
    h.store.set('concierge:live:p-1', { id: 'X'.repeat(22), at: T })
    const out: { cap?: 'account' | 'site' } = {}
    const t0 = Date.now()
    expect(await startSession('p-1', T + 5_000, out)).toBeNull()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2_900)
    expect(out.cap).toBe('account')
    expect(h.store.get(secondsKey('p-1'))).toBeUndefined()
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(0)
    const s = (await startSession('p-1', T + 11_000))!
    expect(s.reserved).toBe(600)
    expect(hold('p-1')).toBe(s.id)
  })

  it('the end hands the hold back, after the refund: the next start reads the day as it is', async () => {
    const a = (await startSession('p-1', T))!
    await endSession(a, T + 300_000)
    expect(hold('p-1')).toBeUndefined()
    expect((await startSession('p-1', T + 301_000))!.reserved).toBe(300)
  })

  it(`a session costs at least ${MIN_CHARGE_SECONDS} s however soon it is closed — so a start-✕ loop stops after ${DAILY_SECONDS / 60} starts`, async () => {
    expect(MIN_CHARGE_SECONDS).toBe(60)
    const a = (await startSession('p-1', T))!
    await endSession(a, T + 2000)
    expect(h.store.get(secondsKey('p-1'))).toBe(60)
    for (let i = 1; i < 10; i++) await endSession((await startSession('p-1', T + i * 10_000))!, T + i * 10_000 + 1000)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
    const out: { cap?: 'account' | 'site' } = {}
    expect(await startSession('p-1', T + 200_000, out)).toBeNull()
    expect(out.cap).toBe('account')
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(10)
  })

  it('a session with under a minute left is charged it all', async () => {
    h.store.set(secondsKey('p-1'), 560)
    const a = (await startSession('p-1', T))!
    expect(a.reserved).toBe(40)
    await endSession(a, T + 1000)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
  })

  it('every refusal and failure after the hold hands the hold back', async () => {
    h.store.set(secondsKey('p-1'), 590)
    expect(await startSession('p-1', T)).toBeNull()
    expect(hold('p-1')).toBeUndefined()
    h.store.set('concierge:starts:2026-10-27', SITE_SESSIONS_PER_DAY)
    expect(await startSession('p-2', T)).toBeNull()
    expect(hold('p-2')).toBeUndefined()
  })

  it('a start still on its way is waited for, then taken over — two tabs at once never read "today\'s time is used"', async () => {
    h.store.set('concierge:live:p-1', { id: 'Y'.repeat(22), at: T })
    // the other start lands its session 0.5 s later
    setTimeout(() => {
      h.store.set(`concierge:session:${'Y'.repeat(22)}`, { id: 'Y'.repeat(22), profileId: 'p-1', deadline: T + 600_000, startedAt: T, budgetKey: secondsKey('p-1'), reserved: 600 })
      h.store.set(secondsKey('p-1'), 600)
    }, 500)
    const s = (await startSession('p-1', T + 1_000))!
    expect(s).not.toBeNull()
    expect(hold('p-1')).toBe(s.id)
    expect(await liveSession('Y'.repeat(22), 'p-1', T + 2_000)).toBeNull()
  })

  it('an old session whose row cannot be deleted: the start gives up within the wait — never spins', async () => {
    const a = (await startSession('p-1', T))!
    h.down.del = true
    const t0 = Date.now()
    const out: { cap?: 'account' | 'site' } = {}
    try {
      expect(await startSession('p-1', T + 60_000, out)).toBeNull()
    } finally {
      h.down.del = false
    }
    expect(Date.now() - t0).toBeLessThan(4_500)
    expect(out.cap).toBe('account')
    expect(h.kv.del.mock.calls.length).toBeLessThan(40)
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(1) // its site slot went back
    expect(await liveSession(a.id, 'p-1', T + 61_000)).toEqual(a)
  }, 10_000)

  it('a start that stalled past the settle and was taken over never drops the newer session\'s hold', async () => {
    h.store.set(secondsKey('p-1'), 590) // its own start will find no time left and give back
    const real = h.kv.incrby.getMockImplementation()!
    let stolen = false
    h.kv.incrby.mockImplementation(async (k: string, by: number, ex?: number) => {
      if (!stolen && k === secondsKey('p-1') && by === DAILY_SECONDS) {
        stolen = true
        h.store.set('concierge:live:p-1', { id: 'N'.repeat(22), at: T + 20_000 }) // a newer start took the hold meanwhile
      }
      return real(k, by, ex)
    })
    try {
      expect(await startSession('p-1', T)).toBeNull()
    } finally {
      h.kv.incrby.mockImplementation(real)
    }
    expect(hold('p-1')).toBe('N'.repeat(22))
  })

  it('⛔ the site\'s cap refuses BEFORE the hold: a live session is never ended by a start the site turns away', async () => {
    const a = (await startSession('p-1', T))!
    h.store.set('concierge:starts:2026-10-27', SITE_SESSIONS_PER_DAY)
    const out: { cap?: 'account' | 'site' } = {}
    expect(await startSession('p-1', T + 60_000, out)).toBeNull()
    expect(out.cap).toBe('site')
    expect(await liveSession(a.id, 'p-1', T + 61_000)).toEqual(a)
    expect(hold('p-1')).toBe(a.id)
  })

  it('two starts at once with 5 minutes left: one live session, holding exactly those 5 minutes', async () => {
    h.store.set(secondsKey('p-1'), 300)
    const both = await Promise.all([startSession('p-1', T), startSession('p-1', T)])
    const live = (await Promise.all(both.filter(Boolean).map((x) => liveSession(x!.id, 'p-1', T + 1)))).filter(Boolean)
    expect(live).toHaveLength(1)
    // the later one took over the first — which cost its minute (MIN_CHARGE_SECONDS)
    expect(live[0]!.reserved).toBe(300 - MIN_CHARGE_SECONDS)
    expect(hold('p-1')).toBe(live[0]!.id)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
  })

  it(`less than ${MIN_SESSION_SECONDS} s left is "used": refused, nothing taken`, async () => {
    expect(MIN_SESSION_SECONDS).toBe(30)
    h.store.set(secondsKey('p-1'), 600 - 29)
    expect(await startSession('p-1', T)).toBeNull()
    expect(h.store.get(secondsKey('p-1'))).toBe(571)
    h.store.set(secondsKey('p-1'), 600 - 30)
    expect((await startSession('p-1', T))!.reserved).toBe(30)
  })

  it('a session never ended keeps its whole reservation (the tab killed): no more time that day, a fresh day the next', async () => {
    await startSession('p-1', T)
    h.store.delete('concierge:live:p-1') // its hold ran out with the session (TTL = the time it was given)
    expect(await startSession('p-1', T + 11 * 60_000)).toBeNull()
    const next = (await startSession('p-1', T + 24 * 3600_000))!
    expect(next.reserved).toBe(600)
    expect(next.budgetKey).toBe(secondsKey('p-1', '2026-10-28'))
  })

  it('the counters are per ICT day (UTC+7), kept two days; a session ends at ICT midnight at the latest', async () => {
    const a = (await startSession('p-1', Date.UTC(2026, 9, 27, 16, 55)))! // 23:55 ICT, 27 Oct
    expect(a.budgetKey).toBe(secondsKey('p-1', '2026-10-27'))
    expect(a.reserved).toBe(300)
    expect(a.deadline).toBe(Date.UTC(2026, 9, 27, 17, 0))
    expect(h.kv.set).toHaveBeenCalledWith('concierge:live:p-1', { id: a.id, at: Date.UTC(2026, 9, 27, 16, 55) }, { ex: 300 }) // the hold ends at midnight too
    h.store.delete('concierge:live:p-1')
    const b = (await startSession('p-1', Date.UTC(2026, 9, 27, 17, 0)))! // 00:00 ICT, 28 Oct — a is over
    expect(b.budgetKey).toBe(secondsKey('p-1', '2026-10-28'))
    expect(b.reserved).toBe(600)
    for (const [, , ttl] of h.kv.incrby.mock.calls) expect(ttl).toBe(2 * 24 * 3600)
  })

  it(`a start in the day's last ${MIN_SESSION_SECONDS} s counts on the NEXT day, all of it`, async () => {
    const s = (await startSession('p-1', Date.UTC(2026, 9, 27, 16, 59, 45)))! // 23:59:45 ICT
    expect(s.budgetKey).toBe(secondsKey('p-1', '2026-10-28'))
    expect(s.reserved).toBe(600)
    expect(h.store.get('concierge:starts:2026-10-28')).toBe(1)
  })

  it('⛔ a day below zero (a refund on a key a crash emptied) is mended to zero used — never more than 600 s', async () => {
    h.store.set(secondsKey('p-1'), -500)
    const s = (await startSession('p-1', T))!
    expect(s.reserved).toBe(600)
    expect(s.deadline).toBe(T + 600_000)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
  })

  it('600 starts a day across the site: refused as the SITE\'s, before anything of the account\'s is taken', async () => {
    expect(SITE_SESSIONS_PER_DAY).toBe(600)
    h.store.set('concierge:starts:2026-10-27', SITE_SESSIONS_PER_DAY)
    const out: { cap?: 'account' | 'site' } = {}
    expect(await startSession('p-new', T, out)).toBeNull()
    expect(out.cap).toBe('site')
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(SITE_SESSIONS_PER_DAY)
    expect(h.store.get(secondsKey('p-new'))).toBeUndefined()
  })

  it('a start refused by the account\'s limits never takes a site-wide slot', async () => {
    await endSession((await startSession('p-1', T))!, T + 1000)
    h.store.set(secondsKey('p-1'), 600)
    for (let i = 0; i < 10; i++) expect(await startSession('p-1', T + 20_000)).toBeNull()
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(1)
  })
})

describe('startSession — a failed start gives back what it took (commit review, codex)', () => {
  it('the session row cannot be written: every counter and the hold go back, and the start throws (the route refuses)', async () => {
    const real = h.kv.set.getMockImplementation()!
    h.kv.set.mockImplementation(async (k: string, v: unknown, o?: { nx?: boolean; ex?: number }) => {
      if (k.startsWith('concierge:session:')) throw new Error('kv down')
      return real(k, v, o)
    })
    try {
      for (let i = 0; i < 10; i++) await expect(startSession('p-a', T)).rejects.toThrow('kv down')
    } finally {
      h.kv.set.mockImplementation(real)
    }
    expect([...h.store.entries()].filter(([k]) => k.includes(':2026-10-27'))).toEqual([
      ['concierge:starts:2026-10-27', 0], [secondsKey('p-a'), 0],
    ])
    expect(hold('p-a')).toBeUndefined()
    expect(await startSession('p-a', T)).not.toBeNull()
  })

  it('the site counter cannot be reached: nothing of the account\'s is taken', async () => {
    const real = h.kv.incrby.getMockImplementation()!
    h.kv.incrby.mockImplementation(async (k: string, by: number, ex?: number) => {
      if (k === 'concierge:starts:2026-10-27' && by > 0) throw new Error('kv down')
      return real(k, by, ex)
    })
    try {
      await expect(startSession('p-b', T)).rejects.toThrow('kv down')
    } finally {
      h.kv.incrby.mockImplementation(real)
    }
    expect(h.store.get(secondsKey('p-b'))).toBeUndefined()
    expect(hold('p-b')).toBeUndefined()
  })

  it('a kv that is down: the start throws and writes no session', async () => {
    h.down.incrby = true
    await expect(startSession('p-1', T)).rejects.toThrow()
    expect(rows()).toBe(0)
  })
})

describe('endSession — the unused time goes back ONCE', () => {
  it('✕ and the page-away beacon both arrive: refunded once', async () => {
    const s = (await startSession('p-1', T))!
    await Promise.all([endSession(s, T + 90_000), endSession(s, T + 91_000)])
    await endSession(s, T + 92_000)
    const used = h.store.get(secondsKey('p-1')) as number
    expect(used === 90 || used === 91).toBe(true)
  })

  it('never more than it held, never below zero: an end past the deadline gives nothing back', async () => {
    const s = (await startSession('p-1', T))!
    await endSession(s, s.deadline + 5_000)
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
    const forged = { ...s, id: 'Z'.repeat(22), reserved: 600, deadline: T + 10 * 3600_000 }
    await endSession(forged, T)
    expect(h.store.get(secondsKey('p-1'))).toBe(60) // at most what it held, less the minute
  })

  it('⛔ the row goes FIRST: a delete that fails refunds nothing (the session may still be used)', async () => {
    const s = (await startSession('p-1', T))!
    h.down.del = true
    await endSession(s, T + 1000)
    h.down.del = false
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
    expect(await liveSession(s.id, 'p-1', T + 2000)).toEqual(s)
    // a later end that deletes it does refund — once
    await endSession(s, T + 90_000)
    expect(h.store.get(secondsKey('p-1'))).toBe(90)
  })

  it('a refund that fails leaves the whole reservation charged (fail closed), logged; the row still goes', async () => {
    const s = (await startSession('p-1', T))!
    h.down.incrby = true
    await endSession(s, T + 1000)
    h.down.incrby = false
    expect(h.store.get(secondsKey('p-1'))).toBe(600)
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { op: 'concierge.refund' })
    expect(rows()).toBe(0)
  })

  it('the eno team\'s sessions hold nothing and refund nothing', async () => {
    const s = (await startSession('staff-1', T))!
    await endSession(s, T + 1000)
    expect(h.kv.incrby).not.toHaveBeenCalled()
  })
})

describe('liveSession — the caller\'s live session, or null', () => {
  it('the caller\'s own session, before its deadline', async () => {
    const s = (await startSession('staff-1', T))!
    expect(await liveSession(s.id, 'staff-1', T + 1)).toEqual(s)
    expect(await liveSession(s.id, 'staff-1', s.deadline - 1)).toEqual(s)
  })

  it('malformed ids are refused WITHOUT a read', async () => {
    for (const id of [undefined, null, 42, {}, ['a'.repeat(22)], '', 'short', 'a'.repeat(15), 'a'.repeat(33), '../../../../etc/passwd', 'abcdefgh ijklmnop', 'abcdefghijklmnop%', `${'a'.repeat(16)}\n`, 'concierge:mode00000']) {
      expect(await liveSession(id, 'staff-1', T), JSON.stringify(id)).toBeNull()
    }
    expect(h.kv.get).not.toHaveBeenCalled()
  })

  it('an unknown id → null', async () => {
    expect(await liveSession('A'.repeat(22), 'staff-1', T)).toBeNull()
  })

  it('⛔ another account\'s session → null', async () => {
    const s = (await startSession('staff-2', T))!
    expect(await liveSession(s.id, 'staff-1', T + 1)).toBeNull()
  })

  it('past its deadline → null (at the deadline itself too)', async () => {
    const s = (await startSession('staff-1', T))!
    expect(await liveSession(s.id, 'staff-1', s.deadline)).toBeNull()
    expect(await liveSession(s.id, 'staff-1', s.deadline + 60_000)).toBeNull()
  })

  it('a row without a numeric deadline → null', async () => {
    h.store.set(`concierge:session:${'B'.repeat(22)}`, { id: 'B'.repeat(22), profileId: 'staff-1', deadline: String(T + 600_000) })
    expect(await liveSession('B'.repeat(22), 'staff-1', T)).toBeNull()
    h.store.set(`concierge:session:${'C'.repeat(22)}`, { id: 'C'.repeat(22), profileId: 'staff-1' })
    expect(await liveSession('C'.repeat(22), 'staff-1', T)).toBeNull()
  })

  it('an unreadable kv → null (a crash ends sessions), logged with its op', async () => {
    const s = (await startSession('staff-1', T))!
    h.down.get = true
    expect(await liveSession(s.id, 'staff-1', T + 1)).toBeNull()
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { op: 'concierge.session' })
  })

  it('endSession: over at once; a failing delete is swallowed', async () => {
    const s = (await startSession('staff-1', T))!
    await endSession(s)
    expect(await liveSession(s.id, 'staff-1', T + 1)).toBeNull()
    h.down.del = true
    await expect(endSession({ id: 'A'.repeat(22), profileId: 'staff-1', deadline: T })).resolves.toBeUndefined()
  })
})

describe('the fixed line\'s offer — remembered two minutes, answered once', () => {
  it('takeOffer consumes it: once `evisa`, then null', async () => {
    await rememberOffer('S'.repeat(22), 'evisa')
    expect(h.kv.set).toHaveBeenCalledWith(`concierge:offer:${'S'.repeat(22)}`, 'evisa', { ex: 120 })
    expect(await takeOffer('S'.repeat(22))).toBe('evisa')
    expect(await takeOffer('S'.repeat(22))).toBeNull()
    // The offer is gone; only its "taken" mark is left (it expires with the offer's two minutes).
    expect(h.store.has(`concierge:offer:${'S'.repeat(22)}`)).toBe(false)
  })

  it('two "yes" turns at once: only one takes the offer (the atomic counter decides — commit review, codex)', async () => {
    await rememberOffer('S'.repeat(22), 'evisa')
    const both = await Promise.all([takeOffer('S'.repeat(22)), takeOffer('S'.repeat(22))])
    expect(both.filter((o) => o === 'evisa')).toHaveLength(1)
  })

  it('an offer is its session\'s own; none made → null', async () => {
    await rememberOffer('A'.repeat(22), 'evisa')
    expect(await takeOffer('B'.repeat(22))).toBeNull()
    expect(await takeOffer('A'.repeat(22))).toBe('evisa')
  })

  it('a stored value that is not an offer → null (it simply expires)', async () => {
    h.store.set(`concierge:offer:${'A'.repeat(22)}`, 'paypal')
    expect(await takeOffer('A'.repeat(22))).toBeNull()
  })

  it('an unreadable kv → null (never an accepted offer); a failed write is no offer, never a throw', async () => {
    await rememberOffer('A'.repeat(22), 'evisa')
    h.down.get = true
    expect(await takeOffer('A'.repeat(22))).toBeNull()
    h.down.get = false
    h.down.set = true
    await expect(rememberOffer('B'.repeat(22), 'evisa')).resolves.toBeUndefined()
    expect(await takeOffer('B'.repeat(22))).toBeNull()
  })

  it('a failed delete still answers the offer once taken (the TTL ends it)', async () => {
    await rememberOffer('A'.repeat(22), 'evisa')
    h.down.del = true
    expect(await takeOffer('A'.repeat(22))).toBe('evisa')
  })
})

describe('the refusal copy names the day\'s real allowance', () => {
  it('"10 minutes" in the frame = DAILY_SECONDS (change both together)', async () => {
    const { readFileSync } = await import('node:fs')
    const frame = readFileSync(new URL('../../components/concierge/concierge-frame.tsx', import.meta.url), 'utf8')
    expect(frame).toContain(`"You've used today's ${DAILY_SECONDS / 60} minutes with the guide."`)
    expect(frame).toContain(`'Bạn đã dùng hết ${DAILY_SECONDS / 60} phút hôm nay với trợ lý.'`)
  })
})
