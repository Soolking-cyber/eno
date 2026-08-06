import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE /api/keys/{id} — revoke a partner API key. Session-authed (cookie), business-
// tier; the key must belong to the caller's shop. Revocation is immediate (resolveApiKey
// rejects revoked keys) and irreversible. Idempotent.
//
// ⚠️ WS6 — NOT MIGRATED (assessed in wave 1, reasoning written into the file 2026-08-06):
// A GUEST GETS 403 `{"error":"business_only"}`, NOT 401 — the same predicate as /api/keys, and
// unlike that route this one splits the two failures the parent conflates: no session or a
// personal-tier account is `business_only` 403, a business account with no Seller row is
// `no_storefront` 403. `auth: 'profile'` would answer `{"error":"auth_required"}` 401 to the
// first, which is a different code AND a different status. With auth pinned to `'public'` and the
// resolve left in the handler, all four options are empty (no rate limit, no JSON body) — the
// wrapper would buy nothing and add a layer.
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
