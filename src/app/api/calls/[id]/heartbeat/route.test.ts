import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POST /api/calls/:id/heartbeat — the video switch PAUSES cameras, it never ends a call ──────────────────────────────
// Since protocol v2 nearly every verified call is placed video-capable, so ending a 'video' row when the switch goes off
// ended nearly every call. The beat now judges the voice rules (liveCallRefusal) and answers `videoAllowed` beside them;
// the kill switch, a block and a suspension still end the call exactly as before.

const h = vi.hoisted(() => ({
  me: 'callee-1' as string | null,
  row: null as Record<string, unknown> | null,
  refusal: null as null | 'blocked' | 'kill_switch',
  videoAllowed: true as boolean | undefined,
  ended: [] as string[],
  afters: [] as Array<() => unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => (h.me ? { id: h.me } : null), getCurrentProfileId: async () => h.me, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/edition', () => ({ EDITION: 'marketplace' }))
vi.mock('@/lib/calls/server/eligibility', () => ({
  liveCallRefusal: async () => h.refusal,
  liveVideoAllowed: async () => h.videoAllowed,
}))
vi.mock('@/lib/calls/server/session', () => ({
  heartbeat: async () => h.row,
  endCall: async ({ reason }: { reason: string }) => { h.ended.push(reason); return { ...h.row } },
  sweepStale: async () => [],
  callClock: async () => ({ capRemainingMs: 7_000_000 }),
}))
vi.mock('@/lib/calls/server/finish', () => ({ afterCallEnded: async () => {} }))
vi.mock('@/lib/calls/server/telemetry-store', () => ({ storeTelemetry: async () => true }))
vi.mock('@/lib/calls/server/http', async () => ({
  tabIdSchema: (await import('@/lib/calls/protocol')).tabIdSchema,
  participantCall: async () => ({ row: h.row, role: 'callee' }),
}))

const { CALL_PROTOCOL_VERSION } = await import('@/lib/calls/types')
const { POST } = await import('./route')
const beat = () =>
  POST(new Request('https://eno.vn/api/calls/call-1/heartbeat', { method: 'POST', body: JSON.stringify({ tabId: 't-1', connected: true }) }), { params: Promise.resolve({ id: 'call-1' }) })

beforeEach(() => {
  h.me = 'callee-1'; h.refusal = null; h.videoAllowed = true; h.ended = []; h.afters = []
  h.row = { id: 'call-1', state: 'connected', media: 'video', caller_id: 'caller-1', callee_id: 'callee-1', protocol_version: CALL_PROTOCOL_VERSION }
})

describe('POST /api/calls/:id/heartbeat', () => {
  it('a live video-capable call says its cameras may be on', async () => {
    const r = await beat()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ state: 'connected', capInMs: 7_000_000, videoAllowed: true })
  })

  it('⛔ video switched off: the call goes on (200), its cameras paused — nothing is ended', async () => {
    h.videoAllowed = false
    const r = await beat()
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ state: 'connected', videoAllowed: false })
    expect(h.ended).toEqual([])
  })

  it('an unreadable switch leaves `videoAllowed` out — the phone keeps video as it was', async () => {
    h.videoAllowed = undefined
    const body = await (await beat()).json()
    expect(body).toEqual({ state: 'connected', capInMs: 7_000_000 })
  })

  it('⛔ the kill switch and a block still END the call, as before', async () => {
    for (const refusal of ['kill_switch', 'blocked'] as const) {
      h.refusal = refusal
      const r = await beat()
      expect(r.status).toBe(409)
      expect(await r.json()).toMatchObject({ error: 'call_gone' })
    }
    expect(h.ended).toEqual(['kill_switch', 'blocked'])
  })
})
