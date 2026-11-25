import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { isBotRequest } from '@/lib/bot-ua'
import { adEventState } from '@/lib/ads/serve'
import { recordAdEvent } from '@/lib/ads/stats'
import { rateKeyForIp } from '@/lib/ip-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── POST /api/ads/[id]/event — <AdBeacons> reports an ad card seen (t=i: a VIEWABLE impression, ≥ half on screen for a
 * second) or clicked (t=c: click or auxclick), with the browser session's id (s). Counted by src/lib/ads/stats.ts, to
 * industry standard: once per session per ad per kind per 30 minutes; known bots, prefetches and an ad not running now
 * counted as INVALID, never as valid; an id that is no ad at all counted as nothing. In memory, flushed every 10 s — no
 * row is written per event. These are the advertiser's figures, not a bill: the price is flat. Always 204.
 */
const NO_CONTENT = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

/** A prefetch or prerender asked for this, not a person (Sec-Purpose / Purpose / X-Moz / X-Purpose). */
function isPrefetch(req: NextRequest): boolean {
  const h = (k: string) => (req.headers.get(k) || '').toLowerCase()
  return /prefetch|prerender/.test(`${h('sec-purpose')} ${h('purpose')} ${h('x-moz')} ${h('x-purpose')}`)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return NO_CONTENT()
  let t: 'i' | 'c' | '' = ''
  let sid: string | null = null
  try {
    const body = JSON.parse((await req.text()).slice(0, 300)) as { t?: unknown; s?: unknown } | null
    t = body?.t === 'c' || body?.t === 'i' ? body.t : ''
    sid = typeof body?.s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.s) ? body.s : null
  } catch {
    return NO_CONTENT()
  }
  if (!t) return NO_CONTENT()
  const state = await adEventState(id)
  if (state === 'unknown') return NO_CONTENT()
  // An IPv6 visitor is keyed by its /64 (one household or phone gets a whole /64, so per-address would be per-request).
  recordAdEvent({ adId: id, kind: t, sid, ip: rateKeyForIp(clientIp(req)), givt: isBotRequest(req) || isPrefetch(req), running: state === 'running' })
  return NO_CONTENT()
}
