import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import { individualOnboardingWrite } from '@/lib/core/first-onboarding'
import { classroomAudit, noticeSha } from './audit'
import { isInviteCodeShape, normalizeInviteCode } from './invite-code'
import { cleanText } from './persona'
import { childBirthYearOk, needsAssent } from './limits'
import { classroomOpenFor } from './config'
import {
  ADULT_NOTICE_VERSION, ASSENT_VERSION, GUARDIAN_NOTICE_VERSION, PRACTICE_NOTICE_VERSION, TEACHER_VIEW_NOTICE_VERSION,
  adultNoticeBody, assentBody, guardianNoticeBody, practiceNoticeBody, teacherViewNoticeBody,
} from './notices'

type Tx = Prisma.TransactionClient

const SHAS = {
  practice: noticeSha(practiceNoticeBody()),
  teacherView: noticeSha(teacherViewNoticeBody()),
  guardian: noticeSha(guardianNoticeBody()),
  adult: noticeSha(adultNoticeBody()),
  assent: noticeSha(assentBody()),
}

/** The invite as the join page shows it BEFORE sign-in — whose class, which seat. Nothing about any learner. */
export async function invitePreview(raw: string, now = new Date()) {
  const code = normalizeInviteCode(raw)
  if (!isInviteCodeShape(code)) return null
  const seat = await db.classroomEnrollment.findUnique({
    where: { inviteCode: code },
    select: {
      status: true, seatName: true, inviteExpiresAt: true,
      avatar: { select: { name: true, teacherProfile: { select: { fullName: true, photoUrl: true } } } },
    },
  })
  if (!seat || seat.status !== 'invited' || !seat.inviteExpiresAt || seat.inviteExpiresAt <= now) return null
  return {
    seatName: seat.seatName,
    avatarName: seat.avatar.name,
    teacher: { fullName: seat.avatar.teacherProfile.fullName, photoUrl: seat.avatar.teacherProfile.photoUrl },
    expiresAt: seat.inviteExpiresAt.toISOString(),
  }
}

export type JoinRequest =
  | { who: 'self'; adult: string }
  | { who: 'child'; displayName: string; birthYear: number; guardian: string; assent?: string }
  // An existing learner joins another class under the statement that fits it — the guardian's for a child, the adult's
  // for "me" — given AGAIN for this class (2b round 1, codex + opus: the record names only what this request agreed to).
  | { who: 'existing'; learnerId: string; assent?: string; guardian?: string; adult?: string }

export type JoinBody = JoinRequest & { practice: string; teacherView: string }

/** The body → a join request, or the error code. Pure. */
export function parseJoin(raw: Record<string, unknown>): JoinBody | { error: 'bad_request' | 'notice_changed' } {
  if (raw.practice !== PRACTICE_NOTICE_VERSION || raw.teacherView !== TEACHER_VIEW_NOTICE_VERSION) return { error: 'notice_changed' }
  const consents = { practice: PRACTICE_NOTICE_VERSION, teacherView: TEACHER_VIEW_NOTICE_VERSION }
  const assent = raw.assent === undefined ? undefined : raw.assent === ASSENT_VERSION ? ASSENT_VERSION : null
  if (assent === null) return { error: 'notice_changed' }
  // "Me" is the account holder's own statement that they are 18+ (round 8, opus) — recorded like the guardian's.
  if (raw.who === 'self') return raw.adult === ADULT_NOTICE_VERSION ? { who: 'self', adult: ADULT_NOTICE_VERSION, ...consents } : { error: 'notice_changed' }
  if (raw.who === 'existing' && typeof raw.learnerId === 'string' && raw.learnerId.length <= 40) {
    return {
      who: 'existing', learnerId: raw.learnerId, assent, ...consents,
      ...(raw.guardian === GUARDIAN_NOTICE_VERSION ? { guardian: GUARDIAN_NOTICE_VERSION } : {}),
      ...(raw.adult === ADULT_NOTICE_VERSION ? { adult: ADULT_NOTICE_VERSION } : {}),
    }
  }
  if (raw.who === 'child') {
    if (raw.guardian !== GUARDIAN_NOTICE_VERSION) return { error: 'notice_changed' }
    const displayName = cleanText(raw.displayName, 40).replace(/\n/g, ' ')
    const birthYear = Number(raw.birthYear)
    if (!displayName || !Number.isInteger(birthYear)) return { error: 'bad_request' }
    return { who: 'child', displayName, birthYear, guardian: GUARDIAN_NOTICE_VERSION, assent, ...consents }
  }
  return { error: 'bad_request' }
}

type Account = { id: string; accountType: string | null; displayName: string | null; tosVersion: string | null }

/**
 * CLAIM A SEAT — one transaction: the seat row locked FOR UPDATE (two taps, or two people with a forwarded link, cannot
 * both claim it), the learner made or reused, every consent recorded in the compliance log BESIDE the rows it covers, the
 * seat bound and its code cleared. Throws ApiError with the code the page explains.
 * ⛔ A new account that signed in on the join page was never sent to /onboard (onboarding-gate.ts resumesInPlace): the
 * account step is recorded HERE, as the teacher form records it at Publish — an individual account and the Terms the
 * page showed beside "Join" (first-onboarding.ts individualOnboardingWrite) — and only where none was chosen yet.
 */
export async function claimSeat(raw: string, account: Account, req: JoinBody, now = new Date()): Promise<{ seatId: string; learnerId: string; onboarded: boolean }> {
  const code = normalizeInviteCode(raw)
  if (!isInviteCodeShape(code)) throw new ApiError('invite_invalid', 404)
  return db.$transaction(async (tx) => {
    // ⛔ ONE JOIN PER ACCOUNT AT A TIME (core review, opus): two invites claimed at once by one family would both find no
    // "me" learner, or no seat in the class, and make two — the DDL's partial unique indexes (ClassroomLearner_one_self,
    // ClassroomEnrollment_one_seat_per_class) would then fail the second with a bare 500. Taken before the seat's row lock,
    // and nothing takes them in the other order.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-account:${account.id}`}, 0))`
    const rows = await tx.$queryRaw<{ id: string; status: string; inviteExpiresAt: Date | null; avatarId: string }[]>`
      SELECT "id", "status", "inviteExpiresAt", "avatarId" FROM "ClassroomEnrollment" WHERE "inviteCode" = ${code} FOR UPDATE`
    const seat = rows[0]
    if (!seat || seat.status !== 'invited' || !seat.inviteExpiresAt || seat.inviteExpiresAt <= now) throw new ApiError('invite_invalid', 404)
    const owner = await tx.classroomAvatar.findUnique({ where: { id: seat.avatarId }, select: { teacherProfile: { select: { profileId: true } } } })
    if (owner?.teacherProfile.profileId === account.id) throw new ApiError('invite_own', 409)
    // A class that cannot run takes no family's consents (2b round 1, opus): the teacher's switch, read here too.
    if (!owner || !(await classroomOpenFor(owner.teacherProfile.profileId)).open) throw new ApiError('classroom_closed', 403)

    const learner = await learnerFor(tx, account.id, req, now)
    const already = await tx.classroomEnrollment.count({ where: { avatarId: seat.avatarId, learnerId: learner.id, status: { in: ['active', 'paused'] } } })
    if (already) throw new ApiError('already_enrolled', 409)

    await classroomAudit(tx, account.id, 'classroom.learner.consent', {
      learnerId: learner.id, seatId: seat.id, kind: learner.kind,
      practice: PRACTICE_NOTICE_VERSION, practiceSha: SHAS.practice,
      teacherView: TEACHER_VIEW_NOTICE_VERSION, teacherViewSha: SHAS.teacherView,
      ...(learner.kind === 'child' ? { guardian: GUARDIAN_NOTICE_VERSION, guardianSha: SHAS.guardian } : {}),
      ...(learner.kind === 'self' ? { adult: ADULT_NOTICE_VERSION, adultSha: SHAS.adult } : {}),
      ...(learner.assented ? { assent: ASSENT_VERSION, assentSha: SHAS.assent } : {}),
    })
    await tx.classroomLearner.update({
      where: { id: learner.id },
      data: {
        practiceConsentVersion: PRACTICE_NOTICE_VERSION, practiceConsentAt: now,
        teacherViewConsentVersion: TEACHER_VIEW_NOTICE_VERSION, teacherViewConsentAt: now,
        withdrawnAt: null, updatedAt: now,
        ...(learner.assented ? { assentAt: now } : {}),
      },
    })
    await tx.classroomEnrollment.update({
      where: { id: seat.id },
      data: { status: 'active', learnerId: learner.id, claimedAt: now, inviteCode: null, updatedAt: now },
    })

    let onboarded = false
    if (account.accountType == null) {
      // The display name is left as sign-in set it: the only name this page asks for is a CHILD's first name, which is
      // never the account's.
      const { data } = individualOnboardingWrite({ displayName: account.displayName, tosVersion: account.tosVersion })
      const written = await tx.profile.updateMany({ where: { id: account.id, accountType: null }, data })
      onboarded = written.count === 1
    }
    return { seatId: seat.id, learnerId: learner.id, onboarded }
  })
}

/** The learner this join is for: reused (the account's own, or one of its children) or made — with its rules. */
async function learnerFor(tx: Tx, accountId: string, req: JoinBody, now: Date): Promise<{ id: string; kind: string; assented: boolean }> {
  if (req.who === 'existing') {
    const l = await tx.classroomLearner.findFirst({ where: { id: req.learnerId, ownerId: accountId }, select: { id: true, kind: true, birthYear: true, assentAt: true } })
    if (!l) throw new ApiError('learner_not_found', 404)
    // The statement that fits this learner, given for THIS class (it is what the record will name).
    if (l.kind === 'child' ? req.guardian !== GUARDIAN_NOTICE_VERSION : req.adult !== ADULT_NOTICE_VERSION) throw new ApiError('notice_changed', 409)
    const must = needsAssent(l.kind === 'child' ? 'child' : 'self', l.birthYear, now)
    if (must && !l.assentAt && req.assent !== ASSENT_VERSION) throw new ApiError('assent_required', 409)
    return { id: l.id, kind: l.kind, assented: must && req.assent === ASSENT_VERSION }
  }
  if (req.who === 'self') {
    const mine = await tx.classroomLearner.findFirst({ where: { ownerId: accountId, kind: 'self' }, select: { id: true } })
    if (mine) return { id: mine.id, kind: 'self', assented: false }
    const profile = await tx.profile.findUnique({ where: { id: accountId }, select: { displayName: true } })
    const displayName = cleanText(profile?.displayName ?? '', 40).replace(/\n/g, ' ') || 'Me'
    const made = await tx.classroomLearner.create({ data: { ownerId: accountId, kind: 'self', displayName, adultAttestedAt: now }, select: { id: true } })
    return { id: made.id, kind: 'self', assented: false }
  }
  if (!childBirthYearOk(req.birthYear, now)) throw new ApiError('birth_year_invalid', 400)
  const refusal = teacherTextRefusal('fullName', req.displayName)
  if (refusal) throw new ApiError(refusal, 400)
  const must = needsAssent('child', req.birthYear, now)
  if (must && req.assent !== ASSENT_VERSION) throw new ApiError('assent_required', 409)
  const children = await tx.classroomLearner.count({ where: { ownerId: accountId, kind: 'child' } })
  if (children >= 6) throw new ApiError('learner_limit', 409)
  const made = await tx.classroomLearner.create({
    data: { ownerId: accountId, kind: 'child', displayName: req.displayName, birthYear: req.birthYear, guardianAttestedAt: now },
    select: { id: true },
  })
  return { id: made.id, kind: 'child', assented: must }
}
