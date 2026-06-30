import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { isListingImageUrl } from '@/lib/listing-image'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The reported party appeals a confirmed report by submitting an explanation + proof images.
// Re-opens the SAME report (status→open) tagged with the appeal so it re-surfaces in the
// moderation queue for review. Only the target can appeal; only once until re-resolved.
export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('appeal', meId, 10, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { reportId?: string; note?: string; images?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const reportId = String(body.reportId || '').trim()
  const note = String(body.note || '').trim().slice(0, 2000)
  const images = Array.isArray(body.images) ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 6) : []
  if (!reportId || note.length < 5) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  const report = await db.report.findUnique({ where: { id: reportId }, select: { id: true, targetProfileId: true, status: true, appealedAt: true } })
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Only the reported account can appeal its own case.
  if (report.targetProfileId !== meId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  // Already appealed and awaiting review → accept idempotently (no spam re-open).
  if (report.status === 'open' && report.appealedAt) return NextResponse.json({ ok: true, already: true })

  await db.report.update({
    where: { id: reportId },
    data: { status: 'open', appealNote: note, appealImages: images.length ? JSON.stringify(images) : null, appealedAt: new Date(), resolvedBy: null, resolvedAt: null },
  })
  return NextResponse.json({ ok: true })
}
