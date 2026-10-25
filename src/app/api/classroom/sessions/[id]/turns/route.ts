import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { readBytesCapped } from '@/lib/classroom/http'
import { processTurn } from '@/lib/classroom/session-turn'
import { LIMITS } from '@/lib/classroom/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 40

/**
 * POST /api/classroom/sessions/<id>/turns — one learner turn: the body is the WAV itself (16 kHz mono PCM16, ≤ 45 s —
 * wav.ts), the client's idempotency key in `x-turn-id`. Answers the transcript, the avatar's reply with its voice (base64
 * MP3), the hint, and the time left — or `{ kind: 'silence' }`. ⛔ The audio is never stored (session-turn.ts).
 * The per-account limit sits above a session's own cap (80 turns): a stuck client cannot hammer the speech services.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-turn', limit: 240, window: '1 h' } }, async ({ req, profile, params }) => {
  const wav = await readBytesCapped(req, LIMITS.turnBytes)
  const result = await processTurn(params.id, profile.id, req.headers.get('x-turn-id') ?? '', wav)
  return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } })
})
