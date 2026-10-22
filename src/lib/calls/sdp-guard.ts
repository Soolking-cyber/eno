/**
 * In-app calls — the SDP and ICE-candidate guard (DESIGN.md v3 §3.2 steps 4–5, §2 Audio; review-refute-security
 * objections 1, 4 and 7). Pure string work, shared by the call routes (validate, then re-serialise, before a
 * description or a candidate is stored or relayed) and the call engine (validate the PEER's description, then
 * prepare it, right before setRemoteDescription).
 *
 * WHY A DESCRIPTION IS CHECKED AT ALL. (Written for protocol v1's safety code, which read both DTLS fingerprints from
 * getStats and was removed in v2; the rules stand — they keep each description meaning ONE certificate to every
 * parser.) The safety code read the fingerprints, never SDP text — but objection 1 showed that a description saying
 * two things at once is how a signalling
 * server gets more than its one guess: commit to a DECOY fingerprint (session level, or the first line), put the
 * certificate it really uses on the LAST fingerprint line of the m-section, and let libwebrtc do the rest. The
 * session-level value seeds every transport, each media-level line overwrites it, the last one wins, and the
 * duplicate check exists only at session level (pc/webrtc_sdp.cc: ParseSessionDescription refuses a second
 * session line, ParseContent just overwrites). So a description must say ONE thing to every parser: no
 * session-level fingerprint, exactly one sha-256 fingerprint per m-section and the same one in all of them,
 * every m-section inside the one BUNDLE group, and only the DTLS roles RFC 8842 allows (actpass / active /
 * passive — §5.1: "MUST NOT use ... holdconn").
 * ⚠️ THE CLIENT'S CHECK IS THE ONE THAT COUNTS. Objection 1's attacker IS the signalling server, so the engine
 * validates the description it is about to apply even though the route already did. The route's pass is
 * hygiene: it keeps junk out of the negotiation row and gives an honest client a clear refusal.
 * ⚠️ REFUSE A DESCRIPTION, NEVER REPAIR ONE. Picking "the right" fingerprint out of an ambiguous SDP is this
 * module guessing which line some browser will obey — the very guess the attack relies on. Honest browsers
 * never produce ambiguity; the one honest shape that fails is Firefox's session-level fingerprint, and that is
 * fixed by its OWN sender, on its own text, before sending (normalizeLocalSdp).
 * ⚠️ A REJECTED m-SECTION FAILS TOO. Port 0 without a=bundle-only means "rejected", and JSEP takes a rejected
 * section out of the BUNDLE group — so an answer that refuses video (a stopped transceiver, or no video codec the
 * callee can decode) is refused here instead of degrading to audio. The engine therefore never stops a
 * transceiver (camera off is replaceTrack, §2) and never offers a codec list the callee cannot decode.
 * (Firefox's port-0 a=bundle-only sections ARE in the group and pass.)
 * ⚠️ READ LIKE THE STRICTEST PARSER, REFUSE WHATEVER A LENIENT ONE MIGHT READ DIFFERENTLY. libwebrtc matches
 * attribute names case-sensitively, splits fields on single spaces, and reads through a run of colons after a
 * name ("a=fmtp::111" is payload type 111 to it); Firefox's webrtc-sdp lowercases names, trims values and splits
 * on any Unicode whitespace. A line one parser ignores and another obeys is a smuggling channel, so attribute
 * names must be lowercase and followed by at most one colon, control characters (TAB and C1 included), Unicode
 * line separators and non-ASCII spaces are refused, and every security-relevant value is checked against an
 * ASCII grammar.
 *
 * CANDIDATES (objection 7, §3.2 step 4). Relay-only is enforced by each CLIENT's iceTransportPolicy; the
 * route's re-serialisation is what still holds when a client is old, buggy or hostile: `typ relay` over UDP
 * only, an allow-listed relay address only, the related address zeroed exactly the way libwebrtc's own
 * relay-policy sanitiser zeroes it (0.0.0.0 / ::, rport 0 — port_allocator.cc), and only the four extensions
 * libwebrtc writes. Every kept candidate is REBUILT from validated fields — the original text never passes
 * through, so nothing can ride along in it.
 * ⚠️ AN ALLOW-LIST ENTRY MAY BE A CIDR PREFIX. Cloudflare's relayed addresses come from anycast RANGES it does not
 * enumerate (its TURN FAQ lists only the four server addresses), so exact IPs alone would drop every Cloudflare
 * candidate. A prefix broader than /8 (IPv4) or /16 (IPv6), or one with host bits set, is ignored — a typo
 * like "0.0.0.0/0" fails closed instead of allowing every address.
 * ⚠️ c= AND a=rtcp CARRY ADDRESSES TOO. libwebrtc writes its "default destination" there: the gathered UDP
 * candidate with the HIGHEST type preference, i.e. a host address whenever one was gathered
 * (webrtc_sdp.cc GetDefaultDestination). Under relay policy that is the relay; when a client is not under it,
 * sanitizeSdp writes the dummy 0.0.0.0 / :: that trickle-ICE descriptions already use, rather than forwarding
 * a stranger's IP.
 *
 * AUDIO (§2, objection 4). prepareRemoteSdp edits the PEER's description, which libwebrtc reads to configure
 * OUR sender. cbr=1 / usedtx=0 in the peer's Opus fmtp make our encoder constant-bitrate without DTX
 * (AudioEncoderOpusImpl::SdpToConfig reads both from the negotiated send format, i.e. the remote fmtp; VBR
 * packet sizes leak speech, RFC 6562). An ssrc-audio-level extmap missing from the peer's description is one
 * our sender never negotiates (RFC 6464: authenticated, NOT encrypted — "phoneme-level resolution"); the
 * speaking indicator is computed locally instead. The CSRC variant (RFC 6465, same property) goes too: a 1:1
 * call never mixes, so nothing is lost. Comfort noise (CN) goes as well: with any non-Opus send codec libwebrtc
 * turns a matching CN/8000 into VAD silence suppression, which is DTX by another name, and the send codec is just
 * the first one in the peer's list.
 * ⚠️ THIS IS A PROPERTY OF WHAT LIBWEBRTC BUILDS, SO READ EVERY LINE AS LIBWEBRTC READS IT. Its send codecs and
 * send header extensions come straight from the remote content (pc/channel.cc), it merges every fmtp line of a
 * payload type with the LAST value winning, it reads "::111" as 111, and it splits on 0x20 only. Each place this
 * module once read more strictly than that ("a=fmtp::111 usedtx=1", a U+2028 inside the Opus fmtp, an NBSP inside
 * an extmap, PCMU listed before Opus, an unpatched multiopus) let the signalling server switch the leak back on,
 * with validateRemoteSdp passing and sanitizeSdp relaying the text unchanged. Payload types are therefore parsed
 * with libwebrtc's own grammar, and an extmap goes if it so much as names an audio-level URI.
 * ⚠️ REMOTE DESCRIPTIONS ONLY. libwebrtc detects edits to a LOCAL description (setLocalDescription with text
 * createOffer/createAnswer did not produce) and Google can reject them remotely (WebRTC-NoSdpMangleReject). A
 * remote description is the peer's own text and is never subject to that. Each peer prepares the OTHER's
 * description, which covers both directions of the call.
 * ⚠️ NO SDP IN LOGS (research-security: "never log SDP or credentials"; §3.3 keeps negotiation rows out of the
 * dumps for the same reason). Errors carry a code, an m-section index and a line number — never line text,
 * which would put ICE passwords, fingerprints and addresses into logs.
 * ⚠️ NEVER .trim() AN SDP. Its final CRLF is part of it: libwebrtc refuses a description whose last line is
 * unterminated ("Invalid SDP line."), and so does validateRemoteSdp.
 */

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** DESIGN §3.2's ceiling for one description. A full Chrome/Safari SDP with every codec and its relay candidates
 *  is ~6–10 KB, so this is headroom, not a target. Counted in UTF-8 bytes — what a body limit and Postgres hold. */
export const SDP_MAX_BYTES = 65536

export type SdpGuardErrorCode =
  /** Larger than maxBytes. Reported alone: an oversized body is not parsed at all. */
  | 'too_large'
  /** Not text every parser reads the same way: a control character (TAB and C1 included), a bare CR, a Unicode
   *  line separator or non-ASCII space, no line break after the last line, a first line other than `v=0`, a line
   *  that is not `<lowercase letter>=<value>`, or an attribute name with capitals or followed by a colon run
   *  (`a=fmtp::111`). */
  | 'malformed'
  /** No m-section: nothing to call with and no fingerprint to bind. */
  | 'no_media'
  /** An a=fingerprint above the first m= line — the decoy slot of objection 1. */
  | 'session_fingerprint'
  /** An m-section with no a=fingerprint, or with more than one (libwebrtc obeys the LAST). */
  | 'fingerprint_count'
  /** An a=fingerprint whose digest is not 32 colon-separated hex bytes, or whose line is not `alg SP digest`. */
  | 'fingerprint_invalid'
  /** A well-formed fingerprint with a hash other than sha-256. */
  | 'fingerprint_algorithm'
  /** Two m-sections naming different certificates. */
  | 'fingerprint_mismatch'
  /** Not exactly one a=group:BUNDLE in the whole description. */
  | 'bundle_count'
  /** The one BUNDLE group sits inside an m-section, is not spelled `BUNDLE`, or lists a bad or repeated mid. */
  | 'bundle_invalid'
  /** An m-section outside the group, or a group mid that names no m-section. */
  | 'bundle_membership'
  /** An m-section without exactly one valid a=mid, a mid shared by two m-sections, or an a=mid at session level. */
  | 'mid_invalid'
  /** An a=setup value other than actpass / active / passive, or two a=setup lines at one level. */
  | 'setup_invalid'

export interface SdpGuardError {
  code: SdpGuardErrorCode
  /** 0-based m-section index; absent for session-level and whole-description problems. */
  section?: number
  /** 1-based line number when one line is to blame. */
  line?: number
}

export interface SdpValidation {
  ok: boolean
  /** Empty when ok. Capped at MAX_ERRORS entries — a hostile body cannot make the report itself large. */
  errors: SdpGuardError[]
}

export interface SdpValidationOptions {
  /** Defaults to SDP_MAX_BYTES; a non-positive or non-finite value also means the default. */
  maxBytes?: number
}

export interface RelayFilterOptions {
  /**
   * The ONE relay provider chosen for this call (§3.4: never mixed). Entries are plain IP literals
   * ('203.0.113.10', '2001:db8::10' — any valid spelling, compared canonically) or CIDR prefixes
   * ('141.101.64.0/18'). Anything else — brackets, zone ids, hostnames, a too-broad prefix — is ignored, so a bad
   * entry drops candidates (fail closed) rather than admitting them. ⚠️ An IPv4-mapped IPv6 address
   * (::ffff:a.b.c.d) does not match an IPv4 entry: the peer would treat it as an IPv6 destination.
   */
  allowedRelayIps: ReadonlySet<string>
}

/**
 * Checks a description before anyone applies or relays it. Every rule in the header; all problems are reported
 * (up to the cap), so a refusal in the logs says everything that was wrong at once.
 */
export function validateRemoteSdp(sdp: string, opts?: SdpValidationOptions): SdpValidation {
  const asked = opts == null ? undefined : opts.maxBytes
  const max = typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : SDP_MAX_BYTES
  // A UTF-16 string is never fewer UTF-8 bytes than code units, so the length test alone rejects most floods
  // without walking them.
  if (typeof sdp === 'string' && (sdp.length > max || utf8Length(sdp, max) > max)) {
    return { ok: false, errors: [{ code: 'too_large' }] }
  }
  const { errors } = inspect(sdp)
  return { ok: errors.length === 0, errors }
}

/**
 * The one certificate a description can mean, or null when it does not mean exactly one. Uppercase colon
 * hex — how libwebrtc writes it in SDP and in RTCCertificateStats.fingerprint. Used to notice a changed
 * certificate across re-offers: the engine pins the peer's certificate for the call's life and ends the call if a
 * later description names another (an honest browser keeps one certificate per connection, ICE restarts included).
 * ⚠️ null is not "unchanged": a caller comparing against a frozen value must treat null as a change.
 */
export function sdpFingerprint(sdp: string): string | null {
  return inspect(sdp).fingerprint
}

/**
 * Re-serialises ONE candidate for relaying, or returns null to drop it. Accepts 'candidate:…' (what
 * RTCIceCandidate.candidate / RTCIceCandidateInit.candidate hold) and 'a=candidate:…' (an SDP line); the output
 * keeps the input's form.
 * ⚠️ The empty string is RTCIceCandidateInit's end-of-candidates marker, not a candidate: it returns null, and a
 * route that wants to forward end-of-candidates must do so on its own. In SDP, a=end-of-candidates is kept
 * (sanitizeSdp).
 */
export function sanitizeCandidateLine(line: string, opts: RelayFilterOptions): string | null {
  return sanitizeCandidateWith(line, compileAllowList(opts && opts.allowedRelayIps))
}

/**
 * Re-serialises every a=candidate line (dropping what sanitizeCandidateLine drops), neutralises c= / a=rtcp
 * addresses that are not allowed relays, drops a=remote-candidates (an address list no browser writes) and
 * lines no browser writes at all (bad syntax, control characters, non-ASCII spaces and separators, a colon run
 * after an attribute name — a lenient parser downstream could read them as something nobody checked). Every other
 * line, and every line ending (CRLF stays CRLF), is byte-identical.
 * Idempotent: sanitising twice equals sanitising once.
 */
export function sanitizeSdp(sdp: string, opts: RelayFilterOptions): string {
  if (typeof sdp !== 'string') return ''
  const allow = compileAllowList(opts && opts.allowedRelayIps)
  const out: Line[] = []
  for (const l of splitLines(sdp)) {
    if (!wellFormedLine(l.text)) continue
    if (l.text.startsWith('c=')) {
      out.push({ text: neutraliseConnection(l.text, allow), eol: l.eol })
      continue
    }
    const a = attrOf(l.text)
    if (a !== null) {
      if (a.name === 'candidate') {
        const kept = sanitizeCandidateWith(l.text, allow)
        if (kept !== null) out.push({ text: kept, eol: l.eol })
        continue
      }
      if (a.name === 'remote-candidates') continue
      if (a.name === 'rtcp') {
        out.push({ text: neutraliseRtcp(l.text, allow), eol: l.eol })
        continue
      }
    }
    out.push(l)
  }
  return joinLines(out)
}

/**
 * The engine's last step before setRemoteDescription(peer's description): cbr=1 and usedtx=0 on every Opus (and
 * multiopus) fmtp of every audio m-section (overriding a peer's cbr=0 / usedtx=1, creating the fmtp right after
 * its rtpmap when absent, existing parameters kept in order, no key twice), every extmap naming an ssrc-/csrc-
 * audio-level URI removed (also inside an RFC 6904 encrypt wrapper, at session or media level), and comfort noise
 * taken out of every audio section that has another codec (its payload types leave the m= line, its rtpmap /
 * fmtp / rtcp-fb lines go). Nothing else changes, line endings included. Idempotent. Run validateRemoteSdp FIRST —
 * this function prepares, it does not judge — but it never relies on that: a line libwebrtc or Firefox would apply
 * to Opus is rewritten however it is spelled.
 * ⚠️ Never on a LOCAL description (see the header: munging detection).
 */
export function prepareRemoteSdp(sdp: string): string {
  if (typeof sdp !== 'string') return ''
  const lines = splitLines(sdp)
  const eolDefault = firstEol(lines)

  // Pass 1: which (m-section, payload type) pairs are Opus in an audio section, and which already have an
  // fmtp. Two passes because Firefox writes a=fmtp BEFORE a=rtpmap (it emits attributes in a fixed, roughly
  // alphabetical order), so a single pass would meet the Opus fmtp before knowing its payload type is Opus.
  const opus = new Set<string>()
  const withFmtp = new Set<string>()
  const formats: number[][] = [] // per m-section: its m= line's payload types (audio sections only)
  const named = new Map<string, string[]>() // 'section:pt' → every encoding an rtpmap line gives it
  let section = -1
  let audio = false
  for (const l of lines) {
    if (l.text.startsWith('m=')) {
      section++
      audio = isAudioMLine(l.text)
      formats.push(audio ? mLineFormats(l.text) : [])
      continue
    }
    if (!audio) continue
    const a = attrOf(l.text)
    if (a === null) continue
    if (a.name === 'rtpmap') {
      const r = parseRtpmap(a.rest)
      if (r !== null) {
        const key = section + ':' + r.pt
        if (OPUS_ENCODINGS.has(r.encoding)) opus.add(key)
        const list = named.get(key)
        if (list === undefined) named.set(key, [r.encoding])
        else list.push(r.encoding)
      }
    } else if (a.name === 'fmtp') {
      const f = parseFmtp(a.rest)
      if (f !== null) withFmtp.add(section + ':' + f.pt)
    }
  }

  // Comfort noise leaves every audio section that has something else to send with. libwebrtc pairs a mono CN/8000
  // with any non-Opus send codec as VAD silence suppression (webrtc_voice_engine.cc SetSendCodecs) — DTX under
  // another name — and the send codec is simply the first one in the PEER's list, so one reorder by a signalling
  // server would put talk spurts on the wire without cbr / usedtx ever being read. A section that is ONLY comfort
  // noise has no speech encoder to protect and is left alone rather than given an empty m= line.
  const strip = new Set<string>()
  for (let s = 0; s < formats.length; s++) {
    const cn = formats[s].filter((pt) => isComfortNoise(named.get(s + ':' + pt), pt))
    if (cn.length > 0 && cn.length < formats[s].length) for (const pt of cn) strip.add(s + ':' + pt)
  }

  // Pass 2: rewrite.
  const out: Line[] = []
  section = -1
  audio = false
  for (const l of lines) {
    if (l.text.startsWith('m=')) {
      section++
      audio = isAudioMLine(l.text)
      out.push(audio ? { text: withoutFormats(l.text, section, strip), eol: l.eol } : l)
      continue
    }
    const a = attrOf(l.text)
    if (a !== null && a.name === 'extmap' && isAudioLevelExtmap(a.rest)) continue
    if (audio && a !== null && (a.name === 'rtpmap' || a.name === 'fmtp' || a.name === 'rtcp-fb')) {
      const f = payloadTypeField(a.rest)
      if (f !== null && strip.has(section + ':' + f.pt)) continue
    }
    if (audio && a !== null && a.name === 'fmtp') {
      const f = parseFmtp(a.rest)
      if (f !== null && opus.has(section + ':' + f.pt)) {
        out.push({ text: 'a=fmtp:' + f.ptText + ' ' + withCbrNoDtx(f.params), eol: l.eol })
        continue
      }
    }
    if (audio && a !== null && a.name === 'rtpmap') {
      const r = parseRtpmap(a.rest)
      const key = r === null ? '' : section + ':' + r.pt
      if (r !== null && opus.has(key) && !withFmtp.has(key)) {
        // The new fmtp inherits this line's ending; if this was an unterminated last line, it gets one now.
        out.push({ text: l.text, eol: l.eol === '' ? eolDefault : l.eol })
        out.push({ text: 'a=fmtp:' + r.ptText + ' ' + OPUS_PRIVACY_PARAMS, eol: l.eol })
        withFmtp.add(key) // a second rtpmap for the same payload type must not insert a second fmtp
        continue
      }
    }
    out.push(l)
  }
  return joinLines(out)
}

/**
 * The SENDER's half of the contract, applied to the description its OWN browser produced, right before it is
 * POSTed (never before setLocalDescription — that would be munging). Today it does one thing: Firefox writes its
 * fingerprint once at SESSION level (and none per m-section), which validateRemoteSdp refuses by design; with
 * exactly that shape, the line moves to the end of every m-section, which means the same certificate to every
 * parser (RFC 8866: a session-level attribute applies to every media section). Chrome and Safari descriptions
 * come back unchanged, and so does any other shape — an ambiguous one stays ambiguous and is refused at the
 * receiver.
 */
export function normalizeLocalSdp(sdp: string): string {
  if (typeof sdp !== 'string') return ''
  const lines = splitLines(sdp)
  let section = -1
  let sessionAt = -1
  let sessionCount = 0
  let mediaCount = 0
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text
    if (text.startsWith('m=')) {
      section++
      continue
    }
    const a = attrOf(text)
    if (a === null || a.name !== 'fingerprint') continue
    if (section < 0) {
      sessionCount++
      sessionAt = i
    } else {
      mediaCount++
    }
  }
  if (section < 0 || sessionCount !== 1 || mediaCount !== 0) return sdp

  const fingerprint = lines[sessionAt].text
  const eolDefault = firstEol(lines)
  const out: Line[] = []
  let inMedia = false
  for (let i = 0; i < lines.length; i++) {
    if (i === sessionAt) continue
    const l = lines[i]
    if (l.text.startsWith('m=')) {
      if (inMedia) out.push({ text: fingerprint, eol: eolDefault })
      inMedia = true
    }
    out.push({ text: l.text, eol: l.eol })
  }
  const last = out[out.length - 1]
  if (last.eol === '') {
    last.eol = eolDefault
    out.push({ text: fingerprint, eol: '' })
  } else {
    out.push({ text: fingerprint, eol: last.eol })
  }
  return joinLines(out)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

interface Line {
  text: string
  /** '\r\n', '\n', or '' for an unterminated last line — kept per line so output endings match input. */
  eol: string
}

/** Splits on LF like libwebrtc's GetLine (a CR right before the LF belongs to the line ending). */
function splitLines(sdp: string): Line[] {
  const lines: Line[] = []
  let pos = 0
  while (pos < sdp.length) {
    const nl = sdp.indexOf('\n', pos)
    if (nl === -1) {
      lines.push({ text: sdp.slice(pos), eol: '' })
      break
    }
    const crlf = nl > pos && sdp.charCodeAt(nl - 1) === 13
    lines.push({ text: sdp.slice(pos, crlf ? nl - 1 : nl), eol: crlf ? '\r\n' : '\n' })
    pos = nl + 1
  }
  return lines
}

function joinLines(lines: readonly Line[]): string {
  let s = ''
  for (const l of lines) s += l.text + l.eol
  return s
}

function firstEol(lines: readonly Line[]): string {
  for (const l of lines) if (l.eol !== '') return l.eol
  return '\r\n'
}

/**
 * libwebrtc's own line test (GetLine): `<lowercase letter>=<value>`, at least 3 characters, no space after the
 * `=` except in s=. Lines failing it make libwebrtc stop or fail — and a more lenient parser might accept them —
 * so neither validation nor sanitising lets one through. More refusals, all texts that libwebrtc and another parser
 * read differently:
 * - an ambiguous character (ambiguousChar), on any line;
 * - any non-ASCII character outside the free-text s= and i= lines. Browsers write none, and Unicode case folding
 *   makes look-alikes real: webrtc-sdp matches Opus parameters with Rust's to_uppercase(), which turns
 *   "u\u017fedtx" (LONG S) into USEDTX; a Kelvin sign lower-cases to "k". No ASCII grammar here would catch them all;
 *   refusing the alphabet they live in does;
 * - `a=<name>::…`. libwebrtc's GetValue splits at ':' with tokenize_first, which SKIPS A RUN of delimiters
 *   (rtc_base/string_encode.cc), so "a=fmtp::111" is payload type 111 and "a=group::BUNDLE" a BUNDLE group to it,
 *   while Firefox's webrtc-sdp (splitn on the first ':') and this module read them as something else. Browsers
 *   never write a colon run there; an IPv6 "::" later in a value is not one.
 */
function wellFormedLine(text: string): boolean {
  if (text.length < 3 || text.charCodeAt(1) !== 61 /* = */) return false
  const type = text.charCodeAt(0)
  if (type < 97 || type > 122) return false
  if (text.charCodeAt(2) === 32 && type !== 115 /* s */) return false
  const freeText = type === 115 /* s */ || type === 105 /* i */
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (ambiguousChar(c) || (c > 126 && !freeText)) return false
  }
  if (type === 97 /* a */) {
    let end = 2 // the attribute name ends where attrOf ends it: the first ':' or ' '
    while (end < text.length && text.charCodeAt(end) !== 58 && text.charCodeAt(end) !== 32) end++
    if (text.charCodeAt(end) === 58 && text.charCodeAt(end + 1) === 58) return false
  }
  return true
}

/**
 * A character some parser reads as a control, a line break or whitespace while libwebrtc reads it as plain bytes:
 * C0 controls (TAB included) and DEL; C1 controls (NEL is a line break to Java's \R and Python's splitlines); and
 * every non-ASCII space or separator — JS `\s` / trim() / a regex `.` (which stops at U+2028), and Rust's
 * split_whitespace / trim, which Firefox's webrtc-sdp uses on attribute values. ⚠️ Each was a live bypass of the
 * rewrite below (an NBSP inside an extmap, a U+2028 inside the Opus fmtp). Browsers write none of them; ordinary
 * non-ASCII letters (a Vietnamese s= line) are not on the list.
 */
function ambiguousChar(c: number): boolean {
  return (
    c < 32 ||
    (c >= 127 && c <= 159) ||
    c === 0xa0 ||
    c === 0x1680 ||
    c === 0x180e ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

/**
 * An a= line's attribute: its name as written, lowercased (how a lenient parser would match it), and what
 * follows the name (starting at ':' or ' ', or ''). The name ends at ':' OR ' ' because libwebrtc's
 * HasAttribute accepts either — "a=fingerprint sha-256 …" is a (broken) fingerprint line to it, not an
 * unknown attribute.
 */
function attrOf(text: string): { raw: string; name: string; rest: string } | null {
  if (text.charCodeAt(0) !== 97 /* a */ || text.charCodeAt(1) !== 61 /* = */) return null
  let end = 2
  while (end < text.length) {
    const c = text.charCodeAt(end)
    if (c === 58 /* : */ || c === 32) break
    end++
  }
  const raw = text.slice(2, end)
  return { raw, name: raw.toLowerCase(), rest: text.slice(end) }
}

/** Exact UTF-8 byte length (lone surrogates count 3, as TextEncoder writes U+FFFD), stopping once past `stopAt`. */
function utf8Length(s: string, stopAt: number): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
    if (n > stopAt) return n
  }
  return n
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_ERRORS = 32

const DIGEST_RE = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/
/** RFC 8866 token — what a mid (RFC 8843 identification-tag) may be, and what libwebrtc's GetSingleTokenValue
 *  checks. libwebrtc sets no length cap; 64 refuses only what no browser writes (they use "0", "1"). */
const TOKEN_RE = /^[!#$%&'*+\-.0-9A-Z^_`a-z{|}~]{1,64}$/

type FingerprintParse = { kind: 'ok'; value: string } | { kind: 'algorithm' } | { kind: 'invalid' }

/** `rest` of an a=fingerprint line → its sha-256 digest, normalised to uppercase. libwebrtc's own parse:
 *  exactly two single-space-separated fields, algorithm compared lowercased (ParseFingerprintAttribute). */
function parseFingerprint(rest: string): FingerprintParse {
  if (rest.charAt(0) !== ':') return { kind: 'invalid' }
  const fields = rest.slice(1).split(' ')
  if (fields.length !== 2) return { kind: 'invalid' }
  if (fields[0].toLowerCase() !== 'sha-256') {
    return /^[A-Za-z0-9-]{1,16}$/.test(fields[0]) ? { kind: 'algorithm' } : { kind: 'invalid' }
  }
  if (!DIGEST_RE.test(fields[1])) return { kind: 'invalid' }
  return { kind: 'ok', value: fields[1].toUpperCase() }
}

interface Inspection {
  errors: SdpGuardError[]
  /** Set only when every fingerprint rule holds on a well-formed description. */
  fingerprint: string | null
}

/** One parse shared by validateRemoteSdp and sdpFingerprint, so the two can never disagree about a description. */
function inspect(sdp: unknown): Inspection {
  const errors: SdpGuardError[] = []
  const fail = (code: SdpGuardErrorCode, section = -1, line = 0): void => {
    if (errors.length >= MAX_ERRORS) return
    const e: SdpGuardError = { code }
    if (section >= 0) e.section = section
    if (line > 0) e.line = line
    errors.push(e)
  }
  if (typeof sdp !== 'string' || sdp.length === 0) {
    fail('malformed')
    return { errors, fingerprint: null }
  }

  // Whole-text checks first: they decide whether reading line by line means the same thing to every parser.
  let malformed = false
  let lineNo = 1
  for (let i = 0; i < sdp.length; i++) {
    const c = sdp.charCodeAt(i)
    if (c === 10) {
      lineNo++
      continue
    }
    if (c === 13 && sdp.charCodeAt(i + 1) === 10) continue
    if (ambiguousChar(c)) {
      fail('malformed', -1, lineNo)
      malformed = true
      break
    }
  }
  if (sdp.charCodeAt(sdp.length - 1) !== 10) {
    fail('malformed', -1, lineNo)
    malformed = true
  }
  const lines = splitLines(sdp)
  if (lines[0].text !== 'v=0') {
    fail('malformed', -1, 1)
    malformed = true
  }

  let section = -1
  let sessionFingerprint = false
  const fingerprints: Array<Array<{ parse: FingerprintParse; line: number }>> = []
  const mids: string[][] = [] // per m-section; '' marks an a=mid whose value is not a token
  const setups = new Map<number, number>() // section (-1 = session) → a=setup lines seen
  const bundles: Array<{ section: number; line: number; exact: boolean; mids: string[] }> = []

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const text = lines[i].text
    if (text.startsWith('m=')) {
      section++
      fingerprints.push([])
      mids.push([])
    }
    if (!wellFormedLine(text)) {
      fail('malformed', section, n)
      malformed = true
      continue
    }
    const a = attrOf(text)
    if (a === null) continue
    // Browsers write every attribute name in lowercase. A capitalised one is ignored by libwebrtc and possibly
    // obeyed by a parser that lowercases — so it is refused outright, whatever the attribute.
    if (a.raw !== a.name) {
      fail('malformed', section, n)
      malformed = true
    }
    if (a.name === 'fingerprint') {
      if (section < 0) {
        sessionFingerprint = true
        fail('session_fingerprint', -1, n)
      } else {
        fingerprints[section].push({ parse: parseFingerprint(a.rest), line: n })
      }
    } else if (a.name === 'group') {
      if (a.rest.charAt(0) !== ':') {
        fail('malformed', section, n)
        malformed = true
        continue
      }
      const fields = a.rest.slice(1).split(' ')
      // Any spelling of BUNDLE counts towards "exactly one": libwebrtc only honours `BUNDLE`, so a `bundle`
      // group next to a real one would be a second group to some parser and nothing to another. "Any spelling"
      // includes leading spaces: Firefox's webrtc-sdp trims the value and upper-cases the semantics, so
      // "a=group: BUNDLE 0 1" is a BUNDLE group to it.
      let first = 0
      while (first < fields.length - 1 && fields[first] === '') first++
      if (fields[first].toLowerCase() === 'bundle') {
        bundles.push({ section, line: n, exact: first === 0 && fields[0] === 'BUNDLE', mids: fields.slice(first + 1) })
      }
    } else if (a.name === 'mid') {
      if (section < 0) {
        fail('mid_invalid', -1, n)
        continue
      }
      const value = a.rest.charAt(0) === ':' ? a.rest.slice(1) : ''
      mids[section].push(TOKEN_RE.test(value) ? value : '')
    } else if (a.name === 'setup') {
      const seen = (setups.get(section) || 0) + 1
      setups.set(section, seen)
      const value = a.rest.charAt(0) === ':' ? a.rest.slice(1) : ''
      if (seen > 1 || (value !== 'actpass' && value !== 'active' && value !== 'passive')) {
        fail('setup_invalid', section, n)
      }
    }
  }

  const sections = fingerprints.length
  if (sections === 0) fail('no_media')

  // Fingerprints: exactly one per m-section, sha-256, one value everywhere.
  let fingerprintHolds = !malformed && !sessionFingerprint && sections > 0
  const values: string[] = []
  for (let s = 0; s < sections; s++) {
    const list = fingerprints[s]
    if (list.length !== 1) {
      fail('fingerprint_count', s, list.length > 1 ? list[1].line : 0)
      fingerprintHolds = false
    }
    for (const fp of list) {
      if (fp.parse.kind === 'ok') {
        if (values.indexOf(fp.parse.value) === -1) values.push(fp.parse.value)
      } else {
        fail(fp.parse.kind === 'algorithm' ? 'fingerprint_algorithm' : 'fingerprint_invalid', s, fp.line)
        fingerprintHolds = false
      }
    }
  }
  if (values.length > 1) {
    fail('fingerprint_mismatch')
    fingerprintHolds = false
  }

  // Mids: exactly one valid token per m-section, unique across m-sections (libwebrtc refuses duplicates too).
  const midOf: Array<string | null> = []
  const midOwner = new Map<string, number>()
  for (let s = 0; s < sections; s++) {
    const list = mids[s]
    const mid = list.length === 1 && list[0] !== '' ? list[0] : null
    if (mid === null || midOwner.has(mid)) fail('mid_invalid', s)
    if (mid !== null && !midOwner.has(mid)) midOwner.set(mid, s)
    midOf.push(mid)
  }

  // BUNDLE: exactly one group, at session level, spelled BUNDLE, naming exactly the m-sections' mids.
  if (bundles.length !== 1) fail('bundle_count', -1, bundles.length > 1 ? bundles[1].line : 0)
  if (bundles.length === 1) {
    const group = bundles[0]
    const listed = new Set<string>()
    let bad = group.section >= 0 || !group.exact
    for (const mid of group.mids) {
      if (!TOKEN_RE.test(mid) || listed.has(mid)) bad = true
      listed.add(mid)
    }
    if (bad) fail('bundle_invalid', group.section, group.line)
    for (let s = 0; s < sections; s++) {
      const mid = midOf[s]
      if (mid === null || !listed.has(mid)) fail('bundle_membership', s)
    }
    listed.forEach((mid) => {
      if (!midOwner.has(mid)) fail('bundle_membership', -1, group.line)
    })
  }

  return { errors, fingerprint: fingerprintHolds && values.length === 1 ? values[0] : null }
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

type Ip = { v: 4; n: number } | { v: 6; g: number[] }

/**
 * A strict IP literal: dotted-quad IPv4 without leading zeros (inet_aton would read "010" as octal — libwebrtc's
 * inet_pton refuses it, so do we), or IPv6 with at most one "::" and an optional dotted IPv4 tail. No brackets,
 * no zone ids, no hostnames (an mDNS .local name is a host candidate by definition).
 */
function parseIp(s: string): Ip | null {
  if (s.indexOf(':') === -1) {
    const n = parseIpv4(s)
    return n === null ? null : { v: 4, n }
  }
  const g = parseIpv6(s)
  return g === null ? null : { v: 6, g }
}

function parseIpv4(s: string): number | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    n = n * 256 + octet
  }
  return n
}

function parseIpv6(s: string): number[] | null {
  if (s.length < 2 || s.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(s)) return null
  let text = s
  if (text.indexOf('.') !== -1) {
    // Rewrite a dotted IPv4 tail as two hex groups, then parse one grammar.
    const cut = text.lastIndexOf(':')
    const v4 = parseIpv4(text.slice(cut + 1))
    if (v4 === null) return null
    text = text.slice(0, cut + 1) + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16)
  }
  const gap = text.indexOf('::')
  if (gap !== -1 && text.indexOf('::', gap + 1) !== -1) return null
  const groupsOf = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const h of part.split(':')) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }
  if (gap === -1) {
    const all = groupsOf(text)
    return all !== null && all.length === 8 ? all : null
  }
  const left = groupsOf(text.slice(0, gap))
  const right = groupsOf(text.slice(gap + 2))
  if (left === null || right === null || left.length + right.length > 7) return null
  const zeros: number[] = []
  for (let i = left.length + right.length; i < 8; i++) zeros.push(0)
  return left.concat(zeros, right)
}

/** RFC 5952 canonical text (what inet_ntop writes): lowercase, no leading zeros, the longest run of two or more
 *  zero groups as "::" (the first on a tie), and ::ffff:a.b.c.d for IPv4-mapped addresses. */
function formatIp(ip: Ip): string {
  if (ip.v === 4) {
    const n = ip.n
    const octets = [Math.floor(n / 16777216), Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256]
    return octets.join('.')
  }
  const g = ip.g
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return '::ffff:' + (g[6] >> 8) + '.' + (g[6] & 255) + '.' + (g[7] >> 8) + '.' + (g[7] & 255)
  }
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = (x: number): string => x.toString(16)
  if (bestLen < 2) return g.map(hex).join(':')
  return g.slice(0, bestStart).map(hex).join(':') + '::' + g.slice(bestStart + bestLen).map(hex).join(':')
}

function isUnspecified(ip: Ip): boolean {
  return ip.v === 4 ? ip.n === 0 : ip.g.every((x) => x === 0)
}

interface AllowList {
  exact: Set<string> // canonical text
  v4: Array<{ net: number; len: number }>
  v6: Array<{ net: number[]; len: number }>
}

const MIN_PREFIX_V4 = 8
const MIN_PREFIX_V6 = 16

function compileAllowList(entries: ReadonlySet<string> | null | undefined): AllowList {
  const list: AllowList = { exact: new Set<string>(), v4: [], v6: [] }
  if (!entries || typeof entries.forEach !== 'function') return list
  entries.forEach((raw) => {
    if (typeof raw !== 'string') return
    const entry = raw.trim()
    const slash = entry.indexOf('/')
    if (slash === -1) {
      const ip = parseIp(entry)
      if (ip !== null) list.exact.add(formatIp(ip))
      return
    }
    const ip = parseIp(entry.slice(0, slash))
    const lenText = entry.slice(slash + 1)
    if (ip === null || !/^[0-9]{1,3}$/.test(lenText)) return
    const len = Number(lenText)
    if (ip.v === 4) {
      if (len < MIN_PREFIX_V4 || len > 32 || ip.n % Math.pow(2, 32 - len) !== 0) return
      list.v4.push({ net: ip.n, len })
    } else {
      if (len < MIN_PREFIX_V6 || len > 128 || !hostBitsZero6(ip.g, len)) return
      list.v6.push({ net: ip.g, len })
    }
  })
  return list
}

function hostBitsZero6(g: number[], len: number): boolean {
  for (let i = 0; i < 8; i++) {
    const prefixBits = Math.max(0, Math.min(16, len - 16 * i))
    if ((g[i] & (0xffff >> prefixBits)) !== 0) return false
  }
  return true
}

function prefixEqual6(a: number[], b: number[], len: number): boolean {
  for (let i = 0; i < 8 && len > 16 * i; i++) {
    const bits = Math.min(16, len - 16 * i)
    const mask = (0xffff << (16 - bits)) & 0xffff
    if ((a[i] & mask) !== (b[i] & mask)) return false
  }
  return true
}

function allowed(list: AllowList, ip: Ip): boolean {
  if (list.exact.has(formatIp(ip))) return true
  if (ip.v === 4) {
    for (const p of list.v4) {
      const block = Math.pow(2, 32 - p.len)
      if (Math.floor(ip.n / block) === Math.floor(p.net / block)) return true
    }
    return false
  }
  for (const p of list.v6) if (prefixEqual6(ip.g, p.net, p.len)) return true
  return false
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const ICE_CHARS_RE = /^[A-Za-z0-9+/]+$/
const MAX_CANDIDATE_LENGTH = 1024 // a real one is ~150 characters

/**
 * Parse → validate → rebuild. The output is assembled ONLY from fields that passed a strict grammar, in
 * libwebrtc's own order (BuildCandidate: generation, ufrag, network-id, network-cost), so an honest Chrome or
 * Safari relay candidate round-trips byte-identical and anything else is either normalised or dropped.
 */
function sanitizeCandidateWith(input: string, allow: AllowList): string | null {
  if (typeof input !== 'string') return null
  let line = input
  // libwebrtc's ParseCandidate tolerates one trailing line break; so do we (the output carries none).
  if (line.charCodeAt(line.length - 1) === 10) line = line.slice(0, -1)
  if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1)
  if (line.length === 0 || line.length > MAX_CANDIDATE_LENGTH) return null
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i)
    if (c < 32 || c === 127) return null
  }

  let prefix = ''
  let body = line
  if (body.startsWith('a=')) {
    prefix = 'a='
    body = body.slice(2)
  }
  const colon = body.indexOf(':')
  // Any capitalisation of "candidate" is recognised (a lenient parser would obey it) and written canonically.
  if (colon === -1 || body.slice(0, colon).toLowerCase() !== 'candidate') return null
  const f = body.slice(colon + 1).split(' ')
  if (f.length < 8) return null

  const foundation = f[0]
  if (foundation.length > 32 || !ICE_CHARS_RE.test(foundation)) return null
  const component = uintField(f[1], 3, 256)
  if (component === null || component < 1) return null
  // A relay candidate's own transport is always UDP — TURN over TCP/TLS still relays UDP, and the client-to-TURN
  // leg shows only in getStats' relayProtocol. A tcp "relay" would be an RFC 6062 allocation, which no browser
  // makes and no eno relay offers.
  if (f[2].toLowerCase() !== 'udp') return null
  const priority = uintField(f[3], 10, 4294967295)
  if (priority === null) return null
  const ip = parseIp(f[4])
  if (ip === null || !allowed(allow, ip)) return null
  const port = uintField(f[5], 5, 65535)
  if (port === null || port === 0) return null
  // Exact, case-sensitive, like libwebrtc: "typ RELAY" is not a relay candidate to it, so it is not one to us.
  if (f[6] !== 'typ' || f[7] !== 'relay') return null

  // Extensions come in name/value pairs after `typ relay`. raddr/rport are replaced, tcptype cannot apply to a
  // UDP candidate, pwd is an ICE password nobody needs relayed, and anything unknown is dropped. Last value wins
  // for a repeated name, as in libwebrtc; an invalid value drops that attribute, not the candidate.
  let generation: number | null = null
  let ufrag: string | null = null
  let networkId: number | null = null
  let networkCost: number | null = null
  for (let i = 8; i + 1 < f.length; i += 2) {
    const name = f[i]
    const value = f[i + 1]
    if (name === 'generation') {
      const v = uintField(value, 10, 4294967295)
      if (v !== null) generation = v
    } else if (name === 'ufrag') {
      if (value.length >= 4 && value.length <= 256 && ICE_CHARS_RE.test(value)) ufrag = value
    } else if (name === 'network-id') {
      const v = uintField(value, 5, 65535)
      if (v !== null) networkId = v
    } else if (name === 'network-cost') {
      const v = uintField(value, 5, 65535)
      if (v !== null) networkCost = v
    }
  }

  const raddr = ip.v === 6 ? '::' : '0.0.0.0'
  let out = prefix + 'candidate:' + foundation + ' ' + component + ' udp ' + priority + ' ' + formatIp(ip) + ' ' + port
  out += ' typ relay raddr ' + raddr + ' rport 0'
  if (generation !== null) out += ' generation ' + generation
  if (ufrag !== null) out += ' ufrag ' + ufrag
  if (networkId !== null) out += ' network-id ' + networkId
  if (networkCost !== null) out += ' network-cost ' + networkCost
  return out
}

/** Digits only — no sign, exponent or space (libwebrtc's istringstream parse would take a '+' or '-'; the rebuilt
 *  candidate never carries one) — at most `maxDigits` long and at most `max`. Leading zeros are accepted and
 *  dropped by the re-serialisation. */
function uintField(text: string, maxDigits: number, max: number): number | null {
  if (text.length === 0 || text.length > maxDigits || !/^[0-9]+$/.test(text)) return null
  const n = Number(text)
  return n <= max ? n : null
}

/** c=<nettype> <addrtype> <address> (libwebrtc ParseConnectionData; the addrtype must match the family). */
function neutraliseConnection(text: string, allow: AllowList): string {
  const f = text.slice(2).split(' ')
  if (f.length === 3 && f[0] === 'IN' && (f[1] === 'IP4' || f[1] === 'IP6')) {
    const ip = parseIp(f[2])
    if (ip !== null && (isUnspecified(ip) || allowed(allow, ip))) return text
    return f[1] === 'IP6' ? 'c=IN IP6 ::' : 'c=IN IP4 0.0.0.0'
  }
  return 'c=IN IP4 0.0.0.0'
}

/** a=rtcp:<port> [IN IP4|IP6 <address>] (RFC 3605). libwebrtc ignores the line; another parser may not. */
function neutraliseRtcp(text: string, allow: AllowList): string {
  const m = /^a=rtcp:([0-9]{1,5})(?: IN (IP4|IP6) ([^ ]+))?$/.exec(text)
  if (m === null) return 'a=rtcp:9 IN IP4 0.0.0.0'
  if (m[3] === undefined) return text
  const ip = parseIp(m[3])
  if (ip !== null && (isUnspecified(ip) || allowed(allow, ip))) return text
  return 'a=rtcp:' + m[1] + ' IN ' + m[2] + ' ' + (m[2] === 'IP6' ? '::' : '0.0.0.0')
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const OPUS_PRIVACY_PARAMS = 'cbr=1;usedtx=0'
const OWNED_FMTP: Record<string, string> = { cbr: '1', usedtx: '0' }
/** Encodings whose encoder reads cbr / usedtx from the remote fmtp. multiopus is a NotAdvertisedEncoder in
 *  Chromium (audio_codec_factory.cc): never offered, but created if a description names it, and its SdpToConfig
 *  reads both parameters exactly like opus. */
const OPUS_ENCODINGS: ReadonlySet<string> = new Set(['opus', 'multiopus'])
const SSRC_AUDIO_LEVEL_URI = 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'
const CSRC_AUDIO_LEVEL_URI = 'urn:ietf:params:rtp-hdrext:csrc-audio-level'

function isAudioMLine(text: string): boolean {
  return text.slice(2).split(' ')[0].toLowerCase() === 'audio'
}

/**
 * A payload type as EITHER engine reads one: libwebrtc's GetPayloadTypeFromString → StringToNumber (an optional
 * '-', then digits, value 0–127) or Firefox's webrtc-sdp, u8::from_str (an optional '+', then digits, 0–255).
 * ⚠️ So "0111" IS payload type 111 to both, and "+111" is 111 to Firefox — and "a=fmtp:0111 usedtx=1" injected after
 * the real fmtp line would switch DTX back on in libwebrtc (fmtp lines merge, last value wins), "a=fmtp:+111
 * usedtx=1" injected BEFORE it in Firefox (FindFmtp takes the first). Matching only the canonical spelling here
 * would let a signalling server undo prepareRemoteSdp; matching the union of both grammars means every line either
 * engine applies to the Opus codec is one this module rewrote. (A value one engine refuses makes that engine refuse
 * the whole description, which is safe.)
 */
function parsePayloadType(text: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(text)) return null
  const n = Number(text) + 0 // `+ 0` folds "-0" to 0
  return n >= 0 && n <= 255 ? n : null
}

/**
 * The payload-type field of an a=rtpmap / a=fmtp / a=rtcp-fb line (`rest` as attrOf returns it), read the way
 * EITHER engine reads it. libwebrtc: GetValue splits at ':' with tokenize_first, which skips a RUN of colons; the
 * field ends at the first space; what follows starts after the run of spaces (tokenize_first again,
 * ParseFmtpAttributes). Firefox (webrtc-sdp): the value after the first ':' is trimmed (Unicode White_Space), then
 * splitn(2, ' '). So any run of colons, spaces and ambiguous characters before the digits is skipped.
 * ⚠️ A STRICTER READING IS A BYPASS. With one colon required, "a=fmtp::111 usedtx=1;cbr=0" was not an fmtp line to
 * this module, stayed untouched, and libwebrtc merged it into Opus LAST (UpdateCodec → AddParameters): DTX and VBR
 * back on. "a=fmtp: 111 usedtx=1" placed before the real line did the same to a Firefox sender (FindFmtp takes the
 * first match; libwebrtc refuses that spelling, the validator did not). The validator refuses colon runs and odd
 * characters now; this reading keeps prepareRemoteSdp right on its own.
 * ⚠️ NO REGEX. The pattern this replaced backtracked quadratically on "a=fmtp:111" + spaces + U+2028 (17.5 s for one
 * 64 KB description — a frozen call tab, from any peer), and its `.` could not cross U+2028, which hid the line
 * from the rewrite as well.
 */
function payloadTypeField(rest: string): { pt: number; ptText: string; after: string } | null {
  if (rest.charCodeAt(0) !== 58 /* : */) return null
  let start = 1
  while (start < rest.length) {
    const c = rest.charCodeAt(start)
    if (c !== 58 && c !== 32 && !ambiguousChar(c)) break
    start++
  }
  const space = rest.indexOf(' ', start)
  const end = space === -1 ? rest.length : space
  const ptText = rest.slice(start, end)
  const pt = parsePayloadType(ptText)
  if (pt === null) return null
  let after = end
  while (rest.charCodeAt(after) === 32) after++
  return { pt, ptText, after: rest.slice(after) }
}

/** `rest` of a=rtpmap:<pt> <encoding>/<clock>[/<channels>] → payload type and lowercased encoding name
 *  (libwebrtc compares codec names case-insensitively). */
function parseRtpmap(rest: string): { pt: number; ptText: string; encoding: string } | null {
  const f = payloadTypeField(rest)
  if (f === null) return null
  const slash = f.after.indexOf('/')
  const encoding = slash <= 0 ? '' : f.after.slice(0, slash)
  if (encoding === '' || encoding.indexOf(' ') !== -1) return null
  return { pt: f.pt, ptText: f.ptText, encoding: foldCase(encoding) }
}

/** `rest` of a=fmtp:<pt> <params> → payload type and the raw parameter text. */
function parseFmtp(rest: string): { pt: number; ptText: string; params: string } | null {
  const f = payloadTypeField(rest)
  return f === null ? null : { pt: f.pt, ptText: f.ptText, params: f.after }
}

/** The m= line's payload types, each read with libwebrtc's grammar, without repeats (at most 128 distinct). */
function mLineFormats(text: string): number[] {
  const out: number[] = []
  const fields = text.split(' ')
  for (let i = 3; i < fields.length; i++) {
    const pt = parsePayloadType(fields[i])
    if (pt !== null && out.indexOf(pt) === -1) out.push(pt)
  }
  return out
}

/** The m= line without the given payload types; byte-identical when none of them is in it. */
function withoutFormats(text: string, section: number, strip: ReadonlySet<string>): string {
  const fields = text.split(' ')
  const kept = fields.filter((field, i) => {
    if (i < 3) return true
    const pt = parsePayloadType(field)
    return pt === null || !strip.has(section + ':' + pt)
  })
  return kept.length === fields.length ? text : kept.join(' ')
}

/**
 * Opus fmtp parameters with cbr=1 and usedtx=0 forced. Parameters split on ';' and trimmed, as libwebrtc does
 * (ParseFmtpParameterSet). A repeated key keeps its first position and its last value — libwebrtc's own
 * semantics, so the line means what it meant, written once. cbr/usedtx match case-insensitively in BOTH
 * directions (foldCase: a peer's "CBR=0" or Firefox's upper-cased "u\u017fedtx" is replaced, not left beside ours);
 * other keys exactly, as libwebrtc's map compares them.
 */
function withCbrNoDtx(params: string): string {
  const out: string[] = []
  const at = new Map<string, number>()
  for (const raw of params.split(';')) {
    const token = raw.trim()
    if (token === '') continue
    const eq = token.indexOf('=')
    if (eq <= 0) {
      out.push(token) // a value-only parameter (RFC 2198 / 4733 style) — not ours, kept as written
      continue
    }
    const key = token.slice(0, eq).trim()
    const folded = foldCase(key)
    const owned = Object.prototype.hasOwnProperty.call(OWNED_FMTP, folded)
    const mapKey = owned ? folded : key
    const rendered = owned ? mapKey + '=' + OWNED_FMTP[mapKey] : token
    const index = at.get(mapKey)
    if (index === undefined) {
      at.set(mapKey, out.length)
      out.push(rendered)
    } else {
      out[index] = rendered
    }
  }
  for (const key of Object.keys(OWNED_FMTP)) if (!at.has(key)) out.push(key + '=' + OWNED_FMTP[key])
  return out.join(';')
}

/**
 * a=extmap:<id>[/<dir>] <uri> … or a=extmap:<id> urn:…:encrypt <uri> … (RFC 6904): any extmap line that so much as
 * NAMES an audio-level URI, in any case and any position. ⚠️ Not a tokenizer on purpose. libwebrtc splits on 0x20
 * only and never reads the direction (ParseExtmap), so "a=extmap:1/x<NBSP>y <uri>" negotiates audio levels to it,
 * while a JS `\s+` split read "y" as the URI and kept the line. Removing a line no parser would have honoured costs
 * nothing; keeping one that some parser honours leaks every syllable's loudness.
 */
function isAudioLevelExtmap(rest: string): boolean {
  const text = foldCase(rest)
  return text.indexOf(SSRC_AUDIO_LEVEL_URI) !== -1 || text.indexOf(CSRC_AUDIO_LEVEL_URI) !== -1
}

/**
 * Case-insensitive the way the LOOSEST parser is: upper-cased, then lower-cased. Lower-casing alone misses letters
 * that only upper-case to ASCII (U+017F LONG S → "S", which Firefox's webrtc-sdp relies on for Opus parameter
 * names); upper-casing alone misses ones that only lower-case to ASCII (U+212A KELVIN SIGN → "k"). Used wherever a
 * match decides what gets rewritten or removed — over-matching there only makes our sender quieter.
 */
function foldCase(s: string): string {
  return s.toUpperCase().toLowerCase()
}

/** A payload type libwebrtc would treat as comfort noise: one an rtpmap names CN (IsCodec is case-insensitive), or
 *  static 13 when no rtpmap remaps it (MaybeCreateStaticPayloadAudioCodecs). Any rtpmap saying CN counts, even one
 *  a later rtpmap overrides — stripping a codec from OUR send options can only make the sender quieter. */
function isComfortNoise(encodings: readonly string[] | undefined, pt: number): boolean {
  return encodings === undefined ? pt === 13 : encodings.indexOf('cn') !== -1
}
