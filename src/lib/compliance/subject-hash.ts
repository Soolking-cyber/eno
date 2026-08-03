import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// ── Identity subject hashing ────────────────────────────────────────────────────────────────────
//
// ⚠️ WHY HMAC AND NOT sha256. A national identifier is LOW-ENTROPY AND STRUCTURED. Vietnam's CCCD
// is 12 digits — the entire keyspace is 10^12, which a commodity GPU exhausts in seconds. A plain
// `sha256(cccd)` column is therefore equivalent to storing the numbers in the clear the moment the
// database leaks. Passport numbers are worse: within one nationality the format is often 8–9
// alphanumerics with a known prefix.
//
// A keyed hash breaks that: without IDENTITY_HASH_PEPPER the column is useless to an attacker,
// while we keep the only property we actually need — "is this the same human as that other row?"
//
// ⚠️ THE PEPPER IS A PLAIN SERVER ENV VAR, NEVER NEXT_PUBLIC_*. NEXT_PUBLIC_ values are inlined at
// BUILD time into the server bundle as well as the client one, so a peppered secret read that way
// ships inside the artifact and is readable by anyone who can pull the image.
//
// ⚠️ ROTATION INVALIDATES DUPLICATE DETECTION for every existing row — a rotated pepper produces
// different digests for the same person, so old and new rows stop colliding. Treat it as
// permanent. If rotation is ever forced (suspected pepper compromise), dual-write with a
// pepperVersion column rather than rehashing, because the raw identifiers are gone by design and
// CANNOT be rehashed. That is the intended trade: we accept un-rotatable hashes in exchange for
// never holding the identifiers.

/** Thrown rather than returning a fallback — a silent unpeppered hash would be a false identity. */
class MissingPepperError extends Error {
  constructor() {
    super('IDENTITY_HASH_PEPPER is not set — refusing to hash an identity without a key')
    this.name = 'MissingPepperError'
  }
}

function pepper(): string {
  const p = process.env.IDENTITY_HASH_PEPPER
  // ⚠️ FAIL CLOSED, LOUDLY. The tempting fallback (hash unkeyed if no pepper) would silently
  // produce brute-forceable digests AND a second, incompatible identity namespace — so the same
  // person would pass the uniqueness index twice. An exception at startup is far cheaper.
  if (!p || p.length < 32) throw new MissingPepperError()
  return p
}

/** True when a pepper is configured — lets a route degrade gracefully instead of 500ing. */
export function identityHashingAvailable(): boolean {
  try { pepper(); return true } catch { return false }
}

/**
 * Stable digest of an issuer's subject identifier.
 *
 * ⚠️ NORMALISE BEFORE HASHING, or the same passport yields different digests depending on how it
 * was read. MRZ output is uppercase with `<` fillers; a human retyping the same number may add
 * spaces or lowercase it. Without this, one person trivially verifies twice.
 */
export function hmacSubject(raw: string, opts?: { issuer?: string }): string {
  const normalized = raw.replace(/[\s<-]/g, '').trim().toUpperCase()
  if (!normalized) throw new Error('hmacSubject: empty identifier after normalisation')
  // Bind the issuer into the digest so passport "X1234567" from two different states cannot
  // collide into one identity — passport numbers are only unique WITHIN an issuing country.
  const material = `${(opts?.issuer ?? '').toUpperCase()}:${normalized}`
  return createHmac('sha256', pepper()).update(material).digest('hex')
}

/** Constant-time compare, for the rare path that checks a supplied hash against a stored one. */
export function subjectHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
