import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { linkedinSignInEnabled } from '@/lib/auth/linkedin'
import { appendAudit } from '@/lib/compliance/audit'
import { db } from '@/lib/db'
import { EDITION } from '@/lib/edition'
import { LINKEDIN_CONSENT_COOKIE, LINKEDIN_PROVIDER } from '@/lib/linkedin-signin'
import { logWarn } from '@/lib/log'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { createSupabaseServer } from '@/lib/supabase/server'
import { LINKEDIN_NOTICE_PARTS, LINKEDIN_NOTICE_VERSION, noticeBody } from '@/lib/teachers/import-notice'
import { safeNextPath } from '@/lib/url'
import { isTeacherHost } from '@/lib/teachers/host'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOTICE_SHA = createHash('sha256').update(noticeBody(LINKEDIN_NOTICE_PARTS)).digest('hex').slice(0, 16)

/**
 * BEGIN "SIGN IN WITH LINKEDIN" (owner, 2026-10-15) — GoTrue's `linkedin_oidc` redirect provider, started on the SERVER so
 * a link on teacher.eno.vn (no session there) can begin it: the PKCE verifier lands on THIS host (the cookie adapter),
 * where /auth/callback exchanges the code. Every button passes the version of the LinkedIn notice it stood beside.
 *
 * ⛔ EVERY REFUSAL GOES BACK TO `next` WITH A REASON, NEVER TO AN ERROR PAGE:
 *   · `n` is not the notice in force → li=notice (the visitor never saw today's words — LinkedIn API Terms 5.2);
 *   · LinkedIn is off in GoTrue → li=off;
 *   · a cross-site navigation (Sec-Fetch-Site) → li=off: LinkedIn skips its consent screen for a member who already
 *     allowed eno, so any page could otherwise sign a visitor in silently;
 *   · ALREADY SIGNED IN on this host → li=signed_in: a second sign-in would REPLACE the session, and a LinkedIn email
 *     other than the account's makes a new, empty account (auth review, 2026-10-15). The teacher host cannot see the
 *     session, so its button can lead here for someone who is signed in — they just land back, signed in.
 */
/**
 * The teacher pages — the join form (on either host) and the edit page, on THIS site — are the only ones with a LinkedIn
 * button. This site sends a Referer on its own navigations (strict-origin-when-cross-origin, next.config.ts), so one
 * missing while the browser sends Fetch Metadata was suppressed on purpose (a `noreferrer` link): refused. Only a browser
 * that sends neither (an old one) is let through without it.
 */
function fromNoticePage(request: Request, origin: string): boolean {
  const referer = request.headers.get('referer')
  if (!referer) return !request.headers.has('sec-fetch-site')
  try {
    const r = new URL(referer)
    if (isTeacherHost(r.host, process.env.NEXT_PUBLIC_APP_URL)) return true
    return (r.origin === origin || r.host === request.headers.get('host')) && /^\/teachers\/(?:join|edit)\/?$/.test(r.pathname)
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = canonicalAuthOrigin(request)
  const next = safeNextPath(url.searchParams.get('next'), origin)
  const back = (li: string) => {
    const to = new URL(next, origin)
    to.searchParams.set('li', li)
    if (li !== 'signed_in') to.searchParams.delete('import')
    return NextResponse.redirect(`${origin}${to.pathname}${to.search}`, { headers: { 'cache-control': 'private, no-store' } })
  }

  if (request.headers.get('sec-fetch-site') === 'cross-site') return back('off')
  if (url.searchParams.get('n') !== LINKEDIN_NOTICE_VERSION) return back('notice')
  // ⛔ ONLY FROM A PAGE THAT SHOWS THE NOTICE (gate review, 2026-10-16): `n` is public, so a link planted elsewhere on the
  // site (a chat message) could start a sign-in whose consent row says the notice was read. The teacher pages are where
  // the LinkedIn buttons are (src/lib/linkedin-flag.ts); a browser that sends no Referer is let through.
  if (!fromNoticePage(request, origin)) return back('notice')
  if (!(await linkedinSignInEnabled())) return back('off')

  const supabase = await createSupabaseServer()
  const { data: current } = await supabase.auth.getSession()
  if (current.session) return back('signed_in')
  // ⛔ An unauthenticated GET that writes a compliance row: bounded per connection before the write (gate review,
  // 2026-10-16) — a person signs in a few times, a script hundreds.
  if (!(await rateLimit('linkedin-start', clientIp(request), 20, '10 m')).success) return back('failed')

  // ⛔ THE CONSENT RECORD BEFORE THE REDIRECT (LinkedIn API Terms 5.2; PDP Law 91 Art 9): who it is is not known yet, so
  // the row names a random id, and the callback links that id to the account (auth.linkedin.consent.linked).
  const consentId = randomUUID()
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '1000ms', true)`
      await appendAudit(tx, {
        actorType: 'user', actorId: null, action: 'auth.linkedin.consent', subjectType: 'consent', subjectId: consentId,
        detail: { notice: LINKEDIN_NOTICE_VERSION, noticeSha: NOTICE_SHA, host: request.headers.get('host') ?? '', edition: EDITION, scopes: 'openid profile email' },
      })
    }, { maxWait: 1_000 })
  } catch (e) {
    logWarn('[linkedin] consent record failed', { name: (e as Error)?.name })
    return back('failed')
  }

  // ⛔ ABANDONED FLOWS' VERIFIERS GO FIRST (src/lib/auth-pkce.ts, the client's rule, measured 2026-08-18): they pile up
  // forever and the legacy key disagrees with them ("code challenge does not match previously saved code verifier").
  // Cleared here, immediately before this flow writes its own, through the same store the cookie adapter writes to.
  try {
    const store = await cookies()
    for (const c of store.getAll()) if (/^sb-.*-code-verifier$/.test(c.name)) store.delete(c.name)
  } catch { /* no request scope (tests): nothing to clear */ }

  const redirectTo = new URL('/auth/callback', origin)
  redirectTo.searchParams.set('next', next)
  redirectTo.searchParams.set('p', 'linkedin')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: LINKEDIN_PROVIDER,
    options: {
      redirectTo: redirectTo.toString(),
      skipBrowserRedirect: true,
      // LinkedIn's own Google / Apple / passkey sign-in on iOS Safari too (documented; GoTrue passes it through).
      queryParams: { enable_extended_login: 'true' },
    },
  })
  if (error || !data?.url) {
    logWarn('[linkedin] authorize url failed', { status: error?.status })
    return back('failed')
  }
  const res = NextResponse.redirect(data.url, { headers: { 'cache-control': 'private, no-store' } })
  res.cookies.set(LINKEDIN_CONSENT_COOKIE, consentId, {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  })
  return res
}
