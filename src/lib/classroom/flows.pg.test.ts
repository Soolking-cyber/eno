// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CLASSROOM'S LOCKS, RACES AND CASCADES AGAINST A REAL POSTGRES — the advisory locks, the partial unique index, the
 * FOR UPDATE claim, the once-only end and the budget arithmetic only prove themselves on a database.
 *
 * ⛔ OPT-IN, AND ONLY ON A THROWAWAY DATABASE (the calls tests' rule): CLASSROOM_PG_TESTS=1, a loopback host, never port
 * 5433 (this repo's SSH tunnel to production), and a database NAME ending in `_it` — checked again with
 * current_database() before the first write. Setup:
 *   createdb classroom_it; psql classroom_it -c "create extension pgcrypto; create role anon nologin; create role authenticated nologin; create role service_role nologin"
 *   npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script | psql classroom_it   (then drop the 7 Classroom* tables)
 *   DIRECT_URL=…/classroom_it node scripts/rate-limit-pg.mjs; DIRECT_URL=…/classroom_it node scripts/classroom-ddl.mjs
 *   CLASSROOM_PG_TESTS=1 DATABASE_URL=postgresql://…/classroom_it npx vitest run src/lib/classroom/flows.pg.test.ts
 * The vendors (our speech server, Azure, Gemini) are stubbed: these tests are about OUR rows, not their answers.
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.CLASSROOM_PG_TESTS === '1' && loopback && parsed?.port !== '5433' && /_it$/.test(parsed?.pathname ?? '')

const afterQueue: Promise<unknown>[] = []
const seen = vi.hoisted(() => ({ feedbackTurns: [] as { learner: string | null }[][], recognizeMs: 0, alerts: [] as { to: string; key: string; text: string }[], tutorUnusableHarm: false, silence: false, assessed: [] as string[] }))
// Nothing here may ever send real mail: the safety alert is captured instead.
vi.mock('@/lib/mail', () => ({
  sendMailOnce: async (m: { to: string; text: string }, o: { idempotencyKey: string }) => { seen.alerts.push({ to: m.to, key: o.idempotencyKey, text: m.text }); return { outcome: 'sent', stopRun: false, name: null, retryAfterMs: null } },
  sendMail: async () => true,
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { afterQueue.push(Promise.resolve().then(fn)) } }))
vi.mock('@/lib/gemini', async (orig) => ({ ...(await orig<typeof import('@/lib/gemini')>()), getGeminiVertex: () => ({}) }))
vi.mock('./speech-local', async (orig) => ({
  ...(await orig<typeof import('./speech-local')>()),
  localSpeechConfig: () => ({ url: 'http://eno-classroom-speech:8090', key: 'k'.repeat(32) }),
  transcribe: async () => {
    if (seen.recognizeMs) await new Promise((r) => setTimeout(r, seen.recognizeMs))
    return seen.silence ? { text: '', status: 'silence' } : { text: 'I go to school yesterday', status: 'ok' }
  },
}))
vi.mock('./azure-speech', async (orig) => ({
  ...(await orig<typeof import('./azure-speech')>()),
  speechConfig: () => ({ key: 'k', region: 'southeastasia' }),
  assess: async (_cfg: unknown, _wav: unknown, reference: string) => (seen.assessed.push(reference), { accuracy: 70, fluency: 80, completeness: null, prosody: null, words: [{ word: 'school', score: 50, error: 'Mispronunciation' }] }),
}))
vi.mock('./session-voice', () => ({ speakLine: async () => 'AAAA' }))
vi.mock('./tutor-ai', async (orig) => ({
  ...(await orig<typeof import('./tutor-ai')>()),
  tutorTurn: async () => {
    if (seen.tutorUnusableHarm) throw Object.assign(new SyntaxError('classroom_unusable_reply'), { safety: true, calls: 2 })
    return { reply: 'Nice! Where did you go?', hint: 'I went to school.', hintVi: 'Em đã đi học.', expect: null, heardAs: [], safety: false, model: 'm', calls: 1 }
  },
}))
vi.mock('./feedback-ai', async (orig) => ({
  ...(await orig<typeof import('./feedback-ai')>()),
  draftFeedback: async (_ai: unknown, input: { turns: { learner: string | null }[] }) => (seen.feedbackTurns.push(input.turns), {
    summary: 'Good talk.', summaryVi: 'Tốt.', wins: ['Clear answers'], calls: 1,
    mistakes: [{ said: 'I go to school yesterday', better: 'I went to school yesterday', type: 'grammar', why: 'past', turn: 1 }],
    tips: new Map([['school', 'Long oo.']]), newWords: [], focusWordsUsed: [], rightAgain: [],
    focusFound: [{ kind: 'grammar', label: 'past tense' }],
    nextPlan: { brief: 'Talk about last weekend.', focus: { goals: ['Use past tense'], focusWords: ['went'], recycle: ['past tense'], drill: ['I went to school.'] }, openingLine: 'What did you do last weekend?' },
  }),
}))

describe.skipIf(!live)('eno Classroom against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let start: typeof import('./session-start')
  let turn: typeof import('./session-turn')
  let end: typeof import('./session-end')
  let join: typeof import('./join')
  let feedback: typeof import('./feedback')
  let sweep: typeof import('./sweep')
  let config: typeof import('./config')
  let notices: typeof import('./notices')
  let wav: typeof import('./wav')

  const teacherId = randomUUID()
  const parentId = randomUUID()
  const otherParentId = randomUUID()
  let avatarId = ''

  const voice = () => {
    const pcm = new Int16Array(16_000)
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 10) * 8000)
    return Buffer.from(wav.encodeWav(pcm))
  }
  const consents = () => ({ practice: notices.PRACTICE_NOTICE_VERSION, teacherView: notices.TEACHER_VIEW_NOTICE_VERSION })
  const account = (id: string) => ({ id, accountType: 'individual', displayName: 'Parent', tosVersion: null })
  const newSeat = async (over: Record<string, unknown> = {}) => db.classroomEnrollment.create({
    data: { avatarId, seatName: 'Minh', inviteCode: Array.from({ length: 12 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join(''), inviteExpiresAt: new Date(Date.now() + 86_400_000), ...over },
  })

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write to ${name}`)
    start = await import('./session-start')
    turn = await import('./session-turn')
    end = await import('./session-end')
    join = await import('./join')
    feedback = await import('./feedback')
    sweep = await import('./sweep')
    config = await import('./config')
    notices = await import('./notices')
    wav = await import('./wav')
    for (const id of [teacherId, parentId, otherParentId]) await db.profile.create({ data: { id, email: `${id}@example.test`, accountType: 'individual' } })
    const tp = await db.teacherProfile.create({ data: { profileId: teacherId, fullName: 'Anna Smith', headline: 'Teacher', nationality: 'GB', currentCity: 'hcmc', consentPublicAt: new Date(), updatedAt: new Date() } })
    avatarId = (await db.classroomAvatar.create({ data: { teacherProfileId: tp.id, name: 'Ms Anna', voice: 'en-GB-SoniaNeural' } })).id
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'all', day_minutes = 300, month_minutes = 3000, teacher_month_minutes = 600, swept_at = now() WHERE id = 1`
    config.resetClassroomConfigCache()
  }, 120_000)

  beforeEach(async () => {
    await Promise.all(afterQueue.splice(0))
    await db.classroomEnrollment.deleteMany({ where: { avatarId } })
    await db.classroomLearner.deleteMany({ where: { ownerId: { in: [parentId, otherParentId] } } })
    await db.classroomSession.deleteMany({ where: { avatarId } })
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'all', day_minutes = 300, swept_at = now() WHERE id = 1`
    config.resetClassroomConfigCache()
  })

  afterAll(async () => {
    await Promise.all(afterQueue.splice(0))
    await db.profile.deleteMany({ where: { id: { in: [teacherId, parentId, otherParentId] } } })
  })

  it('⛔ two people with one forwarded invite: exactly one claims the seat', async () => {
    const seat = await newSeat()
    const req = { who: 'child' as const, displayName: 'Minh', birthYear: new Date().getFullYear() - 9, guardian: notices.GUARDIAN_NOTICE_VERSION, assent: notices.ASSENT_VERSION, ...consents() }
    const results = await Promise.allSettled([join.claimSeat(seat.inviteCode!, account(parentId), req), join.claimSeat(seat.inviteCode!, account(otherParentId), req)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const after = await db.classroomEnrollment.findUnique({ where: { id: seat.id } })
    expect(after).toMatchObject({ status: 'active', inviteCode: null })
    const learner = await db.classroomLearner.findUnique({ where: { id: after!.learnerId! } })
    expect(learner).toMatchObject({ kind: 'child', practiceConsentVersion: notices.PRACTICE_NOTICE_VERSION })
    expect(learner!.assentAt).not.toBeNull()
    const audit = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM compliance_audit WHERE action = 'classroom.learner.consent' AND detail->>'learnerId' = ${learner!.id}`
    expect(audit[0].n).toBe(1)
  })

  it('⛔ a child of 7+ without their own yes is refused; the teacher cannot claim their own seat', async () => {
    const seat = await newSeat()
    await expect(join.claimSeat(seat.inviteCode!, account(parentId), { who: 'child', displayName: 'Lan', birthYear: new Date().getFullYear() - 8, guardian: notices.GUARDIAN_NOTICE_VERSION, ...consents() }))
      .rejects.toMatchObject({ code: 'assent_required' })
    await expect(join.claimSeat(seat.inviteCode!, account(teacherId), { who: 'self', adult: notices.ADULT_NOTICE_VERSION, ...consents() })).rejects.toMatchObject({ code: 'invite_own' })
  })

  const activeSeat = async (minutes = 10) => {
    const seat = await newSeat()
    await join.claimSeat(seat.inviteCode!, account(parentId), { who: 'self', adult: notices.ADULT_NOTICE_VERSION, ...consents() })
    if (minutes !== 10) await db.classroomEnrollment.update({ where: { id: seat.id }, data: { sessionMinutes: minutes } })
    return seat
  }

  it('⛔ a double tap starts ONE session (the second resumes it); the next start today is refused with a date', async () => {
    const seat = await activeSeat()
    const [a, b] = await Promise.all([start.startLearnerSession(seat.id, parentId), start.startLearnerSession(seat.id, parentId)])
    expect(a.id).toBe(b.id)
    expect([a.resumed, b.resumed].sort()).toEqual([false, true])
    expect(await db.classroomSession.count({ where: { enrollmentId: seat.id } })).toBe(1)
    await turn.processTurn(a.id, parentId, 'turn-spoke-01', voice())
    await end.endSession(a.id, parentId, 'learner')
    await expect(start.startLearnerSession(seat.id, parentId)).rejects.toMatchObject({ code: 'day_limit' })
  })

  it('⛔ a start the learner never spoke in does not spend the day, and gives its plan back; three starts a day at most', async () => {
    const seat = await activeSeat()
    const plan = await db.classroomPlan.create({ data: { enrollmentId: seat.id, source: 'teacher', status: 'approved', brief: 'The teacher’s plan' } })
    for (let n = 1; n <= 3; n++) {
      const s = await start.startLearnerSession(seat.id, parentId)
      expect((await db.classroomSession.findUnique({ where: { id: s.id } }))!.planId).toBe(plan.id) // the same plan, every time
      await end.endSession(s.id, parentId, 'learner')
      await Promise.all(afterQueue.splice(0)) // the end's own report build (after()) — nothing said, so no waiting
      expect(await db.classroomSession.findUnique({ where: { id: s.id } })).toMatchObject({ feedbackStatus: 'ready' })
      expect(await db.classroomPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ status: 'approved' })
    }
    await expect(start.startLearnerSession(seat.id, parentId)).rejects.toMatchObject({ code: 'day_limit' })
  })

  it('⛔ a harm flag survives an unusable reply: saved flagged with our own words, a person alerted; a resume never replays it', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await turn.processTurn(s.id, parentId, 'turn-normal-001', voice())
    seen.alerts.length = 0
    process.env.ADMIN_EMAILS = 'safety-a@example.test'
    seen.tutorUnusableHarm = true
    try {
      const r = await turn.processTurn(s.id, parentId, 'turn-harm-0001', voice())
      expect(r).toMatchObject({ kind: 'reply', reply: expect.stringMatching(/trust/) })
    } finally { seen.tutorUnusableHarm = false }
    await Promise.all(afterQueue.splice(0))
    expect(await db.classroomTurn.findFirst({ where: { sessionId: s.id, clientTurnId: 'turn-harm-0001' } })).toMatchObject({ flag: 'harm', status: 'ok' })
    expect(seen.alerts.map((a) => a.to)).toEqual(['safety-a@example.test'])
    // the parent reopens the tab: never the safety words again — a neutral line, and no drill
    const again = await start.startLearnerSession(seat.id, parentId)
    expect(again.resumed).toBe(true)
    expect(again.opening).toMatchObject({ text: "Let's keep practising. What would you like to talk about now?", expect: null })
  })

  it('⛔ the avatar never SAYS a number or a handle first: a greeting carrying one is replaced by a plain hello', async () => {
    await db.classroomAvatar.update({ where: { id: avatarId }, data: { greeting: 'Hi! Call me on 0901 234 567 for private lessons.' } })
    try {
      const seat = await activeSeat()
      const s = await start.startLearnerSession(seat.id, parentId)
      expect(s.opening.text).toBe("Hi! I'm Ms Anna. How are you today?")
    } finally {
      await db.classroomAvatar.update({ where: { id: avatarId }, data: { greeting: '' } })
    }
  })

  it('⛔ a stopped sweep closes the classroom to starts (nothing would end abandoned sessions or build their reports)', async () => {
    const seat = await activeSeat()
    await db.$executeRaw`UPDATE public.classroom_config SET swept_at = now() - interval '1 hour' WHERE id = 1`
    config.resetClassroomConfigCache()
    await expect(start.startLearnerSession(seat.id, parentId)).rejects.toMatchObject({ code: 'classroom_closed' })
  })

  it('⛔ an expired session is ended even when the start that found it is refused (its own transaction)', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await turn.processTurn(s.id, parentId, 'turn-spent-001', voice()) // the day is spent
    await db.classroomSession.update({ where: { id: s.id }, data: { endsAt: new Date(Date.now() - 5 * 60_000) } })
    await expect(start.startLearnerSession(seat.id, parentId)).rejects.toMatchObject({ code: 'day_limit' })
    expect(await db.classroomSession.findUnique({ where: { id: s.id } })).toMatchObject({ status: 'ended', endReason: 'time' })
  })

  it('⛔ a live session past its end is ENDED at the next start, never resumed into refusals', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await db.classroomSession.update({ where: { id: s.id }, data: { endsAt: new Date(Date.now() - 5 * 60_000) } })
    const next = await start.startLearnerSession(seat.id, parentId) // nothing was said in it: the day is not spent
    expect(next.id).not.toBe(s.id)
    expect(next.resumed).toBe(false)
    expect(await db.classroomSession.findUnique({ where: { id: s.id } })).toMatchObject({ status: 'ended', endReason: 'time' })
  })

  it('⛔ a teacher’s plan held by a silent session comes back even after a later start (2b round 1)', async () => {
    const seat = await activeSeat()
    const plan = await db.classroomPlan.create({ data: { enrollmentId: seat.id, source: 'teacher', status: 'approved', brief: 'The teacher’s plan' } })
    const a = await start.startLearnerSession(seat.id, parentId) // takes the plan
    await db.classroomSession.update({ where: { id: a.id }, data: { endsAt: new Date(Date.now() - 5 * 60_000) } })
    const b = await start.startLearnerSession(seat.id, parentId) // ends A (expired) and starts B without the plan
    expect(b.id).not.toBe(a.id)
    await db.classroomSession.update({ where: { id: a.id }, data: { endedAt: new Date(Date.now() - 200_000) } })
    expect(await feedback.buildFeedback(a.id)).toBe('ready') // A's report, AFTER B started
    expect(await db.classroomPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ status: 'approved' })
  })

  it('⛔ an existing child joins another class under the guardian statement given again; a closed class takes no join', async () => {
    const first = await newSeat()
    const { learnerId } = await join.claimSeat(first.inviteCode!, account(parentId), { who: 'child', displayName: 'Lan', birthYear: new Date().getFullYear() - 5, guardian: notices.GUARDIAN_NOTICE_VERSION, ...consents() })
    // a second class of another teacher would be the real case; here a second seat of this class after leaving the first
    await db.classroomEnrollment.update({ where: { id: first.id }, data: { status: 'removed', removedAt: new Date() } })
    const second = await newSeat()
    await expect(join.claimSeat(second.inviteCode!, account(parentId), { who: 'existing', learnerId, ...consents() })).rejects.toMatchObject({ code: 'notice_changed' })
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'off' WHERE id = 1`
    config.resetClassroomConfigCache()
    await expect(join.claimSeat(second.inviteCode!, account(parentId), { who: 'existing', learnerId, guardian: notices.GUARDIAN_NOTICE_VERSION, ...consents() })).rejects.toMatchObject({ code: 'classroom_closed' })
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'all' WHERE id = 1`
    config.resetClassroomConfigCache()
    expect(await join.claimSeat(second.inviteCode!, account(parentId), { who: 'existing', learnerId, guardian: notices.GUARDIAN_NOTICE_VERSION, ...consents() })).toMatchObject({ learnerId })
  })

  it('⛔ one family joining two seats of one class at once: one "me", one seat, a refusal — never a 500', async () => {
    const [a, b] = [await newSeat(), await newSeat()]
    const results = await Promise.allSettled([a, b].map((s) => join.claimSeat(s.inviteCode!, account(parentId), { who: 'self', adult: notices.ADULT_NOTICE_VERSION, ...consents() })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'already_enrolled' } })
    expect(await db.classroomLearner.count({ where: { ownerId: parentId, kind: 'self' } })).toBe(1)
  })

  it('⛔ a flagged exchange stays out of the family’s report and of the model’s input; the teacher sees it, flagged', async () => {
    const seat = await activeSeat()
    const learnerId = (await db.classroomEnrollment.findUnique({ where: { id: seat.id } }))!.learnerId
    const s = await db.classroomSession.create({ data: { enrollmentId: seat.id, avatarId, learnerId, status: 'ended', endedAt: new Date(Date.now() - 200_000), endsAt: new Date(), reservedMinutes: 10, usedSeconds: 60, learnerSpeechMs: 3_000 } })
    await db.classroomTurn.create({ data: { sessionId: s.id, seq: 1, status: 'ok', learnerText: 'I go to school yesterday', replyText: 'ok', assessStatus: 'done', learnerMs: 1_000 } })
    await db.classroomTurn.create({ data: { sessionId: s.id, seq: 2, status: 'ok', learnerText: 'someone at home hurts me', replyText: 'Please tell a trusted adult.', flag: 'harm', heardAs: [{ heard: 'hurts', meant: 'hearts' }], learnerMs: 1_000 } })
    await db.classroomTurn.create({ data: { sessionId: s.id, seq: 3, status: 'ok', learnerText: 'I like football', replyText: 'Great!', assessStatus: 'done', learnerMs: 1_000 } })
    await db.classroomTurn.create({ data: { sessionId: s.id, seq: 5, status: 'ok', learnerText: 'my phone is 0901 234 567', replyText: 'Please keep that private.', assessStatus: 'skipped', learnerMs: 1_000 } })
    // a flagged turn kept although its reply could not be written ('failed' but flagged)
    await db.classroomTurn.create({ data: { sessionId: s.id, seq: 4, status: 'failed', learnerText: 'it happened again', replyText: 'Thank you for telling me.', flag: 'harm', learnerMs: 1_000 } })
    seen.feedbackTurns.length = 0
    seen.alerts.length = 0
    process.env.ADMIN_EMAILS = 'safety-a@example.test, safety-b@example.test'
    expect(await feedback.buildFeedback(s.id)).toBe('ready')
    expect(seen.feedbackTurns[0].map((t) => t.learner)).toEqual(['I go to school yesterday', 'I like football', 'my phone is 0901 234 567'])
    // ⛔ a person is told — every admin, once, with where to look and not a word of what was said
    expect(seen.alerts.map((a) => a.to)).toEqual(['safety-a@example.test', 'safety-b@example.test'])
    expect(seen.alerts.every((a) => a.key.startsWith(`classroom-safety-${s.id}-`) && !/hurts/.test(a.text))).toBe(true)
    const { reportFor, sessionForViewer } = await import('./report')
    const family = reportFor((await sessionForViewer(s.id, parentId)).s, 'learner')
    expect(JSON.stringify(family)).not.toMatch(/hurts|harm|trusted adult/)
    // …and nothing gives the hidden exchange away: no gap in the numbers, talk time without it, no turn numbers
    expect(family.transcript.map((t) => t.seq)).toEqual([1, 2, 3])
    expect(family.talkSeconds).toBe(3)
    expect((family.feedback!.mistakes as Record<string, unknown>[]).every((m) => !('turn' in m))).toBe(true)
    const teacher = reportFor((await sessionForViewer(s.id, teacherId)).s, 'teacher')
    expect(teacher.transcript.find((t) => t.seq === 2)).toMatchObject({ flag: 'harm' })
    expect(teacher.transcript.find((t) => t.seq === 4)).toMatchObject({ flag: 'harm', learner: 'it happened again' })
    // a number the child SAID never reaches the teacher; the family sees their own words
    expect(teacher.transcript.find((t) => t.seq === 5)).toMatchObject({ learner: '[contact details hidden]' })
    expect(family.transcript.some((t) => t.learner === 'my phone is 0901 234 567')).toBe(true)
    // the report's lock was released by its builder (one conditional DELETE on kv_store)
    expect(await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM kv_store WHERE key = ${`classroom-feedback:${s.id}`}`).toEqual([{ n: 0 }])
    expect(teacher.feedback).toMatchObject({ safetyFlag: 'harm' })
  })

  it('⛔ the budget is counted from the rows under the lock — a start past the day cap is refused', async () => {
    await db.$executeRaw`UPDATE public.classroom_config SET day_minutes = 15 WHERE id = 1`
    config.resetClassroomConfigCache()
    const s1 = await activeSeat(10)
    const s2 = await newSeat()
    // a second learner (the other parent's) so the frequency rule does not interfere
    await join.claimSeat(s2.inviteCode!, account(otherParentId), { who: 'self', adult: notices.ADULT_NOTICE_VERSION, ...consents() })
    const results = await Promise.allSettled([start.startLearnerSession(s1.id, parentId), start.startLearnerSession(s2.id, otherParentId)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'budget_classroom' } })
  })

  it('⛔ one reply at a time, never past the cap; a retried turn id is the same turn', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    // Fill the session to two turns short of the cap.
    for (let q = 1; q <= 78; q++) await db.classroomTurn.create({ data: { sessionId: s.id, seq: q, status: 'ok', learnerText: 'x', replyText: 'y' } })
    seen.recognizeMs = 300 // a reply takes a moment: the parallel uploads arrive while the first is being answered
    const ids = ['turn-aaaaaaaa', 'turn-bbbbbbbb', 'turn-cccccccc', 'turn-dddddddd']
    const results = await Promise.allSettled(ids.map((id) => turn.processTurn(s.id, parentId, id, voice())))
    seen.recognizeMs = 0
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'turn_in_progress')).toBe(true)
    await turn.processTurn(s.id, parentId, 'turn-eeeeeeee', voice()) // the 80th
    await expect(turn.processTurn(s.id, parentId, 'turn-ffffffff', voice())).rejects.toMatchObject({ code: 'turn_cap' })
    expect(await db.classroomTurn.count({ where: { sessionId: s.id } })).toBe(81)
    const ok = ids[results.findIndex((r) => r.status === 'fulfilled')]
    const again = await turn.processTurn(s.id, parentId, ok, voice())
    expect(again).toMatchObject({ kind: 'reply', reply: 'Nice! Where did you go?' })
    expect(await db.classroomTurn.count({ where: { sessionId: s.id } })).toBe(81)
  })

  it('⛔ attempts count toward the cap — a silent or failed attempt keeps its seq (never deleted)', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    for (let q = 1; q <= 79; q++) await db.classroomTurn.create({ data: { sessionId: s.id, seq: q, status: 'ok', learnerText: 'x', replyText: 'y' } })
    seen.silence = true
    try {
      expect(await turn.processTurn(s.id, parentId, 'turn-silent-0001', voice())).toEqual({ kind: 'silence' }) // seq 80, kept as failed
    } finally { seen.silence = false }
    await expect(turn.processTurn(s.id, parentId, 'turn-after-0001', voice())).rejects.toMatchObject({ code: 'turn_cap' })
    expect(await db.classroomTurn.findFirst({ where: { sessionId: s.id, seq: 80 } })).toMatchObject({ status: 'failed' })
  })

  it('⛔ the report waits for a turn still on its way (End landed during a reply), then includes it', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    seen.recognizeMs = 400
    const inFlight = turn.processTurn(s.id, parentId, 'turn-inflight-1', voice())
    await new Promise((r) => setTimeout(r, 150)) // reserved, still being answered
    await db.classroomSession.update({ where: { id: s.id }, data: { status: 'ended', endedAt: new Date(), endReason: 'learner' } })
    expect(await feedback.buildFeedback(s.id)).toBe('waiting')
    await inFlight
    seen.recognizeMs = 0
    await Promise.all(afterQueue.splice(0)) // its pronunciation score lands
    expect(await feedback.buildFeedback(s.id)).toBe('ready')
    expect(await db.classroomFeedback.findUnique({ where: { sessionId: s.id } })).toMatchObject({ summary: 'Good talk.' })
  })

  it('⛔ free talk is never sent to Azure: only a drill turn is scored, against the drill sentence', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await db.classroomTurn.updateMany({ where: { sessionId: s.id, seq: 0 }, data: { expectText: null } })
    seen.assessed.length = 0
    const r = await turn.processTurn(s.id, parentId, 'turn-free-0001', voice())
    await Promise.all(afterQueue.splice(0))
    expect(r).toMatchObject({ kind: 'reply' })
    expect(seen.assessed).toEqual([])
    expect(await db.classroomTurn.findFirst({ where: { sessionId: s.id, clientTurnId: 'turn-free-0001' } })).toMatchObject({ assessStatus: 'skipped', reference: null })
    // the tutor's reply asks for a sentence: the NEXT turn is a drill, scored against exactly that sentence
    await db.classroomTurn.updateMany({ where: { sessionId: s.id, clientTurnId: 'turn-free-0001' }, data: { expectText: 'I went to school yesterday.' } })
    await turn.processTurn(s.id, parentId, 'turn-drill-001', voice())
    await Promise.all(afterQueue.splice(0))
    expect(seen.assessed).toEqual(['I went to school yesterday.'])
    expect(await db.classroomTurn.findFirst({ where: { sessionId: s.id, clientTurnId: 'turn-drill-001' } })).toMatchObject({ assessStatus: 'done', reference: 'I went to school yesterday.' })
  })

  it('⛔ the switch bites on the next turn, not when the sweep comes round', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'off' WHERE id = 1`
    config.resetClassroomConfigCache()
    await expect(turn.processTurn(s.id, parentId, 'turn-off-00001', voice())).rejects.toMatchObject({ code: 'classroom_closed' })
  })

  it('⛔ end and sweep race: the session ends once; the report and the AI draft follow; a teacher plan is never overwritten', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    // the opening line asked for a drill: this turn is scored against it (free talk is not scored at all — next test)
    await db.classroomTurn.updateMany({ where: { sessionId: s.id, seq: 0 }, data: { expectText: 'I go to school.' } })
    await turn.processTurn(s.id, parentId, 'turn-one-111', voice())
    await Promise.all(afterQueue.splice(0)) // the pronunciation score lands
    await db.classroomSession.update({ where: { id: s.id }, data: { endsAt: new Date(Date.now() - 10 * 60_000) } })
    const [e] = await Promise.all([end.endSession(s.id, parentId, 'learner'), sweep.sweepClassroom({ killAll: false })])
    expect(await db.classroomSession.count({ where: { id: s.id, status: 'ended' } })).toBe(1)
    void e
    // build the report now (settle time passed: endedAt pushed back)
    await db.classroomSession.update({ where: { id: s.id }, data: { endedAt: new Date(Date.now() - 120_000) } })
    expect(await feedback.buildFeedback(s.id)).toBe('ready')
    const fb = await db.classroomFeedback.findUnique({ where: { sessionId: s.id } })
    expect(fb).toMatchObject({ summary: 'Good talk.' })
    expect(fb!.pronunciation).toEqual([{ word: 'school', score: 50, reliable: true, tip: 'Long oo.' }])
    const plans = await db.classroomPlan.findMany({ where: { enrollmentId: seat.id, status: 'draft' } })
    expect(plans).toHaveLength(1)
    const seatNow = await db.classroomEnrollment.findUnique({ where: { id: seat.id } })
    expect(seatNow!.focusItems).toMatchObject([{ label: 'past tense', count: 1 }])

    // a teacher plan waiting: the next report writes no AI draft
    await db.classroomPlan.create({ data: { enrollmentId: seat.id, source: 'teacher', status: 'approved', brief: 'Teacher brief' } })
    const s2 = await db.classroomSession.create({ data: { enrollmentId: seat.id, avatarId, learnerId: seatNow!.learnerId, status: 'ended', endedAt: new Date(Date.now() - 120_000), endsAt: new Date(), reservedMinutes: 10, usedSeconds: 60 } })
    await db.classroomTurn.create({ data: { sessionId: s2.id, seq: 1, status: 'ok', learnerText: 'I go to school yesterday', replyText: 'ok', assessStatus: 'done' } })
    expect(await feedback.buildFeedback(s2.id)).toBe('ready')
    expect(await db.classroomPlan.count({ where: { enrollmentId: seat.id, source: 'teacher', status: 'approved' } })).toBe(1)
    expect(await db.classroomPlan.count({ where: { enrollmentId: seat.id, source: 'ai', status: 'draft' } })).toBe(1)
  })

  it('⛔ a learner who withdrew and has no seat left is erased by the sweep after the retention days', async () => {
    const old = await db.classroomLearner.create({ data: { ownerId: parentId, kind: 'child', displayName: 'Old', birthYear: new Date().getFullYear() - 9, guardianAttestedAt: new Date(), withdrawnAt: new Date(Date.now() - 100 * 86_400_000) } })
    const recent = await db.classroomLearner.create({ data: { ownerId: parentId, kind: 'child', displayName: 'Recent', birthYear: new Date().getFullYear() - 9, guardianAttestedAt: new Date(), withdrawnAt: new Date(Date.now() - 5 * 86_400_000) } })
    await sweep.sweepClassroom({ killAll: false })
    expect(await db.classroomLearner.count({ where: { id: old.id } })).toBe(0)
    expect(await db.classroomLearner.count({ where: { id: recent.id } })).toBe(1)
  })

  it('⛔ the kill switch: a sweep with mode off ends every live session at once', async () => {
    const seat = await activeSeat()
    const s = await start.startLearnerSession(seat.id, parentId)
    await db.$executeRaw`UPDATE public.classroom_config SET mode = 'off' WHERE id = 1`
    await sweep.sweepClassroom({ killAll: true })
    expect(await db.classroomSession.findUnique({ where: { id: s.id } })).toMatchObject({ status: 'ended', endReason: 'kill_switch' })
  })

  it('⛔ deleting a child erases every row of theirs (the likeness queue and its cascade: ddl.pg.test.ts)', async () => {
    const seat = await newSeat()
    const { learnerId } = await join.claimSeat(seat.inviteCode!, account(parentId), { who: 'child', displayName: 'Bao', birthYear: new Date().getFullYear() - 5, guardian: notices.GUARDIAN_NOTICE_VERSION, ...consents() })
    const s = await start.startLearnerSession(seat.id, parentId)
    await db.classroomLearner.delete({ where: { id: learnerId } })
    expect(await db.classroomSession.count({ where: { id: s.id } })).toBe(0)
    expect(await db.classroomEnrollment.count({ where: { id: seat.id } })).toBe(0)
  })
})
