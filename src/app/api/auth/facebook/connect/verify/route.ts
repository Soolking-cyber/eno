import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { connectCodeMatches, FB_CODE_COOKIE, FB_OK_COOKIE, FB_OK_TTL_SECONDS, readCookie, sealConfirmation } from '@/lib/auth/facebook-connect'
import { createSupabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// The code from the mail, for this user and this session: what Disconnect requires. ⛔ STRICT, BY ACCOUNT: six digits are guessable without this ceiling.
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'fb-connect-verify', limit: 10, window: '1 h', strict: true } }, async ({ req, userId }) => {
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const sb = await createSupabaseServer()
  const { data } = await sb.auth.getClaims()
  const sessionId = data?.claims?.session_id
  const now = Math.floor(Date.now() / 1000)
  if (typeof sessionId !== 'string' || !connectCodeMatches(readCookie(req, FB_CODE_COOKIE), code, userId, sessionId, now)) {
    return NextResponse.json({ error: 'bad_code' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(FB_CODE_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(FB_OK_COOKIE, sealConfirmation(userId, sessionId, now), {
    httpOnly: true, secure: canonicalAuthOrigin(req).startsWith('https://'), sameSite: 'lax', path: '/', maxAge: FB_OK_TTL_SECONDS,
  })
  return res
})
