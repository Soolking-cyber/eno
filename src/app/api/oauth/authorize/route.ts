import { NextResponse } from 'next/server'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { approve, consumeConsent, CONSENT_TTL_SECONDS, releaseConsent, eligibleShop, loadClient, openConsentTicket, redirectMatches, verifiedProfileId } from '@/lib/api/oauth-grant'
import { kv, rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/oauth/authorize — the consent form's answer (src/app/[lang]/oauth/authorize/page.tsx).
 *
 * ⛔ EVERY CHECK AGAIN, ON THIS REQUEST: same origin (a form from another site never reaches the grant), the sealed
 * ticket (the exact request that was shown, unexpired), the person CONFIRMED by the auth server and equal to the one the
 * ticket was issued to, and the shop still theirs. Only then a pending grant + a 60-second code go back to the app's
 * proven return address (303, so the browser follows with a GET). A refusal goes back as error=access_denied.
 */
/**
 * ⛔ NOT A 303. The site's CSP says `form-action 'self'`, and Chrome applies form-action to the redirects that follow a
 * form submission — a 303 to claude.ai would be blocked and "Allow" would do nothing (review 2026-11-13). The answer is a
 * tiny page that sends the browser on with a meta refresh (and a link, if refresh is off), which form-action does not
 * govern. The address is HTML-escaped; no script, nothing cached, no Referer carried to the app.
 */
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const forwardUrl = (redirectUri: string, params: Record<string, string>) => {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v)
  u.searchParams.set('iss', OAUTH_ISSUER)
  return u.toString()
}
const back = (redirectUri: string, params: Record<string, string>) => forwardPage(forwardUrl(redirectUri, params))
const forwardPage = (url: string) => {
  const to = escapeHtml(url)
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${to}"><title>eno</title></head><body><p><a href="${to}">Continue · Tiếp tục</a></p></body></html>`
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
/** A refusal, in both languages (the rule for every user-facing string; this one is plain text, not a page). */
const stop = (status: number, en: string, vi: string) => new NextResponse(`${en}\n\n${vi}`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function POST(req: Request) {
  // Same origin: this deployment's own site address, or the address the request itself arrived on (www vs apex, a local
  // preview) — never another site.
  const origin = req.headers.get('origin')
  if (!origin || (origin !== new URL(OAUTH_ISSUER).origin && origin !== new URL(req.url).origin)) return stop(403, 'Cross-site request refused.', 'Yêu cầu từ trang khác bị từ chối.')
  let form: FormData
  try { form = await req.formData() } catch { return stop(400, 'Bad request.', 'Yêu cầu không hợp lệ.') }

  const profileId = await verifiedProfileId()
  if (!profileId) return stop(401, 'Sign in again, then start the connection again from the app.', 'Hãy đăng nhập lại, rồi bắt đầu kết nối lại từ ứng dụng.')
  const rl = await rateLimit('oauth-consent', profileId, 20, '1 m')
  if (!rl.success) return stop(429, 'Too many attempts. Wait a minute.', 'Quá nhiều lần thử. Hãy đợi một phút.')

  // The pressed button names the decision and carries the value (page.tsx): `allow` / `deny` the sealed ticket, or
  // `cancel` the request of a person with no shop, whose return address is proven afresh.
  const cancel = form.get('cancel')
  if (typeof cancel === 'string') {
    const c = new URLSearchParams(cancel)
    const redirectUri = c.get('redirect_uri') || ''
    const client = await loadClient(c.get('client_id') || '')
    if (!client || !redirectMatches(client.redirectUris, redirectUri)) return stop(400, 'Bad request.', 'Yêu cầu không hợp lệ.')
    return back(redirectUri, { error: 'access_denied', state: c.get('state') || '' })
  }
  const allow = form.get('allow'), deny = form.get('deny')
  const sealed = typeof allow === 'string' ? allow : typeof deny === 'string' ? deny : ''
  const now = Math.floor(Date.now() / 1000)
  const t = openConsentTicket(sealed, now)
  if (!t) return stop(400, 'This sign-in expired. Start the connection again from the app.', 'Phiên đăng nhập này đã hết hạn. Hãy bắt đầu kết nối lại từ ứng dụng.')
  if (t.pid !== profileId) return stop(403, 'This sign-in was started by another account.', 'Phiên đăng nhập này được bắt đầu bởi một tài khoản khác.')
  // ⛔ A DOUBLE-CLICK GETS THE FIRST PRESS'S ANSWER, not a dead end (review 2026-11-13): the browser shows only the LAST
  // navigation, so a 409 for the second press would hide the first press's code. The answer is kept per consent screen
  // and shown again — only to this same signed-in person with this same ticket (checked above). The second press may
  // arrive while the first is still creating the grant, so it waits up to 3 s for that answer.
  const answerKey = `oauth:consent-answer:${t.nonce}`
  const answered = async () => {
    for (let i = 0; i < 15; i++) {
      const url = await kv.get<string>(answerKey).catch(() => null)
      if (url) return forwardPage(url)
      await new Promise((r) => setTimeout(r, 200))
    }
    return stop(409, 'This sign-in was already answered. Start again from the app if you need to.', 'Phiên đăng nhập này đã được trả lời. Hãy bắt đầu lại từ ứng dụng nếu cần.')
  }
  const answer = async (url: string) => {
    await kv.set(answerKey, url, { ex: CONSENT_TTL_SECONDS + 60 }).catch((e) => logError(e, { op: 'oauth.consentAnswer' }))
    return forwardPage(url)
  }
  if (typeof allow !== 'string') {
    // One answer per consent screen: a Cancel cannot later turn into an Allow (review).
    if (!(await consumeConsent(t))) return answered()
    return answer(forwardUrl(t.redirectUri, { error: 'access_denied', state: t.state }))
  }
  const elig = await eligibleShop(profileId)
  if (!elig.ok || !t.sellers.includes(elig.shop.id)) return stop(403, 'This shop can no longer be connected.', 'Không thể kết nối cửa hàng này nữa.')
  const client = await loadClient(t.clientId)
  if (!client || !redirectMatches(client.redirectUris, t.redirectUri)) return stop(400, 'The app could not be confirmed. Start again from the app.', 'Không xác nhận được ứng dụng. Hãy bắt đầu lại từ ứng dụng.')
  // Consumed only now, right before the grant: a check that fails above (a metadata blip) leaves the screen usable.
  if (!(await consumeConsent(t))) return answered()
  // A failure on our side made no grant: the screen is freed, so pressing Allow again works once we recover.
  const unavailable = async () => { await releaseConsent(t); return stop(503, 'Sign-in is temporarily unavailable. Press Allow again in a moment.', 'Đăng nhập tạm thời không khả dụng. Hãy bấm Cho phép lại sau giây lát.') }
  try {
    const code = await approve(t, elig.shop.id, client.name, now)
    if (!code) return unavailable()
    return answer(forwardUrl(t.redirectUri, { code, state: t.state }))
  } catch (e) {
    logError(e, { op: 'oauth.approve' })
    return unavailable()
  }
}
