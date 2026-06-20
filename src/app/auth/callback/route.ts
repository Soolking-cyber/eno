import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/profile'

// OAuth / magic-link callback — exchanges the code for a session, then redirects.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  if (code) {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Provision the app Profile on sign-in (idempotent; best-effort so a
      // transient DB hiccup never blocks login).
      if (data.user) { try { await ensureProfile(data.user) } catch (e) { console.error('[auth] ensureProfile', e) } }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
