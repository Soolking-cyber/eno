import { randomUUID } from 'node:crypto'
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
 *   · CONCURRENCY: an integer revision AND the draft's generation (a random id given when the draft is made — a draft
 *     deleted and made again has a new one, so revision 3 of the new draft is never mistaken for revision 3 of the old:
 *     commit gate, opus + codex 2026-10-11/12; never a timestamp, which a clock can repeat). A save names both and
 *     bumps the revision — a conditional update
 *     (two tabs or devices: the later one is refused `stale`, never silently overwrites); the first save inserts only if
 *     there is no row (`stale` when another got there first). A save based on a revision whose row is gone — Start over,
 *     publish, the 90-day retention — is refused `gone`: a late save never resurrects a draft.
 *   · UNDER THE PUBLISH'S LOCK (the per-account advisory lock saveTeacherProfile takes): a save that lands beside or after
 *     a publish sees the profile and is refused `teacher_exists` — the publish deletes the draft in its transaction.
 *   · …and WHICH JOB-MATCH SWITCHES THE TEACHER SWITCHED OFF (`optInsOff`, commit gate 2026-10-22): the switches start ON in
 *     a new profile's form (owner decision, 2026-10-22), so a refusal kept only in one tab came back ON in another tab or
 *     on another device — and a Publish then recorded it as "left at its default". A refusal is no consent: the draft
 *     still never holds one.
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

/** A job-match switch the teacher switched off in the form (teacher-form.tsx optInChoice) — only refusals are kept. */
export type OptInRefusal = 'matchEmail' | 'staffCall'
/** The refusals a body or a stored row names — the two known switches, each once; anything else is nothing. */
export function draftRefusalsOf(raw: unknown): OptInRefusal[] {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).optInsOff : undefined
  return Array.isArray(v) ? [...new Set(v.filter((k): k is OptInRefusal => k === 'matchEmail' || k === 'staffCall'))] : []
}

export type TeacherDraftRow = { t: TeacherInput; optInsOff: OptInRefusal[]; step: TeacherStep; rev: number; gen: string; updatedAt: Date }

export async function readTeacherDraft(profileId: string): Promise<TeacherDraftRow | null> {
  const row = await db.teacherDraft.findUnique({ where: { profileId }, select: { data: true, step: true, rev: true, gen: true, updatedAt: true } })
  if (!row) return null
  return { t: draftDataOf(row.data), optInsOff: draftRefusalsOf(row.data), step: isTeacherStep(row.step) ? row.step : 'plans', rev: row.rev, gen: row.gen, updatedAt: row.updatedAt }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A generation as a client sends it back — the id it was given — or null when it is not one. */
export function parseDraftGen(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v.toLowerCase()) ? v.toLowerCase() : null
}

export type SaveTeacherDraftResult =
  | { ok: true; rev: number; gen: string; updatedAt: Date }
  | { ok: false; reason: 'stale' | 'gone' | 'teacher_exists' | 'too_large' | 'bad_request' }

export async function saveTeacherDraft(profileId: string, body: unknown): Promise<SaveTeacherDraftResult> {
  const b = (body && typeof body === 'object' ? body : {}) as { t?: unknown; step?: unknown; rev?: unknown; gen?: unknown }
  const base = typeof b.rev === 'number' && Number.isInteger(b.rev) && b.rev >= 0 && b.rev < 2 ** 31 - 1 ? b.rev : null
  // A save on top of a draft names its generation; a first save (rev 0) may propose the new draft's (the tab's, so it can
  // recognise a cut-off one exactly) — else one is made here.
  const gen = parseDraftGen(b.gen)
  if (base === null || (base > 0 && !gen) || !b.t || typeof b.t !== 'object') return { ok: false, reason: 'bad_request' }
  const data = draftDataOf(b.t)
  // Nothing answered is nothing to keep — and never a "Continue" row for an empty form.
  if (isEmptyTeacher(data)) return { ok: false, reason: 'bad_request' }
  // The refusals ride beside the answers in the same row (draftRefusalsOf reads them back; draftDataOf never sees them).
  const optInsOff = draftRefusalsOf(body)
  const stored = optInsOff.length ? { ...data, optInsOff } : data
  const json = JSON.stringify(stored)
  if (Buffer.byteLength(json, 'utf8') > TEACHER_DRAFT_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const step: TeacherStep = isTeacherStep(b.step) ? b.step : 'plans'
  const value = stored as unknown as Prisma.InputJsonValue
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    if (await tx.teacherProfile.findUnique({ where: { profileId }, select: { id: true } })) return { ok: false, reason: 'teacher_exists' } as const
    const now = new Date()
    if (base === 0) {
      // The first save: only when there is no row — another tab or device that got there first is never overwritten.
      const fresh = gen ?? randomUUID()
      const { count } = await tx.teacherDraft.createMany({ data: [{ profileId, data: value, step, rev: 1, gen: fresh, createdAt: now, updatedAt: now }], skipDuplicates: true })
      return count === 1 ? { ok: true, rev: 1, gen: fresh, updatedAt: now } as const : { ok: false, reason: 'stale' } as const
    }
    const { count } = await tx.teacherDraft.updateMany({ where: { profileId, rev: base, gen: gen! }, data: { data: value, step, rev: base + 1, updatedAt: now } })
    if (count === 1) return { ok: true, rev: base + 1, gen: gen!, updatedAt: now } as const
    const still = await tx.teacherDraft.findUnique({ where: { profileId }, select: { rev: true } })
    return { ok: false, reason: still ? 'stale' : 'gone' } as const
  })
}

/**
 * "Start over". Under the same per-account lock as a save, so a first save that already holds it lands BEFORE the
 * delete, never after it (commit gate, codex + opus: an unlocked delete could find no row while that insert was on its
 * way, and the draft came back). The publish deletes it inside its own transaction (publish.ts).
 */
export async function deleteTeacherDraft(profileId: string, at?: { rev: number; gen: string }): Promise<'deleted' | 'stale'> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    // ⛔ CONDITIONAL, LIKE A SAVE (commit gate, codex 2026-10-11): Start over deletes the revision the tab saw — never
    // a newer one another device saved meanwhile, which the tab has not shown (that is `stale`, and the form asks).
    // No revision (deleteTeacherProfile, the account's own cleanups): whatever is there.
    if (at === undefined) {
      await tx.teacherDraft.deleteMany({ where: { profileId } })
      return 'deleted'
    }
    const { count } = await tx.teacherDraft.deleteMany({ where: { profileId, rev: at.rev, gen: at.gen } })
    if (count === 1) return 'deleted'
    return (await tx.teacherDraft.findUnique({ where: { profileId }, select: { rev: true } })) ? 'stale' : 'deleted'
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

/** The account export (the access right): the draft as stored — the switches the teacher turned off included. */
export async function teacherDraftExportOf(profileId: string): Promise<{ answers: TeacherInput; optInsOff?: OptInRefusal[]; step: string; createdAt: string; updatedAt: string } | null> {
  const row = await db.teacherDraft.findUnique({ where: { profileId }, select: { data: true, step: true, createdAt: true, updatedAt: true } })
  if (!row) return null
  const optInsOff = draftRefusalsOf(row.data)
  return { answers: draftDataOf(row.data), ...(optInsOff.length ? { optInsOff } : {}), step: row.step, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
