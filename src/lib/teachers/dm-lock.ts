// The account's teacher-DM lock (owner, 2026-10-13 — the DM ladder, src/lib/teachers/dm-quota.ts). Its own module, with
// nothing but a type import, so a caller outside the ladder can take it without loading the ladder.
import type { Prisma } from '@/generated/prisma/client'

/**
 * Serializes everything that decides whether this account may open a NEW teacher thread: openTeacherThread takes it
 * before it re-reads and recounts, and an identity revocation takes it before it writes (admin-users.ts revokeIdentity),
 * so a revocation either committed before the ladder's read — and is seen — or waits for the thread being made
 * (codex, gate 2026-10-13). A transaction-scoped advisory lock: released at commit or rollback, never left behind.
 */
export function teacherDmLock(tx: Prisma.TransactionClient, profileId: string): Promise<number> {
  return tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher-dm:' + profileId}))`
}
