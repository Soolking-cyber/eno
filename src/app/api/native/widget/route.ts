import { NextResponse } from 'next/server'
import { widgetFeed } from '@/lib/native-surfaces'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/native/widget?lang=en|vi — the iOS Home Screen widget's tiles ("New on eno", iOS 1.3; ios/App/EnoWidgets).
 *
 * ⚠️ SERVED, NOT BUILT IN SWIFT — the promo-slides reasoning (../promo-slides/route.ts): which listings, which photo and
 * how the price reads are the site's own rules (src/lib/native-surfaces.ts), so a fix reaches every installed widget on
 * the next refresh instead of the next App Store release. The widget only draws `{ items: [{ id, title, price, image }] }`.
 * Public data only — no cookie is read and the answer is the same for everyone, so it is marked public; the widget
 * asks for its language in the URL (`lang`, anything else is English).
 * ⛔ THIS ROUTE MUST BE LIVE BEFORE THE 1.3 BINARY SHIPS: the widget shows "Open eno to see what's new" until it answers.
 */
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  const feed = await widgetFeed()
  if (!feed) {
    return NextResponse.json(
      { items: [] },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    )
  }
  return NextResponse.json(
    { items: feed[lang] },
    // /feed.xml's headers: with the process's 30-minute ceiling, a taken-down listing leaves every answer within ~40 minutes.
    { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' } },
  )
}
