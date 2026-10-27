import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { conciergeOpenFor } from '@/lib/concierge/config'
import { conciergeFace } from '@/lib/concierge/start'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/concierge/config — may this signed-in account open the voice concierge now? `{ open, face }`. The ✨ "Ask eno
 * AI" buttons open the concierge window when it is true and the text assistant (/messages/ai) otherwise; the window draws
 * `face` (ids only — no token, nothing billed) before its Start. Not rate limited: asked once, then when the tab returns.
 */
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const open = await conciergeOpenFor(userId)
  return NextResponse.json({ open, face: open ? conciergeFace() : null }, { headers: { 'cache-control': 'private, no-store' } })
})
