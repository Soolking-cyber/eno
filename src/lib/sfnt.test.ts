import { readFileSync } from 'node:fs'
import { brotliCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fontMetrics, woff2ToSfnt } from './sfnt'

/**
 * The share cards' font plumbing (sfnt.ts): the app's Open Runde WOFF2 files rebuilt as the OpenType files the renderer
 * reads, and the advance widths the titles are laid out with. Checked against the real shipped fonts — structure,
 * checksums, the WOFF2 header's own size — and, for the widths, against values read with fontTools (2026-10-21).
 */
const FONTS = ['src/fonts/open-runde-bold.woff2', 'src/fonts/open-runde-regular.woff2']
const sum32 = (buf: Buffer, start: number, length: number) => {
  let s = 0
  for (let i = start; i < start + ((length + 3) & ~3); i += 4) s = (s + buf.readUInt32BE(i)) >>> 0
  return s
}

describe('woff2ToSfnt — the shipped fonts', () => {
  it.each(FONTS)('%s: a well-formed OpenType (CFF) file, every checksum right, exactly the size the WOFF2 header announces', (file) => {
    const woff2 = readFileSync(file)
    const sfnt = woff2ToSfnt(woff2)
    expect(sfnt.toString('latin1', 0, 4)).toBe('OTTO')
    // totalSfntSize: header, directory, tables and their padding.
    expect(sfnt.length).toBe(woff2.readUInt32BE(16))
    const n = sfnt.readUInt16BE(4)
    const records = Array.from({ length: n }, (_, i) => {
      const r = 12 + 16 * i
      return { tag: sfnt.toString('latin1', r, r + 4), sum: sfnt.readUInt32BE(r + 4), offset: sfnt.readUInt32BE(r + 8), length: sfnt.readUInt32BE(r + 12) }
    })
    expect(records.map((r) => r.tag)).toEqual(['CFF ', 'GDEF', 'GPOS', 'GSUB', 'OS/2', 'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post'])
    // searchRange / entrySelector / rangeShift for 12 tables.
    expect([sfnt.readUInt16BE(6), sfnt.readUInt16BE(8), sfnt.readUInt16BE(10)]).toEqual([128, 3, 64])
    let end = 12 + 16 * n
    for (const r of records) {
      expect(r.offset % 4, r.tag).toBe(0)
      expect(r.offset, r.tag).toBeGreaterThanOrEqual(end)
      end = r.offset + r.length
      // head's own checksum is taken with checkSumAdjustment as zero (OpenType `head`).
      const table = Buffer.from(sfnt.subarray(r.offset, r.offset + ((r.length + 3) & ~3)))
      if (r.tag === 'head') table.writeUInt32BE(0, 8)
      expect(sum32(table, 0, r.length), r.tag).toBe(r.sum)
    }
    expect(end).toBeLessThanOrEqual(sfnt.length)
    // checkSumAdjustment makes the whole file sum to the magic number.
    expect(sum32(sfnt, 0, sfnt.length)).toBe(0xb1b0afba)
  })
})

describe('woff2ToSfnt — what it refuses', () => {
  /** A WOFF2 header for `tables` directory bytes and a compressed stream. */
  const woff2 = (directory: number[], stream: Buffer, flavor = 0x4f54544f, numTables = 1) => {
    const header = Buffer.alloc(48)
    header.write('wOF2', 0, 'latin1')
    header.writeUInt32BE(flavor, 4)
    header.writeUInt16BE(numTables, 12)
    header.writeUInt32BE(stream.length, 20)
    return Buffer.concat([header, Buffer.from(directory), stream])
  }

  it('a file that is not WOFF2 — the OpenType it produced, say', () => {
    expect(() => woff2ToSfnt(woff2ToSfnt(readFileSync(FONTS[0])))).toThrow(/not a WOFF2 file/)
  })

  it('a font collection', () => {
    expect(() => woff2ToSfnt(woff2([], Buffer.alloc(0), 0x74746366, 0))).toThrow(/collection/)
  })

  it('a transformed glyf table (a TrueType WOFF2) — never a wrong rebuild', () => {
    // flags 10 = known tag 10 (glyf), transform version 0: for glyf that is the transformed form.
    expect(() => woff2ToSfnt(woff2([10, 4], brotliCompressSync(Buffer.alloc(4))))).toThrow(/"glyf" is stored transformed/)
    // …and a transformed hmtx (version 1).
    expect(() => woff2ToSfnt(woff2([3 | (1 << 6), 4], brotliCompressSync(Buffer.alloc(4))))).toThrow(/"hmtx" is stored transformed/)
  })

  it('a stream shorter than its directory, and a file cut short', () => {
    // One untransformed `head` (tag 1) of 8 bytes, but only 4 in the stream.
    expect(() => woff2ToSfnt(woff2([1, 8], brotliCompressSync(Buffer.alloc(4))))).toThrow(/the stream holds 4 bytes, the directory 8/)
    const whole = woff2([1, 8], brotliCompressSync(Buffer.alloc(8)))
    expect(() => woff2ToSfnt(whole.subarray(0, whole.length - 2))).toThrow(/runs past the end/)
  })
})

describe('fontMetrics — advance widths from the face itself', () => {
  const bold = fontMetrics(woff2ToSfnt(readFileSync(FONTS[0])))

  it('reads the em and the widths fontTools reads (Open Runde Bold, 2026-10-21)', () => {
    expect(bold.unitsPerEm).toBe(2816)
    expect(['A', 'a', ' ', ' ', '—', '’', 'ế'].map(bold.advance)).toEqual([2106, 1634, 653, 653, 2816, 642, 1683])
  })

  it('answers undefined for a character the face lacks — the tofu the cards must never print', () => {
    expect(['漢', '😀', '\u0000'].map(bold.advance)).toEqual([undefined, undefined, undefined])
  })
})
