import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { ACTIVE_JOB_STATUSES, FB_IMPORT_JOBS_PER_DAY, FB_IMPORT_LEASE_MINUTES, FB_IMPORT_MAX_ATTEMPTS, FB_IMPORT_MAX_ITEMS, FB_IMPORT_QUEUE_HOURS, FB_IMPORT_RETENTION_DAYS, vndFromFacebook, type ReportedItem } from './shared'
import { areaFromFacebook } from './area'

export type NewJobOutcome = { ok: true; id: string } | { ok: false; reason: 'active' | 'daily_limit' }

export async function createImportJob(profileId: string, fbName: string, pictureShas: string[]): Promise<NewJobOutcome> {
  const since = new Date(Date.now() - 24 * 3600_000)
  const recent = await db.facebookImportJob.findMany({ where: { profileId, createdAt: { gte: since } }, select: { status: true } })
  if (recent.some((j) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status))) return { ok: false, reason: 'active' }
  if (recent.length >= FB_IMPORT_JOBS_PER_DAY) return { ok: false, reason: 'daily_limit' }
  const job = await db.facebookImportJob.create({ data: { profileId, fbName: fbName.slice(0, 200), pictureShas }, select: { id: true } })
  return { ok: true, id: job.id }
}

export type ClaimedJob = { jobId: string; leaseId: string; name: string; pictureShas: string[]; maxItems: number }

/**
 * The oldest job, for one worker. ⛔ A LEASE THAT RUNS OUT RE-QUEUES ITS JOB WITH A NEW lease id, so a computer waking from sleep can't report into a job it lost (report() fences on the
 * lease). After FB_IMPORT_MAX_ATTEMPTS it fails rather than looping.
 */
export async function claimImportJob(now = new Date()): Promise<ClaimedJob | null> {
  // Out of attempts with listings already read: those are the seller's, so they go on to sorting.
  await db.facebookImportJob.updateMany({ where: { status: 'reading', leaseUntil: { lt: now }, attempts: { gte: FB_IMPORT_MAX_ATTEMPTS }, items: { some: {} } }, data: { status: 'sorting', leaseId: null, leaseUntil: null } })
  await db.facebookImportJob.updateMany({ where: { status: 'reading', leaseUntil: { lt: now }, attempts: { gte: FB_IMPORT_MAX_ATTEMPTS } }, data: { status: 'failed', leaseId: null, leaseUntil: null } })
  await db.facebookImportJob.updateMany({ where: { status: 'reading', leaseUntil: { lt: now } }, data: { status: 'queued', leaseId: null, leaseUntil: null } })
  const leaseId = randomUUID()
  const until = new Date(now.getTime() + FB_IMPORT_LEASE_MINUTES * 60_000)
  const rows = await db.$queryRaw<{ id: string; fbName: string; pictureShas: string[] }[]>(Prisma.sql`
    UPDATE "FacebookImportJob" SET status = 'reading', "leaseId" = ${leaseId}, "leaseUntil" = ${until}, attempts = attempts + 1, "updatedAt" = ${now}
    WHERE id = (SELECT id FROM "FacebookImportJob" WHERE status = 'queued' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, "fbName", "pictureShas"`)
  const r = rows[0]
  return r ? { jobId: r.id, leaseId, name: r.fbName, pictureShas: r.pictureShas, maxItems: FB_IMPORT_MAX_ITEMS } : null
}

/** Only the worker holding the current lease, on a job still being read. Extends the lease: a long list is progress. */
async function fence(jobId: string, leaseId: string, now: Date): Promise<boolean> {
  const r = await db.facebookImportJob.updateMany({
    where: { id: jobId, leaseId, status: 'reading', leaseUntil: { gte: now } },
    data: { leaseUntil: new Date(now.getTime() + FB_IMPORT_LEASE_MINUTES * 60_000) },
  })
  return r.count === 1
}

/** Replay-safe: the same item twice is one row. Refuses past the cap across every batch. */
export async function addReportedItems(jobId: string, leaseId: string, items: ReportedItem[], now = new Date()): Promise<boolean> {
  if (!(await fence(jobId, leaseId, now))) return false
  const have = await db.facebookImportItem.count({ where: { jobId } })
  const room = Math.max(0, FB_IMPORT_MAX_ITEMS - have)
  if (!room) return true
  await db.facebookImportItem.createMany({
    data: items.slice(0, room).map((i) => ({ jobId, fbItemId: i.fbItemId, raw: i as unknown as Prisma.InputJsonValue, price: vndFromFacebook(i.priceAmount, i.currency), ...areaFromFacebook(i.location) })),
    skipDuplicates: true,
  })
  return true
}

export type JobEnd = 'finished' | 'not_found' | 'unavailable' | 'error'
const NEXT_STATUS: Record<JobEnd, string> = { finished: 'sorting', not_found: 'not_found', unavailable: 'unavailable', error: 'failed' }

export async function endImportJob(jobId: string, leaseId: string, end: JobEnd, now = new Date()): Promise<boolean> {
  if (!(await fence(jobId, leaseId, now))) return false
  // Stopped part way: what was already read is the seller's, not lost with the job.
  const partial = (end === 'error' || end === 'unavailable') && (await db.facebookImportItem.count({ where: { jobId } })) > 0
  await db.facebookImportJob.update({ where: { id: jobId }, data: { status: partial ? 'sorting' : NEXT_STATUS[end], leaseId: null, leaseUntil: null } })
  return true
}

/** The cron's housekeeping: a queue nobody read says so; old imports leave. A published listing lives on: only the import's own rows go. */
export async function sweepImportJobs(now = new Date()): Promise<{ timedOut: number; deleted: number; unstuck: number }> {
  const timedOut = await db.facebookImportJob.updateMany({ where: { status: 'queued', createdAt: { lt: new Date(now.getTime() - FB_IMPORT_QUEUE_HOURS * 3600_000) } }, data: { status: 'unavailable' } })
  // A worker that went away leaves its lease unclaimed, and only a claim recovers it: the seller shouldn't read "Reading…" for a week.
  const gone = new Date(now.getTime() - FB_IMPORT_QUEUE_HOURS * 3600_000)
  await db.facebookImportJob.updateMany({ where: { status: { in: ['reading', 'queued'] }, updatedAt: { lt: gone }, items: { some: {} } }, data: { status: 'sorting', leaseId: null, leaseUntil: null } })
  const lost = await db.facebookImportJob.updateMany({ where: { status: 'reading', leaseUntil: { lt: gone } }, data: { status: 'unavailable', leaseId: null, leaseUntil: null } })
  const deleted = await db.facebookImportJob.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - FB_IMPORT_RETENTION_DAYS * 86400_000) } } })
  // A publish killed half way: back to draft. publish.ts re-checks externalId before posting again.
  const unstuck = await db.facebookImportItem.updateMany({ where: { status: 'publishing', publishingSince: { lt: new Date(now.getTime() - 10 * 60_000) } }, data: { status: 'draft', publishingSince: null } })
  return { timedOut: timedOut.count + lost.count, deleted: deleted.count, unstuck: unstuck.count }
}
