import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { isBotRequest } from '@/lib/bot-ua'
import { logError } from '@/lib/log'
import { isRunningAd } from '@/lib/ads/serve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── POST /api/ads/[id]/event — <AdBeacons> counts an ad card seen (t=i: ≥ half on screen for a second) or tapped (t=c).
 * Counted ONLY while that ad runs (startsAt ≤ now < endsAt), so a cached card after its week adds nothing; at most once per
 * visitor IP per ad per kind per 10 minutes, and never for a known bot. These are the advertiser's figures, not a bill: the
 * price is flat. Always 204 (a beacon reads no answer).
 */
/** The first four groups of an IPv6 address, `::` expanded first, so every spelling of one /64 is one key. */
export function ipv6Prefix64(ip: string): string {
  const [head, tail] = ip.toLowerCase().split('%')[0]!.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':')
}

const NO_CONTENT = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[a-z0-9]{8,40}$/i.test(id) || isBotRequest(req)) return NO_CONTENT()
  let t = ''
  try {
    const kind = (JSON.parse((await req.text()).slice(0, 200)) as { t?: unknown } | null)?.t
    t = kind === 'c' || kind === 'i' ? kind : ''
  } catch {
    return NO_CONTENT()
  }
  if (!t || !(await isRunningAd(id))) return NO_CONTENT()
  // An IPv6 visitor is keyed by its /64 (one household or phone gets a whole /64, so per-address would be per-request).
  const ip = clientIp(req)
  const who = ip.includes(':') ? ipv6Prefix64(ip) : ip
  const limited = await rateLimit('ad-event', `${who}:${id}:${t}`, 1, '10 m')
  if (!limited.success) return NO_CONTENT()
  const now = new Date()
  await db.listingAd.updateMany({
    where: { id, status: 'active', startsAt: { lte: now }, endsAt: { gt: now } },
    data: t === 'i' ? { impressions: { increment: 1 } } : { clicks: { increment: 1 } },
  }).catch((e) => logError(e, { op: 'ads.event' }))
  return NO_CONTENT()
}
