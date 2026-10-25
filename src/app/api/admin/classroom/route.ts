import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { sendMail } from '@/lib/mail'
import { renderBrandEmail } from '@/lib/emails/layout'
import { classroomSweepIsFresh, resetClassroomConfigCache } from '@/lib/classroom/config'
import { buildFeedback } from '@/lib/classroom/feedback'
import { TEACHER_SURFACE_ORIGIN } from '@/lib/teachers/surface'
import { budgetUse } from '@/lib/classroom/budget'
import { markLikenessDeleted, pendingLikenessDeletions } from '@/lib/classroom/likeness'
import { libraryAvatarById } from '@/lib/classroom/library-avatars'

export const runtime = 'nodejs'
// "Retry the report" builds it inside the request (2c round 2, opus): the model's own deadlines fit well inside this.
export const maxDuration = 120
export const dynamic = 'force-dynamic'

// ── ADMIN: eno CLASSROOM (plan "Files › /admin/classroom") ──────────────────────────────────────────────────────────
//
// GET → the switch (mode, pilot teachers by email, minute caps, Spatius-for-children), this month's use and cost, and the
//       three queues: photo likenesses to make (or to delete at Spatius), reports that failed, sessions with a safety flag.
// PUT { mode, cohortEmails?, dayMinutes?, monthMinutes?, teacherMonthMinutes?, spatiusChildrenOk? } — the switch, the calls
//       admin's shape (src/app/api/admin/calls): ⛔ never anything but 'off' unless the sweep is running (config.ts).
// POST { action } — 'likeness-ready' (the Spatius id pasted after making it in Studio; the teacher is emailed),
//       'likeness-deleted' (ticked off once deleted in Spatius Studio — src/lib/classroom/likeness.ts), 'retry-report'.
// Admin chrome is English-only by convention.

const putBody = z.strictObject({
  // ⛔ OPTIONAL, and sent ONLY by the mode control (2c round 2, codex): a cap or cohort save from a stale tab must never
  // re-send that tab's old mode — it could reopen a classroom another admin just switched off.
  mode: z.enum(['off', 'staff', 'allowlist', 'all']).optional(),
  // An email — or an account id: the box shows the id of a teacher whose account has no email (2c round 3, opus), and
  // saving it back must keep that teacher, not refuse the whole list.
  cohortEmails: z.array(z.string().trim().toLowerCase().max(254).regex(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)).max(200).optional(),
  dayMinutes: z.number().int().min(0).max(100_000).optional(),
  monthMinutes: z.number().int().min(0).max(1_000_000).optional(),
  teacherMonthMinutes: z.number().int().min(0).max(100_000).optional(),
  spatiusChildrenOk: z.boolean().optional(),
})

const postBody = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('likeness-ready'), avatarId: z.string().max(40), spatiusAvatarId: z.string().trim().min(4).max(120).regex(/^[A-Za-z0-9_-]+$/) }),
  z.strictObject({ action: z.literal('likeness-deleted'), spatiusAvatarId: z.string().trim().min(4).max(120) }),
  z.strictObject({ action: z.literal('retry-report'), sessionId: z.string().max(40) }),
])

type ConfigRow = { mode: string; cohort: string[]; day_minutes: number; month_minutes: number; teacher_month_minutes: number; spatius_children_ok: boolean; updated_at: Date; updated_by: string | null; swept_at: Date | null }

async function describe() {
  let r: ConfigRow | undefined
  try {
    r = (await db.$queryRaw<ConfigRow[]>`
      SELECT mode, cohort::text[] AS cohort, day_minutes, month_minutes, teacher_month_minutes, spatius_children_ok, updated_at, updated_by, swept_at
      FROM public.classroom_config WHERE id = 1`)[0]
  } catch (e) {
    if (e instanceof Error && /42P01|classroom_config" does not exist/.test(e.message)) return { tables: false as const }
    throw e
  }
  const ids = r?.cohort ?? []
  const people = ids.length ? await db.profile.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : []
  const monthStart = new Date(Date.now() - 31 * 86_400_000)
  const [use, sessions, likeness, failed, flagged, consentRows] = await Promise.all([
    db.$transaction((tx) => budgetUse(tx, '')),
    db.classroomSession.aggregate({ where: { startedAt: { gte: monthStart } }, _count: { _all: true }, _sum: { costMicroUsd: true, usedSeconds: true } }),
    db.classroomAvatar.findMany({
      where: { customStatus: 'requested' },
      select: { id: true, name: true, customStatus: true, spatiusAvatarId: true, photoConsentAt: true, teacherProfile: { select: { fullName: true, photoUrl: true, profile: { select: { email: true } } } } },
      orderBy: { updatedAt: 'asc' }, take: 50,
    }),
    db.classroomSession.findMany({ where: { feedbackStatus: 'failed' }, select: { id: true, startedAt: true, avatar: { select: { name: true } } }, orderBy: { startedAt: 'desc' }, take: 30 }),
    // ⛔ THE FLAGGED EXCHANGES THEMSELVES — what the safety alert sends an admin here to read (2a round 7, codex): from the
    // turns, so a flag shows the moment it is saved (before any report, and when the report cannot be built), with the
    // teacher to contact. Admins only (this route's auth); nothing of it reaches the family's side.
    db.classroomTurn.findMany({
      where: { flag: 'harm' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        sessionId: true, createdAt: true, learnerText: true, replyText: true,
        session: { select: { learner: { select: { kind: true, birthYear: true } }, avatar: { select: { name: true, teacherProfile: { select: { fullName: true, profile: { select: { email: true } } } } } } } },
      },
    }),
    db.$queryRaw<{ avatar_id: string; photo_url: string | null }[]>`
      SELECT DISTINCT ON (detail->>'avatarId') detail->>'avatarId' AS avatar_id, detail->>'photoUrl' AS photo_url
        FROM compliance_audit WHERE action = 'classroom.photo.consent'
       ORDER BY detail->>'avatarId', "occurredAt" DESC`,
  ])
  const consented = new Map(consentRows.flatMap((r) => (r.photo_url ? [[r.avatar_id, r.photo_url] as const] : [])))
  return {
    tables: true as const,
    mode: r?.mode ?? 'off',
    cohort: ids.map((id) => ({ id, email: people.find((p) => p.id === id)?.email ?? null })),
    dayMinutes: r?.day_minutes ?? 300,
    monthMinutes: r?.month_minutes ?? 3000,
    teacherMonthMinutes: r?.teacher_month_minutes ?? 600,
    spatiusChildrenOk: r?.spatius_children_ok ?? false,
    updatedAt: r?.updated_at?.toISOString() ?? null,
    updatedBy: r?.updated_by ?? null,
    sweptAt: r?.swept_at?.toISOString() ?? null,
    use: { todayMinutes: use.dayMinutes, monthMinutes: use.monthMinutes },
    last31Days: { sessions: sessions._count._all, costUsd: Math.round((sessions._sum.costMicroUsd ?? 0) / 10_000) / 100, minutes: Math.round((sessions._sum.usedSeconds ?? 0) / 60) },
    likeness: likeness.map((a) => ({
      // ⛔ The photo the teacher CONSENTED to (its address, recorded with the consent — 2c rounds 2–3), not whatever the
      // profile shows now; only a consent recorded before that field existed falls back to the current one.
      avatarId: a.id, avatarName: a.name, teacher: a.teacherProfile.fullName, email: a.teacherProfile.profile.email,
      photoUrl: consented.get(a.id) ?? a.teacherProfile.photoUrl,
      status: a.customStatus, spatiusAvatarId: a.spatiusAvatarId, consentAt: a.photoConsentAt?.toISOString() ?? null,
    })),
    deletions: (await pendingLikenessDeletions()).map((d) => ({ spatiusAvatarId: d.spatius_avatar_id, reason: d.reason, queuedAt: d.queued_at.toISOString() })),
    failedReports: failed.map((s) => ({ sessionId: s.id, startedAt: s.startedAt.toISOString(), avatar: s.avatar.name })),
    flagged: flagged.map((f) => ({
      sessionId: f.sessionId, at: f.createdAt.toISOString(), avatar: f.session.avatar.name,
      teacher: f.session.avatar.teacherProfile.fullName, teacherEmail: f.session.avatar.teacherProfile.profile.email,
      learner: f.session.learner ? (f.session.learner.kind === 'child' ? `child, born ${f.session.learner.birthYear}` : 'adult') : 'teacher test',
      said: f.learnerText ?? '', reply: f.replyText,
    })),
  }
}

export const GET = route({ auth: 'admin' }, async () => describe())

export const PUT = route({ auth: 'admin', body: putBody }, async ({ admin, body }) => {
  const setMode = (q: Pick<typeof db, '$executeRaw'>) => q.$executeRaw`
    INSERT INTO public.classroom_config (id, mode, updated_at, updated_by) VALUES (1, ${body.mode}, now(), ${admin})
    ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now(), updated_by = EXCLUDED.updated_by`
  try {
    // ⛔ THE KILL SWITCH NEEDS NO READ (the calls admin's rule): 'off' is one statement, FIRST, whatever follows or fails.
    if (body.mode === 'off') {
      await setMode(db)
      resetClassroomConfigCache() // at once — a later failure in this request must not leave "off" unseen here (2c round 3)
    }
    // ⛔ Not ON unless the sweep is running — enable eno-cron-classroom-sweep.timer first (503 not_configured). Only a
    // CHANGE to an open mode needs it (2c round 1, opus): re-sending the mode the switch already has leaves the caps
    // editable while the sweep is down — which is exactly when they may need lowering.
    const current = (await db.$queryRaw<{ mode: string }[]>`SELECT mode FROM public.classroom_config WHERE id = 1`)[0]?.mode
    if (body.mode && body.mode !== 'off' && body.mode !== current && !(await classroomSweepIsFresh())) throw new ApiError('not_configured', 503)
    let ids: string[] | undefined
    if (body.cohortEmails) {
      // The WHOLE uuid (C3a review, Opus): a prefix test filed an email like 12345678-abcd-x@… under ids — a 500 from Postgres.
      const isId = (x: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
      const found = body.cohortEmails.length ? await db.profile.findMany({
        where: { OR: [{ email: { in: body.cohortEmails.filter((x) => !isId(x)) } }, { id: { in: body.cohortEmails.filter(isId) } }] },
        select: { id: true },
      }) : []
      ids = found.map((p) => p.id)
    }
    // ⛔ THE RESTRICTIONS AND THE MODE IN ONE TRANSACTION, mode last (2c round 1, codex): a classroom turned on never runs
    // a moment under the old cohort or caps, and a failure leaves none of it half-applied.
    await db.$transaction(async (tx) => {
      if (ids) await tx.$executeRaw`UPDATE public.classroom_config SET cohort = ${ids}::uuid[] WHERE id = 1`
      if (body.dayMinutes !== undefined) await tx.$executeRaw`UPDATE public.classroom_config SET day_minutes = ${body.dayMinutes} WHERE id = 1`
      if (body.monthMinutes !== undefined) await tx.$executeRaw`UPDATE public.classroom_config SET month_minutes = ${body.monthMinutes} WHERE id = 1`
      if (body.teacherMonthMinutes !== undefined) await tx.$executeRaw`UPDATE public.classroom_config SET teacher_month_minutes = ${body.teacherMonthMinutes} WHERE id = 1`
      if (body.spatiusChildrenOk !== undefined) await tx.$executeRaw`UPDATE public.classroom_config SET spatius_children_ok = ${body.spatiusChildrenOk} WHERE id = 1`
      if (body.mode && body.mode !== 'off') await setMode(tx)
    })
  } catch (e) {
    if (e instanceof Error && /42P01|classroom_config" does not exist/.test(e.message)) throw new ApiError('not_configured', 503)
    throw e
  }
  resetClassroomConfigCache()
  return describe()
})

export const POST = route({ auth: 'admin', body: postBody }, async ({ admin, body }) => {
  if (body.action === 'likeness-deleted') {
    await markLikenessDeleted(body.spatiusAvatarId, admin)
    return describe()
  }
  if (body.action === 'retry-report') {
    const reset = await db.classroomSession.updateMany({ where: { id: body.sessionId, feedbackStatus: 'failed' }, data: { feedbackStatus: 'pending', feedbackAttempts: 0 } })
    if (reset.count) await buildFeedback(body.sessionId) // only a report this reset (2c round 3, opus)
    return describe()
  }
  const avatar = await db.classroomAvatar.findUnique({ where: { id: body.avatarId }, include: { teacherProfile: { select: { fullName: true, profile: { select: { email: true } } } } } })
  if (!avatar) throw new ApiError('not_found', 404)
  {
    if (avatar.customStatus !== 'requested') throw new ApiError('invalid_input', 409)
    // ⛔ A teacher's OWN likeness only (round 4, opus): a library avatar's id is shared by every class that picked it, and
    // deleting this avatar later would queue it for deletion at Spatius. A likeness already deleted there cannot come back
    // (the DDL's trigger refuses it too — this answers 409 instead of a 500).
    if (libraryAvatarById(body.spatiusAvatarId)) throw new ApiError('invalid_input', 409)
    // An id let go before — pending deletion OR deleted — is never given out again (the DDL's single-use rule; answering
    // 409 here instead of the trigger's 500 — 2c round 1, opus).
    const gone = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.classroom_likeness_deletion WHERE spatius_avatar_id = ${body.spatiusAvatarId}`
    if (gone[0]?.n) throw new ApiError('invalid_input', 409)
    // One likeness, one avatar (the DDL's unique index): an id another avatar already holds is refused, never shared.
    // Only while it is STILL requested (2c round 1, opus): a teacher who withdrew a moment ago is never marked ready.
    const marked = await db.classroomAvatar.updateMany({ where: { id: avatar.id, customStatus: 'requested' }, data: { customStatus: 'ready', spatiusAvatarId: body.spatiusAvatarId, updatedAt: new Date() } })
      .catch((e) => { throw (e as { code?: string })?.code === 'P2002' ? new ApiError('invalid_input', 409) : e })
    if (!marked.count) throw new ApiError('invalid_input', 409)
    const email = avatar.teacherProfile.profile.email
    if (email) {
      // The classroom is eno.vn's, whichever edition's admin sent this (2c round 3, opus) — and a teacher-facing mail
      // speaks both languages, like every teacher notice.
      const origin = TEACHER_SURFACE_ORIGIN
      const name = escapeHtml(avatar.teacherProfile.fullName)
      await sendMail({
        to: email,
        subject: 'Your 3D avatar is ready · Avatar 3D của bạn đã sẵn sàng',
        html: renderBrandEmail({
          preheader: 'Your own face is ready in eno Classroom · Khuôn mặt của bạn đã sẵn sàng trong eno Classroom',
          bodyHtml: `<p>Hi ${name},</p><p>Your 3D avatar is ready. Open eno Classroom to switch your class to it.</p>`
            + `<p>Chào ${name},</p><p>Avatar 3D của bạn đã sẵn sàng. Mở eno Classroom để chuyển lớp của bạn sang avatar này.</p>`,
          origin,
          cta: { label: 'Open eno Classroom · Mở eno Classroom', url: `${origin}/classroom/avatar` },
        }),
      }).catch((e) => logError(e, { op: 'classroom.likeness.email' }))
    }
  }
  return describe()
})

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
