import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FINGERPRINT_BYTES, SAS_CODE_TAG, SAS_COMMIT_TAG, SAS_NONCE_BYTES, SasError, commit, computeSas, constantTimeEqual,
  fingerprintPairEqual, fingerprintsByRole, fingerprintsFromStats, formatFingerprint, generateNonce, nonceFromHex,
  parseFingerprint, toHex, uuidToBytes, verifyCommit, type SasErrorCode,
} from './sas'
import { SAS_EMOJI } from './sas-emoji'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const seq = (from: number, length = 32) => Uint8Array.from({ length }, (_, i) => (from + i) & 0xff)
const N_A = seq(0x00)
const N_B = seq(0x40)
const FP_A = seq(0x80)
const FP_B = seq(0xc0)
const CALLER = '11111111-2222-4333-8444-555555555555'
const CALLEE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CALL = '0f1e2d3c-4b5a-4987-a6b5-c4d3e2f1a0b9'
const COMMIT_INPUT = { nA: N_A, fpA: FP_A, callerId: CALLER, calleeId: CALLEE }
const SAS_INPUT = { callId: CALL, fpA: FP_A, fpB: FP_B, nA: N_A, nB: N_B }

/** Independent hex decoding, so fingerprint tests do not trust the module's own decoder. */
const hexBytes = (s: string) => Uint8Array.from(s.replace(/:/g, '').match(/../g)!.map((h) => parseInt(h, 16)))
const flipByte = (b: Uint8Array, i: number) => {
  const c = Uint8Array.from(b)
  c[i] ^= 0x01
  return c
}
const uuidOf = (b: Uint8Array) => {
  const h = toHex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function expectSasError(fn: () => unknown, code: SasErrorCode) {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, `expected SasError(${code})`).toBeInstanceOf(SasError)
  expect((thrown as SasError).code).toBe(code)
}
const expectSasReject = (p: Promise<unknown>, code: SasErrorCode) =>
  expect(p).rejects.toMatchObject({ name: 'SasError', code })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Known answers — computed ONCE with Python's hashlib over the byte layout in DESIGN §3.2 (not with this module),
// then pinned. A change to the tags, the field order or the encoding moves them: that is a protocol change.
// ---------------------------------------------------------------------------

describe('known-answer vectors', () => {
  it('pins the domain tags', () => {
    expect(SAS_COMMIT_TAG).toBe('eno-call-commit-v3')
    expect(SAS_CODE_TAG).toBe('eno-call-sas-v3')
    expect(SAS_NONCE_BYTES).toBe(32)
    expect(FINGERPRINT_BYTES).toBe(32)
  })

  it('commit = SHA-256(tag | nA | fpA | callerId | calleeId), 114 input bytes, lowercase hex', async () => {
    expect(await commit(COMMIT_INPUT)).toBe('8314e477aecba7f165bd9c05d68a0749e180e0e8d53b9e3f6f1cb8ac18225264')
  })

  it('computeSas = first 4 bytes of SHA-256(tag | callId | fpA | fpB | nA | nB) → 4 emoji', async () => {
    const sas = await computeSas(SAS_INPUT)
    expect(sas.indices).toEqual([85, 142, 96, 121])
    expect(sas.code32).toBe(1435394169) // 0x558e6079
    expect(sas.emoji.map((e) => e.char)).toEqual(['🍒', '🚠', '🍟', '🏺'])
    expect(sas.emoji.map((e) => e.en)).toEqual(['cherries', 'cable car', 'fries', 'vase'])
    expect(sas.emoji.map((e) => e.vi)).toEqual(['quả cherry', 'cáp treo', 'khoai tây chiên', 'bình gốm'])
  })

  it('second vector: real-looking fingerprints in both spellings, an upper-case UUID, extreme nonces', async () => {
    const fpA = parseFingerprint(
      'sha-256',
      'B7:22:6C:5A:91:0D:3E:F4:18:A0:7C:E9:52:6B:D3:04:9F:21:88:C6:1E:75:AA:30:4D:E2:69:BF:07:93:5C:F8',
    )
    const fpB = parseFingerprint(
      'sha-256 0a:61:f3:9c:2e:d8:47:b5:13:7f:c0:6e:a9:24:85:fb:3d:5e:90:c7:18:ab:62:e4:09:76:d1:3f:b8:4c:2a:95',
    )
    const nA = new Uint8Array(32).fill(0xff)
    const nB = new Uint8Array(32)
    nB[31] = 1
    const callId = 'C0FFEE00-1234-4ABC-9DEF-0123456789AB'
    const sas = await computeSas({ callId, fpA, fpB, nA, nB })
    expect(sas.indices).toEqual([125, 159, 26, 163])
    expect(sas.code32).toBe(2107579043)
    expect(sas.emoji).toEqual(sas.indices.map((i) => SAS_EMOJI[i]))
    expect(await commit({ nA, fpA, callerId: callId, calleeId: CALLER })).toBe(
      'd251d063aa211c465e693d23e494280d3dd7519a463b68fc4220c0d85ffdd995',
    )
  })
})

// ---------------------------------------------------------------------------
// Every input byte matters
// ---------------------------------------------------------------------------

describe('every byte of every input changes the result', () => {
  it('commit: each byte of nA, fpA, callerId, calleeId', async () => {
    const base = await commit(COMMIT_INPUT)
    const variants: (typeof COMMIT_INPUT)[] = []
    for (let i = 0; i < 32; i++) variants.push({ ...COMMIT_INPUT, nA: flipByte(N_A, i) })
    for (let i = 0; i < 32; i++) variants.push({ ...COMMIT_INPUT, fpA: flipByte(FP_A, i) })
    for (let i = 0; i < 16; i++) variants.push({ ...COMMIT_INPUT, callerId: uuidOf(flipByte(uuidToBytes(CALLER), i)) })
    for (let i = 0; i < 16; i++) variants.push({ ...COMMIT_INPUT, calleeId: uuidOf(flipByte(uuidToBytes(CALLEE), i)) })
    const out = await Promise.all(variants.map((v) => commit(v)))
    expect(out).toHaveLength(96)
    for (const c of out) expect(c).not.toBe(base)
    expect(new Set(out).size).toBe(96)
  })

  it('computeSas: each byte of callId, fpA, fpB, nA, nB moves the 32-bit code', async () => {
    const base = (await computeSas(SAS_INPUT)).code32
    const variants: (typeof SAS_INPUT)[] = []
    for (let i = 0; i < 16; i++) variants.push({ ...SAS_INPUT, callId: uuidOf(flipByte(uuidToBytes(CALL), i)) })
    for (const key of ['fpA', 'fpB', 'nA', 'nB'] as const) {
      for (let i = 0; i < 32; i++) variants.push({ ...SAS_INPUT, [key]: flipByte(SAS_INPUT[key], i) })
    }
    const codes = await Promise.all(variants.map(async (v) => (await computeSas(v)).code32))
    expect(codes).toHaveLength(144)
    for (const c of codes) expect(c).not.toBe(base)
  })

  it('roles are bound: swapping caller/callee, fpA/fpB or nA/nB gives a different value', async () => {
    expect(await commit({ ...COMMIT_INPUT, callerId: CALLEE, calleeId: CALLER })).not.toBe(await commit(COMMIT_INPUT))
    const base = (await computeSas(SAS_INPUT)).code32
    expect((await computeSas({ ...SAS_INPUT, fpA: FP_B, fpB: FP_A })).code32).not.toBe(base)
    expect((await computeSas({ ...SAS_INPUT, nA: N_B, nB: N_A })).code32).not.toBe(base)
  })

  it('spelling does not matter: upper- and lower-case ids hash the same bytes (two builds, one code)', async () => {
    const upper = { ...COMMIT_INPUT, callerId: CALLER.toUpperCase(), calleeId: CALLEE.toUpperCase() }
    expect(await commit(upper)).toBe(await commit(COMMIT_INPUT))
    expect((await computeSas({ ...SAS_INPUT, callId: CALL.toUpperCase() })).code32).toBe(
      (await computeSas(SAS_INPUT)).code32,
    )
  })
})

// ---------------------------------------------------------------------------
// verifyCommit
// ---------------------------------------------------------------------------

describe('verifyCommit', () => {
  it('opens with the committed values, in either hex case', async () => {
    const c = await commit(COMMIT_INPUT)
    expect(c).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyCommit(c, COMMIT_INPUT)).toBe(true)
    expect(await verifyCommit(c.toUpperCase(), COMMIT_INPUT)).toBe(true)
  })

  it('refuses any other nonce, certificate or pair of ids', async () => {
    const c = await commit(COMMIT_INPUT)
    expect(await verifyCommit(c, { ...COMMIT_INPUT, nA: flipByte(N_A, 31) })).toBe(false)
    expect(await verifyCommit(c, { ...COMMIT_INPUT, fpA: FP_B })).toBe(false)
    expect(await verifyCommit(c, { ...COMMIT_INPUT, callerId: CALL })).toBe(false)
    expect(await verifyCommit(c, { ...COMMIT_INPUT, calleeId: CALL })).toBe(false)
    expect(await verifyCommit(c, { ...COMMIT_INPUT, callerId: CALLEE, calleeId: CALLER })).toBe(false)
  })

  it('a malformed commitment is false, not an exception', async () => {
    const c = await commit(COMMIT_INPUT)
    for (const bad of [c.slice(1), `${c}0`, `${c.slice(1)}g`, '', ` ${c}`, `${c}\n`, null, undefined, 42]) {
      expect(await verifyCommit(bad as string, COMMIT_INPUT)).toBe(false)
    }
  })

  it('malformed local inputs throw — a bug is not a verdict', async () => {
    const c = await commit(COMMIT_INPUT)
    await expectSasReject(verifyCommit(c, { ...COMMIT_INPUT, nA: seq(0, 31) }), 'bad_nonce')
    await expectSasReject(verifyCommit(c, { ...COMMIT_INPUT, fpA: seq(0, 20) }), 'bad_fingerprint')
    await expectSasReject(verifyCommit(c, { ...COMMIT_INPUT, callerId: 'nope' }), 'bad_uuid')
  })

  it('the full caller → callee flow verifies, and a swapped certificate does not', async () => {
    const nA = generateNonce()
    const C = await commit({ nA, fpA: FP_A, callerId: CALLER, calleeId: CALLEE }) // step 1, caller
    // step 5, callee: fpA is the REMOTE certificate in the callee's own getStats
    const honest = fingerprintsByRole('callee', { local: FP_B, remote: FP_A })
    expect(await verifyCommit(C, { nA, fpA: honest.fpA, callerId: CALLER, calleeId: CALLEE })).toBe(true)
    const mitm = fingerprintsByRole('callee', { local: FP_B, remote: seq(0x33) })
    expect(await verifyCommit(C, { nA, fpA: mitm.fpA, callerId: CALLER, calleeId: CALLEE })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

describe('constantTimeEqual', () => {
  it('compares bytes', () => {
    expect(constantTimeEqual(seq(1), seq(1))).toBe(true)
    expect(constantTimeEqual(seq(1), flipByte(seq(1), 0))).toBe(false)
    expect(constantTimeEqual(seq(1), flipByte(seq(1), 31))).toBe(false)
    expect(constantTimeEqual(seq(1, 31), seq(1, 32))).toBe(false)
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })

  it('has no early exit: every byte is read even when the first one differs', () => {
    let reads = 0
    const counted = (b: Uint8Array) =>
      new Proxy(b, {
        get(target, prop) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++
          return Reflect.get(target, prop)
        },
      })
    expect(constantTimeEqual(counted(seq(0)), counted(seq(0x99)))).toBe(false)
    expect(reads).toBe(64)
  })

  it('verifyCommit compares through it, never by re-hexing the expected digest (tripwire)', () => {
    const src = readFileSync(new URL('./sas.ts', import.meta.url), 'utf8')
    const start = src.indexOf('export async function verifyCommit')
    const body = src.slice(start, src.indexOf('\n}\n', start))
    expect(start).toBeGreaterThan(0)
    expect(body).toContain('constantTimeEqual(')
    expect(body).not.toContain('toHex(')
    expect(body).not.toMatch(/commitment\s*===|===\s*commitment/)
  })
})

// ---------------------------------------------------------------------------
// Nonces and wire encodings
// ---------------------------------------------------------------------------

describe('generateNonce', () => {
  it('returns 32 fresh bytes from crypto.getRandomValues', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const a = generateNonce()
    const b = generateNonce()
    expect(a).toBeInstanceOf(Uint8Array)
    expect(a).toHaveLength(32)
    expect(constantTimeEqual(a, b)).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(32)
  })

  it('refuses to run without WebCrypto rather than falling back to anything weaker', async () => {
    vi.stubGlobal('crypto', undefined)
    expectSasError(() => generateNonce(), 'no_crypto')
    await expectSasReject(commit(COMMIT_INPUT), 'no_crypto')
    await expectSasReject(computeSas(SAS_INPUT), 'no_crypto')
  })
})

describe('wire encodings', () => {
  it('nonce hex round-trips and is strict', () => {
    const n = generateNonce()
    expect(nonceFromHex(toHex(n))).toEqual(n)
    expect(nonceFromHex(toHex(n).toUpperCase())).toEqual(n)
    for (const bad of ['', '00', toHex(n).slice(2), `${toHex(n)}00`, `${toHex(n).slice(1)}x`, ` ${toHex(n)}`, 7]) {
      expectSasError(() => nonceFromHex(bad as string), 'bad_nonce')
    }
  })

  it('UUIDs: only the canonical 8-4-4-4-12 spelling, never the nil id', () => {
    expect(toHex(uuidToBytes(CALLER))).toBe('11111111222243338444555555555555')
    expect(uuidToBytes(CALLER.toUpperCase())).toEqual(uuidToBytes(CALLER))
    const bad = [
      '', 'nope', '1234', CALLER.replace(/-/g, ''), `{${CALLER}}`, `urn:uuid:${CALLER}`, ` ${CALLER}`, `${CALLER} `,
      CALLER.slice(1), `${CALLER}0`, CALLER.replace('1', 'g'), '00000000-0000-0000-0000-000000000000', undefined, 12,
    ]
    for (const id of bad) expectSasError(() => uuidToBytes(id as string), 'bad_uuid')
  })
})

// ---------------------------------------------------------------------------
// Input validation in commit / computeSas
// ---------------------------------------------------------------------------

describe('input validation', () => {
  it('fixed lengths: wrong-size or non-byte nonces and fingerprints are refused', async () => {
    await expectSasReject(commit({ ...COMMIT_INPUT, nA: seq(0, 33) }), 'bad_nonce')
    await expectSasReject(commit({ ...COMMIT_INPUT, fpA: seq(0, 31) }), 'bad_fingerprint')
    await expectSasReject(commit({ ...COMMIT_INPUT, nA: Array.from(N_A) as unknown as Uint8Array }), 'bad_nonce')
    await expectSasReject(computeSas({ ...SAS_INPUT, fpB: seq(0, 48) }), 'bad_fingerprint')
    await expectSasReject(computeSas({ ...SAS_INPUT, nB: new Uint8Array(0) }), 'bad_nonce')
    await expectSasReject(computeSas({ ...SAS_INPUT, callId: 'call-1' }), 'bad_uuid')
    await expectSasReject(commit({ ...COMMIT_INPUT, calleeId: 'x' }), 'bad_uuid')
  })

  it('one person, one certificate or one nonce on both sides is a bug or a reflection, never a call', async () => {
    await expectSasReject(commit({ ...COMMIT_INPUT, calleeId: CALLER.toUpperCase() }), 'same_party')
    await expectSasReject(computeSas({ ...SAS_INPUT, fpB: Uint8Array.from(FP_A) }), 'same_party')
    await expectSasReject(computeSas({ ...SAS_INPUT, nB: Uint8Array.from(N_A) }), 'same_party')
  })

  it('returns frozen results built from the frozen table', async () => {
    const sas = await computeSas(SAS_INPUT)
    expect(Object.isFrozen(sas)).toBe(true)
    expect(Object.isFrozen(sas.indices)).toBe(true)
    expect(Object.isFrozen(sas.emoji)).toBe(true)
    sas.indices.forEach((i, k) => expect(sas.emoji[k]).toBe(SAS_EMOJI[i]))
  })
})

// ---------------------------------------------------------------------------
// parseFingerprint
// ---------------------------------------------------------------------------

const FP_TEXT = 'B7:22:6C:5A:91:0D:3E:F4:18:A0:7C:E9:52:6B:D3:04:9F:21:88:C6:1E:75:AA:30:4D:E2:69:BF:07:93:5C:F8'

describe('parseFingerprint', () => {
  it('accepts the stats spelling and the SDP spelling, hex in any case', () => {
    const want = hexBytes(FP_TEXT)
    expect(parseFingerprint('sha-256', FP_TEXT)).toEqual(want)
    expect(parseFingerprint('sha-256', FP_TEXT.toLowerCase())).toEqual(want)
    expect(parseFingerprint('SHA-256', FP_TEXT.replace(/B7/, 'b7'))).toEqual(want)
    expect(parseFingerprint(`sha-256 ${FP_TEXT}`)).toEqual(want)
    expect(parseFingerprint(`sha-256 ${FP_TEXT}\r\n`)).toEqual(want) // an SDP line's trailing CRLF
    expect(parseFingerprint('sha-256', FP_TEXT)).toHaveLength(32)
  })

  it('formatFingerprint is its inverse', () => {
    expect(formatFingerprint(parseFingerprint('sha-256', FP_TEXT.toLowerCase()))).toBe(FP_TEXT)
    expectSasError(() => formatFingerprint(seq(0, 20)), 'bad_fingerprint')
  })

  it('refuses every other algorithm', () => {
    const sha1 = FP_TEXT.split(':').slice(0, 20).join(':')
    const sha384 = `${FP_TEXT}:${FP_TEXT.split(':').slice(0, 16).join(':')}`
    for (const [algorithm, value] of [
      ['sha-1', sha1], ['sha-1', FP_TEXT], ['sha-384', sha384], ['sha-384', FP_TEXT], ['sha-512', FP_TEXT],
      ['sha256', FP_TEXT], ['md5', FP_TEXT], ['', FP_TEXT], ['sha-224', FP_TEXT],
    ]) {
      expectSasError(() => parseFingerprint(algorithm, value), 'bad_fingerprint')
      expectSasError(() => parseFingerprint(`${algorithm} ${value}`), 'bad_fingerprint')
    }
  })

  it('refuses wrong lengths and junk', () => {
    const groups = FP_TEXT.split(':')
    const bad = [
      groups.slice(0, 31).join(':'), [...groups, 'AA'].join(':'), groups.join(''), `${FP_TEXT}:`, `:${FP_TEXT}`,
      FP_TEXT.replace('B7', 'G7'), FP_TEXT.replace('B7', 'B'), FP_TEXT.replace('B7:22', 'B7::22'),
      FP_TEXT.replace(':22', ': 22'), FP_TEXT.replace(/:/g, '-'), '', 'not a fingerprint',
    ]
    for (const v of bad) expectSasError(() => parseFingerprint('sha-256', v), 'bad_fingerprint')
    for (const v of [`sha-256  ${FP_TEXT} extra`, `a=fingerprint:sha-256 ${FP_TEXT}`, FP_TEXT, 'sha-256', '']) {
      expectSasError(() => parseFingerprint(v), 'bad_fingerprint')
    }
    // a stats object missing its fingerprint field stays on the two-argument path and fails there
    expectSasError(() => parseFingerprint('sha-256', undefined as unknown as string), 'bad_fingerprint')
    expectSasError(() => parseFingerprint(42 as unknown as string), 'bad_fingerprint')
  })
})

// ---------------------------------------------------------------------------
// fingerprintsFromStats — the only source of SAS fingerprints
// ---------------------------------------------------------------------------

const LOCAL = formatFingerprint(FP_A)
const REMOTE = formatFingerprint(FP_B)
const OTHER = formatFingerprint(seq(0x21))

/** Shapes as Chrome reports them: certificate ids are 'CF' + fingerprint. */
const cert = (fp: string, fingerprintAlgorithm = 'sha-256') => ({
  id: `CF${fp}`, type: 'certificate', timestamp: 1, fingerprint: fp, fingerprintAlgorithm, base64Certificate: 'MIIB',
})
const transport = (id: string, dtlsState: string, local?: string, remote?: string) => ({
  id, type: 'transport', timestamp: 1, dtlsState, dtlsRole: 'client', iceState: 'connected', iceRole: 'controlling',
  localCertificateId: local && `CF${local}`, remoteCertificateId: remote && `CF${remote}`,
  selectedCandidatePairId: 'CP1', srtpCipher: 'AES_CM_128_HMAC_SHA1_80', tlsVersion: 'FEFD',
})
const NOISE = [
  { id: 'CP1', type: 'candidate-pair', state: 'succeeded', nominated: true },
  { id: 'IT01A1', type: 'inbound-rtp', kind: 'audio', packetsReceived: 100 },
  { id: 'P', type: 'peer-connection', dataChannelsOpened: 0 },
]
const report = (...stats: { id: string }[]) => new Map(stats.map((s) => [s.id, s] as const))

describe('fingerprintsFromStats', () => {
  const connected = [transport('T01', 'connected', LOCAL, REMOTE), cert(LOCAL), cert(REMOTE), ...NOISE]

  it('follows the connected transport to both certificate stats', () => {
    const pair = fingerprintsFromStats(report(...connected))
    expect(pair).not.toBeNull()
    expect(pair!.local).toEqual(FP_A)
    expect(pair!.remote).toEqual(FP_B)
  })

  it('takes the report itself, report.values(), or an array of stats or of [id, stats] entries', () => {
    const want = { local: FP_A, remote: FP_B }
    expect(fingerprintsFromStats(report(...connected))).toEqual(want)
    expect(fingerprintsFromStats(report(...connected).values())).toEqual(want)
    expect(fingerprintsFromStats(connected)).toEqual(want)
    expect(fingerprintsFromStats([...report(...connected)])).toEqual(want)
  })

  it('is null until DTLS is connected', () => {
    for (const state of ['new', 'connecting', 'failed', 'closed']) {
      expect(fingerprintsFromStats(report(transport('T01', state, LOCAL), cert(LOCAL), ...NOISE))).toBeNull()
    }
    expect(fingerprintsFromStats(report(cert(LOCAL), ...NOISE))).toBeNull()
    expect(fingerprintsFromStats([])).toBeNull()
  })

  it('several connected transports must carry the same certificates (BUNDLE means one)', () => {
    const second = transport('T02', 'connected', LOCAL, REMOTE)
    expect(fingerprintsFromStats(report(...connected, second))).toEqual({ local: FP_A, remote: FP_B })
    const otherRemote = transport('T02', 'connected', LOCAL, OTHER)
    expectSasError(() => fingerprintsFromStats(report(...connected, otherRemote, cert(OTHER))), 'transport_mismatch')
    const otherLocal = transport('T02', 'connected', OTHER, REMOTE)
    expectSasError(() => fingerprintsFromStats(report(...connected, otherLocal, cert(OTHER))), 'transport_mismatch')
  })

  it('ignores a transport that is not connected, and catches it on the re-read once it is', () => {
    const pending = transport('T02', 'connecting', LOCAL, OTHER)
    expect(fingerprintsFromStats(report(...connected, pending, cert(OTHER)))).toEqual({ local: FP_A, remote: FP_B })
    const nowUp = transport('T02', 'connected', LOCAL, OTHER)
    expectSasError(() => fingerprintsFromStats(report(...connected, nowUp, cert(OTHER))), 'transport_mismatch')
  })

  it("no stats for THIS phone's certificate cannot be verified; no stats for the PEER's is the peer's doing", () => {
    // our own certificate is invisible: a browser gap → cert_stats_missing ("cannot verify")
    expectSasError(() => fingerprintsFromStats(report(transport('T01', 'connected'), cert(LOCAL), cert(REMOTE))), 'cert_stats_missing')
    // ours is visible and the peer's is not: libwebrtc emits no stats for a certificate whose signature algorithm it
    // does not know, and the peer chose that certificate (sas.review.test.ts) → remote_cert_rejected, a mismatch
    expectSasError(() => fingerprintsFromStats(report(transport('T01', 'connected', LOCAL), cert(LOCAL))), 'remote_cert_rejected')
    expectSasError(() => fingerprintsFromStats(report(transport('T01', 'connected', LOCAL, REMOTE), cert(LOCAL))), 'remote_cert_rejected')
    const pointsAtNoise = { ...transport('T01', 'connected', LOCAL), remoteCertificateId: 'CP1' }
    expectSasError(() => fingerprintsFromStats(report(pointsAtNoise, cert(LOCAL), ...NOISE)), 'remote_cert_rejected')
  })

  it('a certificate on another digest, or a garbled one, is refused — the peer\'s as remote_cert_rejected', () => {
    const sha1Remote = { ...cert(REMOTE, 'sha-1') }
    expectSasError(() => fingerprintsFromStats(report(connected[0], cert(LOCAL), sha1Remote)), 'remote_cert_rejected')
    const garbled = { ...cert(REMOTE), fingerprint: 'AB:CD' }
    expectSasError(() => fingerprintsFromStats(report(connected[0], cert(LOCAL), garbled)), 'remote_cert_rejected')
    // our OWN certificate in a shape we cannot read is this browser's gap, which the peer cannot reach → cert_stats_missing
    expectSasError(() => fingerprintsFromStats(report(connected[0], cert(LOCAL, 'sha-1'), cert(REMOTE))), 'cert_stats_missing')
  })
})

describe('roles: A is always the caller', () => {
  const callerStats = report(transport('T01', 'connected', LOCAL, REMOTE), cert(LOCAL), cert(REMOTE))
  const calleeStats = report(transport('T01', 'connected', REMOTE, LOCAL), cert(REMOTE), cert(LOCAL))

  it('both phones derive the same code from their own (mirror-image) stats', async () => {
    const onCaller = fingerprintsByRole('caller', fingerprintsFromStats(callerStats)!)
    const onCallee = fingerprintsByRole('callee', fingerprintsFromStats(calleeStats)!)
    expect(onCaller).toEqual({ fpA: FP_A, fpB: FP_B })
    expect(onCallee).toEqual({ fpA: FP_A, fpB: FP_B })
    const a = await computeSas({ callId: CALL, nA: N_A, nB: N_B, ...onCaller })
    const b = await computeSas({ callId: CALL, nA: N_A, nB: N_B, ...onCallee })
    expect(a.code32).toBe(b.code32)
    // the trap the helper exists for: local-first on both phones gives two different codes
    const naive = await computeSas({ callId: CALL, nA: N_A, nB: N_B, fpA: FP_B, fpB: FP_A })
    expect(naive.code32).not.toBe(a.code32)
  })

  it('refuses an unknown role instead of silently treating it as the callee', () => {
    expect(() => fingerprintsByRole('Caller' as 'caller', { local: FP_A, remote: FP_B })).toThrow(TypeError)
  })

  it('fingerprintPairEqual spots a moved certificate (frozen at first connect)', () => {
    const first = fingerprintsFromStats(callerStats)!
    expect(fingerprintPairEqual(first, fingerprintsFromStats(callerStats)!)).toBe(true)
    const swapped = report(transport('T01', 'connected', LOCAL, OTHER), cert(LOCAL), cert(OTHER))
    expect(fingerprintPairEqual(first, fingerprintsFromStats(swapped)!)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The 256-emoji table
// ---------------------------------------------------------------------------

/**
 * Every code point with Emoji=Yes at Emoji 3.0 or older (ASCII keycap bases left out), merged into ranges.
 * Generated 2026-10-21 from Unicode emoji-data.txt 18.0.0 — the ceiling is Unicode's data, not this list, so an
 * entry added later from a newer Emoji version fails here even if every other check passes.
 */
const EMOJI_3_0_RANGES = 'A9 AE 203C 2049 2122 2139 2194-2199 21A9-21AA 231A-231B 2328 23CF 23E9-23F3 23F8-23FA 24C2 25AA-25AB 25B6 25C0 25FB-25FE 2600-2604 260E 2611 2614-2615 2618 261D 2620 2622-2623 2626 262A 262E-262F 2638-263A 2648-2653 2660 2663 2665-2666 2668 267B 267F 2692-2694 2696-2697 2699 269B-269C 26A0-26A1 26AA-26AB 26B0-26B1 26BD-26BE 26C4-26C5 26C8 26CE-26CF 26D1 26D3-26D4 26E9-26EA 26F0-26F5 26F7-26FA 26FD 2702 2705 2708-270D 270F 2712 2714 2716 271D 2721 2728 2733-2734 2744 2747 274C 274E 2753-2755 2757 2763-2764 2795-2797 27A1 27B0 27BF 2934-2935 2B05-2B07 2B1B-2B1C 2B50 2B55 3030 303D 3297 3299 1F004 1F0CF 1F170-1F171 1F17E-1F17F 1F18E 1F191-1F19A 1F1E6-1F1FF 1F201-1F202 1F21A 1F22F 1F232-1F23A 1F250-1F251 1F300-1F321 1F324-1F393 1F396-1F397 1F399-1F39B 1F39E-1F3F0 1F3F3-1F3F5 1F3F7-1F4FD 1F4FF-1F53D 1F549-1F54E 1F550-1F567 1F56F-1F570 1F573-1F57A 1F587 1F58A-1F58D 1F590 1F595-1F596 1F5A4-1F5A5 1F5A8 1F5B1-1F5B2 1F5BC 1F5C2-1F5C4 1F5D1-1F5D3 1F5DC-1F5DE 1F5E1 1F5E3 1F5E8 1F5EF 1F5F3 1F5FA-1F64F 1F680-1F6C5 1F6CB-1F6D2 1F6E0-1F6E5 1F6E9 1F6EB-1F6EC 1F6F0 1F6F3-1F6F6 1F910-1F91E 1F920-1F927 1F930 1F933-1F93A 1F93C-1F93E 1F940-1F945 1F947-1F94B 1F950-1F95E 1F980-1F991 1F9C0'
const RANGES = EMOJI_3_0_RANGES.split(' ').map((r) => r.split('-').map((h) => parseInt(h, 16)))
const inEmoji30 = (cp: number) => RANGES.some(([a, b = a]) => cp >= a && cp <= b)
const baseOf = (char: string) => char.codePointAt(0)!
const has = (char: string) => SAS_EMOJI.some((e) => baseOf(e.char) === baseOf(char))

describe('SAS_EMOJI', () => {
  it('holds exactly 256 entries, frozen, and its order is pinned (the order is protocol)', async () => {
    expect(SAS_EMOJI).toHaveLength(256)
    expect(Object.isFrozen(SAS_EMOJI)).toBe(true)
    for (const e of SAS_EMOJI) expect(Object.isFrozen(e)).toBe(true)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SAS_EMOJI.map((e) => e.char).join('')))
    // A changed hash means old and new builds show different codes for the same call: new SAS tag + protocol bump.
    // Re-pinned at the commit gate (2026-10-21, before any build shipped): 🦉 🌻 🌙 🏝 🌏 🎤 📷 🔑 🛡 → 🥋 🌕 🌌 🛤 ⛳ 🔗 🌮 🗒 🛢.
    expect(toHex(new Uint8Array(digest))).toBe('f4c7ea82cd2af667c70e3d7d42330485629e4a66e44bf87662bf732580fa08a1')
  })

  it('has no duplicate emoji or names', () => {
    expect(new Set(SAS_EMOJI.map((e) => baseOf(e.char))).size).toBe(256)
    expect(new Set(SAS_EMOJI.map((e) => e.char)).size).toBe(256)
    expect(new Set(SAS_EMOJI.map((e) => e.en)).size).toBe(256)
    expect(new Set(SAS_EMOJI.map((e) => e.vi)).size).toBe(256)
  })

  it('every emoji is ONE code point, + U+FE0F exactly when the base defaults to text presentation', () => {
    for (const { char } of SAS_EMOJI) {
      const cps = Array.from(char)
      expect(cps.length === 1 || (cps.length === 2 && cps[1] === '\uFE0F'), char).toBe(true)
      const base = cps[0]
      expect(/^\p{Extended_Pictographic}$/u.test(base), char).toBe(true)
      expect(/^\p{Emoji}$/u.test(base), char).toBe(true)
      expect(cps.length === 1, `${char}: FE0F iff not Emoji_Presentation`).toBe(/^\p{Emoji_Presentation}$/u.test(base))
    }
  })

  it('nothing that takes a skin tone, no flags, no sequences, no keycaps', () => {
    for (const { char } of SAS_EMOJI) {
      expect(/\p{Emoji_Modifier_Base}/u.test(char), char).toBe(false)
      expect(/\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\u20E3|[\u{E0020}-\u{E007F}]/u.test(char), char).toBe(false)
      expect(/^[#*0-9]/.test(char), char).toBe(false)
    }
  })

  it('every emoji is from Emoji 3.0 or older (Android 7.0 renders them), per Unicode data', () => {
    expect(inEmoji30(0x1f436)).toBe(true) // dog face, E0.6 — the table is sane
    expect(inEmoji30(0x1f992)).toBe(false) // giraffe, E5.0
    expect(inEmoji30(0x1f96d)).toBe(false) // mango, E11.0
    expect(inEmoji30(0x2640)).toBe(false) // female sign, E4.0
    for (const { char } of SAS_EMOJI) expect(inEmoji30(baseOf(char)), char).toBe(true)
  })

  it('names are lowercase, NFC, 1–3 words, single-spaced', () => {
    const shape = /^[\p{Ll}\p{Lo}\p{M}0-9-]+(?: [\p{Ll}\p{Lo}\p{M}0-9-]+){0,2}$/u
    for (const { char, en, vi } of SAS_EMOJI) {
      for (const name of [en, vi]) {
        expect(name, char).toBe(name.toLowerCase())
        expect(name, char).toBe(name.normalize('NFC'))
        expect(shape.test(name), `${char} "${name}"`).toBe(true)
      }
    }
  })

  it('leaves out what must never appear in a code shown to two strangers', () => {
    const banned = [
      '🔒', '🔓', '🔏', '🔐', // mimic the call's lock indicator
      '✅', '❌', '⚠', '🚫', '⛔', '❗', '❓', // read as a verdict
      '🔇', '🔊', '🔋', '🎤', '📷', '📸', '☎', '📞', // mimic call controls
      '💰', '💵', '💳', '💸', '🏦', // money
      '🚓', '🚔', '🚨', // police (impersonation scams)
      '🐷', '🐖', '🐗', '🐽', // pork
      '✝', '☪', '✡', '🕉', '☸', '☯', '☦', '🛐', '⛪', '🕌', '🕍', '🕋', '⛩', '📿', '⚛', '🔯', '🕎', // belief
      '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '⛎', // zodiac
      '🍺', '🍻', '🍷', '🍸', '🍹', '🍶', '🍾', '🥂', '🥃', '🚬', '💉', '💊', // alcohol, tobacco, drugs
      '🔫', '🔪', '🗡', '⚔', '💣', '🏹', // weapons
      '💀', '☠', '⚰', '⚱', '🕯', '👻', // death
      '❤', '💋', '💘', '💌', '🍑', '🍆', '💦', // romance and innuendo
      '🍉', '🐵', '🐒', '🦍', '🗺', '🗾', '🗽', '🗼', // political or used as taunts
      '🌏', '🌍', '🌎', '🌐', '🌻', '🌙', '🌛', '🌜', // maps and globes, a solidarity symbol, the crescent (commit gate)
      '🦉', '💈', // a death omen with a vulgar toneless name; the barber pole of "hớt tóc" sex work (commit gate)
      '🔑', '🗝', '🛡', // with 🔒 they read as "secured" badges on a screen about encryption (commit gate)
      '♀', '♂', '⚕', // the only Emoji 4.0 single code points
    ]
    for (const char of banned) expect(has(char), char).toBe(false)
  })

  it('no name is the whole-word start or end of another, in either language — a listener hears one inside the other', () => {
    for (const lang of ['en', 'vi'] as const) {
      const names = SAS_EMOJI.map((e) => e[lang].split(' '))
      for (const a of names) {
        for (const b of names) {
          if (a === b || a.length >= b.length) continue
          const head = b.slice(0, a.length).join(' ') === a.join(' ')
          const tail = b.slice(b.length - a.length).join(' ') === a.join(' ')
          expect(head || tail, `${lang}: "${a.join(' ')}" inside "${b.join(' ')}"`).toBe(false)
        }
      }
    }
  })

  it('no short English rhyme pair is in the table together (ship/sheep and friends)', () => {
    const rhymes: [string, string][] = [
      ['ship', 'sheep'], ['bear', 'pear'], ['bear', 'gear'], ['pear', 'gear'], ['mouse', 'house'], ['cake', 'snake'],
      ['bee', 'key'], ['bee', 'tree'], ['bat', 'cat'], ['star', 'car'], ['phone', 'megaphone'], ['apple', 'pineapple'],
      ['corn', 'popcorn'], ['ant', 'elephant'], ['fire', 'fire engine'],
    ]
    const en = new Set(SAS_EMOJI.map((e) => e.en))
    for (const [a, b] of rhymes) expect(en.has(a) && en.has(b), `${a} + ${b}`).toBe(false)
  })

  it('no visually confusable twins (one per cluster, no colour-only variants)', () => {
    const twins: [string, string][] = [
      ['🐶', '🐕'], ['🐶', '🐺'], ['🐶', '🦊'], ['🐱', '🐈'], ['🐱', '🐯'], ['🐱', '🦊'], ['🐭', '🐁'], ['🐭', '🐀'],
      ['🐭', '🐹'], ['🐮', '🐄'], ['🐮', '🐂'], ['🐃', '🐂'], ['🐅', '🐯'], ['🐅', '🐆'], ['🐰', '🐇'], ['🐎', '🐴'],
      ['🦄', '🐴'], ['🐉', '🐲'], ['🐉', '🐊'], ['🐉', '🦎'], ['🐳', '🐋'], ['🐠', '🐟'], ['🐠', '🐡'], ['🐌', '🐚'],
      ['🐙', '🦑'], ['🐑', '🐐'], ['🐑', '🐏'], ['🐘', '🦏'], ['🐪', '🐫'], ['🐻', '🐨'], ['🐓', '🐔'], ['🐓', '🦃'],
      ['🐦', '🐤'], ['🐦', '🐥'], ['🦀', '🦂'], ['🍎', '🍏'], ['🍎', '🍅'], ['🥑', '🥝'], ['☕', '🍵'], ['🍕', '🧀'],
      ['🍚', '🍛'], ['🥚', '🍳'], ['🍗', '🍖'], ['🥖', '🍞'], ['🦐', '🍤'], ['🍦', '🍨'], ['🍦', '🍧'], ['🎂', '🍰'],
      ['🎸', '🎻'], ['🎺', '🎷'], ['🎺', '📯'], ['📷', '📸'], ['📷', '🎥'], ['📷', '📹'], ['📺', '📻'], ['💻', '⌨'],
      ['🎹', '⌨'], ['💻', '🖥'], ['🖨', '📠'], ['✏', '🖍'], ['✏', '🖊'], ['✏', '🖌'], ['☔', '☂'], ['☔', '🌂'],
      ['⭐', '🌟'], ['⭐', '✨'], ['⭐', '🌠'], ['🌙', '🌛'], ['⌛', '⏳'], ['⏰', '🕰'], ['⏰', '⏱'], ['🏮', '🎈'],
      ['🎆', '🎇'], ['🌊', '🌀'], ['🌪', '🌀'], ['🎉', '🎊'], ['🏅', '🥇'], ['🏆', '🥇'], ['⚽', '🏐'], ['🏈', '🏉'],
      ['🏒', '🏑'], ['🚗', '🚕'], ['🚗', '🚙'], ['🚗', '🏎'], ['🛵', '🏍'], ['🚂', '🚆'], ['🚌', '🚎'], ['🚌', '🚍'],
      ['🚑', '🚚'], ['🚢', '🛳'], ['🚤', '🛥'], ['✈', '🛩'], ['🚠', '🚡'], ['🔔', '🛎'], ['📣', '📢'], ['🎵', '🎶'],
      ['📚', '📖'], ['📚', '📕'], ['📁', '📂'], ['📅', '📆'], ['📌', '📍'], ['📎', '🖇'], ['📏', '📐'], ['🔑', '🗝'],
      ['🔨', '⛏'], ['🗄', '🗃'], ['🛏', '🛋'], ['🍀', '☘'], ['🍁', '🍂'], ['🌱', '🌿'], ['🌹', '🌺'], ['🌹', '🥀'],
      ['🌸', '💮'], ['🌻', '🌼'], ['🌲', '🎄'], ['⛄', '☃'], ['⛰', '🏔'], ['⛰', '🗻'], ['🏝', '🏜'], ['🏝', '🏖'],
      ['⛺', '🏕'], ['🌉', '🌃'], ['🌉', '🌁'], ['🏫', '🏥'], ['🏢', '🏨'], ['👜', '👛'], ['👜', '🛍'], ['👠', '👡'],
      ['👠', '👢'], ['👕', '🎽'], ['👕', '👚'], ['👓', '🕶'], ['💎', '💍'], ['🎮', '🎲'],
      ['🌴', '🏝'], ['🌕', '🌝'], ['🌕', '🌑'], ['🌕', '🌖'], ['🌮', '🌯'], ['🌮', '🥙'], ['🌌', '🌃'], ['🔗', '⛓'],
      ['🥋', '🥼'],
    ]
    for (const [kept, twin] of twins) {
      expect(has(kept) && has(twin), `${kept} + ${twin}`).toBe(false)
    }
  })
})
