import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { kv } from '@/lib/ratelimit'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import { TEACHING_JOB_WHERE, provinceToCitySlug } from '@/lib/teachers/match-io'
import { JOBS_DESK_SELLER_ID, JOB_DMS_MODE_KEY, JOB_DM_NOTICE_VERSION, JOB_DM_RULES, type JobDmsMode } from './constants'
import { RULES_VERSION, foldPost, readPost, type RuleFacts } from './extract'
import { decide } from './facts'
import { fit, vnToday, type MatchJob, type MatchTeacher } from './gates'
import { layaAnswers } from './laya'
import { asksOf, composeDm, payText, sourceLine, titleOf, type DmItem } from './compose'
import { honourStop, pauseJobDms, resolveJobsOperatorProfileId, resumeJobDms, sendJobDm } from './desk'
import { isKeepReply, isStopReply, mayBeOptOut } from './replies'

/**
 * ONE RUN of the teacher job DMs (GET /api/cron/teacher-job-dms, every 30 minutes in the daytime):
 *   1. honour STOP replies;      2. read new posts (rules → ready | held | dropped; Laya's answers recorded beside them);
 *   3. expire and purge;         4. match every eligible teacher;      5. send (live) or record (shadow).
 *
 * ⛔ MODES. 'shadow' (the default, and what a crash falls back to — kv_store is unlogged): nothing is sent; what WOULD be
 * sent is stored as TeacherJobDm rows (mode 'shadow', with the text) for grading. 'live': the messages go out, and
 * sendJobDm re-asserts the switch inside the message's transaction. Shadow rows never block or count in live.
 * ⛔ BOTH MODES MATCH ONLY TEACHERS WHO SWITCHED JOB MESSAGES ON under JOB_DM_NOTICE_VERSION — /privacy says a profile is
 * used for this "only for teachers who switched this on", and a shadow row holds a would-be message to a named teacher.
 * (A first version shadowed every live teacher; the consent review refuted it.) So the order of going live is: the
 * invite (job-dms-invite) → teachers switch it on → shadow rows to grade → 'live'.
 * ⛔ dryRun: counts only — nothing classified, stored, recorded or sent.
 */

export type RunResult = {
  mode: JobDmsMode | 'dry'
  stops: number
  read: number
  ready: number
  held: number
  dropped: number
  expired: number
  teachers: number
  sent: number
  shadow: number
  skipped: number
  failed: number
  /** teachers newly paused this run (a reply that may have asked to stop) */
  paused?: number
  /** pauses nobody lifted, switched off this run (JOB_DM_RULES.pauseToWithdrawDays) */
  lapsed?: number
  stopped?: 'quiet' | 'ceiling' | 'no-operator' | 'busy' | 'lock-error' | 'deadline'
}

// Posts read per run: the rules take milliseconds; Laya (record-only) gets at most 4 minutes of a run and the posts it
// does not reach are stored without its answers. 60 a run still reads 2,880 posts a day (the Mac ships tens to a few
// hundred).
const READ_PER_RUN = 60

export async function readMode(): Promise<JobDmsMode> {
  try {
    return (await kv.get<string>(JOB_DMS_MODE_KEY)) === 'live' ? 'live' : 'shadow'
  } catch {
    return 'shadow'
  }
}

/** 21:00–08:00 Vietnam time: no message goes out (a shadow run still reads and records). */
export function isQuiet(now: Date): boolean {
  const h = new Date(now.getTime() + 7 * 3_600_000).getUTCHours()
  return h >= JOB_DM_RULES.quietFromHour || h < JOB_DM_RULES.quietToHour
}

// ── 1. STOP ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * EVERY message a teacher wrote in the desk thread since they last switched job messages ON — not only the newest: a
 * STOP followed by "did you get that?" is still a STOP (codex, gate 3a) — and none from before that switch: a STOP the
 * teacher has since overruled by switching back on must not switch them off again (opus, gate 3a). Only teachers whose
 * switch is ON are read; 60 days back at most (a run is every 30 minutes — a backlog that old is an outage, not a reply).
 */
async function processStops(operatorId: string, now: Date): Promise<{ n: number; pending: Set<string>; failed: number; paused: number; lapsed: number }> {
  const rows = await db.$queryRaw<{ conversationId: string; teacher: string; body: string; at: Date; paused: boolean }[]>`
    select m."conversationId", c."buyerProfileId"::text as teacher, m.body, m."createdAt" as at, (k."pausedAt" is not null) as paused
      from "Message" m
      join "Conversation" c on c.id = m."conversationId"
      join "TeacherJobDmConsent" k on k."profileId" = c."buyerProfileId" and k."optIn"
     where c."sellerId" = ${JOBS_DESK_SELLER_ID} and c."listingId" is null and m."senderProfileId" = c."buyerProfileId"
       and m."deletedAt" is null and m."createdAt" > k."optInAt" and m."createdAt" > ${new Date(now.getTime() - 60 * 86_400_000)}
     order by m."createdAt" asc, m.id asc`
  // Per teacher, their replies in order since they switched on: a STOP withdraws (honourStop); otherwise the LAST word
  // between "may be an opt-out" (mayBeOptOut) and "keep sending" (isKeepReply) decides — PAUSE (pauseJobDms, stored,
  // lifted only by an explicit keep or a switch-on) or RESUME (resumeJobDms). Other replies change nothing: a "thanks"
  // after an ambiguous opt-out does not lift its pause (codex + opus, gate 3i).
  // The LATEST of stop / pause / keep decides — a "Keep sending jobs" typed after a STOP, before the run read either,
  // is the teacher's last word (codex, gate 3l).
  type Verdict = { last?: 'stop' | 'pause' | 'keep'; lastAt?: Date; conversationId: string; paused: boolean }
  const byTeacher = new Map<string, Verdict>()
  for (const r of rows) {
    const v = byTeacher.get(r.teacher) ?? { conversationId: r.conversationId, paused: r.paused }
    const word = isStopReply(r.body) ? 'stop' : isKeepReply(r.body) ? 'keep' : mayBeOptOut(r.body) ? 'pause' : null
    if (word) { v.last = word; v.lastAt = r.at; v.conversationId = r.conversationId }
    byTeacher.set(r.teacher, v)
  }
  const pending = new Set<string>()
  let n = 0, failed = 0, paused = 0
  for (const [teacher, v] of byTeacher) {
    // One teacher's failure (a lock timeout, 55P03 — opus, gate 3d) never stops the others: their reply is still there,
    // so the next run retries it — counted as a failure (the route reports it), and that teacher is sent nothing now.
    try {
      if (v.last === 'stop') { if (await honourStop(teacher, operatorId, v.conversationId, now)) n++ }
      // Only a change is written: a paused teacher is not paused again, nor a running one resumed, every run (codex, 3k).
      else if (v.last === 'pause') { pending.add(teacher); if (!v.paused && await pauseJobDms(teacher, operatorId, v.conversationId, v.lastAt!, now)) paused++ }
      else if (v.last === 'keep' && v.paused) await resumeJobDms(teacher, now)
    } catch (e) {
      failed++
      pending.add(teacher)
      console.error('[job-dms] reply', teacher, e)
    }
  }
  // A pause that nobody lifted in JOB_DM_RULES.pauseToWithdrawDays is a withdrawal: the record must say "off" for a teacher
  // who asked to stop and never came back (codex + opus, gate 4b). No message — they were told when it paused.
  const lapsed = await db.teacherJobDmConsent.updateMany({
    where: { optIn: true, pausedAt: { lt: new Date(now.getTime() - JOB_DM_RULES.pauseToWithdrawDays * 86_400_000) } },
    // pausedAt cleared with it: a later switch-on starts clean (opus, gate 4c)
    data: { optIn: false, withdrawnAt: now, pausedAt: null, updatedAt: now },
  })
  return { n, pending, failed, paused, lapsed: lapsed.count }
}

// ── 2. Read new posts ────────────────────────────────────────────────────────────────────────────────────────────────

type Counts = Pick<RunResult, 'read' | 'ready' | 'held' | 'dropped'>

/**
 * The SAME AD posted to several groups, or forwarded by two team members, is one job: a signature of its words (folded,
 * contacts and punctuation out, the first 500 characters) — the first copy received is read, a later one is dropped as
 * 'duplicate'. Measured on the labelled posts: cross-posted ads are word-for-word copies, with "See more" and emoji
 * the only differences.
 */
export function textSig(text: string): string {
  // The TEXT alone — and a LinkedIn alert's text already opens with "title · company · place" (the mailbox reader builds it
  // so), so two jobs under one boilerplate description still differ, and the same ad from a group with no title fields
  // still matches (codex, gates 3c, 3f, 3h).
  const core = foldPost(text).replace(/\[(email|phone|link)\]/g, ' ').replace(/\bsee (more|less)\b/g, ' ').replace(/[^a-z0-9]+/g, '').slice(0, 500)
  return createHash('sha256').update(core).digest('hex').slice(0, 32)
}

/** A copy held only for its ROUTE — the group is private or unknown, no link, no date, no Apply line — leaves the job to
 *  another copy; any other verdict is about the words, which the copies share. */
function takesTheJob(_status: string, reason: string | null): boolean {
  // Whatever the row's status now — a route-held copy is 'expired' once its time is up (opus, gate 3g) — its reason
  // says it waited on its route, not its words.
  return !(!!reason && /^(group-|no-link|undated|no-apply-path)/.test(reason))
}

async function readNewPosts(now: Date, write: boolean): Promise<Counts> {
  const posts = await db.externalJobPost.findMany({
    // ⚠️ Never a purged shell: re-reading '[deleted]' under a new rules version would overwrite its signature — the
    // very thing the shell is kept for (opus, gate 3e).
    where: { OR: [{ status: 'new' }, { status: { in: ['ready', 'held'] }, factsVersion: { not: RULES_VERSION } }], NOT: { text: PURGED_TEXT } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take: READ_PER_RUN,
    select: { id: true, source: true, text: true, title: true, company: true, locationText: true, postedAt: true, receivedAt: true, groupPublic: true, url: true, applyText: true },
  })
  const c: Counts = { read: posts.length, ready: 0, held: 0, dropped: 0 }
  if (!posts.length) return c
  // A LinkedIn job's text IS its fields — "title · company · place", built from them by eno-job-mailbox.py — so it is
  // read once: read twice, the place doubled every "Ho Chi Minh" the language rule counts (the first alert, 2026-10-21 —
  // extract.ts PLACE_NAMES). Every other source as before.
  const texts = posts.map((p) => (p.source === 'linkedin' ? p.text : [p.title, p.company, p.locationText, p.text].filter(Boolean).join('\n')))
  const sigs = posts.map((p) => textSig(p.text))
  // An EARLIER copy that was already read (posts are read oldest first, so a still-'new' one is a LATER copy — it must
  // never make this one the duplicate) and was not itself dropped as one; a copy that waits only on its ROUTE (a private
  // group, no link, no date) does not take the job from a copy that can be sent …
  const earlier = await db.externalJobPost.findMany({
    // ⚠️ NULL-SAFE: `NOT: { statusReason: 'duplicate' }` is SQL `NOT (x = 'duplicate')`, NULL — so FALSE — for every
    // ready post (no reason): no earlier copy was ever found (opus, gate 3a). Hence the explicit OR with null.
    // …and received in the last JOB_DM_RULES.retentionDays: a school reposting its ad a month later is a vacancy still
    // open, for teachers who switched on since (opus, gate 3l) — the shells' 180 days keep only the door's same-KEY answer.
    where: { textSig: { in: [...new Set(sigs)] }, id: { notIn: posts.map((p) => p.id) }, status: { not: 'new' }, receivedAt: { gte: new Date(now.getTime() - JOB_DM_RULES.retentionDays * 86_400_000) }, OR: [{ statusReason: null }, { statusReason: { not: 'duplicate' } }] },
    select: { textSig: true, status: true, statusReason: true },
  })
  const taken = new Set(earlier.filter((e) => takesTheJob(e.status, e.statusReason)).map((e) => e.textSig))
  // A dry run is counts only: Laya is not asked (opus, gate 3c — minutes of model time and post text for a probe).
  const laya = write ? await layaAnswers(texts) : null
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]
    // … or an earlier one in this batch.
    if (taken.has(sigs[i])) {
      c.dropped++
      if (write) await db.externalJobPost.update({ where: { id: p.id }, data: { status: 'dropped', statusReason: 'duplicate', textSig: sigs[i], factsVersion: RULES_VERSION, updatedAt: now } })
      continue
    }
    const facts = readPost(texts[i], p.postedAt ?? p.receivedAt, { listing: p.source === 'linkedin' || p.source === 'intake' })
    const d = decide(facts, { source: p.source as 'fb' | 'linkedin' | 'intake', postedAt: p.postedAt, receivedAt: p.receivedAt, groupPublic: p.groupPublic, url: p.url, applyText: p.applyText }, laya?.answers[i] ?? null, now)
    if (takesTheJob(d.status, d.reason)) taken.add(sigs[i])
    c[d.status]++
    if (!write) continue
    await db.externalJobPost.update({
      where: { id: p.id },
      data: {
        status: d.status, statusReason: d.reason, expiresAt: d.expiresAt, factsVersion: RULES_VERSION, textSig: sigs[i], updatedAt: now,
        facts: { rules: facts, laya: laya?.answers[i] ? { engine: laya.engine, answers: laya.answers[i] } : null } as object,
      },
    })
  }
  return c
}

// ── 3. Expire + purge ────────────────────────────────────────────────────────────────────────────────────────────────

async function expireAndPurge(now: Date): Promise<number> {
  const exp = await db.externalJobPost.updateMany({ where: { status: { in: ['ready', 'held'] }, expiresAt: { lt: now } }, data: { status: 'expired', updatedAt: now } })
  const cutoff = new Date(now.getTime() - JOB_DM_RULES.retentionDays * 86_400_000)
  await purgeJobPosts(now)
  // Shadow rows carry a would-be message (the teacher's first name + job lines): kept only as long as the posts they cite.
  await db.teacherJobDm.deleteMany({ where: { mode: 'shadow', createdAt: { lt: cutoff } } })
  return exp.count
}

/**
 * RETENTION, in two steps (opus, gate 3c: deleting the row also deleted the key that stops a re-sent post being stored
 * — and offered — again). At JOB_DM_RULES.retentionDays the post's CONTENT goes: its text, title, company, place, link,
 * Apply line, facts, group name and reference; the row stays as a shell — source, key (the post's id at its source),
 * text signature, status and its reason, and timestamps — so the door
 * answers 'duplicate' to the same post and the never-twice ledger's 'post:<id>' keys keep meaning one job. Shells go at
 * JOB_DM_RULES.shellDays. Called by the run and by every delivery to the door (api/cron/job-posts).
 */
export async function purgeJobPosts(now: Date): Promise<void> {
  const contentCutoff = new Date(now.getTime() - JOB_DM_RULES.retentionDays * 86_400_000)
  await db.externalJobPost.updateMany({
    where: { receivedAt: { lt: contentCutoff }, NOT: { text: PURGED_TEXT } },
    // ⚠️ STATUS IS KEPT: a copy held for its route ('held' · group-private) must stay one that does not take the job from
    // another copy (takesTheJob) — re-marking it 'expired' would (opus, gate 3d).
    data: { text: PURGED_TEXT, title: null, company: null, locationText: null, url: null, applyText: null, facts: Prisma.DbNull, sourceName: '', sourceRef: null, lang: null, updatedAt: now },
  })
  await db.externalJobPost.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - JOB_DM_RULES.shellDays * 86_400_000) } } })
}
/** What a purged post's text reads (the column is NOT NULL, at least one character — the DDL's CHECK). */
export const PURGED_TEXT = '[deleted]'

// ── 4. Jobs and teachers ─────────────────────────────────────────────────────────────────────────────────────────────

type Job = MatchJob & { item: Omit<DmItem, 'key'> }

async function loadJobs(now: Date): Promise<Job[]> {
  const posts = await db.externalJobPost.findMany({
    where: { status: 'ready', expiresAt: { gt: now }, NOT: { text: PURGED_TEXT } },
    select: { id: true, source: true, sourceName: true, url: true, applyText: true, postedAt: true, receivedAt: true, facts: true },
    take: 2000,
  })
  const jobs: Job[] = []
  for (const p of posts) {
    const f = (p.facts as { rules?: RuleFacts } | null)?.rules
    if (!f || f.version !== RULES_VERSION) continue
    const kind = f.kind === 'cover_request' ? 'cover_request' : 'job_offer'
    jobs.push({
      key: `post:${p.id}`, kind, employment: f.employment, places: f.places, pay: f.pay, schedule: f.schedule,
      ageGroups: f.ageGroups, subjects: f.subjects, requirements: f.requirements, postedAt: p.postedAt ?? p.receivedAt,
      item: {
        title: titleOf({ ...f, kind }), when: f.schedule?.label || undefined, pay: payText(f.pay), asks: asksOf(f),
        source: sourceLine(p.source as 'fb' | 'linkedin' | 'intake', p.sourceName), link: p.url ?? undefined, apply: p.applyText ?? undefined,
      },
    })
  }
  // eno.vn's own live teaching jobs (board imports, apply at source through the eno page) — through the edition scope
  // like every listing read (edition-lint Rule A): a desk or hidden seller's row is never offered, and its page would not
  // open for the teacher anyway.
  const since = new Date(now.getTime() - 14 * 86_400_000)
  const listings = await db.listing.findMany({
    where: await scopedListingWhere({ ...TEACHING_JOB_WHERE, createdAt: { gte: since } }),
    select: { id: true, title: true, description: true, city: true, salaryM: true, attributes: true, createdAt: true },
    take: 500,
  })
  for (const l of listings) {
    const attrs = (l.attributes ?? {}) as Record<string, unknown>
    const text = [l.title, typeof attrs.salaryText === 'string' ? attrs.salaryText : '', typeof attrs.jobtype === 'string' ? attrs.jobtype : '', l.description ?? ''].join('\n')
    const f = readPost(text, l.createdAt)
    // The importer already kept only foreigner-oriented, visa-free jobs (job-listing.ts) — its Vietnamese titles are
    // not "for Vietnamese teachers"; every other refusal, and the demographic net, still applies.
    if ((f.deny && f.deny !== 'vietnamese-oriented') || f.mention) continue
    const hub = provinceToCitySlug(l.city)
    const places = hub ? [hub, ...f.places.filter((k) => k !== hub)] : f.places
    if (!places.length) continue
    const pay = l.salaryM ? { min: l.salaryM * 1_000_000, max: l.salaryM * 1_000_000, unit: 'month' as const, text: '' } : f.pay
    jobs.push({
      key: `listing:${l.id}`, kind: 'job_offer', employment: f.employment.filter((e) => e !== 'cover'), places, pay, schedule: null,
      ageGroups: f.ageGroups, subjects: f.subjects, requirements: f.requirements, postedAt: l.createdAt,
      item: {
        title: l.title.slice(0, 120), pay: typeof attrs.salaryText === 'string' && attrs.salaryText ? String(attrs.salaryText).slice(0, 60) : payText(pay),
        asks: asksOf(f), source: sourceLine('eno'), link: `https://eno.vn/listings/${l.id}`,
      },
    })
  }
  return jobs
}

type TeacherRow = MatchTeacher & { firstName: string | null }

async function loadTeachers(): Promise<TeacherRow[]> {
  const rows = await db.teacherProfile.findMany({
    where: {
      status: 'live',
      listing: { status: 'active', verified: true },
      ...(HOME_HIDDEN_TEACHER_LISTING_IDS.length ? { NOT: { listingId: { in: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } } } : {}),
      profile: { teacherJobDmConsent: { optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null } },
    },
    select: {
      profileId: true, fullName: true, livesIn: true, currentCity: true, teachAreas: true, jobTypes: true, ageGroups: true, subjects: true,
      englishLevel: true, degreeLevel: true, certificates: true, yearsExperience: true, expectedSalaryM: true,
      coverOpen: true, coverConsentVersion: true, coverAreas: true, coverSlots: true, coverRateVnd: true,
    },
    take: 2000,
  })
  return rows.map((r) => ({
    profileId: r.profileId, firstName: r.fullName || null, livesIn: r.livesIn, currentCity: r.currentCity, teachAreas: r.teachAreas,
    jobTypes: r.jobTypes, ageGroups: r.ageGroups, subjects: r.subjects, englishLevel: r.englishLevel, degreeLevel: r.degreeLevel,
    certificates: Array.isArray(r.certificates) ? (r.certificates as { type?: unknown }[]).map((c) => (typeof c?.type === 'string' ? c.type : '')).filter(Boolean) : [],
    yearsExperience: r.yearsExperience, expectedSalaryM: r.expectedSalaryM,
    coverUsable: r.coverOpen && r.coverConsentVersion === COVER_CONSENT_VERSION, coverAreas: r.coverAreas, coverSlots: r.coverSlots, coverRateVnd: r.coverRateVnd,
  }))
}

/** The jobs to offer one teacher, per kind: passed every gate, not offered before (this mode), best first, ≤ jobsPerDm. */
export function planFor(t: MatchTeacher, jobs: readonly Job[], offered: ReadonlySet<string>, emailed: ReadonlySet<string>, now: Date) {
  const out: Record<'jobs' | 'cover', { job: Job; score: number; reasons: string[] }[]> = { jobs: [], cover: [] }
  for (const j of jobs) {
    if (offered.has(j.key) || emailed.has(j.key)) continue
    const f = fit(t, j, now)
    if (!f.ok) continue
    out[j.kind === 'cover_request' ? 'cover' : 'jobs'].push({ job: j, score: f.score, reasons: [...f.reasons, ...f.notes] })
  }
  for (const k of ['jobs', 'cover'] as const) {
    // The same vacancy cross-posted in several groups (or on a board and in a group) reads as the same line: keep the
    // best-scored copy so one message never lists a job twice.
    const seen = new Set<string>()
    out[k] = out[k]
      .sort((a, b) => b.score - a.score || b.job.postedAt.getTime() - a.job.postedAt.getTime())
      .filter((p) => {
        const sig = `${p.job.item.title}|${p.job.item.pay ?? ''}|${p.job.item.when ?? ''}`.toLowerCase()
        if (seen.has(sig)) return false
        seen.add(sig)
        return true
      })
      .slice(0, JOB_DM_RULES.jobsPerDm)
  }
  return out
}

// ── 5. The run ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** One run at a time (opus, gate 3c: two overlapping runs could race a thread's cleanup against the other's message). */
const RUN_LOCK_KEY = 'job-dms:run'
/** Sending stops here — the lock lives 20 minutes, the route 15. */
const RUN_DEADLINE_MS = 12 * 60_000

export async function runJobDms(opts: { dryRun: boolean; now?: Date }): Promise<RunResult> {
  const now = opts.now ?? new Date()
  const mode = await readMode()
  const write = !opts.dryRun
  const res: RunResult = { mode: opts.dryRun ? 'dry' : mode, stops: 0, read: 0, ready: 0, held: 0, dropped: 0, expired: 0, teachers: 0, sent: 0, shadow: 0, skipped: 0, failed: 0 }
  if (!write) return runOnce(opts, now, mode, write, res)
  // Held 20 minutes at most: a run that died leaves no lock behind for longer. The value is
  // this run's own token, and only its owner releases it (codex + opus, gate 3d: a run past the TTL must not delete the
  // NEXT run's lock). A store that cannot be reached is a failure the route reports — never a quiet "busy".
  const token = `${now.toISOString()}#${Math.random().toString(36).slice(2)}`
  let won: 'OK' | null
  // TTL 20 minutes, past the route's 15-minute maxDuration: no live run outlasts its lock (codex, gate 3e).
  try { won = await kv.set(RUN_LOCK_KEY, token, { nx: true, ex: 1200 }) } catch { return { ...res, stopped: 'lock-error', failed: 1 } }
  if (won !== 'OK') return { ...res, stopped: 'busy' }
  try {
    return await runOnce(opts, now, mode, write, res)
  } finally {
    // Compare-and-delete in one statement (opus, gate 3e: a get then a del could delete a successor's lock).
    try { await db.$executeRaw`delete from kv_store where key = ${RUN_LOCK_KEY} and value = to_jsonb(${token}::text)` } catch { /* the TTL frees it */ }
  }
}

async function runOnce(opts: { dryRun: boolean }, now: Date, mode: JobDmsMode, write: boolean, res: RunResult): Promise<RunResult> {

  const operatorId = await resolveJobsOperatorProfileId()
  if (!operatorId) return { ...res, stopped: 'no-operator' }

  // A STOP is read in every mode (codex + opus, gate 3b): withdrawal never waits for live sending.
  let stopPending = new Set<string>()
  // Replies are read as of this moment; a send then holds if the teacher wrote after it (desk.ts — opus, gate 3h).
  const repliesReadAt = new Date()
  const deadline = Date.now() + RUN_DEADLINE_MS
  if (write) {
    const s = await processStops(operatorId, now)
    res.stops = s.n
    res.paused = s.paused
    res.lapsed = s.lapsed
    res.failed += s.failed
    stopPending = s.pending
  }
  Object.assign(res, await readNewPosts(now, write))
  if (write) res.expired = await expireAndPurge(now)

  const live = write && mode === 'live'
  // Quiet hours hold a shadow run's would-be messages too: the shadow record is what live WOULD send (opus, gate 3a).
  if (write && isQuiet(now)) return { ...res, stopped: 'quiet' }

  const [jobs, teachers] = await Promise.all([loadJobs(now), loadTeachers()])
  res.teachers = teachers.length
  if (!jobs.length || !teachers.length) return res

  const ledgerMode = live ? 'live' : 'shadow'
  const ids = teachers.map((t) => t.profileId)
  const [offeredRows, emailedRows, dayRows, threads] = await Promise.all([
    db.teacherJobDm.findMany({ where: { profileId: { in: ids }, mode: ledgerMode }, select: { profileId: true, jobKey: true, kind: true, day: true } }),
    db.teacherJobMatch.findMany({ where: { teacherProfile: { profileId: { in: ids } }, emailedAt: { not: null } }, select: { listingId: true, teacherProfile: { select: { profileId: true } } } }),
    db.teacherJobDmDay.findMany({ where: { profileId: { in: ids }, day: vnToday(now) }, select: { profileId: true, kind: true } }),
    // "first" = no desk MESSAGE yet (an empty thread is not an introduction)
    db.conversation.findMany({ where: { sellerId: JOBS_DESK_SELLER_ID, listingId: null, buyerProfileId: { in: ids }, messages: { some: { senderProfileId: operatorId } } }, select: { buyerProfileId: true, id: true } }),
  ])
  const offered = groupSet(offeredRows.map((r) => [r.profileId, r.jobKey]))
  const emailed = groupSet(emailedRows.map((r) => [r.teacherProfile?.profileId ?? '', `listing:${r.listingId}`]))
  // One of each kind a day: live by its day key; shadow by its own rows of today (opus, gate 3a — a shadow record must
  // not overstate what live would send).
  const sentToday = new Set(live
    ? dayRows.map((r) => `${r.profileId}:${r.kind}`)
    : offeredRows.filter((r) => r.day === vnToday(now)).map((r) => `${r.profileId}:${r.kind}`))
  const hasThread = new Set(threads.map((t) => t.buyerProfileId))
  const day = vnToday(now)

  for (const t of teachers) {
    if (stopPending.has(t.profileId)) { res.skipped++; continue }
    const plan = planFor(t, jobs, offered.get(t.profileId) ?? new Set(), emailed.get(t.profileId) ?? new Set(), now)
    for (const kind of ['cover', 'jobs'] as const) {
      const picks = plan[kind]
      if (!picks.length) continue
      if (sentToday.has(`${t.profileId}:${kind}`)) { res.skipped++; continue }
      const items: DmItem[] = picks.map((p) => ({ key: p.job.key, ...p.job.item }))
      const dm = composeDm({ firstName: t.firstName, items, kind, first: !hasThread.has(t.profileId) })
      if (!dm.text) { res.skipped++; continue }
      const chosen = picks.filter((p) => dm.included.includes(p.job.key))
      if (!write) { res.shadow++; continue }
      if (!live) {
        await db.teacherJobDm.createMany({
          data: chosen.map((p) => ({ profileId: t.profileId, jobKey: p.job.key, mode: 'shadow', kind, day, score: p.score, reasons: p.reasons, preview: dm.text })),
          skipDuplicates: true,
        })
        sentToday.add(`${t.profileId}:${kind}`)
        res.shadow++
        continue
      }
      if (res.sent >= JOB_DM_RULES.maxDmsPerRun) return { ...res, stopped: 'ceiling' }
      // A run ends well inside its lock's 20 minutes, so no second run can start while it still sends (codex, gate 3h).
      if (Date.now() > deadline) return { ...res, stopped: 'deadline' }
      try {
        const out = await sendJobDm({ teacherProfileId: t.profileId, operatorId, kind, day, text: dm.text, repliesReadAt, jobs: chosen.map((p) => ({ key: p.job.key, score: p.score, reasons: p.reasons })) })
        if (out.sent) { res.sent++; hasThread.add(t.profileId); sentToday.add(`${t.profileId}:${kind}`) } else res.skipped++
      } catch (e) {
        // One teacher's failure never stops the run (teacher-message-emails' rule).
        res.failed++
        console.error('[job-dms] send', t.profileId, e)
      }
    }
  }
  return res
}

function groupSet(pairs: [string, string][]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const [k, v] of pairs) {
    if (!k) continue
    let s = m.get(k)
    if (!s) m.set(k, (s = new Set()))
    s.add(v)
  }
  return m
}
