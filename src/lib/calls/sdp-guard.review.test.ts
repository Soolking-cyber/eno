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
} from './sdp-guard'

/**
 * ADVERSARIAL REVIEW of the SDP guard (2026-10-21). The module's own suite checks each function against what its
 * author meant. This file checks prepareRemoteSdp against what LIBWEBRTC WILL BUILD from its output, because the
 * function's whole job (objection 4) is a property of our SENDER, and a parser that reads a line differently from
 * libwebrtc fails silently: nothing throws, the call sounds fine, and the encoder leaks speech to the relay.
 *
 * ⚠️ THE FINDINGS THIS FILE EXISTS FOR. Every one passes validateRemoteSdp and survives sanitizeSdp byte-identical
 * as the module was written, so the signalling server (objection 1's attacker, the one the client-side check is
 * for) or a hostile peer could send it:
 *   1. "a=fmtp::111 usedtx=1;cbr=0" (or "a=rtpmap::111 opus/48000/2"). libwebrtc's GetValue splits on ':' with
 *      tokenize_first, which SKIPS A RUN of delimiters (rtc_base/string_encode.cc), so "::111" is payload type 111.
 *      The module's regex wanted one colon, left the line alone, and libwebrtc merged it LAST (UpdateCodec →
 *      AddParameters → SetParam): DTX on, VBR on.
 *   2. U+2028 / U+2029 anywhere in the Opus fmtp: the regex's `.` cannot cross them, so the line was not an fmtp to
 *      the module, a fresh "cbr=1;usedtx=0" fmtp was inserted BEFORE it, and the attacker's values won. The same
 *      regex backtracks quadratically on "a=fmtp:111" + spaces + U+2028: 17.5 s for one 64 KB description on a
 *      desktop CPU, i.e. any peer could freeze the other side's call tab.
 *   3. "a=extmap:1/x<NBSP>y urn:ietf:params:rtp-hdrext:ssrc-audio-level". libwebrtc splits on 0x20 only and never
 *      reads the direction (ParseExtmap), so the URI is fields[1] and audio levels are negotiated; the module split
 *      on JS `\s+`, which includes NBSP, read "y" as the URI and kept the line.
 *   4. A codec downgrade. webrtc_voice_engine.cc SetSendCodecs sends with the FIRST codec of the remote list that has
 *      an encoder (skipping CN / telephone-event / red), and turns comfort noise — VAD silence suppression, i.e. DTX —
 *      on when that encoder allows it and a mono CN/8000 matches its clock rate. Reordering PCMU before Opus made
 *      our sender G.711 + CNG: talk spurts visible at the relay, and cbr=1/usedtx=0 never consulted.
 *   5. multiopus (NotAdvertisedEncoder in Chromium's audio_codec_factory.cc, so negotiable but never offered) reads
 *      usedtx / cbr exactly like opus (audio_encoder_multi_channel_opus_impl.cc) and was not patched.
 *   6. FIREFOX clients run prepareRemoteSdp too, and Firefox reads SDP its own way (webrtc-sdp attribute_type.rs,
 *      SdpMediaSection::FindFmtp): attribute values are trimmed, payload types parsed with u8::from_str ('+'
 *      accepted), the FIRST fmtp of a payload type wins, and Opus parameter names are matched UPPER-cased. So
 *      "a=fmtp: 111 usedtx=1;cbr=0" or "a=fmtp:+111 …" placed before the real line (libwebrtc refuses both spellings;
 *      the validator did not), or "usedtx=1;u\u017fedtx=1" inside it (LONG S upper-cases to S), switched DTX and VBR
 *      back on for a Firefox sender.
 * Sources were read at webrtc-sdk/webrtc m137_release (pc/webrtc_sdp.cc, pc/channel.cc, media/engine/
 * webrtc_voice_engine.cc, rtc_base/string_encode.cc) and chromium main — not reasoned from memory.
 *
 * The validator gets the matching belt-and-braces: text that libwebrtc and another parser read differently is
 * refused — "a=<name>::" colon runs, C1 controls, Unicode line separators and non-ASCII whitespace (JS `\s`/trim,
 * Rust's split_whitespace/trim in Firefox's webrtc-sdp, Python's splitlines all treat them as breaks) — and a
 * "a=group: BUNDLE" that Firefox's parser (value trimmed, semantics upper-cased) reads as a second group now counts.
 */

const load = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}.sdp`, import.meta.url)), 'utf8').replace(/\r?\n/g, '\r\n')

const CHROME = load('chrome-offer')
const SAFARI = load('safari-offer')
const FIREFOX = load('firefox-offer')
const ALLOW: RelayFilterOptions = { allowedRelayIps: new Set(['203.0.113.10', '2001:db8:10::10']) }
const OPUS_FMTP = 'a=fmtp:111 minptime=10;useinbandfec=1'
const AUDIO_LEVEL = 'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level'
const CHROME_AUDIO_M = 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126'

const codes = (sdp: string): string[] => validateRemoteSdp(sdp).errors.map((e) => e.code)
const lines = (sdp: string): string[] => sdp.split('\r\n')

/** Replaces exactly one occurrence — throws otherwise, so a fixture edit cannot silently void a test. */
function swap(sdp: string, from: string, to: string): string {
  const at = sdp.indexOf(from)
  if (at === -1 || sdp.indexOf(from, at + 1) !== -1) throw new Error(`expected exactly one ${JSON.stringify(from)}`)
  return sdp.slice(0, at) + to + sdp.slice(at + from.length)
}

// ---------------------------------------------------------------------------------------------------------------
// A model of what libwebrtc m137 builds from the AUDIO sections of a remote description — only the grammar the
// sender's configuration depends on, transcribed from the sources named in the header. null = libwebrtc refuses
// the whole description (also safe: nothing is sent).
// ---------------------------------------------------------------------------------------------------------------

interface ModelCodec {
  name: string
  clock: number
  channels: number
  params: Map<string, string>
}
interface ModelSection {
  pts: number[]
  codecs: Map<number, ModelCodec>
  extensions: string[]
}

/** rtc_base/string_encode.cc tokenize_first: split at the first delimiter, then skip any further delimiters. */
function tokenizeFirst(s: string, d: string): [string, string] | null {
  const left = s.indexOf(d)
  if (left === -1) return null
  let right = left + 1
  while (right < s.length && s[right] === d) right++
  return [s.slice(0, left), s.slice(right)]
}
/** webrtc_sdp.cc GetValue: tokenize_first on ':', the left part must end with the attribute name. */
function getValue(field: string, attribute: string): string | null {
  const t = tokenizeFirst(field, ':')
  return t !== null && t[0].endsWith(attribute) ? t[1] : null
}
/** rtc::StringToNumber<int>: first char a digit or '-', strtoll base 10 consuming the whole string. */
function intOf(s: string): number | null {
  return /^-?[0-9]+$/.test(s) ? Number(s) + 0 : null
}
function ptOf(s: string): number | null {
  const n = intOf(s)
  return n !== null && n >= 0 && n <= 127 ? n : null
}
/** webrtc_sdp.cc HasAttribute: case-sensitive name, then ':' or ' ' or end of line. */
function hasAttribute(line: string, name: string): boolean {
  if (line.slice(2, 2 + name.length) !== name) return false
  const next = line.charAt(2 + name.length)
  return next === '' || next === ':' || next === ' '
}
const stripAsciiWhitespace = (s: string): string => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '')
const STATIC_AUDIO: Record<number, [string, number, number]> = {
  0: ['PCMU', 8000, 1],
  8: ['PCMA', 8000, 1],
  9: ['G722', 8000, 1],
  13: ['CN', 8000, 1],
}
const ENCRYPT_URI = 'urn:ietf:params:rtp-hdrext:encrypt'

function parseExtmapModel(line: string): string | null | undefined {
  const f = line.slice(2).split(' ')
  if (f.length < 2) return null
  let uri = f[1]
  const v = getValue(f[0], 'extmap')
  if (v === null || intOf(v.split('/')[0]) === null) return null
  if (uri === ENCRYPT_URI) {
    if (f.length < 3) return null
    uri = f[2]
  }
  return uri
}

function libwebrtcAudio(sdp: string): ModelSection[] | null {
  const sections: ModelSection[] = []
  const sessionExtensions: string[] = []
  let cur: ModelSection | null = null
  let inMedia = false
  for (const raw of sdp.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('m=')) {
      inMedia = true
      cur = null
      const f = line.slice(2).split(' ')
      if (f[0] !== 'audio') continue
      const pts: number[] = []
      for (const token of f.slice(3)) {
        const pt = ptOf(token)
        if (pt === null) return null
        if (pts.indexOf(pt) === -1) pts.push(pt)
      }
      cur = { pts, codecs: new Map(), extensions: [] }
      // MaybeCreateStaticPayloadAudioCodecs runs before the attributes; an rtpmap may then remap the number.
      for (const pt of pts) {
        const s = STATIC_AUDIO[pt]
        if (s) cur.codecs.set(pt, { name: s[0], clock: s[1], channels: s[2], params: new Map() })
      }
      sections.push(cur)
      continue
    }
    if (!line.startsWith('a=')) continue
    if (!inMedia) {
      if (hasAttribute(line, 'extmap')) {
        const uri = parseExtmapModel(line)
        if (uri === null) return null
        if (uri !== undefined) sessionExtensions.push(uri)
      }
      continue
    }
    if (cur === null) continue
    if (hasAttribute(line, 'fmtp')) {
      const t = tokenizeFirst(line.slice(2), ' ')
      if (t === null) return null
      const v = getValue(t[0], 'fmtp')
      const pt = v === null ? null : ptOf(v)
      if (pt === null) return null
      const codec = cur.codecs.get(pt) ?? { name: '', clock: 0, channels: 0, params: new Map<string, string>() }
      for (const segment of t[1].split(';')) {
        const p = stripAsciiWhitespace(segment)
        const kv = tokenizeFirst(p, '=')
        if (kv !== null) codec.params.set(kv[0], kv[1])
        else codec.params.set('', p)
      }
      cur.codecs.set(pt, codec)
    } else if (hasAttribute(line, 'rtpmap')) {
      const f = line.slice(2).split(' ')
      if (f.length < 2) return null
      const v = getValue(f[0], 'rtpmap')
      const pt = v === null ? null : ptOf(v)
      if (pt === null) return null
      if (cur.pts.indexOf(pt) === -1) continue // "Ignore rtpmap line that did not appear in the <fmt> of the m-line"
      const cp = f[1].split('/')
      if (cp.length < 2 || cp.length > 3) return null
      const clock = intOf(cp[1])
      const channels = cp.length === 3 ? intOf(cp[2]) : 1
      if (clock === null || channels === null) return null
      const before = cur.codecs.get(pt)
      cur.codecs.set(pt, { name: cp[0], clock, channels, params: before ? before.params : new Map() })
    } else if (hasAttribute(line, 'extmap')) {
      const uri = parseExtmapModel(line)
      if (uri === null) return null
      if (uri !== undefined) cur.extensions.push(uri)
    }
  }
  for (const s of sections) {
    if (sessionExtensions.length > 0 && s.extensions.length > 0) return null // "MUST be either all session level or media level"
    if (s.extensions.length === 0) s.extensions = sessionExtensions.slice()
  }
  return sections
}

/** Chromium's audio encoders (opus, G722, G711 listed; L16 and multiopus NotAdvertised but creatable). */
function encoderFor(c: ModelCodec): { allowComfortNoise: boolean; channels: number } | null {
  const n = c.name.toLowerCase()
  if (n === 'opus' && c.clock === 48000) return { allowComfortNoise: false, channels: c.channels }
  if (n === 'multiopus' && c.clock === 48000) return { allowComfortNoise: false, channels: c.channels }
  if ((n === 'pcmu' || n === 'pcma' || n === 'g722') && c.clock === 8000) return { allowComfortNoise: true, channels: 1 }
  if (n === 'l16') return { allowComfortNoise: true, channels: c.channels }
  return null
}

/**
 * What OUR sender would leak after applying `sdp` as the remote description (send codecs AND send header extensions
 * come from the remote content — pc/channel.cc RtpSendParametersFromMediaDescription). [] = nothing; null = refused.
 */
function senderLeaks(sdp: string): string[] | null {
  const sections = libwebrtcAudio(sdp)
  if (sections === null) return null
  const found: string[] = []
  const leaks = { push: (x: string): void => void (found.indexOf(x) === -1 && found.push(x)) }
  for (const s of sections) {
    for (const uri of s.extensions) {
      if (uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' || uri === 'urn:ietf:params:rtp-hdrext:csrc-audio-level') {
        leaks.push('audio-level')
      }
    }
    // Codecs sorted by the m-line fmt order; the first one with an encoder (CN / DTMF / red skipped) sends.
    const ordered = s.pts.map((pt) => s.codecs.get(pt)).filter((c): c is ModelCodec => c !== undefined)
    for (const c of ordered) {
      const n = c.name.toLowerCase()
      if (n === 'cn' || n === 'telephone-event' || n === 'red') continue
      const enc = encoderFor(c)
      if (enc === null) continue
      if (n === 'opus' || n === 'multiopus') {
        if (c.params.get('usedtx') === '1') leaks.push('dtx')
        if (c.params.get('cbr') !== '1') leaks.push('vbr')
      }
      if (enc.allowComfortNoise) {
        const cn = ordered.find((x) => x.name.toLowerCase() === 'cn' && x.clock === c.clock && x.channels === enc.channels)
        if (cn !== undefined && cn.channels === 1 && cn.clock === 8000) leaks.push('comfort-noise')
      }
      break
    }
  }
  return found
}

/**
 * What a FIREFOX sender takes from a remote description's Opus fmtp (webrtc-sdp attribute_type.rs + Firefox's
 * JsepCodecDescription / SdpMediaSection::FindFmtp, read 2026-10-21): the attribute name is everything before the
 * first ':' (lowercased), the value is trimmed (Rust trim: Unicode White_Space); fmtp and rtpmap split the payload
 * type off with splitn(2, ' ') and parse it with u8::from_str (leading '+' and zeros accepted); FindFmtp returns the
 * FIRST fmtp of the payload type; USEDTX / CBR match upper-cased and must be exactly 0 or 1; any parse error is
 * fatal (null: the description is refused). Defaults when no fmtp: DTX off, CBR off.
 */
function firefoxOpus(sdp: string): { usedtx: boolean; cbr: boolean } | null {
  const trimRust = (s: string): string => s.replace(/^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '')
  const u8 = (s: string): number | null => (/^\+?[0-9]+$/.test(s) && Number(s) <= 255 ? Number(s) : null)
  let audio = false
  let seenAudio = false
  const rtpmap = new Map<number, string>()
  const fmtps: Array<{ pt: number; params: string }> = []
  for (const raw of sdp.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('m=')) {
      audio = !seenAudio && line.slice(2).split(' ')[0] === 'audio'
      seenAudio = seenAudio || audio
      continue
    }
    if (!audio || !line.startsWith('a=')) continue
    const colon = line.indexOf(':', 2)
    if (colon === -1) continue
    const name = line.slice(2, colon).toLowerCase()
    const value = trimRust(line.slice(colon + 1))
    if (name !== 'rtpmap' && name !== 'fmtp') continue
    const sp = value.indexOf(' ')
    const pt = u8(sp === -1 ? value : value.slice(0, sp))
    if (pt === null) return null
    const after = sp === -1 ? '' : value.slice(sp + 1)
    if (name === 'rtpmap') {
      if (!rtpmap.has(pt)) rtpmap.set(pt, after.split('/')[0].toLowerCase())
    } else fmtps.push({ pt, params: after })
  }
  let opusPt: number | null = null
  rtpmap.forEach((enc, pt) => {
    if (opusPt === null && enc === 'opus') opusPt = pt
  })
  if (opusPt === null) return null
  const first = fmtps.find((f) => f.pt === opusPt)
  const out = { usedtx: false, cbr: false }
  if (first === undefined) return out
  for (const token of first.params.split(';')) {
    const eq = token.indexOf('=')
    const key = (eq === -1 ? token : token.slice(0, eq)).toUpperCase()
    if (key !== 'USEDTX' && key !== 'CBR') continue
    const v = eq === -1 ? null : u8(token.slice(eq + 1))
    if (v === null || v > 1) return null
    if (key === 'USEDTX') out.usedtx = v === 1
    else out.cbr = v === 1
  }
  return out
}

/** The libwebrtc-built Opus parameters of the first audio section (for readable failures). */
function opusParams(sdp: string): Record<string, string> | null {
  const sections = libwebrtcAudio(sdp)
  if (sections === null || sections.length === 0) return null
  for (const [, c] of sections[0].codecs) if (c.name.toLowerCase() === 'opus') return Object.fromEntries(c.params)
  return null
}

// ---------------------------------------------------------------------------------------------------------------
describe('review: the libwebrtc model itself agrees with the module on honest browsers', () => {
  it('raw Chrome/Safari offers make our sender leak (audio level, VBR); prepared, they leak nothing', () => {
    for (const sdp of [CHROME, SAFARI]) {
      expect(senderLeaks(sdp)).toEqual(['audio-level', 'vbr'])
      expect(senderLeaks(prepareRemoteSdp(sdp))).toEqual([])
    }
    const ff = normalizeLocalSdp(FIREFOX)
    expect(senderLeaks(ff)).toEqual(['audio-level', 'vbr'])
    expect(senderLeaks(prepareRemoteSdp(ff))).toEqual([])
  })
})

describe('review: ⛔ prepareRemoteSdp holds against libwebrtc\'s own grammar (objection 4)', () => {
  const injectAfterOpusFmtp = (line: string): string => swap(CHROME, OPUS_FMTP + '\r\n', OPUS_FMTP + '\r\n' + line + '\r\n')

  it('a colon run in the fmtp payload type ("a=fmtp::111") is the Opus fmtp to libwebrtc, so it is rewritten too', () => {
    for (const evil of ['a=fmtp::111 usedtx=1;cbr=0', 'a=fmtp:::111 usedtx=1;cbr=0', 'a=fmtp::0111 usedtx=1;cbr=0']) {
      const sdp = injectAfterOpusFmtp(evil)
      expect(senderLeaks(sdp), evil).toEqual(['audio-level', 'dtx', 'vbr']) // the attack is real against libwebrtc
      expect(senderLeaks(prepareRemoteSdp(sdp)), evil).toEqual([])
      expect(opusParams(prepareRemoteSdp(sdp)), evil).toMatchObject({ cbr: '1', usedtx: '0' })
    }
  })

  it('a colon run in the rtpmap ("a=rtpmap::111 opus/48000/2") still declares Opus, so its fmtp is still patched', () => {
    const sdp = swap(swap(CHROME, 'a=rtpmap:111 opus/48000/2', 'a=rtpmap::111 opus/48000/2'), OPUS_FMTP, OPUS_FMTP + ';usedtx=1;cbr=0')
    expect(senderLeaks(sdp)).toEqual(['audio-level', 'dtx', 'vbr'])
    expect(senderLeaks(prepareRemoteSdp(sdp))).toEqual([])
    // …and with no fmtp at all, the one created for it is spelled the way libwebrtc reads the payload type.
    const bare = swap(swap(CHROME, 'a=rtpmap:111 opus/48000/2', 'a=rtpmap::111 opus/48000/2'), OPUS_FMTP + '\r\n', '')
    expect(prepareRemoteSdp(bare)).toContain('a=rtpmap::111 opus/48000/2\r\na=fmtp:111 cbr=1;usedtx=0\r\n')
    expect(senderLeaks(prepareRemoteSdp(bare))).toEqual([])
  })

  it('U+2028 / U+2029 inside the Opus fmtp no longer hide it from the rewrite', () => {
    for (const sep of ['\u2028', '\u2029']) {
      const sdp = swap(CHROME, OPUS_FMTP, OPUS_FMTP + ';usedtx=1;cbr=0;x=' + sep)
      expect(senderLeaks(sdp)).toEqual(['audio-level', 'dtx', 'vbr'])
      expect(senderLeaks(prepareRemoteSdp(sdp)), JSON.stringify(sep)).toEqual([])
      expect(prepareRemoteSdp(sdp).split('a=fmtp:111').length, 'no second fmtp invented').toBe(2)
    }
  })

  it('⛔ no quadratic blow-up: a 64 KB fmtp line of spaces ending in U+2028 is prepared in well under a second', () => {
    const room = SDP_MAX_BYTES - Buffer.byteLength(CHROME, 'utf8') - 8
    const evil = swap(CHROME, OPUS_FMTP, 'a=fmtp:111' + ' '.repeat(room) + '\u2028')
    expect(Buffer.byteLength(evil, 'utf8')).toBeLessThanOrEqual(SDP_MAX_BYTES)
    const t0 = performance.now()
    prepareRemoteSdp(evil)
    expect(performance.now() - t0).toBeLessThan(1000) // was 17.5 s on a desktop CPU; linear work is a few ms
  })

  it('every public function stays linear on 64 KB of hostile padding (spaces, colons, separators)', () => {
    const pads = ['a=fmtp:111' + ' '.repeat(60000) + '\u2028', 'a=rtpmap:' + ':'.repeat(60000), 'a=extmap:1' + ' '.repeat(60000) + 'x',
      'a=rtcp:9 IN IP4 ' + 'x'.repeat(60000) + ' y', 'a=group:BUNDLE' + ' 0'.repeat(30000), 'a=candidate:' + ' '.repeat(60000)]
    for (const pad of pads) {
      const evil = swap(CHROME, OPUS_FMTP, pad)
      const t0 = performance.now()
      validateRemoteSdp(evil, { maxBytes: 1 << 20 })
      sdpFingerprint(evil)
      sanitizeSdp(evil, ALLOW)
      prepareRemoteSdp(evil)
      normalizeLocalSdp(evil)
      expect(performance.now() - t0, pad.slice(0, 20)).toBeLessThan(1000)
    }
  })

  it('an NBSP (or any non-ASCII space) in the extmap direction cannot keep the audio-level extension alive', () => {
    for (const sp of ['\u00a0', '\u3000', '\ufeff', '\u2028']) {
      const sdp = swap(CHROME, AUDIO_LEVEL, `a=extmap:1/x${sp}y urn:ietf:params:rtp-hdrext:ssrc-audio-level`)
      expect(senderLeaks(sdp), JSON.stringify(sp)).toContain('audio-level') // libwebrtc negotiates it
      expect(senderLeaks(prepareRemoteSdp(sdp)), JSON.stringify(sp)).toEqual([])
    }
    // Any line that so much as names the URI goes, whatever surrounds it.
    const odd = swap(CHROME, AUDIO_LEVEL, 'a=extmap:1/sendonly\u00a0z urn:ietf:params:rtp-hdrext:encrypt urn:ietf:params:rtp-hdrext:csrc-audio-level')
    expect(prepareRemoteSdp(odd).toLowerCase()).not.toContain('audio-level')
  })

  it('a session-level audio-level extmap (applied to every section by libwebrtc) is removed too', () => {
    const noMedia = swap(CHROME, AUDIO_LEVEL + '\r\n', '')
    const session = swap(
      noMedia.replace(/a=extmap:\d+ [^\r]*\r\n/g, ''),
      'a=extmap-allow-mixed\r\n',
      'a=extmap-allow-mixed\r\n' + AUDIO_LEVEL + '\r\n',
    )
    expect(senderLeaks(session)).toEqual(['audio-level', 'vbr'])
    expect(senderLeaks(prepareRemoteSdp(session))).toEqual([])
  })

  it('⛔ a downgrade to G.711/G.722 cannot turn comfort noise (VAD silence suppression = DTX) on', () => {
    for (const m of ['0 111 63 9 8 13 110 126', '8 111 63 9 0 13 110 126', '9 111 63 0 8 13 110 126']) {
      const reordered = swap(CHROME, CHROME_AUDIO_M, `m=audio 50002 UDP/TLS/RTP/SAVPF ${m}`)
      expect(senderLeaks(reordered), m).toEqual(['audio-level', 'comfort-noise'])
      expect(senderLeaks(prepareRemoteSdp(reordered)), m).toEqual([])
    }
    // A dynamic CN payload type is CN too.
    const dynamic = swap(swap(CHROME, CHROME_AUDIO_M, 'm=audio 50002 UDP/TLS/RTP/SAVPF 0 111 63 9 8 105 110 126'), 'a=rtpmap:13 CN/8000', 'a=rtpmap:105 CN/8000')
    expect(senderLeaks(dynamic)).toEqual(['audio-level', 'comfort-noise'])
    expect(senderLeaks(prepareRemoteSdp(dynamic))).toEqual([])
  })

  it('CN goes from the m-line and its own lines only; everything else in the section is byte-identical', () => {
    const out = lines(prepareRemoteSdp(CHROME))
    expect(out).toContain('m=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 110 126')
    expect(out).not.toContain('a=rtpmap:13 CN/8000')
    // Spelled differently in the m-line ("013") it is still payload type 13 to libwebrtc.
    const respelled = prepareRemoteSdp(swap(CHROME, CHROME_AUDIO_M, 'm=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 013 110 126'))
    expect(lines(respelled)).toContain('m=audio 50002 UDP/TLS/RTP/SAVPF 111 63 9 0 8 110 126')
    // rtcp-fb / fmtp lines naming a stripped payload type go with it.
    const decorated = swap(CHROME, 'a=rtpmap:13 CN/8000\r\n', 'a=rtpmap:13 CN/8000\r\na=fmtp:13 x=1\r\na=rtcp-fb:13 nack\r\n')
    expect(prepareRemoteSdp(decorated)).toBe(prepareRemoteSdp(CHROME))
    // A remapped static number is whatever its rtpmap says: 13 as Opus is Opus, not CN.
    const remapped = swap(swap(CHROME, 'a=rtpmap:13 CN/8000', 'a=rtpmap:13 opus/48000/2'), CHROME_AUDIO_M, 'm=audio 50002 UDP/TLS/RTP/SAVPF 13 63 9 0 8 110 126')
    expect(lines(prepareRemoteSdp(remapped))).toContain('m=audio 50002 UDP/TLS/RTP/SAVPF 13 63 9 0 8 110 126')
    expect(lines(prepareRemoteSdp(remapped))).toContain('a=fmtp:13 cbr=1;usedtx=0')
  })

  it('a section that is ONLY comfort noise is left alone (no speech encoder: nothing to protect, no empty m-line)', () => {
    const onlyCn = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 13\r\na=rtpmap:13 CN/8000\r\n'
    expect(prepareRemoteSdp(onlyCn)).toBe(onlyCn)
  })

  it('multiopus (negotiable in Chrome, never offered) is patched like opus — it reads usedtx and cbr the same way', () => {
    const multi = swap(
      swap(CHROME, CHROME_AUDIO_M, 'm=audio 50002 UDP/TLS/RTP/SAVPF 100 111 63 9 0 8 13 110 126'),
      'a=rtpmap:111 opus/48000/2\r\n',
      'a=rtpmap:100 multiopus/48000/6\r\na=fmtp:100 channel_mapping=0,4,1,2,3,5;coupled_streams=2;num_streams=4;usedtx=1;cbr=0\r\na=rtpmap:111 opus/48000/2\r\n',
    )
    expect(senderLeaks(multi)).toEqual(['audio-level', 'dtx', 'vbr'])
    expect(senderLeaks(prepareRemoteSdp(multi))).toEqual([])
  })

  it('⛔ Firefox senders too: an fmtp Firefox reads first ("a=fmtp: 111", "a=fmtp:+111") is rewritten like the real one', () => {
    // Placed BEFORE the real Opus fmtp: FindFmtp returns the first match. libwebrtc refuses these spellings outright
    // (GetValue / ParseSigned), validateRemoteSdp let them through, and webrtc-sdp parses them cleanly.
    const before = (line: string): string => swap(CHROME, OPUS_FMTP, line + '\r\n' + OPUS_FMTP)
    expect(firefoxOpus(prepareRemoteSdp(CHROME))).toEqual({ usedtx: false, cbr: true })
    for (const evil of ['a=fmtp: 111 usedtx=1;cbr=0', 'a=fmtp:+111 usedtx=1;cbr=0', 'a=fmtp:\u3000111 usedtx=1;cbr=0', 'a=fmtp:+0111 usedtx=1;cbr=0']) {
      const sdp = before(evil)
      expect(firefoxOpus(sdp), evil).toEqual({ usedtx: true, cbr: false }) // the attack is real against Firefox
      expect(firefoxOpus(prepareRemoteSdp(sdp)), evil).toEqual({ usedtx: false, cbr: true })
      const lw = senderLeaks(prepareRemoteSdp(sdp))
      expect(lw === null || lw.length === 0, evil).toBe(true) // and libwebrtc still refuses it or builds a quiet sender
    }
    // An Opus rtpmap only Firefox reads still makes its payload type Opus to the rewrite.
    const rtp = swap(swap(CHROME, 'a=rtpmap:111 opus/48000/2', 'a=rtpmap:+111 opus/48000/2'), OPUS_FMTP, OPUS_FMTP + ';usedtx=1;cbr=0')
    expect(firefoxOpus(rtp)).toEqual({ usedtx: true, cbr: false })
    expect(firefoxOpus(prepareRemoteSdp(rtp))).toEqual({ usedtx: false, cbr: true })
  })

  it('⛔ a parameter name that only UPPER-casing folds ("u\\u017fedtx" → USEDTX in Rust and JS) is ours too', () => {
    // webrtc-sdp matches Opus parameter names with to_uppercase(); U+017F LONG S upper-cases to "S". Lower-casing
    // leaves it alone, so the module kept "u\u017fedtx=1" next to its own usedtx=0 — and Firefox applies them in order.
    const sdp = swap(CHROME, OPUS_FMTP, OPUS_FMTP + ';usedtx=1;u\u017fedtx=1;cbr=0')
    expect(firefoxOpus(sdp)).toEqual({ usedtx: true, cbr: false })
    expect(firefoxOpus(prepareRemoteSdp(sdp))).toEqual({ usedtx: false, cbr: true })
    expect(prepareRemoteSdp(sdp)).not.toContain('\u017f')
  })

  it('still idempotent and CRLF-faithful on every hostile input above', () => {
    const inputs = [
      swap(CHROME, OPUS_FMTP + '\r\n', OPUS_FMTP + '\r\na=fmtp::111 usedtx=1;cbr=0\r\n'),
      swap(CHROME, OPUS_FMTP, OPUS_FMTP + ';usedtx=1;x=\u2028'),
      swap(CHROME, AUDIO_LEVEL, 'a=extmap:1/x\u00a0y urn:ietf:params:rtp-hdrext:ssrc-audio-level'),
      swap(CHROME, CHROME_AUDIO_M, 'm=audio 50002 UDP/TLS/RTP/SAVPF 0 111 63 9 8 13 110 126'),
    ]
    for (const sdp of inputs) {
      const once = prepareRemoteSdp(sdp)
      expect(prepareRemoteSdp(once)).toBe(once)
      expect(/(^|[^\r])\n/.test(once)).toBe(false)
      expect(once.endsWith('\r\n')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('review: validateRemoteSdp refuses text that libwebrtc and another parser read differently', () => {
  it('"a=<name>::" colon runs — libwebrtc reads through them, Firefox\'s webrtc-sdp and this module do not', () => {
    const at = (from: string, to: string): string[] => codes(swap(CHROME, from, to))
    expect(at(OPUS_FMTP, 'a=fmtp::111 minptime=10;useinbandfec=1')).toContain('malformed')
    expect(at('a=rtpmap:111 opus/48000/2', 'a=rtpmap::111 opus/48000/2')).toContain('malformed')
    expect(at('a=group:BUNDLE 0 1', 'a=group::BUNDLE 0 1')).toContain('malformed')
    expect(at('a=mid:1', 'a=mid::1')).toContain('malformed')
    expect(at('a=setup:actpass\r\na=mid:1', 'a=setup::actpass\r\na=mid:1')).toContain('malformed')
    expect(at(AUDIO_LEVEL, 'a=extmap::1 urn:ietf:params:rtp-hdrext:ssrc-audio-level')).toContain('malformed')
    // An IPv6 "::" later in a value is not a colon run after the name.
    expect(codes(swap(CHROME, 'a=rtcp:9 IN IP4 0.0.0.0\r\na=candidate:1467250027', 'a=rtcp:9 IN IP6 ::\r\na=candidate:1467250027'))).toEqual([])
  })

  it('C1 controls, Unicode line/paragraph separators and non-ASCII whitespace are refused, wherever they sit', () => {
    for (const ch of ['\u0085', '\u0080', '\u009f', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
      expect(codes(swap(CHROME, 'a=ssrc:2716391468 cname:Qx7hV2mN9pL4sR1t', `a=ssrc:2716391468 cname:Qx7h${ch}V2mN9pL4sR1t`)), JSON.stringify(ch)).toContain('malformed')
      expect(sdpFingerprint(swap(CHROME, 's=-', `s=${ch}`)), JSON.stringify(ch)).toBeNull()
    }
    // Ordinary non-ASCII text is not a separator to anyone: a Vietnamese session name is still fine.
    expect(codes(swap(CHROME, 's=-', 's=Cuộc gọi eno'))).toEqual([])
  })

  it('outside the free-text s= / i= lines, SDP is ASCII: Unicode case folds (\\u017f → S, \\u212a → k) and look-alikes are refused', () => {
    expect(codes(swap(CHROME, OPUS_FMTP, OPUS_FMTP + ';u\u017fedtx=1'))).toContain('malformed')
    expect(codes(swap(CHROME, 'a=msid-semantic: WMS 3c1f8a52', 'a=msid-semantic: WMS 3c1f8a52\u212a'))).toContain('malformed') // KELVIN SIGN
    expect(codes(swap(CHROME, 'a=mid:1', 'a=mid:\uff11'))).toContain('malformed') // FULLWIDTH DIGIT ONE
    expect(codes(swap(CHROME, 't=0 0', 't=0 0\r\ni=Cuộc gọi'))).toEqual([])
  })

  it('…and sanitizeSdp drops such lines rather than relaying a line nobody checked', () => {
    const smuggled = swap(CHROME, AUDIO_LEVEL, 'a=extmap:1/x\u00a0y urn:ietf:params:rtp-hdrext:ssrc-audio-level')
    const relayed = sanitizeSdp(smuggled, ALLOW)
    expect(relayed).not.toContain('audio-level')
    expect(sanitizeSdp(swap(CHROME, OPUS_FMTP + '\r\n', OPUS_FMTP + '\r\na=fmtp::111 usedtx=1\r\n'), ALLOW)).toBe(CHROME)
  })

  it('"a=group: BUNDLE …" is a BUNDLE group to Firefox (value trimmed, semantics upper-cased): it counts, and is refused', () => {
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:BUNDLE 0 1\r\na=group: BUNDLE 0 1'))).toEqual(['bundle_count'])
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group: BUNDLE 0 1'))).toContain('bundle_invalid')
    expect(codes(swap(CHROME, 'a=group:BUNDLE 0 1', 'a=group:  bundle 0 1'))).toContain('bundle_invalid')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('review: lenient readings of the security rules already fail closed (pinned)', () => {
  const fp = '4A:9E:1B:7C:22:D5:83:F0:6B:91:3E:CC:58:A7:0F:14:B2:69:DE:45:8C:13:F7:2A:60:BD:94:E1:37:5F:C8:0D'

  it('Firefox trims values and splits on any whitespace; this validator refuses every such spelling instead', () => {
    const video = `a=fingerprint:sha-256 ${fp}\r\na=setup:actpass\r\na=mid:1`
    for (const variant of [
      `a=fingerprint: sha-256 ${fp}\r\na=setup:actpass\r\na=mid:1`,
      `a=fingerprint:sha-256 ${fp} \r\na=setup:actpass\r\na=mid:1`,
      `a=fingerprint:sha-256  ${fp}\r\na=setup:actpass\r\na=mid:1`,
      `a=fingerprint:sha-256 ${fp}\r\na=setup: actpass\r\na=mid:1`,
      `a=fingerprint:sha-256 ${fp}\r\na=setup:actpass\r\na=mid: 1`,
      `a=fingerprint:sha-256 ${fp}\r\na=setup:actpass\r\na=mid:1 `,
    ]) {
      expect(validateRemoteSdp(swap(CHROME, video, variant)).ok, JSON.stringify(variant)).toBe(false)
    }
  })

  it('a second fingerprint smuggled under any name a lenient parser might honour is refused', () => {
    const decoy = 'D1:5C:0E:88:3B:A2:47:F9:6E:21:BC:73:09:D4:5A:E6:1F:82:C5:3D:97:4E:A0:68:2B:F1:56:CD:0A:93:E7:44'
    for (const line of [`a=FINGERPRINT:sha-256 ${decoy}`, `a=fingerprint::sha-256 ${decoy}`, `a=fingerprint:SHA-256 ${decoy}`, `a=fingerprint:sha-256 ${decoy.toLowerCase()}`]) {
      const sdp = swap(CHROME, 'a=mid:1\r\n', `a=mid:1\r\n${line}\r\n`)
      expect(validateRemoteSdp(sdp).ok, line).toBe(false)
      expect(sdpFingerprint(sdp), line).toBeNull()
    }
  })

  it('c= lines libwebrtc would still read (its tokenizer skips runs of "=" and spaces) are neutralised, not kept', () => {
    for (const c of ['c==IN IP4 198.51.100.77', 'c=IN  IP4 198.51.100.77', 'c=IN IP4  198.51.100.77', 'c=IN IP4 198.51.100.77 ']) {
      const out = sanitizeSdp(swap(CHROME, 'c=IN IP4 203.0.113.10', c), ALLOW)
      expect(out, c).not.toContain('198.51.100.77')
    }
  })

  it('candidates that libwebrtc would read but this module cannot rebuild are dropped, never passed through', () => {
    const real = 'candidate:1467250027 1 udp 41885439 203.0.113.10 50002 typ relay raddr 0.0.0.0 rport 0 generation 0'
    expect(sanitizeCandidateLine(real.replace('candidate:', 'candidate::'), ALLOW)).toBeNull()
    expect(sanitizeCandidateLine(real.replace(' 50002 ', '\u00a050002 '), ALLOW)).toBeNull()
    // The space form ("a=candidate <…>") is HasAttribute's to libwebrtc; it is never relayed.
    const anchor = 'a=candidate:3348186236 1 udp 8331007 203.0.113.10 50008 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10\r\n'
    for (const host of ['a=candidate 2999745851 1 udp 2122260223 192.168.1.23 61234 typ host generation 0', 'a=candidate 1 1 udp 1 fe80::1 61234 typ host']) {
      expect(sanitizeSdp(swap(CHROME, anchor, anchor + host + '\r\n'), ALLOW), host).toBe(CHROME)
    }
  })
})
