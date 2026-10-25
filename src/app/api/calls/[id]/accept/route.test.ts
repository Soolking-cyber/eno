import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POST /api/calls/:id/accept — judged by the VOICE rules, with `videoAllowed` beside them ─────────────────────────────
// The video switch going off while a video-capable call rang must not end it at the answer (the heartbeat's rule too):
// the accept asks callPermit about a voice call and answers whether the cameras may be on.

const h = vi.hoisted(() => ({
  me: 'callee-1' as string | null,
  permitMedia: [] as string[],
  permit: { ok: true, calleeId: 'callee-1', teacherThread: false, config: { video: true } } as Record<string, unknown>,
  ended: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => (h.me ? { id: h.me } : null), getCurrentProfileId: async () => h.me, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<Record<string, unknown>>()), EDITION: 'marketplace' }))
vi.mock('@/lib/calls/server/eligibility', async (orig) => ({
  // The REAL rule for whether the cameras may be on — only the database-backed judgement is faked.
  videoAllowedBy: (await orig<typeof import('@/lib/calls/server/eligibility')>()).videoAllowedBy,
  loadConversationForCall: async () => ({ id: 'c1' }),
  callPermit: async (_c: unknown, _caller: string, media: string) => { h.permitMedia.push(media); return h.permit },
}))
vi.mock('@/lib/calls/server/relay', () => ({
  mintRelayCredential: async () => ({ provider: 'cloudflare', handle: 'ru-b' }),
  revokeRelayCredential: async () => {},
}))
vi.mock('@/lib/calls/server/session', () => ({
  acceptCall: async () => ({ ok: true }),
  endCall: async ({ reason }: { reason: string }) => { h.ended.push(reason); return null },
}))
vi.mock('@/lib/calls/server/finish', () => ({ afterCallEnded: async () => {} }))
vi.mock('@/lib/calls/server/cards', () => ({ ANSWERED_TEXT: 'Answered', replaceRingPush: async () => {} }))
vi.mock('@/lib/calls/server/http', async () => {
  const { z } = await import('zod')
  return {
    tabIdSchema: (await import('@/lib/calls/protocol')).tabIdSchema,
    boundedCapabilities: z.unknown().optional(),
    relayForClient: () => ({ provider: 'cloudflare', iceServers: [], iceTransportPolicy: 'relay', expiresAt: 0 }),
    participantCall: async () => ({
      row: { id: 'call-1', state: 'ringing', media: 'video', caller_id: 'caller-1', callee_id: 'callee-1', conversation_id: 'c1', protocol_version: 2, relay_provider: 'cloudflare' },
      role: 'callee',
    }),
  }
})

const { CALL_PROTOCOL_VERSION } = await import('@/lib/calls/types')
const { POST } = await import('./route')
const accept = () =>
  POST(new Request('https://eno.vn/api/calls/call-1/accept', { method: 'POST', body: JSON.stringify({ v: CALL_PROTOCOL_VERSION, tabId: 't-1' }) }), { params: Promise.resolve({ id: 'call-1' }) })

beforeEach(() => {
  h.me = 'callee-1'; h.permitMedia = []; h.ended = []
  h.permit = { ok: true, calleeId: 'callee-1', teacherThread: false, config: { video: true } }
})

describe('POST /api/calls/:id/accept', () => {
  it('a video-capable call is judged as voice, and answers that its cameras may be on', async () => {
    const r = await accept()
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ conversationId: 'c1', media: 'video', videoAllowed: true })
    expect(h.permitMedia).toEqual(['audio'])
  })

  it('⛔ video switched off while it rang: answered all the same, cameras paused', async () => {
    h.permit = { ...h.permit, config: { video: false } }
    const r = await accept()
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ videoAllowed: false })
    expect(h.ended).toEqual([])
  })

  it('a refusal by the voice rules (calls off, a block) still ends the ring', async () => {
    h.permit = { ok: false, error: 'blocked', status: 403 }
    const r = await accept()
    expect(r.status).toBe(403)
    expect(h.ended).toEqual(['blocked'])
  })
})
