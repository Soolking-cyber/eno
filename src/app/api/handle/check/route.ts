import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { validateHandle } from '@/lib/handle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live availability check for the handle editor (debounced client-side).
// Authed + rate-limited: handles are public identifiers (every claimed one is
// visible at /@name), so this isn't an enumeration oracle — the limit just keeps
// it from being scripted as a bulk name scanner.
export async function GET(req: NextRequest) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const rl = await rateLimit('handle-check', meId, 60, '1 m')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const h = String(new URL(req.url).searchParams.get('h') || '').trim().toLowerCase().replace(/^@/, '')
  const err = validateHandle(h)
  if (err) return NextResponse.json({ handle: h, valid: false, available: false, reason: err })

  const row = await db.handle.findUnique({ where: { handle: h }, select: { profileId: true, sellerId: true } })
  // "Available" includes "it's already yours" (either your user or your shop handle)
  // so re-saving the current name doesn't read as taken in the editor.
  if (!row) return NextResponse.json({ handle: h, valid: true, available: true })
  const mine =
    row.profileId === meId ||
    (row.sellerId !== null &&
      (await db.seller.count({ where: { id: row.sellerId, ownerId: meId } })) > 0)
  return NextResponse.json({ handle: h, valid: true, available: mine, reason: mine ? undefined : 'taken' })
}
