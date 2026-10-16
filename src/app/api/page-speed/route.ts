import { NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { isProductionEnoHost } from '@/lib/consent-value'
import { isBotUserAgent } from '@/lib/bot-ua'
import { EDITION } from '@/lib/edition'
import { vnDay } from '@/lib/signup-prompt'
import { rumOps } from '@/lib/rum/ops'
import { allowBeacon, limiterKey, recordRumOps } from '@/lib/rum/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/page-speed — one page view's load and response times, as +1s on today's bucket totals (speed plan item 5,
 * 2026-10-16). The browser half is src/lib/rum/early.ts; what a beacon may say is src/lib/rum/shared.ts; what it may
 * add is src/lib/rum/ops.ts; how the totals reach Postgres is src/lib/rum/store.ts. /privacy: "Page speed measurements".
 *
 * ⚠️ ALWAYS A BODYLESS 204, whatever happens. It is a beacon; nothing reads the reply.
 *
 * ⛔ ONLY THE LIVE SITES COUNT — /api/signup-prompt's rule, for its reason: a local `preview:vn` is a production build
 * wired to the PRODUCTION database, so an operator clicking around locally would count as real visitors.
 *
 * ⛔ SAME-ORIGIN, NOT A CRAWLER, RATE-LIMITED — and stricter than signup-prompt in two ways (plan review, 2026-10-16):
 *   · an Origin header is REQUIRED (every browser sends one on a POST; a client without one is not a page);
 *   · the limit lives in memory (store.ts allowBeacon), so a beacon costs the database nothing at all — at one beacon
 *     per page view a Postgres limiter would have added a query to every page view.
 * Anyone can still POST here, so the totals are forgeable within these limits: a tuning signal, not a number to pay
 * or report on.
 */
/**
 * 120, not signup-prompt's 60: a Vietnamese carrier's CGNAT puts many phones behind one address, and a limit sized for
 * one visitor would quietly drop exactly the mobile views this measures (commit-gate review, opus).
 */
const PER_MINUTE = 120
const MAX_BODY_BYTES = 1024
const noContent = () => new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production' || !isProductionEnoHost(req.headers.get('host'))) return noContent()
  const origin = req.headers.get('origin')
  let sameOrigin = false
  // The scheme too (commit-gate review, codex): the sites are https-only, so an http:// Origin is another origin.
  try {
    const o = origin ? new URL(origin) : null
    sameOrigin = !!o && o.protocol === 'https:' && o.host === req.headers.get('host')
  } catch { sameOrigin = false }
  if (!sameOrigin) return noContent()
  if (isBotUserAgent(req.headers.get('user-agent') || '')) return noContent()
  // ⛔ A DECLARED LENGTH IS REQUIRED, not just capped (commit-gate review, opus): a chunked POST has none, and
  // req.text() would buffer whatever it sends before any check below. sendBeacon and fetch(keepalive) always declare
  // one, and Node never reads past it.
  const declared = Number(req.headers.get('content-length'))
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BODY_BYTES) return noContent()
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return noContent()
    body = JSON.parse(text)
  } catch { return noContent() }
  const ops = rumOps(body)
  if (!ops || ops.length === 0) return noContent()
  if (!allowBeacon(limiterKey(clientIp(req)), PER_MINUTE)) return noContent()
  recordRumOps(vnDay(Date.now()), EDITION, ops)
  return noContent()
}
