// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { declaresVideoTrack, recordedSeconds, recordingCutShort, unbrandQuickTime } from './video-compress'

// The two byte-level checks the browser compressor leans on (2026-10-17): WebKit decodes an iPhone .mov's sound only once
// its QuickTime brand reads mp42, and a recording whose header names no picture track is never uploaded as a video.
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ftyp = (major: string, minor: string, compat: string[]) => {
  const body = [...ascii(major), ...ascii(minor), ...compat.flatMap(ascii)]
  return [...u32(8 + body.length), ...ascii('ftyp'), ...body]
}
const text = (b: Uint8Array) => String.fromCharCode(...b)
/** A box: size, type, payload. */
const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload]
/** An MP4 'hdlr' (full box: version/flags, pre_defined, then the handler type). */
const hdlr = (kind: string) => box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...ascii(kind), ...new Array(12).fill(0), 0])
const pad = (n: number) => new Array(n).fill(0)

describe('unbrandQuickTime', () => {
  it("rewrites every 'qt  ' brand of a leading ftyp to mp42 — the major and the compatible ones", () => {
    const b = new Uint8Array([...ftyp('qt  ', '\0\0\0\0', ['qt  ', 'isom']), ...box('moov', pad(8))])
    expect(unbrandQuickTime(b.buffer)).toBe(true)
    expect(text(b.slice(8, 12))).toBe('mp42')
    expect(text(b.slice(16, 20))).toBe('mp42')
    expect(text(b.slice(20, 24))).toBe('isom')
  })
  it('never touches minor_version, a byte past the ftyp box, or a file that is not ftyp-first', () => {
    const b = new Uint8Array([...ftyp('qt  ', 'qt  ', ['qt  ']), ...box('qt  ', pad(4))])
    unbrandQuickTime(b.buffer)
    expect(text(b.slice(12, 16))).toBe('qt  ') // minor_version
    expect(text(b.slice(24, 28))).toBe('qt  ') // the next box's type, past ftyp's end
    const mdatFirst = new Uint8Array([...box('mdat', ascii('qt  qt  ')), ...ftyp('qt  ', '\0\0\0\0', [])])
    const before = text(mdatFirst)
    unbrandQuickTime(mdatFirst.buffer)
    expect(text(mdatFirst)).toBe(before)
  })
  it('a 64-bit-size ftyp (size 1) is read too', () => {
    const body = [...ascii('qt  '), 0, 0, 0, 0, ...ascii('qt  ')]
    const b = new Uint8Array([...u32(1), ...ascii('ftyp'), ...u32(0), ...u32(16 + body.length), ...body])
    unbrandQuickTime(b.buffer)
    expect(text(b.slice(16, 20))).toBe('mp42')
    expect(text(b.slice(24, 28))).toBe('mp42')
  })
  it('leaves an MP4 as it is', () => {
    const b = new Uint8Array(ftyp('isom', '\0\0\x02\0', ['isom', 'iso2', 'mp41']))
    const before = text(b)
    expect(unbrandQuickTime(b.buffer)).toBe(false)
    expect(text(b)).toBe(before)
  })
})

describe('declaresVideoTrack — read from the structure, never a byte pattern', () => {
  const read = (b: Uint8Array) => async (start: number, end: number) => b.slice(start, end)
  const check = (bytes: number[]) => declaresVideoTrack(read(new Uint8Array(bytes)), bytes.length)
  const trak = (kind: string) => box('trak', box('mdia', hdlr(kind)))
  const head = ftyp('isom', '\0\0\0\0', ['isom'])
  it('an MP4 whose moov names a video handler declares a picture; one with sound only does not', async () => {
    expect(await check([...head, ...box('moov', [...trak('soun'), ...trak('vide')])])).toBe(true)
    expect(await check([...head, ...box('moov', trak('soun'))])).toBe(false)
  })
  it('the moov is found wherever it is — past a large mdat, which is stepped over by its size', async () => {
    const mdat = box('mdat', pad(200_000))
    expect(await check([...head, ...mdat, ...box('moov', trak('vide'))])).toBe(true)
    expect(await check([...head, ...mdat, ...box('moov', trak('soun'))])).toBe(false)
  })
  it('bytes inside an mdat that look like a header count for nothing', async () => {
    const fake = box('mdat', [...ascii('moov'), ...hdlr('vide'), ...pad(32)])
    expect(await check([...head, ...fake, ...box('moov', trak('soun'))])).toBe(false)
  })
  it('a trak whose handler cannot be read leaves the answer unknown — unless another trak names a picture', async () => {
    const broken = box('trak', [...u32(99), ...ascii('mdia')])
    expect(await check([...head, ...box('moov', [...trak('soun'), ...broken])])).toBeNull()
    expect(await check([...head, ...box('moov', [...broken, ...trak('vide')])])).toBe(true)
  })
  it('a structure it cannot read is not judged (null): malformed, no moov, another container', async () => {
    expect(await check([...head, ...u32(9_999_999), ...ascii('mdat')])).toBeNull()
    expect(await check([...head, ...box('mdat', pad(64))])).toBeNull()
    expect(await check([...ascii('RIFF'), ...pad(60)])).toBeNull()
  })
  // WebM: EBML header, a Segment of unknown size (as recorders write it), Tracks, then Clusters.
  const el = (id: number[], payload: number[]) => [...id, 0x80 | payload.length, ...payload]
  const ebmlHead = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01])
  const segment = (...children: number[][]) => [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...children.flat()]
  const entry = (type: number, codec: string) => el([0xae], [...el([0x83], [type]), ...el([0x86], ascii(codec))])
  const tracks = (...entries: number[][]) => el([0x16, 0x54, 0xae, 0x6b], entries.flat())
  const cluster = (payload: number[]) => el([0x1f, 0x43, 0xb6, 0x75], payload)
  it('a WebM whose Tracks hold a video entry declares a picture; one with sound only does not', async () => {
    expect(await check([...ebmlHead, ...segment(tracks(entry(2, 'A_OPUS'), entry(1, 'V_VP8')))])).toBe(true)
    expect(await check([...ebmlHead, ...segment(tracks(entry(2, 'A_OPUS')))])).toBe(false)
  })
  it('a WebM: "V_" bytes in a Cluster count for nothing; a Cluster before any Tracks is not judged', async () => {
    expect(await check([...ebmlHead, ...segment(tracks(entry(2, 'A_OPUS')), cluster([0x86, 0x85, ...ascii('V_VP8')]))])).toBe(false)
    expect(await check([...ebmlHead, ...segment(cluster(pad(8)), tracks(entry(1, 'V_VP8')))])).toBeNull()
  })
})

describe('recordedSeconds — how much picture a recording holds, from its MP4 structure', () => {
  // ⛔ WebKit 26.5 finished 150 s and 300 s recordings as valid 78 s files (2026-10-18); Safari 26.0–26.1 lost recordings'
  // ends (WebKit bug 299164). The compressor refuses a recording shorter than its clip — this is how it knows.
  const read = (b: Uint8Array) => async (start: number, end: number) => b.slice(start, end)
  const seconds = (bytes: number[]) => recordedSeconds(read(new Uint8Array(bytes)), bytes.length)
  const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n % 2 ** 32)]
  const full = (version: number, flags = 0) => [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]
  const tkhd = (id: number) => box('tkhd', [...full(0), ...u32(0), ...u32(0), ...u32(id), ...u32(0), ...u32(0), ...pad(60)])
  const mdhd = (scale: number, duration: number, v1 = false) => box('mdhd', v1
    ? [...full(1), ...u64(0), ...u64(0), ...u32(scale), ...u64(duration), ...pad(4)]
    : [...full(0), ...u32(0), ...u32(0), ...u32(scale), ...u32(duration), ...pad(4)])
  const trak = (id: number, kind: string, scale: number, duration = 0, v1 = false) => box('trak', [...tkhd(id), ...box('mdia', [...mdhd(scale, duration, v1), ...hdlr(kind)])])
  const trex = (id: number, duration: number) => box('trex', [...full(0), ...u32(id), ...u32(1), ...u32(duration), ...u32(0), ...u32(0)])
  const tfhd = (id: number, defaultDuration?: number) => box('tfhd', [...full(0, defaultDuration === undefined ? 0 : 0x8), ...u32(id), ...(defaultDuration === undefined ? [] : u32(defaultDuration))])
  const tfdt = (base: number, v1 = false) => box('tfdt', v1 ? [...full(1), ...u64(base)] : [...full(0), ...u32(base)])
  /** A trun with per-sample durations and sizes (as WebKit and Chromium write them), or only a count (default durations). */
  const trun = (durations: number[] | { count: number }) => Array.isArray(durations)
    ? box('trun', [...full(0, 0x1 | 0x100 | 0x200), ...u32(durations.length), ...u32(0), ...durations.flatMap((d) => [...u32(d), ...u32(100)])])
    : box('trun', [...full(0, 0x1 | 0x200), ...u32(durations.count), ...u32(0), ...new Array(durations.count).fill(0).flatMap(() => u32(100))])
  const fragment = (traf: number[][]) => [...box('moof', traf.map((t) => box('traf', t)).flat()), ...box('mdat', pad(16))]
  const head = ftyp('isom', '\0\0\0\0', ['isom', 'iso6'])
  const moov = (...kids: number[][]) => box('moov', kids.flat())

  it('an unfragmented file: the picture track\'s own duration (32- and 64-bit mdhd), whatever the sound track says', async () => {
    expect(await seconds([...head, ...moov(trak(1, 'soun', 48_000, 14_400_000), trak(2, 'vide', 30_000, 9_000_000)), ...box('mdat', pad(8))])).toBe(300)
    expect(await seconds([...head, ...moov(trak(2, 'vide', 30_000, 1_800_000, true))])).toBe(60)
  })

  it('a fragmented file: the last fragment\'s decode time plus its samples — the picture track\'s, never the sound\'s', async () => {
    const video = (base: number) => [...tfhd(2), ...tfdt(base), ...trun(new Array(30).fill(20))] // 30 × 20 = 600 = 1 s at 600
    const sound = (base: number) => [...tfhd(1), ...tfdt(base), ...trun(new Array(47).fill(1024))]
    const bytes = [...head, ...moov(trak(1, 'soun', 48_000), trak(2, 'vide', 600)), ...fragment([video(0), sound(0)]), ...fragment([video(600), sound(9_999_999)]), ...fragment([video(1200)])]
    expect(await seconds(bytes)).toBe(3)
  })

  it('⛔ WebKit\'s cut recording reads as what it holds: 72 fragments of 1.08 s are 77.76 s, however long the clip was', async () => {
    const frags = Array.from({ length: 72 }, (_, i) => fragment([[...tfhd(2), ...tfdt(i * 648), ...trun(new Array(27).fill(24))]]))
    expect(await seconds([...head, ...moov(trak(1, 'soun', 48_000), trak(2, 'vide', 600)), ...frags.flat()])).toBeCloseTo(77.76, 5)
  })

  it('⚠️ a negative sample duration written unsigned (WebKit\'s last sample, ≈ 2^32) counts nothing — it would read any cut recording as complete', async () => {
    const last = [...new Array(26).fill(24), 2 ** 32 - 36]
    const frags = [fragment([[...tfhd(2), ...tfdt(0), ...trun(new Array(27).fill(24))]]), fragment([[...tfhd(2), ...tfdt(648), ...trun(last)]])]
    expect(await seconds([...head, ...moov(trak(2, 'vide', 600)), ...frags.flat()])).toBeCloseTo((648 + 26 * 24) / 600, 6)
  })

  it('default durations: tfhd\'s, else trex\'s; a fragment with no tfdt follows the one before; a 64-bit tfdt reads', async () => {
    const withTfhd = [...head, ...moov(trak(2, 'vide', 30_000)), ...fragment([[...tfhd(2, 1_000), ...tfdt(0), ...trun({ count: 30 })]]), ...fragment([[...tfhd(2, 1_000), ...trun({ count: 30 })]])]
    expect(await seconds(withTfhd)).toBe(2)
    const withTrex = [...head, ...moov(trak(2, 'vide', 30_000), box('mvex', trex(2, 500))), ...fragment([[...tfhd(2), ...tfdt(2 ** 33, true), ...trun({ count: 60 })]])]
    expect(await seconds(withTrex)).toBeCloseTo((2 ** 33 + 30_000) / 30_000, 6)
  })

  it('⛔ REAL recordings (their structure, media emptied): Chrome\'s five minutes, WebKit\'s whole minute, WebKit\'s cut at 78 s', async () => {
    // src/lib/__fixtures__/recordings: compressVideo's own output, recorded 2026-10-18 from a 300 s (and a 60 s) clip with a flash
    // and a beep — Chrome 141 (H.264 MP4, 96 fragments) and WebKit 26.5 (MP4 with the negative last sample; the 300 s run
    // stopped writing at 78 s). Every box but each mdat's payload is the recording's own.
    const real = (name: string) => {
      const b = new Uint8Array(gunzipSync(readFileSync(join(__dirname, '__fixtures__/recordings', `${name}.mp4.gz`))))
      return recordedSeconds(read(b), b.length)
    }
    expect(await real('chrome-300s')).toBeCloseTo(300.029, 3)
    expect(await real('webkit-60s')).toBeCloseTo(60.023, 3)
    expect(await real('webkit-cut-78s')).toBeCloseTo(78.975, 3)
  })

  it('null whenever it cannot be read — never a guess against the clip', async () => {
    expect(await seconds([0x1a, 0x45, 0xdf, 0xa3, ...pad(28)])).toBeNull() // WebM
    expect(await seconds([...head, ...box('mdat', pad(8))])).toBeNull() // no moov
    expect(await seconds([...head, ...moov(trak(1, 'soun', 48_000, 480_000))])).toBeNull() // no picture track
    expect(await seconds([...head, ...moov(trak(2, 'vide', 0, 100))])).toBeNull() // no timescale
    // A fragmented file with nothing of its picture track read is unread — never "0 s" (gate review).
    expect(await seconds([...head, ...moov(trak(2, 'vide', 600)), ...fragment([[...tfhd(9), ...tfdt(0), ...trun([600])]])])).toBeNull()
    expect(await seconds([...head, ...moov(trak(2, 'vide', 600)), ...fragment([[...tfhd(2), ...tfdt(0), ...trun({ count: 30 })]])])).toBeNull()
    const broken = [...head, ...moov(trak(2, 'vide', 600)), ...u32(4_000), ...ascii('moof'), ...pad(8)] // a size past the end
    expect(await seconds(broken)).toBeNull()
    // More boxes than it walks: unread, never a short reading of a file it did not finish (gate review).
    const many = [...head, ...moov(trak(2, 'vide', 600)), ...fragment([[...tfhd(2), ...tfdt(0), ...trun([600])]]), ...new Array(20_000).fill(box('free', [])).flat()]
    expect(await seconds(many)).toBeNull()
  })
})

describe('recordingCutShort — the recording against the clip it was made from', () => {
  it('⛔ WebKit\'s cut recording (78 s of a 300 s clip) is cut short; a whole one is not', () => {
    expect(recordingCutShort(78.98, 300, 300.02)).toBe(true)
    expect(recordingCutShort(300.03, 300, 300.02)).toBe(false)
    expect(recordingCutShort(297.5, 300, 300)).toBe(false) // inside the 3 s slack
  })
  it('a clip whose SOUND runs past its picture: judged by the picture, never the longer element length', () => {
    expect(recordingCutShort(30.0, 30, 35)).toBe(false) // measured in Chrome: 30 s of picture, 35 s of sound — kept
    expect(recordingCutShort(20, 30, 35)).toBe(true)
  })
  it('a TRIMMED clip whose stored picture keeps its cut-off lead-in: judged by what plays, never the longer stored track', () => {
    expect(recordingCutShort(60, 75, 60.1)).toBe(false)
  })
  it('a source whose structure cannot be read (a WebM) is judged by what plays; an unread recording is never called cut', () => {
    expect(recordingCutShort(100, null, 120)).toBe(true)
    expect(recordingCutShort(118, null, 120)).toBe(false)
    expect(recordingCutShort(null, 300, 300)).toBe(false)
  })
})
