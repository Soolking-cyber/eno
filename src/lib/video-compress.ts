// Client-side video compression — the iPhone-clip fix (2026-07-18).
//
// WHY: the Supabase project's upload ceiling is 50MB (probed; owner-raisable only in the
// dashboard), but a real 60s iPhone HEVC clip is 60–400MB — so before this existed, every
// normal iPhone video died at select with "too large". Instead of rejecting, the post
// wizard now RE-ENCODES oversized clips in the browser down to ≤720p at a bitrate that
// lands a 60s clip around ~35–40MB, then uploads that.
//
// HOW: no demuxer dependency — the platform does the heavy lifting.
//   <video muted> (native decode: iOS decodes its own HEVC in hardware) → canvas draw loop
//   (requestVideoFrameCallback, rAF fallback) → canvas.captureStream() + the clip's sound
//   (`planAudio`: the element's captureStream() track, or the file's audio decoded and played
//   into a MediaStreamDestination — never to the speakers) → MediaRecorder (H.264 MP4 on
//   Safari/WebKit and current Chromium, else VP9/VP8 WebM — first supported type wins).
//
// Realtime by nature (a 60s clip takes ~60s to re-encode; a teacher's five-minute intro video,
// five minutes — src/lib/video-length.ts) — callers surface onProgress.
// Every failure path throws VideoCompressError with a compact reason; callers fall back
// to an honest "too large" toast, never a hang (hard watchdog at duration × 1.25 + 30s).

import { mediaElementCaptureSupported, takeCompressionAudioContext } from '@/lib/compression-audio'

export class VideoCompressError extends Error {
  constructor(public reason: 'unsupported' | 'decode_failed' | 'record_failed' | 'still_too_large' | 'timeout' | 'no_picture' | 'interrupted' | 'truncated') {
    super(`video_compress_${reason}`)
  }
}

// Recorder container/codec preference: MP4/H.264 first (Safari + iOS WKWebView — also
// universally playable, skipping the server HEVC transcode), then WebM (Chromium).
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/**
 * THE LARGEST CLIP A VIDEO PICKER ACCEPTS — the teacher form (src/lib/teachers/video-prep.ts) and the post wizard
 * (src/hooks/use-post-media.ts) — and the largest whose sound is decoded: ONE number, so every clip that goes up keeps its
 * sound (owner, 2026-10-17: "put 150mb limit so we have all clips with sound"). decodeAudioData takes the ENTIRE file in
 * memory (plus ~23 MB of decoded sound a minute, beside the video decoder and the recorder), and a tab a phone kills for
 * memory is worse than a refused pick — so the cap is conservative: a phone's default 1080p minute is 60–100 MB; a 4K one
 * is refused with "record in 1080p".
 */
export const VIDEO_PICK_MAX_BYTES = 150 * 1024 * 1024
const DECODE_AUDIO_MAX_BYTES = VIDEO_PICK_MAX_BYTES

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })

type AudioPlan =
  | { kind: 'capture'; stream: MediaStream }
  | { kind: 'decode'; ctx: AudioContext; buffer: AudioBuffer; sink: MediaStreamAudioDestinationNode }
  | { kind: 'none' }

/**
 * WHERE THE SOUND COMES FROM. Until 2026-10-17 it was the muted element routed through createMediaElementSource — and a
 * muted element feeds that graph SILENCE (Web Audio: "volume, and other aspects of the HTMLMediaElement MUST affect the
 * audio stream"): every compressed clip carried an AAC track of digital silence (−91 dB measured on two teacher intro
 * videos uploaded that day; the same −91 dB reproduced in Chromium and WebKit). Measured in a Playwright harness — a tone
 * at −21 dB for the sound, a white flash and a beep both at 3.0 s for the sync (picture time minus sound time):
 *  1. The file's audio DECODED whole and played into the recorder beside the frames, started with the first frame shown —
 *     Chromium −21.1 dB, +0.04–0.07 s; desktop WebKit −21.2 dB, but the sound +0.23 s ahead there whichever start was tried
 *     (its picture track runs late — to be checked on an iPhone). The element stays muted. First choice everywhere, through
 *     the AudioContext the picker tap started (src/lib/compression-audio.ts — iOS runs one only from a gesture).
 *  2. The element's own captureStream() track (Chromium, Android WebViews, Firefox) — −21.2 dB, unaffected by muted, but
 *     the sound LEADS the picture by 0.18–0.55 s, run to run (it is taken ahead of what is shown). Only where decoding
 *     cannot: a clip over the decode cap, a context that will not run. Early sound beats none.
 *  3. Neither — no sound, as before this, and never a failed upload: the teacher intro video is required.
 * ⚠️ The element itself stays MUTED: that is what lets play() run with no user gesture (autoplay policy, and Android
 * WebViews' mediaPlaybackRequiresUserGesture). Unmuting it would carry the sound through the old graph — and refuse to play.
 */
async function planAudio(video: HTMLVideoElement, file: File): Promise<AudioPlan> {
  if (file.size <= DECODE_AUDIO_MAX_BYTES) {
    const decoded = await decodeAudio(file)
    if (decoded) return decoded
  } else {
    // Too big to decode: the context the tap started is not needed — closed now, not after the unused-release timer.
    void takeCompressionAudioContext()?.close().catch(() => undefined)
  }
  if (mediaElementCaptureSupported()) {
    try {
      const el = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
      const capture = el.captureStream ?? el.mozCaptureStream
      if (capture) return { kind: 'capture', stream: capture.call(video) }
    } catch { /* fall through to no sound */ }
  }
  return { kind: 'none' }
}

/**
 * How long the decode may take before the clip goes on without sound. ⛔ It runs before the compression's watchdog exists, so
 * without this a decodeAudioData that never settles (a known class of WebKit bug) held "Making it smaller…" forever — and
 * the teacher intro video is required (review, 2026-10-17). A minute of sound decodes in a second or two.
 */
const DECODE_AUDIO_TIMEOUT_MS = 20_000

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

/**
 * ⛔ AN iPHONE CLIP IS A QUICKTIME .MOV, AND WEBKIT'S decodeAudioData REFUSES ONE (harness, 2026-10-17): EncodingError for
 * every ftyp 'qt  ' file tried — H.264, HEVC, ProRes, MJPEG, sound only — and WebKit has no element captureStream either, so
 * a compressed iPhone clip in Safari went up with NO sound at all. The same bytes with the brand rewritten to 'mp42' decode
 * (measured on macOS WebKit; an iPhone is still to be checked). Rewrites, in place, every 'qt  ' brand in a leading ftyp
 * box — never minor_version (offset 12), never past the box; anything else is left untouched.
 */
export function unbrandQuickTime(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf)
  if (b.length < 16 || fourcc(b, 4) !== 'ftyp') return false
  // Every size form a box may use (gate review): 32-bit, 1 = a 64-bit size after the type, 0 = to the end of the file. A
  // brand list is a few words: read no further than 256 bytes whatever the size says.
  let len = u32(b, 0)
  let at = 8
  if (len === 1) { len = u32(b, 8) * 2 ** 32 + u32(b, 12); at = 16 } else if (len === 0) len = b.length
  const end = Math.min(b.length, len, at + 256)
  let changed = false
  for (let i = at; i + 4 <= end; i += 4) {
    if (i !== at + 4 && fourcc(b, i) === 'qt  ') { b.set([0x6d, 0x70, 0x34, 0x32], i); changed = true } // 'qt  ' → 'mp42'; at + 4 is minor_version
  }
  return changed
}

/** The decoded path — null when it cannot run (no context, one that stays suspended, a clip with no audio track, too slow). */
async function decodeAudio(file: File): Promise<Extract<AudioPlan, { kind: 'decode' }> | null> {
  const ctx = takeCompressionAudioContext()
  if (!ctx) return null
  const attempt = async (): Promise<Extract<AudioPlan, { kind: 'decode' }>> => {
    // Suspended (no tap reached it) or "interrupted" (Safari, e.g. after the Photos picker): one try to resume, bounded.
    const state = () => ctx.state as string
    if (state() !== 'running') await Promise.race([ctx.resume().catch(() => undefined), sleep(1_000)])
    if (state() !== 'running') throw new Error('not running')
    // Throws for a clip with no audio track (EncodingError) — no sound to carry, which is fine. ONE full read (review: a
    // 150 MB clip read twice could cost an iPhone tab ~300 MB): a QuickTime .mov is rewritten before its only decode — the
    // three engines decode the rewritten file at the source's own level (measured, −24.1 dB).
    const bytes = await file.arrayBuffer()
    unbrandQuickTime(bytes)
    const buffer = await ctx.decodeAudioData(bytes)
    return { kind: 'decode', ctx, buffer, sink: ctx.createMediaStreamDestination() }
  }
  try {
    const result = await Promise.race([attempt(), sleep(DECODE_AUDIO_TIMEOUT_MS).then(() => null)])
    if (!result) throw new Error('decode timeout')
    return result
  } catch {
    void ctx.close().catch(() => undefined)
    return null
  }
}

/**
 * captureStream()'s audio track is there once the metadata is (measured in Chromium: present at loadedmetadata, the same live
 * track after a seek) — a short wait covers an engine that adds it later; a clip with no sound never gets one.
 */
async function captureAudioTracks(stream: MediaStream): Promise<MediaStreamTrack[]> {
  for (let i = 0; i < 6 && !stream.getAudioTracks().length; i++) await sleep(50)
  return stream.getAudioTracks()
}

/** Bytes [start, end) of the recording — a Blob slice in the browser, an array in tests. */
export type ReadBytes = (start: number, end: number) => Promise<Uint8Array>

/** The ISO-BMFF boxes in b[start, end) as [type, payload start, box end]; null when a size does not fit (malformed). */
function boxes(b: Uint8Array, start: number, end: number): Array<[string, number, number]> | null {
  const out: Array<[string, number, number]> = []
  for (let i = start; i + 8 <= end; ) {
    let len = u32(b, i)
    let head = 8
    if (len === 1) {
      if (i + 16 > end) return null
      len = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12)
      head = 16
    } else if (len === 0) len = end - i
    if (len < head || i + len > end) return null
    out.push([fourcc(b, i + 4), i + head, i + len])
    i += len
  }
  return out
}

/** moov › trak › mdia › hdlr: a handler of type 'vide' (a full box: version/flags and pre_defined come first). */
function moovDeclaresVideo(m: Uint8Array, payload: number): boolean | null {
  const traks = boxes(m, payload, m.length)
  if (!traks) return null
  // A trak whose handler cannot be read leaves the answer unknown (null), never "no picture" (gate review).
  let unreadable = false
  for (const [type, from, to] of traks) {
    if (type !== 'trak') continue
    const mdia = boxes(m, from, to)?.find(([t]) => t === 'mdia')
    const hdlr = mdia && boxes(m, mdia[1], mdia[2])?.find(([t]) => t === 'hdlr')
    if (!hdlr || hdlr[1] + 12 > hdlr[2]) { unreadable = true; continue }
    if (fourcc(m, hdlr[1] + 8) === 'vide') return true
  }
  return unreadable ? null : false
}

/** The top-level boxes walked by their sizes — an mdat is stepped over, never read — to the moov. */
async function mp4DeclaresVideo(read: ReadBytes, size: number): Promise<boolean | null> {
  for (let at = 0, n = 0; at + 8 <= size && n < 1_000; n++) {
    const h = await read(at, Math.min(size, at + 16))
    if (h.length < 8) return null
    let len = u32(h, 0)
    let head = 8
    if (len === 1) {
      if (h.length < 16) return null
      len = u32(h, 8) * 2 ** 32 + u32(h, 12)
      head = 16
    } else if (len === 0) len = size - at
    if (len < head || at + len > size) return null
    if (fourcc(h, 4) === 'moov') return len > 8 * 1024 * 1024 ? null : moovDeclaresVideo(await read(at, at + len), head)
    at += len
  }
  return null
}

/** An EBML variable-length integer at b[i]: [value, length] — an ID keeps its marker bits; a size of all ones is −1 (unknown). */
function vint(b: Uint8Array, i: number, id: boolean): [number, number] | null {
  const first = b[i]
  if (first === undefined || first === 0) return null
  let len = 1
  while (!(first & (0x80 >> (len - 1)))) len++
  if (i + len > b.length) return null
  let v = id ? first : first & (0xff >> len)
  let ones = v === 0xff >> len
  for (let k = 1; k < len; k++) {
    v = v * 256 + b[i + k]
    if (b[i + k] !== 0xff) ones = false
  }
  return [!id && ones ? -1 : v, len]
}

function ebml(b: Uint8Array, at: number): { id: number; size: number; data: number } | null {
  const id = vint(b, at, true)
  const size = id && vint(b, at + id[1], false)
  return id && size ? { id: id[0], size: size[0], data: at + id[1] + size[1] } : null
}

/** EBML header › Segment › Tracks › TrackEntry: TrackType 1 (video) or a CodecID "V_…". Read from the first 64 KB, where every
 * recorder writes its Tracks; a Cluster — or anything of unknown size — before them is not judged. */
async function webmDeclaresVideo(read: ReadBytes, size: number): Promise<boolean | null> {
  const b = await read(0, Math.min(size, 64 * 1024))
  const head = ebml(b, 0)
  if (!head || head.id !== 0x1a45dfa3 || head.size < 0) return null
  const segment = ebml(b, head.data + head.size)
  if (!segment || segment.id !== 0x18538067) return null
  const segmentEnd = segment.size < 0 ? b.length : Math.min(b.length, segment.data + segment.size)
  for (let at = segment.data; at < segmentEnd; ) {
    const e = ebml(b, at)
    if (!e || e.size < 0 || e.id === 0x1f43b675) return null
    if (e.id === 0x1654ae6b) {
      if (e.data + e.size > b.length) return null
      let entries = 0
      for (let t = e.data; t < e.data + e.size; ) {
        const entry = ebml(b, t)
        if (!entry || entry.size < 0 || entry.data + entry.size > e.data + e.size) return null
        if (entry.id === 0xae) {
          entries++
          for (let f = entry.data; f < entry.data + entry.size; ) {
            const field = ebml(b, f)
            if (!field || field.size < 0 || field.data + field.size > entry.data + entry.size) return null
            if (field.id === 0x83 && field.size >= 1 && field.size <= 8) {
              let type = 0
              for (let k = 0; k < field.size; k++) type = type * 256 + b[field.data + k]
              if (type === 1) return true
            }
            if (field.id === 0x86 && field.size >= 2 && b[field.data] === 0x56 && b[field.data + 1] === 0x5f) return true
            f = field.data + field.size
          }
        }
        t = entry.data + entry.size
      }
      return entries ? false : null
    }
    at = e.data + e.size
  }
  return null
}

/**
 * WHETHER A RECORDING DECLARES A PICTURE TRACK — read from its STRUCTURE, never a byte pattern (gate review, 2026-10-17):
 * WebKit FINISHES an MP4 with sound only when no frame reached its canvas track — the shape of a 2026-10-16 upload that had
 * no picture at all. MP4: the boxes walked to the moov wherever it is (an mdat is skipped, not read), then trak › mdia ›
 * hdlr 'vide'; WebM: the Segment to its Tracks, then a TrackEntry of TrackType 1 / CodecID "V_". `null` when the structure
 * cannot be read (another container, malformed, a header not where a recorder writes it): never a guess against the clip.
 */
export async function declaresVideoTrack(read: ReadBytes, size: number): Promise<boolean | null> {
  const start = await read(0, Math.min(size, 8))
  if (start.length >= 8 && fourcc(start, 4) === 'ftyp') return mp4DeclaresVideo(read, size)
  if (start.length >= 4 && u32(start, 0) === 0x1a45dfa3) return webmDeclaresVideo(read, size)
  return null
}

/** A big-endian unsigned 64-bit field as a number (exact to 2^53 — a media time in any real timescale). */
const u64 = (b: Uint8Array, i: number) => u32(b, i) * 2 ** 32 + u32(b, i + 4)

/**
 * HOW MANY SECONDS OF PICTURE A RECORDING HOLDS — read from its MP4 structure (2026-10-18, for the five-minute intro video).
 * ⛔ WebKit's recorder can stop writing partway and still finish a valid file: measured in WebKit 26.5 (Playwright), a
 * 1 s-timeslice MP4 recording of a 150 s and a 300 s clip held 72 fragments — 78 s — each, while the element played to its
 * end and every other check here passed; Safari 26.0–26.1 lost the end of MP4 recordings outright (WebKit bug 299164,
 * fixed in 26.2). A clip under 78 s never showed it; a teacher's five-minute intro video went up as its first 78 s. The
 * picture track's end: an unfragmented file's mdhd duration, else its fragments' decode times (tfdt — or the running
 * total where one has none) plus their samples' durations (trun, else tfhd's default, else trex's). ⚠️ WebKit ends a
 * recording with a NEGATIVE sample duration written unsigned (≈ 2^32 — ffmpeg reads that 60 s clip as 7,158,338 s,
 * measured): a duration with its top bit set counts nothing, or every recording would read as complete. `null` when the
 * structure cannot be read, WebM included — never a guess against the clip.
 */
export async function recordedSeconds(read: ReadBytes, size: number): Promise<number | null> {
  const start = await read(0, Math.min(size, 8))
  if (start.length < 8 || fourcc(start, 4) !== 'ftyp') return null
  let moov: { b: Uint8Array; head: number } | null = null
  const moofs: Array<{ b: Uint8Array; head: number }> = []
  for (let at = 0, n = 0; at + 8 <= size; n++) {
    // Past this many boxes the file is not walked to its end — unread, never a short reading (gate review, 2026-10-18).
    if (n >= 20_000) return null
    const h = await read(at, Math.min(size, at + 16))
    if (h.length < 8) return null
    let len = u32(h, 0)
    let head = 8
    if (len === 1) {
      if (h.length < 16) return null
      len = u64(h, 8)
      head = 16
    } else if (len === 0) len = size - at
    if (len < head || at + len > size) return null
    const type = fourcc(h, 4)
    if (type === 'moov') {
      if (len > 8 * 1024 * 1024) return null
      moov = { b: await read(at, at + len), head }
    } else if (type === 'moof') {
      if (len > 1024 * 1024) return null
      moofs.push({ b: await read(at, at + len), head })
    }
    at += len
  }
  if (!moov) return null
  const m = moov.b
  // moov › trak: the picture track's id, timescale and duration; mvex › trex: each track's default sample duration.
  let video: { id: number; scale: number; duration: number } | null = null
  const trexDuration = new Map<number, number>()
  const top = boxes(m, moov.head, m.length)
  if (!top) return null
  for (const [type, from, to] of top) {
    if (type === 'trak') {
      const kids = boxes(m, from, to)
      const tkhd = kids?.find(([t]) => t === 'tkhd')
      const mdia = kids?.find(([t]) => t === 'mdia')
      const inner = mdia ? boxes(m, mdia[1], mdia[2]) : null
      const hdlr = inner?.find(([t]) => t === 'hdlr')
      const mdhd = inner?.find(([t]) => t === 'mdhd')
      if (!tkhd || !hdlr || !mdhd || hdlr[1] + 12 > hdlr[2] || fourcc(m, hdlr[1] + 8) !== 'vide') continue
      const v1 = m[mdhd[1]] === 1
      if (mdhd[1] + (v1 ? 32 : 20) > mdhd[2] || tkhd[1] + 24 > tkhd[2]) return null
      video = {
        id: u32(m, tkhd[1] + (m[tkhd[1]] === 1 ? 20 : 12)),
        scale: u32(m, mdhd[1] + (v1 ? 20 : 12)),
        duration: v1 ? u64(m, mdhd[1] + 24) : u32(m, mdhd[1] + 16),
      }
    } else if (type === 'mvex') {
      for (const [t, f, e] of boxes(m, from, to) ?? []) if (t === 'trex' && f + 16 <= e) trexDuration.set(u32(m, f + 4), u32(m, f + 12))
    }
  }
  if (!video || !video.scale) return null
  let end = video.duration // an unfragmented file's own length; 0 in a fragmented one
  let running = 0
  for (const { b, head } of moofs) {
    const trafs = boxes(b, head, b.length)
    if (!trafs) return null
    for (const [type, from, to] of trafs) {
      if (type !== 'traf') continue
      const kids = boxes(b, from, to)
      const tfhd = kids?.find(([t]) => t === 'tfhd')
      if (!kids || !tfhd || tfhd[1] + 8 > tfhd[2] || u32(b, tfhd[1] + 4) !== video.id) continue
      const flags = u32(b, tfhd[1]) & 0xffffff
      const durAt = tfhd[1] + 8 + (flags & 0x1 ? 8 : 0) + (flags & 0x2 ? 4 : 0)
      const fallback = flags & 0x8 && durAt + 4 <= tfhd[2] ? u32(b, durAt) : trexDuration.get(video.id) ?? 0
      const tfdt = kids.find(([t]) => t === 'tfdt')
      const base = tfdt && tfdt[1] + 8 <= tfdt[2] ? (b[tfdt[1]] === 1 && tfdt[1] + 12 <= tfdt[2] ? u64(b, tfdt[1] + 4) : u32(b, tfdt[1] + 4)) : running
      let span = 0
      for (const [t, f, e] of kids) {
        if (t !== 'trun' || f + 8 > e) continue
        const tf = u32(b, f) & 0xffffff
        const count = u32(b, f + 4)
        if (!(tf & 0x100)) { span += count * fallback; continue }
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((bit) => tf & bit).length
        let p = f + 8 + (tf & 0x1 ? 4 : 0) + (tf & 0x4 ? 4 : 0)
        for (let i = 0; i < count && p + 4 <= e; i++, p += stride) { const d = u32(b, p); if (d < 2 ** 31) span += d }
      }
      running = base + span
      end = Math.max(end, running)
    }
  }
  // Nothing read (no fragment of the picture track, no durations): unread, never 0 s (gate review, 2026-10-18).
  return end > 0 ? end / video.scale : null
}

/**
 * WAS THE RECORDING CUT SHORT? Its picture against the SHORTER of the source's own picture track (where its structure reads
 * — every phone's MP4/MOV) and the length the element plays (gate review, 2026-10-18): the element's is the LONGEST track,
 * so a clip whose sound runs on past its picture would read as cut against it; the stored picture can run past what plays,
 * so a trimmed clip keeping its cut-off lead-in (an edit list) would read as cut against that. 3 s of slack for the
 * recorder's start and its last fragment; a recording whose length cannot be read is never called cut.
 */
export function recordingCutShort(recorded: number | null, sourcePicture: number | null, played: number): boolean {
  return recorded !== null && recorded < Math.min(sourcePicture ?? played, played) - 3
}

/** A browser that hides canvas reads (anti-fingerprinting) must never fail a clip: the painted check runs only where a read reads back. */
function canvasReadsBack(): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const x = c.getContext('2d')
    if (!x) return false
    x.fillStyle = '#000'
    x.fillRect(0, 0, 1, 1)
    return x.getImageData(0, 0, 1, 1).data[3] === 255
  } catch {
    return false
  }
}

export function videoCompressionSupported(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && RECORDER_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/** Re-encode `file` to fit inside `targetBytes`. Resolves to a new File (mp4 or webm). */
export async function compressVideo(file: File, opts: {
  targetBytes: number
  onProgress?: (fraction: number) => void
}): Promise<File> {
  if (!videoCompressionSupported()) throw new VideoCompressError('unsupported')
  const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type))!
  const container = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  // Muted so autoplay policy never blocks the processing run — and the sound is NOT taken from its output (a muted
  // element feeds silence to createMediaElementSource): see `planAudio`.
  video.muted = true

  let audioContext: AudioContext | null = null
  let bufferSource: AudioBufferSourceNode | null = null
  let onPageHidden: (() => void) | null = null
  let wakeLock: { release: () => Promise<void> } | null = null
  let finished = false
  const cleanup = () => {
    finished = true
    if (onPageHidden) document.removeEventListener('visibilitychange', onPageHidden)
    void wakeLock?.release().catch(() => undefined)
    video.onplaying = null
    video.onwaiting = null
    video.onseeked = null
    try { bufferSource?.stop() } catch { /* never started */ }
    try { video.pause() } catch { /* already torn down */ }
    video.removeAttribute('src')
    try { video.load() } catch { /* detached */ }
    URL.revokeObjectURL(url)
    void audioContext?.close().catch(() => undefined)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new VideoCompressError('decode_failed')), 15_000)
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve() }
      video.onerror = () => { window.clearTimeout(timer); reject(new VideoCompressError('decode_failed')) }
      video.src = url
    })

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new VideoCompressError('decode_failed')
    // ⛔ A PICTURE THIS BROWSER CANNOT DECODE reads 0×0 while its sound plays on (Chromium and Firefox — an iPhone's 10-bit
    // HEVC, ProRes, MPEG-4 Part 2: measured 2026-10-17) — and was then recorded for the clip's whole length into a failure,
    // or a picture-less upload. Refused here, before the sound is decoded. A decodable picture reports its size at metadata
    // in all three engines (measured); one still without data gets 10 s for its first frame (gate review: a slow phone).
    if (!video.videoWidth || !video.videoHeight) {
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const go = () => {
            window.clearTimeout(t)
            for (const type of ['loadeddata', 'resize', 'error']) video.removeEventListener(type, go)
            resolve()
          }
          const t = window.setTimeout(go, 10_000)
          for (const type of ['loadeddata', 'resize', 'error']) video.addEventListener(type, go)
        })
      }
      // A file that broke while it was awaited is unreadable — not "this browser cannot read the picture" (review).
      if (video.error) throw new VideoCompressError('decode_failed')
      if (!video.videoWidth || !video.videoHeight) throw new VideoCompressError('no_picture')
    }

    // Output geometry: fit within 1280×720, even dimensions (encoder requirement).
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, 1), 720 / Math.max(video.videoHeight, 1))
    const width = Math.max(2, Math.floor((video.videoWidth * scale) / 2) * 2)
    const height = Math.max(2, Math.floor((video.videoHeight * scale) / 2) * 2)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new VideoCompressError('unsupported')

    // Bitrate budget: fill ~85% of the target across the clip's real duration, clamped
    // to a sane 720p range (a 60s clip at 4.5Mbps + 128k audio ≈ 35MB — well under 50MB).
    // ⚠️ The floor is 0.8 Mbps, not the 1.2 it was (2026-10-18): a teacher's five-minute intro video budgets 1.06 Mbps of
    // picture into 50 MB, and the old floor lifted it to 1.2 — 49.97 MB, 95% of the target, so a recorder running a little
    // over its rate failed 'still_too_large' after the whole five-minute wait. Below 0.8 only past 6.4 minutes, which no
    // caller allows; a minute's clip never comes near either (its budget is over the 4.5 cap).
    const totalBudgetBits = (opts.targetBytes * 8 * 0.85) / duration
    const audioBitsPerSecond = 128_000
    const videoBitsPerSecond = Math.min(4_500_000, Math.max(800_000, Math.floor(totalBudgetBits - audioBitsPerSecond)))

    const stream = canvas.captureStream()
    // "Making it smaller… 0%" from here, not "Uploading…": the decode below can take a few seconds before the first frame.
    opts.onProgress?.(0)
    // ⛔ THE SOUND JOINS BEFORE THE RECORDER STARTS — a track added to a running MediaRecorder is ignored.
    const audio = await planAudio(video, file)
    if (audio.kind === 'capture') {
      for (const track of await captureAudioTracks(audio.stream)) stream.addTrack(track)
    } else if (audio.kind === 'decode') {
      audioContext = audio.ctx
      for (const track of audio.sink.stream.getAudioTracks()) stream.addTrack(track)
    }

    const chunks: BlobPart[] = []
    let resolveDone!: () => void
    let rejectDone!: (e: unknown) => void
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
    // A run that throws before awaiting it (play() refused) must not leave an unhandled rejection behind (review, 2026-10-17).
    void done.catch(() => undefined)
    let stopTimer = 0
    const startRecorder = (type = mimeType) => {
      const r = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond, audioBitsPerSecond })
      r.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      r.onstop = () => resolveDone()
      r.onerror = () => rejectDone(new VideoCompressError('record_failed'))
      r.start(1_000)
      return r
    }
    let recorder: MediaRecorder | null = null
    /**
     * The recorder, first that starts: the preferred type; then — with sound — the bare container (Firefox: 'video/webm;
     * codecs=vp8' with a sound track throws NotSupportedError, and every Firefox compression had gone up silent — harness,
     * 2026-10-17); then the frames alone, a silent clip rather than a failed upload (review, 2026-10-17). None → record_failed.
     */
    const record = () => {
      const tries: Array<() => MediaRecorder> = [() => startRecorder()]
      if (stream.getAudioTracks().length) tries.push(() => startRecorder(mimeType.split(';')[0]))
      tries.push(() => {
        for (const track of stream.getAudioTracks()) stream.removeTrack(track)
        return startRecorder()
      })
      for (const attempt of tries) {
        chunks.length = 0
        try {
          recorder = attempt()
          break
        } catch { /* the next */ }
      }
      if (!recorder) throw new VideoCompressError('record_failed')
    }
    /**
     * ⛔ THE ELEMENT'S OWN TRACK CARRIES NO SAMPLES UNTIL PLAYBACK RUNS, so with it the recorder starts AFTER play() — started
     * before (as the decoded and the silent paths do, their sound flowing from the first instant), the frames ran from 0 while
     * the sound began a beat later and Chromium's MP4 writer put it at 0 too: the sound led the picture by 0.76 s (measured,
     * a flash and a beep both at 3.0 s, 2026-10-17).
     */
    const recordAfterPlay = audio.kind === 'capture' && stream.getAudioTracks().length > 0
    if (!recordAfterPlay) record()

    /**
     * IN STEP WITH THE FRAMES (plan review + harness, 2026-10-17): the decoded sound starts on the FIRST FRAME ACTUALLY
     * SHOWN (requestVideoFrameCallback's mediaTime), from where that frame is — not on `playing`, which can fire before a
     * frame is; `playing` is the fallback without the callback. Measured (a flash and a beep both at 3.0 s): Chromium
     * +0.05–0.07 s over three runs; desktop WebKit +0.23 s with either start (its picture track runs late — to be checked on
     * an iPhone). A STALL is held to the frames: `waiting` stops the sound, `playing` starts it again from the frame.
     * ⛔ No continuous drift correction: re-aligning on every frame to the AudioContext clock (which starts slowly in
     * Chromium) jumped the sound ahead — +0.33 s in two of four runs. Over a minute the two clocks do not drift apart.
     * ⛔ Never suspend(): holding the context left WebKit's MediaRecorder waiting on a silent track at stop() — onstop never
     * came and the compression hung (harness, 2026-10-17).
     */
    const hasFrameCallback = typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function'
    let syncSound: ((frameTime: number) => void) | null = null
    if (audio.kind === 'decode' && stream.getAudioTracks().length) {
      const sound = audio
      let started = false
      let stalled = false
      const playFrom = (at: number) => {
        try { bufferSource?.stop() } catch { /* not started */ }
        try {
          bufferSource = sound.ctx.createBufferSource()
          bufferSource.buffer = sound.buffer
          bufferSource.connect(sound.sink)
          bufferSource.start(0, Math.max(0, at))
        } catch { bufferSource = null /* no sound from here — never a failed upload */ }
      }
      syncSound = (frameTime: number) => {
        if (started) return
        started = true
        playFrom(frameTime)
      }
      video.onwaiting = () => {
        if (!started) return
        stalled = true
        try { bufferSource?.stop() } catch { /* not started */ }
        bufferSource = null
      }
      video.onplaying = () => {
        if (!started) {
          if (!hasFrameCallback) syncSound?.(video.currentTime)
          return
        }
        if (stalled) { stalled = false; playFrom(video.currentTime) }
      }
    }

    // Draw loop — rVFC ties draws to real decoded frames (Safari 15.4+/Chromium);
    // rAF fallback for anything older.
    let stopped = false
    /**
     * DID A FRAME LAND ON THE CANVAS? It starts transparent and a drawn video frame — black included — is opaque; five
     * points, so a clip with a transparent middle still counts. Read ONLY when no frame was presented (below) — then the
     * canvas holds the only draws there were — so an ordinary clip costs no canvas read at all (review: reads can move a
     * canvas off the GPU in Chromium).
     */
    const readsBack = canvasReadsBack()
    const painted = () => {
      if (!readsBack) return true
      try {
        const at = [[width >> 1, height >> 1], [width >> 2, height >> 2], [(3 * width) >> 2, height >> 2], [width >> 2, (3 * height) >> 2], [(3 * width) >> 2, (3 * height) >> 2]]
        return at.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] !== 0)
      } catch {
        return true
      }
    }
    let drewWithData = false
    const draw = () => {
      if (video.readyState >= 2) drewWithData = true
      ctx.drawImage(video, 0, 0, width, height)
    }
    /**
     * ⛔ NO PICTURE = BOTH SIGNALS SAY SO (gate review, four rounds on the pixels alone): the frames the engine PRESENTED
     * (requestVideoFrameCallback — each one is drawn) and the pixels that LANDED. Either one alone refused real clips — a
     * transparent clip with its subject off the five points still presents frames; a phone that presents none still paints
     * the first frame — so a clip is refused only when neither saw a picture, and only after a draw that had frame data to
     * draw (a recorder that fails before any data must not read as "no picture" — review). Without the callback nothing is
     * concluded from the canvas; the size check and the structure check still apply.
     */
    let framesPresented = 0
    const noPicture = () => hasFrameCallback && framesPresented === 0 && drewWithData && !painted()
    const scheduleDraw = (_now?: number, frame?: { mediaTime?: number }) => {
      if (stopped) return
      if (frame) framesPresented++
      if (frame && syncSound) syncSound(frame.mediaTime ?? video.currentTime)
      draw()
      opts.onProgress?.(Math.min(0.99, video.currentTime / duration))
      if (hasFrameCallback) {
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, frame: { mediaTime: number }) => void) => void }).requestVideoFrameCallback(scheduleDraw)
      } else {
        window.requestAnimationFrame(() => scheduleDraw())
      }
    }

    const finish = () => {
      if (stopped) return
      stopped = true
      const r = recorder as MediaRecorder | null
      if (!r) { resolveDone(); return }
      // A context a call or an alarm interrupted mid-run leaves its track silent, and WebKit's stop() then waits on it (the
      // suspend() hang, measured): one resume first — review, 2026-10-17. The stop timer below still ends a hang.
      if (audioContext && (audioContext.state as string) !== 'running') void audioContext.resume().catch(() => undefined)
      if (r.state !== 'inactive') {
        r.stop()
        // A recorder whose stop never lands must not strand the step on "Making it smaller…" — a reported failure is better.
        // Generous (review, 2026-10-17): stop() flushes at most a second of data (timeslice 1 s) and finishes the file, and an
        // old phone finishing an MP4 must not be failed for being slow — this only ends a hang.
        stopTimer = window.setTimeout(() => rejectDone(new VideoCompressError('record_failed')), 15_000)
      }
    }
    video.onended = finish
    // Watchdog: a stalled decode must never strand the wizard mid-"compressing". A quarter of the clip's length on top of the
    // 30 s (plan review, 2026-10-18): over a teacher's five-minute intro video a phone's stalls add up, and a fixed 30 s would
    // end a slow but healthy run — the truncation check below still refuses a run that did not reach the end.
    const watchdog = window.setTimeout(finish, (duration * 1.25 + 30) * 1000)

    /**
     * ⛔ A PAGE LEFT MID-RUN IS NOT A RESULT (harness, 2026-10-17): hidden, Chromium presents no frame while the muted element
     * plays on — a run hidden throughout came back as 2 frames, 0.04 s and no sound, and passed every other check; a few
     * hidden seconds froze the picture and moved the sound off it. Stopped at once, 'interrupted' — and the screen is held
     * awake meanwhile (best effort) so a phone's auto-lock is not what leaves it.
     */
    let interrupted = false
    onPageHidden = () => {
      // Hidden once the run is already stopping (the clip ended, the recorder finishing its file): the recording is whole.
      if (document.visibilityState !== 'hidden' || stopped) return
      interrupted = true
      finish()
    }
    document.addEventListener('visibilitychange', onPageHidden)
    if (document.visibilityState === 'hidden') {
      // Left while the sound was being read: the recorder (started before play() on the decoded and silent paths) stops too.
      window.clearTimeout(watchdog)
      const r = recorder as MediaRecorder | null
      try { if (r && r.state !== 'inactive') r.stop() } catch { /* already stopped */ }
      throw new VideoCompressError('interrupted')
    }
    const wake = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    void wake?.request('screen').then((lock) => { if (finished) void lock.release().catch(() => undefined); else wakeLock = lock }, () => undefined)

    draw()
    try {
      await video.play()
    } catch {
      window.clearTimeout(watchdog)
      // Started before play() on the decoded and silent paths: stopped, not left recording a frozen frame.
      const r = recorder as MediaRecorder | null
      try { if (r && r.state !== 'inactive') r.stop() } catch { /* already stopped */ }
      throw new VideoCompressError('decode_failed')
    }
    if (recordAfterPlay) {
      // Back to the start if play() took its time, so the recording misses nothing (the captured track is the same live one
      // after a seek — measured in Chromium).
      if (video.currentTime > 0.15) {
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(resolve, 2_000)
          video.onseeked = () => { window.clearTimeout(t); resolve() }
          video.currentTime = 0
        })
        video.onseeked = null
      }
      if (stopped) { window.clearTimeout(watchdog); throw new VideoCompressError(interrupted ? 'interrupted' : 'timeout') }
      record()
    }
    scheduleDraw()
    try {
      await done
    } catch (e) {
      // A recorder that failed with no picture ever seen failed for want of one: say so, not "try a shorter clip".
      if (interrupted) throw new VideoCompressError('interrupted')
      if (noPicture()) throw new VideoCompressError('no_picture')
      throw e
    } finally {
      // Both timers, whichever way `done` settled (gate review): a watchdog left behind would finish() a cleaned-up run.
      window.clearTimeout(stopTimer)
      window.clearTimeout(watchdog)
    }
    if (interrupted) throw new VideoCompressError('interrupted')
    if (noPicture()) throw new VideoCompressError('no_picture')

    // A watchdog-stopped run produced a truncated clip — treat as failure, not a result.
    if (video.currentTime < duration - 2) throw new VideoCompressError('timeout')

    const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
    if (!blob.size) throw new VideoCompressError('record_failed')
    const readBlob: ReadBytes = async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer())
    if ((await declaresVideoTrack(readBlob, blob.size)) === false) throw new VideoCompressError('no_picture')
    // ⛔ THE RECORDING MUST HOLD THE CLIP (2026-10-18): a recorder that stopped writing partway finished a valid, shorter file
    // that passed everything above — see recordedSeconds and recordingCutShort. Refused, never uploaded short.
    const recorded = await recordedSeconds(readBlob, blob.size)
    if (recorded !== null) {
      const readSource: ReadBytes = async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer())
      const picture = await recordedSeconds(readSource, file.size).catch(() => null)
      if (recordingCutShort(recorded, picture, duration)) throw new VideoCompressError('truncated')
    }
    if (blob.size > opts.targetBytes) throw new VideoCompressError('still_too_large')
    opts.onProgress?.(1)
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'video'
    return new File([blob], `${baseName}-compressed.${container}`, { type: mimeType.split(';')[0] })
  } finally {
    cleanup()
  }
}
