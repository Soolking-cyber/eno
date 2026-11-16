// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ NO DOWNLOAD GLYPH IN THE PHONE HEADER (owner, 2026-11-16, hub Q12: "yes if they are related to visual change"; cook r11
 * labdl). It reverses, below `sm` and on every route, 2026-09-16's "on a phone … immediately right of the bell": both of the
 * control's branches hide themselves there (`max-sm:hidden` on the primitive, where it beats the base display). Desktop keeps
 * the control exactly where it was. A phone still reaches the apps through the same module: the footer's "Get the app" row
 * (the compact footer too — /dashboard/account, /saved), the install card, and /app. jsdom has no layout: classes and source.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */

const env = vi.hoisted(() => ({ fine: false }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))
vi.mock('@/lib/native-browser', () => ({ isNativeShell: () => false }))
vi.mock('@/lib/in-app-browser', () => ({ browserContext: () => 'browser' }))

import { AppDownload } from './app-download'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: env.fine && q.includes('pointer: fine'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); env.fine = false })

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('the download glyph leaves the phone header (hub Q12b, 2026-11-16)', () => {
  it('a touch screen\'s link (the branch a phone renders) is hidden below sm and is still the store link from sm', () => {
    render(<AppDownload />)
    const link = screen.getByRole('link', { name: 'Download the eno app' })
    expect(tokens(link)).toContain('max-sm:hidden')
    expect(tokens(link)).toEqual(expect.arrayContaining(['flex', 'h-10', 'w-10', 'tap-44']))
    expect(link.hasAttribute('data-app-download')).toBe(true)
    // No phone-only sizing is left behind for a header that never shows it there.
    expect(link.innerHTML).not.toMatch(/max-sm:/)
  })

  it('a fine pointer\'s QR trigger (a narrow window with a mouse is a phone-width header too) is hidden below sm as well', () => {
    env.fine = true
    render(<AppDownload />)
    const trigger = screen.getByRole('button', { name: 'Download the eno app' })
    expect(tokens(trigger)).toContain('max-sm:hidden')
    expect(trigger.hasAttribute('data-app-download')).toBe(true)
  })

  it('the header mounts it with no phone variant (the old `quiet` home look is gone with the phone glyph)', () => {
    const header = src('src/components/marketplace/header.tsx')
    expect(header).toMatch(/<AppDownload \/>/)
    expect(header).not.toMatch(/<AppDownload quiet/)
    expect(src('src/components/marketplace/app-download.tsx')).not.toMatch(/quiet/)
  })

  it('a phone still gets the app: the footer\'s store row reads the same module, and the compact footer (the account page\'s) keeps it', () => {
    const footer = src('src/components/marketplace/footer.tsx')
    expect(footer).toMatch(/import \{ ANDROID_APP_URL, IOS_APP_URL \} from '@\/lib\/app-store-links'/)
    expect(footer).toMatch(/tr\('Get the app', 'Tải ứng dụng'\)/)
    // The store row lives in the operator block, which the compact footer keeps (it drops only the link columns).
    const legal = footer.indexOf('{IS_MARKETPLACE && (')
    expect(legal).toBeGreaterThan(footer.indexOf('{!compact && ('))
    expect(footer.slice(footer.indexOf('{!compact && ('), legal)).not.toContain("tr('Get the app'")
    expect(footer.indexOf("tr('Get the app', 'Tải ứng dụng')")).toBeGreaterThan(legal)
    expect(src('src/app/[lang]/dashboard/layout.tsx')).toMatch(/<Footer compact \/>/)
    expect(src('src/components/marketplace/install-hint.tsx')).toMatch(/from '@\/lib\/app-store-links'/)
  })
})
