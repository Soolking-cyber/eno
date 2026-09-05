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
import { logError } from '@/lib/log'
import { after } from 'next/server'
import { SITE_NAME } from '@/lib/edition'
import { sendPushToProfile } from '@/lib/push'
import { sendMail } from '@/lib/mail'
import { renderVerificationOutcomeEmail } from '@/lib/emails/business-verification'
import { personBeforeBusinessEnforced, ownerPersonVerified } from '@/lib/kyc/person-gate'

/**
 * TELL THE SELLER WHAT HAPPENED — bell, push and email.
 *
 * ⛔ THIS DID NOT EXIST, AND ITS ABSENCE WAS THE WHOLE BUG. Owner, 2026-08-17: "when business
 * registration documents sent and rejected or approved seller doesnt get noticification".
 * The review wrote a status to the database and told nobody; the panel showed the outcome only
 * the next time the seller happened to open Settings, and nothing invited them to. A REJECTION is
 * the worse half, because it asks them to do something ("a specialist asked for a change: tax
 * code") and they cannot act on a message they never receive.
 *
 * ⚠️ IT LIVES IN THE SERVICE, NOT IN THE SERVER ACTION. The action is one caller; a future admin
 * API, a bulk tool or a script would each have to remember. Putting it beside the transition means
 * "the status changed" and "the seller was told" cannot come apart.
 *
 * ⚠️ CALLED ONLY AFTER A CONFIRMED TRANSITION. Both reviews are compare-and-set `updateMany`s on
 * `status: 'pending'`; this runs only where `count === 1`, so two admins clicking at once produce
 * one state change and exactly one notification, not two.
 *
 * ⚠️ BEST-EFFORT, AND IT MUST STAY THAT WAY. A review that succeeded must never be reported as
 * failed because a push endpoint 410'd or SMTP was briefly down — the seller's badge is already
 * live. Everything here is wrapped, and the email rides `after()` so it cannot delay the admin's
 * response.
 */
async function notifyVerificationOutcome(
  sellerId: string,
  outcome: 'approved' | 'rejected',
  note: string | null,
): Promise<void> {
  try {
    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { ownerId: true, owner: { select: { email: true, locale: true } } },
    })
    // A seller row whose owner was removed is unreachable, not an error — the same shape the
    // dispute flow treats a guest storefront as.
    const ownerId = seller?.ownerId
    if (!ownerId) return
    const lang: 'en' | 'vi' = seller.owner?.locale?.startsWith('vi') ? 'vi' : 'en'
    const approved = outcome === 'approved'

    const title = approved
      ? (lang === 'vi' ? 'Doanh nghiệp đã được xác minh' : 'Your business is verified')
      : (lang === 'vi' ? 'Xác minh cần chỉnh sửa' : 'Verification needs a change')
    /** In-app body: behind auth, so the operator's note — the actionable part — belongs here. */
    const bellBody = approved
      ? (lang === 'vi' ? 'Huy hiệu đã xác minh đang hiển thị trên gian hàng của bạn.' : 'The verified badge is now live on your storefront.')
      : (note?.slice(0, 140) || (lang === 'vi' ? 'Chuyên viên yêu cầu chỉnh sửa.' : 'A specialist asked for a change.'))
    /**
     * ⛔ THE PUSH BODY NEVER CARRIES THE NOTE — reviewer-caught, and it is the same rule the email
     * subject already followed. A push is rendered on a LOCK SCREEN: a phone face-up on a café
     * table, and every notification bridge that logs it. The operator's note is free text and can
     * name a tax code, a licence number or a bank account holder. "A specialist asked for a change"
     * says enough to make someone open the app, which is all a push has to do.
     */
    const pushBody = approved
      ? (lang === 'vi' ? 'Gian hàng của bạn đã được xác minh.' : 'Your storefront is now verified.')
      : (lang === 'vi' ? 'Chuyên viên yêu cầu chỉnh sửa. Mở cài đặt để xem.' : 'A specialist asked for a change. Open settings to see it.')

    /**
     * ⚠️ THREE INDEPENDENT CHANNELS, NOT ONE CHAIN — reviewer-caught. These were all inside one
     * try, so a transient failure writing the bell row skipped the push AND the email, leaving a
     * seller told nothing while the admin saw `{ ok: true }` and the transition had already
     * committed. Each channel now fails alone.
     */
    try {
      await db.notification.create({
        data: { recipientId: ownerId, type: 'system', title, body: bellBody, actorName: SITE_NAME, url: '/dashboard/settings' },
      })
    } catch (e) {
      console.error('[verification] bell', (e as Error).message)
    }

    const to = seller.owner?.email
    const deliver = async () => {
      try {
        await sendPushToProfile(ownerId, { title, body: pushBody, url: '/dashboard/settings', tag: `verification-${sellerId}` })
      } catch { /* a dead push subscription is not a review failure */ }
      if (!to) return
      try {
        const origin = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
        const mail = renderVerificationOutcomeEmail({ outcome, note, lang, origin, siteName: SITE_NAME })
        await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text })
      } catch (e) {
        console.error('[verification] outcome email', (e as Error).message)
      }
    }

    /**
     * ⚠️ `after()` THROWS OUTSIDE A REQUEST SCOPE, and this service is deliberately callable from
     * places that have none — a script, a cron, a bulk tool. Reviewer-caught. In a request we defer
     * so the admin's response is not held up by SMTP; outside one we simply await, because a
     * background hook with no request to attach to is not a reason to skip the email.
     */
    try {
      after(deliver)
    } catch {
      await deliver()
    }
  } catch (e) {
    console.error('[verification] notify', outcome, (e as Error).message)
  }
}

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
  | { ok: false; error: 'no_seller' | 'nothing_to_submit' | 'missing_identity_doc' | 'missing_bank_doc' | 'missing_legal_fields' | 'already_open' | 'duplicate_tax' | 'person_unverified' }

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
  /**
   * ⛔ STAGE 1 BEFORE STAGE 2 — checked FIRST, before the legal fields, because it is the cheapest
   * refusal to act on and the most confusing to receive late. Being told to fill in a tax code and
   * upload two documents, and only then that none of it counted because you had not verified
   * yourself, is the worst ordering of the same two facts.
   * ⚠️ THE COST OF THAT ORDER, NAMED: it also precedes `already_open`, so a seller who ALREADY has
   * a pending case and is not person-verified now reads `person_unverified` rather than
   * `already_open`. codex flagged the swap. It is kept this way because that state only exists when
   * the flag is turned ON over an open case, and in that situation `person_unverified` is both true
   * and the thing they must act on — their pending case will be refused at approval regardless.
   */
  if (personBeforeBusinessEnforced() && !(await ownerPersonVerified(seller.ownerId))) {
    return { ok: false, error: 'person_unverified' }
  }
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
  | { ok: false; error: 'not_found' | 'not_pending' | 'channel1_unverified' | 'identity_moved' | 'seller_gone' | 'duplicate_tax' | 'person_unverified' }

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

  // ⚠️ `ownerId` IS SELECTED FOR THE PERSON GATE BELOW. Without it the gate would need its own
  // round trip, and a second read is a second chance for the two to disagree.
  const seller = await db.seller.findUnique({ where: { id: row.sellerId }, select: { ...TAX_SELECT, taxCode: true, ownerId: true } })
  if (!seller) return { ok: false, error: 'seller_gone' }
  /**
   * ⛔ RE-CHECKED AT APPROVAL, NOT ONLY AT SUBMIT — AND THIS IS THE HALF THAT MATTERS. State drifts
   * between the two: a person can verify, submit their business, and be REVOKED or let their
   * document expire before a reviewer opens the case. Gating only at submit would let a stage-2
   * approval land on a person who is no longer verified, which is precisely the hole this function
   * already closes for the tax verdict (`channel1_unverified`) and the frozen identity hash
   * (`identity_moved`). codex made user-visible sequencing conditional on exactly this discipline.
   */
  if (personBeforeBusinessEnforced() && !(await ownerPersonVerified(seller.ownerId))) {
    return { ok: false, error: 'person_unverified' }
  }
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
    if (outcome !== 'ok') return { ok: false, error: 'not_pending' }
    // Only here: the transaction committed, so the badge is live and the seller can be told.
    await notifyVerificationOutcome(row.sellerId, 'approved', null)
    return { ok: true }
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
  if (upd.count !== 1) return { ok: false, error: 'not_pending' }
  // The note is what the seller must act on, so it travels with the notification.
  const row = await db.sellerVerification.findUnique({ where: { id: caseId }, select: { sellerId: true } })
  if (row) await notifyVerificationOutcome(row.sellerId, 'rejected', note)
  return { ok: true }
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

/**
 * DECIDED CASES — the operator's history, searchable.
 *
 * Owner, 2026-08-17: "have verified businesses history with search in business verification page".
 * The queue only ever showed PENDING work, so once a case was decided it vanished: an operator
 * could not answer "did we already verify this company", "what did we tell them", or "who approved
 * this and when" without going to the database.
 *
 * ⚠️ THE SEARCH IS SERVER-SIDE AND INSENSITIVE, over the three things an operator actually has in
 * hand: the storefront name, the registered legal name, and the tax code. A client-side filter over
 * a `take`-limited page would search only what happened to be on screen — which looks identical
 * until the answer is on page 2, and then quietly says "no results" for a company you verified.
 *
 * ⚠️ THE RESULT IS STILL CAPPED, AND THE UI SAYS SO WHEN IT IS. Searching in the query means every
 * decided case is CONSIDERED; it does not mean every match is RETURNED. A reviewer rightly read an
 * earlier version of this comment as claiming both. There is no pagination yet — narrowing the
 * search is the way to reach older rows — and the page renders a warning line when the list is
 * full, so a truncated view cannot be mistaken for a complete one.
 *
 * ⚠️ IT LISTS approved AND rejected. A rejection is the half an operator most often needs to look
 * up ("what change did we ask for?"), and `note` carries it. Filtering to approvals only would hide
 * exactly the rows that generate follow-up questions.
 */
/** How many decided cases one page shows. Exported so the UI can SAY so when it truncates. */
export const HISTORY_LIMIT = 200

export async function listDecidedVerifications(q = '', limit = HISTORY_LIMIT) {
  const term = q.trim()
  // ⚠️ `mode: 'insensitive'` on the two free-text fields but NOT on the tax code: an MST is digits,
  // so a case-insensitive match buys nothing and only costs the index.
  const search = term
    ? {
        OR: [
          { seller: { name: { contains: term, mode: 'insensitive' as const } } },
          { seller: { legalName: { contains: term, mode: 'insensitive' as const } } },
          { seller: { taxCode: { contains: term } } },
        ],
      }
    : {}
  return db.sellerVerification.findMany({
    where: { status: { in: ['approved', 'rejected'] }, ...search },
    // Most recently decided first — the operator's question is nearly always about recent work.
    orderBy: { reviewedAt: 'desc' },
    take: limit,
    select: {
      id: true, sellerId: true, status: true, submittedAt: true, reviewedAt: true, reviewedBy: true,
      note: true,
      seller: { select: { name: true, legalName: true, taxCode: true } },
    },
  })
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

export type RetentionSweep = { swept: number; failed: number; malformed: number; skippedNonTerminal: number; remaining: number }

const TERMINAL = ['approved', 'rejected'] as const
/** A row that could not be swept is pushed back by this much — still queued, never lost, but no
 *  longer at the head of the line (see the liveness note below). ⚠️ 23h, not 24h: the timer runs
 *  every 24h, and a 24h push-back would land within milliseconds of the next run — whether it is
 *  due again tomorrow or the day after would be decided by systemd jitter. ⚠️ This turns the legal
 *  deadline column into the retry clock for a failed row: an audit of "past retention and still
 *  holding documents" will not see such a row, only the journal does. Accepted for liveness; a
 *  separate attempts column would be the clean answer and is a schema change. */
const RETRY_BACKOFF_MS = 23 * 60 * 60 * 1000
const BATCH = 200
const MAX_BATCHES = 5 // runaway stop: 1,000 cases in one run is a backlog to look at, not a sweep — and the route's budget

/**
 * Retention sweep — remove the bucket objects of decided cases past their window. Driven by
 * /api/cron/business-verification-retention (systemd timer on the box). Until 2026-09-05 nothing
 * called this at all, so `retentionUntil` was written on every decision and acted on never.
 *
 * ⛔ FAIL-CLOSED, LIKE THE VISA SWEEP. The row is cleared ONLY after strict object removal
 * succeeds; a storage failure leaves the row's paths in place and pushes it back, so the next run
 * finds it again. The row IS the durable queue.
 *
 * ⚠️ A NON-NULL `retentionUntil` MEANS "THIS CASE STILL HOLDS OBJECTS". A swept row gets
 * `retentionUntil: null` together with `documents: []`, which is what keeps it out of the next
 * query — the previous `documents: { not: '[]' }` filter compared the jsonb column against the
 * JSON STRING "[]" (measured: Prisma emits `"documents"::jsonb <> $2` with `$2 = '"[]"'`), so it
 * excluded nothing and every emptied row was "swept" again on every run.
 *
 * ⚠️ LIVENESS. Oldest-first with a cap, so anything that stays due and unswept sits at the head of
 * the line and, at BATCH such rows, starves everything behind it while the run still reports. Three
 * things are handled: non-terminal rows are excluded IN THE QUERY (a draft/pending case with an
 * early retentionUntil is a bug's footprint, counted as `skippedNonTerminal` and never stripped
 * mid-review); a row that fails is pushed back by RETRY_BACKOFF_MS; and the run DRAINS — up to
 * MAX_BATCHES batches, stopping early only when a batch moved nothing (a push-back IS progress:
 * the row left the head of the line). Whatever is still due after that is `remaining`, and the
 * route turns `remaining > 0` into a red run: a backlog beyond the budget needs a human, not a
 * green journal.
 *
 * ⚠️ REMOVAL PRECEDES THE STATUS-GUARDED CLEAR, and that order is deliberate (fail-closed: a row
 * is never cleared before its objects are gone). The window it leaves — a decided row turning
 * non-decided between the two calls — has no writer: every status transition in this module goes
 * draft → pending → approved | rejected and nothing writes a decided row back (a resubmission is a
 * new version row). A miss on the guard is therefore logged as drift (and the row pushed back so it cannot starve
 * the head of the line), not handled as a path.
 *
 * `documents` is `Json @default("[]")`, NOT NULL, and a decided row cannot gain documents (uploads
 * are status='draft' only; a resubmission is a NEW version row) — so the clear is guarded on the
 * status alone, and a row whose column is not a well-formed array is `malformed`: pushed back and
 * counted separately (never cleared with an object still in the bucket). The route turns ANY
 * retained document — a storage failure, a malformed record, a backlog, a drift row — into a red
 * run: PII held past its deadline behind a green journal is the worse outcome.
 */
export async function sweepVerificationRetention(now = new Date(), limit = BATCH): Promise<RetentionSweep> {
  let swept = 0
  let failed = 0
  let malformed = 0
  const retryAt = new Date(now.getTime() + RETRY_BACKOFF_MS)
  // ⚠️ LOUD if even the push-back fails: a row that stays due at the head of the line is the
  // starvation the push-back exists to prevent, so it is logged AND reported as a failure.
  const pushBack = async (id: string): Promise<boolean> => {
    try { await db.sellerVerification.update({ where: { id }, data: { retentionUntil: retryAt } }); return true }
    catch (err) { logError(err, { op: 'business-verification.retention.pushback' }); return false }
  }
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const due = await db.sellerVerification.findMany({
      where: { retentionUntil: { not: null, lt: now }, status: { in: [...TERMINAL] } },
      orderBy: { retentionUntil: 'asc' },
      take: limit,
      select: { id: true, status: true, documents: true },
    })
    if (!due.length) break
    let batchMoved = 0
    for (const row of due) {
      const docs = parseVerificationDocs(row.documents)
      if (!Array.isArray(row.documents) || docs.length !== row.documents.length) {
        malformed++
        logError(new Error(`malformed documents column on ${row.id}`), { op: 'business-verification.retention.malformed' })
        if (await pushBack(row.id)) batchMoved++
        else failed++ // still at the head of the line — that IS a failure of the sweep
        continue
      }
      try {
        await removeVerificationDocs(docs.map((d) => d.path))
      } catch (e) {
        failed++
        console.error('[business-verification] retention: objects NOT removed, row pushed back for retry', row.id, e instanceof Error ? e.message : e)
        if (await pushBack(row.id)) batchMoved++
        continue
      }
      // The objects are gone. Clear the pointers — guarded on the status only: a decided row
      // cannot gain documents, and a retention date that moved meanwhile does not bring an
      // object back. A miss here means the status left the terminal set under us, which the
      // transition map does not allow; it is logged and counted as the drift it is.
      // ⚠️ A DATABASE ERROR HERE MUST NOT ABORT THE RUN: the objects are already gone, the row still
      // points at them, and the rest of the batch still has work. Counted, pushed back, continued —
      // the row is re-read tomorrow, finds nothing to remove (absent is fine) and clears then.
      let cleared: { count: number }
      try {
        cleared = await db.sellerVerification.updateMany({
          where: { id: row.id, status: { in: [...TERMINAL] } },
          data: { documents: [], retentionUntil: null },
        })
      } catch (err) {
        failed++
        logError(err, { op: 'business-verification.retention.clear' })
        if (await pushBack(row.id)) batchMoved++
        continue
      }
      if (cleared.count !== 1) {
        failed++
        console.error('[business-verification] retention: row left the decided set under the sweep, pointers not cleared', row.id)
        if (await pushBack(row.id)) batchMoved++
        continue
      }
      swept++
      batchMoved++
    }
    // Per-batch progress, not cumulative: a batch that moved nothing (no sweep, no push-back) would
    // only re-read the same heads — stop; the response says what remains.
    if (due.length < limit || batchMoved === 0) break
  }
  const [remaining, skippedNonTerminal] = await Promise.all([
    db.sellerVerification.count({ where: { retentionUntil: { not: null, lt: now }, status: { in: [...TERMINAL] } } }),
    db.sellerVerification.count({ where: { retentionUntil: { not: null, lt: now }, status: { notIn: [...TERMINAL] } } }),
  ])
  return { swept, failed, malformed, skippedNonTerminal, remaining }
}

export type { VerificationDocKind }
