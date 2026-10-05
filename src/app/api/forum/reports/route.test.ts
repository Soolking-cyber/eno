import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/forum/reports — App Store gate `ugc-safety` (plan R5).
 *
 * ForumReport has NO reader: nothing in the app lists it, so a report filed there reaches no human. Gate
 * ON: a help-centre report becomes the same content case POST /api/report files (moderation queue, the
 * reporter's /disputes, takedown on Confirm), and ForumReport is not written. Gate OFF: unchanged.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  filed: [] as Row[],
  forumReports: [] as Row[],
  outcome: { outcome: 'created', id: 'case-1' } as Row,
  strikes: 0,
}))

vi.mock('@/lib/forum/cors', () => ({
  isAllowedForumOrigin: () => true,
  forumPreflight: () => new Response(null, { status: 204 }),
  forumJson: (_req: Request, body: unknown, init?: ResponseInit) => Response.json(body, init),
}))
vi.mock('@/lib/forum/auth', () => ({
  getForumAuth: async () => ({ profile: { id: 'reporter-1', reportCooldownUntil: null, falseReportStrikes: h.strikes }, user: null }),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/reported-content', () => ({
  fileContentReport: async (reporter: Row, target: Row, reason: string, detail: string | null) => { h.filed.push({ reporter, target, reason, detail }); return h.outcome },
}))
vi.mock('@/lib/db', () => ({
  db: {
    forumPost: { findUnique: async () => ({ id: 'cmpost000000001', authorProfileId: 'poster-1' }) },
    forumComment: { findUnique: async () => ({ id: 'cmcomment000001', authorProfileId: 'commenter-1', postId: 'cmpost000000001' }) },
    forumReport: {
      findFirst: async () => null,
      create: async ({ data }: Row) => { h.forumReports.push(data); return { id: 'forum-report-1' } },
    },
  },
}))

const { POST } = await import('./route')

async function report(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/forum/reports', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.filed = []; h.forumReports = []; h.outcome = { outcome: 'created', id: 'case-1' }; h.strikes = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('gate OFF', () => {
  it('writes a ForumReport exactly as before and files nothing in the moderation queue', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await report({ commentId: 'cmcomment000001', reason: 'harassment' })).toEqual({ status: 201, body: { reportId: 'forum-report-1', duplicate: false } })
    expect(h.forumReports).toHaveLength(1)
    expect(h.filed).toEqual([])
  })
})

describe('gate ON', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'))

  it('files a content case with the reason mapped onto the queue\'s vocabulary — and no ForumReport', async () => {
    expect(await report({ commentId: 'cmcomment000001', reason: 'hate', detail: 'slur' })).toEqual({ status: 201, body: { reportId: 'case-1', duplicate: false } })
    expect(await report({ postId: 'cmpost000000001', reason: 'misinformation' })).toEqual({ status: 201, body: { reportId: 'case-1', duplicate: false } })
    expect(await report({ postId: 'cmpost000000001', reason: 'spam' })).toEqual({ status: 201, body: { reportId: 'case-1', duplicate: false } })
    expect(h.filed.map((f) => [f.target, f.reason, f.detail])).toEqual([
      [{ kind: 'help-comment', id: 'cmcomment000001' }, 'offensive', 'slur'],
      // Content cases take only scam / offensive / other, whichever door they came in by.
      [{ kind: 'help-post', id: 'cmpost000000001' }, 'other', null],
      // Spam is not a scam: 'scam' would rank it 'severe' in the queue.
      [{ kind: 'help-post', id: 'cmpost000000001' }, 'other', null],
    ])
    expect(h.forumReports).toEqual([])
  })

  it('keeps this route\'s answer shapes for a duplicate and a silent accept', async () => {
    h.outcome = { outcome: 'duplicate', id: 'case-9' }
    expect(await report({ commentId: 'cmcomment000001', reason: 'spam' })).toEqual({ status: 200, body: { reportId: 'case-9', duplicate: true } })
    h.outcome = { outcome: 'suppressed' }
    expect(await report({ commentId: 'cmcomment000001', reason: 'spam' })).toEqual({ status: 200, body: { reportId: null, duplicate: false } })
  })

  it('a body naming BOTH a post and a reply is refused rather than guessed', async () => {
    expect(await report({ postId: 'cmpost000000001', commentId: 'cmcomment000001', reason: 'spam' })).toEqual({ status: 400, body: { error: 'invalid_report' } })
    expect(h.filed).toEqual([])
  })

  it('a reporter past the false-report ladder is refused, as on POST /api/report', async () => {
    h.strikes = 3
    expect(await report({ commentId: 'cmcomment000001', reason: 'spam' })).toEqual({ status: 403, body: { error: 'reporting_blocked' } })
    expect(h.filed).toEqual([])
  })
})
