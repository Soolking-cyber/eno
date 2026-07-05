import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { computeTrustV2 } from '@/lib/trust'
import { dashboardStatsCore } from '@/lib/core/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The seller CRM dashboard payload (owner-scoped). Answers the three questions a
// seller opens the dashboard for: new messages? how are my listings doing? what
// needs action? auth → core → respond (the aggregation is the shared
// dashboardStatsCore, whose `stats` the future /api/v1/analytics/summary reuses).
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ dashboard: null }, { status: 401 })
  // trustProgress: the REAL v2 tier-gate inputs (src/lib/trust-math.ts tierFor) the
  // client can't derive itself — powers the "Your path to {next tier}" panel.
  // computeTrustV2 is a bounded set of owner-scoped indexed queries.
  const [dashboard, breakdown] = await Promise.all([
    dashboardStatsCore(profile),
    computeTrustV2(profile.id).catch(() => null),
  ])
  const i = breakdown?.inputs
  // Days since the most recent DEMOTION-RELEVANT confirmed report (the dual-threshold
  // windows the tier gates actually read) — null when the recent record is clean.
  const cleanBlocked = !!i && (i.reports90.count > 0 || i.reports180.count > 0)
  return NextResponse.json({
    dashboard: {
      ...dashboard,
      trustProgress: i
        ? {
            transactions365: i.transactions365,
            distinctBuyerReviews: i.distinctBuyerReviews,
            responseWilson: i.responseWilson,
            accountAgeDays: Math.floor(i.accountAgeDays),
            phoneVerified: i.phoneVerified,
            hasRecentConfirmedReport: cleanBlocked,
            hasScamHold: i.hasScamHold,
          }
        : null,
    },
  })
}
