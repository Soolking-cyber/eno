import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { fetchApiHonest, fetchFeedFacts, fetchPageHonest, runShowcase, type RawDb } from '@/lib/secondhand-showcase-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 1800

/**
 * WEEKLY: ONE SECOND-HAND LISTING PER CATEGORY, STILL ON SALE AT ITS SHOP (owner, 2026-10-17 — "check out 2nd hand deals
 * some of them are no longer available replace with available options have a 2nd hand run weekly to check", then "also
 * remove most of 2nd hand 1 example for each category is fine"); and the eSIM and car shelves held at the size the owner
 * trimmed them to the same day.
 * The rules are in src/lib/secondhand-showcase.ts, the run in src/lib/secondhand-showcase-run.ts.
 *
 * ⚠️ CALLED ON 127.0.0.1 WITH A Host HEADER, NOT THROUGH CLOUDFLARE — the box timer's eno-cron.sh, given a 30-minute
 * curl for this job (it reads ~17 shops, a few at a time, politely). Cloudflare would cut it at 100 s. The run's own budget
 * is 10 minutes of shop checks and 20 of pool walks, then the writes; if the curl gives up anyway the run still finishes
 * here, and every write is in the container log, journaled before it was made (`[secondhand-showcase] journal {…}`, one
 * line each) — what `scripts/secondhand-showcase.ts --rollback` replays when the kept answer is cut short.
 *
 * Monday 00:00 UTC (07:00 ICT). One edition is enough: the listings and the ISR invalidations are in the shared database.
 *
 * ⚠️ THE FIRST, CURATING APPLY IS THE CLI'S (scripts/secondhand-showcase.ts --apply --allow-mass, after its dry run): a
 * change of that size trips mass_trim here, by design — this route has no allowMass.
 * `?dryRun=1` writes nothing and returns the plan (retire / hide / reprice / restore per shelf) — fails SAFE like licence-holds:
 * any dryRun value but an explicit 0 / false / no is a dry run. `?store=<domain>` checks one shop (the others' shelves are
 * retired from only, the capped shelves wait for a full run); a domain that is not a live second-hand shop is refused.
 * Answers 200 `{ ok, totals, shops, journal, … }` — the journal is every write with its prior state (what a rollback
 * replays: scripts/secondhand-showcase.ts --rollback); 500 when a shop errored or the mass-retire guard refused, so the
 * unit shows FAILED. The first 200 bytes reach the journal (eno-cron.sh): ok and totals come first.
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  const params = new URL(req.url).searchParams
  const dryKey = [...params.keys()].find((k) => /^dry[_-]?run$/i.test(k))
  const dryParam = dryKey === undefined ? null : params.get(dryKey)
  const dryRun = dryParam !== null && !/^(0|false|no)$/i.test(dryParam.trim())
  const store = params.get('store')?.trim() || undefined
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const r = await runShowcase({
    db: db as unknown as RawDb,
    fetchPage: (url, shop) => fetchPageHonest(url, shop, sleep),
    fetchFeed: (cfg, ids) => fetchFeedFacts(cfg, ids, sleep),
    fetchApi: (cfg, row) => fetchApiHonest(cfg, row, sleep),
    now: () => new Date(),
    sleep,
    log: (m) => console.log(`[secondhand-showcase] ${m}`),
    // Each write just before it is made, in the container's log — the record survives a response that never reaches the
    // timer (an entry whose write did not land replays as a no-op).
    onJournal: (e) => console.log(`[secondhand-showcase] journal ${JSON.stringify(e)}`),
    // The write is not the ship: a PDP is ISR for thirty days (partner-stock's lesson). Called as each shelf lands. Home,
    // search and the category pages read live listings client-side; their ISR HTML (6 h) is first paint, refreshed too.
    onTouched: async (ids) => {
      for (const id of ids) revalidatePublicPath(`/listings/${id}`)
      revalidatePublicPath('/')
      revalidatePublicPath('/search')
      revalidatePublicPath('/c/[category]', 'page')
    },
  }, { apply: !dryRun, stores: store ? [store] : undefined, budgetMs: 10 * 60_000 })
  const { ok, apply, refused, writeErrors, totals, notReached, unmatchedRetire, stamp, shelves, shops, caps, journal } = r
  // writeErrors early: the unit's log keeps the first 200 bytes, and a 500 should say why.
  return NextResponse.json({ ok, apply, refused, writeErrors, totals, notReached, unmatchedRetire, stamp, shelves, shops, caps, journal }, { status: ok ? 200 : 500 })
})
