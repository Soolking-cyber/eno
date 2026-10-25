import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { logError, logWarn } from '@/lib/log'
import { rateLimit, kv } from '@/lib/ratelimit'
import { chargeAiTeacherReserve } from '@/lib/ai-guard'
import { getGeminiVertex } from '@/lib/gemini'
import { teacherBioRequest } from '@/lib/teachers/bio-context'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { classroomAuditAlone, noticeSha } from '@/lib/classroom/audit'
import { PERSONA_AI_NOTICE_VERSION, personaAiNoticeBody } from '@/lib/classroom/notices'
import { AVATAR_NAME_MAX, PERSONA_MAX, cleanText, parseTraits } from '@/lib/classroom/persona'
import { draftPersona } from '@/lib/classroom/persona-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NOTICE_SHA = noticeSha(personaAiNoticeBody())
const NO_STORE = { 'cache-control': 'private, no-store' }
const PER_HOUR = 10
const PER_DAY = 30
const FEATURE_PER_DAY = 500

/**
 * POST /api/classroom/avatar/persona-ai — WRITE WITH AI: a persona + greeting drafted by Gemini 3.8 Flash from the teacher's
 * own profile (notices.ts says what is sent). The answer is a DRAFT the teacher reads and edits; nothing is saved here.
 * The bio route's shape (src/app/api/teachers/me/bio-rewrite): one at a time per account, the account's limits before the
 * shared ones, the teacher reserve, and the consent record BEFORE anything leaves.
 */
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  const ai = getGeminiVertex()
  if (!ai) throw new ApiError('ai_unavailable', 503)
  const teacher = await requireTeacher(profile.id)
  const body = await readCapped(req, 8_000)
  if (body.notice !== PERSONA_AI_NOTICE_VERSION) {
    return NextResponse.json({ error: 'notice_changed', notice: 'classroom_persona' }, { status: 409, headers: NO_STORE })
  }

  // ⛔ ONE DRAFT AT A TIME PER ACCOUNT (the bio route's owned lock): a second tap never pays twice.
  const busyKey = `classroom-persona:busy:${profile.id}`
  const busyToken = randomUUID()
  if ((await kv.set(busyKey, busyToken, { nx: true, ex: 90 })) !== 'OK') throw new ApiError('rate_limited', 429)
  try {
    if (!(await rateLimit('classroom-persona', profile.id, PER_HOUR, '1 h', { strict: true })).success) throw new ApiError('rate_limited', 429)
    if (!(await rateLimit('classroom-persona-day', profile.id, PER_DAY, '1 d', { strict: true })).success) throw new ApiError('rate_limited', 429)
    if (!(await rateLimit('classroom-persona-global', 'all', FEATURE_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('ai_unavailable', 503)
    if (!(await chargeAiTeacherReserve())) throw new ApiError('ai_unavailable', 503)

    // What is sent: the profile's facts through the bio route's own reader (contact details removed — bio-context.ts),
    // the chips, the avatar's name and the teacher's own note. Never the name, phone, email, photo, video or CV fields.
    const row = await db.teacherProfile.findUnique({ where: { id: teacher.id } })
    const bio = teacherBioRequest(row ?? {})
    const facts = [...bio.facts, ...(bio.ownBio ? [`About (the teacher's own words): ${bio.ownBio}`] : [])]
    const request = {
      avatarName: cleanText(body.name, AVATAR_NAME_MAX).replace(/\n/g, ' '),
      traits: parseTraits(body.traits),
      facts,
      ownText: cleanText(body.persona, PERSONA_MAX),
    }

    // ⛔ THE CONSENT RECORD BEFORE THE TRANSFER — counts only, never a word of the text. If this write fails, nothing leaves.
    try {
      await classroomAuditAlone(profile.id, 'classroom.persona.consent', {
        notice: PERSONA_AI_NOTICE_VERSION, noticeSha: NOTICE_SHA, facts: facts.length, ownText: request.ownText.length > 0,
      })
    } catch (e) {
      logError(e, { op: 'classroom.persona.audit' })
      throw new ApiError('ai_unavailable', 503)
    }

    const draft = await draftPersona(ai, request)
    if (!draft.ok) {
      if (draft.failure === 'model') logWarn('[classroom] persona draft: no answer', { calls: draft.calls })
      else logWarn('[classroom] persona draft refused', { reason: draft.reason, calls: draft.calls })
      throw new ApiError('ai_failed', 502)
    }
    return NextResponse.json({ persona: draft.persona, greeting: draft.greeting }, { headers: NO_STORE })
  } finally {
    // Owned release, in ONE statement (2c round 2, codex): only while the lock still holds THIS request's token — a
    // get-then-delete could remove a successor's lock taken in between. kv_store holds the token as a JSON string.
    await db.$executeRaw`DELETE FROM public.kv_store WHERE key = ${busyKey} AND value = ${JSON.stringify(busyToken)}::jsonb`
      .catch((e) => logError(e, { op: 'classroom.persona.unlock' }))
  }
})
