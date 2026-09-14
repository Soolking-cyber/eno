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
 * ⛔ THE SET IS CERTIFIED AS A SET, IN manifest.json. Each capture overwrites one file in a shared directory, so a run
 * that fails halfway leaves NEW files beside STALE ones and play-frames.mjs would happily frame the mix — including a
 * pre-guard screenshot from before any of this existed (astra, opus). The manifest is written only when every shot has
 * passed, and carries each file's sha256; framing refuses anything it does not vouch for.
 */
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const OUT = process.env.OUT || 'play-store-assets/raw'
const BASE = process.env.BASE || 'https://eno.vn'
mkdirSync(OUT, { recursive: true })

const shots = [
  { name: 'home', path: '/', expectTitle: /eno\.vn/i, requireBanner: true },
  { name: 'home-feed', path: '/', scrollTo: '#listings', scrollExtra: 330, expectTitle: /eno\.vn/i }, // the grid filling the screen
  { name: 'product', path: '/listings/cmt7e74xd06z12wq4bx4u6npy', expectTitle: /iPhone 17 Pro Max/i }, // CellphoneS
  { name: 'storefront', path: '/sellers/cmt78nvif0000gpq48kvzmxjw', expectTitle: /CellphoneS/i },
]

// A stale manifest must not outlive a failed run: it is the certificate for the files that are about to be replaced.
rmSync(`${OUT}/manifest.json`, { force: true })

const browser = await chromium.launch()
const newContext = () => browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1',
})

const manifest = { at: new Date().toISOString(), base: BASE, shots: {} }
try {
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
    // ⚠️ A 200 IS NOT THE PAGE YOU ASKED FOR. A sold listing redirects, an auth wall lands on /login, and a client-side
    // error renders 200 — all of which the status check passes (astra). The landed path and the document title are what
    // say the intended screen is on the glass.
    // ⛔ THE ORIGIN IS PART OF THE IDENTITY, NOT JUST THE PATH. Both editions serve the same marketplace at the same
    // paths, so a redirect to eno.forum lands on a matching pathname with a matching title — and the manifest would
    // then certify a SERVICES-edition capture as eno.vn, which is the one thing these images must never be (astra).
    // ⚠️ `www.` IS THE SAME SITE, and a canonical-host 301 is the normal shape of a production apex — comparing the raw
    // origins would fail all four shots on a redirect that changed nothing (opus). The EDITION is the boundary here.
    const site = (u) => new URL(u).host.replace(/^www\./, '')
    if (site(p.url()) !== site(BASE)) throw new Error(`${s.name}: landed on ${site(p.url())}, not ${site(BASE)} — a capture of the other edition is not a marketplace store image`)
    const landed = new URL(p.url()).pathname.replace(/\/+$/, '') || '/'
    if (landed !== s.path.replace(/\/+$/, '') && landed !== s.path) throw new Error(`${s.name}: redirected to ${p.url()} — pick another page`)
    await p.waitForTimeout(5000)
    // Belt and braces: a consent card that still shows is declined.
    const decline = p.getByRole('button', { name: /^(Decline|Từ chối)$/ })
    if (await decline.count()) { await decline.first().click().catch(() => {}); await p.waitForTimeout(600) }
    // The carousel's own pause control, first: a frozen embla cannot re-lay-out anything below.
    const pause = p.getByRole('button', { name: /^(Pause slideshow|Tạm dừng trình chiếu)$/ })
    if (await pause.count()) { await pause.first().click().catch(() => {}); await p.waitForTimeout(400) }
    /**
     * ⚠️ THE STYLE TAG GOES FIRST, because its `transform: none` is what pins the carousel; removing a slide while the
     * track is still translated leaves a different one under the clip box.
     * ⛔ AND IT MUST PIN THE SLIDES AS WELL AS THE TRACK — the rule used to name only `[data-slot="carousel-content"] > *`
     * (the embla track) and that is how 01-home shipped with a BLANK WHITE BANNER (owner: "the first one is missing
     * banner"). Embla's loop does NOT only translate the track: it re-wraps individual slides by ±the track width, so
     * once autoplay had run, the pinned track showed a gap where a slide used to be while the artwork sat 776px to the
     * right — measured, x=12 at edit time and x=788 twenty seconds later, with the image loaded the whole time.
     */
    await p.addStyleTag({ content: `
      #prelaunch-banner, [data-sonner-toaster] { display: none !important; }
      [data-slot="carousel-content"] > *, [data-slot="carousel-item"] { transform: none !important; transition: none !important; }
      button[aria-label*="Help" i], button[aria-label*="Support" i], button[aria-label*="Hỗ trợ" i] { visibility: hidden !important; }
    ` })
    /**
     * ⛔ REMOVING A VISA SLIDE PROMOTES A SLIDE WHOSE ART WAS NEVER FETCHED, and that is how 01-home shipped with a
     * BLANK WHITE BANNER (owner, 2026-09-14: "the first one is missing banner"). promo-banner.tsx renders slide 0's
     * <img> eagerly and every later slide `loading="lazy"` behind an `artReady` gate — so whichever slide the removal
     * leaves in front may be an <img> with a src and nothing decoded. Un-inert it, promote it to an eager fetch, and
     * below, WAIT for it: `requireBanner` turns a blank panel from a silently passing run into a failed one.
     */
    await p.evaluate(() => {
      for (const item of document.querySelectorAll('[data-slot="carousel-item"]')) {
        const text = `${item.textContent || ''} ${[...item.querySelectorAll('img')].map((i) => i.alt).join(' ')} ${item.querySelector('a')?.getAttribute('href') || ''}`
        if (/visa|thị thực/i.test(text)) item.remove()
      }
      const first = document.querySelector('[data-slot="carousel-item"]')
      if (!first) return
      // `inert` is what promo-banner.tsx puts on every slide but the selected one; the selection index is now stale.
      first.removeAttribute('inert')
      first.removeAttribute('aria-hidden')
      for (const img of first.querySelectorAll('img')) {
        img.loading = 'eager'
        img.setAttribute('fetchpriority', 'high')
        // Re-assigning src is what actually starts a lazy image the layout has already positioned.
        if (!img.complete) img.src = img.src // eslint-disable-line no-self-assign
      }
    })
    if (s.scrollTo) {
      await p.evaluate(([sel, extra]) => { const el = document.querySelector(sel); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64 + extra, behavior: 'instant' }) }, [s.scrollTo, s.scrollExtra ?? 0])
      await p.waitForTimeout(2500)
    }
    // ⚠️ A STORE IMAGE OF BLANK TILES IS A PASSING RUN AND A WRONG PICTURE (opus). Lazy rows decode after the scroll, so
    // the capture waits for the images ON SCREEN to settle — and only those: a `loading="lazy"` slide sitting just past
    // the edge (the carousel's next banner) never loads at all, so waiting for the whole document is a guaranteed timeout.
    // ⚠️ THE TIMEOUT LIVES IN THE PAGE, not in a Promise.race here: a race leaves the evaluate pending, and it then
    // rejects with "Target closed" at ctx.close() — an unhandled rejection that kills the run mid-sweep (opus).
    await p.evaluate((ms) => new Promise((done) => {
      const pending = [...document.images].filter((i) => {
        const r = i.getBoundingClientRect()
        return !i.complete && r.width > 1 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
      })
      if (!pending.length) return done()
      let left = pending.length
      const tick = () => { if (--left === 0) done() }
      for (const i of pending) {
        i.addEventListener('load', tick, { once: true })
        i.addEventListener('error', tick, { once: true })
      }
      setTimeout(done, ms)
    }), 15000)
    await p.waitForTimeout(1200)
    const title = await p.title()
    if (!s.expectTitle.test(title)) throw new Error(`${s.name}: title ${JSON.stringify(title)} is not ${s.expectTitle} — wrong page`)

    const scan = () => p.evaluate(() => {
      const BANNED = /\b(e-?visas?|visas?|paypal|itinerar(?:y|ies))\b|\btrip planning\b|thị thực|lịch trình/i
      const vw = window.innerWidth
      const vh = window.innerHeight
      // width/height > 1 also drops the 1×1 clip of an sr-only label, which is text no viewer can read (opus).
      const onScreen = (r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
      // `visibility` is read on the ELEMENT ITSELF — it inherits, so a descendant that sets `visible` inside a hidden
      // wrapper computes to `visible` and IS on screen; walking up would have excluded it from every check (astra).
      // `opacity` is the one that genuinely suppresses a subtree from any ancestor, so that one is walked.
      const hidden = (el) => {
        if (getComputedStyle(el).visibility === 'hidden') return true
        for (let n = el; n instanceof Element; n = n.parentElement) {
          const s = getComputedStyle(n)
          if (s.display === 'none' || Number(s.opacity) === 0) return true
          // The sr-only shape: a 1×1 box with overflow hidden. A Range measures the TEXT's own layout box, which is full
          // width inside that clip, so the text alone looks on screen — screen-reader copy would fail every run (opus).
          const r = n.getBoundingClientRect()
          if ((r.width <= 1 || r.height <= 1) && s.overflow !== 'visible') return true
        }
        return false
      }
      const hits = []
      const broken = []
      // ⛔ THE STORE IMAGE MUST NOT SHOW A REGULATED SURFACE — CHECKED, NOT ASSUMED. Removing the carousel's visa slides
      // covers one known source; a visa LISTING in the feed or on a storefront is another (opus). The words are the
      // licensing boundary's own — visa, itinerary/trip planning, PayPal.
      // Read through the TEXT NODES, not element by element: a Range gives each run of text its own rect, so copy
      // scrolled out of view cannot trip the check the way a tall wrapper's box would, and the runs are joined per
      // block ancestor, so `Itin<span>erary</span>` is tested as one word (astra — both halves passed on their own).
      const isBlock = (el) => { const d = getComputedStyle(el).display; return !d.startsWith('inline') && d !== 'contents' }
      const buckets = new Map()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.data.trim() || !n.parentElement) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        if (!onScreen(range.getBoundingClientRect()) || hidden(n.parentElement)) continue
        let block = n.parentElement
        while (block.parentElement && !isBlock(block)) block = block.parentElement
        // ⛔ BOTH JOINS ARE TESTED, BECAUSE EITHER ONE ALONE HIDES A REAL HIT AND THE TWO FAILURES ARE OPPOSITE.
        // Concatenated, `Itin<span>erary</span>` reads as one word (which is why a space-join was wrong); but then two
        // ADJACENT runs glue — `<a>Hà Nội</a><a>Visa</a>` becomes "Hà NộiVisa" and `\bvisas?\b` no longer matches,
        // because the character before V is a word character (astra, opus, independently). Keep the runs and test the
        // glued string AND the spaced one; a word split across elements matches the first, a word beside another
        // element's text matches the second.
        const runs = buckets.get(block) || []
        runs.push(n.data)
        buckets.set(block, runs)
      }
      for (const [el, runs] of buckets) {
        const glued = runs.join('')
        if (!BANNED.test(glued) && !BANNED.test(runs.join(' '))) continue
        hits.push(`<${el.tagName.toLowerCase()}> ${glued.replace(/\s+/g, ' ').trim().slice(0, 70)}`)
      }
      for (const img of document.querySelectorAll('img')) {
        if (!onScreen(img.getBoundingClientRect()) || hidden(img)) continue
        const src = img.currentSrc || img.getAttribute('src') || ''
        // The FILE NAME is the signal, not the whole URI: a base64 data: URI is bytes, and its alphabet can spell any
        // banned word by accident (opus). Path only, and data: URIs are judged on their alt text alone.
        // ⚠️ AND THE QUERY COUNTS, because the optimiser puts the real file name THERE:
        // `/_next/image?url=%2Fbanners%2Fe-visa.webp&w=1080` has an innocent path and a visa banner in its query (astra).
        let named = src
        try {
          const u = new URL(src, location.href)
          named = src.startsWith('data:') ? '' : `${u.pathname} ${decodeURIComponent(u.search)}`
        } catch { named = src }
        if (BANNED.test(`${img.getAttribute('alt') || ''} ${named}`)) hits.push(`<img> ${(img.getAttribute('alt') || src).slice(0, 70)}`)
        // Broken means it FAILED, or it is half the picture and still has nothing to show. An image barely clipping the
        // edge — the carousel's next slide, which is lazy and never asked for — is neither, and failing on it would make
        // the run impossible to pass (measured: /banners/gmbr-mobile.webp, one pixel inside the viewport).
        const r = img.getBoundingClientRect()
        const seen = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0))
        // An <img> with NO src is not a broken image, it is a placeholder element — failing on it makes the run
        // unpassable without a page change (opus). A src that was requested and came back empty is the real failure.
        if (src && !img.naturalWidth && (img.complete || seen >= r.width * r.height * 0.5)) broken.push(src.slice(0, 70))
      }
      // An accessible name is content too: a control labelled "e-Visa" is a visa entry point on screen, however it looks.
      for (const el of document.querySelectorAll('[aria-label], [title]')) {
        if (!onScreen(el.getBoundingClientRect()) || hidden(el)) continue
        const text = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`
        if (BANNED.test(text)) hits.push(`<${el.tagName.toLowerCase()} label> ${text.trim().slice(0, 70)}`)
      }
      return { hits, broken }
    })
    // ⚠️ A "Visa" CARD BADGE TRIPS THIS TOO, DELIBERATELY (opus). The two senses cannot be told apart from the DOM, and
    // the cost is asymmetric: a false positive stops a run and asks a human to look, a false negative puts the word
    // "visa" on a licensed marketplace's store listing. There is no allowlist for that reason.
    const problems = await scan()
    if (problems.hits.length) throw new Error(`${s.name}: regulated-surface copy on screen — ${problems.hits.slice(0, 3).join(' | ')}`)
    // A slow CDN edge reads the same as a dead image here; both are a re-run, not a shipped screenshot of an empty tile.
    if (problems.broken.length) throw new Error(`${s.name}: ${problems.broken.length} image(s) did not load — ${problems.broken.slice(0, 2).join(' | ')}`)

    /**
     * ⚠️ THE BANNER GUARD ASKS WHAT IS UNDER THE CLIP BOX, NOT WHETHER AN IMAGE LOADED — and it runs HERE, a breath
     * before the shutter, because the failure it exists to catch appeared twenty seconds after the slide was verified
     * healthy. An earlier cut checked the first slide's images right after editing the DOM and passed while the banner
     * that reached the store was blank. `elementFromPoint` inside the carousel viewport is the only question that
     * matches what the camera sees. The probe sits at a quarter width so it lands on artwork, not on the dots.
     */
    const bannerPainted = () => p.evaluate(() => {
        const vp = document.querySelector('[data-slot="carousel-content"]')
        if (!vp) return false
        const r = vp.getBoundingClientRect()
        if (r.width < 10 || r.height < 10) return false
        const item = document.elementFromPoint(r.left + r.width * 0.25, r.top + r.height * 0.5)?.closest('[data-slot="carousel-item"]')
        if (!item) return false
        // ⚠️ "A LOADED IMAGE INSIDE THE ITEM" IS NOT "ARTWORK ON SCREEN" — an <img> at opacity 0 satisfies the first and
        // not the second, which is the blank panel this guard exists to fail on (astra). Painted, and covering the box.
        return [...item.querySelectorAll('img')].some((img) => {
          if (!img.complete || !img.naturalWidth) return false
          for (let n = img; n instanceof Element; n = n.parentElement) {
            const s = getComputedStyle(n)
            if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.9) return false
          }
          const b = img.getBoundingClientRect()
          const covered = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)) * Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top))
          return covered >= r.width * r.height * 0.5
        })
    })
    const noBanner = `no loaded promo artwork under the carousel's clip box — a store image of an empty white panel is not a store image`
    if (s.requireBanner) {
      const deadline = Date.now() + 30000
      // A plain poll rather than waitForFunction: the SAME predicate has to run again after the shutter (below), and one
      // function that returns a boolean is what makes that possible.
      while (!(await bannerPainted())) {
        if (Date.now() > deadline) throw new Error(`${s.name}: ${noBanner}`)
        await p.waitForTimeout(500)
      }
    }

    // ⚠️ THE IDENTITY CHECK ABOVE RAN BEFORE FIVE SECONDS OF CLIENT-SIDE LIFE. A soft navigation — a router push, a
    // client redirect to the other edition — moves the page without a document load, and the pre-flight check cannot
    // see it (astra). Asked again with the shot about to be taken, against the page that is actually on the glass.
    if (site(p.url()) !== site(BASE)) throw new Error(`${s.name}: page moved to ${site(p.url())} before the shot — not a ${site(BASE)} store image`)

    const file = `${OUT}/${s.name}.png`
    await p.screenshot({ path: file })
    // The check ran against the DOM, the hash is taken of the PIXELS, and a feed can re-render in between (astra). So the
    // same scan runs once more against the page the shot was taken of; a hit now discards the file instead of certifying it.
    const after = await scan()
    if (after.hits.length) { rmSync(file, { force: true }); throw new Error(`${s.name}: regulated-surface copy appeared during capture — ${after.hits.slice(0, 3).join(' | ')}`) }
    // The same applies to an image that died between the two scans — the shot has the empty tile in it either way (astra).
    if (after.broken.length) { rmSync(file, { force: true }); throw new Error(`${s.name}: ${after.broken.length} image(s) failed during capture — ${after.broken.slice(0, 2).join(' | ')}`) }
    // ⚠️ AND THE BANNER IS RE-ASKED TOO, for the same reason the other two are: the failure this guard exists for is a
    // slide that drifts out of the clip box SECONDS after it verified healthy, which a text/image scan cannot see (opus).
    if (s.requireBanner && !(await bannerPainted())) { rmSync(file, { force: true }); throw new Error(`${s.name}: ${noBanner}`) }
    manifest.shots[s.name] = createHash('sha256').update(readFileSync(file)).digest('hex')
    console.log('wrote', file, '—', title)
    await ctx.close()
  }
  // Last, and only on a clean sweep: the set is what is certified, never an individual file.
  writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
} finally {
  await browser.close()
}
