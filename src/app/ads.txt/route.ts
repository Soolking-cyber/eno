import { NextResponse } from 'next/server'
import { IS_SERVICES } from '@/lib/edition'

/**
 * /ads.txt — the sellers allowed to sell ads on eno.vn (IAB Tech Lab ads.txt 1.1). Owner, 2026-11-27: "help to configure
 * adsense" (AdSense account pub-8024177228787683, site eno.vn). Google's own line, verbatim from AdSense's "ads.txt
 * snippet": the exchange, the publisher id, DIRECT (the owner runs the account), and Google's certification-authority id.
 * Together with the `google-adsense-account` tag ([lang]/layout.tsx) this is the ownership proof AdSense's site review
 * reads; it loads NO ad script (the CSP still refuses AdSense's hosts — showing ads is a separate, owner-decided step).
 * ⛔ eno.vn ONLY, by ROUTE not public/ (robots.txt's note: anything in public/ ships on every edition): the account names
 * eno.vn, and a services build answers 404.
 */
export const dynamic = 'force-static'

export const ADSENSE_PUBLISHER = 'pub-8024177228787683'
export const ADS_TXT = `google.com, ${ADSENSE_PUBLISHER}, DIRECT, f08c47fec0942fa0\n`

export function GET() {
  if (IS_SERVICES) return new NextResponse('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new NextResponse(ADS_TXT, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  })
}
