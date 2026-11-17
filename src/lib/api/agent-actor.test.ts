import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * route({ agent: true }) takes the caller from the in-process mark (agent-actor.ts), and nothing from the network can
 * set it. The session readers are mocked to "nobody signed in", so any 200 below came from the mark alone.
 */
const rl = vi.hoisted(() => ({ calls: [] as { bucket: string; key: string; strict: boolean }[] }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/db', () => ({ db: { profile: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'p-agent' ? { id: 'p-agent' } : null) } } }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (bucket: string, key: string, _l: number, _w: string, o?: { strict?: boolean }) => {
    rl.calls.push({ bucket, key, strict: !!o?.strict })
    return { success: true, limit: 1, remaining: 1, resetSec: 1 }
  },
}))

import { route } from './handler'
import { asAgent, agentOf } from './agent-actor'

const actor = { profileId: 'p-agent', keyId: 'k1' }
const mk = () => new Request('https://eno.vn/api/x', { method: 'GET' })

beforeEach(() => { rl.calls = []; vi.stubEnv('NODE_ENV', 'test') })

describe('route({ agent: true })', () => {
  it('takes userId from the mark, and hands the handler the agent', async () => {
    const r = route({ auth: 'userId', agent: true }, async ({ userId, agent }) => ({ userId, agent }))
    const res = await r(asAgent(mk(), actor))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'p-agent', agent: actor })
  })

  it("loads the profile row for auth: 'profile', and refuses an account that is gone", async () => {
    const r = route({ auth: 'profile', agent: true }, async ({ profile }) => ({ id: profile.id }))
    expect(await (await r(asAgent(mk(), actor))).json()).toEqual({ id: 'p-agent' })
    expect((await r(asAgent(mk(), { profileId: 'p-gone', keyId: 'k1' }))).status).toBe(401)
  })

  it('ignores the mark on a route that did not opt in (no session → 401)', async () => {
    const r = route({ auth: 'userId' }, async ({ userId }) => ({ userId }))
    expect((await r(asAgent(mk(), actor))).status).toBe(401)
  })

  it('cannot be claimed from the network: a header naming an agent is just a header', async () => {
    const r = route({ auth: 'userId', agent: true }, async ({ userId }) => ({ userId }))
    const req = new Request('https://eno.vn/api/x', { headers: { 'x-eno-agent': 'p-agent', authorization: 'Bearer eno_live_x' } })
    expect(agentOf(req)).toBeNull()
    expect((await r(req)).status).toBe(401)
  })

  it("spends the agent's own strict bucket, never the person's", async () => {
    const r = route({ auth: 'userId', agent: true, rateLimit: { bucket: 'msg:send', limit: 20, window: '1 m' } }, async () => ({}))
    await r(asAgent(mk(), actor))
    expect(rl.calls).toEqual([{ bucket: 'msg:send', key: 'agent:p-agent', strict: true }])
  })

  it('refuses an agent on a route whose auth is not a person', async () => {
    const r = route({ auth: 'public', agent: true }, async () => ({}))
    expect((await r(asAgent(mk(), actor))).status).toBe(403)
  })
})
