import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

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
  try {
    await db.$executeRaw`select public.broadcast_typing(${id}::text, ${meId}::uuid)`
  } catch {
    // typing is best-effort; never surface an error
  }
  return new NextResponse(null, { status: 204 })
}
