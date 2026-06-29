import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { safeFetch } from '@/lib/ssrf'

// Partner webhooks (Phase 3). A shop registers URLs that receive SIGNED listing events.
// Delivery is best-effort, runs in after() (never blocks a mutation), and auto-disables an
// endpoint after repeated failures. Signatures follow the Standard Webhooks spec so any
// off-the-shelf verifier works on the receiving side.

const MAX_FAILURES = 15 // consecutive failures → auto-disable (re-register to re-enable)
const DELIVERY_TIMEOUT_MS = 8000

export type ListingEvent = 'listing.created' | 'listing.updated' | 'listing.status_changed' | 'listing.deleted'

type Hook = { id: string; url: string; secret: string; events: string; failureCount: number }

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64')}`
}

// Standard Webhooks signature: base64(HMAC-SHA256(secret, `${id}.${ts}.${payload}`)),
// prefixed "v1,". The secret bytes are the base64 after the whsec_ prefix.
function sign(secret: string, msgId: string, ts: number, payload: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${msgId}.${ts}.${payload}`).digest('base64')
  return `v1,${sig}`
}

async function recordFailure(id: string, failureCount: number, error: string): Promise<void> {
  const next = failureCount + 1
  await db.webhookEndpoint.update({
    where: { id },
    data: { failureCount: next, lastError: error.slice(0, 300), ...(next >= MAX_FAILURES ? { enabled: false } : {}) },
  }).catch(() => {})
}

async function loadHooks(sellerId: string): Promise<Hook[]> {
  return db.webhookEndpoint
    .findMany({ where: { sellerId, enabled: true }, select: { id: true, url: true, secret: true, events: true, failureCount: true } })
    .catch(() => [])
}

// Sign + POST one event to one endpoint, then bump its success/failure bookkeeping.
async function deliver(h: Hook, event: ListingEvent, listingId: string, extra?: Record<string, unknown>): Promise<void> {
  if (h.events !== '*' && !h.events.split(/\s+/).filter(Boolean).includes(event)) return
  const msgId = `msg_${crypto.randomUUID()}`
  const now = new Date()
  const ts = Math.floor(now.getTime() / 1000)
  const payload = JSON.stringify({ id: msgId, type: event, created_at: now.toISOString(), data: { listing_id: listingId, ...extra } })
  try {
    // safeFetch re-resolves + re-validates the host on EVERY call and at every redirect hop
    // (redirect:'manual'), so a registered public URL can't be DNS-rebound or 302'd to an
    // internal address between registration and delivery (SSRF). It throws on an unsafe host.
    const res = await safeFetch(h.url, {
      timeoutMs: DELIVERY_TIMEOUT_MS,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': msgId,
        'webhook-timestamp': String(ts),
        'webhook-signature': sign(h.secret, msgId, ts, payload),
        'user-agent': 'eno.vn-webhooks/1',
      },
      body: payload,
    })
    if (res.ok) {
      await db.webhookEndpoint.update({ where: { id: h.id }, data: { failureCount: 0, lastError: null, lastDeliveryAt: now } }).catch(() => {})
    } else {
      await recordFailure(h.id, h.failureCount, `HTTP ${res.status}`)
    }
  } catch {
    // Generic message (not the raw DNS/connection/SSRF error) so the readable failure log
    // can't be used as an internal-network probe oracle. HTTP statuses above are public-safe.
    await recordFailure(h.id, h.failureCount, 'delivery failed (unreachable or blocked)')
  }
}

/**
 * Deliver a listing event to every enabled webhook of the owning shop. Pass `sellerId`
 * when the listing may already be gone (delete); otherwise it's resolved from the id.
 * NEVER throws — call from after().
 */
export async function dispatchListingEvent(event: ListingEvent, listingId: string, sellerId?: string, extra?: Record<string, unknown>): Promise<void> {
  let sid = sellerId
  if (!sid) {
    const l = await db.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } }).catch(() => null)
    sid = l?.sellerId ?? undefined
  }
  if (!sid) return
  const hooks = await loadHooks(sid)
  if (!hooks.length) return
  await Promise.all(hooks.map((h) => deliver(h, event, listingId, extra)))
}

/**
 * Deliver the SAME event for many listings of ONE shop — looks up the shop's endpoints a
 * single time (vs once per listing). Used by bulk import / sync. NEVER throws.
 */
export async function dispatchListingEventsBatch(event: ListingEvent, listingIds: string[], sellerId: string): Promise<void> {
  if (!listingIds.length) return
  const hooks = await loadHooks(sellerId)
  if (!hooks.length) return
  // Endpoint × listing, but capped concurrency by chunking so a big import can't open
  // hundreds of sockets at once.
  for (let i = 0; i < listingIds.length; i += 20) {
    const slice = listingIds.slice(i, i + 20)
    await Promise.all(slice.flatMap((id) => hooks.map((h) => deliver(h, event, id))))
  }
}
