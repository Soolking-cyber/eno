import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tutor may show only one of its OWN teacher's uploaded rooms, still ok (2026-11-09).
const h = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 't9' })), owned: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/handler')>()),
  route: (_o: unknown, fn: (c: { req: Request; profile: { id: string } }) => Promise<Response>) => async (req: Request) => {
    const { ApiError } = await import('@/lib/api/handler')
    try { return await fn({ req, profile: { id: 'teacher-account' } }) } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.code }, { status: e.status })
      throw e
    }
  },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/classroom/guards', () => ({ requireTeacher: async () => ({ id: 'tp1', fullName: 'Anna', photoUrl: null, nationality: 'GB' }) }))
vi.mock('@/lib/classroom/tutors', async (orig) => ({ ...(await orig<typeof import('@/lib/classroom/tutors')>()), createTutor: h.create, backgroundOfTeacher: h.owned }))

const { POST } = await import('./route')
const { VOICES } = await import('@/lib/classroom/voices')
const make = (o: Record<string, unknown>) => POST(new Request('https://eno.vn/api/classroom/tutors', { method: 'POST', body: JSON.stringify({ name: 'Ms Anna', persona: '', greeting: '', voice: VOICES[0].id, look: 'photo', traits: {}, ...o }) }))

beforeEach(() => { vi.clearAllMocks() })

describe('a new tutor\'s room', () => {
  it('⛔ another teacher\'s upload, or one taken down: refused, nothing made — looked up through THIS teacher', async () => {
    h.owned.mockResolvedValue(null)
    const r = await make({ backgroundId: 'someone-elses' })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('background_not_found')
    expect(h.owned).toHaveBeenCalledWith('someone-elses', 'tp1')
    expect(h.create).not.toHaveBeenCalled()
  })
  it('the teacher\'s own room, still ok: made with it', async () => {
    h.owned.mockResolvedValue({ id: 'b1' })
    expect((await make({ backgroundId: 'b1' })).status).toBe(201)
    expect((h.create.mock.calls[0] as unknown as [string, { backgroundId: string }])[1].backgroundId).toBe('b1')
  })
})
