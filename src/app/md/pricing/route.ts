import { NextResponse } from 'next/server'
import { IS_SERVICES } from '@/lib/edition'
import { POSTING_IS_FREE } from '@/lib/site-identity'
import { pricingMarkdown } from '@/lib/pricing-md'

// Rebuilt hourly, the same hour as its shared-cache lifetime below. Nothing here is per-visitor.
export const revalidate = 3600

/**
 * `/pricing.md` (rewritten here from that path, next.config.ts) — what using the marketplace costs, for an agent comparing
 * options (ora.ai pricing-md, 2026-11-16). Its structured twin is the Organization's `makesOffer` (marketplacePriceOffer in
 * src/lib/site-identity.ts).
 * ⛔ EVERY LINE IS A CLAUSE THAT ALREADY EXISTS — Operating Regulations Art. 8 (free for posting one's own listings, browsing
 * and contacting sellers; the partner service fee table; commissions from partners and linked shops; 20 days' notice) and
 * the Terms' fees section (creating an account). Nothing the legal copy does not price, such as the Partner API.
 * ⛔ MARKETPLACE ONLY, AND ONLY WHILE POSTING_IS_FREE: eno.forum sells paid services and makes no "free" claim (llms-txt.ts),
 * and the day a fee is announced this answers 404 until it is rewritten from the new clause — never a stale "free".
 */
export function GET() {
  if (IS_SERVICES || !POSTING_IS_FREE) {
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  return new NextResponse(pricingMarkdown(), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // An hour at the edge and no stale grace (commit gate, codex): nginx tags it `eno-public`, so the deploy that changes
      // a fee purges it; nothing may keep serving an old price list for days.
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  })
}
