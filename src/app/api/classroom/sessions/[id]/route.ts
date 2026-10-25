import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { readCapped } from '@/lib/classroom/http'
import { reportFor, sessionForViewer } from '@/lib/classroom/report'
import { cleanText } from '@/lib/classroom/persona'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * GET /api/classroom/sessions/<id> — the session's report and transcript, as THIS viewer may see it (report.ts). Reading a
 * ready report marks it seen for that side (the roster's "new report" dot).
 */
export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const { s, viewer } = await sessionForViewer(params.id, profile.id)
  if (s.feedback && s.feedbackStatus === 'ready') {
    const now = new Date()
    if (viewer === 'teacher' && !s.feedback.teacherSeenAt) await db.classroomFeedback.update({ where: { sessionId: s.id }, data: { teacherSeenAt: now } })
    if (viewer === 'learner' && !s.feedback.learnerSeenAt) await db.classroomFeedback.update({ where: { sessionId: s.id }, data: { learnerSeenAt: now } })
  }
  return NextResponse.json({ viewer, report: reportFor(s, viewer) }, { headers: NO_STORE })
})

/** PATCH /api/classroom/sessions/<id> — `{ teacherNote }`: the teacher's private note on the report. Never shown to the learner. */
export const PATCH = route({ auth: 'profile', rateLimit: { bucket: 'classroom-note', limit: 300, window: '1 h' } }, async ({ req, profile, params }) => {
  const { s, viewer } = await sessionForViewer(params.id, profile.id)
  if (viewer !== 'teacher' || !s.feedback) throw new ApiError('session_not_found', 404)
  const body = await readCapped(req, 6_000)
  const teacherNote = cleanText(body.teacherNote, 2_000)
  await db.classroomFeedback.update({ where: { sessionId: s.id }, data: { teacherNote, updatedAt: new Date() } })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
})
