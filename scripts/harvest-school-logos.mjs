#!/usr/bin/env node
/**
 * Capture each /schools directory entry's OFFICIAL logo from its own website (owner, 2026-10-05: "add
 * official logos of all these education centers and schools").
 *
 *   node scripts/harvest-school-logos.mjs [--only slug,slug] [--out ~/eno-school-logos] [--concurrency 6]
 *
 * For every school with a website in data/schools/hcmc.json it opens the homepage in headless Chromium and:
 *   1. finds the header logo the way a person would — an <img>/<svg>/logo element near the top-left, inside
 *      the header or the link home, named "logo"/"brand" — and takes an ELEMENT SCREENSHOT of it at 2x.
 *      A screenshot, not the file behind it: it works the same for <img>, inline <svg> and CSS-background
 *      logos, and ⛔ it means no third-party SVG ever reaches eno.vn's origin (an SVG can carry script;
 *      see memory "never strip hostile SVG — refuse it"). Only raster images leave this script.
 *   2. downloads the site's square app icon (apple-touch-icon / the largest <link rel=icon>), the mark the
 *      school itself uses where a wide wordmark would not fit.
 * Anything covering the logo (a cookie bar, a pop-up) is hidden first, so the capture is the logo itself.
 *
 * Where the automatic pick was wrong, data/schools/logo-overrides.json says what a person decided after
 * looking at the site: an exact `selector`, the school's own logo file (`url`, + an optional `crop`), its
 * square app icon (`use: "icon"`), or — for sites that refuse automated browsers — its favicon through
 * Google's favicon service (`use: "favicon"`, kept only at >= 64px).
 * ⛔ Every downloaded file is checked by its MAGIC BYTES and must be PNG/JPEG/GIF/WebP/AVIF. An SVG (a logo
 * file or an icon) or an ICO is drawn inside an <img> (where an SVG cannot run script) and only the PNG
 * screenshot is kept.
 *
 * Output (outside the repo): <out>/raw/<slug>.<ext>, <out>/raw/<slug>-icon.png, <out>/results.json (merged
 * per slug, so `--only` re-runs a few without forgetting the rest). scripts/build-school-logos.mjs turns the
 * reviewed captures into public/schools/logos + the manifest.
 */
import { chromium } from 'playwright'
import sharp from 'sharp'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const OUT = (arg('out', join(homedir(), 'eno-school-logos'))).replace(/^~/, homedir())
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const CONCURRENCY = Number(arg('concurrency', '6'))
mkdirSync(join(OUT, 'raw'), { recursive: true })

const schools = JSON.parse(readFileSync(join(process.cwd(), 'data/schools/hcmc.json'), 'utf8')).schools
  .filter((s) => s.website && (!ONLY.length || ONLY.includes(s.slug)))
const OVERRIDES = JSON.parse(readFileSync(join(process.cwd(), 'data/schools/logo-overrides.json'), 'utf8'))

// A browser's UA, so a site serves its normal page, with our name on the end — and no attempt to hide that this
// is automated: a site that refuses it gets an override (its logo file, its icon, or none), never a workaround.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 eno.vn-logo-harvest (+https://eno.vn/schools)'

/**
 * Runs in the page: mark the most logo-like element (or the first visible match of an override's exact
 * `selector`) with data-eno-logo, hide what covers it, return facts.
 */
function pickLogo(selector) {
  const vis = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return r.width >= 12 && r.height >= 10 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.2 && r.bottom > 0 && r.top < 400
  }
  const text = (el) => [el.getAttribute('src'), el.getAttribute('alt'), el.getAttribute('class')?.toString(), el.id,
    el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-src'),
    el.closest('a')?.getAttribute('class'), el.closest('a')?.getAttribute('aria-label'), el.closest('a')?.getAttribute('title'),
    el.parentElement?.getAttribute('class')?.toString(), el.parentElement?.id].filter(Boolean).join(' ').toLowerCase()
  const home = (el) => {
    const a = el.closest('a'); if (!a || !a.href) return false
    const raw = (a.getAttribute('href') || '').trim()
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return false // "#" resolves to "/" but is not the home link
    try { const u = new URL(a.href, location.href); return u.host.replace(/^www\./, '') === location.host.replace(/^www\./, '') && /^\/((vi|en|vn|vi-vn|en-us)\/?)?(index\.(html|php))?$/i.test(u.pathname) } catch { return false }
  }
  const inHeader = (el) => !!el.closest('header, nav, [class*="header" i], [id*="header" i], [class*="navbar" i], [class*="top-bar" i], [class*="topbar" i]')
  const bgImage = (el) => { const b = getComputedStyle(el).backgroundImage; return b && b !== 'none' && b.includes('url(') }
  if (selector) {
    const el = [...document.querySelectorAll(selector)].find(vis)
    if (!el) return { found: false, selector }
    return mark({ el, s: 99, tag: el.tagName.toLowerCase() })
  }
  const els = [...document.querySelectorAll('img, svg, picture, [class*="logo" i], [id*="logo" i], a[href]')]
  const seen = new Set()
  const scored = []
  for (const el of els) {
    if (seen.has(el) || !vis(el)) continue
    seen.add(el)
    const tag = el.tagName.toLowerCase()
    if (tag === 'a' && !home(el)) continue
    if (tag === 'svg' && el.closest('svg') !== el) continue // the outer svg only
    const r = el.getBoundingClientRect()
    const t = text(el)
    let s = 0
    if (/logo|brand/.test(t)) s += 6
    if (inHeader(el)) s += 3
    if (home(el)) s += 3
    if (r.top < 160) s += 2
    if (r.left < innerWidth * 0.45) s += 2
    if (r.width >= 40 && r.width <= 560 && r.height >= 18 && r.height <= 220) s += 2
    else s -= 5
    // ⛔ ONLY AN IMAGE IS A LOGO: a text link home ("Chương trình học" on ILA's menu) must never be captured.
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || bgImage(el)) s += 2
    else if (!el.querySelector('img, svg, picture')) continue
    if (tag === 'a') s -= 1 // the image inside it is the better capture
    if (/icon|menu|search|cart|flag|lang|social|facebook|zalo|youtube|tiktok|instagram|hotline|phone|mail|banner|slide|avatar|close|arrow|hamburger|toggle/.test(t)) s -= 6
    scored.push({ el, s, r, tag })
  }
  scored.sort((a, b) => b.s - a.s || a.r.top - b.r.top || a.r.left - b.r.left)
  let best = scored[0]
  if (!best || best.s < 4) return { found: false, top: scored.slice(0, 3).map((x) => ({ s: x.s, tag: x.tag })) }
  // A container with exactly one image inside: capture the image, not the padding around it.
  if (!['img', 'svg', 'picture'].includes(best.tag) && !bgImage(best.el)) {
    const inner = [...best.el.querySelectorAll('img, svg')].filter(vis)
    if (inner.length >= 1) { const el = inner[0]; best = { el, s: best.s, r: el.getBoundingClientRect(), tag: el.tagName.toLowerCase() } }
  }
  return mark(best)

  // Declared inside pickLogo on purpose: page.evaluate() ships only this function's own source.
  function mark(best) {
    best.el.setAttribute('data-eno-logo', '1')
    // Hide whatever sits on top of the logo's centre (cookie bars, pop-ups, sticky overlays) — up to 6 layers.
    for (let i = 0; i < 6; i++) {
      const r = best.el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!top || top === best.el || best.el.contains(top) || top.contains(best.el)) break
      top.style.setProperty('visibility', 'hidden', 'important')
    }
    const r = best.el.getBoundingClientRect()
    return { found: true, score: best.s, tag: best.tag, rect: { x: r.x, y: r.y, w: r.width, h: r.height } }
  }
}

/** Runs in the page: the largest square app icon the site declares. */
function pickIcon() {
  const links = [...document.querySelectorAll('link[rel~="icon" i], link[rel~="apple-touch-icon" i], link[rel~="apple-touch-icon-precomposed" i], link[rel="shortcut icon" i]')]
  const size = (l) => { const m = (l.getAttribute('sizes') || '').match(/(\d+)x(\d+)/); return m ? Number(m[1]) : (/apple-touch/i.test(l.rel) ? 180 : 32) }
  const best = links.map((l) => ({ href: l.href, size: size(l), apple: /apple-touch/i.test(l.rel) })).sort((a, b) => b.size - a.size || Number(b.apple) - Number(a.apple))[0]
  return best ?? null
}

/** The raster format of a file, by its magic bytes — null for anything else (⛔ SVG, HTML error pages, ICO). */
function rasterExt(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.toString('latin1', 4, 12) === 'ftypavif') return 'avif'
  return null
}

/**
 * Draw image bytes only a browser decodes (an SVG or ICO icon) inside an <img> and keep the pixels. An <img>
 * never runs an SVG's script, and only the PNG screenshot is written.
 */
async function rasterize(context, buf, outPath, cssPx = 256) {
  const mime = buf.toString('latin1', 0, 4) === '\0\0\x01\0' ? 'image/x-icon' : 'image/svg+xml'
  const page = await context.newPage()
  try {
    await page.setContent(`<body style="margin:0;background:transparent"><img id="i" style="display:block;width:${cssPx}px;height:auto" src="data:${mime};base64,${buf.toString('base64')}"></body>`)
    await page.waitForFunction(() => { const i = document.getElementById('i'); return i.complete && i.naturalWidth > 0 }, null, { timeout: 10000 })
    await page.locator('#i').screenshot({ path: outPath, omitBackground: true })
  } finally {
    await page.close()
  }
}

const isSvg = (buf) => { const head = buf.toString('utf8', 0, 4096); return /<svg[\s>]/i.test(head) && !/<html[\s>]/i.test(head) }

/** Fetch an image with the school's site as referer; keep a raster file as it is, draw an SVG to PNG. */
async function download(context, url, referer, outBase) {
  const r = await context.request.get(url, { headers: { referer }, timeout: 20000 })
  if (!r.ok()) throw new Error(`HTTP ${r.status()} for ${url}`)
  const buf = await r.body()
  const name = outBase.split('/').pop()
  const ext = rasterExt(buf)
  if (ext) { writeFileSync(`${outBase}.${ext}`, buf); return `${name}.${ext}` }
  if (isSvg(buf)) { await rasterize(context, buf, `${outBase}.png`, 400); return `${name}.png` }
  throw new Error(`not an image: ${url}`)
}

async function saveIcon(context, href, slug) {
  const r = await context.request.get(href, { timeout: 15000 })
  if (!r.ok()) return null
  const buf = await r.body()
  const ext = rasterExt(buf)
  if (ext) { writeFileSync(join(OUT, 'raw', `${slug}-icon.${ext}`), buf); return `${slug}-icon.${ext}` }
  await rasterize(context, buf, join(OUT, 'raw', `${slug}-icon.png`))
  return `${slug}-icon.png`
}

/**
 * An element screenshot waits for the element to be stable and for web fonts; a site whose carousel never
 * settles or whose font never loads times it out. Fall back to a raw CDP capture of the same rectangle.
 */
async function shoot(page, rect, path) {
  try {
    await page.locator('[data-eno-logo="1"]').first().screenshot({ path, timeout: 10000 })
  } catch {
    const cdp = await page.context().newCDPSession(page)
    // The clip is in CSS pixels and comes back at 1x (measured); scale 2 matches the element screenshots.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 } })
    writeFileSync(path, Buffer.from(data, 'base64'))
  }
}

/** The parts of an override that decide WHICH file is captured — recorded so the build can refuse a stale one. */
const sourceOf = (o) => ({ url: o.url ?? null, selector: o.selector ?? null, use: o.use ?? null })

async function harvest(context, s) {
  const o = OVERRIDES[s.slug] ?? {}
  const res = { slug: s.slug, website: s.website, override: sourceOf(o) }
  if (o.use === 'none') return { ...res, source: 'none' }
  if (o.use === 'favicon') {
    // The site refuses automated browsers: take the icon Google's crawler already fetched from it.
    try {
      const origin = new URL(s.website).origin
      const file = await download(context, `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=256`, 'https://www.google.com/', join(OUT, 'raw', s.slug))
      const { width: w = 0 } = await sharp(readFileSync(join(OUT, 'raw', file)), { pages: 1 }).metadata()
      if (w < 64) throw new Error(`favicon is ${w}px, under the 64px floor`)
      res.logoFile = file
      res.source = 'favicon'
    } catch (e) {
      res.error = String(e).slice(0, 200)
    }
    return res
  }
  if (o.url) {
    try {
      res.logoFile = await download(context, o.url, s.website, join(OUT, 'raw', s.slug))
      res.source = 'url'
    } catch (e) {
      res.error = String(e).slice(0, 200)
    }
    return res
  }
  const page = await context.newPage()
  try {
    await page.goto(s.website, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(o.wait ?? 2500)
    await page.evaluate(() => window.scrollTo(0, 0))
    res.finalUrl = page.url()
    const icon = await page.evaluate(pickIcon)
    if (icon?.href && icon.size >= 96) {
      const file = await saveIcon(context, icon.href, s.slug).catch(() => null)
      if (file) res.icon = { href: icon.href, size: icon.size, file }
    }
    if (o.use === 'icon') {
      if (!res.icon) throw new Error('override says use the icon, and the site declares none >= 96px')
      res.logoFile = res.icon.file
      res.source = 'icon'
    } else {
      const pick = await page.evaluate(pickLogo, o.selector ?? null)
      res.logo = pick
      if (pick.found) {
        await shoot(page, pick.rect, join(OUT, 'raw', `${s.slug}.png`))
        res.logoFile = `${s.slug}.png`
        res.source = o.selector ? 'selector' : 'header'
      }
    }
  } catch (e) {
    res.error = String(e).slice(0, 200)
  } finally {
    await page.close()
  }
  return res
}

const browser = await chromium.launch()
const results = []
let next = 0
async function worker() {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', ignoreHTTPSErrors: true })
  while (next < schools.length) {
    const s = schools[next++]
    const r = await harvest(context, s)
    results.push(r)
    process.stdout.write(`${r.logoFile ? '✓' : '·'}${r.icon ? 'i' : ' '} ${s.slug}${r.source && r.source !== 'header' ? ` (${r.source})` : ''}${r.error ? `  ✗ ${r.error.slice(0, 80)}` : ''}\n`)
  }
  await context.close()
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
await browser.close()
// Merge per slug, so a `--only` re-run replaces just its own entries.
const file = join(OUT, 'results.json')
const merged = new Map((existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []).map((r) => [r.slug, r]))
for (const r of results) merged.set(r.slug, r)
const all = [...merged.values()].sort((a, b) => a.slug.localeCompare(b.slug))
writeFileSync(file, JSON.stringify(all, null, 2))
const ok = results.filter((r) => r.logoFile).length
console.log(`\n${ok}/${results.length} logos this run · ${all.filter((r) => r.logoFile || r.logo?.found).length}/${all.length} overall · ${OUT}`)
