import 'server-only'
import { randomInt } from 'node:crypto'
import { ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { logError, logWarn } from '@/lib/log'
import { rateLimit } from '@/lib/ratelimit'
import { isStaffProfile } from '@/lib/user-blocks'
import { appendAudit } from '@/lib/compliance/audit'
import { classroomAudit, classroomAuditAlone, noticeSha } from './audit'
import { LIMITS, OWN_VOICE_OPEN, VOICE_RATE, type VoiceFailReason, type VoiceStatus } from './constants'
import { VOICE_NOTICE_VERSION, voiceNoticeBody } from './notices'
import { NATURAL_VOICE } from './pace'
import { pickScript, scriptKey, scriptMatch, scriptOf, SCRIPT_MATCH_MIN } from './own-voice-script'
import { quietError } from './quiet-error'
import { sonioxConfig, SonioxError, type SonioxConfig } from './soniox'
import { sonioxSpeakLine } from './soniox-tts'
import { createVoice, deleteVoice, getVoice, listOurVoices, recomputeVoice, voiceName, VOICE_PREFIX, type SonioxVoice } from './soniox-voices'
import { forgetVoiceLines } from './session-voice'
import { teacherLock } from './tutors'
import { transcribePcm } from './voice-stt'
import { VOICE_SAMPLE_LINE, type TutorVoice } from './voices'
import { parseWav } from './wav'

/**
 * A TEACHER'S OWN VOICE (owner, 2026-11-09: "they can create their own avatar … voice creation"). Plan: step 3 of
 * ~/eno-classroom-2026-11-09/plan.md, design in step3-voice.md (codex + opus REFUTED v1; their points are below).
 *
 * ONE ClassroomVoice ROW PER ATTEMPT, a state machine — every move a CONDITIONAL update, so two requests, two containers or
 * the sweep never both move one row:
 *   script    sentences handed out (own-voice-script.ts), good once and for LIMITS.voiceScriptMinutes
 *   checking  the recording is being heard (its words must be this script's) — the consent is on the row from here
 *   making    at Soniox (POST /v1/voices) — `sonioxVoiceId` lands with `WHERE status = 'making'`
 *   ready     Soniox says ready for our TTS model, and our sample line in it is on the row
 *   failed    with why (failReason); a new attempt replaces it
 * ⛔ THE RECORDING IS NEVER KEPT: it lives in this request's memory, goes to Soniox (the words, then the clone) and is dropped.
 * ⛔ ERASURE CANNOT BE FORGOTTEN BY A CALLER: deleting (or failing) the row is the whole of a withdrawal, an account erasure
 * (the TeacherProfile cascade) or an admin takedown — the DATABASE queues the voice it held (classroom_voice_deletion, a
 * trigger: scripts/classroom-ddl.mjs) and `reconcileVoices` (the classroom sweep) deletes it at Soniox. ⛔ Only voices this
 * database made are ever deleted — by the id a row held, or by the name of its own attempt whose id never arrived; never
 * a voice merely because no row holds it (commit gate, codex + opus).
 * ⛔ A COPY OF THIS DATABASE MUST NEVER GET THE PRODUCTION SONIOX KEY: holding production's rows, it would act on
 * production's voices (a withdrawal there deletes the real voice). The local stack runs without it (env -i).
 */

/** A row stuck in checking/making this long lost its request (a crash, a timeout): failed by the sweep. */
export const STUCK_MS = 15 * 60_000
/** A create whose answer never reached its row is judged lost only after this (it may still be in flight). */
const LOST_CREATE_MS = STUCK_MS
/** The route's own wait for Soniox to finish making the voice; the page's GET and the sweep carry on after it. */
const READY_WAIT_MS = 20_000
const POLL_EVERY_MS = 2_000
/** The recording is refused below this loudness (0–32767): a voice that quiet clones badly. */
const QUIET_PEAK = 2_000
/** 120 s of 24 kHz PCM16 + the header. */
export const MAX_RECORDING_BYTES = LIMITS.voiceMaxSeconds * VOICE_RATE * 2 + 44
/** A cloned voice's id as Soniox gives it (a uuid) — the DDL's bound, and what the speaking side accepts. */
const UUID = /^[0-9a-fA-F-]{8,64}$/

const VOICE_LOCK = 'eno-classroom-voices'

type Row = { id: string; teacherProfileId: string; status: string; sonioxVoiceId: string | null; updatedAt: Date; createdAt: Date }

/** May this teacher MAKE a voice (OWN_VOICE_OPEN)? Deleting one never asks. */
export async function voiceOpenFor(profileId: string): Promise<boolean> {
  return OWN_VOICE_OPEN === 'all' || (await isStaffProfile(profileId))
}

// ── What the page sees ─────────────────────────────────────────────────────────────────────────────────────────────────
export type VoiceView =
  | { status: 'none' }
  | { status: 'script'; id: string; sentences: string[]; expiresAt: string }
  | { status: 'checking' | 'making'; id: string }
  | { status: 'ready'; id: string; sampleUrl: string }
  | { status: 'failed'; id: string; reason: VoiceFailReason }

export async function voiceView(teacherProfileId: string, now = new Date()): Promise<VoiceView> {
  let row = await db.classroomVoice.findUnique({ where: { teacherProfileId }, select: { id: true, teacherProfileId: true, status: true, script: true, expiresAt: true, failReason: true, sonioxVoiceId: true, updatedAt: true, createdAt: true } })
  if (!row) return { status: 'none' }
  // Still being made after the route's own wait: ask Soniox again (≤ once per POLL_EVERY_MS per process).
  if (row.status === 'making' && row.sonioxVoiceId && pollDue(row.id, now)) {
    const cfg = sonioxConfig()
    if (cfg) {
      await advanceMaking(cfg, row, await getVoice(cfg, row.sonioxVoiceId).catch(() => undefined))
      row = (await db.classroomVoice.findUnique({ where: { id: row.id }, select: { id: true, teacherProfileId: true, status: true, script: true, expiresAt: true, failReason: true, sonioxVoiceId: true, updatedAt: true, createdAt: true } })) ?? null
      if (!row) return { status: 'none' }
    }
  }
  switch (row.status as VoiceStatus) {
    case 'script': {
      const sentences = scriptOf(row.script)
      if (!sentences || row.expiresAt <= now) return { status: 'none' } // an old script: the page asks for a new one
      return { status: 'script', id: row.id, sentences, expiresAt: row.expiresAt.toISOString() }
    }
    case 'checking': case 'making': return { status: row.status as 'checking' | 'making', id: row.id }
    case 'ready': return { status: 'ready', id: row.id, sampleUrl: `/api/classroom/own-voice/sample?v=${encodeURIComponent(row.id)}` }
    case 'failed': return { status: 'failed', id: row.id, reason: (row.failReason ?? 'soniox') as VoiceFailReason }
    default: return { status: 'none' }
  }
}
const lastPoll = new Map<string, number>()
function pollDue(id: string, now: Date): boolean {
  const at = lastPoll.get(id) ?? 0
  if (now.getTime() - at < POLL_EVERY_MS) return false
  lastPoll.set(id, now.getTime())
  if (lastPoll.size > 500) lastPoll.delete(lastPoll.keys().next().value!)
  return true
}

// ── 1. The script ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Hand out a new script — a new row, replacing a script or failed one. ⛔ A voice being checked, made or ready is not
 * replaced: the teacher deletes it first (a ready voice is in use by their tutors). Under the teacher's lock.
 */
export async function issueScript(teacherProfileId: string, now = new Date()): Promise<VoiceView> {
  const indexes = pickScript(() => randomInt(0, 1 << 30) / (1 << 30))
  const expiresAt = new Date(now.getTime() + LIMITS.voiceScriptMinutes * 60_000)
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacherProfileId)}, 0))`
    const cur = await tx.classroomVoice.findUnique({ where: { teacherProfileId }, select: { id: true, status: true, updatedAt: true } })
    if (cur && (cur.status === 'ready' || cur.status === 'making' || cur.status === 'checking')) throw new ApiError('voice_exists', 409)
    if (cur) await tx.classroomVoice.delete({ where: { id: cur.id } })
    await tx.classroomVoice.create({ data: { teacherProfileId, status: 'script', script: scriptKey(indexes), expiresAt } })
  }, { maxWait: 5_000, timeout: 10_000 })
  return voiceView(teacherProfileId, now)
}

// ── 2. The recording ───────────────────────────────────────────────────────────────────────────────────────────────────
export type Consent = { version: string; ownVoice: boolean }

/**
 * The teacher's recording of THEIR script (`rowId`), with the consent they gave on the page. In order, each refusal before
 * the next step: the format and length, the consent's version, the daily limit, the script consumed (ONCE — a second
 * upload of the same script finds it gone), the words heard, the organisation's slots, then Soniox. Returns the new view.
 */
export async function submitRecording(teacher: { id: string; profileId: string }, rowId: string, wav: Uint8Array, consent: Consent, now = new Date(), waitMs = READY_WAIT_MS): Promise<VoiceView> {
  if (!(await voiceOpenFor(teacher.profileId))) throw new ApiError('classroom_closed', 403)
  const cfg = sonioxConfig()
  if (!cfg) throw new ApiError('voice_unavailable', 503)
  const info = parseWav(wav, VOICE_RATE)
  if (!info) throw new ApiError('bad_request', 400)
  if (info.ms < LIMITS.voiceMinSeconds * 1000) throw new ApiError('voice_too_short', 400)
  if (info.ms > LIMITS.voiceMaxSeconds * 1000 + 500) throw new ApiError('voice_too_long', 400)
  if (info.peak < QUIET_PEAK) throw new ApiError('voice_too_quiet', 400)
  if (consent.version !== VOICE_NOTICE_VERSION) throw new ApiError('notice_changed', 409)
  if (!consent.ownVoice) throw new ApiError('bad_request', 400)
  // A script already used or expired costs no attempt (commit gate, opus): asked first, consumed atomically below.
  if (!(await db.classroomVoice.findFirst({ where: { id: rowId, teacherProfileId: teacher.id, status: 'script', expiresAt: { gt: now } }, select: { id: true } }))) throw new ApiError('voice_script_expired', 409)
  if (!(await rateLimit('classroom-voice', teacher.id, LIMITS.ownVoiceAttemptsPerDay, '1 d', { strict: true })).success) throw new ApiError('voice_rate_limited', 429)

  // The script, consumed ONCE, with the consent on the row and on the audit chain in the same transaction.
  const sha = noticeSha(voiceNoticeBody())
  const script = await db.$transaction(async (tx) => {
    const row = await tx.classroomVoice.findFirst({ where: { id: rowId, teacherProfileId: teacher.id }, select: { script: true } })
    const taken = await tx.classroomVoice.updateMany({
      where: { id: rowId, teacherProfileId: teacher.id, status: 'script', expiresAt: { gt: now } },
      data: { status: 'checking', consentVersion: consent.version, consentSha: sha, consentAt: now },
    })
    if (!taken.count || !row) return null
    await classroomAudit(tx, teacher.profileId, 'classroom.voice.consent', { voiceId: rowId, version: consent.version, sha, ownVoice: true })
    return scriptOf(row.script)
  }, { maxWait: 5_000, timeout: 10_000 })
  if (!script) throw new ApiError('voice_script_expired', 409)

  // The words: this attempt's script, read. Unheard (Soniox down) refuses — FAIL CLOSED.
  const pcm = wav.subarray(44)
  let heard: string
  try {
    heard = await transcribePcm(cfg, pcm, VOICE_RATE)
  } catch (e) {
    // Unheard (Soniox down or slow) is not the teacher's doing: the same sentences may be read again (commit gate, opus).
    await db.classroomVoice.updateMany({ where: { id: rowId, status: 'checking' }, data: { status: 'script' } })
    logWarn('[classroom] own voice: the words could not be heard', { status: (e as { status?: number }).status ?? null })
    throw new ApiError('voice_unavailable', 503)
  }
  if (scriptMatch(heard, script) < SCRIPT_MATCH_MIN) {
    await fail(rowId, 'checking', 'not_script')
    throw new ApiError('voice_not_script', 422)
  }

  // A slot in the organisation's 20 (18 for us), counted and taken under one lock — never held across a Soniox call.
  const slot = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${VOICE_LOCK}, 0))`
    const used = await tx.classroomVoice.count({ where: { status: { in: ['making', 'ready'] } } })
    if (used >= LIMITS.ownVoicesTotal) return 'full' as const
    const moved = await tx.classroomVoice.updateMany({ where: { id: rowId, status: 'checking' }, data: { status: 'making' } })
    return moved.count ? ('ok' as const) : ('gone' as const)
  }, { maxWait: 5_000, timeout: 10_000 })
  if (slot === 'full') { await fail(rowId, 'checking', 'slots_full'); throw new ApiError('voice_slots_full', 503) }
  if (slot === 'gone') throw new ApiError('voice_script_expired', 409) // deleted (or failed by the sweep) meanwhile

  let made: SonioxVoice
  try {
    made = await createVoice(cfg, voiceName(rowId), wav)
  } catch (e) {
    const status = e instanceof SonioxError ? e.status : 502
    // ⛔ An unclear answer may still have made the voice: the row is failed, and the reconcile deletes a voice named for this
    // row of THIS database (a lost create).
    await fail(rowId, 'making', status === 429 ? 'slots_full' : 'soniox')
    logWarn('[classroom] own voice: Soniox did not make it', { status })
    throw new ApiError(status === 429 ? 'voice_slots_full' : 'voice_unavailable', 503)
  }
  if (!UUID.test(made.id)) { await fail(rowId, 'making', 'soniox'); throw new ApiError('voice_unavailable', 503) }
  const attached = await db.classroomVoice.updateMany({ where: { id: rowId, status: 'making', sonioxVoiceId: null }, data: { sonioxVoiceId: made.id } })
  if (!attached.count) {
    // Deleted or failed while Soniox made it: this voice belongs to nobody — let it go now (the reconcile would, later).
    await deleteVoice(cfg, made.id).catch((e) => logWarn('[classroom] own voice: an unclaimed voice was not deleted yet — the reconcile will', { status: (e as { status?: number }).status ?? null }))
    throw new ApiError('voice_script_expired', 409)
  }

  // Ready in seconds, usually: wait a little here; the page's GET and the sweep carry on after.
  let v: SonioxVoice | null | undefined = made
  const row = { id: rowId, teacherProfileId: teacher.id, status: 'making', sonioxVoiceId: made.id, updatedAt: now, createdAt: now }
  for (const until = Date.now() + waitMs; ;) {
    if (await advanceMaking(cfg, row, v)) break
    if (Date.now() + POLL_EVERY_MS > until) break
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS))
    v = await getVoice(cfg, made.id).catch(() => undefined)
  }
  return voiceView(teacher.id)
}

async function fail(rowId: string, from: VoiceStatus | VoiceStatus[], reason: VoiceFailReason): Promise<number> {
  const r = await db.classroomVoice.updateMany({
    where: { id: rowId, status: { in: Array.isArray(from) ? from : [from] } },
    data: { status: 'failed', failReason: reason, sample: null },
  })
  return r.count
}

/**
 * A making row and what Soniox says of its voice (`undefined`: Soniox did not answer — nothing changes) → ready (with our
 * sample line, made ONCE: the conditional update), failed (and deleted at Soniox), or still making. True when settled.
 */
async function advanceMaking(cfg: SonioxConfig, row: Pick<Row, 'id' | 'sonioxVoiceId'>, v: SonioxVoice | null | undefined): Promise<boolean> {
  if (v === undefined || !row.sonioxVoiceId) return false
  if (v === null) { await fail(row.id, 'making', 'gone'); return true }
  if (v.status === 'failed') {
    // Failed: the database queues the voice (the trigger); deleted at Soniox now when it answers, else by the sweep.
    if (await fail(row.id, 'making', 'unusable')) await eraseNow(cfg, v.id)
    return true
  }
  // Not prepared for our TTS model — not_computed, or no entry for it at all (codex, both rounds): asked to prepare it, then
  // polled as usual.
  if (v.status === 'not_computed' || v.status === null) {
    await recomputeVoice(cfg, v.id).catch((e) => logWarn('[classroom] own voice: recompute failed', { status: (e as { status?: number }).status ?? null }))
    return false
  }
  if (v.status !== 'ready') return false
  let sample: Buffer
  try {
    sample = await sonioxSpeakLine(VOICE_SAMPLE_LINE, v.id, NATURAL_VOICE)
  } catch (e) {
    logWarn('[classroom] own voice: the sample line was not made yet', { status: (e as { status?: number }).status ?? null })
    return false // tried again by the next poll
  }
  if (sample.length > 400_000) return false
  await db.classroomVoice.updateMany({ where: { id: row.id, status: 'making', sonioxVoiceId: v.id }, data: { status: 'ready', sample: new Uint8Array(sample) } })
  return true
}

// ── 3. Deleting ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The teacher's voice, whatever its state, deleted: the row first (every tutor speaks its stock voice from its next line),
 * then at Soniox at once — and if Soniox does not answer, the reconcile deletes it within a sweep or two. `by`: the
 * teacher themselves, or an admin's takedown (`actor` = the admin's account). Both on the audit chain.
 */
export async function deleteOwnVoice(teacherProfileId: string, accountId: string, by: 'teacher' | 'admin', actor = accountId): Promise<boolean> {
  const gone = await db.$transaction(async (tx) => {
    const row = await tx.classroomVoice.findUnique({ where: { teacherProfileId }, select: { id: true, sonioxVoiceId: true, status: true } })
    if (!row) return null
    // The trigger queues its Soniox voice in this same statement; the tutors that named it speak their stock voice.
    await tx.classroomVoice.delete({ where: { id: row.id } })
    await tx.classroomAvatar.updateMany({ where: { teacherProfileId, ownVoiceId: row.id }, data: { ownVoiceId: null } })
    // The teacher's own withdrawal is theirs on the chain; an admin's takedown names the ADMIN as the actor.
    if (row.status !== 'script') {
      if (by === 'teacher') await classroomAudit(tx, accountId, 'classroom.voice.withdraw', { voiceId: row.id })
      else await appendAudit(tx, { actorType: 'admin', actorId: actor, action: 'classroom.voice.removed', subjectType: 'profile', subjectId: accountId, detail: { voiceId: row.id } })
    }
    return row
  }, { maxWait: 5_000, timeout: 10_000 })
  if (!gone) return false
  if (gone.sonioxVoiceId) {
    forgetVoiceLines(gone.sonioxVoiceId)
    const cfg = sonioxConfig()
    if (cfg && (await eraseNow(cfg, gone.sonioxVoiceId))) {
      await classroomAuditAlone(accountId, 'classroom.voice.erased', { voiceId: gone.id }).catch((e) => logError(quietError(e), { op: 'classroom.voice.erased-audit' }))
    }
  }
  return true
}

/** The teacher's ready own voice (its row id — what a tutor names to speak in it), or null. */
export async function readyVoiceId(teacherProfileId: string): Promise<string | null> {
  return (await db.classroomVoice.findFirst({ where: { teacherProfileId, status: 'ready' }, select: { id: true } }))?.id ?? null
}

/** A queued voice deleted at Soniox now, and ticked off the queue. False when Soniox did not answer (the sweep retries). */
async function eraseNow(cfg: SonioxConfig, sonioxVoiceId: string): Promise<boolean> {
  try {
    await deleteVoice(cfg, sonioxVoiceId)
  } catch (e) {
    logWarn('[classroom] own voice: deleting at Soniox failed — the sweep tries again', { status: (e as { status?: number }).status ?? null })
    return false
  }
  await db.$executeRaw`UPDATE public.classroom_voice_deletion SET done_at = now() WHERE soniox_voice_id = ${sonioxVoiceId} AND done_at IS NULL`
  return true
}

// ── 4. Speaking ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The tutor's voice, read for EACH line it says (a session start, every turn): its stock voice, and the teacher's own while
 * the tutor uses it and it is ready — so a withdrawal reaches a live session at its next reply. A failed read speaks the
 * stock voice (never no voice).
 */
export async function tutorVoice(avatar: { voice: string; ownVoiceId: string | null; teacherProfileId: string }): Promise<TutorVoice> {
  if (!avatar.ownVoiceId) return { stock: avatar.voice, own: null }
  // THE voice the tutor named — a later voice of the same teacher is never picked up by an old choice (commit gate, codex + opus).
  const v = await db.classroomVoice.findFirst({ where: { id: avatar.ownVoiceId, teacherProfileId: avatar.teacherProfileId }, select: { status: true, sonioxVoiceId: true } })
    .catch((e) => { logError(quietError(e), { op: 'classroom.voice.read' }); return null })
  return { stock: avatar.voice, own: v?.status === 'ready' && v.sonioxVoiceId && UUID.test(v.sonioxVoiceId) ? v.sonioxVoiceId : null }
}

// ── 5. The sweep ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type ReconcileResult = { stuck: number; deleted: number; deleteFailed: number; ready: number; failed: number; recomputed: number }

/** Queued deletions the sweep takes a run. */
const DELETES_PER_RUN = 50
/** A queue entry by NAME (the DDL's trigger): a create whose id never reached its row. */
const NAME_MARK = 'name:'

/**
 * ⛔ THE ERASURE NOBODY CAN FORGET (plan review + commit gate, codex + opus). One pass, safe to run anywhere at once (both
 * editions' sweeps): every move is a conditional update, and deleting a voice already gone is a success.
 *  1. checking/making rows older than STUCK_MS are failed (their request died); script rows long expired are let go.
 *  2. THE QUEUE: every voice this database held and let go (deleted, failed, replaced — the trigger) is deleted at Soniox and
 *     ticked off; a refusal counts a try and waits for the next run (Admin › Classroom shows what is waiting).
 *     A row that was making and went (deleted or failed) before its id reached it queues its NAME: every voice of that
 *     name is deleted, and the marker is done once the create window has passed with none left (codex, round 2).
 *  3. ONE list of our voices at Soniox, each judged ONLY by the row of this database that HOLDS it — a voice no row here
 *     holds is the queue's (by id or by name) or not this database's at all, and is left alone:
 *     making → ready (the sample) / failed; ready but failed at Soniox → failed (then queued); not prepared for our TTS
 *     model → recompute.
 *  4. A making/ready row whose voice is not listed is asked for directly; only Soniox's "no such voice" fails it as gone
 *     (opus: a voice attached after the list was read must not be failed for missing from it).
 */
export async function reconcileVoices(now = new Date()): Promise<ReconcileResult> {
  const out: ReconcileResult = { stuck: 0, deleted: 0, deleteFailed: 0, ready: 0, failed: 0, recomputed: 0 }
  out.stuck = (await db.classroomVoice.updateMany({ where: { status: { in: ['checking', 'making'] }, updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } }, data: { status: 'failed', failReason: 'timeout', sample: null } })).count
  await db.classroomVoice.deleteMany({ where: { status: 'script', expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } })
  const cfg = sonioxConfig()
  if (!cfg) return out

  // Ages in SQL, never a raw timestamptz read into JS: those come back shifted by the session's time zone (measured on a
  // scratch database at +07). `now` may run ahead of the clock (tests): the difference is added to every age.
  // ⛔ TWO BATCHES, EACH ITS OWN SHARE (commit gate, codex + opus): ids and name markers never starve one another — young
  // markers (waiting out their window by design) never hold back an id, and ids Soniox keeps refusing never hold back a
  // marker. Ids that failed least go first, so a stuck one never holds back a fresh erasure either.
  const due = await db.$queryRaw<{ soniox_voice_id: string; age_s: number }[]>`
    (SELECT soniox_voice_id, extract(epoch FROM now() - queued_at)::float8 AS age_s
       FROM public.classroom_voice_deletion WHERE done_at IS NULL AND soniox_voice_id NOT LIKE 'name:%'
      ORDER BY attempts, queued_at LIMIT ${DELETES_PER_RUN})
    UNION ALL
    (SELECT soniox_voice_id, extract(epoch FROM now() - queued_at)::float8 AS age_s
       FROM public.classroom_voice_deletion WHERE done_at IS NULL AND soniox_voice_id LIKE 'name:%'
      ORDER BY queued_at LIMIT ${DELETES_PER_RUN})`
  const ahead = (now.getTime() - Date.now()) / 1000
  const done = (id: string) => db.$executeRaw`UPDATE public.classroom_voice_deletion SET done_at = now() WHERE soniox_voice_id = ${id} AND done_at IS NULL`
  const tried = (id: string) => db.$executeRaw`UPDATE public.classroom_voice_deletion SET attempts = attempts + 1 WHERE soniox_voice_id = ${id}`
  // By id FIRST: an erasure never waits on Soniox's list answering (commit gate, codex).
  for (const { soniox_voice_id: id } of due.filter((d) => !d.soniox_voice_id.startsWith(NAME_MARK))) {
    try {
      await deleteVoice(cfg, id)
      await done(id)
      out.deleted++
    } catch {
      await tried(id)
      out.deleteFailed++
    }
  }

  const listed = await listOurVoices(cfg, VOICE_PREFIX)
  for (const { soniox_voice_id: id, age_s: age } of due.filter((d) => d.soniox_voice_id.startsWith(NAME_MARK))) {
    // A create whose id never reached its row: every voice of that name goes; the marker stays until the create window
    // has passed with none left (a create still in flight may land after this list — ours time out at 30 s).
    const name = id.slice(NAME_MARK.length)
    let left = 0
    for (const v of listed.filter((x) => x.name === name)) {
      try { await deleteVoice(cfg, v.id); v.name = ''; out.deleted++ } catch { left++; out.deleteFailed++ }
    }
    if (left) await tried(id)
    else if (age + ahead > LOST_CREATE_MS / 1000) await done(id)
  }

  const rows = new Map((await db.classroomVoice.findMany({
    where: { id: { in: listed.filter((v) => v.name).map((v) => v.name.slice(VOICE_PREFIX.length)) } },
    select: { id: true, status: true, sonioxVoiceId: true },
  })).map((r) => [r.id, r]))
  for (const v of listed) {
    if (!v.name) continue // deleted above
    const row = rows.get(v.name.slice(VOICE_PREFIX.length))
    // ⛔ Judged only by the row of THIS database that holds it — anything else is the queue's (by id or by name), or not ours.
    if (!row || row.sonioxVoiceId !== v.id) continue
    if (row.status === 'making') {
      if ((v.status === 'ready' || v.status === 'failed') && (await advanceMaking(cfg, row, v))) {
        if (v.status === 'ready') out.ready++
        else out.failed++
      } else if (v.status === 'not_computed' || v.status === null) await advanceMaking(cfg, row, v)
    } else if (row.status === 'ready' && v.status === 'failed') {
      if (await fail(row.id, 'ready', 'unusable')) out.failed++ // the trigger queues it; deleted next run
    } else if (row.status === 'ready' && (v.status === 'not_computed' || v.status === null)) {
      try { await recomputeVoice(cfg, v.id); out.recomputed++ } catch (e) { logWarn('[classroom] own voice: recompute failed', { status: (e as { status?: number }).status ?? null }) }
    }
  }

  const listedIds = new Set(listed.map((v) => v.id))
  for (const r of await db.classroomVoice.findMany({ where: { status: { in: ['making', 'ready'] }, sonioxVoiceId: { not: null } }, select: { id: true, sonioxVoiceId: true, status: true } })) {
    if (listedIds.has(r.sonioxVoiceId!)) continue
    const v = await getVoice(cfg, r.sonioxVoiceId!).catch(() => undefined)
    if (v === null && (await fail(r.id, r.status as VoiceStatus, 'gone'))) out.failed++
  }
  if (out.deleteFailed) logWarn('[classroom] own voice: voices still to delete at Soniox', { n: out.deleteFailed })
  return out
}

/** For Admin › Classroom: voices queued for deletion at Soniox and not deleted yet — how many, the oldest, the most tries. */
export async function pendingVoiceDeletions(): Promise<{ count: number; oldestMinutes: number; attempts: number }> {
  // A name marker waits out the create window by design: counted only past it.
  const [r] = await db.$queryRaw<{ n: number; oldest_min: number | null; attempts: number | null }[]>`
    SELECT count(*)::int AS n, (extract(epoch FROM now() - min(queued_at)) / 60)::float8 AS oldest_min, max(attempts)::int AS attempts
      FROM public.classroom_voice_deletion
     WHERE done_at IS NULL AND (soniox_voice_id NOT LIKE 'name:%' OR queued_at < now() - make_interval(secs => ${LOST_CREATE_MS / 1000}))`
  return { count: r?.n ?? 0, oldestMinutes: Math.round(r?.oldest_min ?? 0), attempts: r?.attempts ?? 0 }
}
