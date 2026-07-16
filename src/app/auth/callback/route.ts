import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/profile'
import { safeNextPath } from '@/lib/url'

// OAuth / magic-link callback — exchanges the code for a session, then redirects.
export async function GET(request: Request) {
  const url = new URL(request.url)
  // ⚠️ The redirect host MUST be the CANONICAL public origin, NOT `url.origin`. Behind Vercel /
  // Cloudflare, `request.url` can carry a *.vercel.app (or www / preview) host — and a Location on
  // THAT host does not carry the eno.vn-scoped session cookies `exchangeCodeForSession` just set,
  // so the browser lands logged-OUT and bounces through /signin → /onboard → … (and the /api/* edge
  // pin then 403s /api/me). In dev we keep the request origin so the round-trip stays on localhost.
  const origin =
    process.env.NODE_ENV === 'development'
      ? url.origin
      : new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin
  const code = url.searchParams.get('code')
  // Same-origin guard — never redirect to an attacker-supplied external URL.
  const next = safeNextPath(url.searchParams.get('next'), origin)

  // Never let a proxy/CDN cache an auth redirect (it carries Set-Cookie): a cached login response
  // would hand one user's session to the next, or serve a stale bounce.
  const redirect = (to: string) => {
    const res = NextResponse.redirect(to)
    res.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return res
  }

  if (code) {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Provision the app Profile on sign-in (idempotent; best-effort so a
      // transient DB hiccup never blocks login). New accounts that haven't picked
      // individual vs business are sent through the one-time onboarding first.
      if (data.user) {
        try {
          const profile = await ensureProfile(data.user)
          if (!profile.accountType) {
            return redirect(`${origin}/onboard?next=${encodeURIComponent(next)}`)
          }
        } catch (e) { console.error('[auth] ensureProfile', e) }
      }
      return redirect(`${origin}${next}`)
    }
  }
  return redirect(`${origin}/?auth_error=1`)
}
