import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Remove a browser's push subscription (owner-scoped — you can only delete your
// own endpoint).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { endpoint?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const endpoint = String(body.endpoint || '')
  if (endpoint) await db.pushSubscription.deleteMany({ where: { endpoint, profileId: profile.id } })
  return NextResponse.json({ ok: true })
}
