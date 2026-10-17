import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { poolConfig } from '@/lib/db-pool-config'

// Prisma 7: the Rust query engine is gone — the client talks to Postgres through a
// driver adapter (node-postgres, unnamed prepared statements). On the VN box DATABASE_URL
// is a DIRECT connection (measured 2026-10-17 in both app containers: a statement_timeout
// startup parameter is accepted); the Supabase-cloud era used the Supavisor transaction
// pooler (port 6543), which src/lib/db-pool-config.ts still recognises. DDL/migrations use
// the DIRECT url via prisma.config.ts.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  /** The pool the live client queries through — read by src/lib/runtime-stats.ts (speed plan item 5). */
  enoPgPool?: Pool
}

// ⛔ A SMALL POOL WHILE `next build` PRERENDERS (2026-09-30). The build runs ~15 workers, each with its
// own client, and node-postgres defaults to 10 connections per pool — up to 150 against a database that
// sits at ~45 of max_connections=100 at rest (Supabase's own services). Two box deploys of the services
// edition died on "too many clients already" mid-prerender. 3 per worker keeps the build under ~45;
// the running app (any other phase) keeps the default.
const isBuild = process.env.NEXT_PHASE === 'phase-production-build'
// ⚠️ READ AS THIS LITERAL: Next substitutes `process.env.NEXT_RUNTIME` into its server bundles at build time
// (next/dist/build/define-env.js) — it is not in the running process's environment, so an alias would read undefined.
const isServer = process.env.NEXT_RUNTIME === 'nodejs' && !isBuild

/**
 * The adapter. At RUNTIME it is handed a pool we build ourselves — the same options it would have built from (the
 * factory's config branch is `new pg.Pool(config)`, @prisma/adapter-pg) — so the runtime stats can read its queue
 * (`waitingCount`): the one number that says whether requests wait for a database connection.
 * ⚠️ THE FACTORY ADOPTS A POOL ONLY IF `instanceof pg.Pool` HOLDS. `pg` is on Next's built-in server-externals list,
 * so app and adapter load one copy — but if a future bundling change ever gave them two, the factory would treat our
 * pool as a CONFIG object and build a pool with no connection string. So adoption is checked, not assumed: anything
 * but our own pool in `externalPool` falls back to today's config form, and the unused pool (never connected) is ended.
 * ⚠️ The build keeps the config form: its workers exit when done, and a pool the adapter does not own is never ended.
 */
function makeAdapter(): { adapter: PrismaPg; pool: Pool | null } {
  const config = poolConfig({ url: process.env.DATABASE_URL, build: isBuild, server: isServer })
  if (isBuild) return { adapter: new PrismaPg(config), pool: null }
  const pool = new Pool(config)
  // The one proof the server limits are on (see db-pool-config.ts): printed once, never the connection string.
  if (isServer) console.info(`[db] pool limits: statement_timeout=${'statement_timeout' in config ? config.statement_timeout : 'none (pooled)'} max=${config.max}`)
  // ⛔ An EventEmitter 'error' with no listener throws — an idle client dropped by Supavisor would take the process
  // down. The adapter attaches its own listener when it first connects; this one is there from the start.
  pool.on('error', (e) => console.error('[db] idle pg client error', e instanceof Error ? e.message : e))
  const adopted = new PrismaPg(pool)
  if ((adopted as unknown as { externalPool?: unknown }).externalPool === pool) return { adapter: adopted, pool }
  void pool.end().catch((e: unknown) => console.warn('[db] ending the unadopted pg.Pool failed', e))
  // Once per process, at boot: the pool stats will read nothing.
  console.warn('[db] @prisma/adapter-pg did not adopt the pg.Pool — config form, no pool stats')
  return { adapter: new PrismaPg(config), pool: null }
}

function makeClient(): PrismaClient {
  const { adapter, pool } = makeAdapter()
  // ⚠️ ONLY the pool behind the client that actually serves queries goes on globalThis: Next evaluates this module
  // in more than one server bundle, and only the first evaluation's client is ever used (the `??` below).
  if (pool) globalForPrisma.enoPgPool = pool
  return new PrismaClient({
    adapter,
    // Only log queries in dev — query logs contain seller phone numbers (PII).
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
  })
}

export const db = globalForPrisma.prisma ?? makeClient()

// Reuse the singleton in every env to avoid exhausting the pooler.
globalForPrisma.prisma = db
