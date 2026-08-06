import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'

// Live FX rates (currency per 1 VND), for display-currency conversion. Cached hard
// (rates barely move intraday) — the upstream fetch uses the data cache (6h) and the
// success response is CDN-cached, so clients almost always hit cache. Free, no API key.
// Deliberately NOT route-level `revalidate`: that would also cache the empty-rates
// failure fallback for 6h. force-dynamic lets the failure path stay uncached.
export const dynamic = 'force-dynamic'

// ⚠️ WS6 MIGRATION, AND HERE THE WRAPPER IS HONESTLY A NO-OP — adopted for uniformity, not for a
// fix. `auth: 'public'` (display currency is shown to guests), no rate limit, no body. Every path
// is already inside the total try/catch below, so route()'s error boundary is unreachable and this
// route is byte-identical on the wire on ALL branches, failure included. There is no accepted wire
// change to declare.
//
// ⚠️ THE TWO CACHE HEADERS ARE THE CONTRACT AND BOTH ARE RETURNED AS `NextResponse`s: the success
// path is CDN-cached for hours, the fallback is `no-store`. Returning a plain object on either
// would drop its header and let the CDN pin the empty-rates fallback — exactly the failure this
// file's `force-dynamic` comment exists to prevent.
export const GET = route({ auth: 'public' }, async () => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/VND', { next: { revalidate: 21600 } })
    const d = await res.json()
    if (d?.result !== 'success' || !d?.rates) throw new Error('fx_unavailable')
    return NextResponse.json(
      { base: 'VND', rates: d.rates as Record<string, number>, updated: d.time_last_update_unix ?? 0 },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400' } },
    )
  } catch {
    // Fail soft — the client falls back to showing VND when rates are empty. Never cached.
    return NextResponse.json({ base: 'VND', rates: {}, updated: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  }
})
