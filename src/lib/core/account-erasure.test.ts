import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Apple rollout flag is stubbed per test; reset only it (the file stubs other env once, at load).
afterEach(() => { vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '') })

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
  /** The teacher's private row (2026-10-07): a CV and a private intro video, both objects the cascade would orphan. */
  teacherPrivate: null as null | { cvPath: string | null; videoPath: string | null },
  /** Make the PRIVATE verification bucket's prefix walk fail, independently of the desk's. */
  ownedListError: false,
  /** Entries the private verification bucket reports under `p1/` — enough to need paging. */
  ownedTop: [] as Array<{ id: string | null; name: string }>,
  ownedIdentity: [] as Array<{ id: string | null; name: string }>,
  authDeletes: 0,
  /** GoTrue's answer to the auth-user DELETE, and what else happens while it runs (a sign-in storing a token). */
  authDeleteStatus: 200,
  /** …and its body: GoTrue's own 404 says user_not_found; a gateway's 404 does not (isGoTrueUserNotFound). */
  authDeleteBody: {} as unknown,
  duringAuthDelete: null as null | (() => void),
  /** ⛔ C1: the process dies right AFTER the erasure's transaction commits — before anything that follows it. */
  crashAfterCommit: false,
  /** Writes the transaction made, applied on COMMIT and dropped on ROLLBACK (the mock $transaction below). */
  pendingTx: [] as Array<() => void>,
  txFails: false,
  /**
   * Sign in with Apple (2026-10-08). public.apple_siwa_token in memory (active: queuedAt null), GoTrue's identity answer,
   * and each client's settle outcome — Apple itself is settleQueuedTokens' business (apple-siwa.test.ts), so here it is
   * one answer per client.
   */
  appleRows: [] as Array<{ userId: string; clientId: string; appleSub: string; queuedAt: Date | null; nextAttemptAt: Date | null }>,
  appleMissingTable: false,
  appleQueueTxFails: false,
  appleIdentity: 'none' as 'apple' | 'none' | 'unknown',
  appleConfigured: false,
  appleOutcome: new Map<string, 'revoked' | 'manual' | 'retried'>(),
  appleSettleThrows: false,
  appleSweepFails: false,
  appleQueueTx: null as unknown,
  settleCalls: [] as Array<{ target: { userId: string; appleSub: string; clientIds: string[] }; opts: { liveCheck: boolean; deadline?: number } }>,
  /** What GoTrue's identity read does besides answering — e.g. take its time (O3: it counts against the Apple budget). */
  duringIdentityRead: null as null | (() => void),
  /** A settle every row of which is 'skipped' (settled elsewhere — the daily retry — or re-activated meanwhile). */
  appleSettleSkips: false,
  /** appleStatusAfterErasure's two questions: GoTrue's word on the auth user, and the daily retry's queue. */
  authUser: 'gone' as 'present' | 'gone' | 'unknown',
  queuedLeft: false as boolean | null,
}))

vi.mock('server-only', () => ({}))
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')
vi.stubGlobal('fetch', vi.fn(async () => {
  h.duringAuthDelete?.()
  h.events.push('auth-user-deleted'); h.authDeletes++
  return { ok: h.authDeleteStatus >= 200 && h.authDeleteStatus < 300, status: h.authDeleteStatus, json: async () => h.authDeleteBody } as Response
}))
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
    teacherPrivate: { findFirst: async () => h.teacherPrivate },
  }
  return {
    db: {
      profile: { findUnique: async () => h.profile },
      seller: { findUnique: async () => h.seller },
      report: { count: async () => h.openReports },
      $transaction: async (fn: (t: typeof tx) => Promise<void>, _opts?: unknown) => {
        h.pendingTx = []
        try {
          await fn(tx)
          if (h.txFails) throw new Error('could not serialize access')
        } catch (e) {
          h.pendingTx = [] // ROLLBACK: nothing the transaction wrote survives
          throw e
        }
        for (const apply of h.pendingTx) apply() // COMMIT
        h.pendingTx = []
        h.events.push('committed')
        if (h.crashAfterCommit) throw new Error('SIGKILL right after COMMIT')
      },
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
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))
vi.mock('@/lib/auth/apple-siwa', async (importOriginal) => {
  // The real 404 reading — one implementation, tested in apple-siwa.test.ts; everything else here is a stand-in.
  const { isGoTrueUserNotFound } = await importOriginal<typeof import('@/lib/auth/apple-siwa')>()
  const key = (r: { userId: string; clientId: string; appleSub: string }) => ({ userId: r.userId, clientId: r.clientId, appleSub: r.appleSub })
  return {
    isGoTrueUserNotFound,
    APPLE_MIN_CALL_MS: 1_000,
    appleIdentityState: async () => { h.duringIdentityRead?.(); return h.appleIdentity },
    // Apple on offer (the flag) or configured on this server (h.appleConfigured) — the real one is tested in apple-siwa.test.ts.
    appleOnOffer: () => (process.env.NEXT_PUBLIC_APPLE_SIGNIN ?? '') !== '' || h.appleConfigured,
    authUserState: async () => h.authUser,
    hasQueuedTokens: async () => h.queuedLeft,
    // Inside the erasure's transaction: what it queues takes effect on COMMIT only (h.pendingTx).
    queueTokensForErasure: async (tx: unknown, userId: string) => {
      h.events.push('apple-queue')
      h.appleQueueTx = tx
      if (h.appleMissingTable) return { keys: [], missingTable: true, failed: false }
      if (h.appleQueueTxFails) return { keys: [], missingTable: false, failed: true }
      const mine = h.appleRows.filter((r) => r.userId === userId && !r.queuedAt)
      h.pendingTx.push(() => { for (const r of mine) { r.queuedAt = new Date(); r.nextAttemptAt = new Date(Date.now() + 86_400_000) } })
      return { keys: mine.map(key), missingTable: false, failed: false }
    },
    queueUnsettledTokens: async (userId: string) => {
      h.events.push('apple-sweep')
      if (h.appleSweepFails) throw new Error('db down')
      const mine = h.appleRows.filter((r) => r.userId === userId && !r.queuedAt)
      for (const r of mine) { r.queuedAt = new Date(); r.nextAttemptAt = new Date(Date.now() + 86_400_000) }
      return mine.map(key)
    },
    settleQueuedTokens: async (target: { userId: string; appleSub: string; clientIds: string[] }, opts: { liveCheck: boolean; deadline?: number }) => {
      h.events.push(`apple-settle:${target.appleSub}`)
      h.settleCalls.push({ target, opts })
      if (h.appleSettleThrows) throw new Error('lock timeout')
      if (h.appleSettleSkips) return target.clientIds.map((clientId) => ({ clientId, outcome: 'skipped' }))
      return target.clientIds.map((clientId) => {
        const row = h.appleRows.find((r) => r.userId === target.userId && r.clientId === clientId && r.queuedAt)
        if (!row) return { clientId, outcome: 'skipped' }
        const outcome = h.appleOutcome.get(clientId) ?? 'revoked'
        if (outcome !== 'retried') h.appleRows.splice(h.appleRows.indexOf(row), 1)
        return outcome === 'retried' ? { clientId, outcome, error: 'network' } : { clientId, outcome }
      })
    },
  }
})
/**
 * ⚠️ THE MOCK IS BUCKET-AWARE NOW, AND UNTIL IT WAS THE TWO PREFIX WALKS WERE INDISTINGUISHABLE.
 * `from()` ignored its argument, so the desk bucket and the private verification bucket returned
 * the same listing and a test could not tell which walk had produced a tombstone. It also PAGES:
 * `list` honours `limit`/`offset`, which is the whole point of the walk being paginated.
 */
vi.mock('@/lib/supabase-admin', () => ({
  BUSINESS_VERIFICATION_BUCKET: 'business-verification',
  TEACHER_CVS_BUCKET: 'teacher-cvs',
  TEACHER_VIDEOS_BUCKET: 'teacher-videos',
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

const { APPLE_ERASURE_BUDGET_MS, appleStatusAfterErasure, eraseAccount } = await import('./account-erasure')

beforeEach(() => {
  h.appleConfigured = false
  h.profile = { id: 'p1', avatarUrl: 'https://proj/listings/avatar.webp', enforcementState: 'good_standing', email: 'a@b.c' }
  h.openReports = 0
  h.seller = { id: 's1', avatarUrl: null, bannerUrl: 'https://proj/listings/banner.webp' }
  h.listings = [{ id: 'l1', images: JSON.stringify(['https://proj/listings/1.webp']), video: 'https://proj/listing-videos/1.mp4' }]
  h.identities = [{ id: 'v1', evidence: { documentPath: 'p1/identity/document-1.jpg', selfiePath: 'p1/identity/selfie-1.jpg', decisionInput: { surname: 'DOE' }, checksPassed: ['mrz'], consentVersion: 'identity-v1' } }]
  h.events = []; h.tombstones = []; h.audits = []; h.identityUpdates = []; h.purged = []; h.cleared = []; h.deskListError = false; h.authDeletes = 0
  h.ownedListError = false
  h.teacherPrivate = null
  h.ownedTop = [{ id: null, name: 'identity' }, { id: 'b1', name: 'licence.pdf' }]
  h.ownedIdentity = [{ id: 'i1', name: 'document-1.jpg' }, { id: 'i2', name: 'selfie-1.jpg' }]
  h.authDeleteStatus = 200; h.authDeleteBody = {}; h.duringAuthDelete = null; h.crashAfterCommit = false; h.pendingTx = []; h.txFails = false
  h.appleRows = []; h.appleMissingTable = false; h.appleQueueTxFails = false; h.appleIdentity = 'none'
  h.appleOutcome = new Map(); h.appleSettleThrows = false; h.appleSweepFails = false; h.appleQueueTx = null; h.settleCalls = []
  h.duringIdentityRead = null; h.appleSettleSkips = false; h.authUser = 'gone'; h.queuedLeft = false
})

describe('eraseAccount', () => {
  it('a teacher: the CV and a private intro video are queued with the other private objects', async () => {
    h.teacherPrivate = { cvPath: 'tp1/cv-1.pdf', videoPath: 'p1/aaaaaaaa-0000-4000-8000-000000000000.mp4' }
    expect((await eraseAccount('p1', { kind: 'self' })).ok).toBe(true)
    expect(h.tombstones).toEqual(expect.arrayContaining([
      { bucket: 'teacher-cvs', path: 'tp1/cv-1.pdf' },
      { bucket: 'teacher-videos', path: 'p1/aaaaaaaa-0000-4000-8000-000000000000.mp4' },
    ]))
  })

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
    // rows first (tombstones + audit inside), then the desk's objects, then the PRIVATE verification prefix, then the
    // auth user (whose cascade takes the visa rows), then the fast-path purge. Apple's token rows are queued INSIDE the
    // transaction (none here, so nothing is settled), and swept once more after the auth user is gone.
    expect(h.events).toEqual(['listings-deleted', 'seller-deleted', 'tombstoned', 'audited', 'apple-queue', 'profile-deleted', 'committed', 'tombstoned', 'tombstoned', 'auth-user-deleted', 'apple-sweep', 'purged', 'cleared'])
    expect(r.ok && r.apple).toBe('none')
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

  /**
   * ⛔ THE CORRECTION LOG IS PII AND IS NEWER THAN THIS FUNCTION. review.ts appends who changed
   * which field, from what value to what — the person's nationality and residence in plain text,
   * plus a free-text reason. Keeping it would leave an erased record still able to answer "where
   * did they live". The tamper-evident record of the correction lives in complianceAudit and
   * deliberately carries no values.
   */
  it('⛔ DROPS THE CORRECTION LOG AND EVERY NATIONALITY KEY — they hold the codes in plain text', async () => {
    h.identities = [{ id: 'v1', evidence: {
      checksPassed: ['mrz'],
      consentVersion: 'identity-v1',
      // Written by the APPROVE path (withNationality) — the keys a fixed destructure missed.
      nationalitySource: 'reviewer',
      nationalityBefore: 'NOR',
      nationalityAfter: 'SWE',
      nationalitySetBy: 'desk@eno.vn',
      nationalitySetAt: '2026-09-09T00:00:00.000Z',
      // Written by service.ts when the MRZ nationality was unreadable.
      nationalitySuggested: 'DEU',
      nationalitySuggestedFrom: 'mrz_issuing_state',
      // Written by the CORRECTION path — codes plus a free-text reason.
      corrections: [{ nationalityBefore: null, nationalityAfter: 'SWE', by: 'desk@eno.vn', note: 'passport page 2' }],
    } }]
    await eraseAccount('p1', { kind: 'self' })
    expect(h.identityUpdates[0].evidence).toEqual({ checksPassed: ['mrz'], consentVersion: 'identity-v1' })
    expect(JSON.stringify(h.identityUpdates[0].evidence)).not.toContain('SWE')
  })
})

/**
 * SIGN IN WITH APPLE (Guideline 5.1.1(v), TN3194; plan §7.11, D9). The kept tokens are QUEUED inside the erasure's
 * transaction (so the daily retry owns them from the commit on, whatever happens next — C1), settled at once after the
 * commit and before GoTrue's DELETE (one locked unit per Apple ID: every row checked, then the valid ones revoked), and
 * swept once more after the DELETE (C2); Apple never blocks the erasure.
 */
describe('eraseAccount — Sign in with Apple', () => {
  // Apple is on offer in these tests unless one says otherwise (the identity read only happens then — round 6).
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios') })

  it('⛔ a rollback of the flag still finds an earlier Apple user, once Apple is configured on this server (round 7)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    h.appleConfigured = true
    h.appleIdentity = 'apple'
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
  })

  it('⛔ flag empty and Apple not configured (the dark deploy before install): GoTrue is never asked about Apple identities', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    let asked = 0
    h.duringIdentityRead = () => { asked++ }
    h.appleIdentity = 'apple'
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'none' })
    expect(asked).toBe(0)
    h.duringIdentityRead = null
  })

  const row = (clientId: string, o: Partial<{ userId: string; appleSub: string }> = {}) =>
    ({ userId: o.userId ?? 'p1', clientId, appleSub: o.appleSub ?? '001.abc', queuedAt: null as Date | null, nextAttemptAt: null as Date | null })
  /** Rows of p1, all ACTIVE (an account holds them). */
  const tokens = (...clients: string[]) => { h.appleRows = clients.map((c) => row(c)) }
  const activeRows = () => h.appleRows.filter((r) => !r.queuedAt)

  it('queued INSIDE the transaction (on its own tx), before the profile row goes; settled after the commit, before the auth user; swept after it', async () => {
    tokens('vn.eno.web', 'vn.eno.app')
    h.appleIdentity = 'apple'
    const r = await eraseAccount('p1', { kind: 'self' })
    expect(r).toMatchObject({ ok: true, apple: 'revoked' })
    const at = (e: string) => h.events.indexOf(e)
    expect(at('apple-queue')).toBeLessThan(at('profile-deleted'))
    expect(at('profile-deleted')).toBeLessThan(at('committed'))
    expect(at('committed')).toBeLessThan(at('apple-settle:001.abc'))
    expect(at('apple-settle:001.abc')).toBeLessThan(at('auth-user-deleted'))
    expect(at('auth-user-deleted')).toBeLessThan(at('apple-sweep'))
    // the transaction object, not the client: the queue commits or rolls back WITH the erasure
    expect(h.appleQueueTx).toBeTruthy()
    expect(h.appleQueueTx).not.toBe((await import('@/lib/db')).db)
    // ⛔ both clients' rows as ONE unit — checked together, then revoked (they share one grouped authorization) —
    // and without the retry's live-account check, which the erased account itself would answer.
    expect(h.settleCalls).toEqual([{ target: { userId: 'p1', appleSub: '001.abc', clientIds: ['vn.eno.web', 'vn.eno.app'] }, opts: { liveCheck: false, deadline: expect.any(Number) } }])
    expect(h.appleRows).toEqual([])
  })

  // ⛔ C1 (codex, commit gate 2026-10-08): the profile's deletion committed BEFORE anything queued or revoked the Apple
  // rows; a process killed in between left them active — queued_at NULL, which the retry never selects — for good.
  it('⛔ C1: a process killed right AFTER the commit leaves every token QUEUED for the daily retry — none active', async () => {
    tokens('vn.eno.web', 'vn.eno.app')
    h.appleRows.push(row('vn.eno.web', { userId: 'someone-else' }))
    h.crashAfterCommit = true
    await expect(eraseAccount('p1', { kind: 'self' })).rejects.toThrow('SIGKILL')
    // Nothing after the commit ran: no revocation, no auth-user DELETE, no sweep…
    expect(h.events.filter((e) => e.startsWith('apple-settle') || e === 'apple-sweep' || e === 'auth-user-deleted')).toEqual([])
    // …and still no row of the erased account is active: each is queued, due within a day — the retry's.
    const mine = h.appleRows.filter((r) => r.userId === 'p1')
    expect(mine).toHaveLength(2)
    for (const r of mine) {
      expect(r.queuedAt).toBeInstanceOf(Date)
      expect(r.nextAttemptAt!.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000)
    }
    expect(h.appleRows.find((r) => r.userId === 'someone-else')!.queuedAt).toBeNull() // only this account's
  })

  it('a transaction that FAILS queues nothing: the account is not erased, and its tokens stay active', async () => {
    tokens('vn.eno.web')
    h.txFails = true
    await expect(eraseAccount('p1', { kind: 'self' })).rejects.toThrow('could not serialize')
    expect(activeRows()).toHaveLength(1)
    expect(h.events).not.toContain('apple-settle:001.abc')
  })

  it('already dead beside one revoked here (an earlier authorization) → revoked; only dead → manual', async () => {
    tokens('vn.eno.web', 'vn.eno.app')
    h.appleOutcome.set('vn.eno.web', 'manual')
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'revoked' })
    tokens('vn.eno.app')
    h.appleOutcome = new Map([['vn.eno.app', 'manual']])
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
  })

  it('Apple cannot take it now → queued (the row stays the retry\'s); queued outranks revoked and dead', async () => {
    tokens('vn.eno.web')
    h.appleOutcome.set('vn.eno.web', 'retried')
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'queued' })
    expect(h.appleRows).toHaveLength(1)
    expect(h.appleRows[0].queuedAt).toBeInstanceOf(Date)
    expect(h.authDeletes).toBe(1)
    tokens('a', 'b', 'c')
    h.appleOutcome = new Map([['b', 'retried'], ['c', 'manual']])
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ apple: 'queued' })
  })

  it('the settle itself failing (the database, a lock timeout) leaves the rows queued → queued; the erasure completes', async () => {
    tokens('vn.eno.web', 'vn.eno.app')
    h.appleSettleThrows = true
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'queued' })
    expect(h.appleRows.every((r) => r.queuedAt)).toBe(true)
    expect(h.authDeletes).toBe(1)
  })

  it('one unit per Apple ID: rows of two Apple IDs are two settles', async () => {
    h.appleRows = [row('vn.eno.web'), row('vn.eno.app', { appleSub: '002.other' })]
    await eraseAccount('p1', { kind: 'self' })
    expect(h.settleCalls.map((c) => [c.target.appleSub, c.target.clientIds])).toEqual([['001.abc', ['vn.eno.web']], ['002.other', ['vn.eno.app']]])
  })

  // ⛔ C2 (codex, commit gate 2026-10-08): the sweep ran BEFORE GoTrue's DELETE. Until that DELETE the account can still
  // sign in elsewhere, and a sign-in stores its token at its END — so one landing during the DELETE stayed ACTIVE with no
  // account behind it and no foreign key to cascade it: never revoked.
  describe('⛔ C2: no active row outlives the account', () => {
    it('a sign-in that stores a token WHILE the auth user is being deleted is queued once the user is gone → queued', async () => {
      tokens('vn.eno.web')
      h.duringAuthDelete = () => { h.appleRows.push(row('vn.eno.app')) } // storeAppleToken, landing mid-DELETE
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'queued' })
      expect(activeRows()).toEqual([])
      expect(h.events.indexOf('apple-sweep')).toBeGreaterThan(h.events.indexOf('auth-user-deleted'))
    })

    it('GoTrue answering its own 404 (user_not_found: already gone) sweeps too', async () => {
      h.authDeleteStatus = 404
      h.authDeleteBody = { code: 404, error_code: 'user_not_found', msg: 'User not found' }
      h.duringAuthDelete = () => { h.appleRows.push(row('vn.eno.app')) }
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'queued' })
      expect(activeRows()).toEqual([])
    })

    // ⛔ Verifier, 2026-10-09: any 404 read as "gone". A gateway's "no route" (or a wrong base URL) also answers 404 —
    // and then the auth user was NOT deleted, so a row re-activated meanwhile is a live sign-in's, as when GoTrue refuses.
    it('a 404 that is not GoTrue\'s (the gateway\'s "no Route matched", an empty body): the auth user is kept — no sweep', async () => {
      for (const body of [{ message: 'no Route matched with those values' }, {}, { code: 404, error_code: 'validation_failed', msg: 'user_id must be an UUID' }]) {
        h.events = []; h.appleRows = []
        h.authDeleteStatus = 404
        h.authDeleteBody = body
        h.duringAuthDelete = () => { h.appleRows.push(row('vn.eno.web')) }
        await eraseAccount('p1', { kind: 'self' })
        expect(h.events, JSON.stringify(body)).not.toContain('apple-sweep')
        expect(activeRows().map((r) => r.clientId)).toEqual(['vn.eno.web'])
      }
    })

    it('the auth user KEPT (the desk queue failed, or GoTrue refused): no sweep — a row re-activated then is a live sign-in', async () => {
      h.deskListError = true
      h.appleRows = [row('vn.eno.app')]
      h.appleOutcome.set('vn.eno.app', 'revoked')
      await eraseAccount('p1', { kind: 'self' })
      expect(h.events).not.toContain('apple-sweep')
      h.deskListError = false
      h.authDeleteStatus = 500
      h.duringAuthDelete = () => { h.appleRows.push(row('vn.eno.web')) }
      await eraseAccount('p1', { kind: 'self' })
      expect(h.events.filter((e) => e === 'apple-sweep')).toEqual([])
      expect(activeRows().map((r) => r.clientId)).toEqual(['vn.eno.web'])
    })

    it('the transaction\'s hand-over failed (rolled back to its savepoint): the rows are handed over after the commit, then settled', async () => {
      tokens('vn.eno.web')
      h.appleQueueTxFails = true
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'revoked' })
      expect(h.events.indexOf('apple-sweep')).toBeLessThan(h.events.indexOf('apple-settle:001.abc'))
      expect(h.appleRows).toEqual([])
    })

    it('…and when that fails too, nobody will retry them: only the person can act → manual (the erasure still completes)', async () => {
      tokens('vn.eno.web')
      h.appleQueueTxFails = true
      h.appleSweepFails = true
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
      expect(h.authDeletes).toBe(1)
    })
  })

  it('a missing token table is tolerated (no settle, no sweep): an Apple identity with no token is manual, anyone else none', async () => {
    h.appleMissingTable = true
    tokens('vn.eno.web')
    h.appleIdentity = 'apple'
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
    expect(h.events.some((e) => e.startsWith('apple-settle') || e === 'apple-sweep')).toBe(false)
    h.appleIdentity = 'none'
    expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'none' })
  })

  // ⛔ C1 (codex, commit gate round 2): with no token kept, GoTrue unreachable at the deletion and a REAL address shared
  // through Apple (not Hide My Email), the status was `none` — no "remove eno in your Apple Account" notice for an Apple
  // user whose authorization stays. It fails toward the notice now: `none` only when proven.
  describe('⛔ C1 — fail toward the notice: `none` only when GoTrue PROVED there is no Apple identity', () => {
    it('GoTrue unreachable (unknown), no token kept, a shared real address → manual (this build offers Apple)', async () => {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
      h.appleIdentity = 'unknown'
      expect(h.profile!.email).toBe('a@b.c')
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
      h.profile = { ...h.profile!, email: 'abc@privaterelay.appleid.com' }
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
      h.profile = { ...h.profile!, email: null }
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
    })

    it('…and with no token TABLE either, once the build offers Apple', async () => {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
      h.appleMissingTable = true
      h.appleIdentity = 'unknown'
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'manual' })
    })

    // ⛔ Round 4 (opus): where nobody can have used Apple — the dark deploy, eno.forum — a GoTrue blip at deletion must
    // not tell a Google or email user to "remove eno in your Apple Account".
    it('⛔ flag empty (dark deploy / eno.forum): unknown identity, no rows, no other signal → none', async () => {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
      h.appleIdentity = 'unknown'
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'none' })
      h.appleMissingTable = true
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'none' })
      // …but any real signal still adds the notice
      h.profile = { ...h.profile!, email: 'abc@privaterelay.appleid.com' }
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ apple: 'manual' })
    })

    it('a relay address is a signal even when GoTrue lists no Apple identity', async () => {
      h.appleIdentity = 'none'
      h.profile = { ...h.profile!, email: 'abc@private.icloud.com' }
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ apple: 'manual' })
    })

    it('token rows found but settled elsewhere meanwhile (every row skipped) → manual, not none', async () => {
      tokens('vn.eno.web')
      h.appleIdentity = 'none'
      h.appleSettleSkips = true
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ apple: 'manual' })
    })

    it('the caller\'s own signal — the verified session names Apple — adds the notice; it never removes one', async () => {
      h.appleIdentity = 'none'
      expect(await eraseAccount('p1', { kind: 'self' }, { appleLinked: true })).toMatchObject({ apple: 'manual' })
      expect(await eraseAccount('p1', { kind: 'self' }, { appleLinked: false })).toMatchObject({ apple: 'none' })
      tokens('vn.eno.web')
      expect(await eraseAccount('p1', { kind: 'self' }, { appleLinked: false })).toMatchObject({ apple: 'revoked' })
    })

    it('proven: GoTrue lists the providers, none is Apple, no token, a real address, no signal → none', async () => {
      h.appleIdentity = 'none'
      expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'none' })
    })
  })

  // ⛔ O3 (opus, commit gate round 2): the request path's Apple work — a 5 s identity read, then a settle that could wait
  // 10 s for a connection, 25 s for the lock and 4 × 5 s for Apple — could run close to a minute. One budget now.
  describe('⛔ O3 — the Apple work on the request path has one budget', () => {
    it('the settle is handed what the identity read left of APPLE_ERASURE_BUDGET_MS as its deadline', async () => {
      tokens('vn.eno.web')
      let clock = 1_000_000
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      try {
        h.duringIdentityRead = () => { clock += 2_000 } // GoTrue took 2 s
        expect(APPLE_ERASURE_BUDGET_MS).toBeGreaterThanOrEqual(8_000)
        expect(APPLE_ERASURE_BUDGET_MS).toBeLessThanOrEqual(10_000)
        await eraseAccount('p1', { kind: 'self' })
        expect(h.settleCalls[0].opts).toMatchObject({ liveCheck: false, deadline: 1_002_000 + APPLE_ERASURE_BUDGET_MS - 2_000 })
      } finally {
        now.mockRestore()
      }
    })

    it('no time left once GoTrue answered: no settle is started — the rows stay queued for the daily retry → queued', async () => {
      tokens('vn.eno.web', 'vn.eno.app')
      h.appleIdentity = 'apple'
      let clock = 1_000_000
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      try {
        h.duringIdentityRead = () => { clock += APPLE_ERASURE_BUDGET_MS - 500 }
        expect(await eraseAccount('p1', { kind: 'self' })).toMatchObject({ ok: true, apple: 'queued' })
      } finally {
        now.mockRestore()
      }
      expect(h.settleCalls).toEqual([])
      expect(h.appleRows.map((r) => !!r.queuedAt)).toEqual([true, true])
      expect(h.authDeletes).toBe(1) // the erasure itself goes on
    })
  })

  // ⛔ O3: a retry of a deletion that had succeeded — the account gone — answered 401 "sign in again". The route answers
  // ok on proof; this is the proof's second half and the status it can still give.
  describe('appleStatusAfterErasure — a repeated deletion request', () => {
    const session = (o: Partial<{ appleLinked: boolean; email: string | null }> = {}) => ({ appleLinked: false, email: 'a@b.c', ...o })
    it('null unless GoTrue itself says the auth user is gone', async () => {
      for (const state of ['present', 'unknown'] as const) {
        h.authUser = state
        expect(await appleStatusAfterErasure('p1', session({ appleLinked: true })), state).toBeNull()
      }
    })
    it('gone: rows still queued → queued; the queue unreadable → manual; the session naming Apple or a relay → manual; else none', async () => {
      h.queuedLeft = true
      expect(await appleStatusAfterErasure('p1', session())).toBe('queued')
      h.queuedLeft = null
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
      expect(await appleStatusAfterErasure('p1', session())).toBe('manual') // the queue unreadable, Apple on offer
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
      expect(await appleStatusAfterErasure('p1', session())).toBe('none') // ⛔ round 4: no Apple on offer, no signal
      h.queuedLeft = false
      expect(await appleStatusAfterErasure('p1', session({ appleLinked: true }))).toBe('manual')
      expect(await appleStatusAfterErasure('p1', session({ email: 'z@privaterelay.appleid.com' }))).toBe('manual')
      expect(await appleStatusAfterErasure('p1', session())).toBe('none')
    })
  })

  it('the investigation hold still refuses before any Apple call', async () => {
    h.openReports = 1
    tokens('vn.eno.web')
    expect(await eraseAccount('p1', { kind: 'self' })).toEqual({ ok: false, code: 'under_review' })
    expect(h.events).toEqual([])
    expect(activeRows()).toHaveLength(1)
  })
})
