import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
// Relative (not '@/lib/…') so vitest can resolve the module without a paths plugin —
// crypto.test.ts covers the env gate + envelope round-trip.
import { visaPayloadSchema, type VisaPayload } from './schema'

// TODO(VISA_DATA_ENCRYPTION_KEY): applicant payloads are AES-256-GCM envelopes keyed by
// the VISA_DATA_ENCRYPTION_KEY env var, which today lives ONLY in the forum project's
// environment (apps/forum). The owner must copy that exact value (64-char hex or base64,
// 32 bytes) into eno.vn's env for the in-hub assistant to read/write payloads. Until
// then every payload route fails closed with `visa_encryption_not_configured` and the
// dashboard renders an honest "not configured on this host yet" state — never broken
// crypto, never a plaintext fallback. Check readiness with visaCryptoReady().
//
// Ported from apps/forum/src/lib/visa/crypto.ts. The envelope format AND the AAD string
// below MUST stay byte-identical to the forum's — both apps decrypt each other's rows.

type Envelope = { v: 1; alg: 'A256GCM'; iv: string; tag: string; ciphertext: string }
// ⚠️ INTEROP: this AAD is baked into every existing ciphertext. It says "eno-forum"
// because the forum wrote the first envelopes — do NOT "rebrand" it to eno.vn or every
// stored payload becomes undecryptable.
const AAD = Buffer.from('eno-forum:visa-payload:v1')

function keyOrNull(): Buffer | null {
  const raw = process.env.VISA_DATA_ENCRYPTION_KEY?.trim()
  if (!raw) return null
  const result = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return result.length === 32 ? result : null
}

function key(): Buffer {
  const result = keyOrNull()
  if (!result) {
    // Distinguish absent from malformed only in the thrown code; both fail closed.
    if (!process.env.VISA_DATA_ENCRYPTION_KEY?.trim()) throw new Error('visa_encryption_not_configured')
    throw new Error('visa_encryption_key_invalid')
  }
  return result
}

/** True when a usable 32-byte key is present — the env gate every payload route checks
 *  BEFORE touching a ciphertext, so the UI can render the honest unconfigured state. */
export function visaCryptoReady(): boolean {
  return keyOrNull() !== null
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
