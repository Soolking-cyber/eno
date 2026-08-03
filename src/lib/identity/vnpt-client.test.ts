import { describe, it, expect } from 'vitest'
import { clientSession, DOC_TYPE, OCR_TYPE, IDG_SUCCESS } from './vnpt-client'

// ⚠️ These pin the contract traps found reading VNPT's own sample payloads. Each corresponds to a
// way the integration fails SILENTLY — the direction that matters for an identity check.

describe('VNPT contract', () => {
  it('success is a BODY code, not an HTTP status', () => {
    // VNPT returns HTTP 200 with {"message":"IDG-00010102"} on rejection. A `res.ok` check passes
    // and a failure becomes a "verified" identity.
    expect(IDG_SUCCESS).toBe('IDG-00000000')
  })

  it('type 5 is passport — Tier B runs through the same provider', () => {
    expect(DOC_TYPE[5]).toBe('passport')
    expect(OCR_TYPE.passport).toBe(5)
    expect(OCR_TYPE.idCard).toBe(-1) // -1 covers BOTH old and new Vietnamese ID cards
  })

  it('client_session matches the prescribed 7-part shape', () => {
    const s = clientSession('req-abc-123', 1785835553000)
    expect(s.split('_')).toHaveLength(7)
    expect(s.endsWith('_1785835553000')).toBe(true)
  })

  it('client_session strips characters that would break the format', () => {
    // The separator is '_', so an id containing '_' or a special char would silently add fields.
    const s = clientSession('a_b-c!d/e', 1)
    expect(s.split('_')).toHaveLength(7)
  })

  it('never claims to be a device we are not', () => {
    // Inventing handset fields would put false telemetry into a provider's audit trail.
    expect(clientSession('x', 1).startsWith('WEB_')).toBe(true)
  })

  it('⚠️ does NOT export the face-enrolment endpoints (APIs 10-13)', async () => {
    // Enrolling every seller into a third-party searchable biometric index is a far larger data
    // commitment than the obligation requires, and it is irreversible in a way an image is not.
    const mod = await import('./vnpt-client')
    for (const banned of ['addFace', 'verifyFace', 'searchFace', 'searchFaceK']) {
      expect(mod).not.toHaveProperty(banned)
    }
  })
})
