import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { poolConfig } from './db-pool-config'

/**
 * The pg.Pool options src/lib/db.ts builds (speed plan item 9). What these pin: Next's running server bounds every
 * statement (30 s) and nothing else does — a script or a test runs as long as it needs, and `next build` keeps its small
 * prerender pool; the wait for a connection stays uncapped (a warm-up queue must not become errors); and a transaction
 * pooler never receives the statement_timeout startup parameter it would reject.
 */
const DIRECT = 'postgresql://app:secret@db.internal:5432/postgres'

describe('poolConfig', () => {
  it("Next's server: 30 s per statement — and no cap on the wait for a connection", () => {
    expect(poolConfig({ url: DIRECT, build: false, server: true })).toEqual({ connectionString: DIRECT, statement_timeout: 30_000 })
  })

  it('scripts and tests (no Next runtime): no limits — an import or a backfill runs as long as it needs', () => {
    expect(poolConfig({ url: DIRECT, build: false, server: false })).toEqual({ connectionString: DIRECT })
  })

  it('next build: the 3-connection prerender pool, and no server limits', () => {
    expect(poolConfig({ url: DIRECT, build: true, server: false })).toEqual({ connectionString: DIRECT, max: 3 })
  })

  it('a transaction pooler never gets the statement_timeout startup parameter it would reject', () => {
    for (const url of ['postgresql://u:p@pooler.example:6543/postgres', 'postgresql://u:p@db.example:5432/postgres?pgbouncer=true']) {
      expect(poolConfig({ url, build: false, server: true }), url).toEqual({ connectionString: url })
    }
    // A port that merely starts with 6543 is not the pooler.
    expect(poolConfig({ url: 'postgresql://u:p@db.example:65432/postgres', build: false, server: true })).toHaveProperty('statement_timeout', 30_000)
  })
})

describe('src/lib/db.ts says at boot whether the limits are on', () => {
  // NEXT_RUNTIME is substituted at build time, which no unit test sees — the boot line is the production proof.
  const src = readFileSync(join(__dirname, 'db.ts'), 'utf8')
  it('prints `[db] pool limits` once, when the config carries the limit', () => {
    expect(src).toMatch(/if \('statement_timeout' in config\) console\.info\(`\[db\] pool limits: statement_timeout=\$\{config\.statement_timeout\}`\)/)
  })
  it('reads NEXT_RUNTIME as the literal Next substitutes, and never logs the connection string', () => {
    expect(src).toMatch(/const isServer = process\.env\.NEXT_RUNTIME === 'nodejs' && !isBuild/)
    const line = src.split('\n').find((l) => l.includes('[db] pool limits')) ?? ''
    expect(line).not.toMatch(/connectionString|DATABASE_URL|\$\{config\}/)
  })
})
