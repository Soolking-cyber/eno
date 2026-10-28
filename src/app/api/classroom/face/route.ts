import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { facePreview, warmOpening } from '@/lib/classroom/session-start'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/face?seatId=<seat> | ?test=1 — the 3D face a Start would give, BEFORE it: the session screen draws it
 * while its intro is up, so Start only connects it and the face and the voice begin together (owner, 2026-10-26). The
 * start's own rules (session-start.ts facePreview); `{ face: null }` = voice-only, and the page loads nothing from Spatius.
 * ⛔ Ids only, never a token: no Spatius session exists until Start (api/classroom/sessions/<id>/token).
 */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-face', limit: 120, window: '1 h' } }, async ({ profile, req }) => {
  const q = new URL(req.url).searchParams
  const seatId = q.get('seatId')
  const test = q.get('test') === '1'
  if (!test && !seatId) throw new ApiError('bad_request', 400)
  const target = test ? { test: true as const } : { seatId: seatId! }
  // While the intro is up, the opening line is made ahead on Soniox (it speaks at about real time) — not awaited.
  void warmOpening(profile.id, target)
  const face = await facePreview(profile.id, target)
  return NextResponse.json({ face }, { headers: { 'cache-control': 'private, no-store' } })
})
