import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { draftResumeStep, fromDraft, isEmptyTeacher, isTeacherStep } from '@/components/teachers/teacher-form-rules'
import type { TeacherInput, TeacherStep } from '@/lib/teachers/profile'
import type { Prisma } from '@/generated/prisma/client'

/**
 * ⛔ A TEACHER'S UNFINISHED PROFILE, ON THE SERVER (owner, 2026-10-11: "every step they input should be saved and able to
 * resume when they want to", and a "continue" row in the dashboard once step 1 has answers). The TeacherDraft table
 * (scripts/teachers-ddl.mjs): one row per account, PRIVATE — no public, matcher, school or feed reader touches it.
 *   · WHAT IT HOLDS: the form's answers through forDraft — ⛔ never a consent, an upload or the cover switch (each is asked
 *     again where it is given) — and ⛔ never the phone (owner's default, 2026-10-11: asked again on the last step). The
 *     step to reopen on. Nothing ELSE happens on a save: no moderation, translation, matcher, analytics or Meta event.
 *   · CONCURRENCY: an integer revision. A save names the revision it was based on and bumps it — a conditional update
 *     (two tabs or devices: the later one is refused `stale`, never silently overwrites); the first save inserts only if
 *     there is no row (`stale` when another got there first). A save based on a revision whose row is gone — Start over,
 *     publish, the 90-day retention — is refused `gone`: a late save never resurrects a draft.
 *   · UNDER THE PUBLISH'S LOCK (the per-account advisory lock saveTeacherProfile takes): a save that lands beside or after
 *     a publish sees the profile and is refused `teacher_exists` — the publish deletes the draft in its transaction.
 *   · RETENTION: deleted 90 days after its last change (purgeStaleTeacherDrafts, a daily job), on publish, on Start over,
 *     and with the account (the foreign key). /privacy says so; the account export includes it.
 */
export const TEACHER_DRAFT_RETENTION_DAYS = 90
/**
 * A backstop, never a limit a teacher meets: every field is capped by normalizeTeacherInput first (LIMITS), and the
 * fullest answer set — every field at its cap, in 3-byte Vietnamese — is ~18 KB (draft.test.ts). 64 KB is also what a
 * page-hide `keepalive` save may carry.
 */
export const TEACHER_DRAFT_MAX_BYTES = 65_536

/** What the server keeps of a body — and re-applies on every read, so a row never hands back more than this. */
export function draftDataOf(raw: unknown): TeacherInput {
  return { ...fromDraft(raw), phone: '' }
}

export type TeacherDraftRow = { t: TeacherInput; step: TeacherStep; rev: number; updatedAt: Date }

export async function readTeacherDraft(profileId: string): Promise<TeacherDraftRow | null> {
  const row = await db.teacherDraft.findUnique({ where: { profileId }, select: { data: true, step: true, rev: true, updatedAt: true } })
  if (!row) return null
  return { t: draftDataOf(row.data), step: isTeacherStep(row.step) ? row.step : 'plans', rev: row.rev, updatedAt: row.updatedAt }
}

export type SaveTeacherDraftResult =
  | { ok: true; rev: number; updatedAt: Date }
  | { ok: false; reason: 'stale' | 'gone' | 'teacher_exists' | 'too_large' | 'bad_request' }

export async function saveTeacherDraft(profileId: string, body: unknown): Promise<SaveTeacherDraftResult> {
  const b = (body && typeof body === 'object' ? body : {}) as { t?: unknown; step?: unknown; rev?: unknown }
  const base = typeof b.rev === 'number' && Number.isInteger(b.rev) && b.rev >= 0 ? b.rev : null
  if (base === null || !b.t || typeof b.t !== 'object') return { ok: false, reason: 'bad_request' }
  const data = draftDataOf(b.t)
  // Nothing answered is nothing to keep — and never a "Continue" row for an empty form.
  if (isEmptyTeacher(data)) return { ok: false, reason: 'bad_request' }
  const json = JSON.stringify(data)
  if (Buffer.byteLength(json, 'utf8') > TEACHER_DRAFT_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const step: TeacherStep = isTeacherStep(b.step) ? b.step : 'plans'
  const value = data as unknown as Prisma.InputJsonValue
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    if (await tx.teacherProfile.findUnique({ where: { profileId }, select: { id: true } })) return { ok: false, reason: 'teacher_exists' } as const
    const now = new Date()
    if (base === 0) {
      // The first save: only when there is no row — another tab or device that got there first is never overwritten.
      const { count } = await tx.teacherDraft.createMany({ data: [{ profileId, data: value, step, rev: 1, createdAt: now, updatedAt: now }], skipDuplicates: true })
      return count === 1 ? { ok: true, rev: 1, updatedAt: now } as const : { ok: false, reason: 'stale' } as const
    }
    const { count } = await tx.teacherDraft.updateMany({ where: { profileId, rev: base }, data: { data: value, step, rev: base + 1, updatedAt: now } })
    if (count === 1) return { ok: true, rev: base + 1, updatedAt: now } as const
    const still = await tx.teacherDraft.findUnique({ where: { profileId }, select: { rev: true } })
    return { ok: false, reason: still ? 'stale' : 'gone' } as const
  })
}

/**
 * "Start over". Under the same per-account lock as a save, so a first save that already holds it lands BEFORE the
 * delete, never after it (commit gate, codex + opus: an unlocked delete could find no row while that insert was on its
 * way, and the draft came back). The publish deletes it inside its own transaction (publish.ts).
 */
export async function deleteTeacherDraft(profileId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    await tx.teacherDraft.deleteMany({ where: { profileId } })
  })
}

/** The daily retention: drafts untouched for TEACHER_DRAFT_RETENTION_DAYS. */
export async function purgeStaleTeacherDrafts(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - TEACHER_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await db.teacherDraft.deleteMany({ where: { updatedAt: { lt: before } } })
  return count
}

/**
 * The dashboard's "Step X of Y · Continue" — METADATA ONLY: the dashboard response is cached in the browser
 * (use-dashboard.ts, localStorage), so it never carries an answer.
 */
export async function teacherDraftProgress(profileId: string): Promise<{ index: number; total: number } | null> {
  // ⛔ NEVER THE DASHBOARD'S FAILURE: /api/dashboard reads this on every load, so an unreadable draft (the table not yet
  // created — the DDL runs before the deploy — or a bad row) costs only the "Continue" row, never the dashboard.
  try {
    const d = await readTeacherDraft(profileId)
    if (!d) return null
    const { index, total } = draftResumeStep(d.t, d.step)
    return { index, total }
  } catch (e) {
    logError(e, { op: 'teachers.draftProgress' })
    return null
  }
}

/** The account export (the access right): the draft as stored. */
export async function teacherDraftExportOf(profileId: string): Promise<{ answers: TeacherInput; step: string; createdAt: string; updatedAt: string } | null> {
  const row = await db.teacherDraft.findUnique({ where: { profileId }, select: { data: true, step: true, createdAt: true, updatedAt: true } })
  return row ? { answers: draftDataOf(row.data), step: row.step, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } : null
}
