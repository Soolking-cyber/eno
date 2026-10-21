import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } from './constants'

/**
 * THE TEACHER'S OWN SWITCH FOR JOB MESSAGES (owner, 2026-10-20 — plan v2 "CONSENT"): "Message me matching jobs and cover
 * lessons in eno chat", on its own page (/teachers/job-messages, POST /api/teachers/me/job-dms). ONLY a teacher with it
 * ON under the CURRENT notice (JOB_DM_NOTICE_VERSION) gets a jobs-desk message — desk.ts re-asserts exactly that inside
 * the message's transaction. Its OWN consent (PDP Law 91/2025 Art 9(4)(d), Decree 356/2025 Art 6(3) — specific,
 * unbundled, provable), apart from the email and staff-call opt-ins (they name Anthropic; this one names no AI company —
 * the matching runs on eno's own server, gates.ts).
 *
 * ⛔ SERVER-WRITTEN EVIDENCE, the shape of publish.ts optInWrites (TeacherJobDmConsent — scripts/teacher-job-dms-ddl.mjs):
 *   · switched ON — `optIn`, `optInAt` (when) and `noticeVersion` (the words it was given under). An ON over an ON under
 *     today's notice writes nothing (the grant on record stays the first one); an ON over an older notice's ON, or over
 *     an OFF, is a fresh grant and re-stamps both;
 *   · switched OFF — `optIn` false and `withdrawnAt` (when). `optInAt` + `noticeVersion` STAY: they are the history of
 *     the last grant (as coverWithdrawnAt is the history of the last withdrawal). An OFF over an OFF writes nothing.
 *   · the DB CHECK TeacherJobDmConsent_evidence refuses an ON row without its time and notice.
 * ⛔ AN ON COUNTS ONLY UNDER THE NOTICE IN FORCE: the page echoes the version whose words it SHOWED (a constant compiled
 * into its bundle — never one read back from the server) and an ON under any other is refused, nothing written
 * (JobDmNoticeChangedError → 409 notice_changed). Bump JOB_DM_NOTICE_VERSION with any change to what the notice says is
 * used, by whom or where: every earlier ON then stops counting until the teacher switches it on again (constants.ts).
 * ⛔ A WITHDRAWAL IS NEVER BLOCKED (plan review D6 — the cover switch's and the identity mark's rule): an OFF needs no
 * notice, no teacher profile and no rate-limit budget, and is never refused for any of them.
 * ⛔ ONE LOCK FOR EVERY WRITE TO A TEACHER'S ROW — jobDmLockKey, the very key desk.ts sendJobDm takes first in its batch.
 * So an OFF waits for a message already on its way (which then went out BEFORE the withdrawal), and a message after an
 * OFF re-reads the consent and is held; the invite's claim (invite.ts) takes it too, so the row's one INSERT never races.
 * desk.ts honourStop takes it too: a STOP's withdrawal and its acknowledgement are one locked transaction.
 * ⛔ ON BY DEFAULT SINCE 2026-10-21 (constants.ts JOB_DM_DEFAULT_ON): enrolDefaultOn (each run) writes an ON row for
 * every live teacher who never chose — no row, or the invite's row with no grant and no withdrawal — stamped with the
 * time and JOB_DM_DEFAULT_ON, so everything above (the send guard, STOP, the pause, the switch) works for them as for a
 * teacher who switched on. A switch-OFF therefore always leaves a row saying OFF — over an ON, over the invite's row, or
 * over none — and a teacher with that row is never switched on again by eno.
 */

/** ⚠️ THE KEY desk.ts sendJobDm LOCKS (`'teacher-job-dm:' + teacherProfileId`) — keep the two identical. */
export function jobDmLockKey(profileId: string): string {
  return `teacher-job-dm:${profileId}`
}

export type JobDmConsentRow = {
  optIn: boolean
  optInAt: Date | null
  noticeVersion: string | null
  withdrawnAt: Date | null
  invitedAt: Date | null
  pausedAt: Date | null
}
const ROW_SELECT = { optIn: true, optInAt: true, noticeVersion: true, withdrawnAt: true, invitedAt: true, pausedAt: true } as const

type Tx = Prisma.TransactionClient
/**
 * Take the teacher's lock as a transaction's FIRST statement (released at its end). A bounded wait: a send holds it for
 * one batch; anything longer is a fault — fail, never queue.
 */
export async function lockJobDmTeacher(tx: Pick<Tx, '$executeRaw'>, profileId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3000ms', true)`
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${jobDmLockKey(profileId)}))`
}
export const JOB_DM_TX_OPTS = { maxWait: 5_000, timeout: 10_000 } as const

/** The account's row as stored, or null — never a guess. */
export async function readJobDmConsent(profileId: string): Promise<JobDmConsentRow | null> {
  return db.teacherJobDmConsent.findUnique({ where: { profileId }, select: ROW_SELECT })
}

/** The `noticeVersion`s an ON counts under: the teacher's own switch-on under the notice in force, or eno's default-on. */
export const JOB_DM_ON_VERSIONS: readonly string[] = [JOB_DM_NOTICE_VERSION, JOB_DM_DEFAULT_ON]

/** ⛔ MAY THE JOBS DESK MESSAGE THIS TEACHER? Only with the switch ON — their own under the notice in force, or eno's default. */
export function jobDmConsented(row: (Pick<JobDmConsentRow, 'optIn' | 'noticeVersion'> & { pausedAt?: Date | null }) | null | undefined): boolean {
  // ⚠️ A PAUSED switch is not a consent to send (codex, gate 3m): the one gate says so itself, so no caller can forget it.
  return !!row && row.optIn && row.noticeVersion !== null && JOB_DM_ON_VERSIONS.includes(row.noticeVersion) && !row.pausedAt
}

/** A teacher who never chose: no row, or the invite's row — no grant (eno's or theirs) and no withdrawal. */
export function neverChose(row: Pick<JobDmConsentRow, 'optIn' | 'optInAt' | 'withdrawnAt'> | null | undefined): boolean {
  return !row || (!row.optIn && !row.optInAt && !row.withdrawnAt)
}

/**
 * The teachers job messages are on for by default (enrolDefaultOn) — the ones the jobs desk can reach (run.ts
 * loadTeachers, invite.ts): a live profile with its listing live (active + verified), never the owner's demo profile.
 */
export function defaultOnTeacherWhere(): Prisma.TeacherProfileWhereInput {
  return {
    status: 'live',
    listing: { status: 'active', verified: true },
    ...(HOME_HIDDEN_TEACHER_LISTING_IDS.length ? { NOT: { listingId: { in: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } } } : {}),
  }
}
type TeacherReach = { status: string; listingId: string | null; listing: { status: string; verified: boolean } | null } | null
/** defaultOnTeacherWhere, for a profile already read. */
export function isDefaultOnTeacher(tp: TeacherReach): boolean {
  return tp?.status === 'live' && tp.listing?.status === 'active' && tp.listing.verified === true
    && !(tp.listingId && (HOME_HIDDEN_TEACHER_LISTING_IDS as readonly string[]).includes(tp.listingId))
}
const REACH_SELECT = { status: true, listingId: true, listing: { select: { status: true, verified: true } } } as const

/**
 * ⛔ eno SWITCHES JOB MESSAGES ON for every default-on teacher who never chose (constants.ts JOB_DM_DEFAULT_ON) — an ON
 * row stamped now and JOB_DM_DEFAULT_ON: inserted where there is none, or set over the invite's row while it still holds
 * no grant and no withdrawal. Each write is one statement whose own condition re-checks "never chose", so a teacher who
 * switched OFF meanwhile (consent.ts setJobDmConsent writes an OFF row, under their lock) is never switched on: that
 * OFF row makes the insert skip and the update miss. Returns how many it switched on. Never in a dry run (run.ts).
 */
export async function enrolDefaultOn(now: Date): Promise<number> {
  const ids = (await db.teacherProfile.findMany({
    where: { ...defaultOnTeacherWhere(), profile: { OR: [{ teacherJobDmConsent: { is: null } }, { teacherJobDmConsent: { is: { optIn: false, optInAt: null, withdrawnAt: null } } }] } },
    select: { profileId: true },
    take: 5000,
  })).map((r) => r.profileId)
  if (!ids.length) return 0
  const on = { optIn: true, optInAt: now, noticeVersion: JOB_DM_DEFAULT_ON, updatedAt: now }
  const inserted = await db.teacherJobDmConsent.createMany({ data: ids.map((profileId) => ({ profileId, ...on })), skipDuplicates: true })
  const set = await db.teacherJobDmConsent.updateMany({ where: { profileId: { in: ids }, optIn: false, optInAt: null, withdrawnAt: null }, data: on })
  return inserted.count + set.count
}

/**
 * What the page shows (GET/POST /api/teachers/me/job-dms), field by field — never a spread of the row:
 *   on            — the stored switch;
 *   noticeVersion — the notice its last ON was given under (history after an OFF; null = never on);
 *   current       — ON under the notice in force (jobDmConsented): the ONLY state in which messages go out, and what the
 *                   switch draws. `on && !current` = an ON under an older notice — the page says "switch it on again";
 *   teacher       — the account has a teacher profile (live or hidden), which an ON needs.
 */
/** `paused`: ON, but held after a reply that may have asked to stop (run.ts) — the switch shows OFF, and switching it on
 *  lifts the pause (jobDmConsentWrites). */
export type JobDmState = { on: boolean; noticeVersion: string | null; current: boolean; teacher: boolean; paused: boolean }
/** `defaultOn`: the account is a default-on teacher (isDefaultOnTeacher) — who never chose is drawn ON: eno switches it
 *  on at the next run (enrolDefaultOn), and switching it off here writes the OFF that stops that. */
export function jobDmStateOf(
  row: (Pick<JobDmConsentRow, 'optIn' | 'noticeVersion'> & { pausedAt?: Date | null; optInAt?: Date | null; withdrawnAt?: Date | null }) | null,
  teacher: boolean,
  defaultOn = false,
): JobDmState {
  if (defaultOn && neverChose(row && { optIn: row.optIn, optInAt: row.optInAt ?? null, withdrawnAt: row.withdrawnAt ?? null })) {
    return { on: true, noticeVersion: null, current: true, teacher, paused: false }
  }
  const paused = row?.optIn === true && !!row?.pausedAt
  // The page draws `current` (job-messages-panel.tsx) — OFF while paused, so switching it on lifts the pause.
  return { on: row?.optIn === true, noticeVersion: row?.noticeVersion ?? null, current: jobDmConsented(row), teacher, paused }
}

/** The evidence a switch writes over the stored row — null when it changes nothing. Pure. */
export function jobDmConsentWrites(
  on: boolean,
  stored: (Pick<JobDmConsentRow, 'optIn' | 'noticeVersion'> & { pausedAt?: Date | null; withdrawnAt?: Date | null }) | null,
  now: Date,
): { optIn?: boolean; optInAt?: Date; noticeVersion?: string; withdrawnAt?: Date; pausedAt?: null; updatedAt: Date } | null {
  const wasOn = stored?.optIn === true
  if (on) {
    // ON over an ON under today's notice writes nothing — except to lift a PAUSE (run.ts): the teacher saying "on" again
    // is the clearest "keep sending" there is, and a fresh grant — `optInAt` moves, so the reply that paused it (from
    // before) is never read again and cannot pause it a second time (opus, gate 3j). An ON over eno's default-on is the
    // teacher's own grant, recorded as such.
    if (wasOn && stored?.noticeVersion === JOB_DM_NOTICE_VERSION) return stored?.pausedAt ? { optInAt: now, pausedAt: null, updatedAt: now } : null
    return { optIn: true, optInAt: now, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null, updatedAt: now }
  }
  // OFF writes an OFF row over anything but an OFF — an ON, the invite's row, or none: under default-on (enrolDefaultOn)
  // "no row" means ON at the next run, so the OFF must be on record to keep it off.
  return !wasOn && stored?.withdrawnAt ? null : { optIn: false, withdrawnAt: now, updatedAt: now }
}

/** An ON from a page that showed another notice (or none): reload, read the notice in force, switch on again. */
export class JobDmNoticeChangedError extends Error {
  constructor() {
    super('notice_changed')
    this.name = 'JobDmNoticeChangedError'
  }
}
/** An ON from an account without a teacher profile: there is no profile to match. Nothing is written. */
export class JobDmNoTeacherProfileError extends Error {
  constructor() {
    super('teacher_profile_missing')
    this.name = 'JobDmNoTeacherProfileError'
  }
}

/** A teacher profile counts while it exists — live, or hidden by the teacher (its switch, setTeacherStatus). */
const isTeacher = (tp: { status: string } | null): boolean => tp?.status === 'live' || tp?.status === 'hidden'

/** The page's state for this account (GET). Reads only. */
export async function readJobDmState(profileId: string): Promise<JobDmState> {
  const [row, tp] = await Promise.all([
    readJobDmConsent(profileId),
    db.teacherProfile.findUnique({ where: { profileId }, select: REACH_SELECT }),
  ])
  return jobDmStateOf(row, isTeacher(tp), isDefaultOnTeacher(tp))
}

/**
 * The switch (POST). `shownNotice` is the notice version the page showed — checked for an ON only (above). Under the
 * teacher's lock: the profile read, the row read and the write, so two tabs, a STOP and a message on its way serialize.
 */
export async function setJobDmConsent(profileId: string, on: boolean, shownNotice: unknown): Promise<JobDmState> {
  if (on && shownNotice !== JOB_DM_NOTICE_VERSION) throw new JobDmNoticeChangedError()
  return db.$transaction(async (tx) => {
    await lockJobDmTeacher(tx, profileId)
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: REACH_SELECT })
    const teacher = isTeacher(tp)
    const defaultOn = isDefaultOnTeacher(tp)
    if (on && !teacher) throw new JobDmNoTeacherProfileError()
    const row = await tx.teacherJobDmConsent.findUnique({ where: { profileId }, select: ROW_SELECT })
    // The time is read AFTER the lock: an OFF that waited for a message on its way is stamped after that message.
    const write = jobDmConsentWrites(on, row, new Date())
    if (!write) return jobDmStateOf(row, teacher, defaultOn)
    // An upsert where there was no row: enrolDefaultOn takes no lock, and its ON row may land between the read and this
    // write — the OFF (or the teacher's own ON) is still the right write over it.
    const saved = row
      ? await tx.teacherJobDmConsent.update({ where: { profileId }, data: write, select: ROW_SELECT })
      : await tx.teacherJobDmConsent.upsert({ where: { profileId }, create: { profileId, ...write }, update: write, select: ROW_SELECT })
    return jobDmStateOf(saved, teacher, defaultOn)
  }, JOB_DM_TX_OPTS)
}

/** Why the server switched it off — logged with the profile id, never the message that said so. */
export type JobDmWithdrawReason = 'stop_reply' | 'quick_reply' | 'support'

/**
 * THE SERVER'S WITHDRAWAL — a teacher's "STOP" in the desk thread, the "Stop job messages" quick reply, or our team on the
 * teacher's request. The same evidence as the switch's OFF (`optIn` false, `withdrawnAt`; the last grant kept), as a
 * compare-and-set on `optIn: true`: true ONLY for the call that flipped it — so the one acknowledgement goes once, and a
 * re-run or a parallel run finds nothing to flip. An OFF row (or none) is left as it is.
 * Under the teacher's lock — and so ⛔ NEVER called inside a transaction that already holds it (desk.ts sendJobDm's batch):
 * this opens its own and would wait on that one. A caller already holding the lock passes its `tx` instead.
 */
export async function withdrawJobDms(
  profileId: string,
  why: JobDmWithdrawReason,
  opts: { now?: Date; tx?: Tx } = {},
): Promise<boolean> {
  const flip = async (tx: Tx) => {
    const at = opts.now ?? new Date()
    const r = await tx.teacherJobDmConsent.updateMany({ where: { profileId, optIn: true }, data: { optIn: false, withdrawnAt: at, updatedAt: at } })
    return r.count === 1
  }
  const flipped = opts.tx
    ? await flip(opts.tx)
    : await db.$transaction(async (tx) => { await lockJobDmTeacher(tx, profileId); return flip(tx) }, JOB_DM_TX_OPTS)
  if (flipped) console.info('[job-dms] withdrawn', { profileId, why })
  return flipped
}
