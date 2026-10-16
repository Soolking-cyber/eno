import 'server-only'
import { db } from '@/lib/db'
import { DECLARATIONS } from '@/lib/compliance/declaration-text'

/**
 * THE IDENTITY CHECKS IN AN ACCOUNT'S DATA EXPORT (2026-10-16; PDPL access right) — GET /api/account/export.
 * One entry per identity_verifications row the account owns: the facts of the check (tier, method, status, when it was
 * submitted and decided) and the DECLARATION the person affirmed before uploading — its version, when, from which address
 * (/privacy says the declaration record keeps it — the person's own data, so theirs to download), the digest recorded for
 * it, and its exact words. Since identity-v2 that declaration is also the consent for a teacher's
 * "Identity verified" (src/lib/teachers/identity-mark.ts, owner 2026-10-16), so the consent record is part of what a
 * person can download, beside the other consent records the export already lists.
 * ⛔ NEVER THE DOCUMENT: no image path, document number, name, nationality, date of birth, expiry, subject hash or
 * face-match result leaves here — the SELECT names the safe columns one by one (src/lib/kyc/identity.ts: `evidence`
 * never leaves). A declaration id this build does not know (versions are only ever added — declaration-text.ts) exports
 * with `words: null` rather than words it cannot vouch for; a row from before the declaration existed (2026-08-03) has
 * `declaration: null` — absent, not refused.
 */
export const IDENTITY_EXPORT_SELECT = {
  tier: true, method: true, status: true, submittedAt: true, decidedAt: true,
  declarationVersion: true, declarationHash: true, declaredAt: true, declarationIp: true,
} as const

type ExportRow = {
  tier: string
  method: string
  status: string
  submittedAt: Date
  decidedAt: Date | null
  declarationVersion: string | null
  declarationHash: string | null
  declaredAt: Date | null
  declarationIp: string | null
}

export type IdentityVerificationExport = {
  tier: string
  method: string
  status: string
  submittedAt: Date
  decidedAt: Date | null
  declaration: { version: string; declaredAt: Date | null; ip: string | null; hash: string | null; words: { vi: string; en: string } | null } | null
}

/** The pure mapping — the rows as selected, in their order. */
export function identityVerificationExportRows(rows: readonly ExportRow[]): IdentityVerificationExport[] {
  return rows.map((r) => {
    const known = r.declarationVersion ? DECLARATIONS[r.declarationVersion] : undefined
    return {
      tier: r.tier,
      method: r.method,
      status: r.status,
      submittedAt: r.submittedAt,
      decidedAt: r.decidedAt,
      declaration: r.declarationVersion
        ? { version: r.declarationVersion, declaredAt: r.declaredAt, ip: r.declarationIp, hash: r.declarationHash, words: known ? { vi: known.vi, en: known.en } : null }
        : null,
    }
  })
}

/** Every identity check the account owns, oldest first, as the export carries it. */
export async function identityVerificationExportOf(profileId: string): Promise<IdentityVerificationExport[]> {
  const rows = await db.identityVerification.findMany({
    where: { profileId },
    orderBy: { submittedAt: 'asc' },
    select: IDENTITY_EXPORT_SELECT,
  })
  return identityVerificationExportRows(rows)
}
