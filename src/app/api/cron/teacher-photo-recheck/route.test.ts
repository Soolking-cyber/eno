import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cron/teacher-photo-recheck — the photos already on the site (owner, 2026-10-16: "ask current ones to reupload").
// A dry run lists and touches nothing; a run asks each failing photo ONCE — the email first, then the bell and the
// audit row in one transaction — skips an approved or already-asked photo, and never asks on "could not check".
const h = vi.hoisted(() => ({
  teachers: [] as Array<Record<string, unknown>>,
  verdicts: {} as Record<string, unknown>,
  overridden: new Set<string>(),
  asked: new Map<string, Record<string, unknown>>(),
  order: [] as string[],
  notifications: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mails: [] as Array<{ to: string; key: string }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), IS_MARKETPLACE: true, SITE_NAME: 'eno.vn' }))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (ctx: { req: Request }) => unknown) => async (req: Request) => fn({ req }) }))
vi.mock('@/lib/ratelimit', () => ({ kv: { set: async () => 'OK', del: async () => {} } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => true,
  sendMailOnce: async (m: { to: string }, o: { idempotencyKey: string }) => { h.order.push('mail'); h.mails.push({ to: m.to, key: o.idempotencyKey }); return { outcome: 'sent', stopRun: false } },
}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.order.push('audit'); h.audits.push(input) } }))
vi.mock('@/lib/teachers/photo-verdict', () => {
  class PhotoCheckUnavailable extends Error {}
  return {
    PhotoCheckUnavailable,
    teacherPhotoKey: (u: unknown) => (typeof u === 'string' ? u.split('/').pop() : null),
    photoOverridden: async (p: string, k: string) => h.overridden.has(`${p}:${k}`),
    teacherPhotoVerdict: async (p: string) => { const v = h.verdicts[p]; if (v === 'unavailable') throw new PhotoCheckUnavailable(); return v },
  }
})
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findMany: async () => h.teachers },
    complianceAudit: { findFirst: async ({ where }: { where: { subjectId: string; detail: { equals: string } } }) => { const d = h.asked.get(`${where.subjectId}:${where.detail.equals}`); return d ? { id: 1, detail: d } : null } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => 0,
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => { h.order.push('bell'); h.notifications.push(data) } },
    }),
  },
}))

const { GET } = await import('./route')
const T = (id: string, photo = `https://sb.eno.vn/storage/v1/object/public/listings/${id}.webp`) => ({ profileId: id, listingId: `L-${id}`, fullName: `Teacher ${id}`, photoUrl: photo, private: null, profile: { email: `${id}@example.com`, locale: 'en' } })
const run = async (q = '') => (await (GET as unknown as (r: Request) => Promise<Record<string, unknown>>)(new Request(`https://eno.vn/api/cron/teacher-photo-recheck${q}`)))

beforeEach(() => {
  Object.assign(h, { teachers: [], verdicts: {}, order: [], notifications: [], audits: [], mails: [] })
  h.overridden.clear(); h.asked.clear()
})

describe('/api/cron/teacher-photo-recheck', () => {
  it('a dry run lists the photos it would ask about — and sends, writes nothing', async () => {
    h.teachers = [T('a'), T('b'), T('c')]
    h.verdicts = { a: { ok: true }, b: { ok: false, reason: 'not_photo' }, c: 'unavailable' }
    const r = await run('?dryRun=1')
    expect(r).toMatchObject({ dryRun: true, teachers: 3, passed: 1, flagged: [{ listingId: 'L-b', reason: 'not_photo', asked: false }], unchecked: 1, asked: 0 })
    expect(h.order).toEqual([])
  })
  it('a run asks a failing photo once: the email FIRST, then the bell and the audit row', async () => {
    h.teachers = [T('b')]
    h.verdicts = { b: { ok: false, reason: 'no_face' } }
    const r = await run()
    expect(r).toMatchObject({ asked: 1, emailed: 1, ok: true })
    expect(h.order).toEqual(['mail', 'bell', 'audit'])
    expect(h.mails[0]).toEqual({ to: 'b@example.com', key: 'teacher-photo-ask:b:b.webp' })
    expect(h.notifications[0]).toMatchObject({ recipientId: 'b', type: 'system', title: 'Please change your profile photo', url: '/teachers/edit?step=finish' })
    expect(h.audits[0]).toMatchObject({ action: 'teacher.photo.ask', subjectType: 'profile', subjectId: 'b', detail: { key: 'b.webp', reason: 'no_face', listingId: 'L-b', mail: 'sent' } })
  })
  it('⛔ an approved photo, or one already asked about, is never asked about again — and "could not check" is never an ask', async () => {
    h.teachers = [T('a'), T('b'), T('c')]
    h.verdicts = { a: { ok: false, reason: 'no_face' }, b: { ok: false, reason: 'no_face' }, c: 'unavailable' }
    h.overridden.add('a:a.webp'); h.asked.set('b:b.webp', { key: 'b.webp', reason: 'no_face', mail: 'sent' })
    const r = await run()
    expect(r).toMatchObject({ overridden: 1, already: 1, unchecked: 1, asked: 0, ok: false })
    expect(h.order).toEqual([])
  })

  it('⛔ an ask whose email did not go (mail off, refused) is emailed by the next run — the email alone, never a second bell', async () => {
    h.teachers = [T('b')]
    h.asked.set('b:b.webp', { key: 'b.webp', reason: 'not_photo', mail: 'skipped' })
    const r = await run()
    expect(r).toMatchObject({ emailed: 1, asked: 0, mailPending: 0 })
    expect(h.order).toEqual(['mail', 'audit'])
    expect(h.audits[0]).toMatchObject({ action: 'teacher.photo.ask', detail: { key: 'b.webp', reason: 'not_photo', mail: 'sent', retry: true } })
  })
  it('no Vertex client: the run stops and says so — nobody asked on a guess', async () => {
    h.teachers = [T('b')]
    h.verdicts = { b: 'off' }
    expect(await run()).toMatchObject({ ok: false, skipped: 'no_vertex_client' })
    expect(h.order).toEqual([])
  })
})
