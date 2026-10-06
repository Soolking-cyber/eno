import { beforeEach, describe, expect, it, vi } from 'vitest'

// App Store gate `app-ai-notice`, family `document_check` (2026-10-06): "Not now" to the Google AI check. The photo is
// already stored; this route must record it as saved-but-unchecked (`unavailable`, which never blocks a send), call
// no model and charge no limiter — and never downgrade a document that already passed.

type Row = Record<string, any>
const APP = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({
  state: {
    userId: 'user-1' as string | null,
    document: { id: 'doc-1', storage_path: 'u/a/passport.jpg', kind: 'passport', validation_report: {}, validation_status: 'pending' } as Row,
    updates: [] as Row[],
    downgradeBlocked: false,
    /** What a read AFTER the update returns (undefined = the same document as before). */
    afterUpdate: undefined as Row | null | undefined,
    events: [] as Row[],
  },
  rateLimit: vi.fn(async () => ({ success: true })),
  getGemini: vi.fn(() => null),
}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.state.userId }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/gemini', () => ({ getGemini: h.getGemini, GEMINI_MODEL: 'm', GEMINI_MODEL_FALLBACK: 'f' }))
vi.mock('@/lib/visa/crypto', () => ({ visaCryptoReady: () => true, decryptVisaPayload: () => ({}), encryptVisaPayload: () => 'c' }))
vi.mock('@/lib/visa/records', () => ({ recordVisaEvent: async (...args: unknown[]) => { h.state.events.push(args) } }))
vi.mock('@/lib/visa/db', () => ({
  getVisaDb: () => ({
    from(table: string) {
      const q: Row = { table, op: 'select', filters: [] }
      const api: Row = {
        select: () => api, eq: (c: string, v: unknown) => { q.filters.push(['eq', c, v]); return api },
        neq: (c: string, v: unknown) => { q.filters.push(['neq', c, v]); return api },
        in: (c: string, v: unknown) => { q.filters.push(['in', c, v]); return api },
        order: () => api, limit: () => api,
        update: (payload: Row) => { q.op = 'update'; q.payload = payload; return api },
        maybeSingle: async () => (table === 'visa_applications'
          ? { data: { id: APP, user_id: 'user-1', status: 'draft', encrypted_payload: 'x', updated_at: 't' } }
          : { data: h.state.updates.length && h.state.afterUpdate !== undefined ? h.state.afterUpdate : h.state.document }),
        then: (res: (v: unknown) => unknown) => {
          if (q.op === 'update') h.state.updates.push(q)
          return Promise.resolve({ data: q.op === 'update' && !h.state.downgradeBlocked ? [{ id: 'doc-1' }] : [], error: null }).then(res)
        },
      }
      return api
    },
  }),
}))

const { POST } = await import('./route.svc')
const call = (body: Row) => POST(new Request(`http://t/api/visa/applications/${APP}/extract`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: APP }) })

beforeEach(() => {
  h.state.updates = []; h.state.events = []; h.state.downgradeBlocked = false; h.state.afterUpdate = undefined
  h.rateLimit.mockClear(); h.getGemini.mockClear()
})

describe('extract with ai:false', () => {
  it('marks the document saved-but-unchecked, calls no model and charges no limiter', async () => {
    const res = await call({ kind: 'passport', documentId: '22222222-2222-4222-8222-222222222222', ai: false })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.document).toMatchObject({ id: 'doc-1', validationStatus: 'unavailable', validationReport: expect.objectContaining({ issues: ['automatic_image_check_declined'] }) })
    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0].payload).toMatchObject({ validation_status: 'unavailable' })
    expect(h.state.updates[0].filters).toContainEqual(['in', 'validation_status', ['pending', 'unavailable']])
    expect(h.state.events).toHaveLength(1)
    expect(h.getGemini).not.toHaveBeenCalled()
    expect(h.rateLimit).not.toHaveBeenCalled()
  })

  it('never downgrades a document that already passed — and reports it as it now is', async () => {
    h.state.downgradeBlocked = true
    h.state.afterUpdate = { ...h.state.document, validation_status: 'passed', validation_report: { status: 'passed' } }
    const body = await (await call({ kind: 'portrait', ai: false })).json()
    expect(body.document).toMatchObject({ validationStatus: 'passed', validationReport: { status: 'passed' } })
    expect(h.state.events).toHaveLength(0) // nothing was declined, so nothing is recorded
  })

  it('⛔ never launders a FAILED check into the non-blocking `unavailable` — the applicant re-uploads', async () => {
    h.state.downgradeBlocked = true
    h.state.afterUpdate = { ...h.state.document, validation_status: 'failed', validation_report: { status: 'failed', issues: ['portrait_blurry'] } }
    const body = await (await call({ kind: 'portrait', ai: false })).json()
    expect(body.document).toMatchObject({ validationStatus: 'failed' })
    expect(h.state.events).toHaveLength(0)
  })

  it('⛔ a document that vanished between the read and the write is never reported as passed', async () => {
    h.state.downgradeBlocked = true
    h.state.afterUpdate = null
    const res = await call({ kind: 'portrait', ai: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'portrait_image_required' })
  })
})
