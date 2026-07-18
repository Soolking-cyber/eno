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

// ── THE PRIMITIVES GATE ───────────────────────────────────────────────────────────
// A months-long sweep put every control in the app onto src/components/ui/*. These are
// the ONLY raw controls that survive, and each one is here because a primitive CANNOT
// express it — not because converting it was inconvenient. Anything else is a build error.
//
// Adding an entry here is a real decision: it permanently exempts a control from the
// design system. If you are tempted, check first whether the PRIMITIVE is what's wrong —
// that was true of ~116 controls in this sweep, which stopped being "impossible" the
// moment ui/button, ui/badge, ui/icon-button and ui/input grew the variants they needed.
// ⚠️ Entries are matched on the CONTROL'S OWN SOURCE TEXT, not on a line number.
//
// This list used to be keyed by line. That made it a tripwire on UNRELATED edits: add one line
// anywhere ABOVE an exempted control and its entry silently stops matching, the control reads as a
// brand-new violation, and the build goes red in a file the author never touched. It broke the build
// TWICE in a single afternoon (an added aria-label pushed the disputes file input 393 → 394). A gate
// that fails because of correct edits elsewhere is one people learn to route around, which is the
// only way this gate can actually die.
//
// `match` is a substring of the offending line. It must be SPECIFIC — `type="file"` identifies the
// hidden file inputs precisely, and would not accidentally exempt a raw <button> or a text <input>
// added to the same file later. That is the property worth preserving: line-independence must not
// become a blanket per-file amnesty.
const RAW_CONTROL_ALLOW = [
  // A. The <label> IS the control. A hidden <input type=file> is opened by click-through
  //    containment (or a ref .click()), renders nothing, and often needs its raw node for
  //    the `value = ''` reset that lets the same file be picked twice. ui/label is a form
  //    label; ui/input is a visible field. Neither can be this.
  { file: 'src/components/marketplace/bulk-upload-panel.tsx', match: 'type="file"', reason: 'hidden CSV input, fired by the dropzone via fileRef.click()' },
  { file: 'src/components/marketplace/business-profile-editor.tsx', match: 'type="file"', reason: 'hidden logo input inside the <label> picker' },
  { file: 'src/components/marketplace/profile-editor.tsx', match: 'type="file"', reason: 'hidden avatar input inside the clickable <label>' },
  { file: 'src/components/marketplace/post-wizard.tsx', match: 'type="file"', reason: 'hidden photo + video inputs inside the dashed <label> tiles; the video one needs currentTarget.value = "" to allow a re-pick' },
  { file: 'src/app/disputes/[id]/page.tsx', match: 'type="file"', reason: 'hidden evidence input inside the Evidence <label>' },
  { file: 'src/app/appeal/[id]/page.tsx', match: 'type="file"', reason: 'hidden proof input inside the Add <label>' },
  { file: 'src/app/reports/[id]/page.tsx', match: 'type="file"', reason: 'hidden screenshot input inside the Add <label>' },
  { file: 'src/components/admin/admin-brands-client.tsx', match: 'type="file"', reason: 'hidden .svg input inside the Upload <label>; needs the raw node for its value="" reset' },
  { file: 'src/app/dashboard/visa/apply/apply-client.tsx', match: 'type="file"', reason: 'hidden visa passport/portrait input inside the dashed dropzone <label> (forum-ported UploadCard); needs the raw node for its value="" re-pick reset' },

  // B. Nested interactive content. A <button> may not contain another button/input — the
  //    HTML parser reparents it and hydration breaks.
  { file: 'src/components/marketplace/dashboard-listing-row.tsx', match: 'aspect-square w-full overflow-hidden rounded-t-2xl', reason: 'the grid cover HOSTS the select checkbox (Base UI span + its hidden input), so it must stay a raw button/div — nested interactive content, and a <button> inside a <button> is reparented by the parser' },

  // C. No stylesheet exists here.
  { file: 'src/app/global-error.tsx', match: '<button', reason: 'renders its own <html> WITHOUT globals.css — no Tailwind, no tokens, no primitives; inline styles only' },
]
const RAW_ALLOW_MAP = new Map()
for (const e of RAW_CONTROL_ALLOW) {
  if (!RAW_ALLOW_MAP.has(e.file)) RAW_ALLOW_MAP.set(e.file, [])
  RAW_ALLOW_MAP.get(e.file).push(e.match)
}

// ── THE POPUP GATE ────────────────────────────────────────────────────────────────
// The raw-control gate above asks "which primitive is this control?". It cannot ask the OTHER
// question: "did you hand-roll a WIDGET out of other primitives?" That blind spot is exactly how
// `custom-select.tsx` survived the whole sweep — a select built from <Button>s and createPortal,
// used at 17 call sites across the entire browse UI, with ONE aria attribute in the file: no
// role=combobox, no listbox, no aria-selected, no arrow keys, and no focus management, so Tab from
// the trigger walked out of the menu and into the rest of the page. It passed design-lint every
// single time, because every element in it was already a "correct" primitive.
//
// createPortal is the tell. A floating layer anchored to a trigger is a POPUP, and a popup is a
// primitive's job: ui/select, ui/popover, ui/dropdown-menu, ui/dialog, ui/sheet. Base UI's versions
// bring the roles, the roving focus, the typeahead, Escape, focus return and the anchoring — all of
// which a hand-roll re-implements badly or, as here, not at all.
//
// A portal that is NOT an anchored popup (a fullscreen takeover, a fixed affordance) is fine — it
// just has to say so here.
const PORTAL_ALLOW = [
  { file: 'src/components/marketplace/listings-video-feed.tsx', reason: 'fullscreen TikTok-style video takeover — a page-level layer, not a popup anchored to a trigger' },
  { file: 'src/components/marketplace/back-to-top.tsx', reason: 'a fixed affordance portaled above the panel stack — no trigger, no anchoring, nothing to focus-manage' },
  // (area-filter.tsx / price-range-filter.tsx / more-overflow.tsx / facet-bar.tsx were all paid down
  // to Base UI Popover + Menu — do NOT re-add them here; the gate now protects them.)
]
const PORTAL_ALLOW_SET = new Set(PORTAL_ALLOW.map((e) => e.file))

function checkPortals(rel, codeLines, rawLines) {
  if (rel.startsWith('src/components/ui/')) return 0
  if (PORTAL_ALLOW_SET.has(rel)) return 0
  let n = 0
  codeLines.forEach((line, i) => {
    if (rawLines[i]?.includes('design-lint-allow')) return
    if (!/\bcreatePortal\s*\(/.test(line)) return
    n++
    console.error(
      `${rel}:${i + 1}  createPortal  — a hand-rolled popup. A floating layer anchored to a trigger is a ` +
        `PRIMITIVE's job (ui/select · ui/popover · ui/dropdown-menu · ui/dialog · ui/sheet) — they bring the ` +
        `roles, roving focus, typeahead, Escape and focus-return that a hand-roll silently omits. This is the ` +
        `gap that let custom-select.tsx ship a 17-call-site select with no combobox/listbox/option roles at ` +
        `all. If this portal is genuinely NOT an anchored popup (a fullscreen takeover, a fixed affordance), ` +
        `add it to PORTAL_ALLOW in this file WITH A REASON.`,
    )
  })
  return n
}

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
  {
    name: 'onClick on generic element (use <button>, <Button>, or proper routing elements)',
    re: /<(div|span)[^>]*\bonClick=/g,
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

// The primitives gate. Runs on the COMMENT-STRIPPED source — this codebase is full of
// comments that mention <button>/<textarea> while explaining why something is or isn't one,
// and a gate that trips on prose is a gate people delete. src/components/ui/* is exempt:
// that is where the raw elements are supposed to live.
const RAW_CONTROL_RE = /<(button|input|textarea|select)[\s>]/g
function checkRawControls(rel, codeLines, rawLines) {
  if (rel.startsWith('src/components/ui/')) return 0
  const allowed = RAW_ALLOW_MAP.get(rel) ?? []
  let n = 0
  codeLines.forEach((line, i) => {
    if (rawLines[i]?.includes('design-lint-allow')) return
    for (const m of line.matchAll(RAW_CONTROL_RE)) {
      // Content match, not line number — see the note on RAW_CONTROL_ALLOW.
      if (allowed.some((sig) => line.includes(sig))) continue
      n++
      console.error(
        `${rel}:${i + 1}  <${m[1]}>  — raw control: use the primitive in src/components/ui/ ` +
          `(button · icon-button · badge · input · textarea · select · checkbox · switch · slider · range-slider). ` +
          `If a primitive genuinely cannot express it, add it to RAW_CONTROL_ALLOW in this file WITH A REASON — ` +
          `but first check whether the PRIMITIVE is what needs to grow: that was true of ~116 controls in the sweep.`,
      )
    }
  })
  return n
}

let violations = 0
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  const raw = readFileSync(file, 'utf8')
  const code = stripComments(raw)
  const rawLines = raw.split('\n')
  const lines = code.split('\n')
  violations += checkRawControls(rel, lines, rawLines)
  violations += checkPortals(rel, lines, rawLines)
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
