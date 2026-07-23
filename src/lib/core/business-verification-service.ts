import 'server-only'
import { db } from '@/lib/db'
import {
  isBusinessVerified,
  sellerIdentityHash,
  verificationView,
  VERIFICATION_VALIDITY_MS,
  VERIFICATION_DOC_RETENTION_MS,
  type SellerIdentity,
  type VerificationFacts,
  type VerificationView,
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

// Everything isBusinessVerified() reads — the full identity + tax facts + the badge stamp.
const VERIFY_SELECT = {
  name: true, legalName: true, legalAddress: true, idNumber: true, taxCode: true,
  taxCheckedAt: true, taxRegisteredName: true, taxActive: true,
  verifiedIdentityHash: true, verifiedUntil: true,
} as const

/** Is this seller's badge live right now? (Reads the full verification facts.) */
async function sellerLiveVerified(sellerId: string): Promise<boolean> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: VERIFY_SELECT })
  return s ? isBusinessVerified(s as VerificationFacts) : false
}

/** The applicant-facing verification state (verified/pending/expired/rejected/…) — the
 *  LIVE badge derivation, not the raw case status, so an edited/expired badge reads honestly. */
export async function ownVerificationView(sellerId: string): Promise<VerificationView> {
  const [s, latest] = await Promise.all([
    db.seller.findUnique({ where: { id: sellerId }, select: VERIFY_SELECT }),
    db.sellerVerification.findFirst({ where: { sellerId }, orderBy: { version: 'desc' }, select: { status: true } }),
  ])
  if (!s) return 'unverified'
  return verificationView(s as VerificationFacts, (latest?.status as 'draft' | 'pending' | 'approved' | 'rejected' | undefined) ?? null)
}

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

/** Get the seller's active DRAFT case, creating one (next version) when the seller is
 *  neither currently LIVE-verified nor mid-review. A rejected case, or an approved case
 *  whose badge has since dropped (identity edited / window lapsed), opens a NEW version —
 *  so a seller is never dead-ended out of re-verifying (external review). Returns null
 *  only when a case is pending, or the badge is live (nothing to do). */
export async function getOrCreateDraft(sellerId: string): Promise<{ id: string; documents: VerificationDoc[] } | null> {
  const latest = await db.sellerVerification.findFirst({
    where: { sellerId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, documents: true },
  })
  if (latest?.status === 'pending') return null // under review — locked
  // Already verified live? Nothing to do, whatever the latest case status is (external
  // review: guard on the badge, not on 'approved' specifically).
  if (await sellerLiveVerified(sellerId)) return null
  if (latest?.status === 'draft') return { id: latest.id, documents: parseVerificationDocs(latest.documents) }
  const version = (latest?.version ?? 0) + 1
  const created = await db.sellerVerification.create({
    data: { sellerId, version, status: 'draft', documents: [] },
    select: { id: true, documents: true },
  })
  return { id: created.id, documents: parseVerificationDocs(created.documents) }
}

/** Append a stored document to a DRAFT case. The read-modify-write is serialized in a
 *  transaction so two concurrent uploads to the same draft can't lost-update each other
 *  (external review). Guarded on status='draft' so a concurrent submit rejects a late doc. */
export async function appendVerificationDoc(caseId: string, doc: VerificationDoc): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const row = await tx.sellerVerification.findUnique({ where: { id: caseId }, select: { status: true, documents: true } })
    if (!row || row.status !== 'draft') return false
    const docs = [...parseVerificationDocs(row.documents), doc]
    const upd = await tx.sellerVerification.updateMany({
      where: { id: caseId, status: 'draft' },
      data: { documents: docs as unknown as object },
    })
    return upd.count === 1
  })
}

/** Does this case actually hold a document at `path`? Gates the admin signed-URL action
 *  so a caller-supplied path can never reach an object outside the case (IDOR guard). */
export async function caseHasDocument(caseId: string, path: string): Promise<boolean> {
  const row = await db.sellerVerification.findUnique({ where: { id: caseId }, select: { documents: true } })
  if (!row) return false
  return parseVerificationDocs(row.documents).some((d) => d.path === path)
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
  | { ok: false; error: 'not_found' | 'not_pending' | 'channel1_unverified' | 'identity_moved' | 'seller_gone' | 'duplicate_tax' }

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

  const seller = await db.seller.findUnique({ where: { id: row.sellerId }, select: { ...TAX_SELECT, taxCode: true } })
  if (!seller) return { ok: false, error: 'seller_gone' }
  if (taxVerdict(seller) !== 'verified') return { ok: false, error: 'channel1_unverified' }

  const liveIdentity = await sellerIdentity(row.sellerId)
  if (!liveIdentity) return { ok: false, error: 'seller_gone' }
  if (!row.identityHash || sellerIdentityHash(liveIdentity) !== row.identityHash) {
    return { ok: false, error: 'identity_moved' }
  }

  // ⚠️ APPROVAL is the atomic claim point for a tax code (external review): the submit-time
  // check + the stamp are two operations, so a fast-path check is not enough — the real
  // guarantee is the partial unique index Seller(taxCode) WHERE verifiedIdentityHash IS NOT
  // NULL. The transition + stamp run in ONE transaction; a concurrent approval for the same
  // MST loses on the P2002 and the whole thing rolls back (the case stays pending).
  const now = new Date()
  try {
    const outcome = await db.$transaction(async (tx) => {
      const reviewed = await tx.sellerVerification.updateMany({
        where: { id: caseId, status: 'pending' },
        data: {
          status: 'approved', reviewedAt: now, reviewedBy: adminEmail,
          retentionUntil: new Date(now.getTime() + VERIFICATION_DOC_RETENTION_MS),
        },
      })
      if (reviewed.count !== 1) return 'not_pending' as const
      // Stamp the badge source-of-truth. The partial unique index throws P2002 here if
      // another seller already holds a live stamp for this taxCode → the tx rolls back.
      await tx.seller.update({
        where: { id: row.sellerId },
        data: {
          verifiedIdentityHash: row.identityHash,
          verifiedAt: now,
          verifiedUntil: new Date(now.getTime() + VERIFICATION_VALIDITY_MS),
          verifiedBy: adminEmail,
        },
      })
      return 'ok' as const
    })
    return outcome === 'ok' ? { ok: true } : { ok: false, error: 'not_pending' }
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return { ok: false, error: 'duplicate_tax' }
    throw e
  }
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
