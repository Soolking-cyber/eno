import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { assertSafeUrl } from '@/lib/ssrf'
import { generateWebhookSecret } from '@/lib/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Webhook endpoint management — SESSION-authed (cookie), business-tier only. Powers the
// dashboard "Developers" UI. Mirrors /api/v1/webhooks (which is API-KEY authed) so a seller
// can register/list/remove endpoints from the browser without minting a write-scoped key.
const VALID_EVENTS = new Set(['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'])
const MAX_HOOKS_PER_SHOP = 10

async function callerShop(): Promise<{ sellerId: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return null
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  return seller ? { sellerId: seller.id } : null
}

// Normalize the requested event filter to a stored space-separated string (or "*" for all).
function normalizeEvents(raw: unknown): string | { error: string } {
  if (raw == null || raw === '*' || (Array.isArray(raw) && raw.length === 0)) return '*'
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : null
  if (!list) return { error: 'invalid_events' }
  const cleaned = list.map((e) => String(e).trim()).filter(Boolean)
  if (cleaned.length === 0) return '*'
  if (cleaned.some((e) => !VALID_EVENTS.has(e))) return { error: 'invalid_events' }
  return [...new Set(cleaned)].join(' ')
}

// ⚠️ WS6 — NOT MIGRATED (2026-08-06). Same shape as /api/keys, verified branch by branch:
//   · A GUEST GETS A 403 WITH A DOMAIN CODE, NOT 401. `callerShop()` collapses signed-out,
//     personal-tier and no-storefront into one null, so GET answers
//     `{"error":"business_only","webhooks":[]}` 403 and POST answers `{"error":"business_only"}`
//     403. Any authed mode emits `{"error":"auth_required"}` 401 for the signed-out case.
//   · GET'S 403 CARRIES A DOMAIN FIELD ALONGSIDE `error` (`"webhooks":[]`), as does POST's
//     `{"error":"too_many_webhooks","max":10}` 400. `apiFail()` emits `{"error":"<code>"}` only.
//   · POST'S BODY CANNOT BE ONE SCHEMA WITH ONE CODE. It has three distinct 400s —
//     `url_required`, `unsafe_url` (from the async `assertSafeUrl()` SSRF check, which is I/O and
//     not expressible in zod) and `invalid_events` — while `invalidBodyCode` is a single code for
//     the whole schema. `events` is also deliberately polymorphic (absent | `'*'` | a
//     comma/whitespace string | an array), and `catch { body = {} }` makes a malformed body a
//     `url_required` 400 rather than a parse error.
// With auth pinned to 'public' and the body left in the handler, every option is empty.
// GET — list this shop's webhooks (secrets never returned).
export async function GET() {
  const who = await callerShop()
  if (!who) return NextResponse.json({ error: 'business_only', webhooks: [] }, { status: 403 })
  const hooks = await db.webhookEndpoint.findMany({
    where: { sellerId: who.sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true },
  })
  return NextResponse.json({
    webhooks: hooks.map((h) => ({
      ...h,
      events: h.events === '*' ? ['*'] : h.events.split(/\s+/).filter(Boolean),
    })),
  })
}

// POST — register an endpoint. The signing secret is returned ONCE.
export async function POST(req: NextRequest) {
  const who = await callerShop()
  if (!who) return NextResponse.json({ error: 'business_only' }, { status: 403 })

  let body: { url?: unknown; events?: unknown }
  try { body = await req.json() } catch { body = {} }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url_required' }, { status: 400 })
  try {
    await assertSafeUrl(url) // https-only + blocks private/internal hosts (SSRF)
  } catch {
    return NextResponse.json({ error: 'unsafe_url' }, { status: 400 })
  }

  const events = normalizeEvents(body.events)
  if (typeof events === 'object') return NextResponse.json({ error: events.error }, { status: 400 })

  const secret = generateWebhookSecret()
  // Count + create atomically — two concurrent POSTs could otherwise both pass the
  // count check and exceed MAX_HOOKS_PER_SHOP.
  const hook = await db.$transaction(async (tx) => {
    const count = await tx.webhookEndpoint.count({ where: { sellerId: who.sellerId } })
    if (count >= MAX_HOOKS_PER_SHOP) return null
    return tx.webhookEndpoint.create({
      data: { sellerId: who.sellerId, url, events, secret },
      select: { id: true, url: true, events: true, enabled: true, createdAt: true },
    })
  })
  if (!hook) return NextResponse.json({ error: 'too_many_webhooks', max: MAX_HOOKS_PER_SHOP }, { status: 400 })
  return NextResponse.json({
    webhook: { ...hook, events: hook.events === '*' ? ['*'] : hook.events.split(/\s+/).filter(Boolean), secret },
  }, { status: 201 }) // secret shown ONCE
}
