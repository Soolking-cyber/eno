import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { IMG_ALLOWED, IMG_MAX_BYTES, storeEvidenceImage } from '@/lib/core/media'
import { DISPUTE_IMAGES_MAX, loadDisputeForParty, partyCanPost, signEvidenceUrls } from '@/lib/dispute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Evidence upload for a dispute case — party-gated + window-gated, stored in the
// PRIVATE evidence bucket (receipts/screenshots carry PII; the public listings
// bucket is wrong for this). Same sharp pipeline as listings (EXIF/GPS stripped,
// decompression-bomb guarded) but no watermark and a higher-detail edge cap.
// Returns storage PATHS (to attach to a message) + short-lived preview URLs.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!partyCanPost(loaded.report)) return NextResponse.json({ error: 'window_closed' }, { status: 409 })

  // Storage-abuse vector → strict (Redis down = denied), like the other paid routes.
  const rl = await rateLimit('dispute-evidence', meId, 60, '1 h', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 })

  const paths: string[] = []
  let failed = 0
  for (const file of files.slice(0, DISPUTE_IMAGES_MAX)) {
    if (!IMG_ALLOWED.has(file.type) || file.size === 0 || file.size > IMG_MAX_BYTES) { failed++; continue }
    const path = await storeEvidenceImage(Buffer.from(await file.arrayBuffer()), loaded.report.id)
    if (path) paths.push(path)
    else failed++
  }

  return NextResponse.json({ paths, previews: await signEvidenceUrls(paths), failed })
}
