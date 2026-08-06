import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { getCurrentProfileId, getAdmin } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = ['feedback', 'technical', 'other'] as const

// Submit feedback / a technical-problem report from the Help sheet or Help Center.
// Anonymous-friendly (search + help are open to everyone); rate-limited by profile
// when signed in, else by IP, to bound abuse + cost. Lands in /admin/feedback.
//
// ⚠️ WS6 — NOT MIGRATED: THE RATE-LIMIT KEY IS `profileId || ip`, WHICH THE WRAPPER CANNOT EXPRESS.
// route() keys by the caller for an authed mode and by clientIp() for `'public'`, one or the other,
// chosen statically. This route is deliberately BOTH: anonymous-friendly (help and search are open
// to everyone, so `auth: 'userId'` would 401 the people the Help sheet exists for), yet it resolves
// getCurrentProfileId() first so a signed-in reporter gets their own 8/h bucket instead of sharing
// one with everybody behind the same NAT. Under `auth: 'public'` the wrapper would collapse both
// groups onto the IP bucket — a real behaviour change on a strict, fail-CLOSED limiter, i.e. one
// office would lock each other out. So `auth: 'public'` with the limiter left in the handler, which
// leaves every option empty. No `body:` schema either: `String(body.message || '')` accepts a
// number where zod would 400.
export async function POST(req: NextRequest) {
  const profileId = await getCurrentProfileId()
  const ip = clientIp(req)
  // ⚠️ strict: FAIL CLOSED. This is an UNAUTHENTICATED write and this limiter is its only gate, so
  // open means unbounded 4000-char rows landing in /admin/feedback — the queue a human triages.
  // The route already returns 503 when its own write fails, so the client copy for that case exists.
  const rl = await rateLimit('feedback', profileId || ip, 8, '1 h', { strict: true })
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
//
// ⚠️ WS6 — NOT MIGRATED: THIS ONE SPELLS IT `forbidden`, LOWERCASE. route()'s `auth: 'admin'` emits
// `{"error":"Forbidden"}` with a capital F, because 16 admin routes emit exactly that — but this is
// not one of them, and errors.ts documents the collision as live on both spellings precisely so
// nobody "fixes" one into the other in passing. Changing it here would be a silent wire change on
// the branch a non-admin sees. `auth: 'admin'` would also add a getCurrentProfile() read this
// handler never uses. Everything else (tolerant parse → `bad_body`, `String(body.id || '')`) has
// the same tightening problem as the POST above.
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
