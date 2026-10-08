import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher's part of the account export: a private intro video is DISCLOSED as existing — never its storage path —
// with the record of where it was asked for and sent.
const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, shares: [] as Record<string, unknown>[], sharesWhere: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async () => h.row },
    teacherVideoShare: { findMany: async ({ where }: { where: unknown }) => { h.sharesWhere = where; return h.shares } },
  },
}))
const { teacherExportOf } = await import('./export')

beforeEach(() => {
  h.row = { id: 'tp1', fullName: 'Jane Doe', videoOnRequest: true, videoUrl: null, private: { phone: '+84901234567', email: 'jane@example.com', cvFileName: 'cv.pdf', videoPath: 'p1/aaaa.mp4', updatedAt: new Date(0) } }
  h.shares = [{ conversationId: 'c1', requestedAt: new Date(1), sharedAt: new Date(2), revokedAt: null }]
})

describe('teacherExportOf', () => {
  it('says a private video exists, never where it is stored, and lists where it was asked for and sent', async () => {
    const out = await teacherExportOf('p1')
    expect(JSON.stringify(out)).not.toContain('p1/aaaa.mp4')
    expect(out?.private).toEqual({ phone: '+84901234567', email: 'jane@example.com', cvFileName: 'cv.pdf', updatedAt: new Date(0), hasPrivateVideo: true })
    expect(out?.videoOnRequest).toBe(true)
    expect(out?.videoShares).toEqual(h.shares)
    expect(h.sharesWhere).toEqual({ conversation: { sellerProfileId: 'p1' } })
  })
  it('no teacher profile: null', async () => {
    h.row = null
    expect(await teacherExportOf('p1')).toBeNull()
  })
})
