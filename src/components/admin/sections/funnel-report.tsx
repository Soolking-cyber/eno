import { db } from '@/lib/db'
import { EmptyState } from '@/components/ui/empty-state'
import { PUBLISH_OUTCOME_COPY, summarisePublishFunnel, type PublishFunnelRow } from '@/lib/publish-funnel-report'

// The publish funnel — how many listings were attempted, how many went live, and the exact rule that
// refused the rest. ⚠️ THIS IS THE POINT OF THE COUNTER: the data existed nowhere until 2026-07-28.
// A tab of /admin/insights since console v2.
const WINDOW_DAYS = 30

export async function FunnelReport() {
  // Raw SQL: publish_funnel is a Postgres primitive (scripts/rate-limit-pg.mjs), not a Prisma model.
  // ⛔ `::int` IS LOAD-BEARING: node-postgres sends parameters untyped, and `date - unknown` resolves as date − date (an
  // integer), so without the cast `day >= …` failed (42883) on every load and the swallowed error read as "Nothing
  // recorded yet" (sweep 2026-10-22). A failed read now says so instead of passing for an empty counter.
  const rows = await db
    .$queryRaw<PublishFunnelRow[]>`
      select outcome, sum(count)::int as total
        from publish_funnel
       where day >= (now() at time zone 'utc')::date - ${WINDOW_DAYS - 1}::int
       group by outcome
       order by total desc`
    .catch((e: unknown) => {
      console.error('[admin/funnel] publish_funnel read failed:', e instanceof Error ? e.message : e)
      return null
    })
  const report = summarisePublishFunnel(rows ?? [])

  return (
    <section aria-labelledby="funnel-report" className="max-w-3xl">
      <h2 id="funnel-report" className="sr-only">Publish funnel</h2>
      <p className="text-sm text-body">Every tap of Publish in the last {WINDOW_DAYS} days, and what happened to it.</p>
      {/* ⚠️ TAPS, NOT PEOPLE: one seller fixing a field and tapping again is counted twice. */}
      <p className="mt-1 text-2xs leading-relaxed text-body">
        Counted per tap, not per seller — read these as where effort is being lost, not as a per-person conversion rate.
        Server-side refusals have been counted since 28 Jul; client-side ones only since 29 Jul, so the success rate steps down on that boundary.
      </p>
      {rows === null ? (
        <div className="mt-6">
          <EmptyState tone="admin" title="Could not read the publish funnel" subtitle="The query failed — the server log has the error ([admin/funnel]). The counts themselves are unaffected." />
        </div>
      ) : report.attempts === 0 ? (
        <div className="mt-6">
          <EmptyState tone="admin" title="Nothing recorded yet" subtitle="The counter starts at the next publish attempt. If this stays empty while listings are going live, publish_log() is not reaching the database — check scripts/rate-limit-pg.mjs." />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { label: 'Publish taps', value: report.attempts },
              { label: 'Published', value: report.published },
              { label: 'Refused', value: report.refused },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-line-strong p-3">
                <p className="text-2xs font-bold uppercase tracking-wide text-body">{s.label}</p>
                <p className="mt-0.5 text-lg font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-body"><span className="font-bold text-foreground">{report.successRate}%</span> of taps ended in a live listing.</p>
          {report.reasons.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-bold text-foreground">Why the rest were refused</h3>
              <ul className="mt-2 space-y-1.5">
                {report.reasons.map((r) => (
                  <li key={r.outcome} className="rounded-xl border border-line-strong p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-bold text-foreground">{PUBLISH_OUTCOME_COPY[r.outcome] ?? r.outcome}</span>
                      <span className="shrink-0 text-sm font-bold text-foreground">{r.total} <span className="text-2xs font-semibold text-body">({r.share}%)</span></span>
                    </div>
                    <p className="mt-0.5 font-mono text-2xs text-body">{r.outcome}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
