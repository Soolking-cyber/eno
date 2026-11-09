import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { requireTeacher } from '@/lib/classroom/guards'
import { VOICE_NOTICE_VERSION } from '@/lib/classroom/notices'
import { deleteOwnVoice, issueScript, voiceOpenFor, voiceView } from '@/lib/classroom/own-voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * GET /api/classroom/own-voice — the teacher's own voice as it stands (own-voice.ts VoiceView): none, a script to read,
 * being checked or made (asking Soniox again while it is made), ready (with its sample), or failed and why. `open`: may this
 * teacher make one (staff until the legal amendment — OWN_VOICE_OPEN).
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  return NextResponse.json({ voice: await voiceView(teacher.id), open: await voiceOpenFor(profile.id), noticeVersion: VOICE_NOTICE_VERSION }, { headers: NO_STORE })
})

/** POST /api/classroom/own-voice — new sentences to read (replacing an unused script or a failed attempt). */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-voice-script', limit: 30, window: '1 d' } }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id)
  if (!(await voiceOpenFor(profile.id))) throw new ApiError('classroom_closed', 403)
  return NextResponse.json({ voice: await issueScript(teacher.id) }, { status: 201, headers: NO_STORE })
})

/**
 * DELETE /api/classroom/own-voice — "Delete my voice": the row now (every tutor back to its stock voice from its next reply),
 * Soniox at once (the sweep retries). Open always, to its own teacher — even with the classroom closed.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  await deleteOwnVoice(teacher.id, profile.id, 'teacher')
  return NextResponse.json({ voice: { status: 'none' } }, { headers: NO_STORE })
})
