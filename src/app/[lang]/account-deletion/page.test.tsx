// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ /account-deletion IS THE URL APP REVIEW AND GOOGLE PLAY ARE GIVEN, AND ITS STEPS ARE THE PATH A
 * REVIEWER FOLLOWS (App Store audit 1.4, Guideline 5.1.1(v)). It once sent people to "Dashboard →
 * Settings … at the bottom of that page … 'Delete account'" — a page order and a button that did not
 * exist. So this file holds the steps to the app itself, read from source through the TypeScript parser
 * (comments can neither satisfy nor break a check):
 *  - every label the steps quote is a tr(en, vi) pair the Settings → Account screen renders, in the same
 *    order in both languages — rename a button and this fails here, not in review;
 *  - the word to type is the word the confirm button waits for;
 *  - the shortcut opens a Settings tab that exists and holds the delete control, and the account hub's
 *    name/photo row opens the same one;
 *  - the bottom-bar tab the steps name is that tab, with a person icon;
 *  - both languages render, the Vietnamese as authored, with no site name (both editions serve it).
 */

// Every render re-imports the page on a fresh module graph — seconds each when the suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 })

// The page chrome is irrelevant to the steps, and pulls in auth and data.
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const parse = (p: string) =>
  ts.createSourceFile(p, readFileSync(join(process.cwd(), p), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const PAGE = parse('src/app/[lang]/account-deletion/page.tsx')
const SETTINGS_TABS = parse('src/app/[lang]/dashboard/settings/settings-tabs.tsx')
const SETTINGS = parse('src/app/[lang]/dashboard/settings/settings-client.tsx')
const DELETE = parse('src/components/marketplace/delete-account.tsx')
const HUB = parse('src/app/[lang]/dashboard/account/account-client.tsx')
const NAV = parse('src/components/marketplace/mobile-nav.tsx')

/** Every node under `root`, parents before children — i.e. source order. */
function nodes(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = []
  const visit = (n: ts.Node) => { out.push(n); n.forEachChild(visit) }
  visit(root)
  return out
}

const plain = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

const prop = (o: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
  const p = o.properties.find((x) => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === key)
  return p && ts.isPropertyAssignment(p) ? p.initializer : undefined
}

/** A tr(EN, VI) call with two literal arguments, as [en, vi]. (No quoted literal here: gen-ui-strings would harvest it.) */
const trPair = (n: ts.Node | undefined): [string, string] | null => {
  if (!n || !ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'tr') return null
  const [en, vi] = n.arguments.map((a) => plain(a))
  return en != null && vi != null ? [en, vi] : null
}

/** Every authored `{ en, vi }` object in the page (the shortcut also carries `href`), in source order. */
const PAIRS = nodes(PAGE)
  .filter(ts.isObjectLiteralExpression)
  .map((o) => ({ en: plain(prop(o, 'en')), vi: plain(prop(o, 'vi')), href: plain(prop(o, 'href')) }))
  .filter((p): p is { en: string; vi: string; href: string | null } => p.en != null && p.vi != null)
const STEPS = PAIRS.filter((p) => p.href == null)
const SHORTCUT = PAIRS.find((p) => p.href != null)

/** A JSX element's string attribute, or the tr() pair an attribute holds. */
const attr = (el: ts.JsxOpeningLikeElement, name: string) =>
  el.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name)?.initializer
const attrString = (el: ts.JsxOpeningLikeElement, name: string) => {
  const init = attr(el, name)
  return init && ts.isStringLiteral(init) ? init.text : null
}
const attrTr = (el: ts.JsxOpeningLikeElement, name: string) => {
  const init = attr(el, name)
  return init && ts.isJsxExpression(init) ? trPair(init.expression) : null
}
const jsx = (root: ts.Node, tag: string) =>
  nodes(root).filter((n): n is ts.JsxOpeningLikeElement =>
    (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === tag)

const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1])

describe('/account-deletion — the steps are the app’s own path', () => {
  it('finds the authored steps and the shortcut (the checks below are not vacuous)', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(2)
    expect(SHORTCUT?.href).toBeTruthy()
  })

  it('every label the steps quote is a tr() pair the Settings → Account screen renders, in both languages', () => {
    const app = new Set(nodes(SETTINGS).concat(nodes(DELETE)).map(trPair).filter(Boolean).map((p) => p!.join('|')))
    const labels = STEPS.flatMap((p) => {
      const en = quoted(p.en)
      const vi = quoted(p.vi)
      // The Vietnamese quotes the same buttons, in the same order.
      expect(vi.length).toBe(en.length)
      return en.map((e, i) => `${e}|${vi[i]}`)
    })
    // "Danger zone", "Delete my account", "Permanently delete" today.
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.filter((l) => !app.has(l))).toEqual([])
  })

  it('the word to type is the word the confirm button waits for, quoted from the dialog in both languages', () => {
    const typed = nodes(DELETE).filter(ts.isBinaryExpression).some((b) =>
      b.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && b.left.getText() === 'confirm' && plain(b.right) === 'DELETE')
    expect(typed).toBe(true)
    // The field's own label, not the error line under it.
    const field = nodes(DELETE).find((n): n is ts.JsxElement => ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'FieldLabel')
    const label = field && nodes(field).map(trPair).find(Boolean)
    expect(label?.[0]).toMatch(/\bDELETE\b/)
    expect(STEPS.some((p) => p.en.includes(label![0]) && p.vi.includes(label![1]))).toBe(true)
  })

  it('the shortcut opens the Settings tab that holds the delete control — the tab the steps name, and the one the account hub opens', () => {
    const url = new URL(SHORTCUT!.href!, 'https://example.invalid')
    expect(url.pathname).toBe('/dashboard/settings')
    const tab = url.searchParams.get('tab')

    // settings-tabs.tsx: `{ value: tab, label: tr(…), content: <SettingsClient embedded section={tab} /> }`
    const entry = nodes(SETTINGS_TABS).filter(ts.isObjectLiteralExpression).find((o) => plain(prop(o, 'value')) === tab)
    expect(entry, `no Settings tab "${tab}"`).toBeDefined()
    const panel = jsx(prop(entry!, 'content')!, 'SettingsClient')
    expect(panel.map((el) => attrString(el, 'section'))).toEqual([tab])

    // settings-client.tsx: `section === tab && (…<DeleteAccount />…)`
    const block = nodes(SETTINGS).filter(ts.isBinaryExpression).find((b) =>
      b.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && ts.isBinaryExpression(b.left)
      && b.left.left.getText() === 'section' && plain(b.left.right) === tab)
    expect(block).toBeDefined()
    expect(jsx(block!.right, 'DeleteAccount')).toHaveLength(1)

    // The steps call it by its label.
    const [en, vi] = trPair(prop(entry!, 'label'))!
    expect(STEPS.some((p) => p.en.includes(`the ${en} tab`) && p.vi.includes(`thẻ ${vi}`))).toBe(true)

    // The account hub's name/photo row is the only way into Settings there. It opens Settings on its default
    // (Profile) tab on purpose — tapping your name is how people edit their profile — which is why the steps
    // name the Account tab explicitly rather than assume the row lands on it.
    const hub = jsx(HUB, 'Link').map((el) => attrString(el, 'href')).filter((h) => h?.startsWith('/dashboard/settings'))
    expect(hub).toEqual(['/dashboard/settings'])
  })

  it('the bottom-bar tab the steps name is the Account tab, a person icon', () => {
    const tab = jsx(NAV, 'GatedTab').find((el) => attrString(el, 'href') === '/dashboard/account')
    expect(tab).toBeDefined()
    const icon = attr(tab!, 'icon')
    expect(icon && ts.isJsxExpression(icon) && icon.expression ? jsx(icon.expression, 'User') : []).toHaveLength(1)
    const [en, vi] = attrTr(tab!, 'label')!
    expect(STEPS.some((p) => p.en.includes(`tap ${en} (the person icon`) && p.vi.includes(`chạm vào ${vi} (biểu tượng hình người`))).toBe(true)
  })

  it('names no site — both editions serve this page', () => {
    for (const p of PAIRS) expect(`${p.en} ${p.vi}`).not.toMatch(/eno\.(vn|forum)/i)
  })
})

/**
 * A stored language choice, so LanguageProvider's mount effect agrees with the variant under test instead
 * of reconciling to jsdom's navigator.language ('en-US'); a fresh Storage per render (Node's own global
 * localStorage has no working methods in this environment).
 */
function storedLang(lang: string): void {
  const map = new Map<string, string>([['lang', lang]])
  vi.stubGlobal('localStorage', {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  })
}

async function renderPage(lang: 'en' | 'vi'): Promise<string> {
  storedLang(lang)
  // The plain <Tr> paragraphs ask the translation API for Vietnamese; nothing here needs it to answer.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')))
  vi.resetModules()
  const { default: AccountDeletionPage } = await import('./page')
  const { LanguageProvider } = await import('@/context/language-context')
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><AccountDeletionPage /></LanguageProvider>)
  return document.body.textContent ?? ''
}

describe('/account-deletion — renders the steps', () => {
  it.each(['en', 'vi'] as const)('%s: the authored steps and the shortcut link, and not the old path', async (lang) => {
    const text = await renderPage(lang)
    for (const p of STEPS) expect(text).toContain(p[lang])
    expect(screen.getByRole('link', { name: SHORTCUT![lang] }).getAttribute('href')).toBe(SHORTCUT!.href)
    expect(text).not.toMatch(/Dashboard → Settings|"Delete account"/)
  })
})
