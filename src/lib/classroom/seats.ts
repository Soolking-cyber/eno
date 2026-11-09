import 'server-only'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import type { PublishBlockCode } from '@/lib/publish-guard'
import { LEVELS, LIMITS, SESSION_MINUTES, STRICTNESS, type Level, type SessionMinutes, type Strictness } from './constants'
import { inviteCodeFrom } from './invite-code'
import { cleanText, parseTraits } from './persona'
import type { Background } from './backgrounds'
import { okRoomIds, roomOf } from './backgrounds-upload'
import { ageBand, ictWeekStart, type AgeBand } from './limits'

export type SeatSettings = {
  seatName: string
  level: Level
  sessionMinutes: SessionMinutes
  sessionsPerWeek: number
  strictness: Strictness
  focusNote: string
}

export type SeatRefusal = 'seat_name_required' | 'bad_request' | PublishBlockCode

const SEAT_NAME_MAX = 60
const FOCUS_NOTE_MAX = 500

/** Submitted settings → what may be saved (a partial update keeps the current values for what it leaves out). Pure. */
export function validateSeatSettings(raw: Record<string, unknown>, current?: SeatSettings): { ok: true; value: SeatSettings } | { ok: false; code: SeatRefusal } {
  const pick = <T,>(key: string, ok: (v: unknown) => v is T, fallback: T | undefined): T | undefined => (key in raw ? (ok(raw[key]) ? raw[key] : undefined) : fallback)
  const seatName = 'seatName' in raw ? cleanText(raw.seatName, SEAT_NAME_MAX).replace(/\n/g, ' ') : current?.seatName ?? ''
  if (!seatName) return { ok: false, code: 'seat_name_required' }
  const level = pick('level', (v): v is Level => (LEVELS as readonly unknown[]).includes(v), current?.level ?? 'A2')
  const sessionMinutes = pick('sessionMinutes', (v): v is SessionMinutes => (SESSION_MINUTES as readonly unknown[]).includes(v), current?.sessionMinutes ?? 10)
  const sessionsPerWeek = pick('sessionsPerWeek', (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= LIMITS.sessionsPerWeekMax, current?.sessionsPerWeek ?? 3)
  const strictness = pick('strictness', (v): v is Strictness => (STRICTNESS as readonly unknown[]).includes(v), current?.strictness ?? 'balanced')
  const focusNote = 'focusNote' in raw ? cleanText(raw.focusNote, FOCUS_NOTE_MAX) : current?.focusNote ?? ''
  if (level === undefined || sessionMinutes === undefined || sessionsPerWeek === undefined || strictness === undefined) return { ok: false, code: 'bad_request' }
  for (const text of [seatName, focusNote]) {
    const code = teacherTextRefusal('bio', text)
    if (code) return { ok: false, code }
  }
  return { ok: true, value: { seatName, level, sessionMinutes, sessionsPerWeek, strictness, focusNote } }
}

export function newInvite(now = new Date()): { inviteCode: string; inviteExpiresAt: Date } {
  return { inviteCode: inviteCodeFrom((n) => randomBytes(n)), inviteExpiresAt: new Date(now.getTime() + LIMITS.inviteDays * 86_400_000) }
}

/**
 * WHERE A STUDENT STANDS THIS WEEK (owner, 2026-11-09: teachers "manage" each student's tutor — Praktika's business view:
 * on track / below target / inactive / never started). From the seat's own rows only. Pure.
 * - not_started: invited and not joined, or joined and never spoke in a session;
 * - inactive: the last session they spoke in is LIMITS.inactiveDays or more ago;
 * - behind: fewer sessions this week than the week's target, prorated to the days gone (Monday is day 1, ICT);
 * - on_track: otherwise; paused: the teacher paused the seat.
 */
export type SeatProgress = 'not_started' | 'on_track' | 'behind' | 'inactive' | 'paused'
export function progressOf(s: { status: string; lastSpokeAt: Date | null; sessionsThisWeek: number; sessionsPerWeek: number }, now: Date): SeatProgress {
  if (s.status === 'paused') return 'paused'
  if (s.status !== 'active' || !s.lastSpokeAt) return 'not_started'
  if (now.getTime() - s.lastSpokeAt.getTime() >= LIMITS.inactiveDays * 86_400_000) return 'inactive'
  const daysGone = Math.min(7, Math.floor((now.getTime() - ictWeekStart(now).getTime()) / 86_400_000) + 1)
  const due = Math.floor((s.sessionsPerWeek * daysGone) / 7)
  return s.sessionsThisWeek < due ? 'behind' : 'on_track'
}

export type RosterSeat = {
  id: string
  status: string
  seatName: string
  /** The seat's tutor (several per teacher since 2026-11-09). */
  tutor: { id: string; name: string; look: string; libraryAvatarId: string | null; background: Background; backgroundThumbUrl: string | null }
  progress: SeatProgress
  /** Minutes spoken in this week's sessions, against the week's target (minutes × sessions a week). */
  minutesThisWeek: number
  minutesTarget: number
  settings: SeatSettings
  learner: null | { displayName: string; kind: string; band: AgeBand }
  invite: null | { code: string; expiresAt: string }
  lastPracticeAt: string | null
  sessionsThisWeek: number
  unseenReports: number
}

/** The teacher's roster across all their tutors: every seat but the removed ones, with what the roster shows at a glance. */
export async function listSeats(teacherProfileId: string, now = new Date()): Promise<RosterSeat[]> {
  const weekStart = ictWeekStart(now)
  const seats = await db.classroomEnrollment.findMany({
    where: { avatar: { teacherProfileId }, status: { not: 'removed' } },
    orderBy: { createdAt: 'asc' },
    include: {
      learner: { select: { displayName: true, kind: true, birthYear: true } },
      avatar: { select: { id: true, name: true, look: true, libraryAvatarId: true, traits: true, backgroundId: true } },
      sessions: { orderBy: { startedAt: 'desc' }, take: 1, select: { startedAt: true } },
    },
  })
  const ids = seats.map((s) => s.id)
  const [week, unseen, spoke] = ids.length ? await Promise.all([
    // Sessions the learner SPOKE in — the rule the week's limit applies (limits.ts frequencyRefusal).
    db.classroomSession.groupBy({ by: ['enrollmentId'], where: { enrollmentId: { in: ids }, startedAt: { gte: weekStart }, turnCount: { gt: 0 } }, _count: { _all: true }, _sum: { usedSeconds: true } }),
    db.classroomSession.groupBy({ by: ['enrollmentId'], where: { enrollmentId: { in: ids }, feedbackStatus: 'ready', feedback: { is: { teacherSeenAt: null } } }, _count: { _all: true } }),
    db.classroomSession.groupBy({ by: ['enrollmentId'], where: { enrollmentId: { in: ids }, turnCount: { gt: 0 } }, _max: { startedAt: true } }),
  ]) : [[], [], []]
  const okRooms = await okRoomIds(seats.map((s) => s.avatar.backgroundId))
  const weekBy = new Map(week.map((r) => [r.enrollmentId, r]))
  const unseenBy = new Map(unseen.map((r) => [r.enrollmentId, r._count._all]))
  const spokeBy = new Map(spoke.map((r) => [r.enrollmentId, r._max.startedAt]))
  return seats.map((s) => ({
    id: s.id,
    status: s.status,
    seatName: s.seatName,
    tutor: { id: s.avatar.id, name: s.avatar.name, look: s.avatar.look, libraryAvatarId: s.avatar.libraryAvatarId, background: parseTraits(s.avatar.traits).background, backgroundThumbUrl: roomOf(s.avatar, okRooms).backgroundThumbUrl },
    progress: progressOf({ status: s.status, lastSpokeAt: spokeBy.get(s.id) ?? null, sessionsThisWeek: weekBy.get(s.id)?._count._all ?? 0, sessionsPerWeek: s.sessionsPerWeek }, now),
    minutesThisWeek: Math.round((weekBy.get(s.id)?._sum.usedSeconds ?? 0) / 60),
    minutesTarget: s.sessionMinutes * s.sessionsPerWeek,
    settings: settingsOf(s),
    learner: s.learner && {
      displayName: s.learner.displayName,
      kind: s.learner.kind,
      band: ageBand(s.learner.kind === 'child' ? 'child' : 'self', s.learner.birthYear, now),
    },
    invite: s.status === 'invited' && s.inviteCode && s.inviteExpiresAt && s.inviteExpiresAt > now
      ? { code: s.inviteCode, expiresAt: s.inviteExpiresAt.toISOString() } : null,
    lastPracticeAt: s.sessions[0]?.startedAt.toISOString() ?? null,
    sessionsThisWeek: weekBy.get(s.id)?._count._all ?? 0,
    unseenReports: unseenBy.get(s.id) ?? 0,
  }))
}

export function settingsOf(s: { seatName: string; level: string; sessionMinutes: number; sessionsPerWeek: number; strictness: string; focusNote: string }): SeatSettings {
  return {
    seatName: s.seatName,
    level: (LEVELS as readonly string[]).includes(s.level) ? (s.level as Level) : 'A2',
    sessionMinutes: (SESSION_MINUTES as readonly number[]).includes(s.sessionMinutes) ? (s.sessionMinutes as SessionMinutes) : 10,
    sessionsPerWeek: s.sessionsPerWeek,
    strictness: (STRICTNESS as readonly string[]).includes(s.strictness) ? (s.strictness as Strictness) : 'balanced',
    focusNote: s.focusNote,
  }
}

/** The teacher's own seat, or null — every seat route looks the seat up THROUGH the caller's tutors, never by id alone. */
export async function seatOfTeacher(seatId: string, teacherProfileId: string) {
  return db.classroomEnrollment.findFirst({ where: { id: seatId, avatar: { teacherProfileId } } })
}
