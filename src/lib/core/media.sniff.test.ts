/**
 * appsec-05 / R37: the upload routes take JPEG, PNG and WebP BYTES only, sniffed before any sharp call.
 *
 * sharp picks its decoder from the bytes, not from the declared type, and the prebuilt build decodes SVG, GIF, TIFF and
 * AVIF from a buffer. So a guest's file labelled image/png reached librsvg, libtiff and libheif. These pin the sniff, the
 * fact that each refused format really would have decoded (the reason for it), and the libvips behaviour the sniff leans on:
 * a buffer that opens with an allowed signature goes to that signature's own loader (checked by name), whatever follows.
 */
import { describe, expect, it } from 'vitest'
import sharpLib from 'sharp'
import { sniffImageType } from './media'

const photo = (width = 48, height = 32) =>
  sharpLib({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="red"/></svg>')
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP_SIG = Buffer.from('RIFF\x20\x20\x20\x20WEBP', 'latin1')

describe('sniffImageType', () => {
  it('names JPEG, PNG and WebP (lossy and lossless) from the bytes', async () => {
    expect(sniffImageType(await photo().jpeg().toBuffer())).toBe('image/jpeg')
    expect(sniffImageType(await photo().png().toBuffer())).toBe('image/png')
    expect(sniffImageType(await photo().webp().toBuffer())).toBe('image/webp')
    expect(sniffImageType(await photo().webp({ lossless: true }).toBuffer())).toBe('image/webp')
  })

  it('refuses SVG, GIF, TIFF and AVIF, each of which sharp decodes today', async () => {
    const others: Record<string, Buffer> = {
      svg: SVG,
      gif: await photo().gif().toBuffer(),
      tiff: await photo().tiff().toBuffer(),
      avif: await photo().avif().toBuffer(),
    }
    for (const [name, buf] of Object.entries(others)) {
      // storeListingImage's pass 1 would take it: this is the reach the sniff removes.
      const { info } = await sharpLib(buf, { limitInputPixels: 50_000_000 }).rotate().png().toBuffer({ resolveWithObject: true })
      expect(info.width, name).toBe(48)
      expect(sniffImageType(buf), name).toBeNull()
    }
  })

  it('refuses a HEIC header, an empty or short buffer, and a RIFF that is not WebP', () => {
    expect(sniffImageType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]))).toBeNull()
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(sniffImageType(PNG_SIG.subarray(0, 4))).toBeNull() // PNG needs all eight bytes
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'))).toBeNull()
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEB', 'latin1'))).toBeNull()
  })

  it('SVG hidden behind an allowed signature goes to that signature’s own loader, never to librsvg', async () => {
    // A rejection alone proves nothing here: librsvg refuses these bytes too, because an XML document cannot start with
    // them. So each case pins WHICH loader took the buffer, by that loader's own error text or by what it decoded.
    // ⚠️ If this goes red after a sharp upgrade, measure the routing again before touching a regex: the sniff is enough on
    // its own only while a buffer that passes it never reaches the SVG loader.
    const LIBRSVG_REFUSAL = /XML parse error/
    const refusal = (buf: Buffer) => sharpLib(buf).png().toBuffer().then(() => '(decoded)', (e: Error) => e.message)

    // Control: the SVG loader's own words when it gets SVG text it cannot parse (no other loader claims these bytes).
    expect(await refusal(Buffer.concat([Buffer.from('RIFX    WEBP'), SVG]))).toMatch(LIBRSVG_REFUSAL)

    // Signature + SVG: refused by the signature's own loader, which names itself. libpng's refusal has no text at all
    // ("Input buffer has corrupt header:"), so PNG is pinned by the whole-photo case below.
    const named: [Buffer, RegExp | null][] = [[JPEG_SIG, /VipsJpeg/], [WEBP_SIG, /webp: unable to parse image/], [PNG_SIG, null]]
    for (const [sig, loader] of named) {
      const polyglot = Buffer.concat([sig, SVG])
      expect(sniffImageType(polyglot)).not.toBeNull()
      const message = await refusal(polyglot)
      expect(message).not.toBe('(decoded)')
      expect(message).not.toMatch(LIBRSVG_REFUSAL)
      if (loader) expect(message).toMatch(loader)
    }

    // A whole photo with the SVG appended decodes as that photo, through its own loader (40x24, not the SVG's 48x32).
    for (const fmt of ['jpeg', 'png', 'webp'] as const) {
      const polyglot = Buffer.concat([await photo(40, 24)[fmt]().toBuffer(), SVG])
      expect(sniffImageType(polyglot), fmt).toBe(`image/${fmt}`)
      const meta = await sharpLib(polyglot).metadata()
      expect([meta.format, meta.width, meta.height], fmt).toEqual([fmt, 40, 24])
    }
  })
})
