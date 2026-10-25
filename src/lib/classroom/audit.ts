import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'

type Tx = Prisma.TransactionClient

/** A bounded wait on the audit log's advisory lock — the consent route's rule (src/app/api/consent/route.ts). */
const CONSENT_LOCK_TIMEOUT = '1000ms'

/** The first 16 hex of a notice's SHA-256 — what a consent record names (the bio route's NOTICE_SHA). */
export function noticeSha(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

/**
 * ⛔ THE RECORD BEFORE THE DATA LEAVES (Decree 356 Art 6.1–6.2: the controller proves the consent). Every classroom consent
 * and withdrawal is a row in the hash-chained compliance log, written in the caller's own transaction where the data it
 * covers is written too — so a learner never exists without the record of what was agreed for them, and a failed record
 * means nothing was saved. The subject is always the ACCOUNT HOLDER (the adult who agreed); a child is named only by the
 * learner id in `detail`. Never a word of what anyone said or wrote.
 */
export async function classroomAudit(tx: Tx, accountId: string, action: string, detail: Prisma.InputJsonObject): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${CONSENT_LOCK_TIMEOUT}, true)`
  await appendAudit(tx, { actorType: 'user', actorId: accountId, action, subjectType: 'profile', subjectId: accountId, detail })
}

/** The same record on its own (an AI request — nothing else is written with it). */
export async function classroomAuditAlone(accountId: string, action: string, detail: Prisma.InputJsonObject): Promise<void> {
  await db.$transaction((tx) => classroomAudit(tx, accountId, action, detail), { maxWait: 1_000 })
}
