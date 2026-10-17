/**
 * The pg.Pool options — pure, so the rules are pinned without a database (db-pool-config.test.ts). src/lib/db.ts
 * passes in the two facts only it can read: whether `next build` is prerendering, and whether this is Next's server.
 *
 * ⛔ A BOUNDED STATEMENT IN THE RUNNING SERVER (speed plan item 9, 2026-10-17): on a direct connection (the box's) no
 * statement runs past 30 s. It was unbounded, so one stuck statement held its request and a pool connection
 * indefinitely — and since a connection is now busy for 30 s at most, a wait for one is bounded too. Measured on
 * production (pg_stat_statements since 2026-09-20): the only app statements over 21 s were the nightly rank sweep
 * (58 s — now batched, src/lib/ranking.ts) and writes queued behind its row locks (up to 40 s). Only Next's server gets
 * the limit; scripts and tests (tsx, vitest) do not, so an import or a backfill runs as long as it needs, and the build
 * keeps its own small pool.
 * ⚠️ NO CAP ON THE WAIT FOR A CONNECTION, on purpose: right after a restart both apps measured all 10 connections busy
 * with up to 42–48 queries queued ([eno-runtime], 2026-10-16 22:42Z) — a cap would turn that warm-up queue into errors.
 * ⚠️ statement_timeout travels as a STARTUP parameter, which a transaction pooler (Supavisor / PgBouncer: port 6543 or
 * pgbouncer=true) rejects — so a pooled URL gets no limit, and its statements stay UNBOUNDED. Production is direct
 * (measured in both app containers, 2026-10-17); a move to a pooler must bound them another way.
 * ⚠️ Whether the limit is on rests on Next's build-time NEXT_RUNTIME (src/lib/db.ts), which no unit test can see — so
 * db.ts prints `[db] pool limits` once at every server boot (`statement_timeout=30000` when it is on), and its absence
 * after a deploy is the alarm.
 *
 * ⛔ 20 CONNECTIONS PER APP IN NEXT'S SERVER, NOT pg's DEFAULT 10 (speed plan item 12, 2026-10-17). Measured: the pool
 * was the one saturated resource on the box — both apps at busyMax 10 = the whole default pool, with 14–18 queries queued
 * in an ordinary 10-minute window ([eno-runtime] 2026-10-17 07:04Z) and 42–48 after a restart — while each process sat at
 * event-loop utilisation ≤ 0.2, lag p99 ≤ 25 ms, and the host at CPU pressure 3%. Queued queries are what a page waits
 * on. THE BUDGET — Postgres refuses a new connection past max_connections 100 minus 3 reserved, and a refused connection
 * is an error, not a wait: client backends measured 42 (the two apps 22, both pools full; Supabase's own services ~20),
 * so the apps at 20 + 20 make ~60. A deploy adds `next build`'s prerender pools (3 per worker, the build branch below)
 * while the old containers still serve — measure that peak (pg_stat_activity, during a deploy) before raising this
 * further. A pooled URL keeps the same client-side cap (the pooler multiplexes behind it).
 */
export const SERVER_POOL_MAX = 20

export function poolConfig({ url, build, server }: { url: string | undefined; build: boolean; server: boolean }) {
  const pooled = !!url && (/:6543(?:[/?]|$)/.test(url) || /[?&]pgbouncer=true(?:&|$)/.test(url))
  return {
    connectionString: url,
    ...(build ? { max: 3 } : {}),
    // The build's own pool wins if both flags were ever set (db.ts makes them exclusive).
    ...(server && !build ? { max: SERVER_POOL_MAX } : {}),
    ...(server && !pooled ? { statement_timeout: 30_000 } : {}),
  }
}
