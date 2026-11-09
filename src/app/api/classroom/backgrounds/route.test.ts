import { beforeEach, describe, expect, it, vi } from 'vitest'

// Owner, 2026-11-09: teachers upload rooms for behind their tutors; children see them. The upload and who may see one.
const h = vi.hoisted(() => {
  const bg = { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: 'b9' })), findMany: vi.fn(async () => []), findUnique: vi.fn(), updateMany: vi.fn() }
  return {
    bg,
    seat: { findFirst: vi.fn() },
    check: vi.fn(),
    staff: vi.fn(async () => false),
    profileId: 'teacher-account',
    params: { id: 'b1' },
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/handler')>()),
  route: (_o: unknown, fn: (c: { req: Request; profile: { id: string }; params: Record<string, string> }) => Promise<Response>) => async (req: Request) => {
    const { ApiError } = await import('@/lib/api/handler')
    try { return await fn({ req, profile: { id: h.profileId }, params: h.params }) } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.code }, { status: e.status })
      throw e
    }
  },
}))
vi.mock('@/lib/db', () => ({ db: {
  classroomBackground: h.bg,
  classroomEnrollment: h.seat,
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: async () => 1, classroomBackground: h.bg }),
} }))
vi.mock('@/lib/classroom/guards', () => ({ requireTeacher: async () => ({ id: 'tp1', fullName: 'Anna', photoUrl: null, nationality: 'GB' }) }))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => ({}), GEMINI_MODEL: 'x' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/user-blocks', () => ({ isStaffProfile: h.staff }))
vi.mock('@/lib/classroom/backgrounds-upload', async (orig) => ({ ...(await orig<typeof import('@/lib/classroom/backgrounds-upload')>()), checkRoom: h.check }))

const { POST } = await import('./route')
const { GET: IMAGE } = await import('./[id]/image/route')
const { DELETE } = await import('./[id]/route')
const { getSharp } = await import('@/lib/sharp-lazy')
const photo = async () => (await getSharp())({ create: { width: 1200, height: 900, channels: 3, background: '#89a' } }).jpeg().toBuffer()
const upload = async () => POST(new Request('https://eno.vn/api/classroom/backgrounds', { method: 'POST', body: new Uint8Array(await photo()), headers: { 'content-type': 'image/jpeg' } }))

beforeEach(() => {
  vi.clearAllMocks()
  h.bg.count.mockResolvedValue(0)
  h.bg.findMany.mockResolvedValue([])
  h.staff.mockResolvedValue(false)
  h.profileId = 'teacher-account'
})

describe('uploading a room', () => {
  it('a room that passes the check is kept', async () => {
    h.check.mockResolvedValue({ ok: true })
    const r = await upload()
    expect(r.status).toBe(201)
    expect(h.bg.create).toHaveBeenCalledTimes(1)
    expect((h.bg.create.mock.calls[0] as unknown as [{ data: unknown }])[0].data).toMatchObject({ teacherProfileId: 'tp1' })
  })
  it('⛔ a refused room is NOT stored anywhere, and the teacher is told why', async () => {
    h.check.mockResolvedValue({ ok: false, reason: 'person' })
    const r = await upload()
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'background_refused', reason: 'person' })
    expect(h.bg.create).not.toHaveBeenCalled()
  })
  it('⛔ no answer from the check REFUSES (fail closed) — nothing stored, "try again"', async () => {
    h.check.mockRejectedValue(new AggregateError([new Error('timeout'), new Error('timeout')]))
    const r = await upload()
    expect(r.status).toBe(503)
    expect((await r.json()).error).toBe('background_check_unavailable')
    expect(h.bg.create).not.toHaveBeenCalled()
  })
  it('bytes that are not an image never reach the check', async () => {
    const r = await POST(new Request('https://eno.vn/api/classroom/backgrounds', { method: 'POST', body: 'hello', headers: { 'content-type': 'image/jpeg' } }))
    expect(r.status).toBe(400)
    expect(h.check).not.toHaveBeenCalled()
  })
  it('past the teacher\'s cap: refused before the check runs', async () => {
    h.bg.count.mockResolvedValue(12)
    expect((await upload()).status).toBe(409)
    expect(h.check).not.toHaveBeenCalled()
  })
})

describe('⛔ who may see an uploaded room', () => {
  const okRow = { teacherProfileId: 'tp1', status: 'ok', teacherProfile: { profileId: 'teacher-account' } }
  const get = () => IMAGE(new Request('https://eno.vn/api/classroom/backgrounds/b1/image'))
  beforeEach(() => {
    h.bg.findUnique.mockImplementation(async (q: { select: Record<string, unknown> }) => ('image' in q.select ? { image: Buffer.from('webp') } : 'thumb' in q.select ? { thumb: Buffer.from('w') } : okRow))
  })
  it('its teacher: yes, privately cached', async () => {
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toMatch(/^private/)
  })
  it('a family whose learner has a seat in that teacher\'s class: yes — checked on the seat, not guessed (a session keeps its room if the teacher switches)', async () => {
    h.profileId = 'parent'
    h.seat.findFirst.mockResolvedValue({ id: 'seat-1' })
    expect((await get()).status).toBe(200)
    expect(h.seat.findFirst.mock.calls[0][0].where).toEqual({ status: { in: ['active', 'paused'] }, learner: { ownerId: 'parent' }, avatar: { teacherProfileId: 'tp1' } })
  })
  it('anyone else: 404 (an id says nothing)', async () => {
    h.profileId = 'stranger'
    h.seat.findFirst.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })
  it('a removed room: 404 even for its teacher; admins still see it (the takedown list)', async () => {
    h.bg.findUnique.mockImplementation(async (q: { select: Record<string, unknown> }) => ('image' in q.select ? { image: Buffer.from('webp') } : { ...okRow, status: 'removed' }))
    expect((await get()).status).toBe(404)
    h.staff.mockResolvedValue(true)
    h.profileId = 'admin'
    expect((await get()).status).toBe(200)
  })
})

describe('a teacher removes a room', () => {
  it('only their own, still ok — the write names the teacher', async () => {
    h.bg.updateMany.mockResolvedValue({ count: 1 })
    const r = await DELETE(new Request('https://eno.vn/api/classroom/backgrounds/b1', { method: 'DELETE' }))
    expect(r.status).toBe(200)
    expect(h.bg.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'b1', teacherProfileId: 'tp1', status: 'ok' }, data: { status: 'removed', removedBy: 'teacher' } })
  })
  it('another teacher\'s room (or one already removed): 404, nothing written', async () => {
    h.bg.updateMany.mockResolvedValue({ count: 0 })
    expect((await DELETE(new Request('https://eno.vn/api/classroom/backgrounds/b1', { method: 'DELETE' }))).status).toBe(404)
  })
})
