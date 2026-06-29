import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE /api/keys/{id} — revoke a partner API key. Session-authed (cookie), business-
// tier; the key must belong to the caller's shop. Revocation is immediate (resolveApiKey
// rejects revoked keys) and irreversible. Idempotent.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return NextResponse.json({ error: 'business_only' }, { status: 403 })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  const { id } = await params
  const key = await db.apiKey.findUnique({ where: { id }, select: { sellerId: true, revokedAt: true } })
  if (!key || key.sellerId !== seller.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!key.revokedAt) await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
