import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { loadDisputeForParty, notifyDispute, respondentProfileId } from '@/lib/dispute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The reporter withdraws their own open case (Binance's "Cancel Appeal"): parties
// worked it out, or the report was a mistake. Closes as 'dismissed' with a marker
// resolvedBy so the UI can label it "withdrawn" — deliberately NOT a trust event
// in either direction (dismiss has no side effects). Idempotent via the atomic
// open→dismissed updateMany claim.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (loaded.role !== 'reporter') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const upd = await db.report.updateMany({
    where: { id, status: 'open', reporterProfileId: meId },
    data: { status: 'dismissed', resolvedBy: 'withdrawn-by-reporter', resolvedAt: new Date() },
  })
  if (upd.count === 0) return NextResponse.json({ error: 'already_resolved' }, { status: 409 })

  // Close the loop for the respondent (they were notified at open; tell them it's over).
  const respondent = await respondentProfileId(loaded.report)
  if (respondent && respondent !== meId) await notifyDispute(respondent, id, 'withdrawn_respondent')

  return NextResponse.json({ ok: true })
}
