import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resolve the webhook only if it belongs to the caller's (business) shop — else null.
async function ownedHook(id: string): Promise<{ sellerId: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return null
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return null
  const hook = await db.webhookEndpoint.findUnique({ where: { id }, select: { sellerId: true } })
  return hook && hook.sellerId === seller.id ? hook : null
}

// PATCH — pause/resume an endpoint. Body: { enabled: boolean }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedHook(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let body: { enabled?: unknown }
  try { body = await req.json() } catch { body = {} }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  // Re-enabling clears the failure counter so a previously-disabled hook gets a clean retry.
  const hook = await db.webhookEndpoint.update({
    where: { id },
    data: body.enabled ? { enabled: true, failureCount: 0, lastError: null } : { enabled: false },
    select: { id: true, enabled: true },
  })
  return NextResponse.json({ webhook: hook })
}

// DELETE — unregister an endpoint. 404 if it isn't this shop's.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedHook(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await db.webhookEndpoint.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
