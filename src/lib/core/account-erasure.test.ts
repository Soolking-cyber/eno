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
  /** Make the PRIVATE verification bucket's prefix walk fail, independently of the desk's. */
  ownedListError: false,
  /** Entries the private verification bucket reports under `p1/` — enough to need paging. */
  ownedTop: [] as Array<{ id: string | null; name: string }>,
  ownedIdentity: [] as Array<{ id: string | null; name: string }>,
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
/**
 * ⚠️ THE MOCK IS BUCKET-AWARE NOW, AND UNTIL IT WAS THE TWO PREFIX WALKS WERE INDISTINGUISHABLE.
 * `from()` ignored its argument, so the desk bucket and the private verification bucket returned
 * the same listing and a test could not tell which walk had produced a tombstone. It also PAGES:
 * `list` honours `limit`/`offset`, which is the whole point of the walk being paginated.
 */
vi.mock('@/lib/supabase-admin', () => ({
  BUSINESS_VERIFICATION_BUCKET: 'business-verification',
  getSupabaseAdmin: () => ({ storage: { from: (bucket: string) => ({
    list: async (prefix: string, opts?: { limit?: number; offset?: number }) => {
      const page = <T,>(rows: T[]) => rows.slice(opts?.offset ?? 0, (opts?.offset ?? 0) + (opts?.limit ?? 1000))
      if (bucket === 'business-verification') {
        if (h.ownedListError) return { data: null, error: { message: 'storage down' } }
        if (prefix === 'p1') return { data: page(h.ownedTop), error: null }
        if (prefix === 'p1/identity') return { data: page(h.ownedIdentity), error: null }
        return { data: [], error: null }
      }
      if (h.deskListError) return { data: null, error: { message: 'storage down' } }
      if (prefix === 'p1') return { data: page([{ id: null, name: 'app-1' }, { id: 'f0', name: 'loose.jpg' }]), error: null }
      if (prefix === 'p1/app-1') return { data: page([{ id: 'f1', name: 'passport-x.jpg' }, { id: 'f2', name: 'portrait-y.jpg' }]), error: null }
      return { data: [], error: null }
    },
  }) } }),
}))

const { eraseAccount } = await import('./account-erasure')

beforeEach(() => {
  h.profile = { id: 'p1', avatarUrl: 'https://proj/listings/avatar.webp', enforcementState: 'good_standing', email: 'a@b.c' }
  h.openReports = 0
  h.seller = { id: 's1', avatarUrl: null, bannerUrl: 'https://proj/listings/banner.webp' }
  h.listings = [{ id: 'l1', images: JSON.stringify(['https://proj/listings/1.webp']), video: 'https://proj/listing-videos/1.mp4' }]
  h.identities = [{ id: 'v1', evidence: { documentPath: 'p1/identity/document-1.jpg', selfiePath: 'p1/identity/selfie-1.jpg', decisionInput: { surname: 'DOE' }, checksPassed: ['mrz'], consentVersion: 'identity-v1' } }]
  h.events = []; h.tombstones = []; h.audits = []; h.identityUpdates = []; h.purged = []; h.cleared = []; h.deskListError = false; h.authDeletes = 0
  h.ownedListError = false
  h.ownedTop = [{ id: null, name: 'identity' }, { id: 'b1', name: 'licence.pdf' }]
  h.ownedIdentity = [{ id: 'i1', name: 'document-1.jpg' }, { id: 'i2', name: 'selfie-1.jpg' }]
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
    // rows first (tombstones + audit inside), then the desk's objects, then the PRIVATE
    // verification prefix, then the auth user, then the fast-path purge
    expect(h.events).toEqual(['listings-deleted', 'seller-deleted', 'tombstoned', 'audited', 'profile-deleted', 'tombstoned', 'tombstoned', 'auth-user-deleted', 'purged', 'cleared'])
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

  /**
   * ⛔ THE ROW WALK CANNOT SEE AN ABANDONED CAPTURE, AND THIS IS THE PART THAT CAN. Both writers in
   * the private bucket store the object before any row references it — a KYC photograph becomes
   * evidence only when the applicant finishes the form, a business document only when the append
   * commits — so someone who photographs their passport and closes the tab leaves images no
   * row-driven erasure would ever name. The prefix names them.
   */
  it('queues objects under the private prefix that no row references', async () => {
    h.ownedIdentity = [
      { id: 'i1', name: 'document-1.jpg' },
      { id: 'i2', name: 'selfie-1.jpg' },
      { id: 'i3', name: 'document-abandoned.jpg' }, // never submitted: no row names it
    ]
    await eraseAccount('p1', { kind: 'self' })
    expect(h.tombstones).toEqual(expect.arrayContaining([
      { bucket: 'business-verification', path: 'p1/identity/document-abandoned.jpg' },
      { bucket: 'business-verification', path: 'p1/licence.pdf' },
    ]))
  })

  /**
   * ⛔ ONE PAGE IS NOT A FOLDER. `list()` returns at most 1,000 entries and says nothing about the
   * rest, and both walks used to ask once and treat the answer as complete — so everything past the
   * thousandth object was silently skipped, at either level. Skipped objects here are identity
   * captures nothing will look for again.
   */
  it('enumerates past the first page, at both levels', async () => {
    h.ownedTop = [{ id: null, name: 'identity' }, ...Array.from({ length: 1200 }, (_, i) => ({ id: `t${i}`, name: `top-${i}.pdf` }))]
    h.ownedIdentity = Array.from({ length: 1500 }, (_, i) => ({ id: `d${i}`, name: `capture-${i}.jpg` }))
    await eraseAccount('p1', { kind: 'self' })
    const owned = h.tombstones.filter((t) => t.bucket === 'business-verification')
    expect(owned).toEqual(expect.arrayContaining([
      { bucket: 'business-verification', path: 'p1/top-1199.pdf' },
      { bucket: 'business-verification', path: 'p1/identity/capture-1499.jpg' },
    ]))
    // 1200 top-level files + 1500 captures, plus the two paths the rows named (deduped by path).
    expect(owned.length).toBeGreaterThanOrEqual(2700)
  })

  it('a failed private-prefix walk is logged but does NOT hold back the auth-user delete', async () => {
    // Unlike the desk listing, nothing about removing the auth user destroys the ability to find
    // these objects again — the prefix is the person's id, and that does not change.
    h.ownedListError = true
    const r = await eraseAccount('p1', { kind: 'self' })
    expect(r.ok).toBe(true)
    expect(h.authDeletes).toBe(1)
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
