import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { sendMetaCapiEvent, metaUserDataFromHeaders, metaCapiConfigured } from '@/lib/meta-capi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Server-side Meta CAPI ViewContent relay for listing views — the reliability backstop
// for the browser Pixel (ad-blockers drop the Pixel; this first-party call survives).
// The client beacon (src/lib/analytics.ts) only calls this when AD CONSENT is granted and
// passes the SAME event_id it used on the Pixel, so Meta dedupes the two into one event.
// This is the only place a *browsing* event goes through CAPI; conversions stay separate.
// Always 204 — analytics must never surface an error to the user; the send runs in after().
//
// ⚠️ WS6 — NOT MIGRATED: this route has NO failure vocabulary. Every branch — unconfigured, malformed
// JSON, missing fields, over the limit — answers a bodyless 204, which is the point (a beacon must not
// make the browser log an error). The wrapper's limiter answers 429 `{"error":"rate_limited"}` and its
// `body:` option answers 400, so hoisting either would turn a silent no-op into a client-visible
// failure. `metaCapiConfigured()` also has to run FIRST, before the limiter, so an unconfigured
// deployment spends nothing. Public, so there is no auth to hoist either — all four options empty.
export async function POST(req: NextRequest) {
  if (!metaCapiConfigured()) return new NextResponse(null, { status: 204 })

  let body: { id?: unknown; eventId?: unknown }
  try { body = await req.json() } catch { return new NextResponse(null, { status: 204 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  const eventId = typeof body.eventId === 'string' ? body.eventId.slice(0, 100) : ''
  if (!id || !eventId) return new NextResponse(null, { status: 204 })

  // Per-IP cap (fail-OPEN — a Redis blip must never drop a real view). Generous: a busy
  // browsing session legitimately views many listings.
  const rl = await rateLimit('track-view', clientIp(req), 240, '1 m')
  if (!rl.success) return new NextResponse(null, { status: 204 })

  // Capture user-matching data (IP/UA/_fbp/_fbc) from THIS request before after() runs.
  const userData = metaUserDataFromHeaders(req.headers)
  const sourceUrl = req.headers.get('referer') || undefined

  after(async () => {
    // Only emit for a real, PUBLIC catalog item (verified + active) — keeps us from
    // sending ViewContent for ids that aren't in the catalog (would never match anyway)
    // and gives Meta the accurate price/currency.
    const l = await db.listing
      .findUnique({ where: { id }, select: { price: true, currency: true, verified: true, status: true } })
      .catch(() => null)
    if (!l || !l.verified || l.status !== 'active') return
    await sendMetaCapiEvent('ViewContent', {
      eventId,
      eventSourceUrl: sourceUrl,
      userData,
      customData: {
        content_ids: [id],
        content_type: 'product',
        value: l.price,
        currency: l.currency === '₫' ? 'VND' : 'USD',
      },
    })
  })

  return new NextResponse(null, { status: 204 })
}
