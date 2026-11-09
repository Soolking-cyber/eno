import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { requireTeacher } from '@/lib/classroom/guards'
import { readBytesCapped } from '@/lib/classroom/http'
import { MAX_RECORDING_BYTES, submitRecording } from '@/lib/classroom/own-voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The words heard (a few seconds), the clone, and a short wait for it to be ready (own-voice.ts READY_WAIT_MS).
export const maxDuration = 90

/**
 * POST /api/classroom/own-voice/recording?id=<attempt>&consent=<notice version>&own=1 — the teacher reading THEIR script:
 * the body is the WAV (PCM16 mono 24 kHz, 20–120 s). ⛔ Kept in this request's memory only (own-voice.ts). `own=1` is the
 * "this is my own voice" attestation; `consent` the notice version the page showed (409 notice_changed for any other).
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-voice-recording', limit: 10, window: '1 d' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const q = new URL(req.url).searchParams
  const id = q.get('id') ?? ''
  if (!id || id.length > 64) throw new ApiError('bad_request', 400)
  const wav = await readBytesCapped(req, MAX_RECORDING_BYTES)
  const voice = await submitRecording(teacher, id, new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength), { version: q.get('consent') ?? '', ownVoice: q.get('own') === '1' })
  return NextResponse.json({ voice }, { headers: { 'cache-control': 'private, no-store' } })
})
