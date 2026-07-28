import { AdminDenied } from '@/components/admin/admin-denied'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { EmptyState } from '@/components/ui/empty-state'
import { PUBLISH_OUTCOME_COPY, summarisePublishFunnel, type PublishFunnelRow } from '@/lib/publish-funnel-report'
import type { Metadata } from 'next'

// The publish funnel — how many listings were attempted, how many went live, and the exact
// rule that refused the rest.
//
// ⚠️ THIS PAGE IS THE POINT OF THE COUNTER, not a nicety. The data it reads existed nowhere
// until 2026-07-28: the post wizard emitted an analytics event only on SUCCESS, so a refused
// listing left no trace, and the only way to learn anything about this funnel was hand-written
// SQL against production. A number nobody can see is the same as a number nobody collected.
//
// Admin chrome is EN-only by repo convention, hence no tr() below.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Publish funnel — eno.vn',
  robots: { index: false, follow: false },
}

const WINDOW_DAYS = 30

export default async function AdminFunnelPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  // Raw SQL: publish_funnel is a Postgres primitive (scripts/rate-limit-pg.mjs), not a Prisma
  // model — same as search_trend. Resilient if the table has not been applied on this host yet.
  const rows = await db
    .$queryRaw<PublishFunnelRow[]>`
      select outcome, sum(count)::int as total
        from publish_funnel
       where day >= (now() at time zone 'utc')::date - ${WINDOW_DAYS - 1}
       group by outcome
       order by total desc`
    .catch(() => [] as PublishFunnelRow[])

  const report = summarisePublishFunnel(rows)

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-foreground">Publish funnel</h1>
      <p className="mt-1 text-sm text-body">
        Every tap of Publish in the last {WINDOW_DAYS} days, and what happened to it.
      </p>
      {/* ⚠️ TAPS, NOT PEOPLE, AND THE PAGE HAS TO SAY SO. Nothing auto-resubmits after sign-in, so
          one seller who forgets a field, fixes it, hits the sign-in wall and then publishes emits
          FOUR counts for ONE listing. Labelling that "attempts" with a "success rate" invites the
          reader to divide by people and conclude the funnel is three times worse than it is. */}
      <p className="mt-1 text-2xs leading-relaxed text-body">
        Counted per tap, not per seller — one person fixing a field and tapping again is counted
        twice. Read these as where effort is being lost, not as a per-person conversion rate.
      </p>
      {/* ⚠️ THE TWO HALVES STARTED ON DIFFERENT DAYS, so the first month of this window mixes them
          and the success rate will step DOWN on the day the client half deployed — not because
          anything got worse, but because refusals became visible for the first time. Saying so
          here is cheaper than someone reading a cliff as a regression. */}
      <p className="mt-1 text-2xs leading-relaxed text-body">
        Server-side refusals have been counted since 28 Jul; the client-side ones
        (&ldquo;Tapped Publish&hellip;&rdquo;) only since 29 Jul. Expect the success rate to drop on
        that boundary — that is refusals becoming visible, not the funnel getting worse.
      </p>

      {report.attempts === 0 ? (
        <div className="mt-6">
          <EmptyState
            tone="admin"
            title="Nothing recorded yet"
            subtitle="The counter starts at the next publish attempt. If this stays empty while listings are going live, publish_log() is not reaching the database — check scripts/rate-limit-pg.mjs has been applied."
          />
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

          <p className="mt-3 text-sm text-body">
            <span className="font-bold text-foreground">{report.successRate}%</span> of taps ended in a live listing.
          </p>

          {report.reasons.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-bold text-foreground">Why the rest were refused</h2>
              <ul className="mt-2 space-y-1.5">
                {report.reasons.map((r) => (
                  <li key={r.outcome} className="rounded-xl border border-line-strong p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-bold text-foreground">
                        {PUBLISH_OUTCOME_COPY[r.outcome] ?? r.outcome}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-foreground">
                        {r.total} <span className="text-2xs font-semibold text-body">({r.share}%)</span>
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-2xs text-body">{r.outcome}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
