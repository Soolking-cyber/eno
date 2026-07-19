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
