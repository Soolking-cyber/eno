import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { facebookSignInEnabled } from '@/lib/auth/facebook'

export const dynamic = 'force-dynamic'

/**
 * Which OPTIONAL sign-in providers GoTrue has switched on — today only Facebook (src/lib/facebook-signin.ts) — for a
 * sign-in form on a page the server did not seed (src/lib/facebook-flag.ts). The answer is GoTrue's own settings, read
 * by the server (src/lib/auth/facebook.ts: 10 minutes, a failure 60 s), so the browser never needs the API key or a
 * cross-origin preflight. Public: the same fact /auth/v1/settings tells anyone. `max-age=60`: a tab asks at most every
 * 5 minutes anyway (facebook-flag.ts), so a provider switched on or off reaches open tabs within ~15 minutes (this, the
 * server's 10-minute probe, the tab's 5); never on the CDN (`private`), so a probe that failed for 60 s is never pinned at
 * the edge.
 */
export const GET = route({ auth: 'public' }, async () => {
  const facebook = await facebookSignInEnabled().catch(() => false)
  return NextResponse.json({ facebook }, { headers: { 'Cache-Control': 'private, max-age=60' } })
})
