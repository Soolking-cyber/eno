import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { recordAndRead, HEARTBEAT_MS } from '@/lib/site-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The footer's live counters: total visitors, here now, members, sellers.
 *
 * ⛔ POST, NOT GET, AND THAT IS NOT PEDANTRY. This request WRITES — it records the caller in
 * site_presence and may increment the all-time total. A GET that mutates is the shape prefetchers,
 * link scanners and `<link rel=prerender>` fire speculatively, so the visitor count would be
 * inflated by software nobody is looking at. A POST is not sent speculatively by any of them.
 *
 * ⚠️ ALWAYS 200 WITH A BODY, INCLUDING WHEN THROTTLED. The caller is a footer widget; a 429 or a
 * 500 would put a red line in the console of every page on the site and tell the reader nothing.
 * Over the limit returns the shape with zeros, and the widget renders nothing for a zero — the
 * same thing it does before the first response lands, so a throttled visitor sees a footer that is
 * merely quiet rather than broken.
 *
 * ⚠️ THE LIMIT IS PER-IP AND HAS TO ALLOW A CROWD BEHIND ONE ADDRESS. A heartbeat is one call per
 * HEARTBEAT_MS per open tab; an office, a university or a mobile carrier NAT can put hundreds of
 * genuine visitors on one IP, and throttling them would under-report exactly the busy moments this
 * counter exists to show. 600/min is ~450 concurrent tabs on a single address.
 */
const PER_MINUTE = 600

export async function POST(req: NextRequest) {
  const zeros = { visits: 0, now: 0, members: 0, sellers: 0 }

  /**
   * ⛔ SAME-ORIGIN ONLY. This is an unauthenticated POST that writes, so without the check any
   * other site could put `fetch('https://eno.vn/api/site-stats', {method:'POST'})` on its own pages
   * and drive our public counter with its traffic — no CORS error stops the request from ARRIVING,
   * only from being read. A missing Origin is allowed: same-origin form/beacon posts and the
   * native shell legitimately omit it, and this endpoint holds nothing worth stealing.
   */
  const origin = req.headers.get('origin')
  if (origin) {
    let ok = false
    try { ok = new URL(origin).host === req.headers.get('host') } catch { ok = false }
    if (!ok) return NextResponse.json(zeros, { headers: { 'cache-control': 'no-store' } })
  }
  const ip = clientIp(req)
  const rl = await rateLimit('site-stats', ip, PER_MINUTE, '1 m').catch(() => ({ success: true }))
  if (!rl.success) return NextResponse.json(zeros, { headers: { 'cache-control': 'no-store' } })

  const stats = await recordAndRead(ip, req.headers.get('user-agent') || '')
  return NextResponse.json(stats, {
    // ⚠️ no-store, not a short max-age. Cloudflare caching this would serve one visitor's snapshot
    // to everyone AND swallow the heartbeats behind it, so "now" would freeze at whatever the first
    // caller saw while the presence table stopped being written to at all.
    headers: { 'cache-control': 'no-store', 'x-heartbeat-ms': String(HEARTBEAT_MS) },
  })
}
