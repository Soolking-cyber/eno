/**
 * The call's safety code — commit-reveal over both DTLS certificates (design v3 §3.2 steps 1, 3 and 5).
 *
 * WHY IT EXISTS. DTLS-SRTP keys exist only on the two phones, so the relay cannot listen. But whoever controls
 * signalling — eno's server, its database, Supabase Realtime — can rewrite the a=fingerprint lines and sit in the
 * middle of BOTH handshakes (RFC 8827: "the signaling server can potentially mount a man-in-the-middle attack"). The safety code makes that visible: each phone derives 4 emoji from the
 * certificates it ACTUALLY connected with, and the two people compare them by voice or on video.
 *
 * WHY COMMIT-REVEAL, AND WHY THIS ORDER. 32 bits is grindable — about 2^32 SHA-256s, a second on one GPU — if the
 * attacker may pick its certificate AFTER seeing the honest values (review-refute-security.md). So:
 *   1. caller: fresh certificate (fpA) + nonce nA → sends only C = SHA-256('eno-call-commit-v3' | nA | fpA | callerId | calleeId)
 *   3. callee: fresh certificate (fpB) + nonce nB → sent in the accept, i.e. only AFTER C is fixed
 *   5. connected: the caller reveals nA; the callee checks C (verifyCommit), and both phones show
 *      SHA-256('eno-call-sas-v3' | callId | fpA | fpB | nA | nB)[0..4] as 4 emoji (computeSas).
 * A man-in-the-middle must commit to a certificate before it learns nB and fpB, which leaves it ONE 2^-32 guess per
 * completed call. callId is not in C because the server mints it only after C has been posted (step 1 returns it).
 *
 * ⚠️ FINGERPRINTS COME FROM getStats, NEVER FROM SDP TEXT. The v2 draft checked C against "fpA in the offer". A
 * signalling attacker then sends one offer with a decoy a=fingerprint at session level and its real one as the last
 * media-level line: libwebrtc lets the media level override and the LAST line win, so the decoy opens C while DTLS runs
 * with the ground certificate (review-refute-security.md, blocker). Every fingerprint here therefore comes from
 * fingerprintsFromStats — RTCTransportStats.local/remoteCertificateId → RTCCertificateStats — the certificate the
 * DTLS stack verified. parseFingerprint also takes the SDP spelling, for the server's SDP checks, never for the code.
 *
 * ⚠️ ONE CANONICAL ENCODING — BYTES, NOT STRINGS. A version tag, then fixed-length fields: 32-byte nonces, 32-byte
 * SHA-256 digests, UUIDs as their 16 raw bytes. Fixed lengths make plain concatenation injective (no 'ab|c' vs
 * 'a|bc'), and decoding every textual input to bytes makes case and spelling irrelevant: two builds that print a
 * fingerprint or an id differently still hash the same bytes. A normalisation difference between builds is
 * otherwise a false "interception" warning on an honest call (review-refute-engineering.md).
 *
 * ⚠️ A = CALLER AND B = CALLEE ON BOTH PHONES. getStats gives each phone its own certificate as `local`; feeding
 * local-first on both sides yields two different codes on every call. fingerprintsByRole is the one mapping.
 *
 * ⚠️ FRESH CERTIFICATE PER CALL, FROZEN AT FIRST CONNECT (the engine's job; the tools are here). A reused or persisted
 * certificate makes fpB predictable and reopens the grind. Re-read the stats on every RTCDtlsTransport 'connected' and
 * end the call when fingerprintPairEqual says the pair moved: a changed remote certificate is a new DTLS association
 * the users never compared (RFC 8842 §3.1), and an honest ICE restart keeps the same certificates.
 *
 * ⚠️ THE ORDER IS THE SECURITY, AND THE ENGINE HOLDS IT: every input is frozen BEFORE the value that randomises it goes
 * out. The callee freezes C and callId before it sends nB in the accept, and ignores any C a later resync snapshot
 * brings. The caller reveals nA only once nB is frozen from the accept AND DTLS is connected. Both fingerprints freeze
 * at that first connect. A late C, a "newer" nB, or a code recomputed over NEW certificates with the already-revealed
 * nonces each hand the box an offline grind: 2^32 SHA-256s. No re-signing is needed either, because libwebrtc never
 * checks a peer certificate's signature ("Ignore any verification error if the digest matches",
 * openssl_stream_adapter.cc). So a rebuilt PeerConnection reuses this call's RTCCertificate on both sides and the
 * frozen pair survives it; a pair that moved ends the call. It is never "compare again".
 *
 * ⚠️ WHAT IT CANNOT DO. It detects anyone who controls signalling but NOT eno's served JavaScript: the same box serves
 * the code that computes and draws these emoji. The FAQ must say so (design §1, owner decision 4).
 *
 * ⚠️ ERRORS: ONLY A GAP IN THIS PHONE MAY READ AS "cannot verify". ROUTE EVERY FAILURE THROUGH sasFailureVerdict.
 * Whoever controls signalling also controls what it relays (the reveal, the ids). As the man in the middle, it also
 * picks the certificate this phone's DTLS stack verifies. libwebrtc's getStats then digests that certificate with the
 * certificate's OWN signature hash, or emits no stats for it when that hash is unknown (ssl_certificate.cc GetStats).
 * If any of that read as "cannot verify", a man-in-the-middle would always pick it over a mismatch, and the code would
 * never fire (sas.review.test.ts). So only no_crypto, and cert_stats_missing (this phone's OWN certificate has no
 * stats), are 'cannot_verify'. Every other SasError, and anything that is not a SasError, is a 'mismatch': the same
 * verdict as a commitment that does not open (verifyCommit → false) or a reveal that never comes (design §3.2 step 5).
 * ⚠️ NO VERSION RULE ON TOP. The design's "between peers on different protocol versions, any mismatch shows 'cannot
 * verify'" would let whoever controls signalling claim a different version and silence every mismatch — the very
 * quiet outcome this module closes for certificates (commit-gate review C2). Mixed versions are refused instead: the
 * box accepts a call only when both phones speak the caller's version (POST /api/calls/:id/accept → protocol_mismatch,
 * "reload to call"), so a code is only ever computed between equal versions. Pure: WebCrypto only, no DOM, no I/O.
 */

import type { CallRole } from './types'
import { SAS_EMOJI, type SasEmoji } from './sas-emoji'

/** Domain tag of the commitment (step 1). A new tag is a protocol change: bump CALL_PROTOCOL_VERSION with it. */
export const SAS_COMMIT_TAG = 'eno-call-commit-v3'
/** Domain tag of the code itself (step 5). Distinct from the commit tag, so no input can serve as both. */
export const SAS_CODE_TAG = 'eno-call-sas-v3'
export const SAS_NONCE_BYTES = 32
/** sha-256 is the only fingerprint accepted: every browser's default WebRTC certificate (ECDSA P-256) uses it. */
export const FINGERPRINT_BYTES = 32
/** 4 emoji × 8 bits = 32 bits = one 2^-32 guess per completed call. */
export const SAS_EMOJI_PER_CODE = 4

const TAG_COMMIT = new TextEncoder().encode(SAS_COMMIT_TAG)
const TAG_CODE = new TextEncoder().encode(SAS_CODE_TAG)

export type SasErrorCode =
  | 'bad_nonce'
  | 'bad_fingerprint'
  | 'bad_uuid'
  /** caller = callee, or both sides present the same certificate or nonce: a bug or a reflection, never a real call. */
  | 'same_party'
  /**
   * A connected transport with no usable stats for THIS phone's own certificate (absent, or in a shape we cannot read):
   * this browser cannot show what DTLS verified. The peer cannot cause it: our certificate is ours. One of only two
   * 'cannot_verify' codes.
   */
  | 'cert_stats_missing'
  /**
   * The connected transport's REMOTE certificate is one no honest engine makes. Its stats may be on another digest
   * (libwebrtc reports the certificate's own signature hash), garbled, or missing while ours are present (an unknown
   * signature algorithm gets no stats at all). The peer chose that certificate, so this is a mismatch.
   */
  | 'remote_cert_rejected'
  /** two connected transports with different certificates: BUNDLE means one, so something is splitting the media. */
  | 'transport_mismatch'
  | 'no_crypto'

export class SasError extends Error {
  readonly code: SasErrorCode
  constructor(code: SasErrorCode, message: string) {
    super(message)
    this.name = 'SasError'
    this.code = code
  }
}

/** How the engine presents a failed safety-code step. A 'mismatch' warns and ends the call (design §3.2 step 5). */
export type SasFailureVerdict = 'cannot_verify' | 'mismatch'

/**
 * Maps a failure from any step (nonceFromHex, fingerprintsFromStats, verifyCommit, computeSas) to a verdict. Only a
 * gap in THIS phone is 'cannot_verify': no WebCrypto, or no stats for its own certificate. Nothing on the wire or in
 * the peer's certificate can produce either. Everything else is a 'mismatch', and that includes errors that are not
 * a SasError. A bug that shows "interception" on every call is caught on the first staff call; a bug that shows
 * "cannot verify" ships. ⚠️ instanceof on purpose: an object that merely looks like a SasError gets no quiet way out.
 */
export function sasFailureVerdict(error: unknown): SasFailureVerdict {
  if (error instanceof SasError && (error.code === 'no_crypto' || error.code === 'cert_stats_missing')) {
    return 'cannot_verify'
  }
  return 'mismatch'
}

/** The caller's commitment inputs (step 1). fpA is the caller's own certificate digest. */
export interface CommitInput {
  nA: Uint8Array
  fpA: Uint8Array
  callerId: string
  calleeId: string
}

/** The code's inputs (step 5) — fingerprints from getStats, ordered by role (fingerprintsByRole), never by side. */
export interface SasInput {
  callId: string
  fpA: Uint8Array
  fpB: Uint8Array
  nA: Uint8Array
  nB: Uint8Array
}

export interface SasResult {
  /** The first 4 hash bytes, each an index into SAS_EMOJI. */
  readonly indices: readonly [number, number, number, number]
  readonly emoji: readonly [SasEmoji, SasEmoji, SasEmoji, SasEmoji]
  /** The same 32 bits as one unsigned integer (big-endian). */
  readonly code32: number
}

/** The two certificate digests one phone's DTLS transport verified: `local` is this phone's own. */
export interface FingerprintPair {
  readonly local: Uint8Array
  readonly remote: Uint8Array
}

// ---------------------------------------------------------------------------
// Randomness and hashing
// ---------------------------------------------------------------------------

/**
 * A fresh 32-byte nonce from the platform CSPRNG.
 * ⚠️ NEVER A FALLBACK. Without crypto.getRandomValues this throws; a Math.random nonce would make nA guessable and
 * the commitment worthless while every screen still looked normal.
 */
export function generateNonce(): Uint8Array {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new SasError('no_crypto', 'crypto.getRandomValues is unavailable')
  }
  return c.getRandomValues(new Uint8Array(SAS_NONCE_BYTES))
}

/** ⚠️ crypto.subtle exists only in secure contexts (https, localhost): an http page cannot compute or check a code. */
async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) throw new SasError('no_crypto', 'crypto.subtle is unavailable (not a secure context?)')
  return new Uint8Array(await subtle.digest('SHA-256', data))
}

/**
 * Byte equality without an early exit.
 * Honest about why: after the reveal nothing in this protocol is secret — anyone holding nA, fpA and the ids can
 * compute C — so this is hygiene, not a boundary. It costs nothing, and it keeps the comparison safe if this helper
 * is ever reused where the bytes ARE secret. A length difference is public and returns at once.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ---------------------------------------------------------------------------
// Canonical field encodings
// ---------------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let length = 0
  for (const p of parts) length += p.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Decodes hex already validated as pairs of [0-9a-fA-F]. */
function hexPairsToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

function fixedBytes(value: unknown, length: number, code: SasErrorCode, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new SasError(code, `${what} must be a Uint8Array of ${length} bytes`)
  }
  return value
}

/** Lowercase hex — the wire spelling of a nonce and of a commitment. */
export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

const NONCE_HEX_RE = /^[0-9a-f]{64}$/i

/** A nonce received over signalling (the caller's reveal, the callee's accept): exactly 64 hex characters. */
export function nonceFromHex(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !NONCE_HEX_RE.test(hex)) {
    throw new SasError('bad_nonce', 'a nonce is exactly 64 hex characters')
  }
  return hexPairsToBytes(hex)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A UUID's 16 raw bytes. Only the canonical 8-4-4-4-12 spelling (either case) is a UUID here — no braces, no urn:,
 * no bare 32 hex — and the nil UUID is refused: a zero id is what a missing or defaulted field looks like, never a
 * real row. No version check: the ids come from different generators (auth users, Prisma rows).
 */
export function uuidToBytes(id: string): Uint8Array {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new SasError('bad_uuid', 'not a canonical UUID')
  const bytes = hexPairsToBytes(id.replace(/-/g, ''))
  if (bytes.every((b) => b === 0)) throw new SasError('bad_uuid', 'the nil UUID is not an id')
  return bytes
}

const FINGERPRINT_RE = /^[0-9a-f]{2}(?::[0-9a-f]{2}){31}$/i

/**
 * A sha-256 certificate fingerprint as 32 bytes, from either spelling WebRTC uses:
 *   parseFingerprint(stats.fingerprintAlgorithm, stats.fingerprint)  // 'sha-256', 'AB:CD:…'  (RTCCertificateStats)
 *   parseFingerprint('sha-256 AB:CD:…')                              // an SDP a=fingerprint value
 * Hex is case-insensitive (Chrome prints upper case; RFC 8122 hash names are case-insensitive too); anything else —
 * another algorithm, 31 or 33 bytes, missing colons, junk — throws. ⚠️ ONLY sha-256, deliberately: accepting sha-1
 * would let an attacker pick the weakest digest, and a peer that is not on sha-256 is not running our engine.
 */
export function parseFingerprint(sdpValue: string): Uint8Array
export function parseFingerprint(algorithm: string, value: string): Uint8Array
export function parseFingerprint(...args: [string] | [string, string]): Uint8Array {
  // Counting arguments (not testing `value === undefined`) keeps a stats object whose fingerprint field is missing on
  // the two-argument path, where it fails as what it is.
  if (args.length < 2) return parseSdpFingerprint(args[0])
  const [algorithm, value]: unknown[] = args
  if (typeof algorithm !== 'string' || algorithm.trim().toLowerCase() !== 'sha-256') {
    throw new SasError('bad_fingerprint', 'only sha-256 fingerprints are accepted')
  }
  if (typeof value !== 'string' || !FINGERPRINT_RE.test(value.trim())) {
    throw new SasError('bad_fingerprint', 'expected 32 colon-separated hex bytes')
  }
  return hexPairsToBytes(value.trim().replace(/:/g, ''))
}

/**
 * The SDP spelling, exactly as libwebrtc parses it (pc/webrtc_sdp.cc ParseFingerprintAttribute): split on ONE space,
 * exactly two fields, the algorithm lower-cased. Only one trailing line ending is forgiven, for callers that pass a
 * raw line. ⚠️ Never looser than the browser: a parser that also takes a tab, two spaces or a leading blank disagrees
 * with libwebrtc about what a fingerprint line IS. An SDP check built on it would then count lines the browser does
 * not.
 */
function parseSdpFingerprint(sdpValue: unknown): Uint8Array {
  if (typeof sdpValue !== 'string') throw new SasError('bad_fingerprint', 'fingerprint is not a string')
  const fields = sdpValue.replace(/(?:\r\n|\n|\r)$/, '').split(' ')
  if (fields.length !== 2 || fields[0].toLowerCase() !== 'sha-256' || !FINGERPRINT_RE.test(fields[1])) {
    throw new SasError('bad_fingerprint', "expected exactly 'sha-256 AB:CD:…' (one space, sha-256 only)")
  }
  return hexPairsToBytes(fields[1].replace(/:/g, ''))
}

/** The upper-case colon spelling ('AB:CD:…') — for logs and SDP comparisons, never as a hash input. */
export function formatFingerprint(bytes: Uint8Array): string {
  const fp = fixedBytes(bytes, FINGERPRINT_BYTES, 'bad_fingerprint', 'fingerprint')
  return Array.from(fp, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

// ---------------------------------------------------------------------------
// Steps 1 and 5 — commit and verify
// ---------------------------------------------------------------------------

function commitPreimage(input: CommitInput): Uint8Array<ArrayBuffer> {
  const nA = fixedBytes(input?.nA, SAS_NONCE_BYTES, 'bad_nonce', 'nA')
  const fpA = fixedBytes(input?.fpA, FINGERPRINT_BYTES, 'bad_fingerprint', 'fpA')
  const callerId = uuidToBytes(input?.callerId)
  const calleeId = uuidToBytes(input?.calleeId)
  if (constantTimeEqual(callerId, calleeId)) throw new SasError('same_party', 'callerId and calleeId are the same id')
  return concat(TAG_COMMIT, nA, fpA, callerId, calleeId)
}

/** Step 1: C = SHA-256('eno-call-commit-v3' | nA | fpA | callerId | calleeId) as 64 lowercase hex characters. */
export async function commit(input: CommitInput): Promise<string> {
  return toHex(await sha256(commitPreimage(input)))
}

const COMMITMENT_RE = /^[0-9a-f]{64}$/i

/**
 * Step 5, callee side: does the caller's commitment open with the revealed nA and the CALLER'S certificate as this
 * phone's DTLS stack saw it (fingerprintsByRole('callee', fingerprintsFromStats(…)).fpA)?
 * Compares BYTES, so a relay that changes the hex case cannot fake a mismatch. A commitment that is not 64 hex
 * characters is simply `false`; malformed local inputs throw — those are bugs, and a bug is not a verdict.
 */
export async function verifyCommit(commitment: string, input: CommitInput): Promise<boolean> {
  const expected = await sha256(commitPreimage(input))
  if (typeof commitment !== 'string' || !COMMITMENT_RE.test(commitment)) return false
  return constantTimeEqual(hexPairsToBytes(commitment), expected)
}

/**
 * Step 5, both phones: SHA-256('eno-call-sas-v3' | callId | fpA | fpB | nA | nB) → its first 4 bytes → 4 emoji.
 * Both phones must pass the same inputs in the same roles — fpA/nA are always the caller's, whichever phone runs this.
 */
export async function computeSas(input: SasInput): Promise<SasResult> {
  const callId = uuidToBytes(input?.callId)
  const fpA = fixedBytes(input?.fpA, FINGERPRINT_BYTES, 'bad_fingerprint', 'fpA')
  const fpB = fixedBytes(input?.fpB, FINGERPRINT_BYTES, 'bad_fingerprint', 'fpB')
  const nA = fixedBytes(input?.nA, SAS_NONCE_BYTES, 'bad_nonce', 'nA')
  const nB = fixedBytes(input?.nB, SAS_NONCE_BYTES, 'bad_nonce', 'nB')
  if (constantTimeEqual(fpA, fpB)) throw new SasError('same_party', 'both sides present the same certificate')
  if (constantTimeEqual(nA, nB)) throw new SasError('same_party', 'both sides sent the same nonce')
  if (SAS_EMOJI.length !== 256) throw new Error('SAS_EMOJI must hold exactly 256 entries')

  const d = await sha256(concat(TAG_CODE, callId, fpA, fpB, nA, nB))
  const indices = Object.freeze([d[0], d[1], d[2], d[3]] as const)
  const emoji = Object.freeze([SAS_EMOJI[d[0]], SAS_EMOJI[d[1]], SAS_EMOJI[d[2]], SAS_EMOJI[d[3]]] as const)
  const code32 = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0
  return Object.freeze({ indices, emoji, code32 })
}

// ---------------------------------------------------------------------------
// Fingerprints from getStats
// ---------------------------------------------------------------------------

type StatsRecord = { readonly [key: string]: unknown }

/**
 * Accepts what callers actually have: the RTCStatsReport itself (a Map — iterating it yields [id, stats] PAIRS),
 * report.values(), or an array of either. ⚠️ Passing the report straight into a values-only loop finds no
 * 'transport' and reads as "not connected yet" forever — the code would silently never appear.
 */
function* statsRecords(source: Iterable<unknown>): Generator<StatsRecord> {
  const mapLike = source as { values?: unknown; get?: unknown }
  const items: Iterable<unknown> =
    typeof mapLike.values === 'function' && typeof mapLike.get === 'function'
      ? (source as ReadonlyMap<unknown, unknown>).values()
      : source
  for (const item of items) {
    const record = Array.isArray(item) && item.length === 2 ? item[1] : item
    if (record !== null && typeof record === 'object') yield record as StatsRecord
  }
}

function certificateStats(byId: Map<string, StatsRecord>, certId: unknown): StatsRecord | undefined {
  const cert = typeof certId === 'string' ? byId.get(certId) : undefined
  return cert && cert.type === 'certificate' ? cert : undefined
}

/**
 * The pair one connected transport verified. THIS phone's certificate is resolved first: the peer cannot make our
 * own certificate's stats vanish, so its absence is the browser's gap ('cannot verify'). Anything wrong with the
 * peer's certificate, though, is something the peer chose.
 * ⚠️ libwebrtc digests a certificate with that certificate's OWN signature hash (ssl_certificate.cc GetStats), not
 * with the SDP's algorithm, and emits no stats at all for a signature algorithm it does not know. DTLS still connects,
 * because it checks only the SDP digest. So 'sha-384' here, or a missing remote entry, means the peer presented a
 * certificate our engine never generates (ECDSA P-256 signed with SHA-256) → remote_cert_rejected → a mismatch.
 */
function transportPair(byId: Map<string, StatsRecord>, transport: StatsRecord): FingerprintPair {
  const localCert = certificateStats(byId, transport.localCertificateId)
  if (!localCert) throw new SasError('cert_stats_missing', 'the connected transport has no local certificate stats')
  let local: Uint8Array
  try {
    local = parseFingerprint(localCert.fingerprintAlgorithm as string, localCert.fingerprint as string)
  } catch {
    // The same browser code formats both certificates. A quirk shows up on OURS first and degrades to "cannot
    // verify"; it never accuses the other person.
    throw new SasError('cert_stats_missing', "this phone's own certificate stats are unusable")
  }
  const remoteCert = certificateStats(byId, transport.remoteCertificateId)
  if (!remoteCert) {
    throw new SasError('remote_cert_rejected', 'the peer certificate has no stats (an unknown signature algorithm?)')
  }
  try {
    return { local, remote: parseFingerprint(remoteCert.fingerprintAlgorithm as string, remoteCert.fingerprint as string) }
  } catch {
    throw new SasError('remote_cert_rejected', 'the peer certificate is not a sha-256 certificate')
  }
}

/**
 * The certificates the DTLS stack verified: the 'transport' stats with dtlsState 'connected' →
 * localCertificateId / remoteCertificateId → 'certificate' stats → parseFingerprint.
 * Returns null while no transport is connected. Several connected transports must carry identical certificates
 * (BUNDLE means exactly one), else SasError('transport_mismatch'). A transport that is not connected yet is ignored:
 * it has no SRTP keys, carries no media, and is checked when its own 'connected' re-read happens.
 * ⚠️ NULL MEANS "NOT YET". IT IS NOT A PASS. libwebrtc serves a CACHED report for 50 ms (pc/rtc_stats_collector.h).
 * Descriptions and ICE candidates clear that cache; DTLS does not. So a getStats call on the 'connected' event can
 * return the telemetry poll's report from just before the handshake: null on the first read, and on a re-check
 * possibly the previous association's pair. Read again after ≥ 60 ms, and keep reading until a connected transport
 * appears. Only then conclude "no transport stats in this browser" (cannot verify) or "unchanged".
 */
export function fingerprintsFromStats(source: Iterable<unknown>): FingerprintPair | null {
  const byId = new Map<string, StatsRecord>()
  const transports: StatsRecord[] = []
  for (const s of statsRecords(source)) {
    if (typeof s.id === 'string') byId.set(s.id, s)
    if (s.type === 'transport') transports.push(s)
  }
  let pair: FingerprintPair | null = null
  for (const t of transports) {
    if (t.dtlsState !== 'connected') continue
    const next = transportPair(byId, t)
    if (!pair) pair = next
    else if (!fingerprintPairEqual(pair, next)) {
      throw new SasError('transport_mismatch', 'connected transports carry different certificates')
    }
  }
  return pair
}

/** The one place local/remote becomes A/B: A is always the caller's certificate, on both phones. */
export function fingerprintsByRole(role: CallRole, pair: FingerprintPair): { fpA: Uint8Array; fpB: Uint8Array } {
  if (role === 'caller') return { fpA: pair.local, fpB: pair.remote }
  if (role === 'callee') return { fpA: pair.remote, fpB: pair.local }
  throw new TypeError(`unknown call role: ${String(role)}`)
}

/** Same certificates on both sides? Re-check on every 'connected'; a change ends the call (frozen at first connect). */
export function fingerprintPairEqual(a: FingerprintPair, b: FingerprintPair): boolean {
  return constantTimeEqual(a.local, b.local) && constantTimeEqual(a.remote, b.remote)
}
