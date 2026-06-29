import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { updateSellerCore } from '@/lib/core/seller'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A seller edits their OWN storefront (business profile). auth → core → respond; the edit
// logic is the shared updateSellerCore (also used by the partner PATCH /api/v1/shop).
export async function PATCH(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const res = await updateSellerCore(seller.id, profile.id, body)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.code })
  return NextResponse.json({ ok: true })
}
