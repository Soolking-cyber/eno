import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE: remove one of the user's saved searches (owner-scoped).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile()
  if (!me) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  // deleteMany scoped by profileId → a cross-user id simply deletes nothing (no 404 oracle).
  const res = await db.savedSearch.deleteMany({ where: { id, profileId: me.id } })
  return NextResponse.json({ ok: res.count > 0 })
}

// PATCH { notify }: toggle alerts for one saved search (owner-scoped).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile()
  if (!me) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  let body: { notify?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  if (typeof body.notify !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const res = await db.savedSearch.updateMany({ where: { id, profileId: me.id }, data: { notify: body.notify } })
  return NextResponse.json({ ok: res.count > 0 })
}
