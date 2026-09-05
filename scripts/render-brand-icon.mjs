#!/usr/bin/env node
/**
 * Rasterise the brand mark THROUGH CHROMIUM (Playwright), never ImageMagick: the mark's SVG carries a
 * drop-shadow + inner-shadow filter chain and two gradients, and ImageMagick's internal renderer
 * paints the "e" grey (measured 2026-09-05). Chromium renders it exactly as the browser will.
 *
 *   node scripts/render-brand-icon.mjs <svg> <out.png> <size>
 *
 * The one source of truth is public/logo-mark.svg (the rounded tile). Full-bleed variants for icons
 * the OS masks itself (iOS AppIcon, apple-touch, maskable PWA) are made by swapping the tile path
 * for a square before rendering — see scripts/brand-icons.sh for the full set.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [svgPath, out, sizeArg] = process.argv.slice(2)
if (!svgPath || !out || !sizeArg) { console.error('usage: render-brand-icon.mjs <svg> <out.png> <size>'); process.exit(2) }
const size = Number(sizeArg)
// FLAT=1: drop the <style> that switches the shadow filter on at ≥160px. Every raster is rendered
// flat — a phone shows the 1024 store icon at 180px and the launch mark at 120pt, and the blurred
// drop shadow survives that downsampling only as mud under the glyph (owner, 2026-09-05).
const raw = readFileSync(svgPath, 'utf8')
const svg = (process.env.FLAT === '1' ? raw.replace(/<style>.*?<\/style>/s, '') : raw).replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)
const html = `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;line-height:0">${svg}</div></body></html>`
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', out, `${size}x${size}`)
} finally {
  await browser.close()
}
