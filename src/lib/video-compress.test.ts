// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { declaresVideoTrack, unbrandQuickTime } from './video-compress'

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
