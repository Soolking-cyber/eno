import { beforeEach, describe, expect, it, vi } from 'vitest'

// The price-drop alerts switch (owner, 2026-11-17: "explicit opt-in") — its record and its state are the hash-chained log.
// Pinned: an ON counts only under the notice in force; the latest row BY id decides; a write takes its ACCOUNT's lock (bounded)
// BEFORE it reads, so a withdrawal is never lost to a concurrent ON — never the global chain key, which only appendAudit takes
// when there is a row to write; no-ops write nothing; an OFF over any ON is written.
type Row = { action: string; detail: unknown } | null
const h = vi.hoisted(() => ({
  steps: [] as string[],
  last: null as Row,
  reads: [] as unknown[],
  audits: [] as Array<Record<string, unknown>>,
  raw: [] as Array<{ sql: string; values: unknown[] }>,
  locks: [] as Array<{ sql: string; values: unknown[] }>,
  rows: [] as Array<{ profileId: string }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.steps.push('append'); h.audits.push(input) } }))
vi.mock('@/lib/db', () => {
  const findFirst = async (args: unknown) => { h.steps.push('read'); h.reads.push(args); return h.last }
  return {
    db: {
      complianceAudit: { findFirst },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.raw.push({ sql: strings.join('?'), values }); return h.rows },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?')
          if (sql.includes('pg_advisory_xact_lock')) h.locks.push({ sql, values })
          h.steps.push(sql.includes('lock_timeout') ? 'lock_timeout' : sql.includes('pg_advisory_xact_lock') ? 'lock' : sql)
          return 1
        },
        complianceAudit: { findFirst },
      }),
    },
  }
})

const { isOn, readPriceAlerts, setPriceAlerts, priceAlertSavers, PriceAlertNoticeChangedError, PRICE_ALERTS_ON, PRICE_ALERTS_OFF } = await import('./price-alerts')
const { PRICE_ALERT_NOTICE_VERSION: V } = await import('./price-drop-rules')

const ON_NOW = { action: PRICE_ALERTS_ON, detail: { notice: V } }
const ON_OLD = { action: PRICE_ALERTS_ON, detail: { notice: '2026-01-01' } }
const OFF = { action: PRICE_ALERTS_OFF, detail: {} }

beforeEach(() => { h.steps = []; h.last = null; h.reads = []; h.audits = []; h.raw = []; h.locks = []; h.rows = [] })

describe('isOn — the state the switch draws and the fan-out obeys', () => {
  it('ON only when the latest row is an ON under the notice in force', () => {
    expect(isOn(ON_NOW)).toBe(true)
    expect(isOn(ON_OLD)).toBe(false)
    expect(isOn(OFF)).toBe(false)
    expect(isOn(null)).toBe(false)
  })
  it('reads the latest of the two actions BY id (the chain order), never by the app clock', async () => {
    h.last = ON_NOW
    expect(await readPriceAlerts('p1')).toBe(true)
    expect(h.reads[0]).toEqual({ where: { subjectType: 'profile', subjectId: 'p1', action: { in: [PRICE_ALERTS_ON, PRICE_ALERTS_OFF] } }, orderBy: { id: 'desc' }, select: { action: true, detail: true } })
  })
})

describe('setPriceAlerts', () => {
  it('⛔ an ON under any other notice (or none) is refused and writes nothing', async () => {
    for (const n of ['2026-01-01', null]) await expect(setPriceAlerts('p1', true, n)).rejects.toBeInstanceOf(PriceAlertNoticeChangedError)
    expect(h.steps).toEqual([])
  })
  it('⛔ the bounded wait, then the account lock, THEN the read, then the append', async () => {
    expect(await setPriceAlerts('p1', true, V)).toBe(true)
    expect(h.steps).toEqual(['lock_timeout', 'lock', 'read', 'append'])
  })
  it('⛔ the lock is PER ACCOUNT, never the global compliance_audit chain key (a no-op OFF must not queue behind KYC or consent)', async () => {
    await setPriceAlerts('p1', false, null)
    expect(h.locks).toHaveLength(1)
    expect(h.locks[0].sql).toContain(`hashtext('saved.price_alerts')`)
    expect(h.locks[0].sql).not.toContain('compliance_audit')
    expect(h.locks[0].values).toEqual(['p1'])
  })
  it('an ON records who, as whom, and the words shown', async () => {
    await setPriceAlerts('p1', true, V)
    expect(h.audits).toEqual([{ actorType: 'user', actorId: 'p1', action: PRICE_ALERTS_ON, subjectType: 'profile', subjectId: 'p1', detail: { notice: V } }])
  })
  it('an ON over a current ON writes nothing; over an older notice’s ON it is recorded again', async () => {
    h.last = ON_NOW
    expect(await setPriceAlerts('p1', true, V)).toBe(true)
    expect(h.audits).toEqual([])
    h.last = ON_OLD
    await setPriceAlerts('p1', true, V)
    expect(h.audits.map((a) => a.action)).toEqual([PRICE_ALERTS_ON])
  })
  it('an OFF over nothing or an OFF writes nothing', async () => {
    for (const last of [null, OFF]) {
      h.last = last
      expect(await setPriceAlerts('p1', false, null)).toBe(false)
    }
    expect(h.audits).toEqual([])
  })
  it('⛔ an OFF over ANY ON — an older notice’s too — is recorded, with nothing in its detail', async () => {
    for (const last of [ON_NOW, ON_OLD]) {
      h.last = last
      expect(await setPriceAlerts('p1', false, null)).toBe(false)
    }
    expect(h.audits).toEqual([
      { actorType: 'user', actorId: 'p1', action: PRICE_ALERTS_OFF, subjectType: 'profile', subjectId: 'p1', detail: {} },
      { actorType: 'user', actorId: 'p1', action: PRICE_ALERTS_OFF, subjectType: 'profile', subjectId: 'p1', detail: {} },
    ])
  })
})

describe('priceAlertSavers — read at send time', () => {
  it('the latest row per saver BY id, the notice in force bound, the listing and the cap bound', async () => {
    h.rows = [{ profileId: 'a' }, { profileId: 'b' }]
    expect(await priceAlertSavers('L1', 100)).toEqual(['a', 'b'])
    const { sql, values } = h.raw[0]
    expect(sql).toContain('ORDER BY a.id DESC LIMIT 1')
    expect(sql).toContain(`c.detail->>'notice' = ?`)
    expect(values).toEqual([PRICE_ALERTS_ON, PRICE_ALERTS_OFF, 'L1', PRICE_ALERTS_ON, V, 100])
  })
})
