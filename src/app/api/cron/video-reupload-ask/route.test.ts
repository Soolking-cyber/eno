import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cron/video-reupload-ask — the videos that went up silent (owner, 2026-10-17: "reupload those 4 with sound … you
// send them automatically that leads to the load page so they can reupload" — "also email"). ONLY the listings named in
// `ids`; each video's sound is MEASURED; a silent one gets ONE ask — the email first, then the bell and the audit row in
// one transaction — linking to where the video is replaced. A dry run lists and touches nothing; nothing is asked on a
// clip that could not be read, nor about a video the uploader has already replaced.
const h = vi.hoisted(() => ({
  listings: [] as Array<Record<string, unknown>>,
  levels: {} as Record<string, unknown>,
  current: {} as Record<string, string>,
  status: {} as Record<string, string>,
  owner: {} as Record<string, string>,
  ownerNow: {} as Record<string, unknown>,
  asked: new Map<string, Record<string, unknown>>(),
  order: [] as string[],
  notifications: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mails: [] as Array<{ to: string; key: string; subject: string; text: string }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), IS_MARKETPLACE: true, SITE_NAME: 'eno.vn' }))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (ctx: { req: Request }) => unknown) => async (req: Request) => fn({ req }) }))
vi.mock('@/lib/ratelimit', () => ({ kv: { set: async () => 'OK', del: async () => {} } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => true,
  sendMailOnce: async (m: { to: string; subject: string; text: string }, o: { idempotencyKey: string }) => { h.order.push('mail'); h.mails.push({ to: m.to, key: o.idempotencyKey, subject: m.subject, text: m.text }); return { outcome: 'sent', stopRun: false } },
}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.order.push('audit'); h.audits.push(input) } }))
vi.mock('@/lib/core/video-audio-level', () => ({ SILENT_MEAN_DB: -80, clipAudioLevel: async (url: string) => h.levels[url] ?? null }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.listings.filter((l) => where.id.in.includes(l.id as string)),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const l = h.listings.find((x) => x.id === where.id) as { video: string; seller: { ownerId: string | null; owner: unknown }; teacherProfile: unknown } | undefined
        return { video: h.current[where.id] ?? l?.video ?? null, status: h.status[where.id] ?? 'active', seller: { ownerId: h.owner[where.id] ?? l?.seller.ownerId ?? null, owner: h.ownerNow[where.id] ?? l?.seller.owner ?? null }, teacherProfile: l?.teacherProfile ?? null }
      },
    },
    complianceAudit: { findFirst: async ({ where }: { where: { subjectId: string; detail: { equals: string } } }) => { const d = h.asked.get(`${where.subjectId}:${where.detail.equals}`); return d ? { id: 1, detail: d } : null } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => 0,
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => { h.order.push('bell'); h.notifications.push(data) } },
    }),
  },
}))

const { GET } = await import('./route')
/** Listing ids are cuids: the route takes only that shape in `ids`. */
const ID = (k: string) => `cm${k.repeat(23).slice(0, 23)}`
const V = (k: string) => `https://sb.eno.vn/storage/v1/object/public/listing-videos/${k}-clip.mp4`
const L = (k: string, opts: { teacher?: boolean; locale?: string; owner?: boolean } = {}) => ({
  id: ID(k),
  video: V(k),
  seller: opts.owner === false ? { ownerId: null, owner: null } : { ownerId: `p-${k}`, owner: { email: `${k}@example.com`, locale: opts.locale ?? 'en', displayName: `Owner ${k}` } },
  teacherProfile: opts.teacher ? { fullName: `Teacher ${k}`, private: null } : null,
})
const SILENT = { hasAudio: true, meanDb: -91 }
const run = async (keys: string[], dry = false) => (await (GET as unknown as (r: Request) => Promise<Record<string, unknown>>)(
  new Request(`https://eno.vn/api/cron/video-reupload-ask?${dry ? 'dryRun=1&' : ''}ids=${keys.map(ID).join(',')}`),
))

beforeEach(() => {
  Object.assign(h, { listings: [], levels: {}, current: {}, status: {}, owner: {}, ownerNow: {}, order: [], notifications: [], audits: [], mails: [] })
  h.asked.clear()
})

describe('/api/cron/video-reupload-ask', () => {
  it('⛔ never a sweep: no ids (or too many) asks nobody', async () => {
    h.listings = [L('a')]
    h.levels = { [V('a')]: SILENT }
    const none = await (GET as unknown as (r: Request) => Promise<Record<string, unknown>>)(new Request('https://eno.vn/api/cron/video-reupload-ask'))
    expect(none).toMatchObject({ ok: false, error: 'ids_required' })
    expect(await run(Array.from({ length: 11 }, (_, i) => String.fromCharCode(97 + (i % 26)) + i))).toMatchObject({ ok: false, error: 'ids_required' })
    expect(h.order).toEqual([])
  })

  it('only the listings named are measured — another silent video on the site is left alone', async () => {
    h.listings = [L('a'), L('b')]
    h.levels = { [V('a')]: SILENT, [V('b')]: SILENT }
    const r = await run(['a'], true)
    expect(r).toMatchObject({ named: 1, videos: 1, silent: [{ listingId: ID('a'), meanDb: -91, asked: false }] })
  })

  it('a dry run measures and lists the silent videos — and sends, writes nothing', async () => {
    h.listings = [L('a'), L('b'), L('c'), L('d')]
    h.levels = { [V('a')]: { hasAudio: true, meanDb: -22.5 }, [V('b')]: SILENT, [V('c')]: { hasAudio: true, meanDb: -Infinity }, [V('d')]: null }
    const r = await run(['a', 'b', 'c', 'd'], true)
    expect(r).toMatchObject({ dryRun: true, videos: 4, withSound: 1, unchecked: 1, asked: 0, silent: [{ listingId: ID('b'), meanDb: -91, asked: false }, { listingId: ID('c'), meanDb: '-inf', asked: false }] })
    expect(h.order).toEqual([])
  })

  it('a teacher\'s silent intro: the email FIRST, then the bell and the audit row — both leading to the teacher edit form', async () => {
    h.listings = [L('t', { teacher: true })]
    h.levels = { [V('t')]: SILENT }
    const r = await run(['t'])
    expect(r).toMatchObject({ asked: 1, emailed: 1, ok: true })
    expect(h.order).toEqual(['mail', 'bell', 'audit'])
    expect(h.mails[0]).toMatchObject({ to: 't@example.com', key: `video-reupload-ask:${ID('t')}:t-clip.mp4`, subject: 'Please upload your video again on eno.vn' })
    expect(h.mails[0].text).toContain('https://eno.vn/teachers/edit?step=finish')
    expect(h.mails[0].text).toContain('Hi Teacher t,')
    expect(h.notifications[0]).toMatchObject({ recipientId: 'p-t', type: 'system', title: 'Please upload your video again', listingId: ID('t'), url: '/teachers/edit?step=finish' })
    expect(h.audits[0]).toMatchObject({ action: 'listing.video.reupload_ask', subjectType: 'listing', subjectId: ID('t'), detail: { key: V('t'), meanDb: -91, mail: 'sent' } })
  })

  it('any other listing leads to its own editor; Vietnamese for a Vietnamese account', async () => {
    h.listings = [L('x', { locale: 'vi' })]
    h.levels = { [V('x')]: SILENT }
    await run(['x'])
    expect(h.notifications[0]).toMatchObject({ title: 'Vui lòng tải lại video của bạn', url: `/listings/${ID('x')}/edit` })
    expect(h.mails[0].text).toContain(`https://eno.vn/listings/${ID('x')}/edit`)
  })

  it('⛔ only the silent ones: a clip with sound, one with no sound track at all, or one that could not be read is never asked about', async () => {
    h.listings = [L('a'), L('b'), L('c')]
    h.levels = { [V('a')]: { hasAudio: true, meanDb: -34 }, [V('b')]: { hasAudio: false }, [V('c')]: null }
    const r = await run(['a', 'b', 'c'])
    expect(r).toMatchObject({ withSound: 1, noAudio: 1, unchecked: 1, asked: 0, ok: false })
    expect(h.order).toEqual([])
  })

  it('⛔ a listing removed, or passed to another owner, while it was measured is not asked about', async () => {
    h.listings = [L('a'), L('b')]
    h.levels = { [V('a')]: SILENT, [V('b')]: SILENT }
    h.status = { [ID('a')]: 'removed' }
    h.owner = { [ID('b')]: 'p-someone-else' }
    const r = await run(['a', 'b'])
    expect(r).toMatchObject({ replaced: 2, asked: 0 })
    expect(h.order).toEqual([])
  })

  it('⛔ a video the uploader replaced after it was measured is not asked about', async () => {
    h.listings = [L('a')]
    h.levels = { [V('a')]: SILENT }
    h.current = { [ID('a')]: V('a-new') }
    const r = await run(['a'])
    expect(r).toMatchObject({ replaced: 1, asked: 0 })
    expect(h.order).toEqual([])
  })

  it('⛔ once per video: an ask already made (and emailed) is never repeated; a guest seller is listed, never asked', async () => {
    h.listings = [L('a'), L('g', { owner: false })]
    h.levels = { [V('a')]: SILENT, [V('g')]: SILENT }
    h.asked.set(`${ID('a')}:${V('a')}`, { key: V('a'), mail: 'sent' })
    const r = await run(['a', 'g'])
    expect(r).toMatchObject({ already: 1, noOwner: 1, asked: 0 })
    expect(h.order).toEqual([])
  })

  it('an ask whose email did not go is emailed by the next run — the email alone, never a second bell', async () => {
    h.listings = [L('a')]
    h.levels = { [V('a')]: SILENT }
    h.asked.set(`${ID('a')}:${V('a')}`, { key: V('a'), mail: 'skipped' })
    const r = await run(['a'])
    expect(r).toMatchObject({ emailed: 1, asked: 0 })
    expect(h.order).toEqual(['mail', 'audit'])
    expect(h.audits[0]).toMatchObject({ detail: { mail: 'sent', retry: true } })
  })

  it('a retry with nobody left to email (the address is gone) is recorded as done — never pending forever', async () => {
    const l = L('a')
    ;(l.seller as { owner: { email: string | null } }).owner.email = null
    h.listings = [l]
    h.levels = { [V('a')]: SILENT }
    h.asked.set(`${ID('a')}:${V('a')}`, { key: V('a'), mail: 'skipped' })
    const r = await run(['a'])
    expect(r).toMatchObject({ mailPending: 0, asked: 0, emailed: 0 })
    expect(h.order).toEqual(['audit'])
    expect(h.audits[0]).toMatchObject({ detail: { mail: 'no_address', retry: true } })
  })

  it('the address used is the one on the account when the ask goes — not one read before the measurement', async () => {
    h.listings = [L('a')]
    h.levels = { [V('a')]: SILENT }
    h.ownerNow = { [ID('a')]: { email: 'new@example.com', locale: 'vi' } }
    await run(['a'])
    expect(h.mails[0]).toMatchObject({ to: 'new@example.com' })
    expect(h.notifications[0]).toMatchObject({ title: 'Vui lòng tải lại video của bạn' })
  })
})
