import 'server-only'
import { db } from '@/lib/db'
import { classroomOpenFor } from './config'
import { LIMITS } from './constants'
import { effectiveMinutes, ictDayStart, ictWeekStart } from './limits'
import { parseFocus, pickPlan } from './plans'
import { parseTraits } from './persona'
import type { Background } from './backgrounds'

/**
 * What /classroom shows a signed-in account (GET /api/classroom/me): their teacher side (when they have a TeacherProfile)
 * and the learners they own with each one's seats. One read for the home screen — the page itself carries no personal
 * data, so it stays a static shell (the /teachers/edit pattern).
 *
 * ⚠️ A LEARNER'S CLASS IS OPEN WHEN ITS TEACHER IS ADMITTED (config.ts: learners follow their teacher), so `open` is
 * computed per seat from the seat's teacher account, never from the learner's own account.
 */
export type ClassroomMe = {
  teacher: null | {
    teacherProfileId: string
    fullName: string
    photoUrl: string | null
    nationality: string
    open: boolean
    avatar: null | { id: string; name: string; look: string; customStatus: string; libraryAvatarId: string | null; voice: string; background: Background }
  }
  learners: {
    id: string
    kind: 'self' | 'child'
    displayName: string
    birthYear: number | null
    seats: {
      id: string
      status: string
      teacherName: string
      teacherPhotoUrl: string | null
      avatarName: string
      /** The room the teacher set behind the avatar (backgrounds.ts) — the session's intro shows it before Start. */
      avatarBackground: Background
      open: boolean
      minutes: number
      sessionsPerWeek: number
      sessionsThisWeek: number
      practisedToday: boolean
      liveSessionId: string | null
      /** What the next session is about — the first goal of the plan waiting, else its brief. */
      nextTopic: string | null
      reports: { id: string; startedAt: string; feedbackStatus: string; summary: string; scores: unknown; unseen: boolean }[]
    }[]
  }[]
}

export async function classroomMe(profileId: string, now = new Date()): Promise<ClassroomMe> {
  const tp = await db.teacherProfile.findUnique({
    where: { profileId },
    select: {
      id: true, fullName: true, photoUrl: true, nationality: true,
      classroomAvatar: { select: { id: true, name: true, look: true, customStatus: true, libraryAvatarId: true, voice: true, traits: true } },
    },
  })
  const learners = await db.classroomLearner.findMany({
    where: { ownerId: profileId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, kind: true, displayName: true, birthYear: true,
      seats: {
        where: { status: { in: ['active', 'paused'] } },
        orderBy: { claimedAt: 'asc' },
        select: {
          id: true, status: true, sessionMinutes: true, sessionsPerWeek: true,
          avatar: { select: { name: true, traits: true, teacherProfile: { select: { fullName: true, photoUrl: true, profileId: true } } } },
          plans: { where: { status: { not: 'used' } }, orderBy: { updatedAt: 'desc' }, take: 10 },
          sessions: {
            orderBy: { startedAt: 'desc' },
            // A week holds up to 3 starts a day (silent ones included) — the window must cover all of them (2b round 2).
            take: 40,
            select: { id: true, learnerId: true, startedAt: true, status: true, turnCount: true, feedbackStatus: true, feedback: { select: { summary: true, scores: true, learnerSeenAt: true } } },
          },
        },
      },
    },
  })

  // One switch read per distinct teacher account (the cache makes repeats free).
  const openCache = new Map<string, Promise<boolean>>()
  const openFor = (accountId: string) => {
    if (!openCache.has(accountId)) openCache.set(accountId, classroomOpenFor(accountId).then((r) => r.open))
    return openCache.get(accountId)!
  }

  return {
    teacher: tp && {
      teacherProfileId: tp.id,
      fullName: tp.fullName,
      photoUrl: tp.photoUrl,
      nationality: tp.nationality,
      open: await openFor(profileId),
      avatar: tp.classroomAvatar && (({ traits, ...a }) => ({ ...a, background: parseTraits(traits).background }))(tp.classroomAvatar),
    },
    learners: await Promise.all(learners.map(async (l) => ({
      id: l.id,
      kind: l.kind === 'child' ? ('child' as const) : ('self' as const),
      displayName: l.displayName,
      birthYear: l.birthYear,
      seats: await Promise.all(l.seats.map(async (s) => {
        const weekStart = ictWeekStart(now)
        const dayStart = ictDayStart(now)
        // This learner's own sessions; only those they SPOKE in count towards the week and the day (limits.ts), and the
        // day also ends at LIMITS.startsPerDay starts — the same rule session-start.ts applies.
        const mine = s.sessions.filter((x) => x.learnerId === l.id)
        const spoke = mine.filter((x) => x.turnCount > 0)
        const next = pickPlan(s.plans)
        const kind = l.kind === 'child' ? 'child' : 'self'
        return {
          id: s.id,
          status: s.status,
          teacherName: s.avatar.teacherProfile.fullName,
          teacherPhotoUrl: s.avatar.teacherProfile.photoUrl,
          avatarName: s.avatar.name,
          avatarBackground: parseTraits(s.avatar.traits).background,
          open: await openFor(s.avatar.teacherProfile.profileId),
          minutes: effectiveMinutes(s.sessionMinutes, kind, l.birthYear, now),
          sessionsPerWeek: s.sessionsPerWeek,
          sessionsThisWeek: spoke.filter((x) => x.startedAt >= weekStart).length,
          practisedToday: spoke.some((x) => x.startedAt >= dayStart) || mine.filter((x) => x.startedAt >= dayStart).length >= LIMITS.startsPerDay,
          liveSessionId: mine.find((x) => x.status === 'live')?.id ?? null,
          nextTopic: next ? (parseFocus(next.focus).goals[0] ?? next.brief.slice(0, 120)) : null,
          reports: mine.filter((x) => x.status === 'ended').slice(0, 5).map((x) => ({
            id: x.id,
            startedAt: x.startedAt.toISOString(),
            feedbackStatus: x.feedbackStatus,
            summary: x.feedback?.summary ?? '',
            scores: x.feedback?.scores ?? null,
            unseen: x.feedbackStatus === 'ready' && !!x.feedback && !x.feedback.learnerSeenAt,
          })),
        }
      })),
    }))),
  }
}
