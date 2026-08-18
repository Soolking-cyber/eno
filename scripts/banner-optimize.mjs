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
 *   · webp q84 + avif q50, both emitted. The slide lists avif first and webp as the fallback.
 */
import sharp from 'sharp'
import { resolve } from 'node:path'

const [desktopSrc, mobileSrc, name] = process.argv.slice(2)
if (!desktopSrc || !mobileSrc || !name) {
  console.error('usage: node scripts/banner-optimize.mjs <desktop-src> <mobile-src> <name>')
  process.exit(1)
}
const out = (f) => resolve('public/banners', f)
const SHARPEN = { sigma: 0.6, m1: 0.8 }

async function emit(src, target, w, h, upscale) {
  const pipe = sharp(src).resize(w, h, { fit: 'cover', kernel: 'lanczos3' })
  if (upscale) pipe.sharpen(SHARPEN)
  const buf = await pipe.toBuffer()
  const webp = out(`${target}.webp`)
  const avif = out(`${target}.avif`)
  await sharp(buf).webp({ quality: 84 }).toFile(webp)
  await sharp(buf).avif({ quality: 50 }).toFile(avif)
  const [a, b] = await Promise.all([sharp(webp).metadata(), sharp(avif).metadata()])
  console.log(`  ${target}.webp ${a.width}x${a.height} ${a.size ?? '?'}B`)
  console.log(`  ${target}.avif ${b.width}x${b.height} ${b.size ?? '?'}B`)
}

const d = await sharp(desktopSrc).metadata()
const m = await sharp(mobileSrc).metadata()
console.log(`source desktop ${d.width}x${d.height} · mobile ${m.width}x${m.height}`)
// Upscale-sharpen the mobile only when the source really is below 2x, so a genuine 732x376 export
// is passed through untouched instead of being sharpened twice.
await emit(desktopSrc, `${name}-desktop`, 1280, 300, false)
await emit(mobileSrc, `${name}-mobile`, 732, 376, (m.width ?? 0) < 732)
console.log('done — 4 files in public/banners/')
