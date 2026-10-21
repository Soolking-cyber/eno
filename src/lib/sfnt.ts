import { brotliDecompressSync } from 'node:zlib'

/**
 * THE TWO THINGS THE SHARE CARDS NEED FROM A FONT FILE (src/app/og/teach-in-vietnam/[...card]/route.tsx): the
 * OpenType file inside a WOFF2, and how wide each character is.
 *
 * ⚠️ WHY A DECODER AT ALL. The cards are set in the app's own face, Open Runde Bold — the face the eno.vn wordmark is
 * drawn in (public/logo-dotvn.svg) — and the repo ships it only as WOFF2 (src/fonts/, for next/font). next/og's
 * renderer (satori) reads TTF, OTF and WOFF but not WOFF2, and the repo adds no font file and no dependency for this.
 * Node already has the one hard part, Brotli (WOFF2 is one Brotli stream holding every table), so this rebuilds the
 * sfnt around the decompressed tables: header, sorted table directory, 4-byte padding, checksums.
 * ⛔ UNTRANSFORMED TABLES ONLY, AND IT THROWS ON ANY OTHER. A TrueType-flavoured WOFF2 normally stores `glyf`/`loca`
 * (and maybe `hmtx`) in a transformed form that needs a real reconstruction step; Open Runde is CFF-flavoured (`OTTO`),
 * where every table is stored as is. A font swapped for one this cannot read fails `next build` loudly — the route
 * renders every card there — instead of shipping cards in a fallback face.
 * Checked against fontTools' own WOFF2 reader on both shipped weights (2026-10-21): every table byte-identical, table
 * checksums and head.checkSumAdjustment valid; sfnt.test.ts pins the structure.
 */

/** The 63 table tags a WOFF2 directory names by index (W3C WOFF2 §5.1, "Known Table Tags"); 63 means "tag follows". */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const

const pad4 = (n: number) => (n + 3) & ~3

/** The OpenType table checksum: the uint32 sum of the table, zero-padded to 4 bytes (the buffer is zero-filled). */
function checksum(buf: Buffer, start: number, length: number): number {
  let sum = 0
  for (let i = start; i < start + pad4(length); i += 4) sum = (sum + buf.readUInt32BE(i)) >>> 0
  return sum
}

/** WOFF2 → the OpenType (sfnt) file it wraps. Throws on anything it cannot rebuild exactly (see the header). */
export function woff2ToSfnt(woff2: Uint8Array): Buffer {
  const src = Buffer.from(woff2.buffer, woff2.byteOffset, woff2.byteLength)
  if (src.length < 48 || src.toString('latin1', 0, 4) !== 'wOF2') throw new Error('woff2: not a WOFF2 file')
  const flavor = src.readUInt32BE(4)
  if (flavor === 0x74746366) throw new Error('woff2: a font collection (ttcf) is not supported')
  const numTables = src.readUInt16BE(12)
  const compressedSize = src.readUInt32BE(20)
  let p = 48
  // UIntBase128 (§4.1): 7 bits a byte, high bit = more; no leading zero byte, at most 5 bytes, fits in 32 bits.
  const base128 = (): number => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = src[p++]
      if (b === undefined || (i === 0 && b === 0x80)) throw new Error('woff2: malformed UIntBase128')
      v = v * 128 + (b & 0x7f)
      if (v > 0xffffffff) throw new Error('woff2: UIntBase128 overflows 32 bits')
      if (!(b & 0x80)) return v
    }
    throw new Error('woff2: UIntBase128 longer than 5 bytes')
  }
  const tables: { tag: string; length: number; data?: Buffer }[] = []
  for (let i = 0; i < numTables; i++) {
    const flags = src[p++]
    let tag: string
    if ((flags & 0x3f) === 63) {
      tag = src.toString('latin1', p, p + 4)
      p += 4
    } else tag = KNOWN_TAGS[flags & 0x3f]
    // Transform version, bits 6-7: for glyf/loca 3 is the NULL transform, for every other table 0 is (§5.1).
    const version = flags >> 6
    if (tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0)
      throw new Error(`woff2: table "${tag}" is stored transformed (version ${version}) — only untransformed tables can be rebuilt here`)
    tables.push({ tag, length: base128() })
  }
  if (p + compressedSize > src.length) throw new Error('woff2: the compressed stream runs past the end of the file')
  const stream = brotliDecompressSync(src.subarray(p, p + compressedSize))
  const total = tables.reduce((n, t) => n + t.length, 0)
  if (stream.length !== total) throw new Error(`woff2: the stream holds ${stream.length} bytes, the directory ${total}`)
  // The tables follow each other in directory order, unpadded (§5.2).
  let at = 0
  for (const t of tables) {
    t.data = stream.subarray(at, at + t.length)
    at += t.length
  }

  // The sfnt: offset table, a directory SORTED BY TAG (OpenType requires it; WOFF2 does not), then each table on a 4-byte
  // boundary. head.checkSumAdjustment is zeroed for the table's own checksum and set last, over the whole file.
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  const dirEnd = 12 + 16 * numTables
  const out = Buffer.alloc(dirEnd + tables.reduce((n, t) => n + pad4(t.length), 0))
  const log2 = Math.floor(Math.log2(numTables))
  out.writeUInt32BE(flavor, 0)
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(16 << log2, 6) // searchRange
  out.writeUInt16BE(log2, 8) // entrySelector
  out.writeUInt16BE(numTables * 16 - (16 << log2), 10) // rangeShift
  let offset = dirEnd
  let head = -1
  tables.forEach((t, i) => {
    t.data!.copy(out, offset)
    if (t.tag === 'head') {
      out.writeUInt32BE(0, offset + 8)
      head = offset
    }
    const r = 12 + 16 * i
    out.write(t.tag, r, 4, 'latin1')
    out.writeUInt32BE(checksum(out, offset, t.length), r + 4)
    out.writeUInt32BE(offset, r + 8)
    out.writeUInt32BE(t.length, r + 12)
    offset += pad4(t.length)
  })
  if (head >= 0) out.writeUInt32BE((0xb1b0afba - checksum(out, 0, out.length)) >>> 0, head + 8)
  return out
}

/** The tables of an sfnt, by tag — the slice of the file each directory record names. */
function sfntTables(sfnt: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>()
  for (let i = 0; i < sfnt.readUInt16BE(4); i++) {
    const r = 12 + 16 * i
    const offset = sfnt.readUInt32BE(r + 8)
    tables.set(sfnt.toString('latin1', r, r + 4), sfnt.subarray(offset, offset + sfnt.readUInt32BE(r + 12)))
  }
  return tables
}

export type FontMetrics = {
  unitsPerEm: number
  /** The advance width of one character in font units, or undefined when the font has no glyph for it (it would be tofu). */
  advance: (char: string) => number | undefined
}

/**
 * Each character's advance width, from the font's own tables: `cmap` (format 4, the Unicode BMP map — the only one Open
 * Runde carries) to the glyph, `hmtx`/`hhea` to its width, `head` for the em. What the cards lay their titles out with
 * (share-cards.ts `fitTitle`), and what their tests check every character of every card against — the renderer would
 * otherwise reach for a network font, or draw a box, for a character the face lacks. ⚠️ NO KERNING, AND KERNING CAN WIDEN
 * A LINE: the face has positive pairs as well as negative ones, so a width measured without them can come out a few px
 * short of the drawn one. share-cards.ts `FIT_SLACK` is what absorbs that.
 */
export function fontMetrics(sfnt: Buffer): FontMetrics {
  const t = sfntTables(sfnt)
  const head = t.get('head'), hhea = t.get('hhea'), hmtx = t.get('hmtx'), cmap = t.get('cmap')
  if (!head || !hhea || !hmtx || !cmap) throw new Error('sfnt: head, hhea, hmtx and cmap are all required')
  const unitsPerEm = head.readUInt16BE(18)
  const longMetrics = hhea.readUInt16BE(34)

  // The Windows Unicode BMP subtable (3,1), else the Unicode one (0,3) — format 4 either way.
  const subtable = (platform: number, encoding: number): Buffer | undefined => {
    for (let i = 0; i < cmap.readUInt16BE(2); i++) {
      const r = 4 + 8 * i
      if (cmap.readUInt16BE(r) !== platform || cmap.readUInt16BE(r + 2) !== encoding) continue
      const s = cmap.subarray(cmap.readUInt32BE(r + 4))
      if (s.readUInt16BE(0) === 4) return s
    }
  }
  const sub = subtable(3, 1) ?? subtable(0, 3)
  if (!sub) throw new Error('sfnt: no format-4 Unicode cmap')
  const segs = sub.readUInt16BE(6) / 2
  const ends = 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, ranges = deltas + 2 * segs
  const glyph = (code: number): number => {
    for (let s = 0; s < segs; s++) {
      if (code > sub.readUInt16BE(ends + 2 * s)) continue
      const start = sub.readUInt16BE(starts + 2 * s)
      if (code < start) return 0
      const delta = sub.readUInt16BE(deltas + 2 * s)
      const range = sub.readUInt16BE(ranges + 2 * s)
      if (range === 0) return (code + delta) & 0xffff
      const g = sub.readUInt16BE(ranges + 2 * s + range + 2 * (code - start))
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
  return {
    unitsPerEm,
    advance: (char) => {
      const code = char.codePointAt(0)
      const g = code === undefined || code > 0xffff ? 0 : glyph(code)
      return g === 0 ? undefined : hmtx.readUInt16BE(4 * Math.min(g, longMetrics - 1))
    },
  }
}
