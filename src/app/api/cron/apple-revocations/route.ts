import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { logError, logWarn } from '@/lib/log'
import {
  APPLE_REVOKE_GIVE_UP_MS,
  appleBundleId,
  appleServicesId,
  appleTokenTablePresent,
  dueRevocations,
  probeAuthTables,
  probeClient,
  queueOrphanedTokens,
  settleQueuedTokens,
  oldestQueuedMs,
  dropStaleQueued,
  type AppleTokenRow,
} from '@/lib/auth/apple-siwa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/cron/apple-revocations — THE DAILY RETRY FOR APPLE TOKENS AN ERASURE COULD NOT REVOKE, AND THE APP-SIDE
 * PROBE OF BOTH APPLE CLIENTS (Sign in with Apple plan §7.12, D9, A3).
 *
 * Driven by the `apple-revocations` systemd timer at 09:15 UTC (infra/vn-node/cron/install-cron-timers.sh),
 * through eno-cron.sh on eno.vn:3001 — one edition is enough: the token table is in the shared database.
 *
 * In order:
 *   1. probeClient for the Services ID and the bundle ID (a code Apple never issued must answer invalid_grant).
 *      `invalid_client` — the key, team, key id or client id is refused — logs `[auth] apple_client_invalid`,
 *      skips that client's rows (they would fail the same way) and makes the answer 500.
 *      ⛔ ONCE EITHER ID IS SET, EVERY PROBE MUST SAY `ok` — `unreachable` (Apple down, no fault of ours) is the one
 *      other word let through. `unconfigured` there means the key, team or key id went missing from the container
 *      (a deploy that lost APPLE_SIWA_*), `unexpected` that Apple refused the client some other way
 *      (unauthorized_client, invalid_request): either way every native code exchange fails, no token is kept and
 *      every deletion ends `manual` — so it logs `[auth] apple_client_invalid` with the word and answers 500, as
 *      the box's own daily check does. Only the dark deploy — neither id set — answers 200 unprobed.
 *   1b. ⛔ GoTrue's TABLES, AS THIS ROLE SEES THEM (probeAuthTables — verifier, 2026-10-09; in the answer as
 *      `authTables`). Once either id is set, auth.flow_state and auth.identities must be READABLE — granted AND not
 *      hidden by row-level security — or it logs `[auth] apple_auth_table_unreadable` and answers 500: unreadable
 *      flow state means no web Apple sign-in keeps its token (C4), unreadable identities that step 3 cannot see a
 *      re-sign-up whose token was not kept. auth.users is only reported — the orphan sweep asks GoTrue's admin API
 *      instead. So I11's run of this route — the first with the ids in the container, expecting 200 — proves the role
 *      before the web flip (I12).
 *   2. ⛔ ORPHANS (commit-gate C2, 2026-10-08): an ACTIVE row whose account no longer exists — a sign-in that stored
 *      its token while the account was being deleted — is queued, due now (queueOrphanedTokens: no Profile, and the
 *      auth user confirmed gone by auth.users or GoTrue's own user_not_found; anything unconfirmed stays active, goes
 *      to the back of the sweep's rotating window, and is logged).
 *   3. The due rows (queued at erasure; next attempt due, give or take APPLE_DUE_SLACK — dueRevocations: at most 100
 *      UNITS a run, every queued row of each, never a unit cut in two — C4), one locked
 *      unit per account and Apple ID (settleQueuedTokens — ⛔ C3: the unit holds the Apple ID's advisory lock, which
 *      every token store takes too, from its "does a live account hold this Apple ID?" to its last write):
 *      · a LIVE account holds the same Apple ID — an active row with a Profile, or GoTrue's own Apple identity for it
 *        (a re-sign-up whose token was never kept) — either client: they share one grouped consent — so the person
 *        signed up again after deleting: the queued rows are dropped, NOT revoked;
 *      · an active row of an account that cannot be told live or gone holds it: nothing is touched today (deferred);
 *      · otherwise every row is validated, THEN the valid ones revoked: revoked or already dead (invalid_grant) →
 *        the row goes; anything else → tried again tomorrow;
 *      · still failing 14 days after the erasure → the row goes, `[auth] apple_revoke_gave_up` is logged and the
 *        answer is 500, so the unit shows in `systemctl --failed`. So does any unit or sweep the database failed.
 *   4. 200 with the probe and the counts. Unconfigured (the dark deploy) answers 200 with
 *      probe {services:'unconfigured', bundle:'unconfigured'} and touches nothing unless rows are queued.
 *   ⛔ NO TOKEN TABLE YET (commit gate round 2, O4): the timer is in SAFE, so the installer can enable it before
 *      scripts/apple-siwa-ddl.mjs has run — and every run then failed on 42P01, the unit red every day for a step not
 *      yet due. A missing public.apple_siwa_token (to_regclass) skips steps 2 and 3, logs
 *      `[auth] apple_token_table_missing` and answers `skipped: 'no_table'` — 200 while Apple is UNCONFIGURED here.
 *      ⛔ CONFIGURED AND NO TABLE IS RED (commit gate round 12, codex): with APPLE_SIWA_* in the container every Apple
 *      sign-in is live and every token store silently finds no table — each such account would be left to manual
 *      revocation, with the unit green. The runbook puts the DDL (I2) long before the secrets (I7/I8), so this only
 *      fires on a skipped step — exactly when it must.
 *      Nothing can be queued without the table: every token store and every erasure tolerates its absence too.
 */
/**
 * ⚠️ A RUN IS BOUNDED (commit gate round 5, opus): with Apple slow but answering, 100 units × two rows × two calls at
 * APPLE_TIMEOUT_MS each ran for over half an hour, each unit holding a pooled connection and its Apple ID lock. No new
 * unit starts past this budget; what is left stays queued, counted as `deferred`, for tomorrow's run.
 * It bounds when work STARTS (round 11, codex): the orphan sweep stops at half of it, and a unit already running
 * finishes inside its own transaction limits. Worst case ≈ 5 minutes — probes 10 s, sweep ≈ 65 s, units started up to
 * 120 s, one more in flight ≤ 100 s — inside the timer's `curl --max-time 900` (install-cron-timers.sh).
 */
const RUN_BUDGET_MS = 120_000
/** A queued row older than this, while the run is skipping, turns the run red — well before the 14-day drop. */
const APPLE_STALL_ALERT_MS = 3 * 24 * 60 * 60 * 1000

export const GET = route({ auth: 'cron' }, async () => {
  const startedAt = Date.now()
  const clients = { services: appleServicesId(), bundle: appleBundleId() }
  const probe = { services: await probeClient(clients.services), bundle: await probeClient(clients.bundle) }
  const configured = !!(clients.services || clients.bundle)
  const refused = new Set<string>()
  let unhealthy = 0
  for (const which of ['services', 'bundle'] as const) {
    const id = clients[which]
    const word = probe[which]
    if (!configured || word === 'ok' || word === 'unreachable') continue
    unhealthy++
    if (word === 'invalid_client' && id) refused.add(id)
    logWarn('[auth] apple_client_invalid', { client: which, probe: word })
  }

  const authTables = await probeAuthTables()
  if (configured) {
    for (const table of ['flowState', 'identities'] as const) {
      if (authTables[table] === 'readable') continue
      unhealthy++
      logWarn('[auth] apple_auth_table_unreadable', { table, error: authTables.error ?? null })
    }
  }

  const counts = { orphaned: 0, due: 0, revoked: 0, manual: 0, retried: 0, dropped: 0, deferred: 0, gaveUp: 0, failed: 0 }

  if (!(await appleTokenTablePresent())) {
    if (configured) unhealthy++
    logWarn('[auth] apple_token_table_missing', configured ? { configured: true } : {})
    const skipped = { ok: unhealthy === 0, skipped: 'no_table' as const, probe, authTables, ...counts, checkedAt: new Date().toISOString() }
    return skipped.ok ? skipped : NextResponse.json(skipped, { status: 500 })
  }

  try {
    const orphans = await queueOrphanedTokens(50, startedAt + RUN_BUDGET_MS / 2)
    counts.orphaned = orphans.queued
    if (orphans.unconfirmed) logWarn('[auth] apple_orphan_unconfirmed', { count: orphans.unconfirmed })
  } catch (e) {
    counts.failed++
    logError(e, { op: 'apple-revocations.orphans' })
  }

  /**
   * ⛔ APPLE UNREACHABLE: NO SETTLES TODAY (round 5, opus). Every unit would only time out at Apple, one after another;
   * nothing is lost by waiting — the rows stay queued and tomorrow's run settles them. 200: Apple being down is not a
   * fault of ours, and `apple_unreachable` in the log says why nothing moved.
   */
  // ⛔ And while GoTrue's identities cannot be read (round 7, codex): the live check would be back to the token table
  // alone and could revoke a re-sign-up whose token was never kept. The rows wait, queued; the run is already red.
  const identitiesUnreadable = configured && authTables.identities !== 'readable'
  const appleDown = configured && (probe.services === 'unreachable' || probe.bundle === 'unreachable')
  if (appleDown || identitiesUnreadable) {
    if (appleDown) logWarn('[auth] apple_unreachable', { services: probe.services, bundle: probe.bundle })
    /**
     * ⛔ BOUNDED (rounds 7, 9, 11): a box that lost its route to Apple for good would skip every day, green, while queued
     * tokens outlived the 14-day promise. A row queued over APPLE_STALL_ALERT_MS turns the run red — days before the
     * drop, while there is still time to fix the route — and past 14 days the rows go (D9: drop and alert).
     */
    let oldest: number | null = null
    try {
      oldest = await oldestQueuedMs()
    } catch (e) {
      // Cannot tell how long rows have waited (round 12, codex): red, never "nothing waiting".
      unhealthy++
      logWarn('[auth] apple_queue_age_unreadable', { code: (e as { code?: string } | null)?.code ?? null })
    }
    if (oldest !== null && oldest > APPLE_STALL_ALERT_MS) {
      unhealthy++
      logWarn('[auth] apple_revocation_stalled', { days: Math.floor(oldest / 86_400_000) })
    }
    if (oldest !== null && oldest > APPLE_REVOKE_GIVE_UP_MS) {
      for (const d of await dropStaleQueued(APPLE_REVOKE_GIVE_UP_MS)) {
        counts.gaveUp++
        logWarn('[auth] apple_revoke_gave_up', { user: d.userId, client: d.clientId, attempts: d.attempts, reason: 'stalled' }) // `reason`, not `error`: errors.test.ts reads `error: '…'` in a route as a wire code
      }
    }
    const skipped = { ok: unhealthy === 0 && counts.failed === 0, skipped: appleDown ? 'apple_unreachable' as const : 'identities_unreadable' as const, probe, authTables, ...counts, checkedAt: new Date().toISOString() }
    return skipped.ok ? skipped : NextResponse.json(skipped, { status: 500 })
  }

  const rows = await dueRevocations(100) // 100 units, not rows (C4)
  counts.due = rows.length
  for (const group of byAccountAndAppleId(rows)) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      counts.deferred += group.clientIds.length // still queued, untouched: tomorrow's run has them
      continue
    }
    let outcomes: Awaited<ReturnType<typeof settleQueuedTokens>>
    try {
      outcomes = await settleQueuedTokens(group, { liveCheck: true, refusedClients: refused, giveUpAfterMs: APPLE_REVOKE_GIVE_UP_MS })
    } catch (e) {
      // Still queued, untouched: tomorrow's run has them. Red today, so a database that keeps failing is seen.
      counts.failed += group.clientIds.length
      logError(e, { op: 'apple-revocations.settle' })
      continue
    }
    for (const o of outcomes) {
      if (o.outcome === 'revoked') counts.revoked++
      else if (o.outcome === 'manual') counts.manual++
      else if (o.outcome === 'retried') counts.retried++
      else if (o.outcome === 'dropped') counts.dropped++
      else if (o.outcome === 'deferred') counts.deferred++
      else if (o.outcome === 'gave_up') {
        counts.gaveUp++
        // The bare id of an erased account — the one handle a later "eno is still in my Apple Account" ticket can be
        // matched on. Never the token, never the Apple ID.
        logWarn('[auth] apple_revoke_gave_up', { user: group.userId, client: o.clientId, attempts: o.attempts, error: o.error })
      }
    }
  }

  const body = { ok: unhealthy === 0 && counts.gaveUp === 0 && counts.failed === 0, probe, authTables, ...counts, checkedAt: new Date().toISOString() }
  return body.ok ? body : NextResponse.json(body, { status: 500 })
})

/** The due rows as settle units: one per erased account and Apple ID (both clients' rows share one authorization). */
function byAccountAndAppleId(rows: AppleTokenRow[]): Array<{ userId: string; appleSub: string; clientIds: string[] }> {
  const groups = new Map<string, { userId: string; appleSub: string; clientIds: string[] }>()
  for (const r of rows) {
    const key = JSON.stringify([r.userId, r.appleSub])
    const g = groups.get(key) ?? { userId: r.userId, appleSub: r.appleSub, clientIds: [] }
    g.clientIds.push(r.clientId)
    groups.set(key, g)
  }
  return [...groups.values()]
}
