import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/unsubscribe — the teacher job-match list (plan review D5/E3): a one-click or page unsubscribe switches
// matchEmailOptIn off and STAMPS the withdrawal through optInWrites (the profile form's own rule), keeping the last
// grant on record; there is no one-tap re-subscribe (it is a consent to AI matching, given only in the profile). The
// weekly digest path is unchanged. No database: the Prisma calls are faked.
type TP = { id: string; matchEmailOptIn: boolean; matchEmailOptInAt: Date | null; matchEmailNoticeVersion: string | null; matchEmailWithdrawnAt: Date | null }
const h = vi.hoisted(() => ({
  teacher: null as TP | null,
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  digest: [] as { where: unknown; data: unknown }[],
  raceOnce: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: () => ({ action: 'ignore' }) }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/unsubscribe-token', () => ({ verifyUnsubscribeToken: (t: string) => (t.startsWith('good-') ? t.slice(5) : null) }))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: {
      findUnique: async () => (h.teacher ? { ...h.teacher } : null),
      // Compare-and-set: the write applies only while the stored record is what was read.
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        h.updates.push({ where, data })
        const t = h.teacher
        if (h.raceOnce) { h.raceOnce = false; return { count: 0 } }
        const same = !!t && where.id === t.id && where.matchEmailOptIn === t.matchEmailOptIn &&
          (where.matchEmailOptInAt as Date | null)?.getTime() === t.matchEmailOptInAt?.getTime() &&
          where.matchEmailNoticeVersion === t.matchEmailNoticeVersion &&
          (where.matchEmailWithdrawnAt as Date | null)?.getTime() === t.matchEmailWithdrawnAt?.getTime()
        if (!same) return { count: 0 }
        Object.assign(t!, data)
        return { count: 1 }
      },
    },
    profile: { updateMany: async (args: { where: unknown; data: unknown }) => { h.digest.push(args); return { count: 1 } } },
  },
}))

const { POST, GET } = await import('./route')
const { AI_NOTICE_VERSION } = await import('@/lib/teachers/profile')
const GRANTED = new Date('2026-10-09T01:00:00Z')
const post = (qs: string, body?: BodyInit, type = 'application/json') =>
  POST(new Request(`https://eno.vn/api/unsubscribe?${qs}`, { method: 'POST', headers: { 'content-type': type }, body }) as never)

beforeEach(() => {
  h.teacher = { id: 'tp1', matchEmailOptIn: true, matchEmailOptInAt: GRANTED, matchEmailNoticeVersion: AI_NOTICE_VERSION, matchEmailWithdrawnAt: null }
  h.updates = []; h.digest = []; h.raceOnce = false
})

describe('POST /api/unsubscribe?list=teacher-matches', () => {
  it('⛔ switches the match emails off and stamps the withdrawal — the last grant stays on record', async () => {
    const before = Date.now()
    const res = await post('token=good-p1&list=teacher-matches', JSON.stringify({ optIn: false }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, optIn: false })
    expect(h.teacher).toMatchObject({ matchEmailOptIn: false, matchEmailOptInAt: GRANTED, matchEmailNoticeVersion: AI_NOTICE_VERSION })
    expect(h.teacher!.matchEmailWithdrawnAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(h.digest).toHaveLength(0) // a separate list: the weekly digest is not touched
  })

  it('works from the mail client’s one-click POST (form-encoded, not JSON)', async () => {
    const res = await post('token=good-p1&list=teacher-matches', 'List-Unsubscribe=One-Click', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)
    expect(h.teacher!.matchEmailOptIn).toBe(false)
    expect(h.teacher!.matchEmailWithdrawnAt).toBeInstanceOf(Date)
  })

  it('a repeated click on an opt-in already off changes nothing — no second withdrawal stamp', async () => {
    const earlier = new Date('2026-10-10T00:00:00Z')
    h.teacher = { ...h.teacher!, matchEmailOptIn: false, matchEmailWithdrawnAt: earlier }
    expect((await post('token=good-p1&list=teacher-matches')).status).toBe(200)
    expect(h.updates).toHaveLength(0)
    expect(h.teacher!.matchEmailWithdrawnAt).toEqual(earlier)
  })

  it('⛔ no one-tap re-subscribe: optIn true is refused, and nothing is written', async () => {
    h.teacher = { ...h.teacher!, matchEmailOptIn: false }
    const res = await post('token=good-p1&list=teacher-matches', JSON.stringify({ optIn: true }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'resubscribe_in_profile' })
    expect(h.updates).toHaveLength(0)
    expect(h.teacher!.matchEmailOptIn).toBe(false)
  })

  it('a profile save racing the unsubscribe is never overwritten with stale evidence — the read is retried', async () => {
    h.raceOnce = true
    expect((await post('token=good-p1&list=teacher-matches')).status).toBe(200)
    expect(h.updates).toHaveLength(2)
    expect(h.updates[1].where).toMatchObject({ id: 'tp1', matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION })
    expect(h.teacher!.matchEmailOptIn).toBe(false)
  })

  it('a forged token is refused; a valid one for an account with no teacher profile is ok (nothing left to email)', async () => {
    expect((await post('token=forged&list=teacher-matches')).status).toBe(404)
    h.teacher = null
    expect(await (await post('token=good-p1&list=teacher-matches')).json()).toEqual({ ok: true, optIn: false })
  })
})

describe('the weekly digest list is unchanged', () => {
  it('still unsubscribes and re-subscribes by token', async () => {
    expect(await (await post('token=good-p1', JSON.stringify({ optIn: true }))).json()).toEqual({ ok: true, optIn: true })
    expect(h.digest[0]).toEqual({ where: { id: 'p1' }, data: { weeklyDigestOptIn: true } })
    expect(h.updates).toHaveLength(0)
  })
  it('GET never mutates: it redirects to the confirm page, keeping the list', async () => {
    const res = GET(new Request('https://eno.vn/api/unsubscribe?token=good-p1&list=teacher-matches') as never)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/unsubscribe\?token=good-p1&list=teacher-matches$/)
    expect(h.updates).toHaveLength(0)
  })
})
