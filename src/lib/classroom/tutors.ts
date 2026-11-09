import 'server-only'
import { ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { LIMITS } from './constants'
import { AVATAR_SELECT, avatarData, type AvatarInput } from './avatar'
import { DEFAULT_TRAITS } from './persona'
import { defaultVoice, voiceById, voiceFor } from './voices'

/**
 * A TEACHER'S TUTORS (owner, 2026-11-09: "teachers assign and manage ai tutor for each of their students"). A tutor is a
 * ClassroomAvatar row: face, voice, background and character. A teacher keeps up to LIMITS.tutorsPerTeacher at once; every
 * seat names its own (ClassroomEnrollment.avatarId), and a new seat gets the teacher's oldest one unless the teacher picks.
 *
 * ⛔ ONE LOCK PER TEACHER for everything that counts or moves seats and tutors: making a tutor (the cap), archiving one (no
 * seat may still name it), making a seat (the seat cap) and moving a seat to another tutor. Without it a tutor could be
 * archived in the same instant a seat moves onto it, or two quick taps could both pass a count.
 *
 * ⛔ A TUTOR IS ARCHIVED, NEVER DELETED: its seats cascade on delete (the FK), and its sessions and reports keep naming it.
 */
export const teacherLock = (teacherProfileId: string) => `eno-classroom-teacher:${teacherProfileId}`

const ORDER = [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
/** The plain client or a transaction's: a read inside a transaction uses ITS connection (commit gate, opus — two at once per request). */
type Client = Pick<Prisma.TransactionClient, 'classroomAvatar'>

export type Tutor = Awaited<ReturnType<typeof listTutors>>[number]

/** The teacher's tutors, oldest first (the oldest is a new seat's default), each with how many students it has. */
export async function listTutors(teacherProfileId: string) {
  const rows = await db.classroomAvatar.findMany({
    where: { teacherProfileId, archivedAt: null },
    orderBy: ORDER,
    select: { ...AVATAR_SELECT, _count: { select: { seats: { where: { status: { not: 'removed' } } } } } },
  })
  return rows.map(({ _count, ...t }) => ({ ...t, students: _count.seats }))
}

/** One of the teacher's own tutors that is not archived, or null — every tutor route looks a tutor up THROUGH its teacher. */
export async function tutorOfTeacher(tutorId: unknown, teacherProfileId: string, client: Client = db) {
  if (typeof tutorId !== 'string' || !tutorId || tutorId.length > 64) return null
  return client.classroomAvatar.findFirst({ where: { id: tutorId, teacherProfileId, archivedAt: null } })
}

/** The teacher's oldest tutor that is not archived: a new seat's tutor and a try's when none is named. */
export async function defaultTutor(teacherProfileId: string, client: Client = db) {
  return client.classroomAvatar.findFirst({ where: { teacherProfileId, archivedAt: null }, orderBy: ORDER })
}

/** The teacher's tutor that holds their own face (a likeness requested or ready), or null — one per teacher. */
export async function likenessTutor(teacherProfileId: string) {
  return db.classroomAvatar.findFirst({ where: { teacherProfileId, customStatus: { in: ['requested', 'ready'] } }, orderBy: ORDER })
}

export async function createTutor(teacherProfileId: string, v: AvatarInput) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacherProfileId)}, 0))`
    const n = await tx.classroomAvatar.count({ where: { teacherProfileId, archivedAt: null } })
    if (n >= LIMITS.tutorsPerTeacher) throw new ApiError('tutor_limit', 409)
    return tx.classroomAvatar.create({ data: { teacherProfileId, ...avatarData(v) }, select: AVATAR_SELECT })
  })
}

/** Only while the tutor is still the teacher's and not archived (an archive in between wins). */
export async function updateTutor(teacherProfileId: string, tutorId: string, v: AvatarInput) {
  const done = await db.classroomAvatar.updateMany({
    where: { id: tutorId, teacherProfileId, archivedAt: null },
    data: { ...avatarData(v), updatedAt: new Date() },
  })
  if (!done.count) throw new ApiError('tutor_not_found', 404)
  return db.classroomAvatar.findUniqueOrThrow({ where: { id: tutorId }, select: AVATAR_SELECT })
}

/**
 * Archive a tutor. Refused while any seat that is not removed still names it (move those students first), and while it
 * holds the teacher's own face (a likeness requested or ready: withdraw it first, which queues its deletion at Spatius).
 */
export async function archiveTutor(teacherProfileId: string, tutorId: string) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacherProfileId)}, 0))`
    const t = await tx.classroomAvatar.findFirst({ where: { id: tutorId, teacherProfileId, archivedAt: null }, select: { id: true, customStatus: true } })
    if (!t) throw new ApiError('tutor_not_found', 404)
    if (t.customStatus === 'requested' || t.customStatus === 'ready') throw new ApiError('tutor_has_likeness', 409)
    const seats = await tx.classroomEnrollment.count({ where: { avatarId: t.id, status: { not: 'removed' } } })
    if (seats) throw new ApiError('tutor_has_students', 409)
    const now = new Date()
    await tx.classroomAvatar.update({ where: { id: t.id }, data: { archivedAt: now, updatedAt: now } })
  })
}

/**
 * A voice saved before the switch to eno's own voices (2026-10-26, an Azure id) is on no list now: the wizard shows the
 * voice the lessons speak with (voiceFor — same gender and accent group), so the next save is valid and nothing changes
 * under the teacher (codex + opus, commit review).
 */
export function withListedVoice<T extends { voice: string }>(saved: T, nationality: string): T {
  return voiceById(saved.voice) ? saved : { ...saved, voice: (voiceFor(saved.voice) ?? defaultVoice(nationality)).id }
}

/** What a new tutor starts from: the teacher's first name, the voice of their own accent, the default character. */
export function tutorDefaults(teacher: { fullName: string; nationality: string }) {
  return { name: firstName(teacher.fullName), voice: defaultVoice(teacher.nationality).id, traits: DEFAULT_TRAITS }
}

/** "Anna Smith" → "Anna": the name the avatar starts with ("Ms"/"Mr" is the teacher's to add). */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0]?.slice(0, 40) ?? ''
}
