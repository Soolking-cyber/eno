/**
 * The browser's sniff (image-sniff.ts) is a twin of the server's (core/media.ts `sniffImageType`), because the server one
 * is `server-only` and reads a Node Buffer. The client decides from it whether a photo's own bytes may be sent; the upload
 * routes decide from theirs whether to take them. Any disagreement is a photo the client sends and the server refuses (or
 * one re-encoded for nothing), so this runs both over the same buffers.
 */
import { describe, expect, it } from 'vitest'
import sharpLib from 'sharp'
import { sniffImageType } from './core/media'
import { sniffImageBytes, sniffImageFile } from './image-sniff'

const photo = () => sharpLib({ create: { width: 24, height: 16, channels: 3, background: { r: 200, g: 120, b: 40 } } })

async function fixtures(): Promise<Record<string, Buffer>> {
  return {
    jpeg: await photo().jpeg().toBuffer(),
    png: await photo().png().toBuffer(),
    webp: await photo().webp().toBuffer(),
    webpLossless: await photo().webp({ lossless: true }).toBuffer(),
    gif: await photo().gif().toBuffer(),
    tiff: await photo().tiff().toBuffer(),
    avif: await photo().avif().toBuffer(),
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"/>'),
    heic: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]),
    bmp: Buffer.concat([Buffer.from('BM'), Buffer.alloc(30)]),
    empty: Buffer.alloc(0),
    jpegShort: Buffer.from([0xff, 0xd8]),
    pngPrefix: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    riffWave: Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'),
    riffWebTruncated: Buffer.from('RIFF\0\0\0\0WEB', 'latin1'),
    riffWebpOnly12: Buffer.from('RIFF\xff\xff\xff\xffWEBP', 'latin1'),
  }
}

describe('sniffImageBytes (client) agrees with sniffImageType (server)', () => {
  it('on real JPEG, PNG and WebP, on the formats the server refuses, and on short or near-miss headers', async () => {
    const all = await fixtures()
    for (const [name, buf] of Object.entries(all)) {
      expect(sniffImageBytes(new Uint8Array(buf)), name).toBe(sniffImageType(buf))
    }
    // The three it must name, so agreement is not two functions that both say null.
    expect(sniffImageBytes(new Uint8Array(all.jpeg))).toBe('image/jpeg')
    expect(sniffImageBytes(new Uint8Array(all.png))).toBe('image/png')
    expect(sniffImageBytes(new Uint8Array(all.webpLossless))).toBe('image/webp')
  })

  it('with any one of the first 12 bytes changed, and at every length up to 12', async () => {
    const all = await fixtures()
    for (const name of ['jpeg', 'png', 'webp'] as const) {
      const head = all[name].subarray(0, 12)
      for (let i = 0; i < 12; i++) {
        for (const delta of [1, 0x20, 0x80]) {
          const b = Buffer.from(head)
          b[i] = (b[i] + delta) & 0xff
          expect(sniffImageBytes(new Uint8Array(b)), `${name} byte ${i} +${delta}`).toBe(sniffImageType(b))
        }
      }
      for (let n = 0; n <= 12; n++) {
        const b = Buffer.from(head.subarray(0, n))
        expect(sniffImageBytes(new Uint8Array(b)), `${name} first ${n}`).toBe(sniffImageType(b))
      }
    }
  })

  it('sniffImageFile reads only the head of a Blob, with the same answer', async () => {
    const all = await fixtures()
    for (const [name, buf] of Object.entries(all)) {
      expect(await sniffImageFile(new Blob([new Uint8Array(buf)])), name).toBe(sniffImageType(buf))
    }
  })
})
