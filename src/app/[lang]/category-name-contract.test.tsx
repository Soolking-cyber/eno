// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LanguageProvider, Tr } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { TAXONOMY } from '@/lib/taxonomy'

/**
 * ⛔ A CATEGORY'S NAME IS RENDERED FROM THE CATEGORY ROW, IN BOTH LANGUAGES — never looked up as a UI
 * string.
 *
 * `<Tr>` translates its text through the UI-string dictionary, and the category row's own `nameVi` never
 * reaches it. The category "Home" (furniture-appliances, `nameVi` "Nhà cửa") therefore hit the
 * vi-overrides entry "Home" → "Trang chủ", which means the HOMEPAGE: /c/furniture-appliances in
 * Vietnamese read "Trang chủ ở Việt Nam" under a "Trang chủ / Trang chủ" breadcrumb, and so did every
 * furniture listing's crumb (live, 2026-09-27). The fix renders
 * `<Bilingual en={x.name} vi={x.nameVi || x.name} />` (components/marketplace/bilingual.tsx) at every
 * site; this file keeps a later edit from reaching back for `<Tr>` with a `.name`.
 * ⚠️ This file is scanned too, so no comment in it may spell out the banned `<Tr>` form literally.
 */
const SRC = join(process.cwd(), 'src')
const SCANNED = ['app', 'components'].map((d) => join(SRC, d))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(tsx|jsx|ts|js)$/.test(e.name) ? [p] : []
  })
}
const FILES = SCANNED.flatMap(sources).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }))

/** Any `.name` fed to `<Tr>` as its text, spaces and optional chaining included. */
const TR_OF_A_NAME = /<Tr\s+text=\{\s*[\w.?]*\.name\s*\}/
/**
 * The same lookup through the hook or the function with NO Vietnamese argument (opus review). The
 * two-argument form, passing the row's `nameVi`, is the right one and is what the footer and the post
 * wizard already use.
 */
const TR_CALL_OF_A_NAME = /\b(?:tr|useTr)\(\s*[\w.?]*\.name\s*\)/
/** A `<Bilingual>` whose `en` is some object's `.name`: captures the object and the `vi` expression. */
const BILINGUAL_NAME = /<Bilingual\s+en=\{\s*([\w.?]+)\.name\s*\}\s+vi=\{([^}]*)\}/g

describe('category names come from the category row', () => {
  it('scans real files (a wrong root would pass vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(200)
    expect(FILES.some((f) => f.path === join('app', '[lang]', 'c', '[category]', '(index)', 'page.tsx'))).toBe(true)
  })

  it('no source renders a `.name` through <Tr>', () => {
    const hits = FILES.filter((f) => TR_OF_A_NAME.test(f.text)).map((f) => f.path)
    expect(hits, 'render it as <Bilingual en={x.name} vi={x.nameVi || x.name} /> instead').toEqual([])
  })

  it('no source translates a `.name` through tr() or useTr() without its Vietnamese', () => {
    const hits = FILES.filter((f) => TR_CALL_OF_A_NAME.test(f.text)).map((f) => f.path)
    expect(hits, 'pass the row’s Vietnamese: tr(x.name, x.nameVi)').toEqual([])
  })

  it('every <Bilingual> of a `.name` pairs it with the SAME object’s nameVi, falling back to its name', () => {
    const bad: string[] = []
    for (const f of FILES) {
      for (const [, obj, vi] of f.text.matchAll(BILINGUAL_NAME)) {
        if (vi.trim() !== `${obj}.nameVi || ${obj}.name`) bad.push(`${f.path}: en={${obj}.name} vi={${vi}}`)
      }
    }
    expect(bad).toEqual([])
  })

  // The seven sites of 2026-09-27: the category page (crumb and H1 on `cat`, in its (index) layout since
  // SEO wave B, H1b; the two "Other categories" rails on `c`), the district page (crumb, "All …" link)
  // and the listing page's crumb.
  it.each([
    ['app/[lang]/c/[category]/(index)/layout.tsx', 'cat'],
    ['app/[lang]/c/[category]/(index)/page.tsx', 'c'],
    ['app/[lang]/c/[category]/[district]/page.tsx', 'cat'],
    ['app/[lang]/listings/[id]/(pdp)/page.tsx', 'listing.category'],
  ])('%s renders %s.name from the row', (path, obj) => {
    const f = FILES.find((x) => x.path === path)
    expect(f, path).toBeDefined()
    expect(f!.text).toContain(`<Bilingual en={${obj}.name} vi={${obj}.nameVi || ${obj}.name} />`)
  })
})

describe('what the server renders for the "Home" category', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
  })

  // The real row and the real dictionary: the collision is between these two files, not a fixture.
  const home = TAXONOMY.find((c) => c.slug === 'furniture-appliances')!
  const html = (lang: 'en' | 'vi', node: ReactNode) =>
    renderToString(
      <LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>
        {node}
      </LanguageProvider>,
    )

  it('the collision is real: the category is "Home" and the UI dictionary says "Home" is the homepage', () => {
    expect(home.name).toBe('Home')
    expect(home.nameVi).toBe('Nhà cửa')
    expect(VI_OVERRIDES.Home).toBe('Trang chủ')
    // The old render, spelled through a local so this file does not trip its own scan.
    const englishName = home.name
    expect(html('vi', <Tr text={englishName} />)).toBe('Trang chủ')
  })

  it('Bilingual renders the row’s own Vietnamese, and English unchanged', () => {
    const name = (lang: 'en' | 'vi') => html(lang, <Bilingual en={home.name} vi={home.nameVi || home.name} />)
    expect(name('vi')).toBe('Nhà cửa')
    expect(name('en')).toBe('Home')
  })
})
