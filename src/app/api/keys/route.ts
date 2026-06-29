import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { generateApiKey } from '@/lib/api/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Partner API key management — SESSION-authed (cookie), business-tier only. Powers the
// dashboard "Developers" UI. (The keys themselves authenticate /api/v1; these routes are
// the mint/list surface, behind the normal edge pin + cookie auth.)
const VALID_SCOPES = new Set(['listings:read', 'analytics:read']) // Phase 1 is read-only
const MAX_KEYS_PER_SHOP = 10

async function callerShop(): Promise<{ profileId: string; sellerId: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return null
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  return seller ? { profileId: profile.id, sellerId: seller.id } : null
}

// POST — mint a key. The full secret is returned ONCE; afterwards only the prefix shows.
export async function POST(req: NextRequest) {
  const who = await callerShop()
  if (!who) return NextResponse.json({ error: 'business_only' }, { status: 403 })

  let body: { name?: unknown; scopes?: unknown }
  try { body = await req.json() } catch { body = {} }
  const name = String(body.name || '').trim().slice(0, 60) || 'API key'
  const requested = Array.isArray(body.scopes) ? body.scopes.map(String) : ['listings:read', 'analytics:read']
  const scopes = requested.filter((s) => VALID_SCOPES.has(s))
  if (scopes.length === 0) return NextResponse.json({ error: 'invalid_scopes' }, { status: 400 })

  const live = await db.apiKey.count({ where: { sellerId: who.sellerId, revokedAt: null } })
  if (live >= MAX_KEYS_PER_SHOP) return NextResponse.json({ error: 'too_many_keys', max: MAX_KEYS_PER_SHOP }, { status: 400 })

  const { secret, prefix, hashedKey } = generateApiKey('live')
  const key = await db.apiKey.create({
    data: { sellerId: who.sellerId, profileId: who.profileId, name, prefix, hashedKey, scopes: scopes.join(' ') },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true },
  })
  return NextResponse.json({ key: { ...key, secret } }, { status: 201 }) // secret shown ONCE
}

// GET — list this shop's keys (never the secret; prefix only).
export async function GET() {
  const who = await callerShop()
  if (!who) return NextResponse.json({ error: 'business_only', keys: [] }, { status: 403 })
  const keys = await db.apiKey.findMany({
    where: { sellerId: who.sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  })
  return NextResponse.json({ keys })
}
