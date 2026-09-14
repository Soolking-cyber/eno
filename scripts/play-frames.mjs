#!/usr/bin/env node
/**
 * STORE SCREENSHOTS FOR GOOGLE PLAY — each raw capture in a phone frame on the brand blue, with a headline.
 *
 *   node scripts/play-capture.mjs && node scripts/play-frames.mjs     # → play-store-assets/phone/en/0N-*.png
 *
 * Owner, 2026-09-14: "update screen images from light theme and beautify those like professional app dont show visa related
 * pages only homescreen product and storefront pages". Four frames — home, the listings feed, a product page, a partner
 * storefront — from scripts/play-capture.mjs (light theme, eno.vn, no e-Visa surface).
 *
 * 1080×1920 (9:16), the phone-screenshot shape Play features in its promotional placements; PNG with the alpha channel
 * removed (Play accepts 24-bit PNG or JPEG). Rendered through Chromium like the brand icons, with the app's own typeface
 * (Open Runde, src/fonts, OFL) embedded so no system font can stand in. The blue is the launcher icon's gradient
 * (#0E65BC → #08519A), so the listing, the icon and the screenshots read as one brand.
 *
 * ⛔ ONLY CAPTURES THIS RUN'S play-capture.mjs VOUCHED FOR ARE FRAMED. The raws live in a shared directory one file at a
 * time, so a half-finished capture leaves new files beside stale ones — and a stale one predates the regulated-surface
 * check that is the whole reason the capture script exists (astra, opus). Every input is matched against the sha256 in
 * `manifest.json`, which the capture writes only after all four shots pass.
 * ⛔ THE WHOLE DEVICE IS INSIDE THE CANVAS — IT USED TO BLEED OFF THE BOTTOM AND THE OWNER REJECTED THAT
 * (2026-09-14: "remake the android app images so user can see full page now you cropped bottom part"). Bleeding a phone
 * past the frame is a common listing style, but it cut the bottom navigation off every shot, which is the one piece of
 * chrome that says "this is an app". The device is sized from the canvas HEIGHT instead: caption block, then a phone
 * whose screen holds the entire 412×915 viewport capture, status bar included, with room under it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'

const RAW = process.env.RAW || 'play-store-assets/raw'
const OUT = process.env.OUT || 'play-store-assets/phone/en'
mkdirSync(OUT, { recursive: true })

const frames = [
  { file: '01-home', raw: 'home', title: 'Buy & sell anything in Vietnam', sub: 'Phones, furniture, homes, jobs and more — in English and Vietnamese' },
  { file: '02-browse', raw: 'home-feed', title: 'Thousands of listings, every day', sub: 'Clear prices in đồng, with dollars alongside' },
  { file: '03-product', raw: 'product', title: 'Every detail before you buy', sub: 'Photos, key specs and the seller, all on one page' },
  { file: '04-store', raw: 'storefront', title: 'Shop official partner stores', sub: 'Trusted shops like CellphoneS, chosen and checked by eno' },
]

// ⚠️ A MISSING `magick` MUST STOP THE RUN, not convert the first frame and leave the rest RGBA (opus).
try { execFileSync('magick', ['-version'], { stdio: 'ignore' }) } catch { throw new Error('ImageMagick 7 (`magick`) is required — brew install imagemagick') }

const manifestPath = `${RAW}/manifest.json`
if (!existsSync(manifestPath)) throw new Error(`${manifestPath} missing — run scripts/play-capture.mjs first (it certifies the set)`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
// The certificate says WHICH SITE was photographed. A localhost or forum capture passes every check in play-capture.mjs
// and would be framed as a store image of the marketplace (opus).
const EXPECT_BASE = process.env.EXPECT_BASE || 'https://eno.vn'
// Host, not string: `https://eno.vn/` and `https://www.eno.vn` are the same edition, and a trailing slash is not a leak.
const site = (u) => { try { return new URL(u).host.replace(/^www\./, '') } catch { return String(u) } }
if (site(manifest.base) !== site(EXPECT_BASE)) throw new Error(`${manifestPath} was captured from ${manifest.base}, not ${EXPECT_BASE} — re-run scripts/play-capture.mjs`)
for (const f of frames) {
  const file = `${RAW}/${f.raw}.png`
  if (!existsSync(file)) throw new Error(`${file} missing — re-run scripts/play-capture.mjs`)
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (manifest.shots?.[f.raw] !== sha) throw new Error(`${file} is not the capture ${manifestPath} certifies (${manifest.at}) — re-run scripts/play-capture.mjs`)
}

const font = (f) => `data:font/woff2;base64,${readFileSync(`src/fonts/${f}`).toString('base64')}`
const W = 1080
const H = 1920
const CAPTION_BAND = 372     // everything above the device: headline + subhead, vertically centred in this band
const GAP_BELOW = 44         // clear canvas under the phone, so the device reads as an object, not a crop
const BEZEL = 15
const PHONE_H = H - CAPTION_BAND - GAP_BELOW
const SCREEN_H = PHONE_H - BEZEL * 2

/**
 * THE DEVICE IS SIZED FROM THE HEIGHT, AND THE CAPTURE'S OWN PIXELS DECIDE ITS WIDTH — a hard-coded aspect would crop
 * the very thing this rewrite exists to stop. The PNG header carries it: width at byte 16, height at 20, big-endian.
 */
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const RAW_SIZE = pngSize(`${RAW}/${frames[0].raw}.png`)
for (const f of frames) {
  const s = pngSize(`${RAW}/${f.raw}.png`)
  // One geometry serves all four, so one odd-sized capture would be silently stretched into the frame.
  if (s.w !== RAW_SIZE.w || s.h !== RAW_SIZE.h) throw new Error(`${f.raw}.png is ${s.w}×${s.h}, not ${RAW_SIZE.w}×${RAW_SIZE.h} — the captures must share one viewport`)
}
// screen = status bar + the whole capture, scaled together: SCREEN_H = SCREEN_W·(24/412) + SCREEN_W·(rawH/rawW).
const SCREEN_W = Math.round(SCREEN_H / (24 / 412 + RAW_SIZE.h / RAW_SIZE.w))
const PHONE_W = SCREEN_W + BEZEL * 2
const STATUS_H = Math.round(SCREEN_W * (24 / 412)) // Android's 24dp status bar, at the screen's scale
const RADIUS = Math.round(PHONE_W * 0.13)

const statusIcons = `
  <svg width="${Math.round(STATUS_H * 3.1)}" height="${Math.round(STATUS_H * 0.78)}" viewBox="0 0 120 30" fill="#111827" aria-hidden="true">
    <path d="M4 22h4v4H4zM11 17h4v9h-4zM18 12h4v14h-4zM25 7h4v19h-4z"/>
    <path d="M46 10c6-5.5 15-5.5 21 0l-2.4 2.6c-4.7-4.2-11.5-4.2-16.2 0zM50.5 15c3.5-3.1 8.5-3.1 12 0l-2.5 2.6c-2.1-1.8-4.9-1.8-7 0zM56.5 24l-3.2-3.4c1.9-1.5 4.5-1.5 6.4 0z"/>
    <rect x="80" y="8" width="30" height="15" rx="3.5" fill="none" stroke="#111827" stroke-width="2.4"/>
    <rect x="83" y="11" width="22" height="9" rx="1.5"/><rect x="111.5" y="12.5" width="3" height="6" rx="1.2"/>
  </svg>`

const html = (f) => {
  const shot = `data:image/png;base64,${readFileSync(`${RAW}/${f.raw}.png`).toString('base64')}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-regular.woff2')}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Open Runde'; src: url(${font('open-runde-bold.woff2')}) format('woff2'); font-weight: 700; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: 'Open Runde', system-ui, sans-serif;
    background:
      radial-gradient(900px 700px at 88% 6%, rgba(255,255,255,0.16), rgba(255,255,255,0) 70%),
      radial-gradient(700px 600px at 0% 100%, rgba(3,30,70,0.35), rgba(3,30,70,0) 70%),
      linear-gradient(170deg, #0E65BC 0%, #0B5AAD 48%, #08519A 100%);
    color: #fff; position: relative;
  }
  .copy {
    position: absolute; top: 0; left: 70px; right: 70px; height: ${CAPTION_BAND}px; padding-top: 26px;
    display: flex; flex-direction: column; justify-content: center; text-align: center;
  }
  h1 { font-size: 72px; line-height: 1.06; font-weight: 700; letter-spacing: -1.4px; text-wrap: balance; }
  p { margin-top: 22px; font-size: 33px; line-height: 1.32; color: rgba(255,255,255,0.84); text-wrap: balance; }
  .phone {
    position: absolute; left: ${Math.round((W - PHONE_W) / 2)}px; top: ${CAPTION_BAND}px; width: ${PHONE_W}px; padding: ${BEZEL}px;
    background: linear-gradient(145deg, #1f2937, #0b1220 60%); border-radius: ${RADIUS}px;
    box-shadow: 0 44px 90px rgba(2, 18, 45, 0.5), 0 0 0 2px rgba(255,255,255,0.08) inset;
  }
  /* ⚠️ NO HEIGHT HERE ON PURPOSE — the screen is as tall as the status bar plus the whole capture, so the rounding in
     SCREEN_W cannot shave a pixel off the bottom navigation (opus read SCREEN_H as applied here and called it a 1px
     crop; measured, the phone's box is 1504.3px at top 372 and the canvas is 1920, so nothing is clipped).
     The overflow rule is only what rounds the screen's corners. */
  .screen { border-radius: ${RADIUS - BEZEL}px; overflow: hidden; background: #fff; position: relative; }
  .status { height: ${STATUS_H}px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 ${Math.round(STATUS_H * 1.4)}px 0 ${Math.round(STATUS_H * 1.55)}px; }
  .time { font-size: ${Math.round(STATUS_H * 0.76)}px; font-weight: 700; color: #111827; letter-spacing: 0.2px; }
  .cam { position: absolute; top: ${Math.round(STATUS_H / 2 - 11)}px; left: 50%; width: 22px; height: 22px; margin-left: -11px; border-radius: 50%; background: #0b1220; box-shadow: 0 0 0 3px #1f2937; }
  .shot { display: block; width: ${SCREEN_W}px; }
  </style></head><body>
    <div class="copy"><h1>${f.title}</h1><p>${f.sub}</p></div>
    <div class="phone"><div class="screen">
      <div class="status"><span class="time">9:41</span>${statusIcons}</div><span class="cam"></span>
      <img class="shot" src="${shot}" alt="">
    </div></div>
  </body></html>`
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  for (const f of frames) {
    await page.setContent(html(f), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const out = `${OUT}/${f.file}.png`
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } })
    // Play rejects nothing for alpha on screenshots, but a flat 24-bit PNG is the documented format — and byte-stable.
    execFileSync('magick', [out, '-background', '#08519A', '-alpha', 'remove', '-alpha', 'off', '-define', 'png:exclude-chunk=date,time', out])
    console.log('wrote', out)
  }
} finally {
  await browser.close()
}
