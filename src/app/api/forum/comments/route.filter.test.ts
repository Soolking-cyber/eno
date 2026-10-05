import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Help-centre replies and member posts — the severe-only word filter (App Store gate `ugc-safety`,
 * plan R5): POST /api/forum/comments, POST /api/forum/posts and PATCH /api/forum/posts/[id] (an edit
 * must not be the way around it). Off: unchanged. On: 400 objectionable_content, nothing written.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ writes: [] as string[] }))

vi.mock('@/lib/forum/cors', () => ({
  isAllowedForumOrigin: () => true,
  forumPreflight: () => new Response(null, { status: 204 }),
  forumJson: (_req: Request, body: unknown, init?: ResponseInit) => Response.json(body, init),
}))
vi.mock('@/lib/forum/auth', () => ({
  getForumAuth: async () => ({ profile: { id: 'member-1', displayName: 'Mai', enforcementState: 'good_standing' }, user: null }),
  canParticipate: () => true,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/db', () => {
  const tx: Row = {
    forumComment: { create: async () => { h.writes.push('comment'); return { id: 'cmcomment000001' } }, update: async () => ({}) },
    forumPost: { update: async () => ({}), create: async () => { h.writes.push('post'); return { id: 'cmpost000000002' } } },
    forumProfile: { upsert: async () => ({}) },
    forumPostSubscription: { upsert: async () => ({}) },
    forumCommunityMember: { createMany: async () => ({ count: 0 }) },
    forumCommunity: { update: async () => ({}) },
    notification: { create: async () => ({}) },
  }
  return {
    db: {
      ...tx,
      forumPost: {
        ...tx.forumPost,
        findFirst: async () => ({ id: 'cmpost000000001', title: 'Where to buy a SIM?', authorProfileId: 'poster-1' }),
        findUnique: async () => ({ authorProfileId: 'member-1', title: 'Old title here', body: 'old body that is long enough', status: 'published' }),
        update: async () => { h.writes.push('post-edit'); return {} },
        findUniqueOrThrow: async () => ({ id: 'cmpost000000002' }),
      },
      forumComment: { ...tx.forumComment, findFirst: async () => null, findUniqueOrThrow: async () => ({ id: 'cmcomment000001' }) },
      forumCommunity: { findUnique: async () => ({ slug: 'help-buying', status: 'active' }) },
      forumPostRevision: { create: async () => ({}) },
      $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: Row) => unknown)(tx) : Promise.all(arg as unknown[])),
    },
  }
})
vi.mock('@/lib/forum/serialize', () => ({ forumAuthorSelect: {}, serializeForumComment: (c: Row) => c, serializeForumPost: (p: Row) => p }))

const comments = await import('./route')
const posts = await import('../posts/route')
const postById = await import('../posts/[id]/route')

const req = (path: string, method: string, body: Row) => new Request(`https://www.eno.forum${path}`, { method, body: JSON.stringify(body) })

beforeEach(() => { h.writes = [] })
afterEach(() => vi.unstubAllEnvs())

describe('help-centre replies', () => {
  it('gate OFF: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await comments.POST(req('/api/forum/comments', 'POST', { postId: 'cmpost000000001', body: 'ching chong' }))).status).toBe(201)
    expect(h.writes).toEqual(['comment'])
  })

  it('gate ON: refused before anything is written; a clean reply posts', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const res = await comments.POST(req('/api/forum/comments', 'POST', { postId: 'cmpost000000001', body: 'tìm gái gọi cao cấp không' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'objectionable_content' })
    expect(h.writes).toEqual([])
    expect((await comments.POST(req('/api/forum/comments', 'POST', { postId: 'cmpost000000001', body: 'Viettel works well in D1.' }))).status).toBe(201)
  })
})

describe('member help posts — create and edit', () => {
  const post = { community: 'help-buying', kind: 'question', title: 'Is this shop legit at all?', body: 'They said: I will kill you if you leave a bad review.', location: 'all', media: [] }

  it('gate ON: a new post with a severe term is refused, and so is an EDIT that adds one', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const created = await posts.POST(req('/api/forum/posts', 'POST', post))
    expect(created.status).toBe(400)
    expect(await created.json()).toEqual({ error: 'objectionable_content' })
    const edited = await postById.PATCH(req('/api/forum/posts/cmpost000000001', 'PATCH', { title: 'Updated title ok', body: 'now with: tao giết mày, nhớ đấy.' }), { params: Promise.resolve({ id: 'cmpost000000001' }) })
    expect(edited.status).toBe(400)
    expect(h.writes).toEqual([])
  })

  it('gate OFF: the same edit goes through as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const edited = await postById.PATCH(req('/api/forum/posts/cmpost000000001', 'PATCH', { title: 'Updated title ok', body: 'now with: tao giết mày, nhớ đấy.' }), { params: Promise.resolve({ id: 'cmpost000000001' }) })
    expect(edited.status).toBe(200)
    expect(h.writes).toEqual(['post-edit'])
  })
})
