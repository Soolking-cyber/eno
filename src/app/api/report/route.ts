import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { severityForReason } from '@/lib/trust'
import { reporterStanding } from '@/lib/enforcement-machine'
import { rateLimit } from '@/lib/ratelimit'
import { DISPUTE_WINDOW_MS, notifyDispute, respondentProfileId } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REASONS = ['scam', 'counterfeit', 'sold', 'wrong-info', 'duplicate', 'offensive', 'other'] as const
type Reason = (typeof REASONS)[number]

// A report can target a listing and/or a storefront. Reports surface only in the
// /admin queue; an admin-confirmed report moves the target's trust score.
const MAX_OPEN_PER_LISTING = 50

// ⚠️ WS6 MIGRATION — AUTH PREAMBLE ONLY, AND `auth: 'profile'` IS THE CORRECT MODE HERE, not the
// cheaper `'userId'`. This route reads the Profile ROW: `falseReportStrikes` feeds the standing
// ladder and `reportCooldownUntil` gates the anti-abuse cooldown, both before anything else runs.
// Downgrading to `'userId'` would mean fetching that row by hand — the same DB read, minus the
// wrapper's lazy provisioning. Guest → 401 `auth_required`, unchanged.
//
// ⚠️ THE RATE LIMIT DELIBERATELY STAYS IN THE HANDLER. route() runs `rateLimit:` immediately after
// auth, but here the standing ladder (403 `reporting_blocked`) and the cooldown (429
// `report_cooldown`) come FIRST. Hoisting the limiter would turn a blocked reporter's 403 into a 429
// once they exhausted the bucket — a wire change, and a worse message (their block is permanent
// until appealed, not a cooldown). Same for `body:`, which route() would parse before both gates.
//
// ⚠️ SIX ERROR STRINGS HERE ARE NOT IN `src/lib/api/errors.ts` AND ARE LEFT ALONE: 'Invalid body',
// 'Invalid reason', 'Conversation not found', 'Listing not found', 'Seller not found', 'Missing
// target'. They contain SPACES, which is why the harvest regex in errors.ts (`[A-Za-z0-9_.-]+`)
// never saw them. They stay as literal NextResponse.json returns — route() passes a Response through
// untouched — because normalising them is a client-visible rename, not a migration.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: the `throw e` re-raise in the P2002 backstop (and any
// other unguarded DB error) used to reach Next's default 500 and now answers
// `{"error":"internal_error"}` 500. The P2002-with-a-winner branch is unaffected.
export const POST = route({ auth: 'profile' }, async ({ req, profile: reporter }) => {
  // Reporting requires an account so reports are ATTRIBUTABLE — that's what makes
  // the anti-abuse rules possible (trust-weighting, false-report penalty, cooldown).
  //
  // Repeat-false-reporter ladder (Phase 3, protects good sellers): 1 strike → the
  // existing cooldown below; ≥2 → reports still land but pre-screened (triaged last);
  // ≥3 → reporting is off for this account (calm client copy; appeal via Help).
  const standing = reporterStanding(reporter.falseReportStrikes)
  if (standing === 'blocked') {
    throw new ApiError('reporting_blocked', 403)
  }

  // Anti-abuse: a reporter with confirmed-false reports is temporarily blocked.
  if (reporter.reportCooldownUntil && reporter.reportCooldownUntil > new Date()) {
    throw new ApiError('report_cooldown', 429)
  }
  const rl = await rateLimit('report', reporter.id, 10, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('rate_limited', 429)

  let body: { listingId?: string; sellerId?: string; conversationId?: string; reason?: string; detail?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const reason = String(body.reason || '').trim() as Reason
  const detail = body.detail ? String(body.detail).trim().slice(0, 1000) : null
  // ⚠️ 'Invalid reason' is NOT an ApiErrorCode (space in the string) — kept verbatim, see the header.
  if (!REASONS.includes(reason)) return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })

  const conversationId = body.conversationId ? String(body.conversationId).trim() : null
  // ⚠️ `let`, NOT `const`, and the chat branch below OVERWRITES it. This is the value that
  // decides which listing gets `verified: false` when an admin confirms the report
  // (api/admin/moderate/route.ts), so a body-supplied id is an unpublish primitive aimed at
  // any listing the reporter names. The chat branch's own comment already promised to leave it
  // null; it simply never did, so the promise held only for callers who did not send the field.
  let listingId = body.listingId ? String(body.listingId).trim() : null
  let sellerId = body.sellerId ? String(body.sellerId).trim() : null
  let targetProfileId: string | null = null

  if (conversationId) {
    // Reported FROM a chat: the reporter must be a participant, and the target is
    // the OTHER party (a buyer reports the seller; a seller reports the buyer). We
    // deliberately leave listingId null — a harassment report shouldn't auto-unpublish
    // the listing on confirm; it's about the person/conversation. conversationId links
    // the thread so an admin can read the exchange before deciding.
    const convo = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerProfileId: true, sellerProfileId: true, sellerId: true },
    })
    if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    const iAmBuyer = convo.buyerProfileId === reporter.id
    const iAmSeller = convo.sellerProfileId === reporter.id
    // Never let someone report a thread they aren't part of.
    if (!iAmBuyer && !iAmSeller) throw new ApiError('not_participant', 403)
    // Server-derived from here on: whatever listingId the client sent is discarded. A chat report
    // is about the PERSON, so confirming it must not unpublish a listing — exactly what the
    // comment at the top of this branch says. Deduplication is unaffected: dupeWhere tests
    // conversationId first.
    listingId = null
    if (iAmBuyer) {
      sellerId = convo.sellerId
      targetProfileId = convo.sellerProfileId ?? null
    } else {
      targetProfileId = convo.buyerProfileId
      sellerId = null
    }
  } else if (listingId) {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, seller: { select: { ownerId: true } } },
    })
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    // Always derive the storefront from the listing — never trust a client-supplied
    // sellerId here, or a report about listing X could be attributed to seller Y.
    sellerId = listing.sellerId
    targetProfileId = listing.seller?.ownerId ?? null
    const openCount = await db.report.count({ where: { listingId, status: 'open' } })
    // Already heavily flagged — silently accept (don't reveal the cap).
    if (openCount >= MAX_OPEN_PER_LISTING) return { ok: true }
  } else if (sellerId) {
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true, ownerId: true } })
    if (!seller) return NextResponse.json({ error: 'Seller not found' }, { status: 404 })
    targetProfileId = seller.ownerId ?? null
  } else {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }

  // Can't report yourself.
  if (targetProfileId && targetProfileId === reporter.id) {
    throw new ApiError('cannot_report_self', 400)
  }

  // One open report per reporter per SURFACE — keyed on the exact thing reported
  // (this listing / this chat / this storefront/account). The old key was the seller
  // IDENTITY, which silently dropped a report about a DIFFERENT listing from the same
  // seller (it looked submitted but never landed). Per-surface fixes that.
  const dupeWhere = conversationId
    ? { conversationId }
    : listingId
      ? { listingId }
      : targetProfileId
        ? { targetProfileId }
        : { targetSellerId: sellerId }
  const dupe = await db.report.findFirst({
    where: { reporterProfileId: reporter.id, status: 'open', ...dupeWhere },
    select: { id: true },
  })
  // Duplicate → hand back the EXISTING case so the client can still route the
  // reporter into their open dispute room instead of silently swallowing the tap.
  if (dupe) return { ok: true, id: dupe.id }

  let created: { id: string; targetProfileId: string | null; targetSellerId: string | null }
  try {
    created = await db.report.create({
      data: {
        listingId,
        conversationId,
        reporterProfileId: reporter.id,
        targetProfileId,
        targetSellerId: sellerId,
        reason,
        detail,
        severity: severityForReason(reason),
        status: 'open',
        // Dispute center: every report opens a case with a 72h evidence window in
        // which BOTH sides can post statements/evidence in the case room (/disputes).
        evidenceUntil: new Date(Date.now() + DISPUTE_WINDOW_MS),
      },
      select: { id: true, targetProfileId: true, targetSellerId: true },
    })
  } catch (e) {
    // Unique-index backstop (unique-constraints.mjs §5): a double-tap raced past the
    // findFirst dedup above — hand back the winner's case, same as the dupe branch.
    if ((e as { code?: string })?.code === 'P2002') {
      const winner = await db.report.findFirst({
        where: { reporterProfileId: reporter.id, status: 'open', ...dupeWhere },
        select: { id: true },
      })
      if (winner) return { ok: true, id: winner.id }
    }
    throw e
  }

  // ≥2 strikes → pre-screen the report: it stays in the queue (never silently drop a
  // possibly-real scam report) but sorts LAST and is excluded from the buyer-waiting
  // SLA. Raw + guarded — preScreen lands with scripts/add-ban-evasion.mjs; before it
  // the report simply stays un-screened (fail-open toward the buyer, never a 500).
  if (standing === 'prescreen') {
    try {
      await db.$executeRaw`UPDATE "Report" SET "preScreen" = true WHERE "id" = ${created.id}`
    } catch { /* migration pending */ }
  }

  // Open the loop on both sides (new with the dispute center — filing used to be
  // silent): the reporter gets their case link, the respondent gets due-process
  // notice + the 72h window. Guest storefront → unreachable → ex parte, as today.
  await notifyDispute(reporter.id, created.id, 'opened_reporter')
  const respondent = await respondentProfileId(created)
  if (respondent && respondent !== reporter.id) await notifyDispute(respondent, created.id, 'opened_respondent')

  // 201 (not the wrapper's default 200) → an explicit Response, which route() returns untouched.
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
})
