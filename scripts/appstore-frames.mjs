#!/usr/bin/env node
/**
 * APP STORE SCREENSHOTS — each simulator capture in an iPhone frame on the brand blue, with a caption.
 *
 *   scripts/appstore-capture.sh <udid> <App.app> && node scripts/appstore-frames.mjs
 *   → play-store-assets/ios/en/0N-*.png  (1320×2868, the 6.9-inch size; 24-bit PNG, no alpha)
 *
 * The iOS sibling of scripts/play-frames.mjs, and deliberately NOT a profile of it: that script draws an
 * Android status bar and a hole-punch camera around a browser capture, and an Android device in an App
 * Store screenshot is a rejection (Guideline 2.3.10). These inputs are real iOS screenshots — status bar
 * and Dynamic Island included — so the frame here is only a rounded bezel, and nothing is drawn over the
 * app's own pixels.
 *
 * ⛔ ONLY A CERTIFIED SET IS FRAMED. Every raw must match the sha256 that appstore-capture.sh wrote into
 * manifest.json after the WHOLE run passed its regulated-copy scan, and the manifest must say the app
 * rendered https://www.eno.forum — a half-finished run or a hand-dropped file is refused, not framed.
 * ⚠️ Captions follow the second-hand focus (2026-10-03) and docs/ios-appstore-release.md Appendix A:
 * no visa, no "new", no shop named as an "official partner". Re-count against the live screens before
 * each upload.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RAW = process.env.RAW || 'play-store-assets/ios/raw'
const OUT = process.env.OUT || 'play-store-assets/ios/en'
mkdirSync(dirname(OUT), { recursive: true })

const frames = [
  { file: '01-home', title: 'Rentals, jobs and second-hand deals', sub: 'In English and Tiếng Việt' },
  { file: '02-rentals-map', title: 'Apartments and houses to rent', sub: 'Filter by district, see them on a map' },
  { file: '03-motorbike', title: 'Rent a motorbike or a car', sub: 'From local shops, by the day or the month' },
  { file: '04-jobs', title: 'Jobs, including English teaching', sub: 'Roles across Vietnam, in one place' },
  { file: '05-item', title: 'Every detail before you buy', sub: 'Price in đồng with dollars alongside' },
  { file: '06-shop', title: 'Second-hand shops in one place', sub: 'Used phones, laptops and cameras' },
]

try { execFileSync('magick', ['-version'], { stdio: 'ignore' }) } catch { throw new Error('ImageMagick 7 (`magick`) is required — brew install imagemagick') }

const manifestPath = `${RAW}/manifest.json`
if (!existsSync(manifestPath)) throw new Error(`${manifestPath} missing — run scripts/appstore-capture.sh first (it certifies the set)`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.base !== 'https://www.eno.forum') throw new Error(`${manifestPath} says the app rendered ${manifest.base}, not https://www.eno.forum`)
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
for (const f of frames) {
  const file = `${RAW}/${f.file}.png`
  if (!existsSync(file)) throw new Error(`${file} missing — re-run scripts/appstore-capture.sh`)
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (manifest.shots?.[f.file] !== sha) throw new Error(`${file} is not the capture ${manifestPath} certifies (${manifest.at}) — re-run the capture`)
  const s = pngSize(file)
  if (s.w !== 1320 || s.h !== 2868) throw new Error(`${file} is ${s.w}×${s.h}; the 6.9-inch set is 1320×2868`)
}

// ⚠️ A FAILED RUN MUST NOT LEAVE A MIXED OR PARTIAL SET. Frames render into a staging DIRECTORY beside
// OUT, which then replaces OUT in one rename — never file by file, which a failure halfway through
// would leave mixed (reviewers, 2026-10-04). OUT holds nothing but this set and its frames.json.
const STAGE = mkdtempSync(`${OUT}.staging-`)

const font = (f) => `data:font/woff2;base64,${readFileSync(`src/fonts/${f}`).toString('base64')}`
const W = 1320
const H = 2868
const CAPTION_BAND = 560 // headline + subhead, vertically centred in this band
const GAP_BELOW = 70     // clear canvas under the phone, so the device reads as an object, not a crop
const BEZEL = 20
const PHONE_H = H - CAPTION_BAND - GAP_BELOW
const SCREEN_H = PHONE_H - BEZEL * 2
const SCREEN_W = Math.round(SCREEN_H * (1320 / 2868)) // the capture's own aspect — nothing cropped
const PHONE_W = SCREEN_W + BEZEL * 2
// An iPhone 16 Pro Max screen corner is ~55pt at 3x on a 1320px-wide screen; scale it with the screen.
const SCREEN_RADIUS = Math.round(165 * (SCREEN_W / 1320))

const html = (f) => {
  const shot = `data:image/png;base64,${readFileSync(`${RAW}/${f.file}.png`).toString('base64')}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-regular.woff2')}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-bold.woff2')}) format('woff2'); font-weight: 700; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: 'Open Runde', system-ui, sans-serif;
    background:
      radial-gradient(1100px 860px at 88% 6%, rgba(255,255,255,0.16), rgba(255,255,255,0) 70%),
      radial-gradient(860px 740px at 0% 100%, rgba(3,30,70,0.35), rgba(3,30,70,0) 70%),
      linear-gradient(170deg, #0E65BC 0%, #0B5AAD 48%, #08519A 100%);
    color: #fff; position: relative;
  }
  .copy {
    position: absolute; top: 0; left: 90px; right: 90px; height: ${CAPTION_BAND}px; padding-top: 40px;
    display: flex; flex-direction: column; justify-content: center; text-align: center;
  }
  h1 { font-size: 92px; line-height: 1.06; font-weight: 700; letter-spacing: -1.8px; text-wrap: balance; }
  p { margin-top: 28px; font-size: 44px; line-height: 1.3; color: rgba(255,255,255,0.86); text-wrap: balance; }
  .phone {
    position: absolute; left: ${Math.round((W - PHONE_W) / 2)}px; top: ${CAPTION_BAND}px; width: ${PHONE_W}px; height: ${PHONE_H}px;
    padding: ${BEZEL}px; border-radius: ${SCREEN_RADIUS + BEZEL}px;
    background: linear-gradient(145deg, #2a2f38, #0d1118 55%, #1c2129);
    box-shadow: 0 60px 120px rgba(2, 18, 45, 0.5), 0 0 0 3px rgba(255,255,255,0.10) inset;
  }
  .screen { width: ${SCREEN_W}px; height: ${SCREEN_H}px; border-radius: ${SCREEN_RADIUS}px; overflow: hidden; background: #fff; }
  .shot { display: block; width: ${SCREEN_W}px; height: ${SCREEN_H}px; }
  </style></head><body>
    <div class="copy"><h1>${f.title}</h1><p>${f.sub}</p></div>
    <div class="phone"><div class="screen"><img class="shot" src="${shot}" alt=""></div></div>
  </body></html>`
}

// The launch sits inside the cleanup: a missing Playwright browser must not strand the staging directory.
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  for (const f of frames) {
    await page.setContent(html(f), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const out = `${STAGE}/${f.file}.png`
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } })
    // App Store Connect REFUSES a screenshot with an alpha channel — flatten, and keep the bytes stable.
    execFileSync('magick', [out, '-background', '#08519A', '-alpha', 'remove', '-alpha', 'off', '-define', 'png:exclude-chunk=date,time', out])
    console.log('wrote', out)
  }
  const written = Object.fromEntries(frames.map((f) => [f.file, createHash('sha256').update(readFileSync(`${STAGE}/${f.file}.png`)).digest('hex')]))
  writeFileSync(`${STAGE}/frames.json`, `${JSON.stringify({ at: new Date().toISOString(), from: manifest.at, frames: written }, null, 2)}\n`)
  // Old set aside, new set in, old set dropped — so a failed rename puts the last good set back
  // instead of leaving nothing (codex, review).
  const OLD = `${STAGE}.old`
  if (existsSync(OUT)) renameSync(OUT, OLD)
  try {
    renameSync(STAGE, OUT)
  } catch (e) {
    if (existsSync(OLD)) renameSync(OLD, OUT)
    throw e
  }
  rmSync(OLD, { recursive: true, force: true })
} finally {
  await browser?.close()
  rmSync(STAGE, { recursive: true, force: true })
}
