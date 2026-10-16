import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/lib/db.ts hands @prisma/adapter-pg a pg.Pool it builds itself, so [eno-runtime] can read the pool's queue
 * (speed plan item 5). ⛔ What must hold: the adapter is given the same options it would have built from; adoption is
 * CHECKED (if the factory ever stops recognising the pool it falls back to today's config form and ends the unused
 * pool); only the live client's pool is published; and `next build` keeps the config form with max 3.
 */

const h = vi.hoisted(() => ({ adapterArgs: [] as unknown[], adopt: true, clients: 0 }))

vi.mock('@prisma/adapter-pg', async () => {
  const pg = await import('pg')
  return {
    PrismaPg: class {
      externalPool: unknown = null
      constructor(arg: unknown) {
        h.adapterArgs.push(arg)
        if (h.adopt && arg instanceof pg.Pool) this.externalPool = arg
      }
    },
  }
})
vi.mock('@/generated/prisma/client', () => ({ PrismaClient: class { constructor() { h.clients += 1 } } }))

const G = globalThis as unknown as { prisma?: unknown; enoPgPool?: unknown }

beforeEach(() => {
  vi.resetModules()
  h.adapterArgs = []; h.adopt = true; h.clients = 0
  delete G.prisma; delete G.enoPgPool
  vi.stubEnv('DATABASE_URL', 'postgresql://u:p@db.invalid:6543/postgres')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete G.prisma; delete G.enoPgPool })

describe('db.ts — the pool behind the client', () => {
  it('at runtime: one Pool with the same options, adopted by the adapter and published for the stats', async () => {
    const { Pool } = await import('pg')
    await import('./db')
    expect(h.adapterArgs).toHaveLength(1)
    expect(h.adapterArgs[0]).toBeInstanceOf(Pool)
    expect((h.adapterArgs[0] as InstanceType<typeof Pool>).options.connectionString).toBe('postgresql://u:p@db.invalid:6543/postgres')
    expect((h.adapterArgs[0] as InstanceType<typeof Pool>).options.max).toBe(10) // pg's default, as before
    expect(G.enoPgPool).toBe(h.adapterArgs[0])
  })

  it('⛔ not adopted (two copies of pg, a renamed field): the config form, the unused pool ended, nothing published', async () => {
    h.adopt = false
    const { Pool } = await import('pg')
    const end = vi.spyOn(Pool.prototype, 'end')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await import('./db')
    expect(h.adapterArgs).toHaveLength(2)
    expect(h.adapterArgs[1]).toEqual({ connectionString: 'postgresql://u:p@db.invalid:6543/postgres' })
    expect(end).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(G.enoPgPool).toBeUndefined()
  })

  it('during `next build`: the config form with max 3, no Pool of ours', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    await import('./db')
    expect(h.adapterArgs).toEqual([{ connectionString: 'postgresql://u:p@db.invalid:6543/postgres', max: 3 }])
    expect(G.enoPgPool).toBeUndefined()
  })

  it('⛔ the REAL @prisma/adapter-pg adopts our pg.Pool through the public field db.ts checks (no mock)', async () => {
    const { PrismaPg } = await vi.importActual<typeof import('@prisma/adapter-pg')>('@prisma/adapter-pg')
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: 'postgresql://u:p@db.invalid:6543/postgres' })
    expect((new PrismaPg(pool) as unknown as { externalPool?: unknown }).externalPool).toBe(pool)
    await pool.end()
  })

  it('a second evaluation of the module reuses the client and builds no second pool', async () => {
    await import('./db')
    const first = G.enoPgPool
    vi.resetModules()
    await import('./db')
    expect(h.clients).toBe(1)
    expect(h.adapterArgs).toHaveLength(1)
    expect(G.enoPgPool).toBe(first)
  })
})
