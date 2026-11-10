import { beforeEach, describe, expect, it, vi } from 'vitest'

// PUT /api/admin/classroom — the byte cap (appsec-02). The cohort box sends up to 200 entries of 254 characters, ~52 KB
// of JSON, so the 64 KB default would leave too little room; the route sets 256 KB (four times that). Everything past the
// cap is 413 payload_too_large before it is parsed.

const h = vi.hoisted(() => ({ looked: [] as unknown[], queries: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => 'admin@eno.vn', getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/db', () => ({
  db: {
    // 1st: the current mode (PUT); 2nd: describe() — answered "no table yet", which it reports as { tables: false }.
    $queryRaw: async () => { h.queries++; if (h.queries > 1) throw new Error('42P01'); return [{ mode: 'staff' }] },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: async () => 1 }),
    profile: { findMany: async (args: unknown) => { h.looked.push(args); return [] } },
  },
}))
vi.mock('@/lib/mail', () => ({ sendMail: async () => true }))
vi.mock('@/lib/emails/layout', () => ({ renderBrandEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/classroom/config', () => ({ classroomSweepIsFresh: async () => true, resetClassroomConfigCache: () => {} }))
vi.mock('@/lib/classroom/feedback', () => ({ buildFeedback: async () => null }))
vi.mock('@/lib/classroom/budget', () => ({ budgetUse: async () => ({ dayMinutes: 0, monthMinutes: 0 }) }))
vi.mock('@/lib/classroom/likeness', () => ({ markLikenessDeleted: async () => {}, pendingLikenessDeletions: async () => [] }))
vi.mock('@/lib/classroom/library-avatars', () => ({ libraryAvatarById: () => null }))
vi.mock('@/lib/classroom/backgrounds', () => ({ uploadedRoomUrl: () => '' }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async () => {} }))
vi.mock('@/lib/classroom/own-voice', () => ({ deleteOwnVoice: async () => {}, pendingVoiceDeletions: async () => 0 }))

const { PUT } = await import('./route')
const put = (body: string) => PUT(new Request('https://eno.vn/api/admin/classroom', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }))

beforeEach(() => { h.looked = []; h.queries = 0 })

describe('PUT /api/admin/classroom — the byte cap: 256 KB', () => {
  // 200 addresses of 254 characters — the schema's largest cohort.
  const cohort = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(3, '0')}${'a'.repeat(243)}@x.co.vn`)

  it('the schema\'s largest cohort fits four times under the cap and is read, validated and looked up', async () => {
    expect(cohort[0]).toHaveLength(254)
    const body = JSON.stringify({ cohortEmails: cohort })
    expect(Buffer.byteLength(body) * 4).toBeLessThanOrEqual(256 * 1024)
    const res = await put(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tables: false })
    expect(h.looked).toHaveLength(1)
  })

  it('one byte past 256 KB is 413 payload_too_large: nothing looked up or written', async () => {
    const shell = JSON.stringify({ cohortEmails: [], pad: '' })
    const res = await put(JSON.stringify({ cohortEmails: [], pad: 'a'.repeat(256 * 1024 + 1 - shell.length) }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    expect(h.looked).toEqual([])
    expect(h.queries).toBe(0)
  })
})
