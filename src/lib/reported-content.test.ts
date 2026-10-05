import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── src/lib/reported-content.ts — reports on a review, a help reply or a help post (ugc-safety, R5) ────
// The invariants pinned here are the ones that made this a CONTENT case rather than a case against a
// person: no target column is ever set (so eraseAccount can never hold the reporter's — or the author's —
// own deletion, and no partial unique index applies), dedupe and cooldown key on the CONTENT, and Confirm
// takes the content down idempotently.

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  reviews: [] as Row[],
  comments: [] as Row[],
  posts: [] as Row[],
  sellers: [] as Row[],
  reports: [] as Row[],
  messages: [] as Row[],
  notifications: [] as Row[],
  modActions: [] as Row[],
  locks: [] as string[],
  notifies: [] as unknown[][],
  recomputes: [] as string[],
  listings: [] as Row[],
  purges: [] as string[],
  // A case another moderator dismisses between closeSiblingCases' read and its write.
  raceDismiss: null as string | null,
  listingsThrow: false,
  seq: 0,
}))

const pick = (rows: Row[], id: string) => rows.find((r) => r.id === id) ?? null
const someSystem = (reportId: string, prefix: string) => h.messages.some((m) => m.reportId === reportId && m.senderRole === 'system' && String(m.body).startsWith(prefix))
function reportMatches(r: Row, where: Row): boolean {
  if (where.id?.not && r.id === where.id.not) return false
  if (where.id?.notIn && where.id.notIn.includes(r.id)) return false
  if (where.id?.in && !where.id.in.includes(r.id)) return false
  if (typeof where.id === 'string' && r.id !== where.id) return false
  if (where.reporterProfileId && r.reporterProfileId !== where.reporterProfileId) return false
  if (typeof where.status === 'string' && r.status !== where.status) return false
  if (where.status?.in && !where.status.in.includes(r.status)) return false
  const some = where.messages?.some
  if (some && !someSystem(r.id, some.body.startsWith)) return false
  return true
}

vi.mock('@/lib/db', () => {
  const db: Row = {
    review: {
      findUnique: async ({ where, select }: Row) => {
        const r = pick(h.reviews, where.id)
        if (!r) return null
        return select?.seller ? { ...r, seller: { name: pick(h.sellers, r.sellerId)?.name, ownerId: pick(h.sellers, r.sellerId)?.ownerId ?? null } } : r
      },
      findMany: async ({ where }: Row) => h.reviews.filter((r) => where.id.in.includes(r.id)),
      deleteMany: async ({ where }: Row) => { const before = h.reviews.length; h.reviews = h.reviews.filter((r) => r.id !== where.id); return { count: before - h.reviews.length } },
      aggregate: async ({ where }: Row) => {
        const rows = h.reviews.filter((r) => r.sellerId === where.sellerId)
        return { _avg: { rating: rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : null }, _count: { _all: rows.length } }
      },
    },
    seller: { update: async ({ where, data }: Row) => Object.assign(pick(h.sellers, where.id)!, data) },
    forumComment: {
      findUnique: async ({ where }: Row) => {
        const c = pick(h.comments, where.id)
        return c ? { ...c, author: c.author ?? null, post: { title: pick(h.posts, c.postId)?.title ?? '' } } : null
      },
      findMany: async ({ where }: Row) => h.comments.filter((c) => where.id.in.includes(c.id)),
      updateMany: async ({ where, data }: Row) => {
        const c = pick(h.comments, where.id)
        if (!c) return { count: 0 }
        if (where.status && c.status !== where.status) return { count: 0 }
        if (where.replyCount?.gt !== undefined && !(c.replyCount > where.replyCount.gt)) return { count: 0 }
        if (data.status) c.status = data.status
        if (data.replyCount?.decrement) c.replyCount -= data.replyCount.decrement
        return { count: 1 }
      },
    },
    forumPost: {
      findUnique: async ({ where }: Row) => { const p = pick(h.posts, where.id); return p ? { ...p, author: p.author ?? null } : null },
      findMany: async ({ where }: Row) => h.posts.filter((p) => where.id.in.includes(p.id)),
      updateMany: async ({ where, data }: Row) => {
        const p = pick(h.posts, where.id)
        if (!p) return { count: 0 }
        if (typeof where.status === 'string' && p.status !== where.status) return { count: 0 }
        if (where.status?.in && !where.status.in.includes(p.status)) return { count: 0 }
        if (where.commentCount?.gt !== undefined && !(p.commentCount > where.commentCount.gt)) return { count: 0 }
        if (data.status) p.status = data.status
        if (data.commentCount?.decrement) p.commentCount -= data.commentCount.decrement
        return { count: 1 }
      },
    },
    forumModerationAction: { create: async ({ data }: Row) => { h.modActions.push(data); return data } },
    listing: {
      findMany: async ({ where, take }: Row) => {
        if (h.listingsThrow) throw new Error('listing read failed')
        return h.listings.filter((l) => l.sellerId === where.sellerId).slice(0, take)
      },
    },
    report: {
      findFirst: async ({ where }: Row) => h.reports.find((r) => reportMatches(r, where)) ?? null,
      findMany: async ({ where }: Row) => h.reports.filter((r) => reportMatches(r, where)),
      updateMany: async ({ where, data }: Row) => {
        if (h.raceDismiss && where.id === h.raceDismiss) Object.assign(pick(h.reports, h.raceDismiss)!, { status: 'dismissed' })
        const rows = h.reports.filter((r) => reportMatches(r, where))
        for (const r of rows) Object.assign(r, data)
        return { count: rows.length }
      },
      create: async ({ data }: Row) => {
        const id = `case-${++h.seq}`
        const { messages, ...rest } = data
        h.reports.push({ id, createdAt: new Date(), resolvedAt: null, ...rest })
        h.messages.push({ reportId: id, createdAt: new Date(), ...messages.create })
        return { id }
      },
    },
    disputeMessage: {
      findMany: async ({ where }: Row) => h.messages.filter((m) => where.reportId.in.includes(m.reportId) && m.senderRole === where.senderRole && String(m.body).startsWith(where.body.startsWith)),
    },
    profile: { findUnique: async ({ where }: Row) => ({ locale: where.id === 'author-vi' ? 'vi' : 'en' }) },
    notification: { create: async ({ data }: Row) => { h.notifications.push(data); return data } },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { if (String(strings[0]).includes('pg_advisory_xact_lock')) h.locks.push(String(values[0])); return 1 },
  }
  db.$transaction = async (fn: (tx: Row) => unknown) => fn(db)
  return { db }
})
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/trust', () => ({ severityForReason: () => 'moderate', recomputeTrust: async (id: string) => { h.recomputes.push(id); return null } }))
vi.mock('@/lib/enforcement', () => ({ syncEnforcement: async () => {} }))
vi.mock('@/lib/dispute', () => ({ DISPUTE_WINDOW_MS: 72 * 3600 * 1000, notifyDispute: async (...a: unknown[]) => { h.notifies.push(a) } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (path: string, type?: string) => { h.purges.push(type ? `${path}|${type}` : path) } }))

const { fileContentReport, reportedContentFor, takeDownReportedContent } = await import('./reported-content')

const REVIEW = 'cmreview0000001'
const COMMENT = 'cmcomment000001'
const POST = 'cmpost000000001'
const reporter = { id: 'seller-owner', falseReportStrikes: 0 }

beforeEach(() => {
  h.sellers = [{ id: 'shop-1', name: 'Minh Tuấn Mobile', ownerId: 'seller-owner', rating: 3, reviewCount: 2 }]
  h.reviews = [
    { id: REVIEW, sellerId: 'shop-1', rating: 1, text: 'awful, you are a gook', author: 'Lan', authorProfileId: 'author-vi' },
    { id: 'cmreview0000002', sellerId: 'shop-1', rating: 5, text: 'great', author: 'Huy', authorProfileId: 'author-2' },
  ]
  h.posts = [
    { id: POST, status: 'published', official: false, title: 'Where to buy a SIM?', body: 'question', authorName: 'Mai', authorProfileId: 'poster-1', commentCount: 2 },
    { id: 'cmofficial00001', status: 'published', official: true, title: 'How eno works', body: 'answer', authorName: 'eno', authorProfileId: null, commentCount: 0 },
  ]
  h.comments = [{ id: COMMENT, postId: POST, parentId: 'cmparent0000001', status: 'published', body: 'i will kill you', authorName: 'Bob', authorProfileId: 'commenter-1', replyCount: 0 }, { id: 'cmparent0000001', postId: POST, parentId: null, status: 'published', body: 'hi', authorProfileId: 'x', replyCount: 1 }]
  h.reports = []; h.messages = []; h.notifications = []; h.modActions = []; h.locks = []; h.notifies = []; h.recomputes = []; h.seq = 0
  h.listings = [{ id: 'L1', sellerId: 'shop-1' }, { id: 'L2', sellerId: 'shop-1' }, { id: 'L9', sellerId: 'other-shop' }]; h.purges = []; h.raceDismiss = null; h.listingsThrow = false
})

describe('fileContentReport', () => {
  it('opens a CONTENT case: no target column, the content named by a system pointer row', async () => {
    const r = await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', 'slur in the text')
    expect(r).toEqual({ outcome: 'created', id: 'case-1' })
    const row = h.reports[0]
    // ⛔ Not the reviewed shop (the reporter owns it — eraseAccount would hold THEIR deletion), not the author.
    expect(row).toMatchObject({ reporterProfileId: 'seller-owner', reason: 'offensive', detail: 'slur in the text', status: 'open' })
    for (const col of ['listingId', 'conversationId', 'targetProfileId', 'targetSellerId']) expect(row[col] ?? null, col).toBeNull()
    expect(h.messages[0]).toMatchObject({ reportId: 'case-1', senderRole: 'system', senderProfileId: null })
    expect(h.messages[0].body).toBe(`[[reported review ${REVIEW}]] Review on “Minh Tuấn Mobile”, 1/5, by Lan: “awful, you are a gook”`)
    // Decided under a per-(reporter, content) lock — no unique index can cover an all-NULL-target row.
    expect(h.locks).toEqual([`report-content:seller-owner:[[reported review ${REVIEW}]]`])
    // The reporter's case link — and nobody else's: a content case has no respondent party.
    expect(h.notifies).toEqual([['seller-owner', 'case-1', 'opened_reporter']])
  })

  it('one OPEN case per reporter per content — a second tap returns it; another reporter gets their own', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    expect(await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'scam', null)).toEqual({ outcome: 'duplicate', id: 'case-1' })
    expect((await fileContentReport({ id: 'stranger', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'offensive', null)).outcome).toBe('created')
    // A DIFFERENT review by the same author is its own case (no folding into the first).
    expect((await fileContentReport(reporter, { kind: 'review', id: 'cmreview0000002' }, 'other', null)).outcome).toBe('created')
    expect(h.reports).toHaveLength(3)
  })

  it('a refile of the SAME content within 24h of a rejected report is accepted silently, nothing created', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    Object.assign(h.reports[0], { status: 'dismissed', resolvedAt: new Date() })
    expect(await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)).toEqual({ outcome: 'suppressed' })
    expect(h.reports).toHaveLength(1)
  })

  it('refuses your own content, and content that is gone, hidden or the eno team\'s own answer', async () => {
    expect(await fileContentReport({ id: 'author-vi', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'other', null)).toEqual({ outcome: 'cannot_report_self' })
    expect(await fileContentReport(reporter, { kind: 'review', id: 'cmnosuchreview1' }, 'other', null)).toEqual({ outcome: 'not_found' })
    h.comments[0].status = 'removed'
    expect(await fileContentReport(reporter, { kind: 'help-comment', id: COMMENT }, 'other', null)).toEqual({ outcome: 'not_found' })
    expect(await fileContentReport(reporter, { kind: 'help-post', id: 'cmofficial00001' }, 'other', null)).toEqual({ outcome: 'not_found' })
    expect(h.reports).toEqual([])
  })

  it('any shop\'s review is reportable, the eno desk\'s included (a party only ever sees the kind of content)', async () => {
    h.sellers.push({ id: 'desk-shop', name: 'eno e-Visa desk', ownerId: 'staff-1' })
    h.reviews.push({ id: 'cmdeskreview001', sellerId: 'desk-shop', rating: 1, text: 'slow', author: 'Huy', authorProfileId: 'author-2' })
    expect((await fileContentReport(reporter, { kind: 'review', id: 'cmdeskreview001' }, 'other', null)).outcome).toBe('created')
  })

  it('describes a help reply and a member post for the moderator', async () => {
    await fileContentReport(reporter, { kind: 'help-comment', id: COMMENT }, 'offensive', null)
    await fileContentReport(reporter, { kind: 'help-post', id: POST }, 'other', null)
    expect(h.messages[0].body).toBe(`[[reported help-comment ${COMMENT}]] Help-centre comment by Bob on “Where to buy a SIM?”: “i will kill you”`)
    expect(h.messages[1].body).toBe(`[[reported help-post ${POST}]] Help-centre post by Mai: “Where to buy a SIM?” — “question”`)
  })
})

describe('the admin side', () => {
  it('reportedContentFor resolves each case\'s content live — present, link, author', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport(reporter, { kind: 'help-comment', id: COMMENT }, 'offensive', null)
    h.comments[0].status = 'removed'
    const m = await reportedContentFor(['case-1', 'case-2', 'case-x'])
    expect(m.get('case-1')).toMatchObject({ kind: 'review', id: REVIEW, href: '/sellers/shop-1', present: true, authorProfileId: 'author-vi' })
    expect(m.get('case-1')!.description).toBe('Review on “Minh Tuấn Mobile”, 1/5, by Lan: “awful, you are a gook”')
    expect(m.get('case-2')).toMatchObject({ kind: 'help-comment', href: `/help/${POST}`, present: false })
    expect(m.has('case-x')).toBe(false)
  })

  it('a confirmed review is DELETED, the shop\'s numbers re-derived, its owner\'s trust recomputed, the author told — once', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn')).toEqual({ pointer: `review:${REVIEW}`, removed: true, decided: false })
    expect(h.reviews.map((r) => r.id)).toEqual(['cmreview0000002'])
    expect(h.sellers[0]).toMatchObject({ rating: 5, reviewCount: 1 })
    expect(h.recomputes).toEqual(['seller-owner'])
    // The removal is logged — and that row is what stops the same buyer re-posting on the same deal.
    expect(h.modActions).toEqual([expect.objectContaining({ targetProfileId: 'author-vi', action: 'remove', reason: 'review' })])
    expect(h.notifications).toEqual([expect.objectContaining({ recipientId: 'author-vi', type: 'system', title: 'Đánh giá của bạn đã bị gỡ' })])
    // The shop's listing pages render its top reviews (ISR, 30 days): each is purged, no other shop's.
    expect(h.purges).toEqual(['/listings/L1', '/listings/L2'])
    // Idempotent: a retry finds nothing to remove and tells nobody again.
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn')).toEqual({ pointer: `review:${REVIEW}`, removed: false, decided: false })
    expect(h.notifications).toHaveLength(1)
  })

  it('a confirmed help reply is REMOVED (row kept), the counters follow, and the action is recorded', async () => {
    await fileContentReport(reporter, { kind: 'help-comment', id: COMMENT }, 'offensive', null)
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn')).toEqual({ pointer: `help-comment:${COMMENT}`, removed: true, decided: false })
    expect(h.comments[0].status).toBe('removed')
    expect(h.posts[0].commentCount).toBe(1)
    expect(h.comments[1].replyCount).toBe(0)
    expect(h.modActions).toEqual([{ targetProfileId: 'commenter-1', commentId: COMMENT, action: 'remove', reason: 'report', note: 'report:case-1 by admin@eno.vn' }])
    expect(h.notifications[0]).toMatchObject({ recipientId: 'commenter-1', title: 'Your comment in the Help center was removed' })
    expect((await takeDownReportedContent('case-1', 'admin@eno.vn'))?.removed).toBe(false)
    expect(h.posts[0].commentCount).toBe(1)
  })

  it('a LOCKED member post is still public — reportable, and removed on Confirm', async () => {
    h.posts[0].status = 'locked'
    expect((await fileContentReport(reporter, { kind: 'help-post', id: POST }, 'offensive', null)).outcome).toBe('created')
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn')).toEqual({ pointer: `help-post:${POST}`, removed: true, decided: false })
    expect(h.posts[0].status).toBe('removed')
  })

  it('the listing pages are read INSIDE the removal: a failed read fails the takedown (the route then releases the case)', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    h.listingsThrow = true
    await expect(takeDownReportedContent('case-1', 'admin@eno.vn')).rejects.toThrow('listing read failed')
    // (A real transaction rolls the delete back; this fake has no rollback.) Nobody is told, nothing purged.
    expect(h.notifications).toEqual([])
    expect(h.purges).toEqual([])
  })

  it('a shop with more listings than the cap purges the whole listing-page route once', async () => {
    h.listings = Array.from({ length: 3001 }, (_, i) => ({ id: `L${i}`, sellerId: 'shop-1' }))
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    await takeDownReportedContent('case-1', 'admin@eno.vn')
    expect(h.purges).toEqual(['/listings/[id]|layout'])
  })

  it('a case without a pointer is not a content case', async () => {
    expect(await takeDownReportedContent('case-404', 'admin@eno.vn')).toBeNull()
  })
})

describe('closing the other cases on the same content', () => {
  it('a takedown closes every other OPEN case on that content as upheld and tells their reporters', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport({ id: 'stranger', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport({ id: 'stranger-2', falseReportStrikes: 0 }, { kind: 'review', id: 'cmreview0000002' }, 'other', null)
    h.notifies = []
    expect((await takeDownReportedContent('case-1', 'admin@eno.vn'))?.removed).toBe(true)
    expect(h.reports.find((r) => r.id === 'case-2')).toMatchObject({ status: 'confirmed', resolvedBy: 'admin@eno.vn' })
    // A case on a DIFFERENT review is untouched.
    expect(h.reports.find((r) => r.id === 'case-3')).toMatchObject({ status: 'open' })
    expect(h.notifies).toEqual([['stranger', 'case-2', 'decided_upheld_reporter']])
  })
})

describe('closing the other cases on the same content — retries, races, batches', () => {
  async function threeOnOneReview() {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport({ id: 'stranger', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport({ id: 'stranger-2', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'other', null)
    h.notifies = []
  }

  it('a retry whose content is already gone still closes the siblings (the first run may have failed there)', async () => {
    await threeOnOneReview()
    h.reviews = h.reviews.filter((r) => r.id !== REVIEW)
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn')).toEqual({ pointer: `review:${REVIEW}`, removed: false, decided: false })
    expect(h.reports.filter((r) => r.id !== 'case-1').map((r) => r.status)).toEqual(['confirmed', 'confirmed'])
    expect(h.notifies.map((n) => n[1])).toEqual(['case-2', 'case-3'])
  })

  it('a sibling another moderator dismissed meanwhile stays dismissed, and its reporter is NOT told "upheld"', async () => {
    await threeOnOneReview()
    h.raceDismiss = 'case-2'
    await takeDownReportedContent('case-1', 'admin@eno.vn')
    expect(h.reports.find((r) => r.id === 'case-2')!.status).toBe('dismissed')
    expect(h.notifies).toEqual([['stranger-2', 'case-3', 'decided_upheld_reporter']])
  })

  it('cases the caller decides itself (a bulk-confirm batch) are left open for it', async () => {
    await threeOnOneReview()
    await takeDownReportedContent('case-1', 'admin@eno.vn', { keepOpen: ['case-1', 'case-3'] })
    expect(h.reports.map((r) => [r.id, r.status])).toEqual([['case-1', 'open'], ['case-2', 'confirmed'], ['case-3', 'open']])
  })
})

describe('a Confirm DECIDES the case inside the removal (decide)', () => {
  const decide = (note: string | null = null) => ({ status: 'confirmed' as const, severity: 'severe', resolvedBy: 'admin@eno.vn', resolvedAt: new Date('2026-10-05T03:00:00Z'), decisionNote: note })

  it('the decision and the removal land together', async () => {
    await fileContentReport(reporter, { kind: 'help-comment', id: COMMENT }, 'offensive', null)
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn', { decide: decide('slur') })).toEqual({ pointer: `help-comment:${COMMENT}`, removed: true, decided: true })
    expect(h.reports[0]).toMatchObject({ status: 'confirmed', severity: 'severe', resolvedBy: 'admin@eno.vn', decisionNote: 'slur' })
    expect(h.comments[0].status).toBe('removed')
  })

  it('a case no longer open is left alone: nothing removed, nobody told, no siblings touched', async () => {
    await fileContentReport(reporter, { kind: 'review', id: REVIEW }, 'offensive', null)
    await fileContentReport({ id: 'stranger', falseReportStrikes: 0 }, { kind: 'review', id: REVIEW }, 'offensive', null)
    h.reports[0].status = 'dismissed'
    h.notifies = []
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn', { decide: decide() })).toEqual({ pointer: `review:${REVIEW}`, removed: false, decided: false })
    expect(h.reviews.map((r) => r.id)).toContain(REVIEW)
    expect(h.notifications).toEqual([])
    expect(h.reports[1].status).toBe('open')
    expect(h.notifies).toEqual([])
  })

  it('content already gone still gets its decision', async () => {
    await fileContentReport(reporter, { kind: 'help-post', id: POST }, 'offensive', null)
    h.posts = h.posts.filter((x) => x.id !== POST)
    expect(await takeDownReportedContent('case-1', 'admin@eno.vn', { decide: decide() })).toEqual({ pointer: `help-post:${POST}`, removed: false, decided: true })
    expect(h.reports[0].status).toBe('confirmed')
  })
})
