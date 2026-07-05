import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { isListingImageUrl } from '@/lib/listing-image'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The REPORTER adds detail/proof to their own open report — reached from the admin's
// "need more detail" notification (/reports/[id]). Mirror of the target-side appeal
// route. Supplements APPEND to Report.detail (timestamped, photo URLs as lines) so the
// moderation card and the admin AI review read them with zero extra plumbing.
const DETAIL_CAP = 6000

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('report-supplement', meId, 10, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  let body: { text?: string; images?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const text = String(body.text || '').trim().slice(0, 2000)
  const images = Array.isArray(body.images) ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 6) : []
  if (text.length < 3 && images.length === 0) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  const report = await db.report.findUnique({
    where: { id },
    select: { id: true, reporterProfileId: true, status: true, detail: true },
  })
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Only the person who filed it can supplement it.
  if (report.reporterProfileId !== meId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  // Case already decided — supplements would be unread; tell the reporter plainly.
  if (report.status !== 'open') return NextResponse.json({ error: 'already_resolved' }, { status: 409 })

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const addition =
    `[Update ${stamp}]` +
    (text ? `\n${text}` : '') +
    images.map((u) => `\n📷 ${u}`).join('')
  const detail = ((report.detail ? `${report.detail}\n\n` : '') + addition).slice(0, DETAIL_CAP)

  await db.report.update({ where: { id }, data: { detail } })
  return NextResponse.json({ ok: true })
}
