import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'

const TYPES = new Set(['individual', 'business'])

// Records the one-time account type (individual vs business) chosen right after
// the first sign-in. Business accounts also capture a business name, which is
// synced to the Seller storefront when they create/claim one. Owner-scoped via
// getCurrentProfile() (the route trusts the session, never the client).
export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { accountType?: string; businessName?: string } = {}
  try { body = await req.json() } catch { /* empty body → invalid below */ }

  const accountType = String(body.accountType || '')
  if (!TYPES.has(accountType)) {
    return NextResponse.json({ error: 'invalid_account_type' }, { status: 400 })
  }

  const businessName = accountType === 'business'
    ? (String(body.businessName || '').trim().slice(0, 120) || null)
    : null

  await db.profile.update({
    where: { id: profile.id },
    data: { accountType, businessName },
  })

  // If they already own a storefront and gave a business name, keep its name in
  // sync (cheap, idempotent — full business-profile editing lands in Phase 3).
  if (businessName) {
    await db.seller.updateMany({ where: { ownerId: profile.id }, data: { name: businessName } })
  }

  return NextResponse.json({ ok: true, accountType })
}
