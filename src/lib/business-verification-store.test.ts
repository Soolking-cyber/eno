import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `verificationDocExists` — THE PROBE THAT DECIDES WHETHER A KYC CASE CAN BE APPROVED, and the one
 * whose real-world mapping is counter-intuitive enough that it was wrong twice before this file.
 *
 * ⛔ THE FIXTURES BELOW ARE MEASURED, NOT INVENTED. Probed 2026-09-07 against this project's
 * storage with the service-role client: a PRESENT object answers `{ data: true, error: null }`, an
 * ABSENT one answers `{ data: false, error: "Bad Request", statusCode: 400 }`. `exists()` reports
 * "not there" as an ERROR, so the natural `if (error) return 'unknown'` makes a purged passport
 * indistinguishable from an outage — and `evidence_unavailable` unreachable. If Supabase ever
 * changes that, this test is where it should fail, not in production on somebody's identity.
 */
const h = vi.hoisted(() => ({ s: { answer: null as unknown, throws: false } }))
vi.mock('@/lib/supabase-admin', () => ({
  BUSINESS_VERIFICATION_BUCKET: 'business-verification',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        exists: async () => {
          if (h.s.throws) throw new Error('socket hang up')
          return h.s.answer
        },
      }),
    },
  }),
}))
const { verificationDocExists } = await import('./business-verification-store')

beforeEach(() => { h.s.answer = null; h.s.throws = false })

describe('verificationDocExists', () => {
  it('a present object is present', async () => {
    h.s.answer = { data: true, error: null }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('present')
  })

  // ⛔ THE ONE THAT MATTERS. Absent arrives as data:false PLUS an error — reading the error alone
  // would report a deleted passport as a storage outage and let the case be retried for ever.
  it('⛔ AN ABSENT OBJECT IS `absent`, THOUGH STORAGE REPORTS IT AS A 400 ERROR', async () => {
    // ⛔ THE REAL SHAPE, COPIED FROM THE PROBE: a StorageApiError whose `statusCode` is the STRING
    // "400" and whose `status` is the NUMBER 400. An earlier fixture used a plain number and would
    // have passed against code that could not read what production actually sends.
    h.s.answer = { data: false, error: Object.assign(new Error('Bad Request'), { __isStorageError: true, name: 'StorageApiError', namespace: 'storage', statusCode: '400', status: 400 }) }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('absent')
  })

  it('a 404 is also absent', async () => {
    h.s.answer = { data: false, error: Object.assign(new Error('Not Found'), { __isStorageError: true, name: 'StorageApiError', statusCode: '404', status: 404 }) }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('absent')
  })

  // ⛔ AND AN OUTAGE IS NOT A MISSING FILE. Approval refuses either way, but only one of the two
  // tells a reviewer to reject somebody's identity.
  it('⛔ A 5xx IS `unknown`, NEVER `absent`', async () => {
    h.s.answer = { data: false, error: Object.assign(new Error('Internal Server Error'), { __isStorageError: true, name: 'StorageApiError', statusCode: '500', status: 500 }) }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('unknown')
  })

  it('a transport failure is `unknown`', async () => {
    h.s.throws = true
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('unknown')
  })

  // An error with no status at all must not be guessed into `absent`.
  it('an error carrying no status is `unknown`', async () => {
    h.s.answer = { data: false, error: new Error('who knows') }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('unknown')
  })

  // ⚠️ A 400 WITHOUT the library's own `data: false` is a bad request, not an absence. Pairing the
  // two is what keeps "storage did not understand us" from being reported as "the passport is gone".
  it('a 400 that does NOT come with data:false is `unknown`', async () => {
    h.s.answer = { data: true, error: Object.assign(new Error('Bad Request'), { statusCode: '400', status: 400 }) }
    expect(await verificationDocExists('p1/identity/document.jpg')).toBe('unknown')
  })
})
