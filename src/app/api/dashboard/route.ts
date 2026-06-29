import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
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
  return NextResponse.json({ dashboard: await dashboardStatsCore(profile) })
}
