import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { pickLocale } from '@/lib/admin-macros'
import { severityForReason, recomputeTrust } from '@/lib/trust'
import { syncEnforcement } from '@/lib/enforcement'
import { DISPUTE_WINDOW_MS, notifyDispute } from '@/lib/dispute'
import { reporterStanding } from '@/lib/enforcement-machine'
import { REFILE_COOLDOWN_STATUSES, refileSuppressed } from '@/lib/report-refile'
import { contentToken, parseContentPointer, type ContentKind } from '@/lib/reported-content-pointer'
import { revalidatePublicPath } from '@/lib/revalidate-lang'

/**
 * REPORTS ON A SELLER REVIEW, A HELP-CENTRE COMMENT OR A HELP-CENTRE POST — App Store Guideline 1.2,
 * plan R5, filed only while the `ugc-safety` review gate is on (POST /api/report with reviewId |
 * commentId | postId; POST /api/forum/reports). They land in the SAME pipeline as every other report:
 * a `Report` row, the reporter's case in /disputes, the /admin/moderation Reports tab, the dispute room.
 *
 * ⛔ A CONTENT REPORT TARGETS THE CONTENT, NEVER A PERSON OR A SHOP. targetProfileId, targetSellerId,
 * listingId and conversationId all stay NULL, and the content is named by the case's system pointer
 * row (src/lib/reported-content-pointer.ts). Each of the four would do harm here:
 *   · targetSellerId = the reviewed shop — the usual reporter of a review IS that shop's owner, and an
 *     OPEN report against their storefront makes eraseAccount refuse THEIR OWN deletion ('under_review',
 *     src/lib/core/account-erasure.ts) and lets Confirm dock their shop for a stranger's words;
 *   · targetProfileId = the author — a reviewed seller could then freeze every critical reviewer's
 *     account deletion and push a dispute notice at them with one tap (opus, plan review); and the
 *     partial unique index Report_open_profile_unique allows ONE open case per (reporter, person), so a
 *     second report about the same author's other comment would have to be folded into the first case
 *     — losing its reason and its own decision (opus + agy, plan review);
 *   · listingId would make Confirm unpublish a listing; conversationId would hand a third-party reporter
 *     a thread id and collide with chat-report dedupe.
 * So the remedy is the CONTENT's: Confirm takes it down (takeDownReportedContent) and tells its author.
 * An account-level case against the author stays what it always was — a deliberate report on their
 * storefront or chat, with due process and the deletion hold.
 *
 * DEDUPE: one OPEN case per (reporter, content), decided under a per-(reporter, content) advisory lock —
 * no partial unique index can cover a row with every target NULL, so the lock is the race guard (the
 * src/lib/dispute.ts addPartyStatementOnce idiom). A refile of the SAME content within 24h of a rejected
 * report is accepted silently, exactly like every other surface (src/lib/report-refile.ts).
 */

const CLIP = 600
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP)}…` : s)

/** The post statuses the public can read (api/forum/posts/[id] serves both). */
const POST_PUBLIC: readonly string[] = ['published', 'locked']

/** Who wrote it (for the self-report check) and the pointer row's body — null when it is gone or not reportable. */
export async function describeReportedContent(kind: ContentKind, id: string): Promise<{ authorProfileId: string | null; pointerBody: string } | null> {
  const token = contentToken(kind, id)
  if (kind === 'review') {
    const r = await db.review.findUnique({ where: { id }, select: { rating: true, text: true, author: true, authorProfileId: true, seller: { select: { name: true } } } })
    if (!r) return null
    // (Any shop's review is reportable, the eno desk's included: a PARTY never sees this text — only its kind
    // — so a desk review's wording cannot reach the licensed marketplace through the case room.)
    // A review is at most 600 characters (api/sellers/[id]/reviews), so the WHOLE text is kept here: a
    // confirmed review is deleted (Review has no status column), and this row is then its only record.
    return { authorProfileId: r.authorProfileId, pointerBody: `${token} Review on “${r.seller.name}”, ${r.rating}/5, by ${r.author}: “${clip(r.text)}”` }
  }
  if (kind === 'help-comment') {
    const c = await db.forumComment.findUnique({
      where: { id },
      select: { status: true, body: true, authorName: true, authorProfileId: true, author: { select: { displayName: true } }, post: { select: { title: true } } },
    })
    if (!c || c.status !== 'published') return null
    const by = c.author?.displayName || c.authorName || 'a member'
    return { authorProfileId: c.authorProfileId, pointerBody: `${token} Help-centre comment by ${by} on “${clip(c.post.title)}”: “${clip(c.body)}”` }
  }
  const p = await db.forumPost.findUnique({
    where: { id },
    select: { status: true, official: true, title: true, body: true, authorName: true, authorProfileId: true, author: { select: { displayName: true } } },
  })
  // The eno team's own answers are not reportable content — they are edited, not moderated. A LOCKED post
  // is still public (it only takes no new replies), so it is reportable and removable like a published one.
  if (!p || !POST_PUBLIC.includes(p.status) || p.official) return null
  const by = p.author?.displayName || p.authorName || 'a member'
  return { authorProfileId: p.authorProfileId, pointerBody: `${token} Help-centre post by ${by}: “${clip(p.title)}” — “${clip(p.body)}”` }
}

export type ContentReportResult =
  | { outcome: 'created'; id: string }
  | { outcome: 'duplicate'; id: string }
  | { outcome: 'suppressed' }
  | { outcome: 'not_found' }
  | { outcome: 'cannot_report_self' }

/**
 * File a content report. The caller has already authenticated the reporter and run the standing ladder
 * and the cooldown gates (both routes do that first); `falseReportStrikes` is passed for the pre-screen.
 */
export async function fileContentReport(
  reporter: { id: string; falseReportStrikes: number },
  target: { kind: ContentKind; id: string },
  reason: string,
  detail: string | null,
): Promise<ContentReportResult> {
  const described = await describeReportedContent(target.kind, target.id)
  if (!described) return { outcome: 'not_found' }
  if (described.authorProfileId && described.authorProfileId === reporter.id) return { outcome: 'cannot_report_self' }

  const token = contentToken(target.kind, target.id)
  const aboutThis = { messages: { some: { senderRole: 'system', body: { startsWith: token } } } }
  const result = await db.$transaction(async (tx): Promise<ContentReportResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-content:${reporter.id}:${token}`}))`
    const open = await tx.report.findFirst({ where: { reporterProfileId: reporter.id, status: 'open', ...aboutThis }, select: { id: true } })
    if (open) return { outcome: 'duplicate', id: open.id }
    const closed = await tx.report.findMany({
      where: { reporterProfileId: reporter.id, status: { in: [...REFILE_COOLDOWN_STATUSES] }, ...aboutThis },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { resolvedAt: true, createdAt: true },
    })
    if (refileSuppressed(closed)) return { outcome: 'suppressed' }
    const created = await tx.report.create({
      data: {
        reporterProfileId: reporter.id,
        reason,
        detail,
        severity: severityForReason(reason),
        status: 'open',
        evidenceUntil: new Date(Date.now() + DISPUTE_WINDOW_MS),
        messages: { create: { senderProfileId: null, senderRole: 'system', body: described.pointerBody } },
      },
      select: { id: true },
    })
    return { outcome: 'created', id: created.id }
  })
  if (result.outcome !== 'created') return result

  // Same pre-screen as every report (route.ts): a ≥2-strike reporter's case sorts last. Raw + guarded.
  if (reporterStanding(reporter.falseReportStrikes) === 'prescreen') {
    try {
      await db.$executeRaw`UPDATE "Report" SET "preScreen" = true WHERE "id" = ${result.id}`
    } catch { /* migration pending */ }
  }
  // The reporter's case link — and nobody else: a content case has no respondent party.
  await notifyDispute(reporter.id, result.id, 'opened_reporter')
  return result
}

// ── The admin side ──────────────────────────────────────────────────────────────────────────────────

export type ReportedContent = {
  kind: ContentKind
  id: string
  /** The pointer row's readable half (the token stripped) — what was reported, as it read then. */
  description: string
  /** Where it lives now; null once it is gone. */
  href: string | null
  /** Still published (a review still exists)? */
  present: boolean
  /** Its author, for the moderator's link to /admin/users/<id>. Never sent to a non-admin. */
  authorProfileId: string | null
}

/** The FIRST pointer row of each report that has one. One query. */
async function pointersFor(reportIds: string[]): Promise<Map<string, { kind: ContentKind; id: string; body: string }>> {
  const out = new Map<string, { kind: ContentKind; id: string; body: string }>()
  if (!reportIds.length) return out
  const rows = await db.disputeMessage.findMany({
    where: { reportId: { in: reportIds }, senderRole: 'system', body: { startsWith: '[[reported ' } },
    orderBy: { createdAt: 'asc' },
    select: { reportId: true, body: true },
  })
  for (const r of rows) {
    if (out.has(r.reportId)) continue
    const p = parseContentPointer(r.body)
    if (p) out.set(r.reportId, { ...p, body: r.body })
  }
  return out
}

/** For the moderation inbox: each content case's content, resolved live. Batched — four queries at most. */
export async function reportedContentFor(reportIds: string[]): Promise<Map<string, ReportedContent>> {
  const pointers = await pointersFor(reportIds)
  const out = new Map<string, ReportedContent>()
  if (!pointers.size) return out
  const ids = (k: ContentKind) => [...new Set([...pointers.values()].filter((p) => p.kind === k).map((p) => p.id))]
  const [reviewIds, commentIds, postIds] = [ids('review'), ids('help-comment'), ids('help-post')]
  type ReviewRow = { id: string; sellerId: string; authorProfileId: string | null }
  type CommentRow = { id: string; postId: string; status: string; authorProfileId: string | null }
  type PostRow = { id: string; status: string; authorProfileId: string | null }
  const [reviews, comments, posts] = await Promise.all([
    reviewIds.length ? db.review.findMany({ where: { id: { in: reviewIds } }, select: { id: true, sellerId: true, authorProfileId: true } }) : Promise.resolve([] as ReviewRow[]),
    commentIds.length ? db.forumComment.findMany({ where: { id: { in: commentIds } }, select: { id: true, postId: true, status: true, authorProfileId: true } }) : Promise.resolve([] as CommentRow[]),
    postIds.length ? db.forumPost.findMany({ where: { id: { in: postIds } }, select: { id: true, status: true, authorProfileId: true } }) : Promise.resolve([] as PostRow[]),
  ])
  const review = new Map<string, ReviewRow>(reviews.map((r) => [r.id, r]))
  const comment = new Map<string, CommentRow>(comments.map((c) => [c.id, c]))
  const post = new Map<string, PostRow>(posts.map((p) => [p.id, p]))
  for (const [reportId, p] of pointers) {
    const description = p.body.replace(/^\[\[reported [^\]]+\]\]\s?/, '')
    if (p.kind === 'review') {
      const r = review.get(p.id)
      out.set(reportId, { kind: p.kind, id: p.id, description, href: r ? `/sellers/${r.sellerId}` : null, present: !!r, authorProfileId: r?.authorProfileId ?? null })
    } else if (p.kind === 'help-comment') {
      const c = comment.get(p.id)
      out.set(reportId, { kind: p.kind, id: p.id, description, href: c ? `/help/${c.postId}` : null, present: c?.status === 'published', authorProfileId: c?.authorProfileId ?? null })
    } else {
      const q = post.get(p.id)
      out.set(reportId, { kind: p.kind, id: p.id, description, href: q ? `/help/${q.id}` : null, present: !!q && POST_PUBLIC.includes(q.status), authorProfileId: q?.authorProfileId ?? null })
    }
  }
  return out
}

/** Bilingual, by the author's Profile.locale — the APPEAL_NOTICE shape (src/lib/admin-macros.ts). */
const REMOVED_NOTICE: Record<ContentKind, { title: { en: string; vi: string } }> = {
  review: { title: { en: 'Your review was removed', vi: 'Đánh giá của bạn đã bị gỡ' } },
  'help-comment': { title: { en: 'Your comment in the Help center was removed', vi: 'Bình luận của bạn trong Trung tâm trợ giúp đã bị gỡ' } },
  'help-post': { title: { en: 'Your post in the Help center was removed', vi: 'Bài viết của bạn trong Trung tâm trợ giúp đã bị gỡ' } },
}
const REMOVED_BODY = {
  en: 'It was reported, and a moderator found that it breaks our community rules. If you think this is a mistake, contact us through Help.',
  vi: 'Nội dung này bị báo cáo và người kiểm duyệt xác định nó vi phạm quy tắc cộng đồng. Nếu bạn cho rằng có nhầm lẫn, hãy liên hệ chúng tôi qua mục Trợ giúp.',
}

async function noticeAuthor(authorProfileId: string | null, kind: ContentKind): Promise<void> {
  if (!authorProfileId) return
  try {
    const p = await db.profile.findUnique({ where: { id: authorProfileId }, select: { locale: true } })
    const l = pickLocale(p?.locale)
    await db.notification.create({
      data: { recipientId: authorProfileId, type: 'system', title: REMOVED_NOTICE[kind].title[l], body: REMOVED_BODY[l], actorName: 'eno moderation', url: '/help' },
    })
  } catch (e) {
    logError(e, { op: 'reported-content.notice' })
  }
}

/**
 * The note a REVIEW removal leaves in the moderation-action log — `ForumModerationAction` is the app's
 * one moderation log (`action: 'remove'`, `reason: 'review'`), and this row is also what stops the same
 * buyer re-posting a review on the same deal (api/sellers/[id]/reviews; codex + opus, gate round 1).
 * Admin-only data: never shown to a user, so the conversation id in it reaches no third party.
 */
export const reviewRemovalNote = (reviewId: string, conversationId: string | null, reportId: string, admin: string) =>
  `review:${reviewId} conversation:${conversationId ?? '-'} report:${reportId} by ${admin}`
export const removedReviewConversationNeedle = (conversationId: string) => `conversation:${conversationId} `

/**
 * The decision a Confirm writes on a content case (moderate/route.ts) — passed in so it commits in the SAME
 * transaction as the removal: both land or neither does.
 */
export type ContentDecision = { status: 'confirmed'; severity: string; resolvedBy: string; resolvedAt: Date; decisionNote?: string | null }

/**
 * Take a content case's content down. With `decide` (a Confirm of an OPEN case) the case's open → confirmed
 * flip runs INSIDE the removal's transaction: the decision and the removal commit together or not at all
 * (codex + opus, gate rounds 4-6 — a takedown before the decision raced a concurrent dismissal; a claim
 * released on failure could itself fail and strand a "confirmed" case over content still up). A case that
 * is no longer open is left alone: nothing is removed and `decided` is false. Content already gone still
 * gets its decision. Without `decide` (a repeat Confirm of a confirmed case) it is the plain, idempotent
 * takedown.
 *   · review → DELETED (Review has no status column) with the shop's re-derived rating/reviewCount and the
 *     moderation-log row (codex, gate round 1). The full text survives in the pointer row. After the
 *     commit: the shop's listing pages are purged (they render its top reviews), and the owner's trust (Q
 *     reads Review rows) is recomputed — best-effort; the nightly runTrustMaintenance re-derives every shop
 *     owner's trust anyway (trust.ts).
 *   · help comment / help post → status 'removed' (the row stays) with the post's counters and the
 *     ForumModerationAction row. /help and /help/[id] are force-dynamic: nothing to purge.
 * Only a run that removed something tells the author. A run that ends with the content down closes the other
 * open cases on it (best-effort; they stay in the queue, shown as removed, if it fails). `keepOpen`: case ids
 * the caller decides itself (bulk-confirm's own batch).
 * Returns null when the case has no pointer; throws when a write fails (then nothing was committed).
 */
export async function takeDownReportedContent(
  reportId: string,
  admin: string,
  opts: { onHeld?: (n: number) => void; keepOpen?: readonly string[]; decide?: ContentDecision } = {},
): Promise<{ pointer: string; removed: boolean; decided: boolean } | null> {
  const p = (await pointersFor([reportId])).get(reportId)
  if (!p) return null
  const pointer = `${p.kind}:${p.id}`
  const out = await removeContent(reportId, p, admin, opts)
  // Asked to decide and could not: someone else decided the case meanwhile — leave everything to them.
  if (opts.decide && !out.decided) return { pointer, removed: false, decided: false }
  await closeSiblingCases(reportId, p, admin, opts.keepOpen ?? [])
  return { pointer, ...out }
}

type Tx = Prisma.TransactionClient

/** The decision, inside the removal's transaction. No `decide` → nothing to write, and the caller may go on. */
async function claim(tx: Tx, reportId: string, decide: ContentDecision | undefined): Promise<boolean> {
  if (!decide) return true
  const { count } = await tx.report.updateMany({ where: { id: reportId, status: 'open' }, data: decide })
  return count === 1
}

async function removeContent(
  reportId: string,
  p: { kind: ContentKind; id: string },
  admin: string,
  opts: { onHeld?: (n: number) => void; decide?: ContentDecision },
): Promise<{ removed: boolean; decided: boolean }> {
  const decide = opts.decide
  // The content is already gone: the case is still decided (alone), and there is nothing to remove.
  const decideAlone = async () => ({ removed: false, decided: !!decide && (await db.$transaction((tx) => claim(tx, reportId, decide))) })
  if (p.kind === 'review') {
    const r = await db.review.findUnique({ where: { id: p.id }, select: { sellerId: true, authorProfileId: true, conversationId: true, seller: { select: { ownerId: true } } } })
    if (!r) return decideAlone()
    const out = await db.$transaction(async (tx) => {
      if (!(await claim(tx, reportId, decide))) return { decided: false, pages: null }
      const { count } = await tx.review.deleteMany({ where: { id: p.id } })
      if (!count) return { decided: !!decide, pages: null }
      const agg = await tx.review.aggregate({ where: { sellerId: r.sellerId }, _avg: { rating: true }, _count: { _all: true } })
      // No review left → the schema default a never-reviewed shop carries (Seller.rating @default(5); the
      // storefront shows no rating at reviewCount 0).
      await tx.seller.update({ where: { id: r.sellerId }, data: { rating: agg._avg.rating ?? 5, reviewCount: agg._count._all } })
      // The log row needs a target (its CHECK); a review with no author account has nobody to record.
      if (r.authorProfileId) {
        await tx.forumModerationAction.create({ data: { targetProfileId: r.authorProfileId, action: 'remove', reason: 'review', note: reviewRemovalNote(p.id, r.conversationId, reportId, admin) } })
      }
      // The listing pages to purge once this commits — read INSIDE the removal, so a failed read fails it:
      // once the review is gone a retry could no longer find the shop to purge (codex, gate round 4).
      // edition-lint-allow: ids only, for ISR tombstones, which both editions read (cache-handler.cjs: tags
      // are edition-agnostic and can only REMOVE cached pages) — so it must see EVERY edition's pages of the
      // shop, not this edition's scope (opus, round 6); no listing field is returned, rendered or sent.
      const pages = await tx.listing.findMany({ where: { sellerId: r.sellerId }, select: { id: true }, take: PDP_PURGE_CAP + 1 })
      return { decided: !!decide, pages }
    })
    if (!out.pages) return { removed: false, decided: out.decided }
    purgeListingPages(out.pages.map((row) => row.id), reportId)
    if (r.seller.ownerId) {
      try {
        const res = await recomputeTrust(r.seller.ownerId)
        if (res) await syncEnforcement(r.seller.ownerId, res.breakdown, { persistedScore: res.score, onHeld: opts.onHeld })
      } catch (e) {
        logError(e, { op: 'reported-content.reviewTrust', reportId })
      }
    }
    await noticeAuthor(r.authorProfileId, p.kind)
    return { removed: true, decided: out.decided }
  }
  if (p.kind === 'help-comment') {
    const c = await db.forumComment.findUnique({ where: { id: p.id }, select: { postId: true, parentId: true, authorProfileId: true } })
    if (!c) return decideAlone()
    const out = await db.$transaction(async (tx) => {
      if (!(await claim(tx, reportId, decide))) return { decided: false, removed: false }
      const { count } = await tx.forumComment.updateMany({ where: { id: p.id, status: 'published' }, data: { status: 'removed' } })
      if (!count) return { decided: !!decide, removed: false }
      await tx.forumPost.updateMany({ where: { id: c.postId, commentCount: { gt: 0 } }, data: { commentCount: { decrement: 1 } } })
      if (c.parentId) await tx.forumComment.updateMany({ where: { id: c.parentId, replyCount: { gt: 0 } }, data: { replyCount: { decrement: 1 } } })
      await tx.forumModerationAction.create({ data: { targetProfileId: c.authorProfileId, commentId: p.id, action: 'remove', reason: 'report', note: `report:${reportId} by ${admin}` } })
      return { decided: !!decide, removed: true }
    })
    if (out.removed) await noticeAuthor(c.authorProfileId, p.kind)
    return out
  }
  const q = await db.forumPost.findUnique({ where: { id: p.id }, select: { authorProfileId: true } })
  if (!q) return decideAlone()
  const out = await db.$transaction(async (tx) => {
    if (!(await claim(tx, reportId, decide))) return { decided: false, removed: false }
    const { count } = await tx.forumPost.updateMany({ where: { id: p.id, status: { in: [...POST_PUBLIC] } }, data: { status: 'removed' } })
    if (!count) return { decided: !!decide, removed: false }
    await tx.forumModerationAction.create({ data: { targetProfileId: q.authorProfileId, postId: p.id, action: 'remove', reason: 'report', note: `report:${reportId} by ${admin}` } })
    return { decided: !!decide, removed: true }
  })
  if (out.removed) await noticeAuthor(q.authorProfileId, p.kind)
  return out
}

/** Above this many listings, purge the whole listing-page route once — listing-surfaces.ts REVALIDATE_CAP. */
const PDP_PURGE_CAP = 3000

/**
 * A removed REVIEW leaves the listing pages too (opus, gate round 2): each of the shop's listing pages is
 * ISR with a 30-day window and renders the shop's top reviews (listings/[id]/(pdp)/page.tsx,
 * topSellerReviews), so without a purge the deleted text could show there for a month. The storefront
 * and the Help Centre are force-dynamic. The ids were read inside the removal; this only writes the
 * tombstones — shared by both editions' processes (cache-handler.cjs), so a Confirm on either site purges
 * both — path by path (`continue`, not `break`), as refreshListingSurfaces does, but no search reindex:
 * review text is not indexed.
 */
function purgeListingPages(ids: string[], reportId: string): void {
  let logged = false
  const purge = (path: string, type?: 'layout') => {
    try { if (type) revalidatePublicPath(path, type); else revalidatePublicPath(path) } catch (e) {
      if (!logged) { logged = true; logError(e, { op: 'reported-content.purge', reportId, path }) }
    }
  }
  // 'layout': the PDP sits in a route group, so only a layout pattern purge matches every page of it.
  if (ids.length > PDP_PURGE_CAP) purge('/listings/[id]', 'layout')
  else for (const id of ids) purge(`/listings/${id}`)
}

/** One page of sibling cases per round; enough rounds for any pile-on this queue will see. */
const SIBLING_PAGE = 200
const SIBLING_ROUNDS = 10

/**
 * The other OPEN cases on the same content close with it, as upheld (opus, gate round 1): three people
 * report one review, a moderator confirms one and the review is gone — the other two must not sit open
 * over nothing, nor be dismissed (which reads as "not a violation" to people who were right). Each case
 * flips on its OWN open→confirmed guard and only a case that flipped tells its reporter, so one another
 * moderator dismissed meanwhile stays dismissed and its reporter is not told "upheld" (codex, round 2).
 * Paged until none is left. Best-effort: the content is down, and the next Confirm of any case on it
 * runs this again.
 */
async function closeSiblingCases(reportId: string, p: { kind: ContentKind; id: string }, admin: string, keepOpen: readonly string[]): Promise<void> {
  try {
    const notIn = [reportId, ...keepOpen]
    const where = { status: 'open', id: { notIn }, messages: { some: { senderRole: 'system', body: { startsWith: contentToken(p.kind, p.id) } } } }
    for (let round = 0; round < SIBLING_ROUNDS; round++) {
      const siblings = await db.report.findMany({ where, select: { id: true, reporterProfileId: true }, orderBy: { createdAt: 'asc' }, take: SIBLING_PAGE })
      if (!siblings.length) return
      for (const sib of siblings) {
        const { count } = await db.report.updateMany({ where: { id: sib.id, status: 'open' }, data: { status: 'confirmed', resolvedBy: admin, resolvedAt: new Date() } })
        if (count && sib.reporterProfileId) await notifyDispute(sib.reporterProfileId, sib.id, 'decided_upheld_reporter')
      }
      if (siblings.length < SIBLING_PAGE) return
    }
  } catch (e) {
    logError(e, { op: 'reported-content.closeSiblings', reportId })
  }
}
