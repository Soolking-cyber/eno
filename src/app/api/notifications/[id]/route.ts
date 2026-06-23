import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE one of MY notifications (owner-scoped — deleteMany by recipientId so a
// cross-user id simply deletes nothing, no 404 oracle).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  await db.notification.deleteMany({ where: { id, recipientId: meId } })
  return new NextResponse(null, { status: 204 })
}
