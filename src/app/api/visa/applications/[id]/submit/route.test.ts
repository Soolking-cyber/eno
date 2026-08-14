import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentProfile } from '@/lib/admin'

/**
 * WS6 EXECUTABLE COVERAGE FOR THE TWO CAS-GUARDED VISA ROUTES.
 *
 * `docs/ws6-route-migration.md` names these two as migrated on READING alone:
 * `POST /api/visa/applications/[id]/submit` and `DELETE /api/visa/applications/[id]`. That doc also
 * records what reasoning-without-a-test already cost this workstream — a code emitted through a
 * VARIABLE (`throw new ApiError(code)`) entered the error union and was reported stale while the
 * route emitted it on every request. So this file asserts the WIRE: **status code AND the exact
 * response body**, branch by branch, enumerated from each route's own header block.
 *
 * ⚠️ WHY BOTH ROUTES LIVE IN ONE FILE. They were migrated together, they share one fake Supabase
 * client, and the interesting property is the same in both: a COMPARE-AND-SWAP that must LOSE to a
 * concurrent change (`.eq('status',…).eq('updated_at',…)` on submit, `.in('status',…).is('paid_at',
 * null)` on delete). `src/app/api/notifications/read/route.test.ts` is the precedent for one WS6
 * guard file covering the routes of one migration.
 *
 * ⚠️ THE FILE IS `route.test.ts` NEXT TO A `.svc.ts`, which is the existing convention —
 * `src/app/api/cron/visa-retention/route.test.ts` tests `route.svc.ts` from exactly this position.
 *
 * ⚠️⚠️ EVERY DATA MODULE IS MOCKED **BY NAME**, INCLUDING THE ONES THIS IMPORT GRAPH WOULD REACH
 * ONLY TRANSITIVELY. These routes hand-decrypt and hard-DELETE live applicant PII: a real
 * `getVisaDb()` here would issue `DELETE FROM visa_applications` against production. Mocking
 * `@/lib/supabase-admin` alone would technically neuter `getVisaDb()` (it builds its client through
 * it — `src/lib/visa/db.ts:9`), and that is precisely the transitive safety a reviewer rejected on
 * `handler.cron.test.ts`: it evaporates the day someone gives `getVisaDb()` its own `createClient`,
 * silently, with every assertion still green. So the destructive modules are named here where a
 * reader sees them: `@/lib/visa/db`, `@/lib/visa/storage`, `@/lib/supabase-admin`, `@/lib/db`.
 */

type Row = Record<string, any>

/** One recorded PostgREST call: the table, the verb, the update payload and every filter. */
type Query = {
  table: string
  op: 'select' | 'update' | 'delete' | 'insert'
  payload?: Row
  filters: Array<[string, string, unknown]>
  terminal?: 'maybeSingle' | 'single' | 'await'
  columns?: string
}

const NOW = '2026-08-06T09:00:00.000Z'
const APP_ID = '11111111-1111-4111-8111-111111111111'

/**
 * ⚠️ THE CONSENT VERSION STRINGS, WRITTEN OUT BY HAND rather than imported from
 * `@/lib/visa/schema`. These two literals are the LEGAL RECORD of which declaration text the
 * applicant accepted and which authorization they granted; importing the constants would assert
 * only "the route wrote whatever the route imports", which stays green if the column is dropped
 * from the payload entirely. If a version is deliberately bumped, this file is supposed to fail.
 */
const DECLARATION_VERSION = 'evisa-applicant-declaration-2026-07-24'
const AUTHORIZATION_VERSION = 'eno-hosted-prefill-authorization-2026-07-24'

const h = vi.hoisted(() => ({
  /**
   * ⚠️ A SPY, NOT A CONVENIENCE. `auth: 'userId'` and `auth: 'profile'` resolve the SAME id here,
   * so no response assertion anywhere in this file can tell the two modes apart — and the swap is
   * a one-word edit. `profile` would add an unwrapped DB read, the presence heartbeat, and
   * `ensureProfile()`'s IRREVERSIBLE guest-Seller auto-claim to a consent-stamping submission and
   * to a hard delete of applicant PII. The call count is the only evidence, so it is recorded.
   */
  getCurrentProfile: vi.fn(async (): Promise<{ id: string } | null> => null),
  state: {
    userId: 'user-1' as string | null,
    cryptoReady: true,
    rateOk: true,
    rateCalls: [] as Row[],
    /** The row `visa_applications` SELECT answers with. */
    application: null as Row | null,
    documents: [] as Row[],
    events: [] as Row[],
    /** What `validateVisaForReview` reports. */
    issues: [] as string[],
    paymentsConfigured: false,
    /**
     * Which deployment answers. Services CHARGES; the marketplace intermediates.
     * ⚠️ DEFAULTS TO THE MARKETPLACE, and the reason is that most of this file is about the CAS,
     * the consent stamp and the auth shape — mechanics that need the submission to be ALLOWED. On
     * the services edition an unpaid `send_for_review` is refused by design, so a services default
     * would make every mechanics test assert a 402/503 instead of the thing it was written for.
     * The three tests that are actually about the fee gate set this to true themselves.
     */
    isServices: false,
    /** Is this case answered by THIS deployment's visa desk? See the cross-edition guard. */
    caseOnLocalDesk: true,
    canonicalListingId: 'listing-1' as string | null,
    /** A racing writer moved the row: the CAS'd UPDATE matches nothing. */
    updateCasMiss: false,
    updateError: null as Row | null,
    /** The `visa_payments` paid-row probe. */
    paidRow: null as Row | null,
    paidRowError: null as Row | null,
    /** A racing writer moved the row: the CAS'd DELETE matches nothing. */
    deleteCasMiss: false,
    deleteError: null as Row | null,
    removeThrows: false,
    // recorders
    queries: [] as Query[],
    recordedEvents: [] as Row[],
    removedFiles: [] as string[][],
    /** Interleaved row-delete / file-removal order — the ordering invariant of DELETE. */
    sequence: [] as string[],
  },
}))

/**
 * The fake PostgREST client. Chain methods record; the terminal call (`maybeSingle`, `single`, or
 * awaiting the builder itself) answers from `h.state`. It deliberately understands the CAS: an
 * UPDATE carrying a `status`/`updated_at` filter, or a DELETE carrying `status`/`paid_at`, can be
 * told to match ZERO rows — which is the whole behaviour these routes were written to survive.
 */
function fakeVisaDb() {
  return {
    from(table: string) {
      const q: Query = { table, op: 'select', filters: [] }
      const api: Row = {
        select: (columns: string) => { q.columns = columns; return api },
        update: (payload: Row) => { q.op = 'update'; q.payload = payload; return api },
        insert: (payload: Row) => { q.op = 'insert'; q.payload = payload; return api },
        delete: () => { q.op = 'delete'; return api },
        eq: (c: string, v: unknown) => { q.filters.push(['eq', c, v]); return api },
        in: (c: string, v: unknown) => { q.filters.push(['in', c, v]); return api },
        is: (c: string, v: unknown) => { q.filters.push(['is', c, v]); return api },
        order: (c: string) => { q.filters.push(['order', c, null]); return api },
        limit: (n: number) => { q.filters.push(['limit', '', n]); return api },
        maybeSingle: () => { q.terminal = 'maybeSingle'; return Promise.resolve(answer(q)) },
        single: () => { q.terminal = 'single'; return Promise.resolve(answer(q)) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          q.terminal = 'await'
          return Promise.resolve().then(() => answer(q)).then(res, rej)
        },
      }
      return api
    },
  }
}

const has = (q: Query, column: string) => q.filters.some(([, c]) => c === column)

function answer(q: Query): Row {
  const s = h.state
  s.queries.push(q)
  if (q.table === 'visa_applications') {
    if (q.op === 'select') return { data: s.application, error: null }
    if (q.op === 'update') {
      if (s.updateError) return { data: null, error: s.updateError }
      const cas = has(q, 'status') || has(q, 'updated_at')
      if (cas && s.updateCasMiss) return { data: null, error: null }
      return { data: { ...s.application, ...q.payload }, error: null }
    }
    if (q.op === 'delete') {
      if (s.deleteError) return { data: null, error: s.deleteError }
      if (s.deleteCasMiss) return { data: [], error: null }
      s.sequence.push('row-deleted')
      return { data: [{ id: APP_ID }], error: null }
    }
  }
  if (q.table === 'visa_documents') return { data: s.documents, error: null }
  if (q.table === 'visa_events') {
    if (q.op === 'insert') { s.recordedEvents.push(q.payload as Row); return { error: null } }
    return { data: s.events, error: null }
  }
  if (q.table === 'visa_payments') return { data: s.paidRow, error: s.paidRowError }
  throw new Error(`unexpected table in test: ${q.table}`)
}

// ── the mocks, destructive ones first ────────────────────────────────────────────────────────────
vi.mock('@/lib/visa/db', () => ({ getVisaDb: () => fakeVisaDb(), visaTableMissing: () => false }))
vi.mock('@/lib/visa/storage', () => ({
  VISA_BUCKET: 'visa-documents',
  removeVisaFiles: async (paths: string[]) => {
    if (h.state.removeThrows) throw new Error('visa_storage_remove_failed')
    h.state.removedFiles.push(paths)
    h.state.sequence.push(`files-removed:${paths.join(',')}`)
    return true
  },
}))
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => { throw new Error('supabase is not available in unit tests') },
  LISTING_VIDEOS_BUCKET: 'listing-videos',
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/mail', () => ({ sendMail: async () => true, mailEnabled: () => false }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))

// ⚠️ BOTH MODES STILL BEHAVE IDENTICALLY ON PURPOSE — a mock that made `profile` fail would prove
// nothing about which one the route asked for. `getCurrentProfile` is a spy so the QUESTION the
// wrapper asked is observable, not just the answer it got.
h.getCurrentProfile.mockImplementation(async () => (h.state.userId ? { id: h.state.userId } : null))
vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.state.userId,
  getCurrentProfile: h.getCurrentProfile,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (bucket: string, key: string, limit: number, window: string, opts?: Row) => {
    h.state.rateCalls.push({ bucket, key, limit, window, opts })
    return { success: h.state.rateOk, remaining: 0 }
  },
}))
vi.mock('@/lib/visa/crypto', () => ({
  visaCryptoReady: () => h.state.cryptoReady,
  decryptVisaPayload: () => ({ email: 'applicant@example.com' }),
  encryptVisaPayload: () => 'cipher',
  visaApplicantSnapshotHash: () => 'snapshot-hash',
}))
// ⚠️ THE EDITION IS PART OF THE PAY GATE NOW. vitest pins NEXT_PUBLIC_ENO_EDITION to 'services'
// for the whole run, so without this every case here asserts only the CHARGING deployment's answer
// — and the marketplace's "takes no money, so a fee cannot block a handoff" path would go untested.
vi.mock('@/lib/edition', () => ({ get IS_SERVICES() { return h.state.isServices } }))
// ⚠️ THE CROSS-EDITION GUARD. On the marketplace the fee-free handoff is allowed only for a case
// this deployment's OWN desk answers — otherwise an unpaid eno.forum case could be handed over from
// eno.vn, defeating the forum's pay-before-review gate through the other edition.
vi.mock('@/lib/visa-admin', () => ({ visaCaseOnLocalDesk: async () => h.state.caseOnLocalDesk }))
vi.mock('@/lib/visa/payments', () => ({
  visaPaymentsConfig: () => (h.state.paymentsConfigured ? { provider: 'stripe' } : null),
}))
vi.mock('@/lib/visa/dm-flow', () => ({
  canonicalVisaListingId: async () => h.state.canonicalListingId,
}))
// ⚠️ PARTIAL, not wholesale: `../route.svc.ts` builds `updateSchema` from the REAL
// `visaPayloadSchema` at module scope, so a total stub would change what PATCH validates. Only the
// checklist verdict is steered, because "which issues" is this route's input, not its behaviour.
vi.mock('@/lib/visa/schema', async (orig) => ({
  ...(await orig<typeof import('@/lib/visa/schema')>()),
  validateVisaForReview: () => h.state.issues,
}))

const { POST } = await import('./route.svc')
const { DELETE } = await import('../route.svc')

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

const DOC = {
  id: 'doc-1', application_id: APP_ID, kind: 'passport', storage_path: 'user-1/app/passport-a.jpg',
  mime_type: 'image/jpeg', size_bytes: 1234, width: 600, height: 800, sha256: 'sha',
  validation_status: 'passed', validation_report: { ok: true }, created_at: '2026-07-02T00:00:00.000Z',
}
const SERIALIZED_DOC = {
  id: 'doc-1', kind: 'passport', mimeType: 'image/jpeg', sizeBytes: 1234, width: 600, height: 800,
  validationStatus: 'passed', validationReport: { ok: true }, createdAt: '2026-07-02T00:00:00.000Z',
}

const app = (over: Row = {}): Row => ({
  id: APP_ID, user_id: 'user-1', status: 'draft', encrypted_payload: 'cipher', checklist: [],
  reference: 'EV-1042', conversation_id: 'conv-1',
  selected_listing_id: 'listing-1', selected_entry_type: 'single', selected_speed: 'standard',
  selected_at: '2026-08-01T00:00:00.000Z',
  applicant_confirmation_version: null, applicant_confirmed_at: null, applicant_snapshot_hash: null,
  authorization_version: null, authorized_at: null, authorization_snapshot_hash: null,
  assigned_admin: null, submitted_at: null, resolved_at: null, retention_until: null,
  paid_at: null, payment_provider: null, payment_ref: null,
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  ...over,
})

/**
 * The serialized 200 body, written out by hand rather than borrowed from `serializeVisa()` — an
 * expectation computed by the implementation under test asserts nothing. `events` is absent because
 * neither of these methods passes one and `JSON.stringify` drops `undefined`.
 */
const serialized = (over: Row = {}): Row => ({
  id: APP_ID, status: 'draft', reference: 'EV-1042', payload: { email: 'applicant@example.com' },
  checklist: [], applicantConfirmedAt: null, authorizedAt: null, assignedAdmin: null,
  submittedAt: null, resolvedAt: null, paidAt: null, paymentProvider: null,
  selectedListingId: 'listing-1', selectedEntryType: 'single', selectedSpeed: 'standard',
  selectedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  documents: [SERIALIZED_DOC],
  ...over,
})

const SEND = { action: 'send_for_review', declarationAccepted: true, prefillAuthorized: true }
const APPROVE = { action: 'approve_for_prefill', declarationAccepted: true, prefillAuthorized: true }
const CANCEL = { action: 'cancel' }

async function submit(body?: unknown, id = APP_ID, raw?: string) {
  const req = new Request(`http://test/api/visa/applications/${id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res = await POST(req, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.text(), res }
}

async function del(id = APP_ID) {
  const req = new Request(`http://test/api/visa/applications/${id}`, { method: 'DELETE' })
  const res = await DELETE(req, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.text(), res }
}

const json = (r: { body: string }) => JSON.parse(r.body) as Row
const appQueries = () => h.state.queries.filter((q) => q.table === 'visa_applications')
/**
 * ⚠️ CHILD-TABLE READS, WHICH `appQueries()` DELIBERATELY HIDES. `visa_documents` and `visa_events`
 * are keyed by `application_id`, and the fake `answer()` hands back `h.state.documents` no matter
 * what was filtered — so an UNSCOPED child read is invisible in every response body in this file.
 * On submit that would serialize a stranger's document metadata into the 200; on DELETE
 * `loaded.documents` is what `removeVisaFiles()` is handed, so an unscoped read deletes EVERY
 * applicant's storage objects. The filters are the only place that fact lives.
 */
const childReads = (table: 'visa_documents' | 'visa_events') =>
  h.state.queries.filter((q) => q.table === table && q.op === 'select')
const writes = () => h.state.queries.filter((q) => q.op === 'update' || q.op === 'delete' || q.op === 'insert')

vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(NOW))
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
  const s = h.state
  // ⚠️ RESET THE EDITION. This hook re-seeds fields one by one rather than replacing the object, so
  // a test that opts into the services edition leaks it into every test after it — which is exactly
  // what happened: the two fee-gate cases turned it on and the CAS/consent tests below then asserted
  // a 503 they were never about.
  s.isServices = false
  s.caseOnLocalDesk = true
  s.userId = 'user-1'
  s.cryptoReady = true
  s.rateOk = true
  s.rateCalls = []
  s.application = app()
  s.documents = [DOC]
  s.events = []
  s.issues = []
  s.paymentsConfigured = false
  s.canonicalListingId = 'listing-1'
  s.updateCasMiss = false
  s.updateError = null
  s.paidRow = null
  s.paidRowError = null
  s.deleteCasMiss = false
  s.deleteError = null
  s.removeThrows = false
  s.queries = []
  s.recordedEvents = []
  s.removedFiles = []
  s.sequence = []
  h.getCurrentProfile.mockClear() // mockClear, NOT mockReset — the implementation above must survive
  vi.setSystemTime(new Date(NOW))
})

// ═══ POST /api/visa/applications/[id]/submit ═════════════════════════════════════════════════════

describe('submit — the gate, in the order the header claims', () => {
  it('guest → 401 {"error":"auth_required"}, before ANY data call or limiter call', async () => {
    h.state.userId = null
    const r = await submit(SEND)
    expect(r.status).toBe(401)
    expect(r.body).toBe('{"error":"auth_required"}')
    // A wrapper that authenticated after running the handler would satisfy the status alone.
    expect(h.state.queries).toEqual([])
    expect(h.state.rateCalls).toEqual([])
  })

  it('no encryption key → 503 {"error":"visa_encryption_not_configured"} — and the LIMITER HAS NOT RUN', async () => {
    // The reason `rateLimit:` could not be hoisted into route(): the wrapper runs its limiter
    // BEFORE the handler, so a key-less host would answer 429 after 20 calls where it answers 503
    // forever today. This asserts the ordering fact, not just the code.
    h.state.cryptoReady = false
    const r = await submit(SEND)
    expect(r.status).toBe(503)
    expect(r.body).toBe('{"error":"visa_encryption_not_configured"}')
    expect(h.state.rateCalls).toEqual([])
    expect(h.state.queries).toEqual([])
  })

  it('a guest on a key-less host still gets the 401 — auth outranks the env gate', async () => {
    h.state.userId = null
    h.state.cryptoReady = false
    expect((await submit(SEND)).body).toBe('{"error":"auth_required"}')
  })

  it('throttled → 429 {"error":"rate_limited"}, on the strict per-user budget', async () => {
    h.state.rateOk = false
    const r = await submit(SEND)
    expect(r.status).toBe(429)
    expect(r.body).toBe('{"error":"rate_limited"}')
    expect(h.state.rateCalls).toEqual([
      { bucket: 'visa-submit', key: 'user-1', limit: 20, window: '1 h', opts: { strict: true } },
    ])
    expect(h.state.queries).toEqual([])
  })

  it.each([
    ['no body at all', undefined],
    ['an empty object', {}],
    ['an unknown action', { action: 'delete_everything' }],
    ['send_for_review without the declaration', { action: 'send_for_review', prefillAuthorized: true }],
    ['send_for_review with declarationAccepted:false', { ...SEND, declarationAccepted: false }],
    ['approve_for_prefill without prefillAuthorized', { action: 'approve_for_prefill', declarationAccepted: true }],
    ['a JSON array', [1, 2, 3]],
    ['literal null', null],
  ])('%s → 400 {"error":"invalid_action"}', async (_label, body) => {
    const r = await submit(body)
    expect(r.status).toBe(400)
    expect(r.body).toBe('{"error":"invalid_action"}')
    expect(h.state.queries).toEqual([])
  })

  it('malformed JSON → 400 {"error":"invalid_action"}, NOT the wrapper\'s `bad_request`', async () => {
    // The route parses its own body (`route()` was given no `body:` schema), so the code stays
    // `invalid_action`. A migration that hoisted the schema would answer `bad_request` here.
    const r = await submit(undefined, APP_ID, '{not json')
    expect(r.status).toBe(400)
    expect(r.body).toBe('{"error":"invalid_action"}')
  })

  it('non-uuid id → 404 {"error":"not_found"} without querying', async () => {
    const r = await submit(SEND, 'not-a-uuid')
    expect(r.status).toBe(404)
    expect(r.body).toBe('{"error":"not_found"}')
    expect(h.state.queries).toEqual([])
  })

  it('unknown case → 404, and the SELECT was scoped to the caller', async () => {
    h.state.application = null
    const r = await submit(SEND)
    expect(r.status).toBe(404)
    expect(r.body).toBe('{"error":"not_found"}')
    // "not there" and "not yours" are deliberately one answer — which only holds if the read
    // carries user_id. Without it this route would serve another applicant's case.
    expect(appQueries()[0].filters).toEqual([['eq', 'id', APP_ID], ['eq', 'user_id', 'user-1']])
    expect(writes()).toEqual([])
  })

  it("someone else's case is a 404 too, not a 403", async () => {
    h.state.application = null // the user_id predicate is what makes it invisible
    h.state.userId = 'stranger'
    expect((await submit(SEND)).body).toBe('{"error":"not_found"}')
    expect(appQueries()[0].filters).toContainEqual(['eq', 'user_id', 'stranger'])
  })
})

describe('submit — cancel', () => {
  it.each(['approved', 'rejected', 'cancelled'])('cancel on a %s case → 409 {"error":"application_locked"}', async (status) => {
    h.state.application = app({ status })
    const r = await submit(CANCEL)
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_locked"}')
    expect(writes()).toEqual([])
  })

  it('cancel on a draft → 200 {application}, stamping a 30-day retention window', async () => {
    const r = await submit(CANCEL)
    expect(r.status).toBe(200)
    expect(json(r)).toEqual({
      application: serialized({ status: 'cancelled', resolvedAt: NOW, updatedAt: NOW }),
    })
    const update = writes()[0]
    expect(update.payload).toEqual({
      status: 'cancelled',
      resolved_at: NOW,
      retention_until: '2026-09-05T09:00:00.000Z', // NOW + 30 days
      updated_at: NOW,
    })
    expect(update.filters).toEqual([['eq', 'id', APP_ID]])
    expect(h.state.recordedEvents).toEqual([{
      id: expect.any(String),
      application_id: APP_ID,
      actor_type: 'applicant',
      actor_ref: 'user-1',
      event: 'application_cancelled',
      metadata: {},
    }])
  })

  it('cancel never runs the checklist — a half-filled case can always be abandoned', async () => {
    h.state.issues = ['passport_missing']
    expect((await submit(CANCEL)).status).toBe(200)
  })
})

describe('submit — send_for_review', () => {
  it('an incomplete case → 400 {"error":"application_incomplete","issues":[…]} — the EXTRA field', async () => {
    // The second reason no `body:`/`apiFail()` hoist could carry this route: `apiFail()` emits
    // exactly `{"error":"<code>"}`, and this branch has a sibling key the form draws from.
    h.state.issues = ['passport_missing', 'portrait_blurry']
    const r = await submit(SEND)
    expect(r.status).toBe(400)
    expect(r.body).toBe('{"error":"application_incomplete","issues":["passport_missing","portrait_blurry"]}')
    // The issues are persisted so the client can re-read them, and nothing transitions.
    const update = writes()[0]
    expect(update.table).toBe('visa_applications')
    expect(update.payload).toEqual({ checklist: ['passport_missing', 'portrait_blurry'], updated_at: NOW })
    /**
     * ⚠️ THE FILTER IS THE WHOLE SAFETY OF THIS WRITE, and it is the only write in either route
     * that carries no CAS. `.update({checklist, updated_at})` with NO filter is a legal PostgREST
     * statement that rewrites EVERY applicant's row — stamping this caller's checklist and
     * `updated_at` across the table, which additionally voids every other case's pending CAS.
     * The payload assertion above cannot see that; a 400 with the right body is what it looks like.
     */
    expect(update.filters).toEqual([['eq', 'id', APP_ID]])
    expect(h.state.recordedEvents).toEqual([])
  })

  it.each(['ready_for_review', 'under_review', 'applicant_approval', 'approved', 'cancelled'])(
    'from %s → 409 {"error":"invalid_status_transition"}', async (status) => {
      h.state.application = app({ status })
      const r = await submit(SEND)
      expect(r.status).toBe(409)
      expect(r.body).toBe('{"error":"invalid_status_transition"}')
      expect(writes()).toEqual([])
    })

  it('no product selected → 409 {"error":"product_not_selected"}', async () => {
    h.state.canonicalListingId = null
    const r = await submit(SEND)
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"product_not_selected"}')
    expect(writes()).toEqual([])
  })

  /**
   * ⚠️ THE 402 IS THE BRANCH THIS SUITE MOST NEEDED. `route()` passes a handler-returned `Response`
   * through UNCHANGED (`handler.ts:244`) — but "unchanged" is exactly the kind of claim that is
   * argued rather than measured, and this is the only NON-200 SUCCESS-SHAPED return in either
   * route: a wrapper that re-wrapped the value would answer 200 and the applicant would be handed
   * a government form they have not paid for.
   */
  it('payments configured + unpaid → 402 {"error":"payment_required_first"} — the status survives the wrapper', async () => {
    h.state.isServices = true // the fee gate only exists where the deployment charges
    h.state.paymentsConfigured = true
    const r = await submit(SEND)
    expect(r.status).toBe(402)
    expect(r.body).toBe('{"error":"payment_required_first"}')
    expect(r.res.headers.get('content-type')).toMatch(/application\/json/)
    expect(writes()).toEqual([])
  })

  it('payments configured + already paid → proceeds (needs_changes resubmit, consent re-stamp)', async () => {
    h.state.isServices = true // the fee gate only exists where the deployment charges
    h.state.paymentsConfigured = true
    h.state.application = app({ status: 'needs_changes', paid_at: '2026-08-02T00:00:00.000Z' })
    const r = await submit(SEND)
    expect(r.status).toBe(200)
    expect(json(r).application).toMatchObject({ status: 'ready_for_review' })
    /**
     * ⚠️ THE CAS FILTERS, NOT JUST THE OUTCOME — and this path is the only one that can catch the
     * mutation. The send CAS reads `.eq('status', app.status)`; hardcoding it to `'draft'` passes
     * every OTHER test in this file, because their fixtures ARE drafts and the approve test pins
     * the other branch. Only a `needs_changes` resubmit distinguishes the variable from the
     * literal — and in production the literal would filter `status='draft'` against a
     * `needs_changes` row, match zero, and hand every applicant a permanent 409
     * `application_status_changed` after an admin asked them for changes.
     */
    expect(writes()[0].filters).toEqual([
      ['eq', 'id', APP_ID],
      ['eq', 'status', 'needs_changes'],
      ['eq', 'updated_at', '2026-08-01T00:00:00.000Z'],
    ])
  })

  /**
   * ⛔ DORMANT MEANS TWO DIFFERENT THINGS AND THE EDITION IS WHAT TELLS THEM APART — this test used
   * to assert only the first half, and that gap was a payment bypass two reviewers found.
   * On the MARKETPLACE there is no fee to owe: the checkout route is `.forum.svc.` and does not
   * exist, so an unpaid handoff is the normal, only path.
   */
  it('marketplace + payments dormant + unpaid → proceeds; there is no fee to owe', async () => {
    h.state.isServices = false
    expect((await submit(SEND)).status).toBe(200)
  })

  /**
   * On the SERVICES edition the same state means the deployment that charges has LOST its payment
   * env — broken, not free. Before this, `IS_SERVICES && visaPaymentsConfig() && !paid_at` skipped
   * the whole check when the config was null and accepted unpaid applications into the queue.
   */
  /**
   * ⛔ THE CROSS-EDITION BYPASS, PINNED. eno.vn and eno.forum share one `visa_applications` table
   * and one auth system, so "this deployment does not charge" must not generalise into "any case
   * reachable from here is free". A forum case handed over from the marketplace would defeat the
   * forum's own pay-before-review gate.
   */
  it('marketplace + a case that is NOT this desk\u2019s → 402, not a free handoff', async () => {
    h.state.isServices = false
    h.state.caseOnLocalDesk = false
    const r = await submit(SEND)
    expect(r.status).toBe(402)
    expect(json(r)).toEqual({ error: 'payment_required_first' })
  })

  it('services + payments dormant → 503, never a free submission', async () => {
    h.state.isServices = true
    const r = await submit(SEND)
    expect(r.status).toBe(503)
    expect(json(r)).toEqual({ error: 'payments_not_configured' })
  })

  it('success → 200 {application}, consent stamped under a CAS on status + updated_at', async () => {
    const r = await submit(SEND)
    expect(r.status).toBe(200)
    expect(json(r)).toEqual({
      application: serialized({
        status: 'ready_for_review', applicantConfirmedAt: NOW, authorizedAt: NOW, updatedAt: NOW,
      }),
    })
    const update = writes()[0]
    /**
     * ⚠️ `toEqual`, NOT `toMatchObject`. This payload IS the consent record, and `toMatchObject`
     * ignores absent keys — dropping `applicant_confirmation_version` (or either snapshot hash)
     * leaves a case that reached the desk with no recorded evidence of WHAT the applicant agreed
     * to, and `serializeVisa` never puts those columns on the wire, so the 200 body is identical.
     * Every key the route writes is enumerated here, so an added one has to be declared too.
     */
    expect(update.payload).toEqual({
      status: 'ready_for_review',
      checklist: [],
      applicant_confirmed_at: NOW,
      applicant_confirmation_version: DECLARATION_VERSION,
      applicant_snapshot_hash: 'snapshot-hash',
      authorized_at: NOW,
      authorization_version: AUTHORIZATION_VERSION,
      authorization_snapshot_hash: 'snapshot-hash',
      last_applicant_action_at: NOW,
      updated_at: NOW,
    })
    /**
     * ⚠️ THE SAFETY PROPERTY, ASSERTED ON THE FILTERS THEMSELVES. The stamped snapshot hash must
     * describe the payload actually under review; the CAS is what makes a racing payload PATCH void
     * this write instead of mis-stamping it. Losing either `.eq` is invisible in a 200.
     */
    expect(update.filters).toEqual([
      ['eq', 'id', APP_ID],
      ['eq', 'status', 'draft'],
      ['eq', 'updated_at', '2026-08-01T00:00:00.000Z'],
    ])
    /**
     * ⚠️ THE EVENT ROW IN FULL. `visa_events` is the audit trail an applicant dispute is decided
     * from, and its `metadata` is the second half of the consent record — which declaration
     * version, which authorization version, and that the official prefill was authorized. Matching
     * `{event, actor_ref}` accepts an event whose metadata is `{}`.
     */
    expect(h.state.recordedEvents).toEqual([{
      id: expect.any(String),
      application_id: APP_ID,
      actor_type: 'applicant',
      actor_ref: 'user-1',
      event: 'sent_for_review',
      metadata: {
        declarationVersion: DECLARATION_VERSION,
        authorizationVersion: AUTHORIZATION_VERSION,
        officialPrefillAuthorized: true,
      },
    }])
  })

  it('the documents read is scoped to THIS case — the 200 body may not carry a stranger\'s metadata', async () => {
    // `serializeVisa(data, docs)` puts `docs` on the wire, and the fake answers `h.state.documents`
    // for ANY visa_documents select — so an unscoped read is invisible in the body. Assert the
    // QUERY the route built.
    await submit(SEND)
    const reads = childReads('visa_documents')
    expect(reads).toHaveLength(1)
    expect(reads[0].filters).toEqual([['eq', 'application_id', APP_ID]])
  })

  it('the submission never resolves a Profile row — `auth: \'userId\'` is not `auth: \'profile\'`', async () => {
    expect((await submit(SEND)).status).toBe(200)
    expect(getCurrentProfile).not.toHaveBeenCalled()
  })

  it('a CAS MISS answers its OWN code — 409 {"error":"application_status_changed"}, never a success', async () => {
    h.state.updateCasMiss = true
    const r = await submit(SEND)
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_status_changed"}')
    // Nothing was stamped and no audit event claims a submission that did not happen.
    expect(h.state.recordedEvents).toEqual([])
  })

  it('a DB error on the CAS update → 500 {"error":"internal_error"} (the accepted WS6 exception)', async () => {
    // `if (sfr.error) throw sfr.error` used to reach Next's default 500 HTML; route() now catches,
    // logs with an `op`, and answers a structured code — never the exception text.
    h.state.updateError = { code: '57014', message: 'statement timeout' }
    const r = await submit(SEND)
    expect(r.status).toBe(500)
    expect(r.body).toBe('{"error":"internal_error"}')
  })
})

describe('submit — approve_for_prefill', () => {
  it.each(['draft', 'needs_changes', 'ready_for_review', 'under_review', 'ready_to_submit'])(
    'from %s → 409 {"error":"invalid_status_transition"}', async (status) => {
      h.state.application = app({ status })
      const r = await submit(APPROVE)
      expect(r.status).toBe(409)
      expect(r.body).toBe('{"error":"invalid_status_transition"}')
      expect(writes()).toEqual([])
    })

  it('from applicant_approval → 200, ready_to_submit, CAS on the status it READ', async () => {
    h.state.application = app({ status: 'applicant_approval' })
    const r = await submit(APPROVE)
    expect(r.status).toBe(200)
    expect(json(r).application).toMatchObject({ status: 'ready_to_submit', authorizedAt: NOW })
    const update = writes()[0]
    /**
     * ⚠️ THE PAYLOAD, NOT ONLY THE FILTERS. This is the second consent stamp — the applicant
     * authorising ENO to prefill the official government form on their behalf — and `serializeVisa`
     * exposes neither confirmation version nor either snapshot hash, so nulling any of them keeps
     * both the 200 body and the filter assertion below intact.
     */
    expect(update.payload).toEqual({
      status: 'ready_to_submit',
      applicant_confirmed_at: NOW,
      applicant_confirmation_version: DECLARATION_VERSION,
      applicant_snapshot_hash: 'snapshot-hash',
      authorized_at: NOW,
      authorization_version: AUTHORIZATION_VERSION,
      authorization_snapshot_hash: 'snapshot-hash',
      last_applicant_action_at: NOW,
      updated_at: NOW,
    })
    expect(update.filters).toEqual([
      ['eq', 'id', APP_ID],
      ['eq', 'status', 'applicant_approval'],
      ['eq', 'updated_at', '2026-08-01T00:00:00.000Z'],
    ])
    expect(h.state.recordedEvents).toEqual([{
      id: expect.any(String),
      application_id: APP_ID,
      actor_type: 'applicant',
      actor_ref: 'user-1',
      event: 'prefill_authorized',
      metadata: { declarationVersion: DECLARATION_VERSION, authorizationVersion: AUTHORIZATION_VERSION },
    }])
  })

  it('a CAS miss here answers 409 {"error":"application_status_changed"} too', async () => {
    h.state.application = app({ status: 'applicant_approval' })
    h.state.updateCasMiss = true
    const r = await submit(APPROVE)
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_status_changed"}')
    expect(h.state.recordedEvents).toEqual([])
  })

  /**
   * ⚠️ THE MIRROR OF `sfr.error`, WHICH ONLY THE SEND ACTION COVERED. `approve.error` and
   * `!approve.data` are two different worlds that reach the same `if` in sequence: without
   * `if (approve.error) throw approve.error`, a connection failure leaves `approve.data` null and
   * falls into the CAS branch — so a write that NEVER RAN answers 409 `application_status_changed`,
   * telling the applicant someone else moved their case. 500 vs 409 is the whole point.
   */
  it('a DB error on the approve CAS → 500 {"error":"internal_error"}, NOT the 409 CAS answer', async () => {
    h.state.application = app({ status: 'applicant_approval' })
    h.state.updateError = { code: '08006', message: 'connection failure' }
    const r = await submit(APPROVE)
    expect(r.status).toBe(500)
    expect(r.body).toBe('{"error":"internal_error"}')
    expect(h.state.recordedEvents).toEqual([])
  })

  it('the checklist gates this action as well', async () => {
    h.state.application = app({ status: 'applicant_approval' })
    h.state.issues = ['passport_missing']
    const r = await submit(APPROVE)
    expect(r.status).toBe(400)
    expect(r.body).toBe('{"error":"application_incomplete","issues":["passport_missing"]}')
  })
})

// ═══ DELETE /api/visa/applications/[id] ══════════════════════════════════════════════════════════

describe('DELETE — the gate', () => {
  it('guest → 401 {"error":"auth_required"}, before the limiter and before any query', async () => {
    h.state.userId = null
    const r = await del()
    expect(r.status).toBe(401)
    expect(r.body).toBe('{"error":"auth_required"}')
    expect(h.state.rateCalls).toEqual([])
    expect(h.state.queries).toEqual([])
  })

  it('throttled → 429 {"error":"rate_limited"} on the exact budget route() was handed', async () => {
    // This is the one method in the migration where the limiter MOVED into the wrapper, so its
    // parameters are now declarative and a typo in them is silent. `strict` is the load-bearing
    // one: a limiter outage must not open a hard delete of applicant PII.
    h.state.rateOk = false
    const r = await del()
    expect(r.status).toBe(429)
    expect(r.body).toBe('{"error":"rate_limited"}')
    expect(h.state.rateCalls).toEqual([
      { bucket: 'visa-delete', key: 'user-1', limit: 10, window: '24 h', opts: { strict: true } },
    ])
    expect(h.state.queries).toEqual([])
  })

  it('non-uuid id → 404 {"error":"not_found"} — AFTER the limiter, which is route()\'s fixed order', async () => {
    const r = await del('not-a-uuid')
    expect(r.status).toBe(404)
    expect(r.body).toBe('{"error":"not_found"}')
    expect(h.state.rateCalls).toHaveLength(1)
    expect(h.state.queries).toEqual([])
  })

  it('unknown or foreign case → 404, the read scoped by user_id', async () => {
    h.state.application = null
    const r = await del()
    expect(r.status).toBe(404)
    expect(r.body).toBe('{"error":"not_found"}')
    expect(appQueries()[0].filters).toEqual([['eq', 'id', APP_ID], ['eq', 'user_id', 'user-1']])
    expect(writes()).toEqual([])
  })
})

describe('DELETE — the three refusal layers', () => {
  it.each(['needs_changes', 'ready_for_review', 'under_review', 'applicant_approval', 'ready_to_submit', 'submitted', 'processing', 'approved', 'rejected'])(
    'guard 1: status %s → 409 {"error":"application_not_deletable"}', async (status) => {
      h.state.application = app({ status })
      const r = await del()
      expect(r.status).toBe(409)
      expect(r.body).toBe('{"error":"application_not_deletable"}')
      expect(writes()).toEqual([])
      expect(h.state.removedFiles).toEqual([])
    })

  it.each(['draft', 'cancelled'])('a %s case is deletable — the allow-list is exactly these two', async (status) => {
    h.state.application = app({ status })
    expect((await del()).status).toBe(200)
  })

  it('guard 2: a PAID draft → 409, refused on the denormalized flag before the payments probe', async () => {
    h.state.application = app({ paid_at: '2026-08-02T00:00:00.000Z' })
    const r = await del()
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_not_deletable"}')
    // visa_payments.application_id is ON DELETE CASCADE, so a deleted paid case takes its
    // financial record with it. Nothing may reach the delete.
    expect(h.state.queries.some((q) => q.table === 'visa_payments')).toBe(false)
    expect(writes()).toEqual([])
  })

  it('guard 3: a PAID payments row on an unpaid-looking draft → 409, probing status=paid for this case', async () => {
    // The heartbeat window of a partial markVisaPaidAndHandoff: the row is captured, paid_at is
    // still null. The source of truth wins.
    h.state.paidRow = { id: 'pay-1' }
    const r = await del()
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_not_deletable"}')
    const probe = h.state.queries.find((q) => q.table === 'visa_payments')!
    expect(probe.filters).toEqual([
      ['eq', 'application_id', APP_ID], ['eq', 'status', 'paid'], ['limit', '', 1],
    ])
    expect(writes()).toEqual([])
  })

  it('a probe FAILURE is 500 {"error":"internal_error"}, never a delete — "could not look" is not "unpaid"', async () => {
    // It throws BEFORE the inner try, so this is route()'s catch (the accepted WS6 exception) and
    // NOT `application_delete_failed`. The two 500s having different codes is the wire fact.
    h.state.paidRowError = { code: '08006', message: 'connection failure' }
    const r = await del()
    expect(r.status).toBe(500)
    expect(r.body).toBe('{"error":"internal_error"}')
    expect(writes()).toEqual([])
  })
})

describe('DELETE — the CAS and the trigger', () => {
  it('success → 200 {"deleted":true,"id":…}, the DELETE re-checking status AND paid_at atomically', async () => {
    const r = await del()
    expect(r.status).toBe(200)
    expect(r.body).toBe(`{"deleted":true,"id":"${APP_ID}"}`)
    const remove = writes()[0]
    expect(remove.op).toBe('delete')
    expect(remove.filters).toEqual([
      ['eq', 'id', APP_ID],
      ['eq', 'user_id', 'user-1'],
      ['in', 'status', ['draft', 'cancelled']],
      ['is', 'paid_at', null],
    ])
  })

  it('removes the files only AFTER the row is gone', async () => {
    await del()
    // Ordering is the invariant: an orphaned object is swept by the retention cron, whereas files
    // removed before a delete that then loses the CAS have destroyed a live case's documents.
    expect(h.state.sequence).toEqual(['row-deleted', 'files-removed:user-1/app/passport-a.jpg'])
    expect(h.state.removedFiles).toEqual([['user-1/app/passport-a.jpg']])
  })

  it('a CAS MISS → 409 {"error":"application_not_deletable"} and NO files are touched', async () => {
    // The case left the deletable set between the read and the delete (a concurrent submit or a
    // payment landing). The delete must miss, and the documents of the now-live case must survive.
    h.state.deleteCasMiss = true
    const r = await del()
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_not_deletable"}')
    expect(h.state.removedFiles).toEqual([])
  })

  it('the DB BEFORE-DELETE trigger (23001) → the same friendly 409, not a 500', async () => {
    h.state.deleteError = { code: '23001', message: 'visa_application_has_paid_payment: case is paid' }
    const r = await del()
    expect(r.status).toBe(409)
    expect(r.body).toBe('{"error":"application_not_deletable"}')
    expect(h.state.removedFiles).toEqual([])
  })

  it('23001 from a DIFFERENT constraint is NOT laundered into the friendly 409', async () => {
    // Both halves of that condition are load-bearing: a restrict violation from some other trigger
    // must not tell the applicant their case is merely "not deletable".
    h.state.deleteError = { code: '23001', message: 'some_other_restrict_violation' }
    const r = await del()
    expect(r.status).toBe(500)
    expect(r.body).toBe('{"error":"application_delete_failed"}')
  })

  it('any other delete error → 500 {"error":"application_delete_failed"} (the inner try owns it)', async () => {
    h.state.deleteError = { code: '42501', message: 'permission denied' }
    const r = await del()
    expect(r.status).toBe(500)
    expect(r.body).toBe('{"error":"application_delete_failed"}')
    expect(h.state.removedFiles).toEqual([])
  })

  it('a storage failure AFTER a committed delete is still a 200 — never report a done delete as failed', async () => {
    h.state.removeThrows = true
    const r = await del()
    expect(r.status).toBe(200)
    expect(r.body).toBe(`{"deleted":true,"id":"${APP_ID}"}`)
    expect(h.state.sequence).toEqual(['row-deleted'])
  })

  /**
   * ⚠️⚠️ THE MOST DESTRUCTIVE UNASSERTED LINE IN EITHER ROUTE. `load()` reads `visa_documents`
   * scoped by `application_id`, and the list it returns is fed VERBATIM to
   * `removeVisaFiles(loaded.documents.map(d => d.storage_path))`. Drop that `.eq` and one
   * applicant deleting one draft removes EVERY applicant's storage objects — passports, portraits,
   * live cases included — while still answering a perfectly ordinary `{"deleted":true,id}` 200.
   * The fake answers `h.state.documents` for any filter, so nothing else in this file can see it.
   */
  it('load() scopes BOTH child tables to this case — the file removal is only as narrow as this read', async () => {
    await del()
    const docs = childReads('visa_documents')
    expect(docs).toHaveLength(1)
    expect(docs[0].filters).toEqual([['eq', 'application_id', APP_ID], ['order', 'created_at', null]])
    const events = childReads('visa_events')
    expect(events).toHaveLength(1)
    expect(events[0].filters).toEqual([['eq', 'application_id', APP_ID], ['order', 'created_at', null]])
  })

  it('the delete never resolves a Profile row either — no guest-Seller auto-claim on a PII delete', async () => {
    expect((await del()).status).toBe(200)
    expect(getCurrentProfile).not.toHaveBeenCalled()
  })

  it('a case with no documents deletes cleanly', async () => {
    h.state.documents = []
    const r = await del()
    expect(r.status).toBe(200)
    expect(h.state.removedFiles).toEqual([[]])
  })
})
