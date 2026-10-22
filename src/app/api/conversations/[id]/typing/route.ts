import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ephemeral "typing" signal — no DB write, no persistence. Broadcasts via a
// SECURITY DEFINER function that re-checks participation and sends on the private
// 'convo:<id>' channel (same RLS gate as messages). Clients never broadcast
// directly, so there is no message-forgery vector.
//
// ⚠️ WS6 — NOT MIGRATED. Its 401 carries an EMPTY body — `new NextResponse(null, { status: 401 })`, no
// JSON, no content-type — while the wrapper's 'userId' mode answers {"error":"auth_required"}.
// Same status, different bytes, on a keystroke-frequency endpoint whose caller reads neither. The
// wrapper cannot express a bodyless 401, so this preamble stays hand-written; changing the body to
// fit the wrapper would be the migration changing the wire to suit itself. (WS6 audit, 2026-08-06.)
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return new NextResponse(null, { status: 401 })
  // ⛔ RATE-LIMITED (security review 2026-10-22, item 20). Every POST inserts a realtime.messages row and fans it out,
  // so an unthrottled participant amplified writes and could flood the other person's socket. 30 a minute is far above
  // what a keystroke-debounced client sends. NOT strict: typing is best-effort, so a limiter outage lets it through
  // rather than failing a chat feature. Over the limit, answer the same bodyless 204 — the caller never reads it.
  const rl = await rateLimit('typing', meId, 30, '1 m')
  if (!rl.success) return new NextResponse(null, { status: 204 })
  try {
    await db.$executeRaw`select public.broadcast_typing(${id}::text, ${meId}::uuid)`
  } catch {
    // typing is best-effort; never surface an error
  }
  return new NextResponse(null, { status: 204 })
}
