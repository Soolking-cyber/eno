import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/profile'
import { safeNextPath } from '@/lib/url'

// OAuth / magic-link callback — exchanges the code for a session, then redirects.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Same-origin guard — never redirect to an attacker-supplied external URL.
  const next = safeNextPath(searchParams.get('next'), origin)

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
            return NextResponse.redirect(`${origin}/onboard?next=${encodeURIComponent(next)}`)
          }
        } catch (e) { console.error('[auth] ensureProfile', e) }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
