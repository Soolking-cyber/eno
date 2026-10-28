import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { conciergeOpenFor } from '@/lib/concierge/config'
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
  const open = await conciergeOpenFor(userId)
  // The opening's voice is made while the ✨ waits for its tap (Soniox speaks at about real time — start.ts), in the app's
  // language (?lang=).
  if (open) {
    warmOpening(spokenLanguage(new URL(req.url).searchParams.get('lang')))
    // The nine languages' lists compiled in the background (~2 s once per process), before anyone speaks.
    warmLanguageLists()
  }
  return NextResponse.json({ open, face: open ? conciergeFace() : null }, { headers: { 'cache-control': 'private, no-store' } })
})
