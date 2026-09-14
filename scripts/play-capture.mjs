#!/usr/bin/env node
/**
 * RAW PHONE CAPTURES FOR THE PLAY LISTING — light theme, the app's own user agent, Play's phone size.
 *
 *   node scripts/play-capture.mjs                      # → play-store-assets/raw/*.png (1082×2402 @ 412×915 css, 2.625x)
 *   BASE=https://www.eno.forum node scripts/play-capture.mjs
 *
 * Owner, 2026-09-14: "update screen images from light theme and beautify those like professional app dont show visa
 * related pages only homescreen product and storefront pages". These are the INPUTS; scripts/play-frames.mjs puts them
 * in device frames with captions. eno.vn is captured, not eno.forum: it is the same marketplace without the e-Visa entry,
 * so no visa surface can slip into a store image.
 *
 * Each capture runs in a FRESH context (one page's state — a tour's demo query — must not leak into the next): light theme
 * pinned before paint (localStorage 'eno-theme'), the `EnoNativeApp/1` UA token the app appends (so the page renders in
 * app mode), consent answered 'essential' and the intro tour marked done so neither card covers the screen, and the
 * transient chrome hidden — the pre-launch notice and the floating support bubble.
 * ⛔ THE HOME PROMO CAROUSEL IS PINNED TO ITS FIRST SLIDE AND ITS E-VISA SLIDES REMOVED: it autoplays, and one capture
 * landed on "Vietnam E-Visa, Your Way" — exactly what the owner said must not be in a store image.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = process.env.OUT || 'play-store-assets/raw'
const BASE = process.env.BASE || 'https://eno.vn'
mkdirSync(OUT, { recursive: true })

const shots = [
  { name: 'home', path: '/' },
  { name: 'home-feed', path: '/', scrollTo: '#listings', scrollExtra: 330 }, // the grid filling the screen
  { name: 'product', path: '/listings/cmt7e74xd06z12wq4bx4u6npy' }, // CellphoneS · iPhone 17 Pro Max
  { name: 'storefront', path: '/sellers/cmt78nvif0000gpq48kvzmxjw' }, // CellphoneS
]

const browser = await chromium.launch()
const newContext = () => browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1',
})

for (const s of shots) {
  const ctx = await newContext()
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('eno-theme', 'light')
      localStorage.setItem('eno-cookie-consent', 'essential')
      localStorage.setItem('eno_intro_tour_v1', 'done')
    } catch { /* private mode */ }
  })
  const p = await ctx.newPage()
  // A removed listing or a server error must stop the run, not become a store image of an error page (astra, opus).
  const res = await p.goto(BASE + s.path, { waitUntil: 'load', timeout: 90000 })
  if (!res || !res.ok()) throw new Error(`${s.name}: ${BASE + s.path} answered ${res?.status() ?? 'nothing'} — pick another listing/seller id`)
  await p.waitForTimeout(5000)
  // Belt and braces: a consent card that still shows is declined.
  const decline = p.getByRole('button', { name: /^(Decline|Từ chối)$/ })
  if (await decline.count()) { await decline.first().click().catch(() => {}); await p.waitForTimeout(600) }
  await p.evaluate(() => {
    for (const item of document.querySelectorAll('[data-slot="carousel-item"]')) {
      const text = `${item.textContent || ''} ${[...item.querySelectorAll('img')].map((i) => i.alt).join(' ')} ${item.querySelector('a')?.getAttribute('href') || ''}`
      if (/visa|thị thực/i.test(text)) item.remove()
    }
  })
  await p.addStyleTag({ content: `
    #prelaunch-banner, [data-sonner-toaster] { display: none !important; }
    [data-slot="carousel-content"] > * { transform: none !important; transition: none !important; }
    button[aria-label*="Help" i], button[aria-label*="Support" i], button[aria-label*="Hỗ trợ" i] { visibility: hidden !important; }
  ` })
  if (s.scrollTo) {
    await p.evaluate(([sel, extra]) => { const el = document.querySelector(sel); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64 + extra, behavior: 'instant' }) }, [s.scrollTo, s.scrollExtra ?? 0])
    await p.waitForTimeout(2500)
  }
  await p.waitForTimeout(1200)
  // ⛔ THE STORE IMAGE MUST NOT SHOW A REGULATED SURFACE — CHECKED, NOT ASSUMED. Removing the carousel's visa slides covers
  // one known source; a visa LISTING in the feed or on a storefront is another (opus). The words are the licensing
  // boundary's own — visa, itinerary/trip planning, PayPal — and anything visible in the viewport carrying one fails the
  // run, so the fix is choosing a different screen, never shipping it. Own text AND children's, since a heading with a
  // nested span is still visible text (astra).
  const visaOnScreen = await p.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const hits = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join(' ')
      const text = el.tagName === 'IMG' ? `${el.getAttribute('alt') || ''} ${el.getAttribute('src') || ''}` : own
      if (/\b(e-?visa|visa|itinerary|paypal)\b|thị thực|lịch trình/i.test(text)) hits.push(`<${el.tagName.toLowerCase()}> ${text.trim().slice(0, 70)}`)
    }
    return hits
  })
  if (visaOnScreen.length) throw new Error(`${s.name}: regulated-surface copy on screen — ${visaOnScreen.slice(0, 3).join(' | ')}`)
  await p.screenshot({ path: `${OUT}/${s.name}.png` })
  console.log('wrote', `${OUT}/${s.name}.png`, '—', await p.title())
  await ctx.close()
}
await browser.close()
