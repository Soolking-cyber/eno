import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SDP_MAX_BYTES,
  normalizeLocalSdp,
  prepareRemoteSdp,
  sanitizeCandidateLine,
  sanitizeSdp,
  sdpFingerprint,
  validateRemoteSdp,
  type RelayFilterOptions,
  type SdpValidationOptions,
} from './sdp-guard'

/**
 * The SDP / candidate guard (DESIGN §3.2 steps 4–5, §2 Audio; review-refute-security objections 1, 4, 7).
 *
 * Fixtures (__fixtures__/*.sdp) are real browser shapes — Chrome and Safari offers under relay policy with their
 * half-trickled relay candidates, a Firefox offer (session-level fingerprint, alphabetical attributes, a=fmtp
 * before a=rtpmap) — plus the attacks the reviews named: a session-level decoy fingerprint, two fingerprints in
 * one m-section (libwebrtc obeys the LAST), an m-section outside BUNDLE, and a candidate list leaking host /
 * srflx / raddr / c= addresses. They are stored with LF so diffs stay readable and loaded as CRLF, which is what
 * browsers emit; the oversized description is generated here rather than committed as 64 KB of padding.
 * Addresses are documentation ranges (RFC 5737 / 3849): 203.0.113.10 and 2001:db8:10::10 play eno's relay,
 * 198.51.100.77 a user's public IP, 192.0.2.99 a relay that is not this call's provider.
 */
const load = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}.sdp`, import.meta.url)), 'utf8').replace(/\r?\n/g, '\r\n')

const CHROME = load('chrome-offer')
const SAFARI = load('safari-offer')
const FIREFOX = load('firefox-offer')
const DECOY = load('malicious-session-decoy')
const DOUBLE = load('malicious-double-fingerprint')
const OUTSIDE = load('malicious-outside-bundle')
const HOSTILE = load('malicious-candidates')

const CHROME_FP = '4A:9E:1B:7C:22:D5:83:F0:6B:91:3E:CC:58:A7:0F:14:B2:69:DE:45:8C:13:F7:2A:60:BD:94:E1:37:5F:C8:0D'
const SAFARI_FP = 'B3:07:5D:E2:91:4C:A8:36:F1:0B:7E:C4:29:D6:85:3A:EF:12:60:9B:C7:4D:38:A1:5E:F9:02:6C:B8:73:1D:E4'
const FIREFOX_FP = '6C:31:E8:0A:9F:57:D2:4B:13:AE:70:C9:85:3F:E6:21:98:5D:0C:B7:42:F3:6A:1E:D9:84:27:BC:50:0F:E3:96'
const DECOY_FP = 'D1:5C:0E:88:3B:A2:47:F9:6E:21:BC:73:09:D4:5A:E6:1F:82:C5:3D:97:4E:A0:68:2B:F1:56:CD:0A:93:E7:44'
const REAL_FP = '9C:E4:27:B1:6D:03:F8:5A:C2:7E:91:4F:D6:38:AB:12:E5:70:4B:C9:2F:86:1D:A3:5E:F0:67:B4:0C:D9:82:3B'

const RELAYS: ReadonlySet<string> = new Set(['203.0.113.10', '2001:db8:10::10'])
const ALLOW: RelayFilterOptions = { allowedRelayIps: RELAYS }

const codes = (sdp: string, opts?: SdpValidationOptions): string[] => validateRemoteSdp(sdp, opts).errors.map((e) => e.code)
const lines = (sdp: string): string[] => sdp.split('\r\n')
const lineNo = (sdp: string, line: string): number => lines(sdp).indexOf(line) + 1
const keep = (line: string, relays: ReadonlySet<string> = RELAYS): string | null =>
  sanitizeCandidateLine(line, { allowedRelayIps: relays })
/** true when some LF is not part of a CRLF. */
const bareLf = (s: string): boolean => /(^|[^\r])\n/.test(s)

/** Replaces exactly one occurrence — throws otherwise, so a fixture edit cannot silently void a test. */
function swap(sdp: string, from: string, to: string): string {
  const at = sdp.indexOf(from)
  if (at === -1 || sdp.indexOf(from, at + 1) !== -1) throw new Error(`expected exactly one ${JSON.stringify(from)}`)
  return sdp.slice(0, at) + to + sdp.slice(at + from.length)
}
function swapAll(sdp: string, from: string, to: string): string {
  if (sdp.indexOf(from) === -1) throw new Error(`expected ${JSON.stringify(from)}`)
  return sdp.split(from).join(to)
}
const CHROME_FP_LINE = `a=fingerprint:sha-256 ${CHROME_FP}`
const CHROME_VIDEO_MID = 'a=setup:actpass\r\na=mid:1\r\n'

function oversized(): string {
  // Structurally valid padding (a=ssrc lines at the end of the video section), so size is the ONLY failure.
  const pad = 'a=ssrc:3820415297 x-pad:' + 'x'.repeat(200) + '\r\n'
  let sdp = CHROME
  while (sdp.length <= SDP_MAX_BYTES) sdp += pad
  return sdp
}

// ---------------------------------------------------------------------------------------------------------------
describe('validateRemoteSdp — honest browsers pass', () => {
  it('Chrome and Safari offers (relay candidates, BUNDLE audio+video, every codec) are accepted', () => {
    expect(validateRemoteSdp(CHROME)).toEqual({ ok: true, errors: [] })
    expect(validateRemoteSdp(SAFARI)).toEqual({ ok: true, errors: [] })
  })

  it('answers (setup active / passive) are accepted like offers (actpass)', () => {
    expect(codes(swapAll(CHROME, 'a=setup:actpass', 'a=setup:active'))).toEqual([])
    expect(codes(swapAll(SAFARI, 'a=setup:actpass', 'a=setup:passive'))).toEqual([])
  })

  it('LF-only line endings are accepted (libwebrtc reads them); the CRLF is not what the rules are about', () => {
    expect(codes(CHROME.replace(/\r\n/g, '\n'))).toEqual([])
  })

  it('Firefox as it comes is refused (session-level fingerprint); its own sender fixes that with normalizeLocalSdp', () => {
    expect(codes(FIREFOX)).toEqual(['session_fingerprint', 'fingerprint_count', 'fingerprint_count'])
    expect(validateRemoteSdp(normalizeLocalSdp(FIREFOX))).toEqual({ ok: true, errors: [] })
  })
})

describe('validateRemoteSdp — ⛔ one fingerprint, said once per m-section, the same everywhere (objection 1)', () => {
  it('a session-level DECOY is refused even when every m-section agrees on the real one', () => {
    expect(validateRemoteSdp(DECOY).errors).toEqual([{ code: 'session_fingerprint', line: 5 }])
  })

  it('two fingerprints in one m-section are refused — libwebrtc would obey the LAST (the grinding slot)', () => {
    const errors = validateRemoteSdp(DOUBLE).errors
    expect(errors).toContainEqual({ code: 'fingerprint_count', section: 0, line: lineNo(DOUBLE, `a=fingerprint:sha-256 ${REAL_FP}`) })
    expect(errors.map((e) => e.code)).toEqual(['fingerprint_count', 'fingerprint_mismatch'])
  })

  it('even two IDENTICAL lines in one m-section are refused: exactly one, not "one value"', () => {
    const twice = swap(CHROME, `${CHROME_FP_LINE}\r\na=setup:actpass\r\na=mid:0`, `${CHROME_FP_LINE}\r\n${CHROME_FP_LINE}\r\na=setup:actpass\r\na=mid:0`)
    expect(codes(twice)).toEqual(['fingerprint_count'])
  })

  it('an m-section with no fingerprint is refused (it would inherit whatever else the parser has)', () => {
    const missing = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, CHROME_VIDEO_MID)
    expect(validateRemoteSdp(missing).errors).toEqual([{ code: 'fingerprint_count', section: 1 }])
  })

  it('m-sections naming different certificates are refused', () => {
    const split = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, `a=fingerprint:sha-256 ${DECOY_FP}\r\n${CHROME_VIDEO_MID}`)
    expect(codes(split)).toEqual(['fingerprint_mismatch'])
  })

  it('sha-256 only: sha-1 and sha-512 are refused, a garbled algorithm too', () => {
    const sha1 = 'a=fingerprint:sha-1 4A:9E:1B:7C:22:D5:83:F0:6B:91:3E:CC:58:A7:0F:14:B2:69:DE:45'
    expect(codes(swap(CHROME, `${CHROME_FP_LINE}\r\na=setup:actpass\r\na=mid:0`, `${sha1}\r\na=setup:actpass\r\na=mid:0`))).toEqual([
      'fingerprint_algorithm',
    ])
    expect(codes(swapAll(CHROME, 'sha-256 ', 'sha-512 '))).toEqual(['fingerprint_algorithm', 'fingerprint_algorithm'])
    expect(codes(swapAll(CHROME, 'sha-256 ', 'sha_256! '))).toEqual(['fingerprint_invalid', 'fingerprint_invalid'])
  })

  it('the algorithm is case-insensitive and hex case is normalised — libwebrtc reads both, so these are the SAME', () => {
    expect(codes(swapAll(CHROME, 'sha-256 ', 'SHA-256 '))).toEqual([])
    const lower = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, `a=fingerprint:sha-256 ${CHROME_FP.toLowerCase()}\r\n${CHROME_VIDEO_MID}`)
    expect(codes(lower)).toEqual([])
  })

  it('malformed digests and lines are refused: 31 or 33 bytes, non-hex, a double or trailing space, no colon', () => {
    const bad = [
      `a=fingerprint:sha-256 ${CHROME_FP.slice(3)}`,
      `a=fingerprint:sha-256 ${CHROME_FP}:00`,
      `a=fingerprint:sha-256 ${CHROME_FP.replace('4A', 'ZZ')}`,
      `a=fingerprint:sha-256  ${CHROME_FP}`,
      `a=fingerprint:sha-256 ${CHROME_FP} `,
      `a=fingerprint sha-256 ${CHROME_FP}`,
      `a=fingerprint:sha-256`,
      `a=fingerprint`,
    ]
    for (const line of bad) {
      const sdp = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, `${line}\r\n${CHROME_VIDEO_MID}`)
      expect(codes(sdp), line).toContain('fingerprint_invalid')
    }
  })

  it('a capitalised fingerprint attribute still COUNTS (a lenient parser would obey it) and is refused as malformed', () => {
    const shout = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, `a=FINGERPRINT:sha-256 ${CHROME_FP}\r\n${CHROME_VIDEO_MID}`)
    expect(codes(shout)).toEqual(['malformed'])
    const smuggled = swap(CHROME, CHROME_VIDEO_MID, `${CHROME_VIDEO_MID}a=Fingerprint:sha-256 ${DECOY_FP}\r\n`)
    expect(codes(smuggled)).toEqual(['malformed', 'fingerprint_count', 'fingerprint_mismatch'])
  })
})

describe('validateRemoteSdp — exactly one BUNDLE group holding every m-section', () => {
  it('an m-section outside the group is refused', () => {
    expect(validateRemoteSdp(OUTSIDE).errors).toEqual([{ code: 'bundle_membership', section: 1 }])
  })

  it('a group mid that names no m-section is refused', () => {
    expect(validateRemoteSdp(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0 1 2')).errors).toEqual([
      { code: 'bundle_membership', line: 5 },
    ])
  })

  it('no group, or two groups, is refused', () => {
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1\r\n', ''))).toEqual(['bundle_count'])
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0\r\na=group:BUNDLE 1'))).toEqual(['bundle_count'])
  })

  it('a lowercase "bundle" group is refused — alone it is no group to libwebrtc, beside the real one it is a second', () => {
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:bundle 0 1'))).toEqual(['bundle_invalid'])
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0 1\r\na=group:bundle 0 1'))).toEqual(['bundle_count'])
  })

  it('a group inside an m-section, or listing a mid twice, is refused', () => {
    const moved = swap(swap(CHROME, 'a=group:BUNDLE 0 1\r\n', ''), 'a=mid:0\r\n', 'a=mid:0\r\na=group:BUNDLE 0 1\r\n')
    expect(validateRemoteSdp(moved).errors).toEqual([{ code: 'bundle_invalid', section: 0, line: lineNo(moved, 'a=group:BUNDLE 0 1') }])
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0 0 1'))).toEqual(['bundle_invalid'])
  })

  it('⚠️ a REJECTED m-section (port 0, out of the group) is refused, not degraded to audio', () => {
    const rejected = swap(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0'), 'm=video 9 ', 'm=video 0 ')
    expect(validateRemoteSdp(rejected).errors).toEqual([{ code: 'bundle_membership', section: 1 }])
    // …while Firefox's port-0 a=bundle-only section is IN the group and passes.
    expect(lines(normalizeLocalSdp(FIREFOX))).toContain('a=bundle-only')
    expect(validateRemoteSdp(normalizeLocalSdp(FIREFOX)).ok).toBe(true)
  })

  it('other group semantics (e.g. LS) are not BUNDLE and do not count', () => {
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0 1\r\na=group:LS 0 1'))).toEqual([])
  })
})

describe('validateRemoteSdp — mids', () => {
  it('an m-section without a mid cannot be in the group', () => {
    expect(validateRemoteSdp(swap(CHROME, CHROME_VIDEO_MID, 'a=setup:actpass\r\n')).errors).toEqual([
      { code: 'mid_invalid', section: 1 },
      { code: 'bundle_membership', section: 1 },
      { code: 'bundle_membership', line: 5 },
    ])
  })

  it('a mid shared by two m-sections, two a=mid lines in one, a non-token mid, a session-level mid: refused', () => {
    expect(codes(swap(CHROME, CHROME_VIDEO_MID, 'a=setup:actpass\r\na=mid:0\r\n'))).toContain('mid_invalid')
    expect(codes(swap(CHROME, CHROME_VIDEO_MID, 'a=setup:actpass\r\na=mid:1\r\na=mid:2\r\n'))).toContain('mid_invalid')
    expect(codes(swap(CHROME, CHROME_VIDEO_MID, 'a=setup:actpass\r\na=mid:1 x\r\n'))).toContain('mid_invalid')
    expect(validateRemoteSdp(swap(CHROME, 'a=extmap-allow-mixed', 'a=extmap-allow-mixed\r\na=mid:0')).errors).toEqual([
      { code: 'mid_invalid', line: 7 },
    ])
  })
})

describe('validateRemoteSdp — DTLS role: actpass / active / passive only (RFC 8842 §5.1 forbids holdconn)', () => {
  it('holdconn, unknown values, other spellings and an empty value are refused', () => {
    for (const value of ['holdconn', 'bogus', 'ACTIVE', 'Actpass', '', 'active passive']) {
      const sdp = swap(CHROME, `a=setup:actpass\r\na=mid:1`, `a=setup:${value}\r\na=mid:1`)
      expect(validateRemoteSdp(sdp).errors, value).toEqual([{ code: 'setup_invalid', section: 1, line: lineNo(sdp, `a=setup:${value}`) }])
    }
    expect(codes(swap(CHROME, `a=setup:actpass\r\na=mid:1`, `a=setup\r\na=mid:1`))).toEqual(['setup_invalid'])
  })

  it('two a=setup lines at one level are refused', () => {
    expect(codes(swap(CHROME, `a=setup:actpass\r\na=mid:1`, `a=setup:actpass\r\na=setup:active\r\na=mid:1`))).toEqual(['setup_invalid'])
  })
})

describe('validateRemoteSdp — size', () => {
  it(`refuses more than ${SDP_MAX_BYTES} bytes by default, without parsing it`, () => {
    const big = oversized()
    expect(validateRemoteSdp(big)).toEqual({ ok: false, errors: [{ code: 'too_large' }] })
    expect(codes(big, { maxBytes: 1 << 20 })).toEqual([]) // the padding is valid SDP: size was the only problem
  })

  it('maxBytes is inclusive', () => {
    const n = Buffer.byteLength(CHROME, 'utf8')
    expect(codes(CHROME, { maxBytes: n })).toEqual([])
    expect(codes(CHROME, { maxBytes: n - 1 })).toEqual(['too_large'])
  })

  it('counts UTF-8 bytes, not UTF-16 units', () => {
    const vi = swap(CHROME, 's=-', 's=Cuộc gọi eno')
    const units = vi.length
    const bytes = Buffer.byteLength(vi, 'utf8')
    expect(bytes).toBeGreaterThan(units)
    expect(codes(vi, { maxBytes: units })).toEqual(['too_large'])
    expect(codes(vi, { maxBytes: bytes })).toEqual([])
  })

  it('a nonsense maxBytes means the default, never "no limit"', () => {
    for (const maxBytes of [NaN, -1, 0, Infinity]) {
      expect(codes(CHROME, { maxBytes }), String(maxBytes)).toEqual([])
      expect(codes(oversized(), { maxBytes }), String(maxBytes)).toEqual(['too_large'])
    }
    expect(validateRemoteSdp(CHROME, null as unknown as SdpValidationOptions)).toEqual({ ok: true, errors: [] })
    expect(validateRemoteSdp(oversized(), null as unknown as SdpValidationOptions).ok).toBe(false)
  })
})

describe('validateRemoteSdp — text every parser reads the same way', () => {
  const onlyMalformed = (sdp: string): boolean => {
    const c = codes(sdp)
    return c.length > 0 && c.every((x) => x === 'malformed')
  }

  it('must start with v=0 — no other version, no BOM, no blank line first', () => {
    expect(codes(swap(CHROME, 'v=0', 'v=1'))).toEqual(['malformed'])
    expect(onlyMalformed('﻿' + CHROME)).toBe(true)
    expect(onlyMalformed('\r\n' + CHROME)).toBe(true)
  })

  it('⚠️ a trimmed SDP is refused — libwebrtc refuses an unterminated last line ("Invalid SDP line.")', () => {
    expect(codes(CHROME.trim())).toEqual(['malformed'])
  })

  it('control characters are refused: a bare CR, NUL, TAB, DEL', () => {
    for (const ch of ['\r', '\u0000', '\t', '\u007f']) {
      expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', `a=group:BUNDLE${ch}0 1`)), JSON.stringify(ch)).toContain('malformed')
    }
  })

  it('lines libwebrtc would stop at are refused: empty, capital type, a space after "=", too short', () => {
    for (const line of ['', 'A=sendrecv', 'a= sendrecv', 'a=', 'x']) {
      expect(codes(swap(CHROME, 'a=extmap-allow-mixed', line)), JSON.stringify(line)).toContain('malformed')
    }
  })

  it('a capitalised attribute name of ANY kind is refused', () => {
    expect(codes(swap(CHROME, 'a=extmap-allow-mixed', 'a=Extmap-Allow-Mixed'))).toEqual(['malformed'])
  })

  it('no media, an empty string, or not a string at all', () => {
    expect(codes('v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE\r\n')).toEqual(['no_media'])
    expect(codes('')).toEqual(['malformed'])
    expect(codes(undefined as unknown as string)).toEqual(['malformed'])
  })

  it('⚠️ errors never carry SDP text — no fingerprints, ICE passwords or addresses reach a log', () => {
    for (const sdp of [DOUBLE, HOSTILE, DECOY]) {
      const report = JSON.stringify(validateRemoteSdp(sdp))
      for (const secret of ['D1:5C', '9C:E4', '4A:9E', 'x3V7nR2m', '203.0.113', '198.51.100', '192.168']) {
        expect(report).not.toContain(secret)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('sdpFingerprint — the one certificate a description means, or null', () => {
  it('returns the media-level value in uppercase colon hex', () => {
    expect(sdpFingerprint(CHROME)).toBe(CHROME_FP)
    expect(sdpFingerprint(SAFARI)).toBe(SAFARI_FP)
    expect(sdpFingerprint(swapAll(CHROME, CHROME_FP, CHROME_FP.toLowerCase()))).toBe(CHROME_FP)
  })

  it('null whenever the description does not mean exactly one certificate', () => {
    const missing = swap(CHROME, `${CHROME_FP_LINE}\r\n${CHROME_VIDEO_MID}`, CHROME_VIDEO_MID)
    const sha1 = swapAll(CHROME, `sha-256 ${CHROME_FP}`, 'sha-1 4A:9E:1B:7C:22:D5:83:F0:6B:91:3E:CC:58:A7:0F:14:B2:69:DE:45')
    for (const sdp of [FIREFOX, DECOY, DOUBLE, missing, sha1]) expect(sdpFingerprint(sdp)).toBeNull()
  })

  it('null for a malformed description, no media, or not a string', () => {
    expect(sdpFingerprint(CHROME.trim())).toBeNull()
    expect(sdpFingerprint(swap(CHROME, 'a=extmap-allow-mixed', 'a=Extmap-Allow-Mixed'))).toBeNull()
    expect(sdpFingerprint('v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n')).toBeNull()
    expect(sdpFingerprint('')).toBeNull()
    expect(sdpFingerprint(null as unknown as string)).toBeNull()
  })

  it('a re-offer that only restarts ICE keeps the value; one with another certificate changes it', () => {
    const restart = swapAll(swapAll(CHROME, 'a=ice-ufrag:K9pL', 'a=ice-ufrag:Zr2u'), 'x3V7nR2mQ8sT5wY1zB4cD6fG', 'p0Lk9Jh8Gf7Ds6Az5Xc4Vb3N')
    expect(sdpFingerprint(restart)).toBe(sdpFingerprint(CHROME))
    expect(sdpFingerprint(swapAll(CHROME, CHROME_FP, DECOY_FP))).toBe(DECOY_FP)
  })

  it('Firefox, once its sender normalised it, means its one certificate', () => {
    expect(sdpFingerprint(normalizeLocalSdp(FIREFOX))).toBe(FIREFOX_FP)
  })
})

// ---------------------------------------------------------------------------------------------------------------
const RELAY_V4 = 'candidate:1467250027 1 udp 41885439 203.0.113.10 50002 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag K9pL network-id 1 network-cost 10'
const RELAY_V6 = 'candidate:2785394137 1 udp 41887999 2001:db8:10::10 50004 typ relay raddr :: rport 0 generation 0 ufrag K9pL network-id 2 network-cost 10'

describe('sanitizeCandidateLine — honest relay candidates survive unchanged', () => {
  it('Chrome/Safari relay candidates round-trip byte-identical, in all three forms', () => {
    expect(keep(RELAY_V4)).toBe(RELAY_V4)
    expect(keep(RELAY_V6)).toBe(RELAY_V6)
    expect(keep('a=' + RELAY_V4)).toBe('a=' + RELAY_V4)
    const init: RTCIceCandidateInit = { candidate: RELAY_V4, sdpMid: '0', sdpMLineIndex: 0 }
    expect(keep(init.candidate as string)).toBe(RELAY_V4)
  })

  it('TURN-over-TCP/TLS relays are UDP candidates with a lower priority, and are kept', () => {
    const tls = 'candidate:3348186236 1 udp 8331007 203.0.113.10 50008 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10'
    expect(keep(tls)).toBe(tls)
  })

  it('one trailing line break is tolerated (libwebrtc does) and not carried', () => {
    expect(keep(RELAY_V4 + '\r\n')).toBe(RELAY_V4)
    expect(keep(RELAY_V4 + '\n')).toBe(RELAY_V4)
  })
})

describe('sanitizeCandidateLine — ⛔ relay only, this call\'s relay only', () => {
  it('drops host, srflx and prflx — private, public, IPv6 ULA / link-local, mDNS — whatever the address', () => {
    for (const line of [
      'candidate:2999745851 1 udp 2122260223 192.168.1.23 61234 typ host generation 0',
      'candidate:1052210511 1 udp 2122194687 10.0.0.5 61236 typ host generation 0',
      'candidate:3863918431 1 udp 2122129151 fd12:3456:789a::5 61238 typ host generation 0',
      'candidate:2405519162 1 udp 2122063615 fe80::1c2b:3a4d:5e6f:7081 61240 typ host generation 0',
      'candidate:417368712 1 udp 2113937151 4f0c2b1e-8a3d-4c5e-9f7a-1b2c3d4e5f60.local 61242 typ host generation 0',
      'candidate:1938417503 1 udp 1686052607 198.51.100.77 61234 typ srflx raddr 192.168.1.23 rport 61234 generation 0',
      'candidate:3101745280 1 udp 1845501695 198.51.100.77 61250 typ prflx raddr 192.168.1.23 rport 61250 generation 0',
      'candidate:1 1 udp 2122260223 203.0.113.10 50002 typ host generation 0', // an allowed address does not make a host a relay
      'candidate:1 1 udp 1686052607 203.0.113.10 50002 typ srflx raddr 0.0.0.0 rport 0 generation 0',
    ]) {
      expect(keep(line), line).toBeNull()
    }
  })

  it('drops a relay at any address outside the allow-list (another provider, a stranger\'s server)', () => {
    expect(keep('candidate:4003162377 1 udp 41885439 192.0.2.99 50010 typ relay raddr 0.0.0.0 rport 0 generation 0')).toBeNull()
    expect(keep('candidate:4003162377 1 udp 41885439 2001:db8:11::10 50010 typ relay raddr :: rport 0 generation 0')).toBeNull()
  })

  it('compares IPv6 canonically on both sides: expanded, uppercase and compressed spellings are one address', () => {
    expect(keep(RELAY_V6.replace('2001:db8:10::10', '2001:0DB8:0010:0000:0000:0000:0000:0010'))).toBe(RELAY_V6)
    expect(keep(RELAY_V6, new Set(['2001:0db8:0010::0010']))).toBe(RELAY_V6)
  })

  it('an IPv4-mapped IPv6 address does not match an IPv4 entry', () => {
    expect(keep(RELAY_V4.replace('203.0.113.10', '::ffff:203.0.113.10'))).toBeNull()
    expect(keep(RELAY_V4.replace('203.0.113.10', '::ffff:203.0.113.10'), new Set(['::ffff:203.0.113.10']))).toBe(
      RELAY_V4.replace('203.0.113.10 50002 typ relay raddr 0.0.0.0', '::ffff:203.0.113.10 50002 typ relay raddr ::'),
    )
  })

  it('strict IP literals only: no leading zeros (octal to inet_aton), short forms, hex, zones or brackets', () => {
    for (const address of ['203.0.113.010', '203.0.113', '0xcb.0.113.10', '203.0.113.10.1', '203.0.113.256', 'fe80::1%en0', '[2001:db8:10::10]', '2001:db8:10::10::1', '2001:db8:10:0:0:0:0:0:10']) {
      expect(keep(RELAY_V4.replace('203.0.113.10', address), new Set([...RELAYS, address])), address).toBeNull()
    }
  })

  it('CIDR entries (Cloudflare relays from ranges): inside kept, outside dropped', () => {
    const v4 = new Set(['203.0.113.0/24'])
    expect(keep(RELAY_V4.replace('203.0.113.10', '203.0.113.77'), v4)).toBe(RELAY_V4.replace('203.0.113.10', '203.0.113.77'))
    expect(keep(RELAY_V4.replace('203.0.113.10', '203.0.114.1'), v4)).toBeNull()
    const v6 = new Set(['2001:db8:10::/48'])
    expect(keep(RELAY_V6.replace('2001:db8:10::10', '2001:db8:10:ffff::1'), v6)).toBe(RELAY_V6.replace('2001:db8:10::10', '2001:db8:10:ffff::1'))
    expect(keep(RELAY_V6.replace('2001:db8:10::10', '2001:db8:11::1'), v6)).toBeNull()
    expect(keep(RELAY_V4, new Set(['203.0.113.0/31']))).toBeNull()
    expect(keep(RELAY_V4, new Set(['203.0.113.8/29']))).toBe(RELAY_V4)
  })

  it('a too-broad prefix, host bits set, or a bad length is IGNORED — a typo fails closed', () => {
    // Every entry below WOULD contain the candidate if it were honoured.
    const v4 = RELAY_V4.replace('203.0.113.10', '203.0.113.77')
    for (const entry of ['0.0.0.0/0', '128.0.0.0/1', '200.0.0.0/5', '203.0.113.10/24', '203.0.113.0/33', '203.0.113.0/abc', '203.0.113.0/', ' /24']) {
      expect(keep(v4, new Set([entry])), entry).toBeNull()
    }
    expect(keep(v4, new Set(['203.0.0.0/8']))).toBe(v4) // the broadest prefix still honoured
    for (const entry of ['::/0', '2000::/3', '2001::/15', '2001:db8::/16', '2001:db8:10::/129']) {
      expect(keep(RELAY_V6, new Set([entry])), entry).toBeNull()
    }
    expect(keep(RELAY_V6, new Set(['2001::/16']))).toBe(RELAY_V6)
  })

  it('no allow-list, an empty one, or garbage entries: everything is dropped', () => {
    expect(keep(RELAY_V4, new Set())).toBeNull()
    expect(sanitizeCandidateLine(RELAY_V4, undefined as unknown as RelayFilterOptions)).toBeNull()
    expect(keep(RELAY_V4, new Set(['relay.eno.vn', '', ' ']))).toBeNull()
  })
})

describe('sanitizeCandidateLine — rebuilt from validated fields', () => {
  it('rewrites a leaked related address to the zero address of the candidate\'s family, rport 0', () => {
    expect(keep(RELAY_V4.replace('raddr 0.0.0.0 rport 0', 'raddr 198.51.100.77 rport 61234'))).toBe(RELAY_V4)
    expect(keep(RELAY_V6.replace('raddr :: rport 0', 'raddr 2001:db8:77::77 rport 61260'))).toBe(RELAY_V6)
    expect(keep(RELAY_V4.replace('raddr 0.0.0.0 rport 0', 'raddr 198.51.100.77'))).toBe(RELAY_V4)
  })

  it('adds raddr/rport when absent (RFC 8839: MUST for relayed candidates) — the output form is fixed', () => {
    expect(keep('candidate:0 1 UDP 92217087 203.0.113.10 50000 typ relay')).toBe(
      'candidate:0 1 udp 92217087 203.0.113.10 50000 typ relay raddr 0.0.0.0 rport 0',
    )
  })

  it('keeps only generation / ufrag / network-id / network-cost, in libwebrtc\'s order, whatever the input order', () => {
    expect(
      keep(
        'candidate:2785394137 1 UDP 41887999 2001:db8:10::10 50004 typ relay raddr 2001:db8:77::77 rport 61260 network-cost 10 pwd x3V7nR2mQ8sT5wY1zB4cD6fG x-eno-smuggle 198.51.100.77 tcptype passive network-id 2 ufrag K9pL generation 0',
      ),
    ).toBe(RELAY_V6)
  })

  it('an invalid extension value drops that attribute, not the candidate; a repeated one keeps its last value', () => {
    expect(keep(RELAY_V4.replace('generation 0', 'generation -1').replace('network-id 1', 'network-id 70000'))).toBe(
      'candidate:1467250027 1 udp 41885439 203.0.113.10 50002 typ relay raddr 0.0.0.0 rport 0 ufrag K9pL network-cost 10',
    )
    expect(keep(RELAY_V4.replace('ufrag K9pL', 'ufrag K9p'))).toBe(RELAY_V4.replace(' ufrag K9pL', ''))
    expect(keep(RELAY_V4.replace('generation 0', 'generation 0 generation 2'))).toBe(RELAY_V4.replace('generation 0', 'generation 2'))
  })

  it('numbers are written canonically', () => {
    expect(keep(RELAY_V4.replace(' 1 udp 41885439 ', ' 01 udp 0041885439 '))).toBe(RELAY_V4)
  })

  it('transport must be UDP (Firefox writes "UDP"); tcp / ssltcp / tls "relays" are dropped', () => {
    expect(keep(RELAY_V4.replace(' udp ', ' UDP '))).toBe(RELAY_V4)
    for (const t of ['tcp', 'TCP', 'ssltcp', 'tls']) {
      expect(keep(RELAY_V4.replace(' udp ', ` ${t} `) + ' tcptype passive'), t).toBeNull()
    }
  })

  it('recognises any capitalisation of the attribute (a lenient parser would) and writes it canonically', () => {
    expect(keep('a=CANDIDATE:' + RELAY_V4.slice('candidate:'.length))).toBe('a=' + RELAY_V4)
    expect(keep('Candidate:' + RELAY_V4.slice('candidate:'.length))).toBe(RELAY_V4)
  })

  it('drops anything malformed', () => {
    const f = RELAY_V4.split(' ')
    const bad = [
      f.slice(0, 7).join(' '), // fewer than 8 fields
      RELAY_V4.replace('typ relay', 'TYP relay'),
      RELAY_V4.replace('typ relay', 'typ RELAY'),
      RELAY_V4.replace(' 50002 ', ' 0 '),
      RELAY_V4.replace(' 50002 ', ' 65536 '),
      RELAY_V4.replace(' 50002 ', ' 50002x '),
      RELAY_V4.replace(' 41885439 ', ' 4294967296 '),
      RELAY_V4.replace(' 41885439 ', ' -41885439 '),
      RELAY_V4.replace(':1467250027 1 ', ':1467250027 0 '),
      RELAY_V4.replace(':1467250027 1 ', ':1467250027 257 '),
      RELAY_V4.replace('1467250027', 'x'.repeat(33)),
      RELAY_V4.replace('1467250027', 'abc-def'),
      RELAY_V4.replace('typ relay', 'typ relay\r\nraddr'),
      RELAY_V4.replace(' udp ', '\tudp '),
      RELAY_V4.replace('candidate:', 'candidate'),
      'a=end-of-candidates',
      'a=candidate:' + 'x'.repeat(1100),
      '',
    ]
    for (const line of bad) expect(keep(line), JSON.stringify(line)).toBeNull()
    expect(keep(undefined as unknown as string)).toBeNull()
    expect(keep({ candidate: RELAY_V4 } as unknown as string)).toBeNull()
  })

  it('idempotent: sanitising a sanitised candidate changes nothing', () => {
    for (const line of [
      RELAY_V4,
      RELAY_V6.replace('2001:db8:10::10', '2001:0DB8:0010:0000:0000:0000:0000:0010'),
      'candidate:0 1 UDP 92217087 203.0.113.10 50000 typ relay raddr 198.51.100.77 rport 54321 pwd abc x 1',
    ]) {
      const once = keep(line)
      expect(once).not.toBeNull()
      expect(keep(once as string)).toBe(once)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('sanitizeSdp — descriptions as relayed', () => {
  it('an honest Chrome or Safari description with this call\'s relays comes out byte-identical', () => {
    expect(sanitizeSdp(CHROME, ALLOW)).toBe(CHROME)
    expect(sanitizeSdp(SAFARI, ALLOW)).toBe(SAFARI)
  })

  it('the hostile candidate list keeps only the two real relays, rebuilt', () => {
    const out = sanitizeSdp(HOSTILE, ALLOW)
    expect(lines(out).filter((l) => /^a=candidate:/i.test(l))).toEqual([
      'a=candidate:1467250027 1 udp 41885439 203.0.113.10 50002 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10',
      'a=candidate:2785394137 1 udp 41887999 2001:db8:10::10 50004 typ relay raddr :: rport 0 generation 0 ufrag K9pL network-id 2 network-cost 10',
    ])
  })

  it('⛔ no user address survives anywhere — candidates, raddr, c=, a=rtcp, a=remote-candidates', () => {
    const out = sanitizeSdp(HOSTILE, ALLOW)
    for (const leak of ['198.51.100.77', '192.168.1.', '10.0.0.5', 'fd12:', 'fe80:', '.local', '192.0.2.99', 'tcptype', 'x-eno-smuggle', ' pwd ']) {
      expect(out, leak).not.toContain(leak)
    }
    const ls = lines(out)
    const audio = ls.findIndex((l) => l.startsWith('m=audio'))
    expect(ls[audio + 1]).toBe('c=IN IP4 0.0.0.0')
    expect(ls[audio + 2]).toBe('a=rtcp:61235 IN IP4 0.0.0.0')
    expect(out).not.toContain('a=remote-candidates')
    expect(lines(out)).toContain('a=end-of-candidates')
  })

  it('every other line is byte-identical and in order', () => {
    const addressLine = (l: string): boolean =>
      /^a=candidate:/i.test(l) || l.startsWith('c=') || l.startsWith('a=rtcp:') || l.startsWith('a=remote-candidates')
    expect(lines(sanitizeSdp(HOSTILE, ALLOW)).filter((l) => !addressLine(l))).toEqual(lines(HOSTILE).filter((l) => !addressLine(l)))
  })

  it('the smuggled capitalised candidate made the input malformed; the output is a valid description', () => {
    expect(codes(HOSTILE)).toEqual(['malformed'])
    expect(validateRemoteSdp(sanitizeSdp(HOSTILE, ALLOW))).toEqual({ ok: true, errors: [] })
  })

  it('Firefox: the relay\'s leaked raddr is zeroed, "UDP" rewritten, a=end-of-candidates kept', () => {
    const out = sanitizeSdp(FIREFOX, ALLOW)
    expect(lines(out)).toContain('a=candidate:0 1 udp 92217087 203.0.113.10 50000 typ relay raddr 0.0.0.0 rport 0')
    expect(out).not.toContain('198.51.100.77')
    expect(lines(out)).toContain('a=end-of-candidates')
  })

  it('with no allow-list entry for the relay, every candidate goes and the c= default becomes the dummy', () => {
    const out = sanitizeSdp(CHROME, { allowedRelayIps: new Set() })
    expect(out).not.toContain('a=candidate')
    const ls = lines(out)
    expect(ls[ls.findIndex((l) => l.startsWith('m=audio')) + 1]).toBe('c=IN IP4 0.0.0.0')
    expect(out).not.toContain('203.0.113.10')
    expect(validateRemoteSdp(out).ok).toBe(true)
  })

  it('c= and a=rtcp: IPv6 dummies for IPv6, the IPv4 dummy for anything unparseable', () => {
    const v6 = swap(CHROME, 'c=IN IP4 203.0.113.10', 'c=IN IP6 2001:db8:77::77')
    expect(lines(sanitizeSdp(v6, ALLOW))).toContain('c=IN IP6 ::')
    expect(lines(sanitizeSdp(swap(CHROME, 'c=IN IP4 203.0.113.10', 'c=IN IP4 host.example'), ALLOW))).toContain('c=IN IP4 0.0.0.0')
    expect(lines(sanitizeSdp(swap(CHROME, 'c=IN IP4 203.0.113.10', 'c=IN IP4 203.0.113.10/127'), ALLOW))).toContain('c=IN IP4 0.0.0.0')
    const rtcp6 = swap(CHROME, 'a=rtcp:9 IN IP4 0.0.0.0\r\na=candidate:1467250027', 'a=rtcp:50003 IN IP6 2001:db8:77::77\r\na=candidate:1467250027')
    expect(lines(sanitizeSdp(rtcp6, ALLOW))).toContain('a=rtcp:50003 IN IP6 ::')
    const rtcpJunk = swap(CHROME, 'a=rtcp:9 IN IP4 0.0.0.0\r\na=candidate:1467250027', 'a=RTCP:junk\r\na=candidate:1467250027')
    expect(sanitizeSdp(rtcpJunk, ALLOW)).toBe(CHROME) // the junk line becomes exactly the dummy Chrome writes
    const relayRtcp = swap(CHROME, 'a=rtcp:9 IN IP4 0.0.0.0\r\na=candidate:1467250027', 'a=rtcp:50003 IN IP4 203.0.113.10\r\na=candidate:1467250027')
    expect(sanitizeSdp(relayRtcp, ALLOW)).toBe(relayRtcp)
  })

  it('drops lines no browser writes (a lenient parser could read them as something nobody checked)', () => {
    const junk = ['A=candidate:1 1 udp 2122260223 192.168.1.23 61234 typ host', ' a=candidate:1 1 udp 2122260223 192.168.1.23 61234 typ host', 'a=x\tfoo', '']
    const dirty = swap(CHROME, 'a=extmap-allow-mixed\r\n', 'a=extmap-allow-mixed\r\n' + junk.map((j) => j + '\r\n').join(''))
    expect(sanitizeSdp(dirty, ALLOW)).toBe(CHROME)
  })

  it('preserves CRLF line endings (and LF-only input stays LF), never adding or removing a final break', () => {
    for (const sdp of [CHROME, SAFARI, FIREFOX, HOSTILE]) {
      const out = sanitizeSdp(sdp, ALLOW)
      expect(bareLf(out)).toBe(false)
      expect(out.endsWith('\r\n')).toBe(true)
    }
    const lf = sanitizeSdp(HOSTILE.replace(/\r\n/g, '\n'), ALLOW)
    expect(lf).not.toContain('\r')
    expect(lf).toBe(sanitizeSdp(HOSTILE, ALLOW).replace(/\r\n/g, '\n'))
    expect(sanitizeSdp(CHROME.slice(0, -2), ALLOW)).toBe(CHROME.slice(0, -2))
  })

  it('idempotent: sanitising twice equals sanitising once, for every fixture', () => {
    for (const sdp of [CHROME, SAFARI, FIREFOX, DECOY, DOUBLE, OUTSIDE, HOSTILE]) {
      const once = sanitizeSdp(sdp, ALLOW)
      expect(sanitizeSdp(once, ALLOW)).toBe(once)
    }
  })

  it('does not judge fingerprints or BUNDLE — that is validateRemoteSdp\'s job, which still refuses the attacks after it', () => {
    expect(codes(sanitizeSdp(DECOY, ALLOW))).toEqual(['session_fingerprint'])
    expect(codes(sanitizeSdp(DOUBLE, ALLOW))).toEqual(['fingerprint_count', 'fingerprint_mismatch'])
    expect(codes(sanitizeSdp(OUTSIDE, ALLOW))).toEqual(['bundle_membership'])
  })
})

// ---------------------------------------------------------------------------------------------------------------
const OPUS_FMTP = 'a=fmtp:111 minptime=10;useinbandfec=1'
const OPUS_FMTP_PREPARED = 'a=fmtp:111 minptime=10;useinbandfec=1;cbr=1;usedtx=0'
const AUDIO_LEVEL = 'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level'

const opusFmtpLines = (sdp: string): string[] => {
  const pts = new Set(lines(sdp).map((l) => /^a=rtpmap:(\d+) opus\//i.exec(l)).filter(Boolean).map((m) => (m as RegExpExecArray)[1]))
  return lines(sdp).filter((l) => {
    const m = /^a=fmtp:(\d+) /.exec(l)
    return m !== null && pts.has(m[1])
  })
}
const paramKeys = (fmtp: string): string[] => fmtp.slice(fmtp.indexOf(' ') + 1).split(';').map((p) => p.split('=')[0].toLowerCase())

// Comfort noise leaves the audio section too (review 2026-10-21): with a non-Opus send codec libwebrtc turns a
// CN/8000 into VAD silence suppression, i.e. DTX — see sdp-guard.review.test.ts for the downgrade it stops.
const AUDIO_M = 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126'
const AUDIO_M_NO_CN = 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 110 126'
const CN = 'a=rtpmap:13 CN/8000'

describe('prepareRemoteSdp — our encoder: CBR, no DTX, no audio-level header (objection 4)', () => {
  it('Chrome: exactly three changes — cbr=1;usedtx=0 appended to the Opus fmtp, the audio-level extmap gone, CN gone', () => {
    const expected = lines(CHROME)
      .filter((l) => l !== AUDIO_LEVEL && l !== CN)
      .map((l) => (l === OPUS_FMTP ? OPUS_FMTP_PREPARED : l === AUDIO_M ? AUDIO_M_NO_CN : l))
    expect(lines(prepareRemoteSdp(CHROME))).toEqual(expected)
  })

  it('Safari: the same three changes', () => {
    const safariM = 'm=audio 50110 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126'
    const expected = lines(SAFARI)
      .filter((l) => l !== AUDIO_LEVEL && l !== CN)
      .map((l) => (l === OPUS_FMTP ? OPUS_FMTP_PREPARED : l === safariM ? 'm=audio 50110 UDP/TLS/RTP/SAVPF 111 63 9 0 8 110 126' : l))
    expect(lines(prepareRemoteSdp(SAFARI))).toEqual(expected)
  })

  it('Firefox: fmtp BEFORE rtpmap is still found; the CSRC audio-level extmap goes too; other fmtp untouched', () => {
    const expected = lines(FIREFOX)
      .filter((l) => l !== AUDIO_LEVEL && l !== 'a=extmap:2/recvonly urn:ietf:params:rtp-hdrext:csrc-audio-level')
      .map((l) =>
        l === 'a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1' ? 'a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1;cbr=1;usedtx=0' : l,
      )
    expect(lines(prepareRemoteSdp(FIREFOX))).toEqual(expected)
  })

  it('creates the Opus fmtp right after its rtpmap when the peer sent none', () => {
    const bare = swap(CHROME, OPUS_FMTP + '\r\n', '')
    expect(prepareRemoteSdp(bare)).toContain('a=rtpmap:111 opus/48000/2\r\na=fmtp:111 cbr=1;usedtx=0\r\na=rtcp-fb:111 transport-cc\r\n')
  })

  it('overrides a peer\'s cbr=0 / usedtx=1 in place, keeping every other parameter where it was', () => {
    const vbr = swap(CHROME, OPUS_FMTP, 'a=fmtp:111 minptime=10;cbr=0;useinbandfec=1;usedtx=1')
    expect(lines(prepareRemoteSdp(vbr))).toContain('a=fmtp:111 minptime=10;cbr=1;useinbandfec=1;usedtx=0')
  })

  it('never writes a key twice: duplicates and other capitalisations of cbr/usedtx collapse into one', () => {
    const messy = swap(CHROME, OPUS_FMTP, 'a=fmtp:111 CBR=0;minptime=10;cbr=1;usedtx=1; useinbandfec=1;usedtx=1;;')
    expect(lines(prepareRemoteSdp(messy))).toContain('a=fmtp:111 cbr=1;minptime=10;usedtx=0;useinbandfec=1')
    const dupes = swap(CHROME, OPUS_FMTP, 'a=fmtp:111 useinbandfec=0;minptime=10;useinbandfec=1')
    expect(lines(prepareRemoteSdp(dupes))).toContain('a=fmtp:111 useinbandfec=1;minptime=10;cbr=1;usedtx=0') // libwebrtc: last value wins
  })

  it('⛔ a signalling server cannot undo it by re-spelling the payload type (libwebrtc reads "0111" as 111)', () => {
    // fmtp lines for one payload type merge in libwebrtc, last value winning — so an injected line must be ours too.
    const injected = swap(CHROME, OPUS_FMTP + '\r\n', OPUS_FMTP + '\r\na=fmtp:0111 usedtx=1;cbr=0\r\na=fmtp:-0 usedtx=1\r\n')
    const out = lines(prepareRemoteSdp(injected))
    expect(out).toContain(OPUS_FMTP_PREPARED)
    expect(out).toContain('a=fmtp:0111 usedtx=0;cbr=1')
    expect(out).toContain('a=fmtp:-0 usedtx=1') // payload type 0 is PCMU, not Opus: not ours to touch
    // An rtpmap and an fmtp spelled differently are ONE payload type: patched, and no second fmtp invented.
    const respelled = prepareRemoteSdp(swap(CHROME, 'a=rtpmap:111 opus/48000/2', 'a=rtpmap:00111 opus/48000/2'))
    expect(lines(respelled)).toContain(OPUS_FMTP_PREPARED)
    expect(respelled.split('a=fmtp:').length).toBe(CHROME.split('a=fmtp:').length)
    // A payload type to NEITHER engine (1111: past libwebrtc's 127 and Firefox's u8): left alone — both refuse the
    // description. "+111" is refused by libwebrtc but IS 111 to Firefox (u8::from_str), so it is rewritten (review
    // 2026-10-21: FindFmtp takes the first match, so an unrewritten "+111" line first would switch DTX back on there).
    const outOfRange = swap(CHROME, OPUS_FMTP + '\r\n', OPUS_FMTP + '\r\na=fmtp:1111 usedtx=1\r\na=fmtp:+111 usedtx=1\r\n')
    expect(lines(prepareRemoteSdp(outOfRange))).toEqual(expect.arrayContaining(['a=fmtp:1111 usedtx=1', 'a=fmtp:+111 usedtx=0;cbr=1']))
  })

  it('no duplicate fmtp parameters and exactly one fmtp per Opus payload type, for every fixture', () => {
    for (const sdp of [CHROME, SAFARI, FIREFOX, DECOY, DOUBLE, OUTSIDE, HOSTILE]) {
      const fmtps = opusFmtpLines(prepareRemoteSdp(sdp))
      expect(fmtps).toHaveLength(1)
      const keys = paramKeys(fmtps[0])
      expect(new Set(keys).size).toBe(keys.length)
      expect(fmtps[0]).toMatch(/;cbr=1;usedtx=0$/)
    }
  })

  it('every Opus payload type in every audio section, whatever the codec name\'s case', () => {
    const two = swap(
      swap(CHROME, 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 63', 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 112 63'),
      OPUS_FMTP + '\r\n',
      OPUS_FMTP + '\r\na=rtpmap:112 OPUS/48000/2\r\n',
    )
    const out = prepareRemoteSdp(two)
    expect(lines(out)).toContain(OPUS_FMTP_PREPARED)
    expect(out).toContain('a=rtpmap:112 OPUS/48000/2\r\na=fmtp:112 cbr=1;usedtx=0\r\n')
  })

  it('only audio sections, only Opus: red, telephone-event and every video fmtp are untouched', () => {
    const odd = swap(CHROME, 'a=rtpmap:125 ulpfec/90000\r\n', 'a=rtpmap:125 ulpfec/90000\r\na=rtpmap:35 opus/48000/2\r\na=fmtp:35 minptime=10\r\n')
    const out = lines(prepareRemoteSdp(odd))
    expect(out).toContain('a=fmtp:35 minptime=10')
    expect(out).toContain('a=fmtp:63 111/111')
    for (const l of lines(CHROME)) if (l.startsWith('a=fmtp:') && l !== OPUS_FMTP) expect(out).toContain(l)
  })

  it('removes every spelling of an audio-level extmap — direction, attributes, RFC 6904 wrapper, session level, case', () => {
    let sdp = swap(CHROME, AUDIO_LEVEL, 'a=extmap:1/sendrecv urn:ietf:params:rtp-hdrext:ssrc-audio-level vad=on')
    sdp = swap(sdp, 'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=sendrecv\r\na=msid:3c1f8a52-7d4e-4b9a-9f2e-6a0d5c8b1e47 9b2e', [
      'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
      'a=extmap:15 urn:ietf:params:rtp-hdrext:encrypt urn:ietf:params:rtp-hdrext:ssrc-audio-level',
      'a=extmap:16 URN:IETF:PARAMS:RTP-HDREXT:CSRC-AUDIO-LEVEL',
      'a=extmap:17  urn:ietf:params:rtp-hdrext:ssrc-audio-level',
      'a=sendrecv',
      'a=msid:3c1f8a52-7d4e-4b9a-9f2e-6a0d5c8b1e47 9b2e',
    ].join('\r\n'))
    sdp = swap(sdp, 'a=extmap-allow-mixed\r\n', 'a=extmap-allow-mixed\r\na=extmap:18 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n')
    const out = prepareRemoteSdp(sdp)
    expect(out.toLowerCase()).not.toContain('audio-level')
    for (const kept of ['a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid', 'a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01']) {
      expect(lines(out)).toContain(kept)
    }
  })

  it('idempotent, CRLF preserved, and a valid description stays valid — for every fixture', () => {
    for (const sdp of [CHROME, SAFARI, FIREFOX, DECOY, DOUBLE, OUTSIDE, HOSTILE]) {
      const once = prepareRemoteSdp(sdp)
      expect(prepareRemoteSdp(once)).toBe(once)
      expect(bareLf(once)).toBe(false)
      expect(once.endsWith('\r\n')).toBe(true)
      expect(validateRemoteSdp(once).ok).toBe(validateRemoteSdp(sdp).ok)
      expect(sdpFingerprint(once)).toBe(sdpFingerprint(sdp))
    }
    expect(prepareRemoteSdp(CHROME.replace(/\r\n/g, '\n'))).toBe(prepareRemoteSdp(CHROME).replace(/\r\n/g, '\n'))
  })

  it('an Opus rtpmap on an unterminated last line still gets its fmtp, without inventing a final break', () => {
    const tail = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2'
    expect(prepareRemoteSdp(tail)).toBe(tail + '\r\na=fmtp:111 cbr=1;usedtx=0')
  })

  it('not a string → empty string, never a throw', () => {
    expect(prepareRemoteSdp(undefined as unknown as string)).toBe('')
    expect(sanitizeSdp(undefined as unknown as string, ALLOW)).toBe('')
    expect(normalizeLocalSdp(undefined as unknown as string)).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('normalizeLocalSdp — the sender\'s half: Firefox\'s session fingerprint moves into every m-section', () => {
  it('Firefox: the session line goes, each m-section gains it as its last line, nothing else changes', () => {
    const out = normalizeLocalSdp(FIREFOX)
    const fp = `a=fingerprint:sha-256 ${FIREFOX_FP}`
    const ls = lines(out)
    const firstM = ls.findIndex((l) => l.startsWith('m='))
    expect(ls.slice(0, firstM)).not.toContain(fp)
    const secondM = ls.findIndex((l, i) => i > firstM && l.startsWith('m='))
    expect(ls[secondM - 1]).toBe(fp)
    expect(ls[ls.length - 2]).toBe(fp) // the last element is '' after the final CRLF
    expect(ls.filter((l) => l !== fp)).toEqual(lines(FIREFOX).filter((l) => l !== fp))
    expect(bareLf(out)).toBe(false)
  })

  it('a no-op for Chrome and Safari, and idempotent', () => {
    expect(normalizeLocalSdp(CHROME)).toBe(CHROME)
    expect(normalizeLocalSdp(SAFARI)).toBe(SAFARI)
    const once = normalizeLocalSdp(FIREFOX)
    expect(normalizeLocalSdp(once)).toBe(once)
  })

  it('leaves every ambiguous shape alone, so the receiver still refuses it', () => {
    expect(normalizeLocalSdp(DECOY)).toBe(DECOY) // session AND media fingerprints
    const twoSession = swap(FIREFOX, 'a=group:BUNDLE 0 1', `a=fingerprint:sha-256 ${DECOY_FP}\r\na=group:BUNDLE 0 1`)
    expect(normalizeLocalSdp(twoSession)).toBe(twoSession)
    const noMedia = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 ' + FIREFOX_FP + '\r\n'
    expect(normalizeLocalSdp(noMedia)).toBe(noMedia)
    expect(codes(normalizeLocalSdp(DECOY))).toEqual(['session_fingerprint'])
  })

  it('an unterminated last line gets the break the moved line needs, and no more', () => {
    const out = normalizeLocalSdp(FIREFOX.slice(0, -2))
    expect(out).toBe(normalizeLocalSdp(FIREFOX).slice(0, -2))
  })
})
