import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { LegalBasisKey } from './legal-basis'

// ── The investigative audit log (3-year retention) ──────────────────────────────────────────────
//
// Every compliance-relevant act writes here: an identity verified, a listing taken down, an appeal
// resolved, a document purged. docs/compliance-2026.md §2.5.
//
// ⚠️ THE HASH CHAIN IS THE WHOLE POINT. A plain table proves nothing — anyone with write access can
// rewrite history, so as evidence it is worth exactly zero. Each row commits to its predecessor:
//
//     rowHash = sha256( prevHash ‖ canonicalJson(row) )
//
// so editing or deleting any row breaks every link after it, and the break is detectable by anyone
// (including an auditor running compliance_audit_verify_chain() in psql, without our code).
// UPDATE/DELETE are additionally blocked by RULEs — see scripts/compliance-ddl.mjs.

export type AuditActorType = 'user' | 'admin' | 'authority' | 'system'
export type AuditSubjectType = 'profile' | 'listing' | 'seller'

export type AuditInput = {
  actorType: AuditActorType
  actorId?: string | null
  /** ⚠️ cf-connecting-ip ONLY — never a client-supplied X-Forwarded-For. See clientIp() callers. */
  actorIp?: string | null
  /** Dotted verb: identity.verified · listing.taken_down · listing.restored · document.purged */
  action: string
  subjectType: AuditSubjectType
  subjectId: string
  detail: Prisma.InputJsonValue
  legalBasis?: LegalBasisKey | null
}

/**
 * ⚠️ CANONICAL SERIALISATION, NOT `JSON.stringify`. Object key order in JS follows insertion order,
 * so two structurally identical details serialise differently depending on how they were built —
 * and the chain would then be unverifiable by any independent implementation. Keys are sorted
 * recursively so the digest depends on the DATA, not on how the object happened to be assembled.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined) // undefined has no JSON form; dropping it must be explicit
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** The exact bytes a row commits to. Kept separate so a verifier can reproduce it independently. */
export function computeRowHash(prevHash: string | null, row: AuditInput & { occurredAt: Date }): string {
  const payload = canonicalJson({
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    // ⚠️ actorIp IS PART OF THE COMMITMENT. It was stored but left OUT of the hash, so the one
    // field an attacker would most want to rewrite — who did this — was the one field the chain
    // did not protect (codex). Anything recorded as evidence must be inside the digest.
    actorIp: row.actorIp ?? null,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    detail: row.detail,
    legalBasis: row.legalBasis ?? null,
  })
  return createHash('sha256').update(`${prevHash ?? ''}|${payload}`).digest('hex')
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

/**
 * Append one row to the chain.
 *
 * ⚠️ CALL THIS INSIDE THE SAME TRANSACTION AS THE ACT IT RECORDS. A takedown that commits without
 * its audit row is worse than a failed takedown: the content is gone and we cannot show why, on
 * exactly the request most likely to be scrutinised.
 *
 * ⚠️ THE ADVISORY LOCK IS NOT OPTIONAL. Two concurrent appends that both read the same `prevHash`
 * produce a FORK — two rows claiming the same predecessor — which is indistinguishable from
 * tampering to anyone auditing later. A transaction-scoped lock serialises appends; at this write
 * volume (a handful per day) the contention cost is irrelevant next to an unverifiable log.
 */
export async function appendAudit(tx: Tx, input: AuditInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('compliance_audit'))`
  const prev = await tx.complianceAudit.findFirst({
    orderBy: { id: 'desc' },
    select: { rowHash: true },
  })
  const occurredAt = new Date()
  const rowHash = computeRowHash(prev?.rowHash ?? null, { ...input, occurredAt })
  return tx.complianceAudit.create({
    data: {
      occurredAt,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      actorIp: input.actorIp ?? null,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      detail: input.detail,
      legalBasis: input.legalBasis ?? null,
      prevHash: prev?.rowHash ?? null,
      rowHash,
    },
  })
}
