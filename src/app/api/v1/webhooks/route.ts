import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { assertSafeUrl } from '@/lib/ssrf'
import { generateWebhookSecret } from '@/lib/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_EVENTS = new Set(['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'])
const MAX_HOOKS_PER_SHOP = 10

// Normalize the requested event filter to a stored space-separated string (or "*" for all).
function normalizeEvents(raw: unknown): string | { error: string } {
  if (raw == null || raw === '*' || (Array.isArray(raw) && raw.length === 0)) return '*'
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : null
  if (!list) return { error: 'events must be an array of event names or "*".' }
  const cleaned = list.map((e) => String(e).trim()).filter(Boolean)
  if (cleaned.length === 0) return '*'
  const bad = cleaned.find((e) => !VALID_EVENTS.has(e))
  if (bad) return { error: `Unknown event "${bad}". Valid: ${[...VALID_EVENTS].join(', ')}, or "*".` }
  return [...new Set(cleaned)].join(' ')
}

// GET /api/v1/webhooks — list this shop's registered webhook endpoints (secrets never returned).
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const hooks = await db.webhookEndpoint.findMany({
    where: { sellerId: r.auth.sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true },
  })
  return apiOk({
    webhooks: hooks.map((h) => ({
      id: h.id,
      url: h.url,
      events: h.events === '*' ? ['*'] : h.events.split(/\s+/).filter(Boolean),
      enabled: h.enabled,
      failure_count: h.failureCount,
      last_error: h.lastError,
      last_delivery_at: h.lastDeliveryAt,
      created_at: h.createdAt,
    })),
  }, r.rate)
}

// POST /api/v1/webhooks — register a signed-event endpoint. Body: { url, events? }. The
// signing secret is returned ONCE here (store it to verify the `webhook-signature` header).
// Scope: listings:write.
export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return apiError(400, 'bad_request', 'Invalid JSON body.', r.rate) }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return apiError(422, 'invalid_input', 'A `url` is required.', r.rate)
  try {
    await assertSafeUrl(url) // https-only + blocks private/internal hosts (SSRF)
  } catch {
    return apiError(422, 'invalid_input', 'url must be a public HTTPS endpoint.', r.rate)
  }

  const events = normalizeEvents(body.events)
  if (typeof events === 'object') return apiError(422, 'invalid_input', events.error, r.rate)

  const count = await db.webhookEndpoint.count({ where: { sellerId: r.auth.sellerId } })
  if (count >= MAX_HOOKS_PER_SHOP) {
    return apiError(422, 'limit_reached', `A shop may register at most ${MAX_HOOKS_PER_SHOP} webhooks.`, r.rate)
  }

  const secret = generateWebhookSecret()
  const hook = await db.webhookEndpoint.create({
    data: { sellerId: r.auth.sellerId, url, events, secret },
    select: { id: true, url: true, events: true, enabled: true, createdAt: true },
  })

  return apiOk({
    webhook: {
      id: hook.id,
      url: hook.url,
      events: hook.events === '*' ? ['*'] : hook.events.split(/\s+/).filter(Boolean),
      enabled: hook.enabled,
      created_at: hook.createdAt,
      secret, // shown ONCE — store it to verify signatures
    },
  }, r.rate, 201)
}
