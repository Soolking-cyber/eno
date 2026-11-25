import type { Page } from '@playwright/test'
import { test, expect, dismissOverlays } from '../helpers'

/**
 * ⛔ THE APP CHROME OF THE 2026-11-14 REDESIGN (owner-approved, cook r05: "after this cook round build all best options
 * and deploy") — the geometry no unit test can see, in English and Vietnamese:
 *   · the tab bar is docked: full width, its bottom on the screen's, 56px + the inset; it retracts on scroll down and
 *     returns on scroll up;
 *   · the header: on a phone (round 13, owner 2026-11-17) a 40px grey tile of the 40px mark's shape, on the mark's top and
 *     bottom lines, inside a 44px tap box, the same on every route — no outline at rest, its whole box and a 2px ring while
 *     it types, one step up from the bar in dark, its magnifier a label for the field — and the route's own bell (quiet on
 *     home, ink elsewhere) with its glyph on the mark's 12px edge, its hit area on screen; a 40px pill and a 40px mark from
 *     sm, the fused window when open;
 *   · the page end: 24px from the last thing in <main> to the footer's hairline on a phone.
 * ⚠️ READ-ONLY: every non-GET request is aborted (analytics beacons are POSTs).
 */

const FOOTER_PAGES = ['/', '/c/rentals', '/brands', '/help', '/schools', '/developers']
const TILE = '#app-header form[role="search"] div.relative.z-50'
const BELL = '#app-header button[aria-label^="Notifications"], #app-header button[aria-label^="Thông báo"]'

/** The phone search tile's paint, read off the field box's ::before (`search-tile`; the 44px box itself is transparent). */
function tileLook(page: Page) {
  return page.locator(TILE).evaluate((el) => {
    const s = getComputedStyle(el, '::before')
    const probe = document.createElement('span')
    probe.style.color = 'var(--ring)'
    document.body.append(probe)
    const ring = getComputedStyle(probe).color
    probe.remove()
    return {
      top: s.top, bottom: s.bottom, radius: s.borderTopLeftRadius, fill: s.backgroundColor,
      outline: s.outlineStyle === 'none' ? 'none' : `${s.outlineStyle} ${s.outlineWidth}`, ringColour: s.outlineStyle !== 'none' && s.outlineColor === ring,
      shadow: getComputedStyle(el).boxShadow, rim: getComputedStyle(el).borderTopWidth,
    }
  })
}

async function open(page: Page, path: string, lang: 'en' | 'vi', baseURL: string | undefined) {
  await page.context().addCookies([{ name: 'lang', value: lang, url: baseURL ?? 'http://localhost:3000' }])
  // The browser's own language agrees with the cookie, so the app has no reason to reconcile it with one more navigation.
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang === 'vi' ? 'vi-VN,vi;q=0.9' : 'en-US,en;q=0.9' })
  await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
  await page.goto(path)
  // A Vietnamese visit can settle with one more navigation (seen: "execution context was destroyed" in vi only): wait for
  // the network to go quiet before measuring, bounded so a polling page cannot hang the test.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await dismissOverlays(page)
  await page.evaluate(() => document.fonts.ready)
  // The fit runs in a layout effect and again on a frame after fonts and resizes: let two frames pass.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

for (const lang of ['en', 'vi'] as const) {
  test.describe(`Guest · phone chrome (${lang})`, () => {
    // ⛔ THE BROWSER'S OWN LANGUAGE, not only the header (2026-11-25): with Accept-Language vi but navigator.language en-US (the
    // project default) the app reconciled to English and RELOADED the page ~1.6 s in, so every vi test raced a reload into an
    // English page ("execution context was destroyed", vi only). A real Vietnamese browser (vi-VN) loads once and stays vi. Not a
    // user state: the app reads navigator.languages, and a real Chrome derives it AND Accept-Language from one content-language
    // setting, so only a test that sets the header alone can split them.
    test.use({ locale: lang === 'vi' ? 'vi-VN' : 'en-US' })
    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'guest-mobile', 'phone chrome')
    })

    test('the tab bar is docked: full width, on the bottom edge, 56px + inset; it retracts and returns', async ({ page, baseURL }) => {
      await open(page, '/', lang, baseURL)
      const vp = page.viewportSize()!
      const nav = page.locator('nav.mobile-nav')
      const box = (await nav.boundingBox())!
      expect(Math.round(box.x)).toBe(0)
      expect(Math.round(box.width)).toBe(vp.width)
      expect(Math.round(box.y + box.height)).toBe(vp.height)
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(56)
      // A real page scroll, not mouse.wheel: in a touch context Playwright's synthetic wheel does not scroll the page
      // (see dropdown-scroll-dismiss.spec.ts), and the bar follows the scroll position.
      // useHideOnScroll ANCHORS on the first scroll frame and decides nothing there, so scroll in two steps a frame apart.
      // Steps a thumb makes, a frame apart: the hook skips a frame in which the page's height changed (lanes that load as
      // they come into view), so one big jump can land only on skipped frames.
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 150))
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      }
      await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
      // Back near the top (y < revealOffset) always brings the bar back.
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    })

    // ⛔ Round 13 (owner, 2026-11-17: "mobile top search bar is not in harmony with logo on left lets make sure it looks part
    // of app"): the field is a second tile of the mark's shape, the same on every route. The bell is NOT round 13's: it still
    // follows the route (header.tsx `quiet={homeRoute}`) — build 8's quiet 22px muted bell on home (owner-approved 2026-11-15),
    // r05's 24px ink bell everywhere else (2026-11-14).
    for (const path of ['/', '/c/rentals']) {
      const home = path === '/'

      test(`${path}: the search field is a 40px grey tile on the 40px mark's lines, no outline at rest; a tap rings it`, async ({ page, baseURL }) => {
        await open(page, path, lang, baseURL)
        const box = page.locator(TILE)
        const logo = (await page.locator('#app-header [data-header-logo] img').boundingBox())!
        const b = (await box.boundingBox())!
        expect([Math.round(logo.x), Math.round(logo.width), Math.round(logo.height)]).toEqual([12, 40, 40])
        // The 44px tap box, and the 40px tile painted 2px inside it: on the mark's top and bottom lines, 8px after it.
        expect(Math.round(b.height)).toBe(44)
        expect(Math.round(b.x - (logo.x + logo.width))).toBe(8)
        expect(Math.round(b.y + 2)).toBe(Math.round(logo.y))
        // At rest: the capsule, the field grey, no rim, no lift — and no outline (the ring is the typing state's alone).
        // Round 16 (owner 2026-11-24, away from squircles): the field is a capsule, its ::before radius 9999px (globals.css).
        expect(await tileLook(page)).toEqual({ top: '2px', bottom: '2px', radius: '9999px', fill: 'rgb(243, 243, 243)', outline: 'none', ringColour: false, shadow: 'none', rim: '0px' })
        // A tap types (on a phone: the open search, the mark stepped out): the tile fills its whole 44px box, inside a 2px ring
        // in the focus colour (--ring), so the Clear ✕ keeps 5px of grey all round.
        // ⛔ ONE tap, whenever it lands: a tap before hydration focuses the field natively, and the header then opens the search
        // at mount (header.tsx, 2026-11-25: it was 1 failure in 12 runs on prod, a real phone bug, not a flaky test).
        await page.locator('#app-header input[name="q"]').tap()
        await expect.poll(() => tileLook(page), { timeout: 15_000 }).toMatchObject({ top: '0px', bottom: '0px', outline: 'solid 2px', ringColour: true })
        // ⛔ Submitting closes the search with the field still focused: the tile goes back to 40px on the mark's lines (the 44px
        // fill follows the open search, never focus — review, 2026-11-17); the ring stays while it is focused.
        await page.locator('#app-header input[name="q"]').fill('iphone')
        await page.keyboard.press('Enter')
        await expect.poll(() => tileLook(page)).toMatchObject({ top: '2px', bottom: '2px' })
      })

      test(`${path}: dark — the tile is one step up from the bar (--secondary), flat, no outline at rest`, async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme: 'dark' })
        await open(page, path, lang, baseURL)
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
        // #303030 on the #1c1d1f bar: the tint (#262626) all but vanished there (both r13 judges).
        expect(await tileLook(page)).toMatchObject({ fill: 'rgb(48, 48, 48)', outline: 'none', shadow: 'none', rim: '0px' })
        expect(await page.locator('#app-header').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(28, 29, 31)')
      })

      test(`${path}: a tap on the magnifier's square types — the glyph is a label for the field`, async ({ page, baseURL }) => {
        await open(page, path, lang, baseURL)
        // Its centre is the 20px magnifier (the label is the tile's left end, full height).
        await page.locator('#app-header label[data-search-lead]').tap()
        await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('header-search-input')
        await expect(page.locator('#app-header form div.overflow-y-auto')).toBeVisible()
      })

      // ⚠️ WHAT THIS MEASURES IS THE GLYPH'S BOX, NOT ITS PAINT. The alignment is by PAINT — the bell's painted right edge ~12px
      // from the screen edge, as the mark's left edge is 12px — but an e2e cannot scan pixels. The glyph inks ~1.7px (the quiet
      // 22px) / ~2.0px (the 24px ink bell) inside its own box (3x 50%-coverage scans of the real markup, 320/390/412, light and
      // dark: paint 11.7 / 12.0px from the edge), so BOTH routes' glyph boxes end 10px from the edge: the home row overhangs
      // the gutter by 11px (its box ends 1px from the edge), the others by 10px (2px).
      test(`${path}: the bell — ${home ? "build 8's quiet 22px" : "r05's 24px ink"} glyph on the mark's edge, its hit area on screen and clear of the ✨'s, its keyboard ring whole`, async ({ page, baseURL }) => {
        await open(page, path, lang, baseURL)
        const vw = page.viewportSize()!.width
        const bell = page.locator(BELL).first()
        const glyph = (await bell.locator('svg').boundingBox())!
        const bb = (await bell.boundingBox())!
        expect(Math.round(glyph.width)).toBe(home ? 22 : 24)
        expect(Math.abs(vw - (glyph.x + glyph.width) - 10), 'glyph box → screen edge').toBeLessThanOrEqual(0.5)
        expect(Math.round(vw - (bb.x + bb.width)), 'button box → screen edge').toBe(home ? 1 : 2)
        // Muted on home, ink elsewhere: the bell's colour against the header's own tokens.
        const ink = await page.evaluate(() => {
          const probe = (v: string) => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c }
          return { muted: probe('--muted-foreground'), ink: probe('--foreground') }
        })
        expect(await bell.evaluate((el) => getComputedStyle(el).color)).toBe(home ? ink.muted : ink.ink)
        // The hit areas, from their ::before (tap-44 on the bell, nudged 1px back when quiet; tap-48 on the ✨): the bell's ends
        // ON the screen edge — never past it, which scrolled the page sideways by 1px — and starts after the ✨'s ends.
        const hit = await page.evaluate((sel) => {
          const area = (el: Element) => {
            const s = getComputedStyle(el, '::before')
            const r = el.getBoundingClientRect()
            const w = Math.max(parseFloat(s.width), parseFloat(s.minWidth) || 0)
            const left = r.left + parseFloat(s.left) + new DOMMatrix(s.transform).m41 + (s.translate === 'none' ? 0 : parseFloat(s.translate))
            return { left, right: left + w }
          }
          const bell = document.querySelector(sel)!
          const ai = [...document.querySelectorAll('#app-header form[role="search"] div.relative.z-50 > button')].find((b) => (b as HTMLElement).offsetParent !== null)!
          const r = bell.getBoundingClientRect()
          return { bell: area(bell), ai: area(ai), edgeOwner: document.elementFromPoint(innerWidth - 1, r.top + r.height / 2)?.closest('button') === bell, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }
        }, BELL)
        expect(hit.bell.right, 'the bell hit area past the screen edge').toBeLessThanOrEqual(vw + 0.01)
        expect(hit.bell.right - hit.bell.left).toBeGreaterThanOrEqual(44)
        expect(hit.edgeOwner, 'a tap on the last pixel column is the bell').toBe(true)
        expect(hit.bell.left, 'the bell and the ✨ hit areas overlap').toBeGreaterThanOrEqual(hit.ai.right - 0.01)
        expect([hit.scrollW, hit.innerW], 'the page scrolls sideways').toEqual([vw, vw])
        // Its keyboard ring is drawn inside its box (the global +2px offset lost the ring's right side off the screen). Tabbed to
        // from the ✨ — never through the field, whose focus opens the search and steps the bell out.
        await page.evaluate(() => ([...document.querySelectorAll('#app-header form[role="search"] div.relative.z-50 > button')].find((b) => (b as HTMLElement).offsetParent !== null) as HTMLElement).focus())
        for (let i = 0; i < 4 && !(await bell.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
        const ring = await bell.evaluate((el) => { const s = getComputedStyle(el); return { visible: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset } })
        expect(ring).toEqual({ visible: true, style: 'solid', width: '2px', offset: '-2px' })
      })
    }

    // ⛔ Owner, 2026-11-15: "search pill on mobile is not good" — open, the search is the whole screen under the bar.
    test('the open search fills the screen under the bar: Back + the field, no logo, nothing of the page beside it', async ({ page, baseURL }) => {
      await open(page, '/', lang, baseURL)
      await page.locator('#app-header input[name="q"]').tap()
      const win = page.locator('#app-header form div.overflow-y-auto')
      await expect(win).toBeVisible()
      await expect(page.locator('#app-header [data-header-logo]')).toBeHidden()
      const vp = page.viewportSize()!
      const header = (await page.locator('#app-header').boundingBox())!
      await expect.poll(async () => {
        const w = (await win.boundingBox())!
        return [Math.round(w.x), Math.round(w.width), Math.abs(w.y + w.height - vp.height) <= 1, Math.abs(w.y - (header.y + header.height)) <= 4]
      }).toEqual([0, vp.width, true, true])
      // Back cancels it: the page is back, and scrolls again.
      await page.locator('#app-header form').getByRole('button', { name: /^(Back|Quay lại)$/ }).tap()
      await expect(win).toBeHidden()
      await expect(page.locator('#app-header [data-header-logo]')).toBeVisible()
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
    })

    for (const path of FOOTER_PAGES) {
      test(`${path}: 24px from the end of <main> to the footer's hairline`, async ({ page, baseURL }) => {
        await open(page, path, lang, baseURL)
        const gap = await page.evaluate(() => {
          const main = document.getElementById('main')
          const footer = document.getElementById('app-footer')
          if (!main || !footer) return null
          return Math.round(footer.getBoundingClientRect().top - (main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom)))
        })
        expect(gap).not.toBeNull()
        expect(Math.abs((gap ?? 0) - 24)).toBeLessThanOrEqual(2)
      })
    }
  })
}

test.describe('Guest · desktop header keeps its 40px tint pill', () => {
  test('a 40px pill and a 40px mark from sm; the open window is fused (flat bottom corners)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'desktop header')
    await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
    await page.goto('/')
    await dismissOverlays(page)
    const pill = page.locator('#app-header form[role="search"] div.relative.z-50')
    expect(Math.round((await pill.boundingBox())!.height)).toBe(40)
    expect(Math.round((await page.locator('#app-header [data-header-logo] img').boundingBox())!.width)).toBe(40)
    await page.locator('#app-header input[name="q"]').focus()
    await expect.poll(() => pill.evaluate((el) => parseFloat(getComputedStyle(el).borderBottomLeftRadius))).toBe(0)
  })
})
