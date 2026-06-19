import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

// OAuth / magic-link callback — exchanges the code for a session, then redirects.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  if (code) {
    const supabase = await createSupabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
