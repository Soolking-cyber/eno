import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { dashboardStatsCore } from '@/lib/core/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A recent confirmed report blocks the Exceptional tier (RECENT_BAD_WINDOW_DAYS in
// src/lib/trust.ts) — surfaced so the dashboard's tier-progress panel tells the truth.
const RECENT_BAD_WINDOW_DAYS = 90

// The seller CRM dashboard payload (owner-scoped). Answers the three questions a
// seller opens the dashboard for: new messages? how are my listings doing? what
// needs action? auth → core → respond (the aggregation is the shared
// dashboardStatsCore, whose `stats` the future /api/v1/analytics/summary reuses).
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ dashboard: null }, { status: 401 })
  // trustProgress: the inputs of tierFor() (src/lib/trust.ts) the client can't
  // derive itself — powers the "Your path to {next tier}" panel. One cheap
  // owner-scoped count; everything else is already on the Profile row.
  const [dashboard, recentBad] = await Promise.all([
    dashboardStatsCore(profile),
    db.trustEvent.count({
      where: {
        subjectProfileId: profile.id,
        type: 'report_confirmed',
        createdAt: { gte: new Date(Date.now() - RECENT_BAD_WINDOW_DAYS * 86_400_000) },
      },
    }),
  ])
  return NextResponse.json({
    dashboard: {
      ...dashboard,
      trustProgress: {
        positiveInteractions: profile.positiveInteractions,
        accountAgeDays: Math.floor((Date.now() - profile.createdAt.getTime()) / 86_400_000),
        hasRecentConfirmedReport: recentBad > 0,
        phoneVerified: !!profile.phone,
      },
    },
  })
}
