import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { conciergeOpenFor } from '@/lib/concierge/config'
import { isNativeAppUserAgent } from '@/lib/app-review-gates'
import { conciergeFace, warmOpening } from '@/lib/concierge/start'
import { spokenLanguage, warmLanguageLists } from '@/lib/concierge/i18n'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/concierge/config — may this signed-in account open the voice concierge now? `{ open, face }`. The ✨ "Ask eno
 * AI" buttons open the concierge window when it is true and the text assistant (/messages/ai) otherwise; the window draws
 * `face` (ids only — no token, nothing billed) before its Start. Not rate limited: asked once, then when the tab returns.
 */
export const GET = route({ auth: 'userId' }, async ({ userId, req }) => {
  const ua = req.headers.get('user-agent')
  const open = await conciergeOpenFor(userId, { ua })
  // The opening's voice is made while the ✨ waits for its tap (Soniox speaks at about real time — start.ts), in the app's
  // language (?lang=). Never for an app (commit review round 3, opus): there the person has not agreed yet when this is
  // asked — the opening is made at the session's start instead (start/route.ts openingAudio).
  if (open) {
    if (!isNativeAppUserAgent(ua)) warmOpening(spokenLanguage(new URL(req.url).searchParams.get('lang')))
    // The nine languages' lists compiled in the background (~2 s once per process), before anyone speaks — the apps too:
    // nothing leaves the box for them (commit review round 6, opus).
    warmLanguageLists()
  }
  return NextResponse.json({ open, face: open ? conciergeFace() : null }, { headers: { 'cache-control': 'private, no-store' } })
})
