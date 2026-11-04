import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { isAdminEmail } from '@/lib/admin'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { FB_CODE_COOKIE, FB_CODE_TTL_SECONDS, facebookConnectConfigured, facebookConnectionState, newConnectCode, sealConnectCode } from '@/lib/auth/facebook-connect'
import { facebookSignInEnabled } from '@/lib/auth/facebook'
import { renderFacebookDisconnectCodeEmail } from '@/lib/emails/facebook-disconnect-code'
import { logError } from '@/lib/log'
import { sendMail } from '@/lib/mail'
import { createSupabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Settings › Privacy › Facebook: GET says what the row shows; POST mails this account's own address the code Disconnect takes.
//
// ⛔ THE CONNECTION IS READ WHATEVER THE SWITCHES SAY (commit gate, codex): `on` only decides whether Connect is offered. Facebook being
// off, or its probe failing, must not hide Disconnect from someone the notice mail sent here.
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const configured = facebookConnectConfigured()
  // Off, not a 500, on a box whose script hasn't run yet (the tables it reads are the script's).
  const state = await facebookConnectionState(userId).catch((e: unknown) => {
    logError(e, { op: 'facebook-connect.state' })
    return null
  })
  if (!state) return NextResponse.json({ on: false, connected: false, canDisconnect: false }, { headers: { 'Cache-Control': 'no-store' } })
  const switchedOn = configured && (await facebookSignInEnabled().catch(() => false))
  // An operator gets no Connect that could only fail: Facebook is never their way in. Disconnect's code needs the secret to seal it.
  return NextResponse.json({ on: switchedOn && !isAdminEmail(state.email), connected: state.connected, canDisconnect: state.canDisconnect && configured }, { headers: { 'Cache-Control': 'no-store' } })
})

// ⛔ STRICT: this spends a mail per call. And only ever the signed-in account's own address: nothing in the request names one.
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'fb-connect-code', limit: 5, window: '1 h', strict: true } }, async ({ req, userId }) => {
  if (!facebookConnectConfigured()) throw new ApiError('not_found', 404)
  const sb = await createSupabaseServer()
  const [{ data: { user } }, { data: claims }] = await Promise.all([sb.auth.getUser(), sb.auth.getClaims()])
  const email = user?.email?.trim().toLowerCase()
  const sessionId = claims?.claims?.session_id
  if (!email || typeof sessionId !== 'string') return NextResponse.json({ error: 'no_email' }, { status: 400 })
  // Facebook is never an operator's way in, so an operator has nothing to disconnect: no code to mail.
  if (isAdminEmail(email)) throw new ApiError('forbidden', 403)

  const code = newConnectCode()
  const body = (await req.json().catch(() => null)) as { lang?: unknown } | null
  const lang = body?.lang === 'vi' ? 'vi' : 'en'
  if (!(await sendMail({ to: email, ...renderFacebookDisconnectCodeEmail({ code, origin: canonicalAuthOrigin(req), lang }) }))) throw new ApiError('send_failed', 502)

  const res = NextResponse.json({ ok: true, codeLength: code.length }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(FB_CODE_COOKIE, sealConnectCode(code, userId, sessionId, Math.floor(Date.now() / 1000)), {
    httpOnly: true, secure: canonicalAuthOrigin(req).startsWith('https://'), sameSite: 'lax', path: '/', maxAge: FB_CODE_TTL_SECONDS,
  })
  return res
})
