import { describe, expect, it, vi } from 'vitest'
import { CONSENT_COPY_VERSION } from '@/lib/consent-value'
import { TIKTOK_COPY_VERSION, TIKTOK_NAMED_FROM_S, consentCoversTikTok, recordsNameTikTok } from './tiktok-consent'

// Whether a consent answer covers TikTok (2026-10-12). The server's authoritative rule is the RECORD of the answer —
// which words the card on that screen carried — with a date floor under it; the browser has the floor alone.
describe('the copy version and the day', () => {
  it('⛔ the card in force names TikTok: its version is at or after the one that introduced the name', () => {
    expect(CONSENT_COPY_VERSION >= TIKTOK_COPY_VERSION).toBe(true)
  })
  it('⛔ the floor is 00:00 in Vietnam on the day AFTER that copy version — in seconds, the cookie’s unit', () => {
    const [y, m, d] = TIKTOK_COPY_VERSION.slice(0, 10).split('-').map(Number)
    expect(TIKTOK_NAMED_FROM_S).toBe(Date.UTC(y, m - 1, d + 1, 0, 0, 0) / 1000 - 7 * 3600)
    expect(String(TIKTOK_NAMED_FROM_S)).toHaveLength(10) // a millisecond value would never be reached by any cookie
  })
})

describe('the date floor (consentCoversTikTok)', () => {
  it('Advertising on, answered at or after the floor', () => {
    expect(consentCoversTikTok({ d: true, ts: TIKTOK_NAMED_FROM_S })).toBe(true)
    expect(consentCoversTikTok({ d: true, ts: TIKTOK_NAMED_FROM_S - 1 })).toBe(false)
    expect(consentCoversTikTok({ d: false, ts: TIKTOK_NAMED_FROM_S + 60 })).toBe(false)
    expect(consentCoversTikTok({ d: true, ts: null })).toBe(false)
    expect(consentCoversTikTok(null)).toBe(false)
  })
})

describe('the records of a consent id (recordsNameTikTok)', () => {
  const ts = TIKTOK_NAMED_FROM_S + 7200
  const NOW_COPY = '2026-11-02' // the newest copy version this build shows
  /** One recorded answer: Advertising on/off, the card's copy version, the cookie's time, and when OUR server wrote it. */
  const row = (d: boolean, copyVersion: unknown, clientTs: number, recordedAtS: number | null = clientTs + 2) =>
    ({ detail: { p: false, a: false, d, version: 2, copyVersion, clientTs }, recordedAtS })
  const ok = (rows: ReturnType<typeof row>[], answeredAt = ts) => recordsNameTikTok(rows, answeredAt, NOW_COPY)

  it('a first answer with Advertising on, given to a card that named TikTok', () => {
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts)])).toBe(true)
    expect(ok([row(true, '2026-10-12b', ts)])).toBe(true)
    expect(ok([row(true, NOW_COPY, ts)])).toBe(true)
  })
  it('switched OFF, then ON again under the card that names TikTok — and kept on through later saves', () => {
    const old = TIKTOK_NAMED_FROM_S - 86400 * 7
    expect(ok([row(true, '2026-10-03', old), row(false, TIKTOK_COPY_VERSION, ts - 600), row(true, TIKTOK_COPY_VERSION, ts)])).toBe(true)
    expect(ok([row(false, '2026-10-03', old), row(true, TIKTOK_COPY_VERSION, ts - 600), row(true, TIKTOK_COPY_VERSION, ts)])).toBe(true)
  })
  it('⛔ A CARRIED "YES": on since the card read "Meta, Google", then other switches saved under the new card — never TikTok', () => {
    const old = TIKTOK_NAMED_FROM_S - 86400 * 7
    expect(ok([row(true, '2026-10-03', old), row(true, TIKTOK_COPY_VERSION, ts)])).toBe(false)
    expect(ok([row(true, '2026-10-01c', old), row(true, '2026-10-03', old + 60), row(true, TIKTOK_COPY_VERSION, ts - 60), row(true, NOW_COPY, ts)])).toBe(false)
  })
  it('⛔ a card that still read "Meta, Google" — whenever the answer was made', () => {
    for (const v of ['2026-10-03', '2026-10-01c', '2026-09-24']) expect(ok([row(true, v, ts)])).toBe(false)
  })
  it('⛔ THE DAY IS OURS: the switching-on row must be one our server wrote at or after the floor, whatever the device’s clock claims', () => {
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts, TIKTOK_NAMED_FROM_S - 1)])).toBe(false)
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts, null)])).toBe(false)
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts, TIKTOK_NAMED_FROM_S)])).toBe(true)
    // Switched on (our clock) before the floor, re-saved after it: still the earlier switching-on.
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts - 9000, TIKTOK_NAMED_FROM_S - 100), row(true, TIKTOK_COPY_VERSION, ts)])).toBe(false)
  })
  it('⛔ a copy version that does not exist yet, or is not one, is not evidence of anything', () => {
    for (const v of ['2027-01-05', '9999-12-31', 'zzzz', 'latest', '', 20261012, null, '2026-10-12; DROP']) expect(ok([row(true, v, ts)])).toBe(false)
  })
  it('⛔ FAILS CLOSED: no rows, the newest row is another answer’s or has Advertising off, or a row cannot be read', () => {
    expect(ok([])).toBe(false)
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts - 1)])).toBe(false) // not the answer this browser holds
    expect(ok([row(true, TIKTOK_COPY_VERSION, ts - 60), row(false, TIKTOK_COPY_VERSION, ts)])).toBe(false)
    expect(recordsNameTikTok([{ detail: null, recordedAtS: ts }], ts, NOW_COPY)).toBe(false)
    expect(recordsNameTikTok([{ detail: 'x', recordedAtS: ts }], ts, NOW_COPY)).toBe(false)
    expect(recordsNameTikTok([{ detail: [], recordedAtS: ts }, row(true, TIKTOK_COPY_VERSION, ts)], ts, NOW_COPY)).toBe(false)
    expect(recordsNameTikTok([{ detail: { d: 'true', copyVersion: TIKTOK_COPY_VERSION, clientTs: ts }, recordedAtS: ts }], ts, NOW_COPY)).toBe(false)
    expect(recordsNameTikTok([{ detail: { d: true, copyVersion: TIKTOK_COPY_VERSION, clientTs: String(ts) }, recordedAtS: ts }], ts, NOW_COPY)).toBe(false)
  })
})

describe('the record api/consent WRITES is the record read here', () => {
  it('⛔ the writer still stores the three fields the rule reads — the effective Advertising flag, the card’s copy version, the cookie’s own time', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/api/consent/route.ts', import.meta.url), 'utf8')
    expect(src).toContain("action: 'consent.recorded'")
    expect(src).toContain("subjectType: 'consent'")
    expect(src).toContain('subjectId: b.cid')
    expect(src).toContain('d: stored.d && !native')
    expect(src).toContain('copyVersion: b.copy')
    expect(src).toContain('clientTs: stored.ts')
  })
})

describe('the records, read for a request (consentRecordNamesTikTok)', () => {
  const ts = TIKTOK_NAMED_FROM_S + 3600
  const cid = 'c0ffee00-1234-4abc-8def-001122334455'
  const at = (s: number) => new Date(s * 1000)
  /** Rows as the log returns them: NEWEST FIRST. */
  const load = async (found: unknown, seen: unknown[] = [], logged: unknown[] = []) => {
    vi.resetModules()
    vi.doMock('server-only', () => ({}))
    vi.doMock('@/lib/db', () => ({ db: { complianceAudit: { findMany: async (q: unknown) => { seen.push(q); return found } } } }))
    vi.doMock('@/lib/log', () => ({ logError: (e: unknown) => { logged.push(e) } }))
    return import('./tiktok-consent-record')
  }
  const headers = (c: string) => new Headers({ cookie: c })
  const cookie = `eno-consent-v2=v2.001.${ts}.${cid}`
  const named = { detail: { d: true, copyVersion: TIKTOK_COPY_VERSION, clientTs: ts }, occurredAt: at(ts + 2) }

  it('reads every consent.recorded row of THIS cookie’s consent id, newest first, through the log’s own index', async () => {
    const seen: unknown[] = []
    const m = await load([named], seen)
    expect(await m.consentRecordNamesTikTok(headers(cookie))).toBe(true)
    expect(seen).toEqual([{
      where: { subjectType: 'consent', subjectId: cid, action: 'consent.recorded' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: m.RECORD_ROWS_MAX + 1,
      select: { detail: true, occurredAt: true },
    }])
  })
  it('⛔ a carried "yes" is read as one: on under the old card (older row), re-saved under the new (newer row)', async () => {
    const carried = [named, { detail: { d: true, copyVersion: '2026-10-03', clientTs: ts - 86400 * 9 }, occurredAt: at(ts - 86400 * 9) }]
    expect(await (await load(carried)).consentRecordNamesTikTok(headers(cookie))).toBe(false)
  })
  it('⛔ no cookie, a malformed one, or no rows: false — and with no cookie the log is not even read', async () => {
    const seen: unknown[] = []
    const m = await load([], seen)
    expect(await m.consentRecordNamesTikTok(new Headers())).toBe(false)
    expect(await m.consentRecordNamesTikTok(headers('eno-consent-v2=garbage'))).toBe(false)
    expect(seen).toHaveLength(0)
    expect(await m.consentRecordNamesTikTok(headers(cookie))).toBe(false)
    expect(seen).toHaveLength(1)
  })
  it('⛔ a row our server wrote BEFORE the floor (a device clock ahead) is refused', async () => {
    const early = [{ ...named, occurredAt: at(TIKTOK_NAMED_FROM_S - 3600) }]
    expect(await (await load(early)).consentRecordNamesTikTok(headers(cookie))).toBe(false)
  })
  it('⛔ more rows than are read: the history is cut off, so nothing is concluded from it', async () => {
    const m = await load([])
    const many = Array.from({ length: m.RECORD_ROWS_MAX + 1 }, () => named)
    expect(await (await load(many)).consentRecordNamesTikTok(headers(cookie))).toBe(false)
  })
  it('⛔ BOUNDED: a log that does not answer in time is a "no", logged — it never holds the save that asked', async () => {
    vi.useFakeTimers()
    try {
      const logged: unknown[] = []
      vi.resetModules()
      vi.doMock('server-only', () => ({}))
      vi.doMock('@/lib/db', () => ({ db: { complianceAudit: { findMany: () => new Promise(() => {}) } } })) // never answers
      vi.doMock('@/lib/log', () => ({ logError: (e: unknown) => { logged.push(e) } }))
      const { consentRecordNamesTikTok, RECORD_WAIT_MS } = await import('./tiktok-consent-record')
      const asked = consentRecordNamesTikTok(headers(cookie))
      await vi.advanceTimersByTimeAsync(RECORD_WAIT_MS + 1)
      await expect(asked).resolves.toBe(false)
      expect(logged).toHaveLength(1) // not silent
    } finally { vi.useRealTimers() }
  })
})
