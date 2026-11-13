// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ written: [] as unknown[], listingIds: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logWarn: () => {} }))
vi.mock('@/lib/mt-job', async (orig) => {
  const real = await orig<typeof import('@/lib/mt-job')>()
  return {
    ...real,
    mtTodo: async () => ({ sources: [{ hash: 'h', text: 't', targets: ['ko'], listings: 1 }], pairs: 1, live: 1 }),
    mtWrite: async (rows: unknown[]) => { h.written.push(...rows); return { written: rows.length, rejected: [], listingIds: h.listingIds } },
  }
})

import { POST } from './route'
import { resetMtJobCacheForTests } from '@/lib/mt-job'
import { GET } from '../todo/route'

const TOKEN = 't'.repeat(40)
const post = (body: unknown, auth = `Bearer ${TOKEN}`) =>
  new Request('https://eno.vn/api/mt/rows', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  h.written = []
  h.listingIds = []
  vi.stubEnv('MT_JOB_TOKEN', TOKEN)
  resetMtJobCacheForTests()
})

describe('/api/mt', () => {
  it('is 404 while MT_JOB_TOKEN is unset or short, and 401 with a wrong token: nothing is read or written', async () => {
    expect((await POST(post({ rows: [{}] }, 'Bearer nope'))).status).toBe(401)
    expect((await GET(new Request('https://eno.vn/api/mt/todo'))).status).toBe(401)
    vi.stubEnv('MT_JOB_TOKEN', 'short')
    expect((await POST(post({ rows: [{}] }))).status).toBe(404)
    expect((await GET(new Request('https://eno.vn/api/mt/todo', { headers: { authorization: 'Bearer short' } }))).status).toBe(404)
    expect(h.written).toHaveLength(0)
  })
  it('GET answers the work, never cached', async () => {
    const r = await GET(new Request('https://eno.vn/api/mt/todo', { headers: { authorization: `Bearer ${TOKEN}` } }))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect((await r.json()).pairs).toBe(1)
  })
  it('refuses a body that is not {rows: [...]} or has more than 200 rows', async () => {
    expect((await POST(post({ rows: 'x' }))).status).toBe(400)
    expect((await POST(post({ rows: Array.from({ length: 201 }, () => ({})) }))).status).toBe(400)
    expect((await POST(new Request('https://eno.vn/api/mt/rows', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'not json' }))).status).toBe(400)
    expect(h.written).toHaveLength(0)
  })
  it('refuses a body past 1 MB before parsing it', async () => {
    expect((await POST(post({ rows: [{ value: 'x'.repeat(1025 * 1024) }] }))).status).toBe(413)
  })
  it('answers what was written and refused', async () => {
    const r = await POST(post({ rows: [{ hash: 'h', target: 'ko', value: 'v' }] }))
    expect(await r.json()).toEqual({ written: 1, rejected: [] })
  })
})
