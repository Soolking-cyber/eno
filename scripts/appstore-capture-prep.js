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
 * itinerary / PayPal surface, no CellphoneS (new goods, retired 2026-10-03), no "official partner" claim —
 * except the badge ON A LISTING CARD (owner, 2026-11-24: "partner badge is ok to show"; `cardBadge` in scan()).
 * A hit fails the shot; there is no other allowlist. It reads TEXT NODES joined per block, like play-capture —
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
    // An apartment its owner posted (not an agency or a partner shop): the title, the monthly rent in đồng with the
    // dollar reference, and the Chat button — a let or removed listing renders none of these.
    '01-apartment': async () => {
      heading(/The Antonia Phu My Hung/i, 'listing title')
      // The price block, measured on the live page: "45,000,000 đ / month≈ $1,755" in one span (the amount in a child span).
      must([...document.querySelectorAll('body *')].find((e) => /^[\d.,]+\s*đ\s*\/\s*month\s*≈\s*\$[\d.,]+$/.test((e.textContent || '').trim()) && onScreen(e)), 'the rent in đồng with the dollar reference')
      must([...document.querySelectorAll('a,button')].find((b) => /^Chat now$/.test((b.textContent || '').trim()) && onScreen(b)), '"Chat now" button')
    },
    // A district's rentals grid (Tay Ho, Hanoi), from the top: the title, the bedroom and area chips, two rows of
    // apartments with the rent in đồng and dollars. The cards carry the Official partner badge (allowed, owner 2026-11-24).
    // ⚠️ Look at the framed shot for a watermark painted into a photo before an upload (the scan cannot).
    '02-rentals': async () => {
      window.scrollTo({ top: 0, behavior: 'instant' })
      await sleep(2500)
      heading(/^Apartments & houses for rent in Tay Ho$/, 'the Tay Ho rentals title')
      cards(4)
    },
    // Rentals on the map, reached the way a person does — Home → Rentals → Map view. (A deep link to `/?…&view=map` from
    // Home changes the URL and leaves the Home page on screen: same route, so nothing re-renders — measured on a fresh
    // install.) The map first fits every pin in Vietnam — zoomed out to southern China, with the tiles' Chinese name
    // for the East Sea on screen — so the shot opens the busiest building's pin: the map zooms in (Thao Dien today)
    // and the building card shows its flats, photos and prices.
    // ⚠️ Those are listing photos: look at the framed shot for a watermark before an upload (the scan cannot).
    '03-map': async () => {
      const until = async (ok, what, s = 20) => { for (let i = 0; i < s; i++) { if (ok()) return; await sleep(1000) } throw new Error(`timed out waiting for ${what}`) }
      // Home's Rentals chip (a link to /c/rentals) opens, in the app, the listings view filtered to rentals
      // (`/?category=rentals`, measured), whose toggle is "Map view" — the category page's is "Map".
      must(byText('a,button', 'Rentals'), 'Rentals chip').click()
      const toggle = () => document.querySelector('[aria-label="Map view"]') || (location.pathname === '/c/rentals' && document.querySelector('button[aria-label="Map"]'))
      await until(() => location.pathname + location.search !== '/' && toggle(), 'the rentals listings')
      await sleep(1500)
      toggle().click()
      // The map is a lazy chunk plus its tiles: on a fresh install it took over 10 s to mount (measured).
      await until(() => document.querySelector('.leaflet-container .leaflet-marker-icon[title]'), 'the map and its pins', 30)
      await sleep(2000)
      const map = must(document.querySelector('.leaflet-container'), 'map')
      if (!onScreen(map)) throw new Error('the map is not on screen')
      const count = (m) => Number(/—\s*(\d+)\s+available/.exec(m.getAttribute('title') || '')?.[1] || 0)
      const pin = must([...document.querySelectorAll('.leaflet-marker-icon[title]')].sort((a, b) => count(b) - count(a))[0], 'a building pin')
      if (count(pin) < 5) throw new Error(`the busiest building pin has ${count(pin)} listing(s) — expected a building with several`)
      pin.click()
      await sleep(7000)
      must([...document.querySelectorAll('a,button')].find((b) => /^See all in this building$/.test((b.textContent || '').trim()) && onScreen(b)), 'the building card')
      // Each card's price reads "18,050,000 đ / month≈ $704" (measured); the innermost such element, once per card.
      const rent = /^[\d.,]{6,}\s*đ\s*\/\s*month/
      const prices = [...document.querySelectorAll('body *')].filter((e) => rent.test((e.textContent || '').trim()) && onScreen(e) && ![...e.children].some((c) => rent.test((c.textContent || '').trim())))
      if (prices.length < 2) throw new Error(`${prices.length} price(s) on the building card, expected at least 2`)
    },
    // The motorbike-rental page's grid, from its SECOND row: the first card's photo (a private listing) shows a shop's
    // signboard. Since 1.3 the native tab bar slides away while the page scrolls down, so the shot ends on a short
    // scroll UP, which brings it back.
    // ⚠️ The grid is live: look at the framed shot for a watermark or a shop sign before an upload.
    '04-motorbikes': async () => {
      const h = must([...document.querySelectorAll('h2,h3')].find((e) => /available now/i.test(e.textContent || '')), '"available now" heading')
      const cardsBelow = [...document.querySelectorAll('a[data-card-link]')].filter((a) => a.getBoundingClientRect().top > h.getBoundingClientRect().top)
      const distinct = []
      for (const a of cardsBelow) if (!distinct.some((x) => x.getAttribute('href') === a.getAttribute('href'))) distinct.push(a)
      if (distinct.length < 6) throw new Error(`${distinct.length} motorbike(s) in the grid, expected at least 6`)
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom || 0
      window.scrollTo({ top: distinct[2].getBoundingClientRect().top + scrollY - (headerBottom + 12) + 60, behavior: 'instant' })
      await sleep(1500)
      window.scrollBy({ top: -60, behavior: 'instant' })
      await sleep(2500)
      cards(4)
    },
    // Text-only cards by design (a job has no photo): the capture runs this shot with `text` (no image required).
    '05-jobs': async () => {
      // The h1 is visually hidden ("Jobs in Vietnam on eno.vn", measured); the title on screen is its visible twin.
      must([...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && /^Jobs in Vietnam$/.test((e.textContent || '').trim()) && onScreen(e)), '"Jobs in Vietnam" title')
      // Job cards are rows (`a[data-row-link]`), not photo cards (measured 2026-11-23).
      const rows = [...document.querySelectorAll('a[data-row-link][href*="/listings/"]')].filter(onScreen).length
      if (rows < 4) throw new Error(`${rows} job row(s) on screen, expected at least 4`)
    },
    // The teacher profile's first step (`text`: a form, no photo).
    '06-teacher': async () => {
      heading(/^Create your teacher profile$/, '"Create your teacher profile" heading')
      for (const city of ['Ho Chi Minh City', 'Hanoi', 'Da Nang']) must([...document.querySelectorAll('button,[role="radio"],label')].find((b) => (b.textContent || '').trim() === city && onScreen(b)), `${city} choice`)
    },
    // The posting form before anything is picked (`text` too: it shows the photo pickers, not photos).
    '07-post': async () => {
      heading(/^Create a listing$/, '"Create a listing" heading')
      for (const label of ['Electronics', 'Rentals', 'Jobs']) must([...document.querySelectorAll('button,[role="radio"],label')].find((b) => (b.textContent || '').trim() === label && onScreen(b)), `${label} category chip`)
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
    /**
     * ✅ OWNER DECISION 2026-11-24: "partner badge is ok to show". The Official partner badge (PartnerBadge,
     * `role="img"`, "Official partner" / "Đối tác chính thức") may appear ON A LISTING CARD — the green shield, or the
     * white plate on a wide card's photo. A card never shows the seller, so the badge names no shop; since the Terms it
     * marks only a company with a signed agreement. ONLY on a card: the nearest ancestor holding any card link (a photo
     * card's `a[data-card-link]` or a row's `a[data-row-link]`) must hold exactly ONE, i.e. the badge sits inside that one
     * card. The same words in a shop header, beside a seller's name on a listing page, or anywhere else still fail the
     * shot, and so does every other banned word. (Watermarks painted into photos were never visible to this scan —
     * look at the framed set.)
     */
    const CARD_LINK = 'a[data-card-link],a[data-row-link]'
    // …and its screen-reader twin: the card announces the badge in a visually hidden `.sr-only` span (listing-card.tsx),
    // which a text range still measures as on screen, though nothing of it is painted.
    const BADGE_WORDS = /^\s*(Official partner|Đối tác chính thức)\s*$/
    const cardBadge = (el) => {
      const b = el.closest('[role="img"][aria-label="Official partner"],[role="img"][aria-label="Đối tác chính thức"]')
        || (el.matches('.sr-only') && BADGE_WORDS.test(el.textContent || '') ? el : null)
      if (!b) return false
      for (let p = b.parentElement, i = 0; p && i < 14; p = p.parentElement, i++) {
        const n = p.querySelectorAll(CARD_LINK).length
        if (n) return n === 1
      }
      return false
    }
    const buckets = new Map()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim() || !n.parentElement) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      if (!onScreenRect(range.getBoundingClientRect()) || hidden(n.parentElement) || cardBadge(n.parentElement)) continue
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
      if (!box || !onScreen(box) || hidden(box) || cardBadge(box)) continue
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
