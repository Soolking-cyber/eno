import { NextResponse } from 'next/server'
import { apiFail, route } from '@/lib/api/handler'
import { businessRailCards } from '@/lib/core/business-rail'
import { localizeListingTitles } from '@/lib/translate'
import { siteLangParam } from '@/lib/i18n/langs'

export const dynamic = 'force-dynamic'

/** The most ids one ask may carry: a home rail holds at most 12 (business-rail.ts takes 12 sellers); the rest are ignored. */
const MAX_IDS = 16
/** An id's shape (a cuid, or an imported row's slug-like id); junk is dropped before the read, never asked. */
const ID = /^[\w-]{1,64}$/

/**
 * GET /api/home/cards?rail=businesses&ids=a,b,c&lang=ko — the home page's rail cards that its first paint does not draw
 * (owner, 2026-11-17: the home page sends them as ids — src/lib/home-lanes.ts slimHomeRails). The rail asks for them when it
 * opens (business-rail.tsx). The category lanes' ids fill from their freshness check instead (/api/category-rails), so
 * `rail` has one value today; anything else is a 400.
 * ⛔ THE RAIL'S OWN PUBLIC PREDICATE (business-rail.ts businessRailCards): an id answers only while its listing is one the rail
 * could show; any other is missing from the answer, never an error. The asked order, deduped and capped at MAX_IDS.
 * ⛔ THE LANGUAGE FROM THE URL, NEVER THE COOKIE (siteLangParam): the answer is marked public, keyed by the URL alone — every
 * reader of one ISR snapshot asks the same ids — so a cookie-read variant would poison any shared entry (audit P2, as on
 * /api/category-rails). The card carries that one language's title translations, none for en/vi (the row has both).
 * ⚠️ THE EDGE DOES NOT CACHE IT (measured 2026-11-17: /api/category-rails and /api/businesses/top, the same headers, answer
 * `cf-cache-status: DYNAMIC`): only the browser keeps it (max-age), so every home visit that reaches the rail reaches this
 * route, from behind whatever address its carrier shares (CGNAT is the norm on Vietnamese mobile). Hence 300 a minute per
 * address, not /api/recommendations' 60: the read is at most MAX_IDS rows by primary key, cheaper than search-suggest's
 * (120/min), and /api/category-rails — a groupBy and ~10 reads, asked on the same visits — has no limit at all.
 */
export const GET = route({ auth: 'public', rateLimit: { bucket: 'home-cards', limit: 300, window: '1 m' } }, async ({ req }) => {
  const sp = new URL(req.url).searchParams
  if (sp.get('rail') !== 'businesses') return apiFail('bad_request', 400)
  const ids = [...new Set((sp.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => ID.test(s)))].slice(0, MAX_IDS)
  const cards = await localizeListingTitles(await businessRailCards(ids), siteLangParam(sp.get('lang')))
  return NextResponse.json(
    { cards },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
  )
})
