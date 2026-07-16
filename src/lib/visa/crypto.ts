import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { visaPayloadSchema, type VisaPayload } from '@/lib/visa/schema'

type Envelope = { v: 1; alg: 'A256GCM'; iv: string; tag: string; ciphertext: string }
const AAD = Buffer.from('eno-forum:visa-payload:v1')

function key(): Buffer {
  const raw = process.env.VISA_DATA_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('visa_encryption_not_configured')
  const result = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (result.length !== 32) throw new Error('visa_encryption_key_invalid')
  return result
}

export function encryptVisaPayload(payload: VisaPayload): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(visaPayloadSchema.parse(payload))), cipher.final()])
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') } satisfies Envelope)
}

export function decryptVisaPayload(value: string): VisaPayload {
  const envelope = JSON.parse(value) as Envelope
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') throw new Error('visa_envelope_invalid')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(AAD)
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  return visaPayloadSchema.parse(JSON.parse(plaintext))
}

/** Fingerprint only applicant-owned answers; operator status/message fields are excluded. */
export function visaApplicantSnapshotHash(payload: VisaPayload): string {
  const { adminMessage: _message, governmentRegistrationCode: _code, governmentApplicationStatus: _status, ...applicantAnswers } = visaPayloadSchema.parse(payload)
  return createHash('sha256').update(JSON.stringify(applicantAnswers)).digest('hex')
}
