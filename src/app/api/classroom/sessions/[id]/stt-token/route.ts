import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { sttAllowed, sttGrant } from '@/lib/classroom/stt-grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/classroom/sessions/<id>/stt-token — a single-use Soniox key for ONE live-listening socket of a LIVE session
 * (src/lib/classroom/stt-grant.ts has the checks — the same as a turn, before any audio leaves). 200 { apiKey, url, model,
 * settings, languageHints }; any refusal → the page listens the old way.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-stt-token', limit: 60, window: '1 h' } }, async ({ profile, params }) =>
  NextResponse.json(await sttGrant(params.id, profile.id), { headers: { 'cache-control': 'private, no-store' } }))

/** GET — may the session still be heard live? 204, or the refusal (the page closes its socket). No key. */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-stt-check', limit: 120, window: '1 h' } }, async ({ profile, params }) => {
  await sttAllowed(params.id, profile.id)
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'private, no-store' } })
})
