import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * endByParticipant (http.ts) — the commit-gate fix: an end decided while the row read 'ringing' applies only FROM
 * ringing; if an accept landed in between, the call is ended as an ANSWERED call, with the bound-tab check.
 */
const h = vi.hoisted(() => ({
  ends: [] as Array<{ reason: string; fromStates?: readonly string[] }>,
  ringingEndWins: true,
  reloaded: null as Record<string, unknown> | null,
  afters: [] as Array<() => unknown>,
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('./session', () => ({
  endCall: async (i: { reason: string; fromStates?: readonly string[] }) => {
    h.ends.push({ reason: i.reason, fromStates: i.fromStates })
    if (i.fromStates?.includes('ringing') && !h.ringingEndWins) return null
    return { id: 'call-1', state: 'x', connected_secs: null }
  },
  loadCall: async () => h.reloaded,
  roleOf: () => 'callee',
}))
vi.mock('./finish', () => ({ afterCallEnded: async () => {} }))

const { endByParticipant, readJsonCapped } = await import('./http')
const row = (o: Record<string, unknown> = {}) => ({ id: 'call-1', state: 'ringing', caller_tab: 'tab-a', callee_tab: null, ...o }) as never

beforeEach(() => { h.ends = []; h.ringingEndWins = true; h.reloaded = null; h.afters = [] })

describe('endByParticipant', () => {
  it('while ringing: the caller cancels, the callee declines from any tab — only FROM ringing', async () => {
    expect(await endByParticipant(row(), 'caller', 'p', 'tab-a', 'hangup')).not.toBeNull()
    expect(h.ends).toEqual([{ reason: 'cancelled', fromStates: ['ringing'] }])
    h.ends = []
    expect(await endByParticipant(row(), 'callee', 'p', 'any-tab', 'hangup')).not.toBeNull()
    expect(h.ends).toEqual([{ reason: 'declined', fromStates: ['ringing'] }])
  })

  it('⛔ answered in between: re-read, and end it as an answered call — with the bound-tab check', async () => {
    h.ringingEndWins = false
    h.reloaded = { id: 'call-1', state: 'accepted', caller_tab: 'tab-a', callee_tab: 'tab-b' }
    await expect(endByParticipant(row(), 'callee', 'p', 'other-tab', 'hangup')).rejects.toMatchObject({ code: 'wrong_tab' })
    h.ends = []
    expect(await endByParticipant(row(), 'callee', 'p', 'tab-b', 'hangup')).not.toBeNull()
    expect(h.ends).toEqual([{ reason: 'declined', fromStates: ['ringing'] }, { reason: 'hangup', fromStates: ['accepted', 'ready', 'connected'] }])
  })

  it('an answered call keeps only what a peer may say of its own end', async () => {
    const answered = row({ state: 'connected', callee_tab: 'tab-b' })
    await endByParticipant(answered, 'callee', 'p', 'tab-b', 'declined')
    await endByParticipant(answered, 'callee', 'p', 'tab-b', 'blocked')
    await endByParticipant(answered, 'callee', 'p', 'tab-b', 'sas_mismatch')
    expect(h.ends.map((e) => e.reason)).toEqual(['hangup', 'hangup', 'sas_mismatch'])
  })

  it('the caller from a tab the box did not bind is refused; an ended call is a no-op', async () => {
    await expect(endByParticipant(row(), 'caller', 'p', 'tab-x', 'hangup')).rejects.toMatchObject({ code: 'wrong_tab' })
    expect(await endByParticipant(row({ state: 'ended' }), 'caller', 'p', 'tab-a', 'hangup')).toBeNull()
  })
})

describe('readJsonCapped — a body is read only up to its cap (round-6 review)', () => {
  /** A chunked body (no content-length) that counts how many chunks were PULLED. */
  const chunked = (chunks: string[]) => {
    let pulled = 0
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (pulled >= chunks.length) return ctrl.close()
        ctrl.enqueue(enc.encode(chunks[pulled++]))
      },
    })
    return { req: new Request('http://x/', { method: 'POST', body, duplex: 'half' } as RequestInit), pulled: () => pulled }
  }
  const status = async (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500)

  it('parses a body within the cap', async () => {
    expect(await readJsonCapped(new Request('http://x/', { method: 'POST', body: '{"a":1}' }), 100)).toEqual({ a: 1 })
  })

  it('a declared length over the cap is refused before a byte is read', async () => {
    const r = new Request('http://x/', { method: 'POST', body: '{}', headers: { 'content-length': '9999' } })
    expect(await status(readJsonCapped(r, 100))).toBe(400)
  })

  it('⛔ an UNDECLARED body stops at the cap — the rest is never pulled', async () => {
    const c = chunked(Array.from({ length: 1000 }, () => 'x'.repeat(100)))
    expect(await status(readJsonCapped(c.req, 100))).toBe(400)
    expect(c.pulled()).toBeLessThan(10)
  })

  it('malformed JSON, and text over the cap after decoding, are 400', async () => {
    expect(await status(readJsonCapped(new Request('http://x/', { method: 'POST', body: '{nope' }), 100))).toBe(400)
    expect(await status(readJsonCapped(chunked(['"' + 'é'.repeat(40) + '"']).req, 30))).toBe(400)
  })
})
