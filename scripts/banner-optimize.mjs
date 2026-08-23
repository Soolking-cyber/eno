#!/usr/bin/env node
/**
 * Turn a supplied banner pair into the four files a promo slide needs.
 *
 * Usage: node scripts/banner-optimize.mjs <desktop-src> <mobile-src> <name>
 *   e.g. node scripts/banner-optimize.mjs ~/Downloads/evisa-wide.png ~/Downloads/evisa-small.png evisa
 *
 * ⚠️ THE TREATMENT MIRRORS THE GMBR BANNER EXACTLY, and that file's comment records why each number
 * was chosen rather than guessed:
 *   · MOBILE IS RESAMPLED TO 732x376 (2x). Both slides sit in one carousel, so a 1x mobile export
 *     is soft on every retina phone AND a different intrinsic size from its neighbour. lanczos3
 *     plus a MILD unsharp mask (sigma 0.6, m1 0.8): compared at 2.6x zoom, mild is crisp and a
 *     stronger sharpen haloes the logo edge. Upscaling invents no detail — a genuine 2x export from
 *     the designer still beats this, and swapping the file needs no code change.
 *   · DESKTOP STAYS NATIVE 1280x300. A 2x desktop would triple the weight of the home page's LCP
 *     image, which is the one image on the site that must not get heavier.
 *   · webp q84 + AVIF q45 AT effort 9, both emitted. The slide lists avif first and webp as the
 *     fallback. ⚠️ THE AVIF SETTINGS CHANGED ON 2026-08-23 (they were q50 at sharp's default
 *     effort 4) BECAUSE THE MOBILE AVIF IS THE BIGGEST SINGLE CACHE OFFENDER ON THE HOME PAGE:
 *     PageSpeed's Cache insight, measured on production that day (headless chromium, mobile
 *     emulation, 4x CPU), charged 15,111 wasted bytes to gmbr-mobile.avif and 12,518 to
 *     vietkite-mobile.avif. Re-encoding vietkite-mobile at q45/effort 9 measured 18,018 -> 15,436 B,
 *     -14.3%, at PSNR 35.34 -> 34.52 dB. Effort 9 is encode-time only — it costs seconds in this
 *     script and nothing at all to a visitor.
 *   · ⛔ DO NOT ADD `chromaSubsampling: '4:2:0'`. It was measured on the same artwork and cost
 *     -1.30 dB, because these banners have the partner's TEXT baked in and 4:2:0 halves the chroma
 *     resolution exactly where a coloured letterform needs it. AVIF defaults to 4:4:4 in sharp;
 *     leave it there.
 *
 * ⚠️ THIS SCRIPT NEEDS THE ORIGINAL SOURCE EXPORTS, so it is NOT a "regenerate what is in
 * public/banners" command — re-running it against the shipped .webp/.avif would stack a second
 * lossy generation on top of the first. The four files in public/banners predate the q45 change and
 * were deliberately left alone for that reason; they pick the new settings up the next time a
 * partner supplies artwork.
 *
 * ⛔ AND WHEN THEY DO: BUMP THE `?v=` STAMP IN src/lib/promo-slides.ts IN THE SAME COMMIT. Those
 * urls now earn `max-age=31536000, immutable` from next.config.ts, which is safe only because the
 * stamp changes with the bytes. This script prints the new stamps for exactly that paste.
 */
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [desktopSrc, mobileSrc, name] = process.argv.slice(2)
if (!desktopSrc || !mobileSrc || !name) {
  console.error('usage: node scripts/banner-optimize.mjs <desktop-src> <mobile-src> <name>')
  process.exit(1)
}
const out = (f) => resolve('public/banners', f)
const SHARPEN = { sigma: 0.6, m1: 0.8 }

/**
 * The url stamp for a written file: the first 8 hex of its sha256, printed beside each output so it
 * can be pasted straight into `art` in src/lib/promo-slides.ts.
 *
 * ⚠️ IT IS PRINTED, NOT WRITTEN BACK. promo-slides.ts is hand-maintained prose-heavy data (alt text,
 * disclosure, edition rules) and a script that rewrites it would be a rewrite hazard out of all
 * proportion to eight hex characters. Identical to `shasum -a 256 <file> | cut -c1-8`, which is the
 * command the comment in promo-slides.ts names — keep the two in agreement.
 */
const stamp = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8)

async function emit(src, target, w, h, upscale) {
  const pipe = sharp(src).resize(w, h, { fit: 'cover', kernel: 'lanczos3' })
  if (upscale) pipe.sharpen(SHARPEN)
  const buf = await pipe.toBuffer()
  const webp = out(`${target}.webp`)
  const avif = out(`${target}.avif`)
  await sharp(buf).webp({ quality: 84 }).toFile(webp)
  // q45 + effort 9: measured 2026-08-23 on vietkite-mobile, 18,018 -> 15,436 B (-14.3%) at
  // PSNR 35.34 -> 34.52 dB. See the header for why 4:2:0 is NOT also applied.
  await sharp(buf).avif({ quality: 45, effort: 9 }).toFile(avif)
  const [a, b] = await Promise.all([sharp(webp).metadata(), sharp(avif).metadata()])
  console.log(`  ${target}.webp ${a.width}x${a.height} ${a.size ?? '?'}B  ?v=${stamp(webp)}`)
  console.log(`  ${target}.avif ${b.width}x${b.height} ${b.size ?? '?'}B  ?v=${stamp(avif)}`)
}

const d = await sharp(desktopSrc).metadata()
const m = await sharp(mobileSrc).metadata()
console.log(`source desktop ${d.width}x${d.height} · mobile ${m.width}x${m.height}`)
// Upscale-sharpen the mobile only when the source really is below 2x, so a genuine 732x376 export
// is passed through untouched instead of being sharpened twice.
await emit(desktopSrc, `${name}-desktop`, 1280, 300, false)
await emit(mobileSrc, `${name}-mobile`, 732, 376, (m.width ?? 0) < 732)
console.log('done — 4 files in public/banners/')
console.log('⚠️ paste each ?v= above into the matching url in src/lib/promo-slides.ts — an unbumped')
console.log('   stamp leaves the OLD artwork cached in browsers for a year (next.config.ts).')
