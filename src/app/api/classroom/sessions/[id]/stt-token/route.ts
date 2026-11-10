import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { sttAllowed, sttGrant } from '@/lib/classroom/stt-grant'
import { logWarn } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/classroom/sessions/<id>/stt-token — a single-use Soniox key for ONE live-listening socket of a LIVE session
 * (src/lib/classroom/stt-grant.ts has the checks — the same as a turn, before any audio leaves). 200 { apiKey, url, model,
 * settings, languageHints }; any refusal → the page listens the old way.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-stt-token', limit: 60, window: '1 h' } }, async ({ req, profile, params }) => {
  // Why the page's last socket failed (live-stt.ts `x-live-why`) — codes only: the one place the server sees it.
  const why = req.headers.get('x-live-why')
  if (why && /^[\w .:/()-]{1,100}$/.test(why)) logWarn('[classroom] live listening opened again after a failure on the page', { why, device: deviceOf(req.headers.get('user-agent')) })
  return NextResponse.json(await sttGrant(params.id, profile.id), { headers: { 'cache-control': 'private, no-store' } })
})

/** The phone's system and browser, coarse ("iPhone OS 18_1 · Safari 18.1") — never the whole user agent. */
function deviceOf(ua: string | null): string {
  if (!ua) return ''
  const os = /(iPhone OS|CPU OS|Android|Mac OS X|Windows NT) ([\d._]+)/.exec(ua)
  const browser = /(CriOS|FxiOS|EdgiOS|Edg|Chrome|Firefox)\/(\d+)/.exec(ua) ?? /Version\/([\d.]+).*Safari/.exec(ua)
  const b = browser ? (browser.length > 2 ? `${browser[1]} ${browser[2]}` : `Safari ${browser[1]}`) : ''
  return [os ? `${os[1]} ${os[2]}` : '', b, /FBAN|FBAV|Zalo|Instagram/.test(ua) ? 'in-app' : ''].filter(Boolean).join(' · ').slice(0, 80)
}

/** GET — may the session still be heard live? 204, or the refusal (the page closes its socket). No key. */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-stt-check', limit: 120, window: '1 h' } }, async ({ profile, params }) => {
  await sttAllowed(params.id, profile.id)
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'private, no-store' } })
})
