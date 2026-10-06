import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/forum/comments across a block (App Store gate `ugc-safety`, plan R3). The reply itself still
 * posts — public Help Center content, and Report covers it — but whoever is on the other side of a block,
 * either direction, gets no forum_reply bell carrying its first 180 characters. Off: unchanged, and no
 * block is looked up.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  blocks: [] as (readonly [string, string])[], // [blocker, blocked]
  lookups: 0,
  bells: [] as Row[],
  comments: 0,
  parent: null as Row | null,
}))

vi.mock('@/lib/admin', () => ({ isAdminEmail: () => false }))
vi.mock('@/lib/forum/cors', () => ({
  isAllowedForumOrigin: () => true,
  forumPreflight: () => new Response(null, { status: 204 }),
  forumJson: (_req: Request, body: unknown, init?: ResponseInit) => Response.json(body, init),
}))
vi.mock('@/lib/forum/auth', () => ({
  getForumAuth: async () => ({ profile: { id: 'replier-1', displayName: 'Mai', enforcementState: 'good_standing' }, user: null }),
  canParticipate: () => true,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: {} }))
vi.mock('@/lib/forum/serialize', () => ({ forumAuthorSelect: {}, serializeForumComment: (c: Row) => c }))
vi.mock('@/lib/db', () => {
  const tx: Row = {
    forumComment: { create: async () => { h.comments++; return { id: 'cmcomment000001' } }, update: async () => ({}) },
    forumPost: { update: async () => ({}) },
    forumProfile: { upsert: async () => ({}) },
    forumPostSubscription: { upsert: async () => ({}) },
    notification: { create: async ({ data }: Row) => { h.bells.push(data); return {} } },
  }
  return {
    db: {
      forumPost: { findFirst: async () => ({ id: 'cmpost000000001', title: 'Where to buy a SIM?', authorProfileId: 'poster-1' }) },
      forumComment: { findFirst: async () => h.parent, findUniqueOrThrow: async () => ({ id: 'cmcomment000001' }) },
      // Answers the way the table would: a row only when one of the asked pairs is a stored block.
      forumUserBlock: {
        findFirst: async ({ where }: Row) => {
          h.lookups++
          const hit = h.blocks.find(([blocker, blocked]) => where.OR.some((w: Row) => w.blockerProfileId === blocker && w.blockedProfileId === blocked))
          return hit ? { blockerProfileId: hit[0] } : null
        },
      },
      profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
      $transaction: async (fn: (t: Row) => unknown) => fn(tx),
    },
  }
})

const { POST } = await import('./route')

async function reply(parentId?: string) {
  const res = await POST(new Request('https://www.eno.forum/api/forum/comments', { method: 'POST', body: JSON.stringify({ postId: 'cmpost000000001', parentId, body: 'Viettel works well in D1.' }) }))
  return res.status
}

beforeEach(() => { h.blocks = []; h.lookups = 0; h.bells = []; h.comments = 0; h.parent = null })
afterEach(() => vi.unstubAllEnvs())

describe('the help-centre reply bell across a block', () => {
  it('gate OFF: a stored block changes nothing and is never looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocks = [['poster-1', 'replier-1']]
    expect(await reply()).toBe(201)
    expect(h.lookups).toBe(0)
    expect(h.bells).toEqual([expect.objectContaining({ recipientId: 'poster-1', type: 'forum_reply' })])
  })

  it('gate ON, no block: the post author gets the bell as before, for one lookup', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await reply()).toBe(201)
    expect(h.lookups).toBe(1)
    expect(h.bells).toEqual([expect.objectContaining({ recipientId: 'poster-1', type: 'forum_reply', body: 'Viettel works well in D1.' })])
  })

  it('gate ON, blocked (either way): the reply posts, the post author gets no bell', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    for (const block of [['poster-1', 'replier-1'], ['replier-1', 'poster-1']] as const) {
      h.blocks = [block]
      h.bells = []
      h.comments = 0
      expect(await reply()).toBe(201)
      expect(h.comments).toBe(1)
      expect(h.bells).toEqual([])
    }
  })

  it('gate ON, a reply to a COMMENT: the block that counts is the comment author\'s', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.parent = { id: 'cmcomment000000', authorProfileId: 'commenter-1' }
    // The post author's block is not the recipient's: the comment author is still told.
    h.blocks = [['poster-1', 'replier-1']]
    expect(await reply('cmcomment000000')).toBe(201)
    expect(h.bells).toEqual([expect.objectContaining({ recipientId: 'commenter-1', title: 'New reply to your comment' })])

    h.blocks = [['commenter-1', 'replier-1']]
    h.bells = []
    expect(await reply('cmcomment000000')).toBe(201)
    expect(h.comments).toBe(2)
    expect(h.bells).toEqual([])
  })
})
