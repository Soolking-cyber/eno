#!/usr/bin/env node
/**
 * Design-language lint — enforces the bans in docs/design-language.md so the
 * 2026-07 normalization can't drift back. Runs in `npm run lint` and as part of
 * `npm run build` (so Vercel enforces it). Exit 1 on any violation.
 *
 * Bans (in all src .tsx files, comments stripped):
 *   1. Arbitrary px font sizes:  text-[13px]           → use the canon scale
 *   2. Off-tier radii:           rounded / -sm / -md   → lg / xl / 2xl / full
 *   3. Raw 6-digit hex colors outside the allowlist    → use tokens
 *
 * Escape hatches: add the file to the relevant allowlist below (with a reason),
 * or put `design-lint-allow` in a comment on the same line for a one-off.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SRC = join(ROOT, 'src')

// Files allowed to contain raw hex — third-party brand marks, meta/OG colors,
// and canvas/map drawing code where tokens don't reach.
const HEX_ALLOW = new Set([
  'src/app/layout.tsx', // theme-color meta + JSON-LD brand color
  'src/components/marketplace/sign-in-form.tsx', // Google logo SVG fills
  'src/app/global-error.tsx', // renders its own <html> WITHOUT globals.css — tokens unavailable
  'src/components/marketplace/listings-map.tsx', // Leaflet CSS-in-JS pin/circle colors (map surface is theme-independent)
  'src/components/marketplace/trust-score.tsx', // trust-badge gradient ramps — bespoke contrast-checked stops
])

// Third-party brand-mark colors allowed anywhere (logos/pins must stay exact).
const BRAND_HEX = new Set([
  '#4285f4', '#ea4335', '#fbbc05', '#34a853', // Google
  '#0068ff', // Zalo
])

// Files allowed to use a raw Tailwind palette colour. Keep this list SHORT and justified —
// every entry is a surface that will not adapt in dark mode.
const PALETTE_ALLOW = new Set([])

const RULES = [
  {
    name: 'arbitrary px font size (use text-3xs/2xs/xs/sm/base — docs/design-language.md §1)',
    re: /text-\[\d+(?:\.\d+)?px\]/g,
  },
  {
    name: 'off-tier radius (use rounded-lg/xl/2xl/full — docs/design-language.md §2)',
    re: /(?<![-\w])rounded(?:-[trbl])?(?:-(?:xs|sm|md))?(?![-\w])/g,
  },
  {
    name: 'raw hex color (use tokens — docs/design-language.md §3)',
    re: /#[0-9a-fA-F]{6}\b/g,
    allow: HEX_ALLOW,
  },
  {
    // The gap that let ~25 raw reds live in the app for months: the hex rule above only
    // ever caught `#dc2626`, never `bg-red-600`. A palette class is just as un-themed —
    // it is a fixed light-mode colour that does NOT flip in dark mode, which is exactly
    // how the notification bubbles and every error message stayed vivid-red on a dark
    // canvas. Semantic meaning has tokens: destructive / success / warning / brand.
    // (Neutrals — slate/gray/zinc/neutral/stone — are deliberately NOT covered here;
    // they are still in use as a scale and are a separate, larger migration.)
    name: 'raw palette colour (use the destructive/success/warning/brand tokens — they adapt in dark mode; docs/design-language.md §3)',
    re: /(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|accent|caret|decoration)-(?:red|green|emerald|amber|yellow|orange|lime|teal|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
    allow: PALETTE_ALLOW,
  },
  {
    // A {/* … */} in EXPRESSION position is a syntax error, not a comment — JSX comments
    // are only valid as CHILDREN. It fails the build with a baffling "')' expected", and it
    // has now cost FOUR build breaks. Use a plain // comment above the expression instead.
    //
    // The pattern is: an opening `(` — from `return (`, `{cond && (`, `? (`, `: (`, `.map(x => (`
    // — then a JSX comment, then a JSX element. The first version of this rule only matched
    // `return (` and sailed straight past `{landingQuery && (`, which is exactly how the next
    // one shipped. Match the general shape instead: ( … {/* … */} … <
    name: 'JSX comment in expression position — only valid as a CHILD; use a // comment above it',
    re: /\(\s*\n\s*\{\/\*[\s\S]*?\*\/\}\s*\n\s*</g,
    raw: true, // must see the comment itself — do not run on the comment-stripped source
  },
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (name.endsWith('.tsx')) yield p
  }
}

// Strip comments so prose like "rounded corners" can't false-positive, while
// keeping line numbers stable (replace comment chars with spaces, keep \n).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  )
}

let violations = 0
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  const raw = readFileSync(file, 'utf8')
  const code = stripComments(raw)
  const rawLines = raw.split('\n')
  const lines = code.split('\n')
  for (const rule of RULES) {
    if (rule.allow?.has(rel)) continue
    // `raw` rules match across newlines against the ORIGINAL source (a JSX comment is
    // invisible to the comment-stripper, and `return (\n  {/*` spans two lines).
    if (rule.raw) {
      for (const m of raw.matchAll(rule.re)) {
        if (raw.slice(0, m.index).split('\n').pop()?.includes('design-lint-allow')) continue
        const lineNo = raw.slice(0, m.index).split('\n').length
        violations++
        console.error(`${rel}:${lineNo}  ${m[0].trim().replace(/\s+/g, ' ')}  — ${rule.name}`)
      }
      continue
    }
    lines.forEach((line, i) => {
      if (rawLines[i]?.includes('design-lint-allow')) return
      let hits = line.match(rule.re)
      if (hits && rule.allow) hits = hits.filter((h) => !BRAND_HEX.has(h.toLowerCase()))
      if (!hits || !hits.length) return
      violations += hits.length
      console.error(`${rel}:${i + 1}  ${hits.join(' ')}  — ${rule.name}`)
    })
  }
}

if (violations) {
  console.error(`\ndesign-lint: ${violations} violation(s). See docs/design-language.md.`)
  process.exit(1)
}
console.log('design-lint: clean')
