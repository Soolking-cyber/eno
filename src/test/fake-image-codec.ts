/**
 * The browser's image decoder and canvas encoder, stood in for jsdom tests of the client photo pipeline
 * (normalize-image.ts, square-crop.ts): jsdom has no `createImageBitmap` and its canvas encodes nothing.
 * Real bytes in and out, through sharp:
 *   - `createImageBitmap` reads the file and refuses what a browser cannot decode (`undecodable`, Chrome's set by default:
 *     TIFF, HEIC, SVG), or anything sharp cannot read either;
 *   - `canvas.toBlob` encodes a noise picture of the canvas size, WebP or JPEG at the pipeline's q82, so a re-encode is
 *     LARGER than a small AVIF or a low-quality JPEG of the same size: the branch where the original used to be kept.
 *     `webp: false` is iOS Safari, whose canvas answers a WebP request with a PNG.
 * Call it in each test (the spies and stubs are reset by `restoreFakeImageCodec`).
 */
import sharp from 'sharp'
import { vi } from 'vitest'

export const noise = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })

const bytesOf = async (blob: Blob) => Buffer.from(await blob.arrayBuffer())

/** What a browser would call this file's format: sharp's 'heif' split into AVIF and HEIC. */
async function kindOf(buf: Buffer): Promise<{ kind: string; width: number; height: number } | null> {
  const meta = await sharp(buf).metadata().catch(() => null)
  if (!meta?.format || !meta.width || !meta.height) return null
  const kind = meta.format === 'heif' ? (meta.compression === 'av1' ? 'avif' : 'heic') : meta.format
  return { kind, width: meta.width, height: meta.height }
}

export function installFakeImageCodec({ undecodable = ['tiff', 'heic', 'svg'], webp = true }: { undecodable?: string[]; webp?: boolean } = {}) {
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const got = await kindOf(await bytesOf(blob))
    if (!got || undecodable.includes(got.kind)) throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
    return { width: got.width, height: got.height, close() {} }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage() {}, imageSmoothingQuality: 'low' })) as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
    const pic = noise(this.width, this.height)
    const out = type === 'image/webp' && webp
      ? pic.webp({ quality: 82 }).toBuffer().then((b) => new Blob([new Uint8Array(b)], { type: 'image/webp' }))
      : type === 'image/webp'
        ? pic.png().toBuffer().then((b) => new Blob([new Uint8Array(b)], { type: 'image/png' }))
        : pic.jpeg({ quality: 82 }).toBuffer().then((b) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' }))
    void out.then(cb)
  })
}

export function restoreFakeImageCodec() {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
}

/** A File holding `buf`, named and typed as the user's picker would hand it over. */
export const fileOf = (buf: Buffer, name: string, type: string) => new File([new Uint8Array(buf)], name, { type })

/** The format the first bytes say, by signature (independent of image-sniff.ts, so a bug there cannot hide here). */
export async function headKind(blob: Blob): Promise<'jpeg' | 'png' | 'webp' | 'avif/heic' | 'tiff' | 'other'> {
  const b = await bytesOf(blob.slice(0, 12))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'avif/heic'
  if (b.toString('latin1', 0, 2) === 'II' || b.toString('latin1', 0, 2) === 'MM') return 'tiff'
  return 'other'
}

/** Stub fetch as /api/upload: every posted file is kept (in order), and each gets a URL back. */
export function capturePosts(): File[] {
  const posted: File[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const files = (init!.body as FormData).getAll('files') as File[]
    posted.push(...files)
    return { ok: true, status: 200, json: async () => ({ urls: files.map((f, i) => `https://cdn/${posted.length - files.length + i}-${f.name}`) }) }
  }))
  return posted
}
