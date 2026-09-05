import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'

// ── STORAGE TOMBSTONES — the durable half of erasure ────────────────────────────────────────────
//
// Every path that deletes a storage object used to be "delete the row, then try the object, and
// log it if that failed". The 2026-09-05 review counted the ways that loses an object for good:
// a 12-second purge budget on account deletion with the rows already gone; a visa document
// replacement that inserted, deleted and then removed fail-open; a case deletion that removed
// files after the row with `strict: false`. Each was bounded and loud and none could RETRY,
// because the only record of the object had just been deleted.
//
// A tombstone is that record, written BEFORE the row goes — inside the row's own transaction
// where there is one. The fast path still deletes the object immediately and clears its
// tombstone; what the fast path does not finish, the sweep finishes later. ⚠️ THE SWEEP LIVES IN
// storage-tombstones-sweep.svc.ts, services edition only: it has to know the visa documents table
// to judge a visa-documents tombstone, and that vocabulary must not compile into the marketplace
// image. The writers here are edition-neutral and shared by both.
//
// ⚠️ EVERY TOMBSTONE GETS A GRACE HOUR (`notBefore`). Without it two races are live: the sweep
// could delete a just-uploaded object before its commit references it, and could drop a "still
// referenced" tombstone a millisecond before the row delete commits, leaving the object with no
// tombstone at all. An hour is longer than any request on this app can run.

export const TOMBSTONE_GRACE_MS = 60 * 60 * 1000

export type TombstoneRef = { bucket: string; path: string }
export type TombstoneReason = 'account_deleted' | 'visa_document_replaced' | 'visa_application_deleted' | 'visa_upload_intent'
type Writer = Pick<Prisma.TransactionClient, 'storageTombstone' | '$executeRaw'>

/** Record that these objects are to be deleted once nothing references them. Pass the transaction
 *  client when the referencing rows die in a transaction, so the tombstones commit with them.
 *  Idempotent on rows — an existing tombstone for the same object gets the NEW reason and a fresh
 *  grace clock (see below). Returns the number of tombstones written or refreshed. */
export async function writeTombstones(tx: Writer, refs: TombstoneRef[], reason: TombstoneReason, now = new Date()): Promise<number> {
  const seen = new Set<string>()
  const notBefore = new Date(now.getTime() + TOMBSTONE_GRACE_MS)
  const data: Array<{ bucket: string; path: string; reason: TombstoneReason; notBefore: Date }> = []
  for (const r of refs) {
    if (!r.bucket || !r.path) continue
    const key = `${r.bucket}\n${r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    data.push({ bucket: r.bucket, path: r.path, reason, notBefore })
  }
  if (!data.length) return 0
  // ⚠️ ONE STATEMENT. An existing tombstone gets the NEW clock and reason (a leftover from an
  // earlier failed attempt at the same path may already be due; a fresh upload-intent must never
  // have zero grace) — and it has to be the SAME statement as the insert: with a create followed by
  // an update, the sweep could drop the old row as "referenced" in between, and the write would
  // commit with no tombstone at all. `INSERT … ON CONFLICT DO UPDATE` is atomic per row. Returns
  // the number of NEW rows, like createMany did.
  const values = data.map((d) => Prisma.sql`(${Prisma.raw(`'${cuid()}'`)}, ${d.bucket}, ${d.path}, ${reason}, ${notBefore})`)
  const rows = await tx.$executeRaw`
    insert into "StorageTombstone" ("id", "bucket", "path", "reason", "notBefore")
    values ${Prisma.join(values)}
    on conflict ("bucket", "path") do update set "reason" = excluded."reason", "notBefore" = excluded."notBefore", "lastError" = null, "attempts" = 0
  `
  // $executeRaw reports affected rows — inserted OR refreshed; an upsert cannot tell them apart.
  return rows
}

/** A collision-safe id for a raw insert — Prisma's cuid() default lives in the client, not the DB. */
function cuid(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)
}

/** The fast path finished these — the objects are gone, or were found to be somebody else's. */
export async function clearTombstones(refs: TombstoneRef[]): Promise<number> {
  let cleared = 0
  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100)
    if (!chunk.length) break
    const { count } = await db.storageTombstone.deleteMany({ where: { OR: chunk.map((r) => ({ bucket: r.bucket, path: r.path })) } })
    cleared += count
  }
  return cleared
}

