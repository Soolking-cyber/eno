import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { generateApiKey } from '@/lib/api/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Partner API key management — SESSION-authed (cookie), business-tier only. Powers the
// dashboard "Developers" UI. (The keys themselves authenticate /api/v1; these routes are
// the mint/list surface, behind the normal edge pin + cookie auth.)
const VALID_SCOPES = new Set(['listings:read', 'analytics:read', 'listings:write', 'media:write'])
const MAX_KEYS_PER_SHOP = 10

async function callerShop(): Promise<{ profileId: string; sellerId: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return null
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  return seller ? { profileId: profile.id, sellerId: seller.id } : null
}

// ⚠️ WS6 — NOT MIGRATED (assessed in wave 1, reasoning written into the file 2026-08-06). Both
// exports, three independent blockers:
//   · A GUEST GETS 403 `business_only`, NOT 401. `callerShop()` returns null identically for a
//     signed-out caller, a signed-in personal-tier caller, and a business caller with no Seller row
//     — one 403 for all three. Any authed mode would answer `{"error":"auth_required"}` 401 to the
//     first of those. So auth must stay `'public'` with the resolve inside the handler, which
//     leaves all four options empty — churn. (An earlier draft supported this with
//     `bulk-upload-panel.tsx:100`, which the review showed calls `/api/listings/bulk`, not this
//     route. This route's only client, `developers-panel.tsx:43`, throws on `!r.ok` and reads no
//     code at all — so the blocker is the 403-vs-401 status on the wire, full stop, and does not
//     depend on anyone reading the string.)
//   · TWO 4xx BODIES CARRY AN EXTRA KEY ALONGSIDE `error`, and `apiFail()` emits exactly
//     `{"error":"<code>"}` and nothing else: GET's `{"error":"business_only","keys":[]}` 403 and
//     POST's `{"error":"too_many_keys","max":10}` 400.
//   · POST'S BODY PARSE IS DELIBERATELY TOLERANT AND CANNOT BE A SCHEMA. `catch { body = {} }` means
//     a malformed body still MINTS A KEY: `name` falls to `''` and `scopes` falls to the
//     `['listings:read','analytics:read']` default, so the answer is a 201 with a secret. `body:`
//     would answer 400 instead. `String(body.name || '')` likewise coerces a number or an object
//     that zod would reject.
// POST — mint a key. The full secret is returned ONCE; afterwards only the prefix shows.
export async function POST(req: NextRequest) {
  const who = await callerShop()
  if (!who) return NextResponse.json({ error: 'business_only' }, { status: 403 })

  let body: { name?: unknown; scopes?: unknown }
  try { body = await req.json() } catch { body = {} }
  // Store the name as-is (empty when none) so the UI can render a TRANSLATED fallback
  // label instead of a hardcoded English "API key".
  const name = String(body.name || '').trim().slice(0, 60)
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
// ⚠️ WS6 — NOT MIGRATED: see the block above POST. The 403 here is `{"error":"business_only",
// "keys":[]}` — an error code WITH a domain field, which `apiFail()` cannot emit — and a guest
// reaches it, so no authed mode is wire-identical.
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
