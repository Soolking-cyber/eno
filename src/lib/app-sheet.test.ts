import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_SHEET_HEAD_JS, appSheetUrl, isPhoneScheme, leavesThroughApp, samePageHash } from './app-sheet'

/**
 * The app's page sheet (owner, 2026-10-29: "pages should show like native app and not ask to open in the app"). Which
 * links it takes, where the frame sends the rest, and the pre-paint marker the framed page sets on itself.
 */
const HERE = 'https://eno.vn/signin'

describe('appSheetUrl — an eno page, on THIS origin, marked as the sheet', () => {
  it('takes relative and absolute eno links, www folded onto the origin', () => {
    expect(appSheetUrl('/terms', HERE)).toBe('https://eno.vn/terms?app_sheet=1')
    expect(appSheetUrl('https://www.eno.vn/privacy?x=1#s3', HERE)).toBe('https://eno.vn/privacy?x=1&app_sheet=1#s3')
    expect(appSheetUrl('/listings/abc', 'http://localhost:3000/')).toBe('http://localhost:3000/listings/abc?app_sheet=1')
  })

  it('never folds an explicit eno.vn link onto another edition\'s origin', () => {
    expect(appSheetUrl('https://eno.vn/terms', 'https://eno.forum/signin')).toBeNull()
    expect(appSheetUrl('https://eno.vn/terms', 'http://localhost:3000/signin')).toBeNull()
    expect(appSheetUrl('/terms', 'https://www.eno.forum/signin')).toBe('https://www.eno.forum/terms?app_sheet=1')
  })

  it('leaves another site, the sister site, files, API routes and non-http schemes alone', () => {
    for (const href of ['https://google.com/maps', 'https://eno.forum/visa', 'https://www.eno.forum/', '/api/cv/1', '/docs/guide.pdf', '/x.JPG', 'mailto:a@b.c', 'tel:+84123', 'javascript:void(0)']) {
      expect(appSheetUrl(href, HERE), href).toBeNull()
    }
  })
})

describe('leavesThroughApp — what a page inside the sheet hands to the app', () => {
  it('another site, the phone\'s own schemes, and our own files and API routes', () => {
    for (const href of ['https://zalo.me/123', 'https://eno.forum/', 'tel:+84123', 'mailto:a@b.c', 'sms:123', '/api/cv/1', '/docs/guide.pdf', 'https://eno.vn/x.jpg']) {
      expect(leavesThroughApp(href, HERE), href).toBe(true)
    }
  })
  it('an explicit eno.vn link from another edition\'s sheet goes up, never into the frame (it would load blank)', () => {
    expect(leavesThroughApp('https://eno.vn/terms', 'https://eno.forum/terms?app_sheet=1')).toBe(true)
  })

  it('isPhoneScheme: the phone\'s own schemes, never http(s) or a script', () => {
    for (const ok of ['tel:+84123', 'mailto:a@b.c', 'sms:1', 'zalo://chat']) expect(isPhoneScheme(ok), ok).toBe(true)
    for (const no of ['https://eno.vn', 'http://x.y', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'blob:https://eno.vn/x', 'about:blank', 'not a url']) {
      expect(isPhoneScheme(no), no).toBe(false)
    }
  })

  it('never an eno page or a script/inline URL', () => {
    for (const href of ['/terms', 'https://eno.vn/privacy', 'https://www.eno.vn/', 'javascript:void(0)', 'about:blank', 'data:text/plain,x']) expect(leavesThroughApp(href, HERE), href).toBe(false)
  })
})

describe('samePageHash — a #section link only scrolls', () => {
  it('is true for this page\'s anchors and false for another page', () => {
    expect(samePageHash('#rules', 'https://eno.vn/terms?app_sheet=1')).toBe(true)
    expect(samePageHash('/terms?app_sheet=1#rules', 'https://eno.vn/terms?app_sheet=1')).toBe(true)
    expect(samePageHash('/privacy#rules', 'https://eno.vn/terms')).toBe(false)
    expect(samePageHash('/terms', 'https://eno.vn/terms')).toBe(false)
    expect(samePageHash('#', 'https://eno.vn/terms?app_sheet=1')).toBe(true) // a toggle's bare '#': scroll, never reload
  })
})

describe('APP_SHEET_HEAD_JS — the framed page marks itself before first paint', () => {
  const run = (frameElement: { hasAttribute: (n: string) => boolean } | null, parentClasses: string[], win: Record<string, unknown> = {}) => {
    const classes = new Set<string>()
    const doc = { documentElement: { classList: { add: (c: string) => classes.add(c) } } }
    const parent = { document: { documentElement: { classList: parentClasses } } }
    new Function('window', 'document', 'parent', APP_SHEET_HEAD_JS)(Object.assign(win, { frameElement }), doc, parent)
    return [...classes]
  }

  it('inside the sheet: app-sheet plus the app\'s native + platform classes — never native-siwa (no bridge for Apple here)', () => {
    expect(run({ hasAttribute: (n) => n === 'data-app-sheet' }, ['native', 'native-ios', 'native-siwa', 'dark', 'page-at-top']))
      .toEqual(['app-sheet', 'native', 'native-ios'])
  })

  it('inside the sheet the page never sees the app\'s bridge — not the injected one, not one set later', () => {
    // Android injects the bridge into every frame of the origin; the framed page must stay a plain page (review, opus).
    const win: Record<string, unknown> = { Capacitor: { isNativePlatform: () => true } }
    run({ hasAttribute: () => true }, ['native', 'native-android'], win)
    expect(win.Capacitor).toBeUndefined()
    win.Capacitor = { isNativePlatform: () => true } // @capacitor/core rebuilding the global on import
    expect(win.Capacitor).toBeUndefined()
  })

  it('outside the sheet the bridge is untouched', () => {
    const cap = { isNativePlatform: () => true }
    const win: Record<string, unknown> = { Capacitor: cap }
    run(null, [], win)
    expect(win.Capacitor).toBe(cap)
  })

  it('any other frame, or no frame: nothing', () => {
    expect(run({ hasAttribute: () => false }, ['native', 'native-ios'])).toEqual([])
    expect(run(null, ['native'])).toEqual([])
  })
})

describe('⛔ no static @capacitor import anywhere in src — the sheet\'s page stays off the bridge', () => {
  // APP_SHEET_HEAD_JS hides `window.Capacitor` inside the sheet; that keeps the framed page a plain page only because
  // every @capacitor/* module is imported dynamically, behind a check of that global (review, opus). A static import
  // would build the native object on load, from the bridge every frame can see.
  it('finds none (type-only imports are fine)', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') walk(p); continue }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue
        const src = readFileSync(p, 'utf8')
        if (/^\s*import\s+(?!type\b)[^;]*?from\s+['"]@capacitor\//m.test(src) || /^\s*import\s+['"]@capacitor\//m.test(src)) offenders.push(p)
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(offenders).toEqual([])
  })
})
