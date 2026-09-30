import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import { readIndexNowKey } from '@/lib/indexnow-key'
import { asHold, asSnapshot, planRun, type Diff, type RunPlan, type Snapshot } from '@/lib/indexnow-diff'
import { logError } from '@/lib/log'
import { kv } from '@/lib/ratelimit'
import { randomUUID } from 'node:crypto'
import { collectSitemaps } from './collect'
import { sendIndexNow } from './send'

/**
 * /api/cron/indexnow — TELL THE INDEXNOW ENGINES WHICH ENO.VN URLS CHANGED (SEO wave B, I4).
 *
 * Driven by the `indexnow` systemd timer at 01:30 and 13:30 UTC (infra/vn-node/cron/install-cron-timers.sh)
 * and once after each deploy (infra/vn-node/eno-deploy.sh, advisory), both through eno-cron.sh on
 * 127.0.0.1:3001 with `Host: eno.vn`. The sitemaps are built in-process (./collect.ts); the diff and
 * every rule about what may be pinged are in src/lib/indexnow-diff.ts.
 *
 * In order:
 *   1. eno.forum: 404. No `INDEXNOW_KEY` (or a malformed one): 200 `{skipped:'no_key'}`, touching nothing.
 *   2. The lease `indexnow:lease` (30 min), so the timer and a deploy's call never overlap:
 *      taken → 200 `{skipped:'running'}`.
 *   3. A source failure: 503, and the snapshot and the hold are left as they are, so a failing source
 *      can never lead to a re-baseline. (An unknown rent snapshot is NOT one: it freezes the rent
 *      index's URLs, build.ts.)
 *   4. No stored snapshot: save a baseline, send nothing.
 *   5. The guard trips: save the hold, send nothing, 409 with `{count, firstAt, overlap}` — eno-cron.sh
 *      exits non-zero on it, so the unit shows in `systemctl --failed`.
 *   6. A ripe hold (3 trips over 20 h): re-baseline — ping added and changed, never removals.
 *   7. `?rebaseline=1`: accept now, send nothing.   8. `?dry=1`: the plan only, READ-ONLY (no lease).
 *   9. Otherwise POST the changes, and on 200/202 save the snapshot and drop the hold.
 *
 * Manual re-baseline on the box (not through eno-cron.sh — its `$JOB` is unquoted in a path, so `?`
 * would glob):
 *   S=$(docker exec eno-vn-app printenv CRON_SECRET); curl -s -H "Authorization: Bearer $S" \
 *     -H 'Host: eno.vn' 'http://127.0.0.1:3001/api/cron/indexnow?rebaseline=1'
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNAPSHOT_KEY = 'indexnow:v1:eno.vn'
const HOLD_KEY = 'indexnow:hold'
const LEASE_KEY = 'indexnow:lease'
/**
 * 30 minutes: longer than anything that calls this may wait (eno-cron.sh's curl gives up at 900 s, the
 * deploy's call at 300 s), so a lease expires under a live run only if that run has hung for twice the
 * longest caller's patience. That bound is what makes the non-atomic release below safe in practice:
 * kv has no compare-and-delete (codex, diff review).
 */
const LEASE_SEC = 1800
/** How many URLs of each kind a response lists; the counts are always exact. */
const LIST_CAP = 500

const counts = (d: Diff) => ({ added: d.added.length, changed: d.changed.length, removed: d.removed.length, frozenKept: d.frozenKept })
const lists = (d: Diff) => ({ added: d.added.slice(0, LIST_CAP), changed: d.changed.slice(0, LIST_CAP), removed: d.removed.slice(0, LIST_CAP) })

/** What a dry run reports: the plan, in full, with nothing written. */
function describe(plan: RunPlan, frozen: string[]) {
  switch (plan.kind) {
    case 'baseline':
      return { would: 'baseline', urls: plan.count, frozen }
    case 'manual-rebaseline':
      return { would: 'rebaseline', frozen, ...counts(plan.diff) }
    case 'send':
      return { would: 'send', urlList: plan.urlList.slice(0, LIST_CAP), sent: plan.urlList.length, frozen, ...counts(plan.diff), ...lists(plan.diff) }
    case 'trip':
      return { would: 'hold', hold: { reason: plan.hold.reason, count: plan.hold.count, firstAt: plan.hold.firstAt, overlap: plan.hold.overlap }, frozen, ...counts(plan.diff), ...lists(plan.diff) }
    case 'auto-rebaseline':
      return { would: 'auto-rebaseline', urlList: plan.urlList.slice(0, LIST_CAP), sent: plan.urlList.length, frozen, ...counts(plan.diff) }
  }
}

async function accept(next: Snapshot) {
  await kv.set(SNAPSHOT_KEY, next)
  await kv.del(HOLD_KEY)
}

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return new NextResponse('Not Found', { status: 404 })
  const key = readIndexNowKey()
  if (!key) return { skipped: 'no_key' }

  const params = new URL(req.url).searchParams
  const dry = params.get('dry') === '1'
  const rebaseline = params.get('rebaseline') === '1'

  // ⚠️ A DRY RUN TAKES NO LEASE: it writes nothing at all, so it cannot race a real run.
  // ⚠️ THE LEASE HOLDS A TOKEN, AND ONLY ITS HOLDER RELEASES IT (codex, diff review): a run that
  // outlived its lease must not delete the lease a later run has taken since. The check-then-delete is
  // not atomic; the race needs a run hung past LEASE_SEC AND an expiry inside one round trip.
  const token = randomUUID()
  if (!dry && !(await kv.set(LEASE_KEY, token, { nx: true, ex: LEASE_SEC }))) return { skipped: 'running' }
  try {
    let collected
    try {
      collected = await collectSitemaps()
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error('[indexnow] source failure; nothing sent, snapshot and hold untouched:', detail)
      return NextResponse.json({ error: 'source_failure', detail }, { status: 503 })
    }
    const { urls, frozen } = collected
    const [prev, hold] = await Promise.all([kv.get(SNAPSHOT_KEY).then(asSnapshot), kv.get(HOLD_KEY).then(asHold)])
    const now = new Date()
    const plan = planRun({ prev, curr: urls, frozen, hold, now, rebaseline })

    if (dry) return { dry: true, ...describe(plan, frozen), children: collected.children }

    switch (plan.kind) {
      case 'baseline':
        // accept(), not a bare snapshot write: a hold left from before the snapshot went missing must not
        // carry its count and firstAt into the new baseline's first trip (codex, diff review).
        await accept(plan.next)
        console.log(`[indexnow] baseline: ${plan.count} URLs, nothing sent`)
        return { baseline: plan.count, frozen }
      case 'manual-rebaseline':
        await accept(plan.next)
        console.log(`[indexnow] manual re-baseline: ${Object.keys(plan.next.urls).length} URLs, nothing sent`)
        return { rebaseline: 'manual', ...counts(plan.diff), frozen }
      case 'trip':
        await kv.set(HOLD_KEY, plan.hold)
        console.error(`[indexnow] guard tripped (${plan.hold.reason}); hold count ${plan.hold.count} since ${plan.hold.firstAt}, overlap ${plan.hold.overlap.toFixed(3)}; nothing sent`)
        return NextResponse.json(
          { error: 'guard_tripped', reason: plan.hold.reason, count: plan.hold.count, firstAt: plan.hold.firstAt, overlap: plan.hold.overlap, ...counts(plan.diff) },
          { status: 409 },
        )
      case 'send':
      case 'auto-rebaseline': {
        const rebase = plan.kind === 'auto-rebaseline'
        // The hold's latest trip is recorded first, so a deferred re-baseline still counts it and retries.
        if (rebase) await kv.set(HOLD_KEY, plan.hold)
        if (!plan.urlList.length) {
          await accept(plan.next)
          return { sent: 0, ...(rebase ? { rebaseline: 'auto' } : {}), ...counts(plan.diff), frozen }
        }
        const result = await sendIndexNow(key, plan.urlList)
        if (result.outcome === 'accepted') {
          await accept(plan.next)
          console.log(`[indexnow] ${rebase ? 'auto re-baseline, ' : ''}sent ${plan.urlList.length} URLs in ${result.batches} batch(es): ${result.statuses.join(',')}`)
          return { sent: plan.urlList.length, statuses: result.statuses, ...(rebase ? { rebaseline: 'auto' } : {}), ...counts(plan.diff), frozen }
        }
        if (result.outcome === 'deferred') {
          console.warn(`[indexnow] engine deferred (${result.status ?? result.detail}); snapshot kept, the same URLs go next run`)
          return { deferred: result.status ?? result.detail, sent: 0, ...counts(plan.diff), frozen }
        }
        console.error(`[indexnow] ENGINE REJECTED the ping: ${result.status} ${result.detail} — snapshot kept; check the key file https://eno.vn/<key>.txt`)
        return NextResponse.json({ error: 'engine_rejected', status: result.status, detail: result.detail }, { status: 502 })
      }
    }
  } finally {
    // A failed release only delays the next run until the lease's 30 minutes run out.
    if (!dry) {
      await kv
        .get(LEASE_KEY)
        .then((held) => (held === token ? kv.del(LEASE_KEY) : undefined))
        .catch((e) => logError(e, { op: 'indexnow.lease_release' }))
    }
  }
})
