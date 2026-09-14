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
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const RAW = process.env.RAW || 'play-store-assets/raw'
const OUT = process.env.OUT || 'play-store-assets/phone/en'
mkdirSync(OUT, { recursive: true })

const frames = [
  { file: '01-home', raw: 'home', title: 'Buy & sell anything in Vietnam', sub: 'Phones, furniture, homes, jobs and more — in English and Vietnamese' },
  { file: '02-browse', raw: 'home-feed', title: 'Thousands of listings, every day', sub: 'Clear prices in đồng, with dollars alongside' },
  { file: '03-product', raw: 'product', title: 'Every detail before you buy', sub: 'Photos, key specs and the seller, all on one page' },
  { file: '04-store', raw: 'storefront', title: 'Shop official partner stores', sub: 'Trusted shops like CellphoneS, chosen and checked by eno' },
]

const font = (f) => `data:font/woff2;base64,${readFileSync(`src/fonts/${f}`).toString('base64')}`
const W = 1080
const H = 1920
const PHONE_W = 800          // outer width of the device, bezel included
const BEZEL = 18
const SCREEN_W = PHONE_W - BEZEL * 2
const STATUS_H = Math.round(SCREEN_W * (24 / 412)) // Android's 24dp status bar, at the screen's scale

const statusIcons = `
  <svg width="120" height="30" viewBox="0 0 120 30" fill="#111827" aria-hidden="true">
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
  .copy { position: absolute; top: 118px; left: 70px; right: 70px; text-align: center; }
  h1 { font-size: 86px; line-height: 1.04; font-weight: 700; letter-spacing: -1.6px; text-wrap: balance; }
  p { margin-top: 26px; font-size: 38px; line-height: 1.3; color: rgba(255,255,255,0.84); text-wrap: balance; }
  .phone {
    position: absolute; left: ${(W - PHONE_W) / 2}px; top: 478px; width: ${PHONE_W}px; padding: ${BEZEL}px;
    background: linear-gradient(145deg, #1f2937, #0b1220 60%); border-radius: 104px;
    box-shadow: 0 50px 110px rgba(2, 18, 45, 0.55), 0 0 0 2px rgba(255,255,255,0.08) inset;
  }
  .screen { border-radius: 86px; overflow: hidden; background: #fff; position: relative; }
  .status { height: ${STATUS_H}px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 58px 0 64px; }
  .time { font-size: 30px; font-weight: 700; color: #111827; letter-spacing: 0.2px; }
  .cam { position: absolute; top: ${Math.round(STATUS_H / 2 - 13)}px; left: 50%; width: 26px; height: 26px; margin-left: -13px; border-radius: 50%; background: #0b1220; box-shadow: 0 0 0 3px #1f2937; }
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
