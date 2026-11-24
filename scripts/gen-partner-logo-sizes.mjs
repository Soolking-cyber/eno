#!/usr/bin/env node
/**
 * The partner strip's logos at the heights the strip paints them (SEO Site Checkup 2026-11-24, "Resize oversized images";
 * why and the heights: PARTNER_LOGO_HEIGHTS in src/lib/partner-strip.ts). For every roster line of that file it writes
 * `public/partners/<name>-h<H>.webp` beside the 96 px original, keeping the aspect ratio. Every run redraws every variant
 * (byte-stable with the same sharp/libvips, so an unchanged logo leaves git clean there; another version may rewrite them
 * all, harmlessly): replace a partner's logo and re-run.
 *   node scripts/gen-partner-logo-sizes.mjs        (then commit the new public/partners/*-h*.webp)
 * partner-strip.logo-sizes.test.ts fails while any roster logo lacks one, or one is the wrong height.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// ⚠️ Kept equal to PARTNER_LOGO_HEIGHTS (the test reads both through the files it expects).
const HEIGHTS = { wide: [24, 48, 64], square: [32, 64] }
const roster = readFileSync(`${ROOT}src/lib/partner-strip.ts`, 'utf8')
const entries = [...roster.matchAll(/logo: \{ src: '(\/partners\/[a-z0-9-]+)\.webp'[^\n]*?size: '(wide|square)'/g)]
// One roster entry per line, logo then size (the PARTNER_STRIP shape): a line this misses would go without variants.
const listed = (roster.match(/\{ handle: '/g) ?? []).length
if (!entries.length || entries.length !== listed) throw new Error(`matched ${entries.length} of ${listed} roster lines — has the PARTNER_STRIP line shape changed?`)
let made = 0
for (const [, base, size] of entries) {
  const src = `${ROOT}public${base}.webp`
  for (const h of HEIGHTS[size]) {
    const out = `${ROOT}public${base}-h${h}.webp`
    await sharp(src).resize({ height: h }).webp({ quality: 85, alphaQuality: 90, effort: 6 }).toFile(out)
    made++
  }
}
console.log(`${entries.length} roster logos, ${made} variants written`)
