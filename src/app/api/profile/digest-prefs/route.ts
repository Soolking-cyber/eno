import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: current weekly-digest preference. POST { weeklyDigestOptIn }: update it.
// (Logged-in settings toggle; the email footer's token link handles logged-out opt-out.)
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  return NextResponse.json({ weeklyDigestOptIn: profile.weeklyDigestOptIn })
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  let body: { weeklyDigestOptIn?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.weeklyDigestOptIn !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  await db.profile.update({ where: { id: profile.id }, data: { weeklyDigestOptIn: body.weeklyDigestOptIn } })
  return NextResponse.json({ ok: true, weeklyDigestOptIn: body.weeklyDigestOptIn })
}
