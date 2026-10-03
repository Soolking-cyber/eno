import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRAWLER_UAS, PERSON_UAS } from '@/lib/__fixtures__/user-agents'

/**
 * GET /api/forum/posts/[id] — A CRAWLER READS THE POST AND DOES NOT MOVE `viewCount` (2026-10-03).
 *
 * This is a plain GET that bumps a counter, so anything that finds the URL counts as a reader — and
 * viewCount orders the Help Centre's popular answers (help-center-data.ts). A crawler still gets the
 * full 200 with the post; only the increment is skipped. A person still counts.
 */

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({ updates: [] as Row[] }))

vi.mock('@/lib/db', () => ({
  db: {
    forumPost: {
      findFirst: async () => ({ id: 'P1', authorProfileId: null, comments: [] }),
      update: async (args: Row) => { h.updates.push(args); return {} },
    },
    forumUserBlock: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/forum/auth', () => ({ getForumAuth: async () => null, canParticipate: () => false }))
vi.mock('@/lib/help-center', () => ({ withheldHelpTopicSlugs: () => [] }))
vi.mock('@/lib/forum/serialize', () => ({
  forumAuthorSelect: {},
  serializeForumPost: (p: Row) => ({ id: p.id }),
  serializeForumComment: (c: Row) => c,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')

async function read(ua: string | null) {
  const headers: Record<string, string> = {}
  if (ua !== null) headers['user-agent'] = ua
  const res = await GET(new Request('https://eno.vn/api/forum/posts/P1', { headers }), { params: Promise.resolve({ id: 'P1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.updates = [] })

describe('a crawler gets the post and is not counted', () => {
  for (const [name, ua] of Object.entries(CRAWLER_UAS)) {
    it(name, async () => {
      expect(await read(ua)).toEqual({ status: 200, body: { post: { id: 'P1' }, comments: [] } })
      expect(h.updates).toEqual([])
    })
  }
})

describe('a person is counted', () => {
  for (const [name, ua] of Object.entries(PERSON_UAS)) {
    it(name, async () => {
      expect((await read(ua)).status).toBe(200)
      expect(h.updates).toEqual([{ where: { id: 'P1' }, data: { viewCount: { increment: 1 } } }])
    })
  }
})
