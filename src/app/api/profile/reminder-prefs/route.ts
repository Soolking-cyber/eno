import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: current reminder preference. POST { dailyReminderOptIn }: update it.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  return NextResponse.json({ dailyReminderOptIn: profile.dailyReminderOptIn })
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  let body: { dailyReminderOptIn?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.dailyReminderOptIn !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  await db.profile.update({ where: { id: profile.id }, data: { dailyReminderOptIn: body.dailyReminderOptIn } })
  return NextResponse.json({ ok: true, dailyReminderOptIn: body.dailyReminderOptIn })
}
