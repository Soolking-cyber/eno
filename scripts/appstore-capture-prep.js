/**
 * In-page half of scripts/appstore-capture.sh — injected into the app's WKWebView on the simulator
 * through scripts/ios-sim-inspect.py. Defines `window.__enoCapture`:
 *
 *   act(name)  — the screen-specific interaction (open a category, switch to the map, scroll to a
 *                section). It ASSERTS what it did: a missing control is an error, never a silent no-op,
 *                so a renamed button cannot certify the home page under the caption "see them on a map".
 *   prep()     — answers the consent card, quiets prompts, hides transient chrome, blanks live counts,
 *                waits for the on-screen images, then scans. Verdict on `window.__enoCapture.result`
 *                (WebKit's inspector does not await promises, so the driver polls).
 *   rescan()   — the same scan again, run by the driver AFTER the shutter: the DOM can change between the
 *                scan and the screenshot (a carousel, a late prompt), and a shot is certified only if the
 *                page it was taken of still passes.
 *
 * ⛔ THE SCAN IS THE SAME BOUNDARY AS scripts/play-capture.mjs, PLUS THE SECOND-HAND FOCUS: no e-Visa /
 * itinerary / PayPal surface, no CellphoneS (new goods, retired 2026-10-03), no "official partner" claim.
 * A hit fails the shot; there is no allowlist. It reads TEXT NODES joined per block, like play-capture —
 * a leaf-element walk missed a label sitting beside an icon (`<a>e-Visa <svg/></a>`), which is the most
 * common link shape in this UI (reviewers, 2026-10-04).
 * ⚠️ WHAT IT CANNOT SEE: text painted into an image or a canvas, native iOS alerts (they are outside
 * the DOM), iframes and shadow roots, and look-alike letters from other scripts (a Cyrillic "і" in
 * "Vіsa"). Look at the framed set before uploading it.
 * ⚠️ "New" IS DELIBERATELY NOT A BANNED WORD: ward names since the 2025 merger read "Tân Hòa Ward (new)",
 * which a text scan cannot tell from a condition badge.
 */
;(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text)
  const onScreenRect = (r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  const onScreen = (e) => onScreenRect(e.getBoundingClientRect())
  const must = (el, what) => { if (!el) throw new Error(`no ${what} on this screen`); return el }
  /** At least `n` listing cards actually on screen — a "not found" or emptied page has none. */
  const cards = (n) => {
    const shown = [...document.querySelectorAll('a[data-card-link]')].filter(onScreen).length
    if (shown < n) throw new Error(`${shown} listing card(s) on screen, expected at least ${n}`)
  }
  const heading = (re, what) => must([...document.querySelectorAll('h1,h2')].find((e) => re.test(e.textContent || '') && onScreen(e)), what)

  /**
   * ⛔ EVERY SHOT HAS AN ENTRY, AND EACH ONE PROVES ITS SCREEN. An unknown name throws, and a page that
   * kept its pathname but lost its content (a sold listing, an emptied shop, an error state) fails
   * here instead of being certified under a caption that describes something else (reviewers).
   */
  const ACTIONS = {
    '01-home': async () => {
      must(byText('a,button', 'Rentals'), 'Rentals tile')
      cards(4)
    },
    // Rentals → Apartment → map view: the pins carry prices, and no listing photo (several imported
    // rental photos carry the source site's watermark) is on screen.
    '02-rentals-map': async () => {
      must(byText('a,button', 'Rentals'), 'Rentals tile').click()
      await sleep(4000)
      must(byText('a,button', 'Apartment'), 'Apartment chip').click()
      await sleep(4000)
      must(document.querySelector('[aria-label="Map view"]'), 'Map view toggle').click()
      await sleep(6000)
      const map = must(document.querySelector('.leaflet-container'), 'map')
      if (!onScreen(map)) throw new Error('the map is not on screen')
      // A Leaflet divIcon is a 0×0 anchor whose label overflows it (measured), so test the anchor POINT
      // against the viewport rather than the box, and require the label to carry a number.
      const pins = [...document.querySelectorAll('.leaflet-marker-icon')].filter((m) => {
        const r = m.getBoundingClientRect()
        return r.left >= 0 && r.left <= innerWidth && r.top >= 0 && r.top <= innerHeight && /\d/.test(m.textContent || '')
      })
      if (pins.length < 3) throw new Error(`${pins.length} numbered pin(s) on screen, expected at least 3`)
      // The reason this shot is a map (see the 02 row in appstore-capture.sh): no listing photo may be
      // on screen — some imported rental photos carry the source site's watermark (opus, review).
      const photo = [...document.querySelectorAll('a[href*="/listings/"] img')].find((i) => onScreen(i))
      if (photo) throw new Error('a listing photo is on screen over the map')
    },
    // The SEO landing page opens with prose; the store image is the grid under "available now".
    '03-motorbike': async () => {
      const h = must([...document.querySelectorAll('h2,h3')].find((e) => /available now/i.test(e.textContent)), '"available now" heading')
      window.scrollTo({ top: h.getBoundingClientRect().top + scrollY - 90, behavior: 'instant' })
      await sleep(3000)
      cards(4)
    },
    '04-jobs': async () => {
      heading(/^Jobs in Vietnam$/, '"Jobs in Vietnam" heading')
      cards(2)
    },
    // A used item: its title, a price in đồng, and the source shop's button — a sold or removed
    // listing renders none of these.
    '05-item': async () => {
      heading(/Samsung Galaxy Z Fold7/i, 'listing title')
      // The price block: "27,990,000 đ" with the "≈ $1,092" reference inside the SAME span (measured on
      // the live PDP), the amount and the "đ" in separate child spans.
      must([...document.querySelectorAll('body *')].find((e) => /^[\d.,]+\s*đ\s*≈\s*\$[\d.,]+$/.test((e.textContent || '').trim()) && onScreen(e)), 'price in đồng with the dollar reference')
      must([...document.querySelectorAll('a')].find((a) => /^Buy on /.test((a.textContent || '').trim()) && onScreen(a)), '"Buy on …" button')
    },
    '06-shop': async () => {
      heading(/Minh Tuấn Mobile/, 'shop name')
      cards(2)
    },
  }

  /**
   * ⛔ THE 60-SECOND "Join eno" PROMPT LANDED IN EVERY FRAME OF THE FIRST RUN — a capture spends over a
   * minute in one session, which is exactly the prompt's trigger (src/lib/signup-prompt.ts). Mark the
   * device as one where someone has signed in (`member`), the state in which the prompt never asks, and
   * close it if it is already up. Runs on injection AND in prep; the scan fails any open layer anyway.
   */
  function quietPrompts() {
    try { localStorage.setItem('eno:signup-prompt', JSON.stringify({ dismissals: 0, pausedUntil: 0, lastShownAt: 0, member: true, methodAt: 0 })) } catch { /* storage blocked */ }
    // `member` only stops the NEXT ask. A prompt already up (a cold-booted simulator's inspector can take
    // over a minute to attach — measured 2026-10-04) is closed through its own named close button, the
    // tap a person makes; the dialog may swallow a press in its first moment, so every retry re-runs this.
    document.querySelectorAll('[role="dialog"][data-open],[role="dialog"][data-state="open"],[aria-modal="true"]').forEach((d) => {
      if (!/Join eno|Tham gia eno/.test(d.textContent || '')) return
      const x = d.querySelector('button[aria-label="Close"],button[aria-label="Đóng"]')
      if (x) x.click()
    })
  }
  quietPrompts()

  /** Every floating layer that is open and on screen — Base UI's data-open, the other open-state spellings, native <dialog>. */
  const openLayers = () => [...document.querySelectorAll(
    '[role="dialog"][data-open],[role="alertdialog"][data-open],[role="dialog"][data-state="open"],[aria-modal="true"],dialog[open],' +
    // Menus, listboxes and popovers float too (Base UI marks every popup open with data-open).
    '[role="menu"][data-open],[role="listbox"][data-open],[data-popup-open][role],[popover]:popover-open',
  )].filter((d) => onScreen(d) && getComputedStyle(d).visibility !== 'hidden')

  function scan() {
    const BANNED = /\b(e-?visas?|visas?|pay ?pal|itinerar(?:y|ies)|trip plann(?:ing|er)|plan (?:a|your) trip|my trips|cell ?phones|official partner)\b|thị thực|lịch trình|đối tác chính thức/i
    // Fold look-alikes before testing: NFKC, every Unicode dash to '-', no zero-width characters.
    const norm = (t) => String(t).normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u200b-\u200d\ufeff]/g, '')
    const banned = (t) => BANNED.test(norm(t))
    const hidden = (el) => {
      for (let n = el; n instanceof Element; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true
      }
      return false
    }
    const isBlock = (el) => { const d = getComputedStyle(el).display; return !d.startsWith('inline') && d !== 'contents' }
    const buckets = new Map()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim() || !n.parentElement) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      if (!onScreenRect(range.getBoundingClientRect()) || hidden(n.parentElement)) continue
      let block = n.parentElement
      while (block.parentElement && !isBlock(block)) block = block.parentElement
      const runs = buckets.get(block) || []
      runs.push(n.data)
      buckets.set(block, runs)
    }
    const hits = []
    // Both joins, as in play-capture: glued catches `Vi<span>sa</span>`, spaced catches `Hà Nội<a>Visa</a>`.
    for (const runs of buckets.values()) {
      const glued = runs.join('')
      if (banned(glued) || banned(runs.join(' '))) hits.push(glued.replace(/\s+/g, ' ').trim().slice(0, 70))
    }
    // Text that is on screen without being a text node: labels, placeholders, typed values, SVG titles,
    // and CSS-generated ::before / ::after content.
    for (const e of document.querySelectorAll('[aria-label],[title],img[alt],[placeholder],input,textarea,svg title')) {
      const box = e.tagName.toLowerCase() === 'title' ? e.parentElement : e
      if (!box || !onScreen(box) || hidden(box)) continue
      const t = `${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''} ${e.getAttribute('alt') || ''} ${e.getAttribute('placeholder') || ''} ${'value' in e ? e.value : ''} ${e.tagName.toLowerCase() === 'title' ? e.textContent : ''}`
      if (banned(t)) hits.push(t.trim().slice(0, 70))
    }
    for (const e of document.querySelectorAll('body *')) {
      if (!onScreen(e)) continue
      for (const pseudo of ['::before', '::after']) {
        const c = getComputedStyle(e, pseudo).content
        if (c && c !== 'none' && c !== 'normal' && banned(c)) hits.push(`${pseudo} ${c.slice(0, 60)}`)
      }
    }
    const shown = [...document.images].filter((i) => onScreen(i) && !hidden(i))
    return {
      href: location.href,
      platform: window.Capacitor?.getPlatform?.() ?? null,
      nativeIos: document.documentElement.classList.contains('native-ios'),
      images: shown.length,
      // A requested image that failed, AND one still loading when the wait ran out — both are blank tiles.
      // …and a visible <img> with no source at all, which renders as the same blank tile (review, 2026-10-04).
      broken: shown.filter((i) => !(i.currentSrc || i.src) || !i.complete || !i.naturalWidth).map((i) => (i.currentSrc || i.src || '(no src)').slice(0, 90)),
      hits: hits.slice(0, 8),
      // A layout wider than the viewport makes WebKit zoom the whole page out — invisible in a screenshot.
      fits: innerWidth === document.documentElement.scrollWidth,
      // Anything floating over the screen (a prompt, a sheet) is not the screen the caption names.
      dialogs: openLayers().map((d) => (d.getAttribute('aria-label') || d.textContent || '').trim().slice(0, 60)),
    }
  }

  async function prep() {
    quietPrompts()
    const no = [...document.querySelectorAll('button')].find((b) => /^(No thanks|Không, cảm ơn)/.test(b.textContent.trim()))
    if (no) { no.click(); await sleep(600) }
    // ⚠️ THE SIGN-IN DIALOG IGNORES PRESSES FOR A MOMENT AFTER IT OPENS (sign-in-dialog.tsx: "Only presses: Esc
    // is a deliberate key and still closes at once"), so one Close click right after a late 60-second prompt is
    // swallowed and the scan fails the shot (measured 2026-10-04 at load 300). Escape, then Close, until no
    // layer is open — bounded; a layer that will not close still fails the scan below.
    for (let i = 0; i < 8 && openLayers().length; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      for (const d of openLayers()) d.querySelector('button[aria-label="Close" i],button[aria-label="Đóng" i]')?.click()
      await sleep(700)
    }
    if (!document.getElementById('eno-capture-style')) {
      const st = document.createElement('style')
      st.id = 'eno-capture-style'
      st.textContent = '[data-sonner-toaster]{display:none!important} button[aria-label*="Help" i],button[aria-label*="Support" i],button[aria-label*="Hỗ trợ" i]{visibility:hidden!important}'
      document.head.appendChild(st)
    }
    // A live tally dates the screenshot the day it is taken: blank "N listings" / "Showing N of M listings."
    for (const e of document.querySelectorAll('body *')) {
      if (e.children.length === 0 && /^((Found|Showing)\s+)?([\d.,]+\s+of\s+)?[\d.,]+\s+(listings?|tin đăng|kết quả)\.?$/i.test(e.textContent.trim())) e.style.visibility = 'hidden'
    }
    const vis = [...document.images].filter(onScreen)
    await Promise.race([
      Promise.all(vis.map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r) })))),
      sleep(15000),
    ])
    return scan()
  }

  window.__enoCapture = {
    result: null,
    acted: null,
    acting: null,
    act(name) {
      // ⛔ ONCE PER SHOT. inspect() re-sends an expression when the inspector times out, which under load can
      // be AFTER the page already ran it: a second act() would click the Apartment chip off or the map toggle
      // back to the list and still report success (review, 2026-10-04). A repeat of a running or finished
      // action is a no-op.
      if (this.acting === name || this.acted === name || String(this.acted).startsWith('error:')) return 'already'
      this.acted = null
      this.acting = name
      const a = ACTIONS[name] || (async () => { throw new Error(`no screen action named ${name} — add one`) })
      a().then(() => { this.acted = name }, (e) => { this.acted = `error: ${e && e.message}` }).finally(() => { this.acting = null })
      return 'acting'
    },
    prep() { this.result = null; prep().then((r) => { this.result = r }, (e) => { this.result = { error: String(e) } }); return 'prepping' },
    // ⛔ SCAN FIRST, THEN QUIET: this certifies the frame the shutter just took. Closing a late prompt before
    // looking removed the evidence and certified a frame that showed it (review, 2026-10-04).
    rescan() { const r = scan(); quietPrompts(); return JSON.stringify(r) },
  }
  return 'ready'
})()
