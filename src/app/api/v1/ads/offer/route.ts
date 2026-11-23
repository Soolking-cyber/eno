import { NextResponse } from 'next/server'
import { x402Config } from '@/lib/x402/config'
import { adOffer } from '@/lib/ads/offer'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/v1/ads/offer — the public ad offer (price in USDC with the đồng reference, duration, placements, how to buy,
 *  public audience figures). No credential: it is what an agent weighs before it signs in or pays. */
export async function GET() {
  try {
    return NextResponse.json(await adOffer(x402Config()), { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } })
  } catch (e) {
    logError(e, { op: 'ads.offer' })
    return NextResponse.json({ error: { code: 'unavailable', message: 'The offer is not available right now.' } }, { status: 503 })
  }
}
