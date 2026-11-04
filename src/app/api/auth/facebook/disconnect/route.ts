import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { confirmationValid, disconnectFacebookIdentity, FB_OK_COOKIE, readCookie } from '@/lib/auth/facebook-connect'
import { createSupabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Settings › Privacy › Facebook › Disconnect. It only ever removes THIS account's Facebook row, and refuses an account with no proved
// address to get back in by (auth.eno_disconnect_facebook). Every other session of the account ends with it.
//
// ⛔ THE SAME CODE AS CONNECT (commit gate, opus, 2026-11-04): ending every other session is a weapon in a stolen session's hands: it would
// sign the owner out and keep itself. Only the mailbox's owner can do this. getUser asks GoTrue, so a session already ended can't either.
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'fb-disconnect', limit: 10, window: '1 h', strict: true } }, async ({ req, userId }) => {
  const sb = await createSupabaseServer()
  const [{ data }, { data: live }] = await Promise.all([sb.auth.getClaims(), sb.auth.getUser()])
  const sessionId = data?.claims?.session_id
  if (live?.user?.id !== userId || typeof sessionId !== 'string' || !confirmationValid(readCookie(req, FB_OK_COOKIE), userId, sessionId, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: 'confirm_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  const outcome = await disconnectFacebookIdentity(userId, sessionId)
  if (outcome === 'only_way_in') return NextResponse.json({ error: 'only_way_in' }, { status: 409 })
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(FB_OK_COOKIE, '', { path: '/', maxAge: 0 })
  return res
})
