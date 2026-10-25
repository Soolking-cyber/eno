import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import { requireAvatar, requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { seatOfTeacher } from '@/lib/classroom/seats'
import { cleanBrief, parseFocus, pickPlan } from '@/lib/classroom/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PUT /api/classroom/plans — the TEACHER's next-session plan for a seat (owner: "teacher can have a look and adjust the next
 * sessions prompt"): `{ seatId, brief, focus, openingLine, baseId?, baseUpdatedAt? }` (`baseId: null` = written from no plan). Saved as source teacher / approved,
 * so the AI never overwrites it (feedback.ts) and the next session runs on it.
 * ⛔ OPTIMISTIC: when the teacher edited a plan they saw (`baseId` + `baseUpdatedAt`), and that plan has changed or gone
 * meanwhile (a new report drafted another), the save is refused with plan_changed — the page reloads the newer draft
 * rather than silently replacing what the teacher never read.
 */
export const PUT = route({ auth: 'profile', rateLimit: { bucket: 'classroom-plan', limit: 120, window: '1 h' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const avatar = await requireAvatar(teacher.id)
  const body = await readCapped(req, 8_000)
  const seat = typeof body.seatId === 'string' ? await seatOfTeacher(body.seatId, avatar.id) : null
  if (!seat || seat.status === 'removed') throw new ApiError('seat_not_found', 404)
  const brief = cleanBrief(body.brief)
  if (!brief) throw new ApiError('bad_request', 400)
  const focus = parseFocus(body.focus)
  const openingLine = typeof body.openingLine === 'string' ? body.openingLine.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  for (const text of [brief, openingLine, ...focus.goals, ...focus.focusWords, ...focus.recycle, ...focus.drill]) {
    const code = teacherTextRefusal('bio', text)
    if (code) throw new ApiError(code, 400)
  }
  const now = new Date()
  const plan = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-plan:${seat.id}`}, 0))`
    const open = await tx.classroomPlan.findMany({ where: { enrollmentId: seat.id, status: { not: 'used' } }, orderBy: { updatedAt: 'desc' }, take: 10 })
    const current = pickPlan(open)
    if (typeof body.baseId === 'string') {
      const base = open.find((p) => p.id === body.baseId)
      if (!base || base.updatedAt.toISOString() !== body.baseUpdatedAt || current?.id !== base.id) throw new ApiError('plan_changed', 409)
    } else if (body.baseId === null && current) {
      // ⛔ `baseId: null` = "I started from NO plan" (C3c review, Opus): a plan that arrived since — an AI draft from a
      // report that landed while the teacher typed — is not silently replaced either.
      throw new ApiError('plan_changed', 409)
    }
    // One plan waits per seat: the teacher's replaces whatever was waiting (the AI's draft, or their own earlier edit).
    await tx.classroomPlan.deleteMany({ where: { enrollmentId: seat.id, status: { not: 'used' } } })
    return tx.classroomPlan.create({
      data: { enrollmentId: seat.id, source: 'teacher', status: 'approved', brief, focus, openingLine, fromSessionId: current?.fromSessionId ?? null, updatedAt: now },
    })
  })
  return NextResponse.json({ plan: { id: plan.id, source: plan.source, status: plan.status, brief: plan.brief, focus: parseFocus(plan.focus), openingLine: plan.openingLine, updatedAt: plan.updatedAt.toISOString() } }, { headers: { 'cache-control': 'private, no-store' } })
})
