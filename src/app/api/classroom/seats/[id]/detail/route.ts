import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireAvatar, requireTeacher } from '@/lib/classroom/guards'
import { seatOfTeacher, settingsOf } from '@/lib/classroom/seats'
import { parseFocusItems } from '@/lib/classroom/focus'
import { parseFocus, pickPlan } from '@/lib/classroom/plans'
import { ageBand } from '@/lib/classroom/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/seats/<id>/detail — the teacher's page for one student: settings, "Working on", the NEXT session's
 * plan (the AI's draft or the teacher's own — editable), and the sessions with their headline numbers.
 */
export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const avatar = await requireAvatar(teacher.id)
  const seat = await seatOfTeacher(params.id, avatar.id)
  if (!seat || seat.status === 'removed') throw new ApiError('seat_not_found', 404)
  const now = new Date()
  const [learner, plans, sessions] = await Promise.all([
    seat.learnerId ? db.classroomLearner.findUnique({ where: { id: seat.learnerId }, select: { displayName: true, kind: true, birthYear: true } }) : null,
    db.classroomPlan.findMany({ where: { enrollmentId: seat.id, status: { not: 'used' } }, orderBy: { updatedAt: 'desc' }, take: 10 }),
    db.classroomSession.findMany({
      // The seat's learner's own sessions (report.ts's rule for the teacher).
      where: { enrollmentId: seat.id, learnerId: seat.learnerId },
      orderBy: { startedAt: 'desc' },
      take: 30,
      select: {
        id: true, startedAt: true, status: true, feedbackStatus: true, learnerSpeechMs: true, turnCount: true,
        feedback: { select: { scores: true, mistakes: true, teacherSeenAt: true, safetyFlag: true } },
      },
    }),
  ])
  const next = pickPlan(plans)
  return NextResponse.json({
    seat: {
      id: seat.id, status: seat.status, settings: settingsOf(seat),
      learner: learner && { displayName: learner.displayName, kind: learner.kind, band: ageBand(learner.kind === 'child' ? 'child' : 'self', learner.birthYear, now) },
      workingOn: parseFocusItems(seat.focusItems),
    },
    nextPlan: next && { id: next.id, source: next.source, status: next.status, brief: next.brief, focus: parseFocus(next.focus), openingLine: next.openingLine, updatedAt: next.updatedAt.toISOString() },
    sessions: sessions.map((s) => ({
      id: s.id, startedAt: s.startedAt.toISOString(), status: s.status, feedbackStatus: s.feedbackStatus,
      talkSeconds: Math.round(s.learnerSpeechMs / 1000), turns: s.turnCount,
      scores: s.feedback?.scores ?? null,
      mistakes: Array.isArray(s.feedback?.mistakes) ? (s.feedback!.mistakes as unknown[]).length : 0,
      unseen: s.feedbackStatus === 'ready' && !!s.feedback && !s.feedback.teacherSeenAt,
      flagged: !!s.feedback?.safetyFlag,
    })),
  }, { headers: { 'cache-control': 'private, no-store' } })
})
