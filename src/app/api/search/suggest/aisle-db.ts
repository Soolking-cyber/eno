/**
 * THE AISLE COUNT'S OWN CONNECTIONS — a bulkhead between the typeahead's optional scoped row and
 * everything else the instance reads (review, 2026-09-29).
 *
 * The scoped row's count (suggest-entities.ts scopeGroups) is a grouped count over EVERY match of a
 * query, and a broad prefix costs 0.4-3.4 s of server time. On the app's pool (db.ts: node-postgres,
 * 10 connections) a few typists could hold most of it for seconds, for counts the 150 ms grace then
 * throws away, and every page and API read would queue behind them. So this count never touches that
 * pool. It runs here, where:
 *  · `max: SCOPE_MAX_IN_FLIGHT` — two connections, whatever the number of typists;
 *  · `statement_timeout: SCOPE_BUDGET_MS` — a startup parameter of these connections only (node-
 *    postgres sends it in the startup packet), so Postgres CANCELS a count past the budget. One round
 *    trip, no transaction: the `SET LOCAL` alternative was measured and rejected — four round trips,
 *    and through the dev tunnel its BEGIN could not get a connection from the shared pool within
 *    Prisma's 2 s `maxWait` beside the typeahead's own burst of reads (P2028 on every request).
 * ⚠️ IT NEEDS A DATABASE THAT ACCEPTS STARTUP PARAMETERS. The runtime reaches Postgres directly
 * (`db:5432` on the box, infra/vn-node/eno-build.sh; scripts already pass `-c` options through
 * PrismaPg the same way, localize-import-listings). A transaction pooler that refused the parameter
 * would fail these connections only — the count fails soft and the dropdown simply has no scoped row.
 */
import 'server-only'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * The count's server-side budget: the latest a count can still land on the keystroke that asked for it.
 * The dropdown waits for its entity rows until the listing read is in plus ENTITY_GRACE_MS (150 ms);
 * the slowest listing reads measured are ~350-470 ms ("điều hòa", "máy lạnh", "áo dài"), so past
 * ~600 ms a count could only ever serve the memo. Server-side times on production data, 2026-09-29
 * (EXPLAIN ANALYZE, best of two):
 *   rows it keeps — "sofa" 13-35 ms, "iphone" 24-43, "laptop" 37-58, "máy giặt" 16-35, "tủ lạnh"
 *   104-117, "tv" 156-240, "máy ảnh" 197, "cho thuê" 249, "máy lạnh" 358-404, "điều hòa" 348-435,
 *   "áo dài" 425-516, "phòng trọ" 484-590;
 *   what it cuts — "ca" 730-830, "hoa" 740-790, "bàn ăn" 1,150-1,260, "căn hộ" 3,300+, "apartment"
 *   2,500+; and the one row it costs, "điện thoại" (51% phones) at 745-791 ms, which missed its own
 *   keystroke anyway (its ranked listing read, pool A, is ~110 ms).
 * "so" / "bàn" / "nhà" (520-670 ms, no row) mostly finish inside it: bounded waste, once per minute
 * per instance (the memo), at most SCOPE_MAX_IN_FLIGHT at a time, never on the app's pool.
 */
export const SCOPE_BUDGET_MS = 600

/** Aisle counts running at once per instance — and the size of this client's pool. */
export const SCOPE_MAX_IN_FLIGHT = 2

/** Postgres cancelled the statement for its `statement_timeout` (SQLSTATE 57014). */
export function isStatementTimeout(e: unknown): boolean {
  const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } } } | null)?.meta?.driverAdapterError?.cause
  return cause?.originalCode === '57014' || cause?.code === '57014' || /\b57014\b/.test(String((e as { message?: unknown } | null)?.message ?? ''))
}

// On globalThis for the reason db.ts gives: a dev reload must not leave a pool behind per edit.
const g = globalThis as unknown as { enoAisleDb?: PrismaClient }

/** The aisle count's client, created on first use (no connection is opened before a count runs). */
export function aisleDb(): PrismaClient {
  if (g.enoAisleDb) return g.enoAisleDb
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: SCOPE_MAX_IN_FLIGHT,
      statement_timeout: SCOPE_BUDGET_MS,
      // statement_timeout is enforced by the SERVER; a black-holed network would hang the connect itself and
      // hold both slots forever (gate 2026-09-30). The client gives up on the handshake within the same budget.
      connectionTimeoutMillis: SCOPE_BUDGET_MS,
      // Names these connections in pg_stat_activity, so a DBA can tell them from the app's.
      application_name: 'eno-typeahead-aisle',
      // ⚠️ KEPT WARM FOR FIVE MINUTES, NOT node-postgres's 10 s. The app's pool never idles; this one
      // does between typing sessions, and a count that has to open its connection first (TCP, auth, a
      // backend fork) spends the budget of its own keystroke on the handshake — through the dev
      // tunnel, ~1 s: measured 2026-09-29, the scoped row then missed every first keystroke. Two idle
      // backends per instance is the price.
      idleTimeoutMillis: 5 * 60_000,
    }),
    // A count cut by its budget is an expected ANSWER (scopeGroups memoizes it as "no row"), so it is
    // not printed; anything else is, as db.ts's `log: ['error']` would.
    log: [{ emit: 'event', level: 'error' }],
  })
  client.$on('error', (e) => {
    if (!isStatementTimeout(e)) console.error('prisma:error [typeahead aisle count]', e.message)
  })
  g.enoAisleDb = client
  return client
}
