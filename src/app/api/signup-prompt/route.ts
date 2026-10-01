import { NextResponse, type NextRequest } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { isProductionEnoHost } from '@/lib/consent-value'
import { isBotUserAgent } from '@/lib/bot-ua'
import { isSignupPromptEvent } from '@/lib/signup-prompt'
import { recordSignupPromptEvent } from '@/lib/signup-prompt-counter'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/signup-prompt — one anonymous +1 on today's total for one "Join eno" prompt event
 * (src/lib/signup-prompt-counter.ts says what is kept: a number, nothing about the caller).
 *
 * ⚠️ ALWAYS A BODYLESS 204, whatever happens. It is a beacon; nothing reads the reply, and an error
 * status would only put noise in a visitor's console.
 *
 * ⛔ ONLY THE LIVE SITES WRITE — /api/consent's rule, for /api/consent's reason: a local
 * `preview:vn` is a production build wired to the PRODUCTION database, so the operator clicking
 * through the prompt locally would count as real visitors. Nothing is read or written (the rate limiter
 * lives in that database too) unless NODE_ENV is production AND the Host is a real eno host.
 *
 * ⛔ SAME-ORIGIN, NOT A CRAWLER, AND RATE-LIMITED — /api/site-stats's rules. Anyone can POST here, so
 * the numbers are forgeable within these limits; they are a tuning signal for the owner, not a metric
 * to pay or report on.
 *   · 60/min per IP: one visitor produces a handful of events per ask; a carrier NAT pool many more,
 *     still far under this.
 *   · fails OPEN on a limiter fault, like site-stats — the counter is the same database, so a limiter
 *     that cannot answer means the increment will fail on its own anyway.
 */
const PER_MINUTE = 60
const MAX_BODY_BYTES = 256
const noContent = () => new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production' || !isProductionEnoHost(req.headers.get('host'))) return noContent()
  const origin = req.headers.get('origin')
  if (origin) {
    let ok = false
    try { ok = new URL(origin).host === req.headers.get('host') } catch { ok = false }
    if (!ok) return noContent()
  }
  if (isBotUserAgent(req.headers.get('user-agent') || '')) return noContent()
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return noContent()
  let event: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return noContent()
    event = (JSON.parse(text) as { e?: unknown })?.e
  } catch { return noContent() }
  if (!isSignupPromptEvent(event)) return noContent()

  const rl = await rateLimit('signup-prompt', clientIp(req), PER_MINUTE, '1 m').catch(() => ({ success: true }))
  if (!rl.success) return noContent()
  // The caller still gets its 204 — a counter never errors to a visitor — but a failing write is logged.
  await recordSignupPromptEvent(event).catch((e) => logError(e, { op: 'signup-prompt.count' }))
  return noContent()
}
