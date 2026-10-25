import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { readCapped } from '@/lib/classroom/http'
import { endSession } from '@/lib/classroom/session-end'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

/** POST /api/classroom/sessions/<id>/end — `{ reason: 'learner' | 'time' }`. Idempotent; the report follows (session-end.ts). */
export const POST = route({ auth: 'profile' }, async ({ req, profile, params }) => {
  const body = await readCapped(req, 200).catch(() => ({} as Record<string, unknown>))
  const result = await endSession(params.id, profile.id, body.reason === 'time' ? 'time' : 'learner')
  return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } })
})
