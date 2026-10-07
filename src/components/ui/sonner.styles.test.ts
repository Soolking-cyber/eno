import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⚠️ A HEURISTIC GUARD, NOT A CASCADE ENGINE: the specificity below counts attributes and pseudo-classes and
 * compares selectors by their last compound, which is all these two stylesheets use. The proof is the browser —
 * computed styles on a live toast (the 2026-10-07 build check); this keeps the known failure from coming back.
 *
 * ⛔ THE TOAST STYLING HAS TO OUT-RANK SONNER'S OWN, OR IT DOES NOTHING — and for months it did nothing.
 *
 * Sonner injects its stylesheet at runtime (unlayered, appended to <head> after ours) and draws the card as
 * `[data-sonner-toast][data-styled=true]`, the title one step deeper. globals.css styled the toast with a bare
 * `[data-sonner-toast]`, so every property both sides set went to sonner: 8px corners, a 13px body, its shadow,
 * titles at 500 (drawn as 400 — the app ships 400 and 700 only), and sonner's system font stack inherited from
 * the toaster. Nothing failed; the rules simply read as applied (Emil-skills audit, ask-sonner #6).
 *
 * So this compares the two stylesheets as they are: for each property we set, OUR selector must carry more
 * attribute selectors than the sonner rule that sets the same property. A sonner upgrade that raises its own
 * specificity turns this red instead of quietly undoing the styling again.
 */

const appCss = readFileSync('src/app/globals.css', 'utf8')
const sonnerJs = readFileSync('node_modules/sonner/dist/index.mjs', 'utf8')
const sonnerCss = (() => {
  const m = sonnerJs.match(/__insertCSS\("((?:[^"\\]|\\.)*)"\)/)
  if (!m) throw new Error('sonner no longer injects its CSS through __insertCSS — re-derive this test')
  return m[1]
})()

/** The declarations of the rule whose selector is exactly `selector` (whitespace-insensitive). */
function rule(css: string, selector: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/'/g, '').replace(/"/g, '').trim()
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(re)) {
    const sel = m[1].split('*/').pop() ?? m[1] // a comment ending right before the selector is not part of it
    if (norm(sel) === norm(selector)) return m[2]
  }
  throw new Error(`no rule for ${selector}`)
}
const attrs = (selector: string) => (selector.match(/\[/g) ?? []).length

const SONNER_TOAST = '[data-sonner-toast][data-styled=true]'
const SONNER_TITLE = '[data-sonner-toast][data-styled=true] [data-title]'
const SONNER_TOASTER = '[data-sonner-toaster]'

const OUR_TOAST = "[data-sonner-toaster] [data-sonner-toast][data-styled='true']"
const OUR_TITLE = "[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-title]"
const OUR_HEADING = "[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-content]:has([data-description]) [data-title]"
const OUR_TOASTER = '[data-sonner-toaster][data-sonner-theme]'

describe('toast styling out-ranks sonner', () => {
  it('sonner still sets what we override (otherwise this guard is guarding nothing)', () => {
    expect(rule(sonnerCss, SONNER_TOAST)).toMatch(/border-radius:/)
    expect(rule(sonnerCss, SONNER_TOAST)).toMatch(/font-size:/)
    expect(rule(sonnerCss, SONNER_TOAST)).toMatch(/box-shadow:/)
    expect(rule(sonnerCss, SONNER_TITLE)).toMatch(/font-weight:/)
    expect(rule(sonnerCss, SONNER_TOASTER)).toMatch(/font-family:/)
  })

  it('sonner never positions its action button — so the layered `relative` (ui/sonner.tsx, for tap-44) is what positions it', () => {
    // An unlayered `position` from sonner would beat the layered utility, and tap-44's reach would anchor to the
    // toast instead of the button — covering the card, the shape globals.css's tap-44 note warns about.
    const positioned = rules(sonnerCss).filter((r) => target(r.selector).startsWith('[data-button') && r.decls.has('position'))
    expect(positioned.map((r) => r.selector)).toEqual([])
  })

  it('the card: our radius, shadow and size, from a selector sonner cannot outrank', () => {
    const ours = rule(appCss, OUR_TOAST)
    expect(ours).toMatch(/border-radius:\s*var\(--radius-2xl\)/)
    expect(ours).toMatch(/box-shadow:\s*var\(--shadow-pop\)/)
    expect(ours).toMatch(/font-size:\s*0\.875rem/)
    expect(attrs(OUR_TOAST)).toBeGreaterThan(attrs(SONNER_TOAST))
  })

  it('keyboard focus keeps a ring on top of our shadow', () => {
    expect(rule(appCss, `${OUR_TOAST}:focus-visible`)).toMatch(/box-shadow:\s*var\(--shadow-pop\),\s*0 0 0 2px var\(--ring\)/)
  })

  it('the title: 400 on its own (a one-sentence toast is not a bold paragraph), 700 only as a heading over a description', () => {
    expect(rule(appCss, OUR_TITLE)).toMatch(/font-weight:\s*400/)
    expect(rule(appCss, OUR_HEADING)).toMatch(/font-weight:\s*700/)
    expect(attrs(OUR_TITLE)).toBeGreaterThan(attrs(SONNER_TITLE))
    expect(attrs(OUR_HEADING)).toBeGreaterThan(attrs(OUR_TITLE))
  })

  it('the font: the page’s own, not sonner’s system stack', () => {
    expect(rule(appCss, OUR_TOASTER)).toMatch(/font-family:\s*inherit/)
    expect(attrs(OUR_TOASTER)).toBeGreaterThan(attrs(SONNER_TOASTER))
  })

  /**
   * ⛔ THE GENERAL FORM, AND THE ONE THAT MATTERS NEXT TIME: every rule of ours that touches a sonner element
   * must out-rank every sonner rule setting the SAME property on the SAME element. The first draft of this guard
   * only looked for a bare `[data-sonner-toast] {`, i.e. the shape already fixed — the close-button rule had the
   * same bug one line further down and sailed through (review, 2026-10-07). `!important` is exempt: it wins
   * regardless (and every one of ours is a positioning override that has to).
   */
  it('no rule of ours that touches a sonner element loses a property to sonner', () => {
    const losers: string[] = []
    const ours = rules(appCss).filter((r) => /\[data-sonner-toast(er)?\]/.test(r.selector))
    const theirs = rules(sonnerCss)
    expect(ours.length).toBeGreaterThan(5) // the parse found our block
    for (const o of ours) {
      for (const [prop, value] of o.decls) {
        if (/!important/.test(value)) continue
        for (const t of theirs) {
          if (target(t.selector) !== target(o.selector) || !t.decls.has(prop)) continue
          if (specificity(t.selector) >= specificity(o.selector)) losers.push(`${o.selector} { ${prop} } loses to sonner's ${t.selector}`)
        }
      }
    }
    expect(losers).toEqual([])
  })
})

type Rule = { selector: string; decls: Map<string, string> }
/** Flat rules, one per selector of a selector list, with comments stripped. Media/supports wrappers are walked
 *  through (their inner rules match the same regex), which is what both stylesheets need. */
function rules(css: string): Rule[] {
  const out: Rule[] = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>()
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim())
    }
    for (const sel of m[1].split(',')) {
      const selector = sel.trim().replace(/^@[^{]*$/, '')
      if (selector && !selector.startsWith('@')) out.push({ selector, decls })
    }
  }
  return out
}
/** The element a selector styles: its last compound, with the toast/toaster's own variants folded away so
 *  `[data-rich-colors=true][data-sonner-toast][data-type=error]` and `…[data-styled=true]` compare as one element. */
function target(selector: string): string {
  const last = selector.replace(/'|"/g, '').trim().split(/\s+/).pop() ?? ''
  const pseudo = (last.match(/(::?[a-z-]+(\([^)]*\))?)+$/) ?? [''])[0].replace(/:has\([^)]*\)/g, '')
  if (last.includes('[data-sonner-toaster]')) return `toaster${pseudo}`
  if (last.includes('[data-sonner-toast]')) return `toast${pseudo}`
  return (last.match(/\[data-[a-z-]+/) ?? [last])[0] + pseudo
}
/** The middle term of specificity: attributes (including inside :has) plus non-functional pseudo-classes. */
function specificity(selector: string): number {
  const attrsCount = (selector.match(/\[/g) ?? []).length
  const pseudoClasses = (selector.match(/(?<!:):(?!has\(|is\(|not\(|where\()[a-z-]+/g) ?? []).length
  return attrsCount + pseudoClasses
}
