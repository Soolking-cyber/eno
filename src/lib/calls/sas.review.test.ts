import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SAS_CODE_TAG, SAS_COMMIT_TAG, SasError, commit, computeSas, fingerprintPairEqual, fingerprintsByRole,
  fingerprintsFromStats, formatFingerprint, generateNonce, nonceFromHex, parseFingerprint, sasFailureVerdict, toHex,
  uuidToBytes, verifyCommit, type SasErrorCode,
} from './sas'
import { SAS_EMOJI } from './sas-emoji'

/**
 * ADVERSARIAL REVIEW of the safety code (2026-10-21). The module's own suite proves the maths. This file attacks the
 * one property the maths exists for: a man-in-the-middle who controls signalling must end up with a MISMATCH that
 * the call ends on, never with an outcome it prefers.
 *
 * ⚠️ THE FINDING THIS FILE EXISTS FOR: THE PEER CHOOSES WHAT getStats SAYS ABOUT ITS OWN CERTIFICATE, AND THE MODULE
 * TOLD THE ENGINE TO SHOW "cannot verify" FOR EVERY SasError. Verified in libwebrtc (webrtc-sdk m137_release), not
 * reasoned:
 *   - rtc_base/ssl_certificate.cc SSLCertificate::GetStats() hashes the certificate with GetSignatureDigestAlgorithm(),
 *     i.e. the digest of the certificate's OWN SIGNATURE, and returns nullptr when that algorithm is unknown.
 *   - rtc_base/boringssl_certificate.cc GetSignatureDigestAlgorithm(): md5, sha-1, sha-224, sha-256, sha-384, sha-512
 *     by signature OID; anything else → false → no certificate stats, so no remoteCertificateId
 *     (pc/rtc_stats_collector.cc only sets remote_certificate_id when the remote stats exist).
 *   - rtc_base/openssl_stream_adapter.cc VerifyPeerCertificate() checks only ComputeDigest(<the SDP's algorithm>) ==
 *     the SDP value, and says so: "Ignore any verification error if the digest matches".
 * So a MITM presents a P-256 key in a certificate self-signed with ecdsa-with-SHA384 (or an unknown OID), puts the
 * SHA-256 of its DER in the SDP — every sha-256-only SDP guard passes — and DTLS connects. getStats then reports
 * fingerprintAlgorithm 'sha-384' (or no remote certificate at all), the module threw bad_fingerprint /
 * cert_stats_missing, and its header mapped every SasError to "cannot verify, never interception". The attacker got
 * to pick the quiet outcome on every call. The same held for a malformed nA reveal (the box relays it: call_session
 * .caller_reveal), a reflected nonce and a split transport. Design §3.2 step 5 already says a WITHHELD reveal is a
 * mismatch; a MANGLED one must not be kinder.
 *
 * Secondary: parseFingerprint's SDP spelling was looser than libwebrtc's (pc/webrtc_sdp.cc ParseFingerprintAttribute
 * splits on ONE space and wants exactly two fields), and the Vietnamese names held one pair that is the same text
 * once tone marks drop (🏗 "cần cẩu" / 🎣 "cần câu") — a minimal pair in a list made to be read aloud.
 */

// ---------------------------------------------------------------------------
// Fixtures — built independently of the module's own suite
// ---------------------------------------------------------------------------

const fill = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (seed * 37 + i * 11 + 5) & 0xff)
const N_A = fill(32, 1)
const N_B = fill(32, 2)
const FP_A = fill(32, 3)
const FP_B = fill(32, 4)
const CALLER = '6f1c2a90-3b4d-4e5f-8a1b-2c3d4e5f6a7b'
const CALLEE = '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d'
const CALL = 'd4c3b2a1-f0e9-4d8c-b7a6-958473625140'
const COMMIT_INPUT = { nA: N_A, fpA: FP_A, callerId: CALLER, calleeId: CALLEE }
const SAS_INPUT = { callId: CALL, fpA: FP_A, fpB: FP_B, nA: N_A, nB: N_B }

const colonHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':')
const LOCAL = colonHex(FP_A)
const REMOTE = colonHex(FP_B)

function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}
async function caughtAsync(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  return undefined
}
function expectCode(err: unknown, code: SasErrorCode) {
  expect(err, `expected SasError(${code})`).toBeInstanceOf(SasError)
  expect((err as SasError).code).toBe(code)
}

/** Chrome's shapes: certificate ids are 'CF' + the fingerprint text. */
const certStats = (fp: string, fingerprintAlgorithm = 'sha-256') => ({
  id: `CF${fp}`, type: 'certificate', timestamp: 1, fingerprint: fp, fingerprintAlgorithm, base64Certificate: 'MIIB',
})
const transportStats = (o: { id?: string; dtlsState?: string; localId?: string; remoteId?: string }) => ({
  id: o.id ?? 'T01', type: 'transport', timestamp: 1, dtlsState: o.dtlsState ?? 'connected', dtlsRole: 'server',
  localCertificateId: o.localId, remoteCertificateId: o.remoteId,
})
const connectedTo = (remote: string | undefined, remoteCert?: { id: string }) => [
  transportStats({ localId: `CF${LOCAL}`, remoteId: remote === undefined ? undefined : `CF${remote}` }),
  certStats(LOCAL),
  ...(remoteCert ? [remoteCert] : []),
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 1. The peer chooses what getStats reports about its certificate
// ---------------------------------------------------------------------------

describe('a remote certificate no honest engine produces is a MISMATCH, never "cannot verify"', () => {
  const DIGEST_LENGTHS: [string, number][] = [['md5', 16], ['sha-1', 20], ['sha-224', 28], ['sha-384', 48], ['sha-512', 64]]

  it.each(DIGEST_LENGTHS)('remote certificate signed with %s (stats report that digest)', (algorithm, length) => {
    const fp = colonHex(fill(length, 9))
    const err = caught(() => fingerprintsFromStats(connectedTo(fp, certStats(fp, algorithm))))
    expectCode(err, 'remote_cert_rejected')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })

  it('a remote sha-256 certificate whose digest text is garbled', () => {
    const garbled = { ...certStats(REMOTE), fingerprint: 'AB:CD' }
    const err = caught(() => fingerprintsFromStats(connectedTo(REMOTE, garbled)))
    expectCode(err, 'remote_cert_rejected')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })

  it('no remote certificate stats at all (unknown signature OID → libwebrtc emits none and no remoteCertificateId)', () => {
    const err = caught(() => fingerprintsFromStats(connectedTo(undefined)))
    expectCode(err, 'remote_cert_rejected')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })

  it('a remoteCertificateId that resolves to nothing, or to a record that is not a certificate', () => {
    const dangling = caught(() => fingerprintsFromStats(connectedTo(REMOTE)))
    expectCode(dangling, 'remote_cert_rejected')
    const notACert = [
      transportStats({ localId: `CF${LOCAL}`, remoteId: 'CP1' }), certStats(LOCAL),
      { id: 'CP1', type: 'candidate-pair', fingerprint: REMOTE, fingerprintAlgorithm: 'sha-256' },
    ]
    expectCode(caught(() => fingerprintsFromStats(notACert)), 'remote_cert_rejected')
  })

  it('THIS phone exposing no certificate stats is the one honest "cannot verify" (a capability gap, not the peer)', () => {
    const noIds = [transportStats({}), certStats(LOCAL), certStats(REMOTE)]
    const err = caught(() => fingerprintsFromStats(noIds))
    expectCode(err, 'cert_stats_missing')
    expect(sasFailureVerdict(err)).toBe('cannot_verify')
    // local missing wins over a bad remote: the peer cannot make OUR certificate vanish, so this is the capability case
    const bothBad = [transportStats({ localId: 'CFnope', remoteId: `CF${REMOTE}` }), certStats(REMOTE, 'sha-384')]
    expectCode(caught(() => fingerprintsFromStats(bothBad)), 'cert_stats_missing')
  })

  it('our OWN certificate in a shape we cannot read degrades to "cannot verify": the peer cannot reach it', () => {
    const odd = [transportStats({ localId: `CF${LOCAL}`, remoteId: `CF${REMOTE}` }), certStats(LOCAL, 'sha-1'), certStats(REMOTE)]
    const err = caught(() => fingerprintsFromStats(odd))
    expectCode(err, 'cert_stats_missing')
    expect(sasFailureVerdict(err)).toBe('cannot_verify')
  })

  it('a browser-wide stats quirk hits OUR certificate first, so it never reads as the other person intercepting', () => {
    // the same browser code formats both certificates: a WebView that omits fingerprintAlgorithm omits it on both
    const quirk = (fp: string) => {
      const { fingerprintAlgorithm: _drop, ...rest } = certStats(fp)
      return rest
    }
    const both = [transportStats({ localId: `CF${LOCAL}`, remoteId: `CF${REMOTE}` }), quirk(LOCAL), quirk(REMOTE)]
    expect(sasFailureVerdict(caught(() => fingerprintsFromStats(both)))).toBe('cannot_verify')
    // only when OURS reads fine and the PEER's does not is it the peer's certificate, i.e. the peer's choice
    const remoteOnly = [transportStats({ localId: `CF${LOCAL}`, remoteId: `CF${REMOTE}` }), certStats(LOCAL), quirk(REMOTE)]
    const err = caught(() => fingerprintsFromStats(remoteOnly))
    expectCode(err, 'remote_cert_rejected')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })

  it('two connected transports with different certificates (media split across a MITM) is a mismatch', () => {
    const other = colonHex(fill(32, 7))
    const split = [
      ...connectedTo(REMOTE, certStats(REMOTE)),
      transportStats({ id: 'T02', localId: `CF${LOCAL}`, remoteId: `CF${other}` }), certStats(other),
    ]
    const err = caught(() => fingerprintsFromStats(split))
    expectCode(err, 'transport_mismatch')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })
})

// ---------------------------------------------------------------------------
// 2. Everything the box relays can be mangled — every mangling is a mismatch
// ---------------------------------------------------------------------------

describe('sasFailureVerdict: only a capability gap on THIS phone may read as "cannot verify"', () => {
  it('a mangled nA reveal is a mismatch, exactly like a withheld one (design §3.2 step 5) or a mangled C', async () => {
    const honest = toHex(N_A)
    for (const reveal of [
      honest.slice(1), `${honest}0`, `${honest.slice(2)}zz`, '', ' '.repeat(64), Buffer.from(N_A).toString('base64'),
      `0x${honest.slice(2)}`, null, undefined, 42, { toString: () => honest },
    ]) {
      const err = caught(() => nonceFromHex(reveal as string))
      expectCode(err, 'bad_nonce')
      expect(sasFailureVerdict(err), String(reveal)).toBe('mismatch')
    }
    // the commitment side already behaved: a mangled C is `false`, i.e. a mismatch
    const C = await commit(COMMIT_INPUT)
    expect(await verifyCommit(C.slice(1), COMMIT_INPUT)).toBe(false)
  })

  it('a reflected nonce (the box hands the callee its own nB as "nA") is a mismatch, and C refuses it too', async () => {
    const C = await commit(COMMIT_INPUT)
    expect(await verifyCommit(C, { ...COMMIT_INPUT, nA: N_B })).toBe(false)
    const err = await caughtAsync(computeSas({ ...SAS_INPUT, nA: Uint8Array.from(N_B) }))
    expectCode(err, 'same_party')
    expect(sasFailureVerdict(err)).toBe('mismatch')
  })

  it('ids the box supplies — a self-call or a non-UUID — are mismatches, not "cannot verify"', async () => {
    const C = await commit(COMMIT_INPUT)
    const self = await caughtAsync(verifyCommit(C, { ...COMMIT_INPUT, callerId: CALLEE }))
    expectCode(self, 'same_party')
    expect(sasFailureVerdict(self)).toBe('mismatch')
    const junk = await caughtAsync(verifyCommit(C, { ...COMMIT_INPUT, callerId: `${CALLER} ` }))
    expectCode(junk, 'bad_uuid')
    expect(sasFailureVerdict(junk)).toBe('mismatch')
    const callId = await caughtAsync(computeSas({ ...SAS_INPUT, callId: 'not-a-call' }))
    expect(sasFailureVerdict(callId)).toBe('mismatch')
  })

  it('no WebCrypto (an insecure context) is "cannot verify" — nothing on the wire can cause it', async () => {
    vi.stubGlobal('crypto', undefined)
    expect(sasFailureVerdict(caught(() => generateNonce()))).toBe('cannot_verify')
    expect(sasFailureVerdict(await caughtAsync(computeSas(SAS_INPUT)))).toBe('cannot_verify')
  })

  it('crypto without subtle (getRandomValues alone) still refuses to commit, as no_crypto', async () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    expect(generateNonce()).toHaveLength(32)
    const err = await caughtAsync(commit(COMMIT_INPUT))
    expectCode(err, 'no_crypto')
    expect(sasFailureVerdict(err)).toBe('cannot_verify')
  })

  it('anything that is not a SasError fails CLOSED: a bug must be loud, never a quiet "cannot verify"', () => {
    for (const e of [new TypeError('x is not iterable'), new Error('boom'), 'string', null, undefined, 0]) {
      expect(sasFailureVerdict(e), String(e)).toBe('mismatch')
    }
    // a look-alike object is not a SasError: no duck-typed way to the quiet outcome
    expect(sasFailureVerdict({ name: 'SasError', code: 'no_crypto' })).toBe('mismatch')
    expect(sasFailureVerdict({ name: 'SasError', code: 'cert_stats_missing' })).toBe('mismatch')
  })

  it('covers every code the module can throw (a new code must take a side explicitly)', () => {
    const quiet: SasErrorCode[] = ['no_crypto', 'cert_stats_missing']
    const loud: SasErrorCode[] = ['bad_nonce', 'bad_fingerprint', 'bad_uuid', 'same_party', 'transport_mismatch', 'remote_cert_rejected']
    for (const code of quiet) expect(sasFailureVerdict(new SasError(code, code)), code).toBe('cannot_verify')
    for (const code of loud) expect(sasFailureVerdict(new SasError(code, code)), code).toBe('mismatch')
  })
})

// ---------------------------------------------------------------------------
// 3. parseFingerprint's SDP spelling is libwebrtc's: ONE space, two fields
// ---------------------------------------------------------------------------

describe("parseFingerprint (SDP spelling) accepts what libwebrtc accepts and nothing more", () => {
  const FP = colonHex(FP_B)

  it('refuses tabs, runs of spaces, leading or trailing blanks and non-ASCII spaces', () => {
    for (const v of [
      `sha-256\t${FP}`, `sha-256  ${FP}`, ` sha-256 ${FP}`, `sha-256 ${FP} `, `sha-256 ${FP}`, ` sha-256 ${FP}`,
      `sha-256 ${FP}\t`, `sha-256　${FP}`, `sha-256 \r\n${FP}`,
    ]) {
      expectCode(caught(() => parseFingerprint(v)), 'bad_fingerprint')
    }
  })

  it('still takes the exact spelling, either hex case, an upper-case algorithm, and one trailing line ending', () => {
    for (const v of [`sha-256 ${FP}`, `sha-256 ${FP.toLowerCase()}`, `SHA-256 ${FP}`, `sha-256 ${FP}\r\n`, `sha-256 ${FP}\n`]) {
      expect(parseFingerprint(v), JSON.stringify(v)).toEqual(FP_B)
    }
  })

  it('refuses full-width or look-alike separators and digits (they are not hex to libwebrtc either)', () => {
    expectCode(caught(() => parseFingerprint('sha-256', FP.replace(':', '：'))), 'bad_fingerprint')
    expectCode(caught(() => parseFingerprint('sha-256', FP.replace('A', 'Ａ'))), 'bad_fingerprint')
    expectCode(caught(() => parseFingerprint('sha‐256', FP)), 'bad_fingerprint')
  })

  it('round-trips every byte value through formatFingerprint', () => {
    for (let start = 0; start < 256; start += 32) {
      const b = Uint8Array.from({ length: 32 }, (_, i) => start + i)
      expect(parseFingerprint('sha-256', formatFingerprint(b))).toEqual(b)
      expect(parseFingerprint(`sha-256 ${formatFingerprint(b).toLowerCase()}`)).toEqual(b)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. The byte layout, re-derived with a second SHA-256 and hand-built preimages
// ---------------------------------------------------------------------------

const nodeSha256 = (...parts: Uint8Array[]) => createHash('sha256').update(Buffer.concat(parts)).digest()
const uuidRaw = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex')
const randomUuid = () => globalThis.crypto.randomUUID()

describe('canonical encoding, cross-checked with node:crypto over hand-built preimages', () => {
  it('commit = SHA-256(tag | nA | fpA | callerId | calleeId) on random inputs, and the preimage is 114 bytes', async () => {
    for (let i = 0; i < 40; i++) {
      const input = { nA: generateNonce(), fpA: generateNonce(), callerId: randomUuid(), calleeId: randomUuid() }
      const pre = Buffer.concat([Buffer.from(SAS_COMMIT_TAG), input.nA, input.fpA, uuidRaw(input.callerId), uuidRaw(input.calleeId)])
      expect(pre.length).toBe(114)
      expect(await commit(input)).toBe(createHash('sha256').update(pre).digest('hex'))
      expect(await verifyCommit(createHash('sha256').update(pre).digest('hex').toUpperCase(), input)).toBe(true)
    }
  })

  it('computeSas = first 4 bytes of SHA-256(tag | callId | fpA | fpB | nA | nB), big-endian code32, 159-byte preimage', async () => {
    for (let i = 0; i < 40; i++) {
      const input = { callId: randomUuid(), fpA: generateNonce(), fpB: generateNonce(), nA: generateNonce(), nB: generateNonce() }
      const pre = [Buffer.from(SAS_CODE_TAG), uuidRaw(input.callId), input.fpA, input.fpB, input.nA, input.nB]
      expect(Buffer.concat(pre).length).toBe(159)
      const d = nodeSha256(...pre)
      const sas = await computeSas(input)
      expect(sas.indices).toEqual([d[0], d[1], d[2], d[3]])
      expect(sas.code32).toBe(d.readUInt32BE(0))
      expect(sas.emoji).toEqual([d[0], d[1], d[2], d[3]].map((x) => SAS_EMOJI[x]))
    }
  })

  it("the module's own pinned vectors re-derive with node:crypto (they were not computed by the module)", async () => {
    const seq = (from: number) => Uint8Array.from({ length: 32 }, (_, i) => (from + i) & 0xff)
    const [nA, nB, fpA, fpB] = [seq(0x00), seq(0x40), seq(0x80), seq(0xc0)]
    const caller = '11111111-2222-4333-8444-555555555555'
    const callee = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const call = '0f1e2d3c-4b5a-4987-a6b5-c4d3e2f1a0b9'
    expect(nodeSha256(Buffer.from(SAS_COMMIT_TAG), nA, fpA, uuidRaw(caller), uuidRaw(callee)).toString('hex')).toBe(
      '8314e477aecba7f165bd9c05d68a0749e180e0e8d53b9e3f6f1cb8ac18225264',
    )
    expect(nodeSha256(Buffer.from(SAS_CODE_TAG), uuidRaw(call), fpA, fpB, nA, nB).readUInt32BE(0)).toBe(1435394169)
  })

  it('code32 stays UNSIGNED when the first hash byte has its top bit set (both pinned vectors start below 0x80)', async () => {
    // deterministic: the first nB tail byte whose hash starts at ≥ 0x80 (about half of them do)
    let found = false
    for (let tail = 0; tail < 256 && !found; tail++) {
      const nB = Uint8Array.from(N_B)
      nB[31] = tail // N_A and N_B already differ at byte 0, so this can never become a reflected nonce
      const d = nodeSha256(Buffer.from(SAS_CODE_TAG), uuidRaw(CALL), FP_A, FP_B, N_A, nB)
      if (d[0] < 0x80) continue
      found = true
      const sas = await computeSas({ ...SAS_INPUT, nB })
      expect(sas.code32).toBe(d.readUInt32BE(0))
      expect(sas.code32).toBeGreaterThanOrEqual(2 ** 31)
      expect(sas.indices[0]).toBe(d[0])
    }
    expect(found).toBe(true)
  })

  it('a field passed as a VIEW into a larger buffer hashes only its own 32 bytes (no neighbouring bytes leak in)', async () => {
    const big = new Uint8Array(100).map((_, i) => (i * 13 + 1) & 0xff)
    const view = big.subarray(17, 49)
    const copy = Uint8Array.from(view)
    expect(await commit({ ...COMMIT_INPUT, nA: view })).toBe(await commit({ ...COMMIT_INPUT, nA: copy }))
    expect((await computeSas({ ...SAS_INPUT, fpB: view })).code32).toBe((await computeSas({ ...SAS_INPUT, fpB: copy })).code32)
    // a Node Buffer is a Uint8Array too, and hashes the same
    expect(await commit({ ...COMMIT_INPUT, nA: Buffer.from(N_A) })).toBe(await commit(COMMIT_INPUT))
  })

  it('swapping two equal-length fields (nA ↔ fpA, nA ↔ nB, fpA ↔ fpB) changes the value: positions are fixed', async () => {
    expect(await commit({ ...COMMIT_INPUT, nA: FP_A, fpA: N_A })).not.toBe(await commit(COMMIT_INPUT))
    const base = (await computeSas(SAS_INPUT)).code32
    expect((await computeSas({ ...SAS_INPUT, fpA: N_A, nA: FP_A })).code32).not.toBe(base)
    expect((await computeSas({ ...SAS_INPUT, fpB: N_B, nB: FP_B })).code32).not.toBe(base)
  })

  it('every single-bit change in any SAS input moves the 32-bit code (256 bits per field, not just the low bit)', async () => {
    const base = (await computeSas(SAS_INPUT)).code32
    const flips: Promise<number>[] = []
    for (const key of ['fpA', 'fpB', 'nA', 'nB'] as const) {
      for (let bit = 0; bit < 256; bit++) {
        const v = Uint8Array.from(SAS_INPUT[key])
        v[bit >> 3] ^= 1 << (bit & 7)
        flips.push(computeSas({ ...SAS_INPUT, [key]: v }).then((r) => r.code32))
      }
    }
    for (let bit = 0; bit < 128; bit++) {
      const raw = uuidToBytes(CALL)
      raw[bit >> 3] ^= 1 << (bit & 7)
      const h = toHex(raw)
      const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
      flips.push(computeSas({ ...SAS_INPUT, callId: id }).then((r) => r.code32))
    }
    const codes = await Promise.all(flips)
    expect(codes).toHaveLength(4 * 256 + 128)
    for (const c of codes) expect(c).not.toBe(base)
  })
})

// ---------------------------------------------------------------------------
// 5. Look-alike text from a hostile server never decodes to bytes
// ---------------------------------------------------------------------------

describe('look-alike characters are refused everywhere text becomes bytes', () => {
  it('UUIDs with a Cyrillic а, full-width digits, a Unicode hyphen or a zero-width space', () => {
    for (const id of [
      CALLER.replace('a', 'а'), CALLER.replace('6', '６'), CALLER.replace('-', '‐'), `${CALLER}​`,
      `​${CALLER}`, CALLER.replace('-', '‑'),
    ]) {
      expectCode(caught(() => uuidToBytes(id)), 'bad_uuid')
    }
  })

  it('nonces and commitments with full-width or Arabic-Indic digits', async () => {
    const hex = toHex(N_A)
    expectCode(caught(() => nonceFromHex(hex.replace(/[0-9]/, '０'))), 'bad_nonce')
    expectCode(caught(() => nonceFromHex(hex.replace(/[0-9]/, '٠'))), 'bad_nonce')
    const C = await commit(COMMIT_INPUT)
    expect(await verifyCommit(C.replace(/[0-9]/, '０'), COMMIT_INPUT)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. getStats shapes the engine will really hand over
// ---------------------------------------------------------------------------

/** An RTCStatsReport stand-in that is NOT a Map: maplike get/values/forEach, iteration yields [id, stats]. */
class FakeStatsReport {
  readonly #m: Map<string, { id: string }>
  constructor(stats: { id: string }[]) {
    this.#m = new Map(stats.map((s) => [s.id, s] as const))
  }
  get(id: string) {
    return this.#m.get(id)
  }
  values() {
    return this.#m.values()
  }
  forEach(cb: (v: { id: string }, k: string) => void) {
    this.#m.forEach(cb)
  }
  [Symbol.iterator]() {
    return this.#m.entries()
  }
}

describe('fingerprintsFromStats on realistic and hostile shapes', () => {
  const good = [...connectedTo(REMOTE, certStats(REMOTE))]

  it('reads a maplike report that is not a Map, a one-shot generator, and any record order', () => {
    const want = { local: FP_A, remote: FP_B }
    expect(fingerprintsFromStats(new FakeStatsReport(good) as unknown as Iterable<unknown>)).toEqual(want)
    function* oneShot() {
      yield* good
    }
    expect(fingerprintsFromStats(oneShot())).toEqual(want)
    expect(fingerprintsFromStats([...good].reverse())).toEqual(want)
  })

  it('ids such as __proto__, constructor or toString resolve to nothing, never to Object.prototype', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const viaRemote = [transportStats({ localId: `CF${LOCAL}`, remoteId: id }), certStats(LOCAL)]
      expectCode(caught(() => fingerprintsFromStats(viaRemote)), 'remote_cert_rejected')
      const viaLocal = [transportStats({ localId: id, remoteId: `CF${REMOTE}` }), certStats(REMOTE)]
      expectCode(caught(() => fingerprintsFromStats(viaLocal)), 'cert_stats_missing')
    }
  })

  it('a transport mid-handshake that still lists certificates yields null, never a stale pair to compare against', () => {
    for (const dtlsState of ['new', 'connecting', 'closed', 'failed', undefined]) {
      const pending = [transportStats({ dtlsState, localId: `CF${LOCAL}`, remoteId: `CF${REMOTE}` }), certStats(LOCAL), certStats(REMOTE)]
      if (dtlsState === undefined) delete (pending[0] as { dtlsState?: string }).dtlsState
      expect(fingerprintsFromStats(pending), String(dtlsState)).toBeNull()
    }
  })

  it('two connected transports naming the same certificates in different hex case are NOT a mismatch', () => {
    const lowerRemote = { ...certStats(REMOTE.toLowerCase()) }
    const twin = [...good, transportStats({ id: 'T02', localId: `CF${LOCAL}`, remoteId: lowerRemote.id }), lowerRemote]
    expect(fingerprintsFromStats(twin)).toEqual({ local: FP_A, remote: FP_B })
  })

  it('both phones agree through their mirror-image reports, and a frozen pair spots a swapped remote', async () => {
    const onCaller = fingerprintsFromStats(good)!
    const calleeView = [transportStats({ localId: `CF${REMOTE}`, remoteId: `CF${LOCAL}` }), certStats(REMOTE), certStats(LOCAL)]
    const onCallee = fingerprintsFromStats(calleeView)!
    const a = await computeSas({ callId: CALL, nA: N_A, nB: N_B, ...fingerprintsByRole('caller', onCaller) })
    const b = await computeSas({ callId: CALL, nA: N_A, nB: N_B, ...fingerprintsByRole('callee', onCallee) })
    expect(a.code32).toBe(b.code32)
    const swapped = fingerprintsFromStats([transportStats({ localId: `CF${LOCAL}`, remoteId: 'CFX' }), certStats(LOCAL), { ...certStats(colonHex(fill(32, 8))), id: 'CFX' }])!
    expect(fingerprintPairEqual(onCaller, swapped)).toBe(false)
    expect(fingerprintPairEqual(onCaller, fingerprintsFromStats(good)!)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. The emoji table, read aloud
// ---------------------------------------------------------------------------

describe('SAS_EMOJI, re-checked from a second data source and for speech', () => {
  it('every entry is a fully-qualified RGI emoji per ICU, and exactly one grapheme', () => {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    // a property of strings needs the `v` flag; built at runtime because tsconfig targets ES2017
    const rgi = new RegExp('^\\p{RGI_Emoji}$', 'v')
    for (const { char } of SAS_EMOJI) {
      expect(rgi.test(char), char).toBe(true)
      expect([...seg.segment(char)], char).toHaveLength(1)
    }
  })

  it('no two Vietnamese names are the same text once tone marks drop (a minimal pair is misheard on a bad line)', () => {
    const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')
    const seen = new Map<string, string>()
    for (const { char, vi: name } of SAS_EMOJI) {
      const key = strip(name)
      expect(seen.get(key), `${char} "${name}" vs ${seen.get(key)}`).toBeUndefined()
      seen.set(key, `${char} "${name}"`)
    }
  })

  it('every index 0–255 resolves to a frozen entry, so no byte value can render as undefined', () => {
    for (let i = 0; i < 256; i++) {
      expect(SAS_EMOJI[i], String(i)).toBeDefined()
      expect(Object.isFrozen(SAS_EMOJI[i])).toBe(true)
    }
    expect(() => {
      ;(SAS_EMOJI as unknown as { char: string }[])[0].char = 'x'
    }).toThrow(TypeError)
  })
})
