import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE ONE ERASURE PROCEDURE (shared by self-service deletion and the admin Users console, 2026-09-05).
 * Under test: the investigation hold refuses before anything is touched; tombstones and the audit
 * row commit INSIDE the transaction, before the profile row goes; the identity record survives
 * pseudonymised (name/nationality cleared, paths and decision inputs dropped, hash kept); the
 * response-path purge runs after the transaction and clears what it settled.
 */
const h = vi.hoisted(() => ({
  profile: null as null | { id: string; avatarUrl: string | null; enforcementState: string; email: string | null },
  openReports: 0,
  seller: null as null | { id: string; avatarUrl: string | null; bannerUrl: string | null },
  listings: [] as Array<{ id: string; images: string; video: string | null }>,
  identities: [] as Array<{ id: string; evidence: Record<string, unknown> }>,
  events: [] as string[],
  tombstones: [] as Array<{ bucket: string; path: string }>,
  audits: [] as Array<Record<string, unknown>>,
  identityUpdates: [] as Array<Record<string, unknown>>,
  purged: [] as string[],
  cleared: [] as Array<{ bucket: string; path: string }>,
  deskListError: false,
  authDeletes: 0,
}))

vi.mock('server-only', () => ({}))
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')
vi.stubGlobal('fetch', vi.fn(async () => { h.events.push('auth-user-deleted'); h.authDeletes++; return { ok: true, status: 200 } as Response }))
vi.mock('@/lib/db', () => {
  const tx = {
    seller: {
      findUnique: async () => h.seller,
      delete: async () => { h.events.push('seller-deleted'); return {} },
    },
    listing: { findMany: async () => h.listings, deleteMany: async () => { h.events.push('listings-deleted'); return { count: h.listings.length } } },
    sellerVerification: { findMany: async () => [{ documents: [{ kind: 'identity', path: 's1/doc.jpg', mime: 'image/jpeg', sha256: 'x', uploadedAt: '' }] }] },
    report: { updateMany: async () => ({ count: 0 }) },
    review: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
    identityVerification: {
      findMany: async () => h.identities,
      update: async ({ data }: { data: Record<string, unknown> }) => { h.identityUpdates.push(data); return {} },
    },
    profile: { delete: async () => { h.events.push('profile-deleted'); return {} } },
  }
  return {
    db: {
      profile: { findUnique: async () => h.profile },
      seller: { findUnique: async () => h.seller },
      report: { count: async () => h.openReports },
      $transaction: async (fn: (t: typeof tx) => Promise<void>, _opts?: unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/core/storage-purge', () => ({
  purgeStorageObjects: async (urls: string[]) => {
    h.events.push('purged'); h.purged.push(...urls)
    return { deleted: urls.length, kept: 0, foreign: 0, failed: 0, residue: [], settled: urls.map((u) => ({ bucket: 'listings', path: u.split('/').pop()! })) }
  },
}))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Array<{ bucket: string; path: string }>) => { h.events.push('tombstoned'); h.tombstones.push(...refs); return refs.length },
  clearTombstones: async (refs: Array<{ bucket: string; path: string }>) => { h.events.push('cleared'); h.cleared.push(...refs); return refs.length },
}))
vi.mock('@/lib/listing-image', () => ({
  listingObjectKey: (u: string) => (u.startsWith('https://proj/listings/') ? { bucket: 'listings', key: u.slice('https://proj/listings/'.length), url: u } : null),
}))
vi.mock('@/lib/business-verification-store', () => ({ parseVerificationDocs: (v: unknown) => (Array.isArray(v) ? v : []) }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.events.push('audited'); h.audits.push(input) } }))
vi.mock('@/lib/visa-admin', () => ({ VISA_BUCKET: 'visa-documents' }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/supabase-admin', () => ({
  BUSINESS_VERIFICATION_BUCKET: 'business-verification',
  getSupabaseAdmin: () => ({ storage: { from: () => ({ list: async (prefix: string) => {
    if (h.deskListError) return { data: null, error: { message: 'storage down' } }
    if (prefix === 'p1') return { data: [{ id: null, name: 'app-1' }, { id: 'f0', name: 'loose.jpg' }], error: null }
    if (prefix === 'p1/app-1') return { data: [{ id: 'f1', name: 'passport-x.jpg' }, { id: 'f2', name: 'portrait-y.jpg' }], error: null }
    return { data: [], error: null }
  } }) } }),
}))

const { eraseAccount } = await import('./account-erasure')

beforeEach(() => {
  h.profile = { id: 'p1', avatarUrl: 'https://proj/listings/avatar.webp', enforcementState: 'good_standing', email: 'a@b.c' }
  h.openReports = 0
  h.seller = { id: 's1', avatarUrl: null, bannerUrl: 'https://proj/listings/banner.webp' }
  h.listings = [{ id: 'l1', images: JSON.stringify(['https://proj/listings/1.webp']), video: 'https://proj/listing-videos/1.mp4' }]
  h.identities = [{ id: 'v1', evidence: { documentPath: 'p1/identity/document-1.jpg', selfiePath: 'p1/identity/selfie-1.jpg', decisionInput: { surname: 'DOE' }, checksPassed: ['mrz'], consentVersion: 'identity-v1' } }]
  h.events = []; h.tombstones = []; h.audits = []; h.identityUpdates = []; h.purged = []; h.cleared = []; h.deskListError = false; h.authDeletes = 0
})

describe('eraseAccount', () => {
  it('refuses under the investigation hold before touching anything', async () => {
    h.openReports = 1
    expect(await eraseAccount('p1', { kind: 'self' })).toEqual({ ok: false, code: 'under_review' })
    h.openReports = 0; h.profile!.enforcementState = 'suspended'
    expect(await eraseAccount('p1', { kind: 'self' })).toEqual({ ok: false, code: 'under_review' })
    expect(h.events).toEqual([])
  })

  it('unknown account → not_found', async () => {
    h.profile = null
    expect(await eraseAccount('nope', { kind: 'admin', email: 'admin@eno.vn', reason: 'request' })).toEqual({ ok: false, code: 'not_found' })
  })

  it('tombstones and the audit row commit inside the transaction, before the profile row goes; the purge runs after', async () => {
    const r = await eraseAccount('p1', { kind: 'admin', email: 'admin@eno.vn', reason: 'written request 2026-09-05' })
    expect(r.ok).toBe(true)
    // rows first (tombstones + audit inside), then the desk's objects are queued, THEN the auth user
    // (whose cascade takes the visa rows), then the fast-path purge
    expect(h.events).toEqual(['listings-deleted', 'seller-deleted', 'tombstoned', 'audited', 'profile-deleted', 'tombstoned', 'auth-user-deleted', 'purged', 'cleared'])
    expect(h.tombstones).toEqual(expect.arrayContaining([
      { bucket: 'visa-documents', path: 'p1/loose.jpg' }, { bucket: 'visa-documents', path: 'p1/app-1/passport-x.jpg' }, { bucket: 'visa-documents', path: 'p1/app-1/portrait-y.jpg' },
    ]))
    // every first-party public object AND every private one is in the queue
    expect(h.tombstones).toEqual(expect.arrayContaining([
      { bucket: 'listings', path: 'avatar.webp' }, { bucket: 'listings', path: '1.webp' }, { bucket: 'listings', path: 'banner.webp' },
      { bucket: 'business-verification', path: 's1/doc.jpg' },
      { bucket: 'business-verification', path: 'p1/identity/document-1.jpg' }, { bucket: 'business-verification', path: 'p1/identity/selfie-1.jpg' },
    ]))
    expect(h.audits[0]).toMatchObject({ actorType: 'admin', actorId: 'admin@eno.vn', action: 'account.erased', subjectType: 'profile', subjectId: 'p1', detail: { by: 'admin', reason: 'written request 2026-09-05' } })
    // the purge got the public URLs (avatar, listing image, video, banner) and what it settled was cleared
    expect(h.purged).toEqual(expect.arrayContaining(['https://proj/listings/avatar.webp', 'https://proj/listings/1.webp', 'https://proj/listing-videos/1.mp4', 'https://proj/listings/banner.webp']))
    expect(h.cleared.length).toBe(h.purged.length)
  })

  it('if the desk objects cannot be enumerated, the auth user is KEPT — the cascade must not orphan scans', async () => {
    h.deskListError = true
    const r = await eraseAccount('p1', { kind: 'self' })
    expect(r.ok).toBe(true)
    expect(h.authDeletes).toBe(0)
    expect(h.events).not.toContain('auth-user-deleted')
  })

  it('the identity record survives pseudonymised: person cleared, paths and decision inputs dropped, checks and consent kept', async () => {
    await eraseAccount('p1', { kind: 'self' })
    expect(h.identityUpdates).toEqual([{
      fullName: null, nationality: null, residenceCountry: null, residenceSource: null,
      evidence: { checksPassed: ['mrz'], consentVersion: 'identity-v1' },
    }])
    expect(h.audits[0]).toMatchObject({ actorType: 'user', actorId: 'p1', detail: { by: 'self', reason: 'self_service' } })
  })
})
