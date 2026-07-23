import 'server-only'
import { db } from '@/lib/db'
import {
  sellerIdentityHash,
  VERIFICATION_VALIDITY_MS,
  VERIFICATION_DOC_RETENTION_MS,
  type SellerIdentity,
} from '@/lib/business-verification'
import {
  parseVerificationDocs,
  removeVerificationDocs,
  type VerificationDoc,
  type VerificationDocKind,
} from '@/lib/business-verification-store'
import { taxVerdict } from '@/lib/tax-lookup'

// The Prisma writes for the business-verification case, with the concurrency guards the
// external review demanded. The CASE state machine: draft (uploading, mutable) → pending
// (submitted, evidence + identity hash FROZEN) → approved | rejected. A rejected seller
// resubmits as a NEW version (the row is immutable once it leaves draft).
//
// ⚠️ The badge itself is NOT a status here — it is derived from Seller.verifiedIdentityHash
// (see src/lib/business-verification.ts). This module only moves the review case forward
// and, on approval, stamps that hash. An identity edit after approval needs NO write here:
// the derivation compares hashes live, so the badge silently stops matching.

const IDENTITY_SELECT = {
  name: true, legalName: true, legalAddress: true, idNumber: true, taxCode: true,
} as const

const TAX_SELECT = {
  taxCode: true, taxCheckedAt: true, taxRegisteredName: true, taxActive: true, legalName: true, name: true,
} as const

/** The seller's current identity, for hashing. */
async function sellerIdentity(sellerId: string): Promise<SellerIdentity | null> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: IDENTITY_SELECT })
  return s ?? null
}

/** The applicant's OWN case view — the newest case for their seller, plus its docs. */
export async function loadOwnVerification(sellerId: string) {
  const row = await db.sellerVerification.findFirst({
    where: { sellerId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, documents: true, submittedAt: true, reviewedAt: true, note: true },
  })
  if (!row) return null
  return { ...row, documents: parseVerificationDocs(row.documents) }
}

/** Get the seller's active DRAFT case, creating one (next version) when none is open.
 *  Returns null when a case is already pending/approved (nothing to add to). */
export async function getOrCreateDraft(sellerId: string): Promise<{ id: string; documents: VerificationDoc[] } | null> {
  const latest = await db.sellerVerification.findFirst({
    where: { sellerId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, documents: true },
  })
  if (latest?.status === 'pending' || latest?.status === 'approved') return null // locked / already done
  if (latest?.status === 'draft') return { id: latest.id, documents: parseVerificationDocs(latest.documents) }
  const version = (latest?.version ?? 0) + 1
  const created = await db.sellerVerification.create({
    data: { sellerId, version, status: 'draft', documents: [] },
    select: { id: true, documents: true },
  })
  return { id: created.id, documents: parseVerificationDocs(created.documents) }
}

/** Append a stored document to a DRAFT case (guarded: only writes while status='draft'). */
export async function appendVerificationDoc(caseId: string, doc: VerificationDoc): Promise<boolean> {
  const row = await db.sellerVerification.findUnique({ where: { id: caseId }, select: { status: true, documents: true } })
  if (!row || row.status !== 'draft') return false
  const docs = [...parseVerificationDocs(row.documents), doc]
  // Guard the write on status='draft' so a concurrent submit can't accept a late doc.
  const upd = await db.sellerVerification.updateMany({
    where: { id: caseId, status: 'draft' },
    data: { documents: docs as unknown as object },
  })
  return upd.count === 1
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: 'no_seller' | 'nothing_to_submit' | 'missing_identity_doc' | 'missing_bank_doc' | 'missing_legal_fields' | 'already_open' | 'duplicate_tax' }

/**
 * Freeze a draft into a pending review. Requires the seller's legal identity to be filled
 * and both an identity and a bank document present, records the identity HASH the review
 * will be validated against, and blocks a second seller from claiming a tax code already
 * verified elsewhere (external review — duplicate MST is blocked, not warned).
 */
export async function submitVerification(sellerId: string, consentVersion: string): Promise<SubmitResult> {
  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    select: { ...IDENTITY_SELECT, ownerId: true },
  })
  if (!seller) return { ok: false, error: 'no_seller' }
  if (!seller.legalName || !seller.legalAddress || !seller.idNumber || !seller.taxCode) {
    return { ok: false, error: 'missing_legal_fields' }
  }
  const draft = await db.sellerVerification.findFirst({
    where: { sellerId },
    orderBy: { version: 'desc' },
    select: { id: true, status: true, documents: true },
  })
  if (!draft || draft.status !== 'draft') return { ok: false, error: draft ? 'already_open' : 'nothing_to_submit' }
  const docs = parseVerificationDocs(draft.documents)
  if (!docs.some((d) => d.kind === 'identity')) return { ok: false, error: 'missing_identity_doc' }
  if (!docs.some((d) => d.kind === 'bank')) return { ok: false, error: 'missing_bank_doc' }

  // One verified badge per tax code: a DIFFERENT seller already holding a live-hash
  // approval for this MST must not be able to submit against the same identity.
  const clash = await db.seller.findFirst({
    where: { taxCode: seller.taxCode, verifiedIdentityHash: { not: null }, id: { not: sellerId } },
    select: { id: true },
  })
  if (clash) return { ok: false, error: 'duplicate_tax' }

  const identityHash = sellerIdentityHash(seller)
  const upd = await db.sellerVerification.updateMany({
    where: { id: draft.id, status: 'draft' },
    data: { status: 'pending', identityHash, submittedAt: new Date(), consentAt: new Date(), consentVersion },
  })
  return upd.count === 1 ? { ok: true } : { ok: false, error: 'already_open' }
}

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_pending' | 'channel1_unverified' | 'identity_moved' | 'seller_gone' }

/**
 * APPROVE a pending case. Re-checks Channel 1 (tax verdict) live and — critically — that
 * the seller's CURRENT identity still hashes to the value frozen at submit (the case's
 * identityHash). If the applicant edited their identity after submitting, the review is
 * refused with `identity_moved` (they must resubmit) — this closes the approve-vs-edit race.
 * Guarded by an optimistic updateMany on status='pending'. Stamps the hash + validity
 * window onto the Seller, from which the public badge derives.
 */
export async function approveVerification(caseId: string, adminEmail: string): Promise<ReviewResult> {
  const row = await db.sellerVerification.findUnique({
    where: { id: caseId },
    select: { id: true, sellerId: true, status: true, identityHash: true },
  })
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'pending') return { ok: false, error: 'not_pending' }

  const seller = await db.seller.findUnique({ where: { id: row.sellerId }, select: TAX_SELECT })
  if (!seller) return { ok: false, error: 'seller_gone' }
  if (taxVerdict(seller) !== 'verified') return { ok: false, error: 'channel1_unverified' }

  const liveIdentity = await sellerIdentity(row.sellerId)
  if (!liveIdentity) return { ok: false, error: 'seller_gone' }
  if (!row.identityHash || sellerIdentityHash(liveIdentity) !== row.identityHash) {
    return { ok: false, error: 'identity_moved' }
  }

  const now = new Date()
  const reviewed = await db.sellerVerification.updateMany({
    where: { id: caseId, status: 'pending' },
    data: {
      status: 'approved', reviewedAt: now, reviewedBy: adminEmail,
      retentionUntil: new Date(now.getTime() + VERIFICATION_DOC_RETENTION_MS),
    },
  })
  if (reviewed.count !== 1) return { ok: false, error: 'not_pending' } // lost the race
  // Stamp the badge source-of-truth. verifiedIdentityHash == the frozen hash we just
  // re-proved matches live, so the badge shows immediately and drops on any later edit.
  await db.seller.update({
    where: { id: row.sellerId },
    data: {
      verifiedIdentityHash: row.identityHash,
      verifiedAt: now,
      verifiedUntil: new Date(now.getTime() + VERIFICATION_VALIDITY_MS),
      verifiedBy: adminEmail,
    },
  })
  return { ok: true }
}

/** REJECT a pending case with an operator note. Does NOT touch the Seller badge fields. */
export async function rejectVerification(caseId: string, adminEmail: string, note: string): Promise<ReviewResult> {
  const now = new Date()
  const upd = await db.sellerVerification.updateMany({
    where: { id: caseId, status: 'pending' },
    data: {
      status: 'rejected', reviewedAt: now, reviewedBy: adminEmail, note: note.slice(0, 1000),
      retentionUntil: new Date(now.getTime() + VERIFICATION_DOC_RETENTION_MS),
    },
  })
  return upd.count === 1 ? { ok: true } : { ok: false, error: 'not_pending' }
}

/** The admin review queue — pending cases, newest first, with the seller's public identity. */
export async function listPendingVerifications(limit = 100) {
  const rows = await db.sellerVerification.findMany({
    where: { status: 'pending' },
    orderBy: { submittedAt: 'asc' },
    take: limit,
    select: {
      id: true, sellerId: true, submittedAt: true,
      seller: { select: { name: true, legalName: true, taxCode: true } },
    },
  })
  return rows
}

/** One case for the detail page, with its documents and the live Channel-1 verdict. */
export async function loadVerificationForReview(caseId: string) {
  const row = await db.sellerVerification.findUnique({
    where: { id: caseId },
    select: {
      id: true, sellerId: true, status: true, documents: true, bankNameSeen: true,
      submittedAt: true, reviewedAt: true, reviewedBy: true, note: true, consentAt: true,
      seller: { select: TAX_SELECT },
    },
  })
  if (!row) return null
  return {
    ...row,
    documents: parseVerificationDocs(row.documents),
    channel1: row.seller ? taxVerdict(row.seller) : 'unchecked',
  }
}

/** Retention sweep — remove documents of decided cases past their window. Best-effort. */
export async function sweepVerificationRetention(now = new Date(), limit = 200): Promise<number> {
  const due = await db.sellerVerification.findMany({
    where: { retentionUntil: { not: null, lt: now }, documents: { not: '[]' } },
    take: limit,
    select: { id: true, documents: true },
  })
  let swept = 0
  for (const row of due) {
    const paths = parseVerificationDocs(row.documents).map((d) => d.path)
    await removeVerificationDocs(paths)
    await db.sellerVerification.update({ where: { id: row.id }, data: { documents: [] } })
    swept++
  }
  return swept
}

export type { VerificationDocKind }
