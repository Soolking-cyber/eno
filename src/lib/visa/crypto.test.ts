import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptVisaPayload, encryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from './crypto'
import { emptyVisaPayload } from './schema'

// The env gate is the whole point of this module on eno.vn: applicant payloads are
// AES-256-GCM envelopes keyed by VISA_DATA_ENCRYPTION_KEY (copied from the forum env).
// Absent key ⇒ honest `visa_encryption_not_configured`, NEVER a broken-crypto throw or a
// plaintext fallback. These tests pin that contract plus the envelope round-trip the two
// surfaces share.

const KEY_HEX = randomBytes(32).toString('hex')
const original = process.env.VISA_DATA_ENCRYPTION_KEY

afterEach(() => {
  if (original === undefined) delete process.env.VISA_DATA_ENCRYPTION_KEY
  else process.env.VISA_DATA_ENCRYPTION_KEY = original
})

describe('visaCryptoReady (the env gate)', () => {
  it('is false with no key', () => {
    delete process.env.VISA_DATA_ENCRYPTION_KEY
    expect(visaCryptoReady()).toBe(false)
  })
  it('is false with a malformed key', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = 'too-short'
    expect(visaCryptoReady()).toBe(false)
  })
  it('accepts 64-char hex', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = KEY_HEX
    expect(visaCryptoReady()).toBe(true)
  })
  it('accepts base64 of 32 bytes (padded and unpadded)', () => {
    const b64 = randomBytes(32).toString('base64')
    process.env.VISA_DATA_ENCRYPTION_KEY = b64
    expect(visaCryptoReady()).toBe(true)
    process.env.VISA_DATA_ENCRYPTION_KEY = b64.replace(/=+$/, '')
    expect(visaCryptoReady()).toBe(true)
  })
})

describe('fail-closed without the key', () => {
  it('encrypt throws the configuration code, never emits plaintext', () => {
    delete process.env.VISA_DATA_ENCRYPTION_KEY
    expect(() => encryptVisaPayload(emptyVisaPayload('a@b.com'))).toThrow('visa_encryption_not_configured')
  })
  it('decrypt throws the configuration code on a real envelope', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = KEY_HEX
    const envelope = encryptVisaPayload(emptyVisaPayload('a@b.com'))
    delete process.env.VISA_DATA_ENCRYPTION_KEY
    expect(() => decryptVisaPayload(envelope)).toThrow('visa_encryption_not_configured')
  })
  it('a malformed key is its own code (misconfiguration is not "absent")', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = 'not-a-key'
    expect(() => encryptVisaPayload(emptyVisaPayload(''))).toThrow('visa_encryption_key_invalid')
  })
})

describe('envelope round-trip (forum interop shape)', () => {
  it('decrypts what it encrypts, and the envelope is the forum v1/A256GCM shape', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = KEY_HEX
    const payload = { ...emptyVisaPayload('trip@example.com'), surname: 'NGUYEN', givenNames: 'AN' }
    const value = encryptVisaPayload(payload)
    const envelope = JSON.parse(value) as Record<string, unknown>
    expect(envelope.v).toBe(1)
    expect(envelope.alg).toBe('A256GCM')
    expect(typeof envelope.iv).toBe('string')
    expect(typeof envelope.tag).toBe('string')
    expect(value).not.toContain('NGUYEN')
    const roundTripped = decryptVisaPayload(value)
    expect(roundTripped.surname).toBe('NGUYEN')
    expect(roundTripped.email).toBe('trip@example.com')
  })
  it('rejects a tampered ciphertext (GCM auth)', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = KEY_HEX
    const envelope = JSON.parse(encryptVisaPayload(emptyVisaPayload('a@b.com'))) as { ciphertext: string } & Record<string, unknown>
    const bytes = Buffer.from(envelope.ciphertext, 'base64')
    bytes[0] ^= 0xff
    envelope.ciphertext = bytes.toString('base64')
    expect(() => decryptVisaPayload(JSON.stringify(envelope))).toThrow()
  })
})

describe('visaApplicantSnapshotHash', () => {
  it('ignores operator-owned fields, changes on applicant answers', () => {
    process.env.VISA_DATA_ENCRYPTION_KEY = KEY_HEX
    const base = emptyVisaPayload('a@b.com')
    const withAdminNote = { ...base, adminMessage: 'operator note', governmentApplicationStatus: 'processing' }
    expect(visaApplicantSnapshotHash(withAdminNote)).toBe(visaApplicantSnapshotHash(base))
    expect(visaApplicantSnapshotHash({ ...base, surname: 'TRAN' })).not.toBe(visaApplicantSnapshotHash(base))
  })
})
