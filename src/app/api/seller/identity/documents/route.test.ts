import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ AN ABANDONED KYC CAPTURE USED TO BE UNREACHABLE FOREVER.
 *
 * This route stores a passport photograph, or the selfie holding it, in the PRIVATE bucket. The
 * `IdentityVerification` row that points at those objects is written two steps later, when the
 * applicant finishes the form. Anyone who photographed their document and then closed the tab
 * therefore left identity images in storage with nothing referencing them — and both erasure and
 * retention are row-driven, so no sweep, no report and no deletion request would ever find them.
 *
 * ⚠️ THE FIX IS AN INTENT, NOT A DELETION. The route writes a StorageTombstone the moment the
 * object exists; the sweep re-checks references before removing anything, so a capture that IS
 * submitted is found in the row's evidence and its tombstone is dropped, while an abandoned one is
 * collected. The tests below pin that the intent is written, that it names the stored path, and
 * that failing to write it never costs the applicant their upload.
 */
const h = vi.hoisted(() => ({
  userId: 'p1' as string | null,
  liveChallenge: true,
  stored: { kind: 'document', path: 'p1/identity/document-abc.jpg', sha256: 's', width: 900, height: 1200, uploadedAt: '', report: {} } as unknown,
  tombstones: [] as Array<{ refs: Array<{ bucket: string; path: string }>; reason: string }>,
  tombstoneThrows: false,
  errors: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.userId, getAdmin: async () => null, getCurrentProfile: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/identity/challenge', () => ({ hasLiveChallenge: async () => h.liveChallenge }))
vi.mock('@/lib/kyc/store', () => ({ storeKycImage: async () => h.stored }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/supabase-admin', () => ({ BUSINESS_VERIFICATION_BUCKET: 'business-verification' }))
vi.mock('@/lib/log', () => ({ logError: (...a: unknown[]) => { h.errors.push(a) } }))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Array<{ bucket: string; path: string }>, reason: string) => {
    if (h.tombstoneThrows) throw new Error('tombstone store down')
    h.tombstones.push({ refs, reason })
    return refs.length
  },
}))

const { POST } = await import('./route')

const upload = () =>
  POST(new Request('https://eno.vn/api/seller/identity/documents?kind=document', {
    method: 'POST',
    body: Buffer.from('not-really-an-image-but-the-store-is-mocked'),
  }) as never, { params: Promise.resolve({}) } as never)

beforeEach(() => {
  h.userId = 'p1'; h.liveChallenge = true; h.tombstones = []; h.tombstoneThrows = false; h.errors = []
})

describe('POST /api/seller/identity/documents', () => {
  it('records a cleanup intent for the object it just stored', async () => {
    const res = await upload()
    expect(res.status).toBe(201)
    expect(h.tombstones).toEqual([{
      refs: [{ bucket: 'business-verification', path: 'p1/identity/document-abc.jpg' }],
      reason: 'kyc_capture_intent',
    }])
  })

  it('still returns the path to the client, and never a readable URL', async () => {
    const body = await (await upload()).json()
    expect(body).toMatchObject({ path: 'p1/identity/document-abc.jpg' })
    expect(JSON.stringify(body)).not.toContain('http')
  })

  it('does not fail the upload when the intent cannot be written', async () => {
    // ⚠️ The applicant's verification must not break because OUR cleanup queue is unavailable —
    // and the erasure prefix walk is the backstop for exactly this case.
    h.tombstoneThrows = true
    expect((await upload()).status).toBe(201)
    expect(h.errors).toHaveLength(1)
  })

  it('refuses before storing anything without a live challenge — consent precedes collection', async () => {
    h.liveChallenge = false
    expect((await upload()).status).toBe(403)
    expect(h.tombstones).toEqual([])
  })
})
