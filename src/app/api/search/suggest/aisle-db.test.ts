import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE AISLE COUNT'S BULKHEAD (review, 2026-09-29; aisle-db.ts). What these pin is the CONFIG, because
 * the config is the whole bound: two connections of its own, and a server-side statement budget on
 * each. A refactor that quietly moved the count back onto db.ts's pool, or dropped the budget, would
 * still pass every behavioural test that mocks the database.
 */

const pgConfigs: any[] = []
const clientOpts: any[] = []
const handlers: Record<string, (e: any) => void> = {}
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(config: any) { pgConfigs.push(config) }
  },
}))
vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: class {
    constructor(opts: any) { clientOpts.push(opts) }
    $on(event: string, fn: (e: any) => void) { handlers[event] = fn }
  },
}))

const { aisleDb, SCOPE_BUDGET_MS, SCOPE_MAX_IN_FLIGHT } = await import('./aisle-db')

afterEach(() => {
  delete (globalThis as { enoAisleDb?: unknown }).enoAisleDb
  pgConfigs.length = 0
  clientOpts.length = 0
  vi.restoreAllMocks()
})

describe('the aisle count client', () => {
  it('owns SCOPE_MAX_IN_FLIGHT connections, each with a statement_timeout of SCOPE_BUDGET_MS', () => {
    aisleDb()
    expect(pgConfigs).toHaveLength(1)
    expect(pgConfigs[0]).toMatchObject({ max: SCOPE_MAX_IN_FLIGHT, statement_timeout: SCOPE_BUDGET_MS, application_name: 'eno-typeahead-aisle', idleTimeoutMillis: 300_000 })
    expect(pgConfigs[0].connectionString).toBe(process.env.DATABASE_URL)
    // The measured bound (aisle-db.ts): the latest a count can still land on its own keystroke.
    expect(SCOPE_BUDGET_MS).toBe(600)
    expect(SCOPE_MAX_IN_FLIGHT).toBe(2)
  })

  it('is one client per process, created on first use', () => {
    expect(pgConfigs).toHaveLength(0)
    const a = aisleDb()
    expect(aisleDb()).toBe(a)
    expect(pgConfigs).toHaveLength(1)
  })

  it('stays quiet about a count cut by its budget, and prints any other error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    aisleDb()
    expect(clientOpts[0].log).toEqual([{ emit: 'event', level: 'error' }])
    handlers.error({ message: 'Database error. Code: `57014`. Message: `canceling statement due to statement timeout`', target: 'x', timestamp: new Date() })
    expect(err).not.toHaveBeenCalled()
    handlers.error({ message: 'Database error. Code: `53300`. Message: `too many connections`', target: 'x', timestamp: new Date() })
    expect(err).toHaveBeenCalledTimes(1)
  })
})
