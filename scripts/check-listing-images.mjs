#!/usr/bin/env node
// Read-only functional check, beyond the containers' listening-socket health check.
// Run against BOTH editions after starting local previews / an authorized deployment:
// node scripts/check-listing-images.mjs http://localhost:3000 --key=affiliate/example.webp
// Use a real, newly uploaded key to exercise cold caches. This never uploads or purges anything.
import sharp from 'sharp'

const args = process.argv.slice(2)
const key = args.find(arg => arg.startsWith('--key='))?.slice(6)
const bases = args.filter(arg => !arg.startsWith('--'))
if (!key || !bases.length || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpg|jpeg|png|avif|gif)$/i.test(key)) {
  console.error('Usage: node scripts/check-listing-images.mjs <base-url> [base-url] --key=<canonical raster object key>')
  process.exit(1)
}
for (const base of bases) {
  for (const width of [64, 420]) {
    for (const format of ['image/avif', 'image/webp']) {
      const url = new URL('/_next/image', base)
      url.searchParams.set('url', `/listing-images?key=${key}`)
      url.searchParams.set('w', String(width))
      url.searchParams.set('q', '60')
      try {
        const started = Date.now()
        const response = await fetch(url, { headers: { accept: format }, signal: AbortSignal.timeout(15000) })
        if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== format) {
          throw new Error(`HTTP ${response.status}, type ${response.headers.get('content-type')}`)
        }
        const bytes = Buffer.from(await response.arrayBuffer())
        const metadata = await sharp(bytes).metadata()
        await sharp(bytes).raw().toBuffer() // Metadata alone does not prove the whole image decodes.
        if (!metadata.width || metadata.width > width) throw new Error(`Unexpected width ${metadata.width}`)
        console.log(`PASS ${base} ${width}px ${format} ${bytes.length}B ${Date.now() - started}ms cache=${response.headers.get('x-nextjs-cache') ?? response.headers.get('cf-cache-status') ?? '-'}`)
      } catch (error) {
        console.error(`FAIL ${base} ${width}px ${format}: ${error.message}`)
        process.exitCode = 1
      }
    }
  }
}
