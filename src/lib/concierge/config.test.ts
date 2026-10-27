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
    set: vi.fn(async (k: string, v: unknown, _opts?: { nx?: boolean; ex?: number }) => {
      if (down.set) throw new Error('kv down')
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
  MODE_KEY, SESSIONS_PER_DAY, SESSION_MINUTES, SITE_SESSIONS_PER_DAY, conciergeOpenFor, endSession, liveSession, readConciergeMode,
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
  it('reads the kv key concierge:mode; `staff` ONLY when it holds exactly "staff"', async () => {
    expect(MODE_KEY).toBe('concierge:mode')
    h.store.set(MODE_KEY, 'staff')
    expect(await readConciergeMode({ fresh: true })).toBe('staff')
    expect(h.kv.get).toHaveBeenLastCalledWith('concierge:mode')
    for (const v of ['off', 'STAFF', ' staff', 'staff ', 'all', 'on', true, 1, { mode: 'staff' }, ['staff'], null]) {
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

describe('conciergeOpenFor — who may use it now', () => {
  it('the switch at `staff` and a staff account → open', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1')).toBe(true)
    expect(h.isStaff).toHaveBeenCalledWith('staff-1')
  })

  it('anyone else → closed', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('p-member')).toBe(false)
  })

  it('the switch off (or missing): closed, and the account is never looked up', async () => {
    expect(await conciergeOpenFor('staff-1')).toBe(false)
    h.store.set(MODE_KEY, 'off')
    expect(await conciergeOpenFor('staff-1', { fresh: true })).toBe(false)
    expect(h.isStaff).not.toHaveBeenCalled()
  })

  it('the staff check failing → closed (fails closed)', async () => {
    h.store.set(MODE_KEY, 'staff')
    h.isStaff.mockRejectedValueOnce(new Error('db down'))
    expect(await conciergeOpenFor('staff-1')).toBe(false)
  })

  it('⛔ eno.forum (the services edition): never — the switch is not even read', async () => {
    h.services = true
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1', { fresh: true })).toBe(false)
    expect(h.kv.get).not.toHaveBeenCalled()
    expect(h.isStaff).not.toHaveBeenCalled()
  })

  it('fresh:true reaches the switch past the cache (the start route); without it, the cached value', async () => {
    h.store.set(MODE_KEY, 'staff')
    expect(await conciergeOpenFor('staff-1')).toBe(true)
    h.store.set(MODE_KEY, 'off')
    expect(await conciergeOpenFor('staff-1')).toBe(true) // cached ≤ 30 s (PLAN §10: switching off refuses within that)
    expect(await conciergeOpenFor('staff-1', { fresh: true })).toBe(false)
    expect(await conciergeOpenFor('staff-1')).toBe(false)
  })
})

describe('startSession — the day\'s caps, then the session row', () => {
  it('a session of 15 minutes: deadline = now + 15 min, stored under concierge:session:<id> with a TTL past the deadline', async () => {
    expect(SESSION_MINUTES).toBe(15)
    const s = await startSession('staff-1', T)
    expect(s).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), profileId: 'staff-1', deadline: T + 15 * 60_000 })
    expect(h.kv.set).toHaveBeenCalledWith(`concierge:session:${s!.id}`, s, { ex: 15 * 60 + 60 })
    expect(h.store.get(`concierge:session:${s!.id}`)).toEqual(s)
  })

  it('ids are random', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 5; i++) ids.add((await startSession(`staff-${i}`, T))!.id)
    expect(ids.size).toBe(5)
  })

  it('the counters are per ICT day (UTC+7), kept two days', async () => {
    await startSession('staff-1', Date.UTC(2026, 9, 27, 16, 59)) // 23:59 ICT, 27 Oct
    await startSession('staff-1', Date.UTC(2026, 9, 27, 17, 0)) // 00:00 ICT, 28 Oct
    expect(h.kv.incrby.mock.calls).toEqual([
      ['concierge:starts:2026-10-27:staff-1', 1, 2 * 24 * 3600],
      ['concierge:starts:2026-10-27', 1, 2 * 24 * 3600],
      ['concierge:starts:2026-10-28:staff-1', 1, 2 * 24 * 3600],
      ['concierge:starts:2026-10-28', 1, 2 * 24 * 3600],
    ])
  })

  it('8 a day per account: the next is refused (null, no session written) — another account, or the next day, still starts', async () => {
    expect(SESSIONS_PER_DAY).toBe(8)
    for (let i = 0; i < 8; i++) expect(await startSession('staff-1', T)).not.toBeNull()
    const rows = () => [...h.store.keys()].filter((k) => k.startsWith('concierge:session:')).length
    expect(rows()).toBe(8)
    expect(await startSession('staff-1', T)).toBeNull()
    expect(rows()).toBe(8)
    expect(await startSession('staff-2', T)).not.toBeNull()
    expect(await startSession('staff-1', T + 24 * 3600_000)).not.toBeNull()
  })

  it('80 a day across the site: the next is refused, whoever asks', async () => {
    expect(SITE_SESSIONS_PER_DAY).toBe(80)
    for (let a = 0; a < 10; a++) for (let i = 0; i < 8; i++) expect(await startSession(`staff-${a}`, T)).not.toBeNull()
    expect(await startSession('staff-new', T)).toBeNull()
    expect([...h.store.keys()].filter((k) => k.startsWith('concierge:session:'))).toHaveLength(80)
  })

  it('a kv failure throws (the start route refuses — fail closed), and no session is written', async () => {
    h.down.incrby = true
    await expect(startSession('staff-1', T)).rejects.toThrow()
    h.down.incrby = false
    h.down.set = true
    await expect(startSession('staff-1', T)).rejects.toThrow()
    expect([...h.store.keys()].some((k) => k.startsWith('concierge:session:'))).toBe(false)
  })

  // Regression (found here 2026-10-27, fixed) — it was (latent): config.ts:72-74 counts BOTH counters before either cap is
  // checked, so a start the ACCOUNT cap refuses still takes one of the site's 80 (and one the site cap refuses still takes
  // one of the account's 8). One account at its cap tapping Start (the route allows 20 an hour) burns the site's day for
  // everyone: here 72 refused taps lock the whole site out with only 8 real sessions started.
  it('a start refused by the account cap does not take a site-wide slot', async () => {
    for (let i = 0; i < 8; i++) await startSession('staff-1', T)
    for (let i = 0; i < 72; i++) expect(await startSession('staff-1', T)).toBeNull()
    expect(await startSession('staff-2', T)).not.toBeNull() // 9 real sessions of 80
  })
})

describe('startSession — a failed start gives back what it took (commit review, codex)', () => {
  it('the session row cannot be written: both counters go back, and the start throws (the route refuses)', async () => {
    const { startSession } = await import('./config')
    h.down.set = true
    try {
      for (let i = 0; i < 10; i++) await expect(startSession('staff-a', Date.UTC(2026, 9, 27, 5))).rejects.toThrow('kv down')
    } finally {
      h.down.set = false
    }
    expect([...h.store.entries()].filter(([k]) => k.startsWith('concierge:starts:'))).toEqual([
      ['concierge:starts:2026-10-27:staff-a', 0], ['concierge:starts:2026-10-27', 0],
    ])
    expect(await startSession('staff-a', Date.UTC(2026, 9, 27, 5))).not.toBeNull()
  })

  it('a start refused at the account\'s cap gives its increment back (review round 3, codex)', async () => {
    const { startSession } = await import('./config')
    for (let i = 0; i < SESSIONS_PER_DAY; i++) expect(await startSession('staff-c', Date.UTC(2026, 9, 27, 5))).not.toBeNull()
    expect(await startSession('staff-c', Date.UTC(2026, 9, 27, 5))).toBeNull()
    expect(h.store.get('concierge:starts:2026-10-27:staff-c')).toBe(SESSIONS_PER_DAY)
  })

  it('a start refused at the SITE cap gives back both increments (review round 4, codex)', async () => {
    const { startSession } = await import('./config')
    h.store.set('concierge:starts:2026-10-27', SITE_SESSIONS_PER_DAY)
    expect(await startSession('staff-d', Date.UTC(2026, 9, 27, 5))).toBeNull()
    expect(h.store.get('concierge:starts:2026-10-27')).toBe(SITE_SESSIONS_PER_DAY)
    expect(h.store.get('concierge:starts:2026-10-27:staff-d')).toBe(0)
  })

  it('the site counter cannot be read: the account\'s slot goes back', async () => {
    const { startSession } = await import('./config')
    const real = h.kv.incrby.getMockImplementation()!
    h.kv.incrby.mockImplementation(async (k: string, by: number, ex?: number) => {
      if (k === 'concierge:starts:2026-10-27' && by > 0) throw new Error('kv down')
      return real(k, by, ex)
    })
    try {
      await expect(startSession('staff-b', Date.UTC(2026, 9, 27, 5))).rejects.toThrow('kv down')
    } finally {
      h.kv.incrby.mockImplementation(real)
    }
    expect(h.store.get('concierge:starts:2026-10-27:staff-b')).toBe(0)
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
    await endSession(s.id)
    expect(await liveSession(s.id, 'staff-1', T + 1)).toBeNull()
    h.down.del = true
    await expect(endSession('A'.repeat(22))).resolves.toBeUndefined()
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
