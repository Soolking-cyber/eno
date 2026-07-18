import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

// Auth redirects must never be cached by any intermediary.
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))
  if (code) {
    const supabase = await createSupabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${url.origin}${next}`, { headers: NO_STORE })
  }
  return NextResponse.redirect(`${url.origin}/?auth_error=1`, { headers: NO_STORE })
}

