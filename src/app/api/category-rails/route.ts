import { NextResponse } from 'next/server'
import { siteLangParam } from '@/lib/i18n/langs'
import { route } from '@/lib/api/handler'
import { homeCategoryRails } from '@/lib/core/category-rails'

export const runtime = 'nodejs'

// Home page "browse by category" rails — the body lives in src/lib/core/category-rails.ts since 2026-11-14 (owner-approved,
// cook r04 home-b): the home page reads the same function into its ISR document, so its lanes are server-rendered. Its one
// in-app caller is the home lanes' freshness check: the server's lanes are checked against this once their cards are
// drawn, and the cards this no longer carries leave (category-rails.tsx useFreshCategoryLanes) — which is why the
// Cache-Control below stays short. It also answers any page served before the move. Public, lightly cached.

// ⚠️ WS6 MIGRATION. `auth: 'public'` — the home page calls this logged-out; there was never an auth
// preamble and adding one would 401 every guest. No rate limit and no body were added either: this
// route had neither, and the wrapper must not invent policy.
//
// ⚠️ THE ONE ACCEPTED WIRE CHANGE IS ON THE FAILURE PATH, AND IT MATTERS MORE HERE THAN ELSEWHERE.
// Nothing in this handler was wrapped — the groupBy, the category read, N per-rail findMany calls
// inside Promise.all, and localizeListingTitles could each throw, and `scopedListingWhere()` throws
// DeskResolutionError by design. All of those used to surface as Next's default 500; they now
// answer `{"error":"internal_error"}` 500, logged with an `op`. Never the exception text.
//
// The success body returns as a NextResponse because the Cache-Control header is the point of the
// route; route()'s plain-object path would drop it.
export const GET = route({ auth: 'public' }, async ({ req }) => {
  // ⛔ THE READER'S LANGUAGE COMES FROM THE URL, NEVER THE COOKIE: this answer is `public, s-maxage`, so a
  // cookie-read variant would poison the shared entry with whichever language came first (audit P2, as on
  // the feed — feed-payload.ts). With `lang` the answer carries that one language's titles, and none for
  // en/vi (the row has both). Without it, every language. Only a site language counts; anything else is no
  // `lang` (siteLangParam, src/lib/i18n/langs.ts).
  const rails = await homeCategoryRails(siteLangParam(new URL(req.url).searchParams.get('lang')))
  return NextResponse.json(
    { rails },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
  )
})
