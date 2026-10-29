import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POST /api/feedback — the kinds it keeps: the Help sheet's, and a Report on an eno AI answer ─────────────

const h = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { feedback: { create: h.create } } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'profile-1', getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

import { POST } from './route'

const post = (body: object) => POST(new NextRequest('https://eno.vn/api/feedback', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'test-agent' },
  body: JSON.stringify(body),
}))

beforeEach(() => {
  h.create.mockReset()
  h.create.mockResolvedValue({})
})

describe('POST /api/feedback', () => {
  it("keeps a Report on an AI answer as its own kind ('ai'): the message and the page as sent", async () => {
    const message = 'AI answer reported in eno AI chat: wrong\n\nThe answer:\nTry District 7.'
    const res = await post({ kind: 'ai', message, url: 'https://eno.vn/messages/ai' })
    expect(res.status).toBe(201)
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ai', message, url: 'https://eno.vn/messages/ai', profileId: 'profile-1' }),
    })
  })

  it("still folds a kind it does not know into 'feedback'", async () => {
    await post({ kind: 'admin', message: 'hello there' })
    expect(h.create.mock.calls[0][0].data.kind).toBe('feedback')
  })
})
