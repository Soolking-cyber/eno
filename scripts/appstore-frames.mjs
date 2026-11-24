#!/usr/bin/env node
/**
 * APP STORE SCREENSHOTS — each simulator capture in an iPhone frame on a brand-blue gradient, under a bold
 * headline and a one-line subhead. Two sets, each COMPOSED at its own size (not one set resampled):
 *
 *   scripts/appstore-capture.sh <udid> <App.app> && node scripts/appstore-frames.mjs
 *   → play-store-assets/ios/en/0N-*.png      1320×2868  6.9-inch ("iPhone 6.9-inch display")
 *   → play-store-assets/ios/en-6.3/0N-*.png  1206×2622  6.3-inch (App Store Connect REQUIRES this one for
 *                                                       "iPhone with Dynamic Island (medium display)")
 *   both 24-bit PNG, no alpha.
 *
 * The iOS sibling of scripts/play-frames.mjs, and deliberately NOT a profile of it: that script draws an
 * Android status bar and a hole-punch camera around a browser capture, and an Android device in an App
 * Store screenshot is a rejection (Guideline 2.3.10). These inputs are real iOS screenshots — status bar,
 * Dynamic Island and the native tab bar included — so the frame here is only a device body, and nothing is
 * drawn over the app's own pixels.
 *
 * ⛔ ONLY A CERTIFIED SET IS FRAMED. Every raw must match the sha256 that appstore-capture.sh wrote into
 * manifest.json after the WHOLE run passed its regulated-copy scan, and the manifest must say the app
 * rendered https://eno.vn (its origin since 2026-10-06) — a half-finished run, a set captured from the old
 * www.eno.forum origin, or a hand-dropped file is refused, not framed.
 * ⚠️ Captions follow the second-hand focus (2026-10-03) and docs/ios-appstore-release.md Appendix A:
 * no visa, no "new", no shop named as an "official partner", no emoji. Each caption describes ITS screen —
 * re-read them against the framed set before each upload (the screens are live pages and change daily).
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const RAW = process.env.RAW || 'play-store-assets/ios/raw'
const SETS = [
  { out: process.env.OUT || 'play-store-assets/ios/en', w: 1320, h: 2868 },
  { out: process.env.OUT_63 || 'play-store-assets/ios/en-6.3', w: 1206, h: 2622 },
]
for (const s of SETS) mkdirSync(dirname(s.out), { recursive: true })

// One headline (bold, two lines at most) and one lighter subhead line per shot. `hero` adds the eno mark
// over the first image.
const frames = [
  { file: '01-apartment', hero: true, title: 'Find your place in Vietnam', sub: 'Apartments and houses, with real photos' },
  { file: '02-map', title: 'Search on the map', sub: 'Every building’s flats and prices' },
  { file: '03-jobs', title: 'Find work, including teaching', sub: 'Jobs at schools across Vietnam' },
  { file: '04-teacher', title: 'Teachers, get found by schools', sub: 'A free profile, contacts kept private' },
  { file: '05-post', title: 'Sell in a minute', sub: 'Photos from your phone, no listing fees' },
]

try { execFileSync('magick', ['-version'], { stdio: 'ignore' }) } catch { throw new Error('ImageMagick 7 (`magick`) is required — brew install imagemagick') }

const manifestPath = `${RAW}/manifest.json`
if (!existsSync(manifestPath)) throw new Error(`${manifestPath} missing — run scripts/appstore-capture.sh first (it certifies the set)`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.base !== 'https://eno.vn') throw new Error(`${manifestPath} says the app rendered ${manifest.base}, not https://eno.vn`)
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
// Read once, hashed and framed from the SAME bytes — a file swapped between the check and the render
// cannot slip through.
const raws = new Map()
for (const f of frames) {
  const file = `${RAW}/${f.file}.png`
  if (!existsSync(file)) throw new Error(`${file} missing — re-run scripts/appstore-capture.sh`)
  const bytes = readFileSync(file)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (manifest.shots?.[f.file] !== sha) throw new Error(`${file} is not the capture ${manifestPath} certifies (${manifest.at}) — re-run the capture`)
  const s = pngSize(file)
  if (s.w !== 1320 || s.h !== 2868) throw new Error(`${file} is ${s.w}×${s.h}; the captures are 1320×2868`)
  raws.set(f.file, bytes)
}

const font = (f) => `data:font/woff2;base64,${readFileSync(`src/fonts/${f}`).toString('base64')}`
const FONTS = `
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-regular.woff2')}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-bold.woff2')}) format('woff2'); font-weight: 700; }`
const MARK = `data:image/svg+xml;base64,${readFileSync('public/logo-mark.svg').toString('base64')}`

/**
 * The layout is written for the 6.9-inch canvas and every length is multiplied by k = W / 1320, so the 6.3-inch
 * set is laid out at its own size (type, bezel and spacing in its own pixels), not resampled from the other.
 * The two canvases share an aspect to 0.1%, so the vertical rhythm holds.
 */
function layout(W, H, hero) {
  const k = W / 1320
  const px = (v) => Math.round(v * k)
  const phoneTop = px(hero ? 690 : 600)
  const phoneBottom = px(104)
  const band = px(6) // the titanium edge
  const bezel = px(22) // the black glass border round the display
  const phoneH = H - phoneTop - phoneBottom
  const screenH = phoneH - 2 * (band + bezel)
  const screenW = Math.round(screenH * (1320 / 2868)) // the capture's own aspect — nothing cropped
  const phoneW = screenW + 2 * (band + bezel)
  // An iPhone 17 Pro Max display corner is ~55pt at 3x on a 1320px-wide screen; scale it with the screen.
  const screenR = Math.round(165 * (screenW / 1320))
  return { k, px, phoneTop, phoneH, phoneW, screenW, screenH, screenR, band, bezel }
}

/** The capture resampled ONCE, with Lanczos, to the exact pixel size of the screen it fills — the browser's own downscale is softer. */
function screenPng(name, w, h, tmp) {
  const src = join(tmp, `${name}.src.png`)
  const out = join(tmp, `${name}-${w}x${h}.png`)
  writeFileSync(src, raws.get(name))
  execFileSync('magick', [src, '-filter', 'Lanczos', '-resize', `${w}x${h}!`, '-strip', out])
  return `data:image/png;base64,${readFileSync(out).toString('base64')}`
}

function phone(L, shot) {
  const { phoneW, phoneH, screenW, screenH, screenR, band, bezel } = L
  const outerR = screenR + bezel + band
  // Side keys, as fractions of the body's height: action + volume on the left; side key + Camera Control on the right.
  const key = (side, top, len) => `<i class="key ${side}" style="top:${Math.round(phoneH * top)}px;height:${Math.round(phoneH * len)}px"></i>`
  return `<div class="phone" style="width:${phoneW}px;height:${phoneH}px;border-radius:${outerR}px;padding:${band}px">
      ${key('l', 0.175, 0.042)}${key('l', 0.245, 0.072)}${key('l', 0.335, 0.072)}${key('r', 0.265, 0.112)}${key('r', 0.53, 0.06)}
      <div class="bezel" style="border-radius:${outerR - band}px;padding:${bezel}px">
        <div class="screen" style="width:${screenW}px;height:${screenH}px;border-radius:${screenR}px">
          <img src="${shot}" width="${screenW}" height="${screenH}" alt="">
        </div>
      </div>
    </div>`.replace(/\n\s*/g, '')
}

function html(f, W, H, tmp) {
  const L = layout(W, H, f.hero)
  const { px, phoneW, phoneTop } = L
  const shot = screenPng(f.file, L.screenW, L.screenH, tmp)
  const keyW = px(7)
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    position: relative; color: #fff; font-family: 'Open Runde', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
    background:
      radial-gradient(${px(1500)}px ${px(1100)}px at 50% ${px(-180)}px, rgba(64,150,255,0.95), rgba(64,150,255,0) 72%),
      radial-gradient(${px(1250)}px ${px(1000)}px at 50% ${px(1900)}px, rgba(110,180,255,0.32), rgba(110,180,255,0) 70%),
      linear-gradient(180deg, #0b62e2 0%, #0056cf 38%, #00449f 74%, #00317a 100%);
  }
  /* Two faint rings behind the device: depth without a pattern competing with the screen. */
  .ring { position: absolute; left: 50%; border-radius: 50%; transform: translate(-50%, -50%); border: ${px(2)}px solid rgba(255,255,255,0.075); }
  /* The caption block is centred in the band above the device, so a one-line headline sits as balanced as a two-line one. */
  .copy { position: absolute; left: ${px(84)}px; right: ${px(84)}px; top: ${px(f.hero ? 70 : 90)}px; height: ${phoneTop - px(f.hero ? 70 : 90) - px(60)}px;
          display: flex; flex-direction: column; justify-content: center; text-align: center; }
  .mark { display: block; width: ${px(124)}px; height: ${px(124)}px; margin: 0 auto ${px(46)}px; border-radius: ${px(30)}px;
          box-shadow: 0 ${px(18)}px ${px(40)}px rgba(0, 20, 60, 0.35), 0 0 0 ${px(3)}px rgba(255,255,255,0.22); }
  h1 { font-weight: 700; font-size: ${px(104)}px; line-height: 1.04; letter-spacing: ${(-0.026 * px(104)).toFixed(2)}px; text-wrap: balance; }
  p { margin-top: ${px(30)}px; font-weight: 400; font-size: ${px(46)}px; line-height: 1.25; letter-spacing: ${(-0.004 * px(46)).toFixed(2)}px; color: rgba(255,255,255,0.80); text-wrap: balance; }
  .stage { position: absolute; left: ${Math.round((W - phoneW) / 2)}px; top: ${phoneTop}px; }
  .phone {
    position: relative;
    background: linear-gradient(135deg, #d7dbe1 0%, #6c727b 9%, #30343a 30%, #1d2024 55%, #3a3f46 80%, #a9afb8 100%);
    box-shadow:
      0 ${px(110)}px ${px(150)}px ${px(-50)}px rgba(0, 14, 44, 0.70),
      0 ${px(40)}px ${px(80)}px ${px(-24)}px rgba(0, 14, 44, 0.45),
      0 0 0 ${px(1.5)}px rgba(255, 255, 255, 0.20);
  }
  .key { position: absolute; width: ${keyW}px; border-radius: ${keyW}px; background: linear-gradient(90deg, #5c626a, #b9bfc7 50%, #5c626a); }
  .key.l { left: ${-keyW + px(2)}px; } .key.r { right: ${-keyW + px(2)}px; }
  .bezel { width: 100%; height: 100%; background: #030405; box-shadow: inset 0 0 0 ${px(1.5)}px rgba(255,255,255,0.07); }
  .screen { overflow: hidden; background: #fff; transform: translateZ(0); }
  .screen img { display: block; }
  </style></head><body>
    <div class="ring" style="top:${phoneTop + Math.round(L.phoneH * 0.45)}px;width:${px(1560)}px;height:${px(1560)}px"></div>
    <div class="ring" style="top:${phoneTop + Math.round(L.phoneH * 0.45)}px;width:${px(2240)}px;height:${px(2240)}px"></div>
    <div class="copy">${f.hero ? `<img class="mark" src="${MARK}" alt="">` : ''}<h1>${f.title}</h1><p>${f.sub}</p></div>
    <div class="stage">${phone(L, shot)}</div>
  </body></html>`
}

// ⚠️ A FAILED RUN MUST NOT LEAVE A MIXED OR PARTIAL SET. Each set renders into a staging DIRECTORY beside its
// OUT; only when BOTH sets rendered does each staging directory replace its OUT in one rename — never file by
// file, which a failure halfway through would leave mixed (reviewers, 2026-10-04). OUT holds nothing but its
// set and its frames.json.
const TMP = mkdtempSync(join(tmpdir(), 'eno-frames-'))
const stages = []
let browser
try {
  for (const s of SETS) stages.push({ ...s, stage: mkdtempSync(`${s.out}.staging-`) })
  browser = await chromium.launch()
  for (const s of stages) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 })
    for (const f of frames) {
      await page.setContent(html(f, s.w, s.h, TMP), { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      // A headline that wraps past two lines, or a subhead past one, is a caption to shorten — not a layout to squeeze.
      const lines = await page.evaluate(() => {
        const n = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
        return { h1: n(document.querySelector('h1')), p: n(document.querySelector('p')) }
      })
      if (lines.h1 > 2 || lines.p > 1) throw new Error(`${f.file} (${s.w}×${s.h}): the headline runs ${lines.h1} lines / the subhead ${lines.p} — shorten the caption`)
      const out = `${s.stage}/${f.file}.png`
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: s.w, height: s.h } })
      // App Store Connect REFUSES a screenshot with an alpha channel — flatten to 24-bit RGB, and keep the bytes stable.
      execFileSync('magick', [out, '-background', '#00317a', '-alpha', 'remove', '-alpha', 'off', '-define', 'png:exclude-chunk=date,time', `PNG24:${out}`])
      const got = pngSize(out)
      if (got.w !== s.w || got.h !== s.h) throw new Error(`${out} came out ${got.w}×${got.h}, not ${s.w}×${s.h}`)
      console.log('wrote', out)
    }
    await page.close()
    const written = Object.fromEntries(frames.map((f) => [f.file, createHash('sha256').update(readFileSync(`${s.stage}/${f.file}.png`)).digest('hex')]))
    writeFileSync(`${s.stage}/frames.json`, `${JSON.stringify({ at: new Date().toISOString(), from: manifest.at, size: `${s.w}x${s.h}`, frames: written }, null, 2)}\n`)
  }
  // Old set aside, new set in, old set dropped — so a failed rename puts the last good set back
  // instead of leaving nothing (codex, review).
  for (const s of stages) {
    const OLD = `${s.stage}.old`
    if (existsSync(s.out)) renameSync(s.out, OLD)
    try {
      renameSync(s.stage, s.out)
    } catch (e) {
      if (existsSync(OLD)) renameSync(OLD, s.out)
      throw e
    }
    rmSync(OLD, { recursive: true, force: true })
  }
} finally {
  await browser?.close()
  for (const s of stages) rmSync(s.stage, { recursive: true, force: true })
  rmSync(TMP, { recursive: true, force: true })
}
