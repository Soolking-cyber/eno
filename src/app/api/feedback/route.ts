import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId, getAdmin } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = ['feedback', 'technical', 'other'] as const

// Submit feedback / a technical-problem report from the Help sheet or Help Center.
// Anonymous-friendly (search + help are open to everyone); rate-limited by profile
// when signed in, else by IP, to bound abuse + cost. Lands in /admin/feedback.
export async function POST(req: NextRequest) {
  const profileId = await getCurrentProfileId()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  const rl = await rateLimit('feedback', profileId || ip, 8, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { kind?: string; message?: string; email?: string; url?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_body' }, { status: 400 }) }

  const message = String(body.message || '').trim().slice(0, 4000)
  if (message.length < 2) return NextResponse.json({ error: 'empty' }, { status: 400 })
  const kind = KINDS.includes(body.kind as never) ? String(body.kind) : 'feedback'
  const email = body.email ? String(body.email).trim().slice(0, 200) : null
  const url = body.url ? String(body.url).trim().slice(0, 500) : null
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) || null

  try {
    await db.feedback.create({ data: { kind, message, email, url, userAgent, profileId: profileId || null } })
  } catch (e) {
    // Degrade gracefully if the table isn't migrated yet (pre-push deploy).
    console.error('[feedback] create failed', (e as Error)?.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 503 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}

// Admin-only: resolve / reopen a feedback item.
export async function PATCH(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  let body: { id?: string; status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_body' }, { status: 400 }) }
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'no_id' }, { status: 400 })
  const status = body.status === 'resolved' ? 'resolved' : 'open'
  try {
    await db.feedback.update({ where: { id }, data: { status } })
  } catch {
    // Mirror the POST path: degrade to a clean 503 instead of an unhandled 500 if
    // the Feedback table is missing/unavailable.
    return NextResponse.json({ error: 'save_failed' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
