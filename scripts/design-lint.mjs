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
 *   4. Raw Tailwind palette colours (bg-red-600 …)     → use the semantic tokens
 *   5. Off-scale headings above the 3xl/30px cap       → use the fluid .h-display class
 *   6. JSX comments in expression position, and onClick on a div/span
 *   + two structural gates: raw controls (use src/components/ui/*) and hand-rolled
 *     popups (createPortal). Each has its own allowlist, documented at its definition.
 *
 * Plus one gate with a WIDER reach — see THE MONEY GATE below:
 *   7. Money formatted outside src/lib/vnd.ts. This one scans .ts AS WELL AS .tsx,
 *      because the worst instance ever found (itinerary-docx.ts, which ships figures
 *      into a document a traveller prints) lived in a .ts file that rules 1–6 never open.
 *
 * ⚠️ KEEP THIS LIST IN SYNC WITH `RULES` BELOW. It went stale the first time a rule was
 * added without touching it, and a reviewer caught the header claiming three bans while
 * the array held six — a header that undercounts a build-blocking gate is worse than none,
 * because it is the only thing most readers will read.
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
  '#25d366', // WhatsApp — the official brand green; the chat contact bar offers it beside Zalo
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
  { file: 'src/components/marketplace/post-wizard-sections.tsx', match: 'type="file"', reason: 'hidden photo + video inputs inside the dashed <label> tiles (MediaSection, moved verbatim from post-wizard.tsx); the video one needs currentTarget.value = "" to allow a re-pick' },
  { file: 'src/app/disputes/[id]/page.tsx', match: 'type="file"', reason: 'hidden evidence input inside the Evidence <label>' },
  { file: 'src/app/appeal/[id]/page.tsx', match: 'type="file"', reason: 'hidden proof input inside the Add <label>' },
  { file: 'src/app/reports/[id]/page.tsx', match: 'type="file"', reason: 'hidden screenshot input inside the Add <label>' },
  { file: 'src/components/admin/admin-brands-client.tsx', match: 'type="file"', reason: 'hidden .svg input inside the Upload <label>; needs the raw node for its value="" reset' },
  { file: 'src/app/dashboard/visa/apply/apply-client.tsx', match: 'type="file"', reason: 'hidden visa passport/portrait input inside the dashed dropzone <label> (forum-ported UploadCard); needs the raw node for its value="" re-pick reset' },
  { file: 'src/components/marketplace/business-verification-panel.tsx', match: 'type="file"', reason: 'two hidden identity/bank document inputs, fired by their Upload buttons via refs; need the raw node for the value="" re-pick reset' },

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

/**
 * ⛔ A LITERAL `behavior: 'smooth'` IGNORES prefers-reduced-motion, AND THE STYLESHEET HIDES IT.
 * globals.css sets `scroll-behavior: auto !important` in the reduced-motion block, which reads
 * exactly like the preference is handled — but per CSSOM an EXPLICIT `behavior` in a scroll
 * options bag wins over the CSS property, so every one of those calls animated the viewport for a
 * user who had asked not to be moved. 20 call sites were doing it, and none of them looked wrong.
 * `scrollBehavior()` from lib/reduced-motion.ts returns 'auto' or 'smooth' by asking at call time.
 */
function checkScrollBehavior(rel, codeLines, rawLines) {
  if (rel === 'src/lib/reduced-motion.ts') return 0
  let n = 0
  // ⚠️ MATCHED ACROSS THE JOINED SOURCE, NOT LINE BY LINE. A prettier-wrapped options bag puts the
  // key and the literal on separate lines (`behavior:\n  'smooth'`), and a per-line regex sails
  // straight past it — a guard with a hole exactly where a formatter puts one.
  const joined = codeLines.join('\n')
  const re = /behavior\s*:\s*['"]smooth['"]/g
  for (const m of joined.matchAll(re)) {
    const i = joined.slice(0, m.index).split('\n').length - 1
    if (rawLines[i]?.includes('design-lint-allow')) continue
    n++
    console.error(
      `${rel}:${i + 1}  behavior: 'smooth'  — this ignores prefers-reduced-motion. The ` +
        `\`scroll-behavior: auto !important\` in globals.css does NOT cover it: an explicit behavior in a ` +
        `scroll options bag outranks the CSS property, so the kill switch reads as if it works and does ` +
        `nothing. Use \`behavior: scrollBehavior()\` from '@/lib/reduced-motion'. If this scroll must be ` +
        `animated regardless of the preference, add design-lint-allow on the line WITH A REASON.`,
    )
  }
  return n
}

/**
 * ⛔ A TRANSLUCENT SURFACE MUST BE COVERED BY THE REDUCED-TRANSPARENCY BLOCK IN globals.css.
 * `prefers-reduced-transparency: reduce` is turned on by people for whom translucency costs
 * legibility, and it cannot be honoured generically: dropping the blur without raising the alpha
 * makes a `bg-black/40` control over a photo HARDER to read, not easier. So globals.css names the
 * exact tints it covers, and this rule fails the build when a `backdrop-blur` site carries one it
 * does not — otherwise the block silently stops covering new surfaces and nobody finds out.
 */
const MATERIAL_TINTS = new Set([
  'bg-background/95', 'bg-popover/95', 'bg-card/70',
  'bg-foreground/70', 'bg-foreground/85',
  'bg-black/40', 'bg-black/45', 'bg-black/50', 'bg-black/55', 'bg-black/60',
])

/**
 * ⚠️ THE UNIT IS THE ENCLOSING STRING LITERAL, NOT THE LINE AND NOT THE `className` ATTRIBUTE.
 * Three versions of this were wrong before it settled. Per-line missed a prettier-wrapped class
 * list (tint on one line, `backdrop-blur` on the next). A ±4-line window absorbed a SIBLING
 * element's tint and failed valid code. And scanning back to `className=` silently SKIPPED two
 * common shapes with no output at all: `cn(className, '…')`, where the nearest `className` is the
 * prop reference rather than the attribute, and a class string held in an object or constant
 * (card-badges.tsx keeps its variants that way) which is never inside an attribute in the first
 * place. A class list always lives in one string literal; that is the thing to read.
 */
function stringSpans(text) {
  const spans = []
  for (let i = 0; i < text.length; i++) {
    const q = text[i]
    if (q !== '"' && q !== "'" && q !== '`') continue
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue }
      if (text[j] === q) { spans.push([i + 1, j]); i = j; break }
      // An unescaped newline ends a normal quote — it was never a string, so do not swallow the file.
      if (text[j] === '\n' && q !== '`') { break }
    }
  }
  return spans
}

function checkMaterials(rel, codeLines, rawLines) {
  let n = 0
  const text = codeLines.join('\n')
  const spans = stringSpans(text)
  const lineOf = (idx) => text.slice(0, idx).split('\n').length - 1

  /**
   * ⚠️ `backdrop-blur-none` IS NOT A TRANSLUCENT SURFACE — it is the utility that TURNS BLUR OFF,
   * and `motion-reduce:backdrop-blur-none` is a considerate use of it. Matching the bare substring
   * would demand a `material` marker on an element that has no blur to speak of.
   */
  for (const m of text.matchAll(/backdrop-blur(?!-none)/g)) {
    const i = lineOf(m.index)
    if (rawLines[i]?.includes('design-lint-allow')) continue
    const span = spans.find(([a, b]) => a <= m.index && m.index < b)
    /**
     * ⚠️ NOT INSIDE A STRING = REPORT IT, NEVER SKIP IT. The earlier version returned quietly here,
     * which is how a gate develops a hole nobody can see. If a blur utility is reached some way
     * this cannot read, that is a finding, not a pass.
     */
    if (!span) {
      n++
      console.error(
        `${rel}:${i + 1}  backdrop-blur outside any string literal  — this gate reads the class list ` +
          `from its enclosing string and cannot check this one, so it cannot promise the surface is ` +
          `covered. Put the classes in a plain string, or add design-lint-allow WITH A REASON.`,
      )
      continue
    }
    const cls = text.slice(span[0], span[1])

    /**
     * ⚠️ THE MARKER IS REQUIRED FIRST, because the CSS cannot infer it. `.material` is how a call
     * site declares "this is a surface, make it solid" as opposed to "this is a scrim, leave it
     * alone" — and forcing a scrim to full opacity turns a darkened photo into a black rectangle.
     */
    /**
     * ⚠️ A TOKEN INSIDE `${…}` IS CONDITIONAL, SO IT CANNOT VOUCH FOR AN UNCONDITIONAL BLUR.
     * `` `backdrop-blur ${on ? 'material bg-black/40' : ''}` `` reads as covered — every token is
     * in the literal — but when `on` is false the element ships a blur with no marker and no tint.
     * So when the blur itself is static, the marker must be static too. (A blur that is ALSO inside
     * an interpolation is conditional in the same way and stands or falls with it, so this only
     * tightens the case where the two disagree.)
     */
    const staticOnly = cls.replace(/\$\{[^}]*\}/g, ' ')
    const blurIsStatic = /backdrop-blur(?!-none)/.test(staticOnly)
    const scope = blurIsStatic ? staticOnly : cls
    if (!/(?:^|\s)material(?:\s|$)/.test(scope)) {
      n++
      console.error(
        `${rel}:${i + 1}  backdrop-blur without \`material\`  — a translucent surface must declare ` +
          `itself. Add \`material\` beside the blur utility and the reduced-transparency / high-contrast ` +
          `rules in globals.css will make it solid. If this is a SCRIM (a darkening layer over content, ` +
          `not a surface holding content), it must NOT be solid — add design-lint-allow WITH A REASON.`,
      )
      continue
    }

    /**
     * ⚠️ ANY MODIFIER AT ALL DISQUALIFIES THE TINT. `dark:bg-black/50`, `md:bg-card/70`,
     * `[data-open=true]:bg-black/50`, `!bg-black/40` and `bg-black/40!` each compile to a DIFFERENT
     * escaped selector that `.material.bg-black\/40` cannot match — so the surface would pass the
     * gate and stay transparent for the very user this exists for. Rather than enumerate Tailwind's
     * modifier syntax (which grows), require the token to be free-standing: whitespace or a string
     * edge on both sides, and nothing else.
     */
    let covered = false
    /**
     * ⚠️ THE COLOUR PART TAKES DIGITS AND ARBITRARY VALUES. `bg-[a-z-]+/N` cannot see
     * `bg-red-500/50` (digits in the palette step) or `bg-[var(--overlay)]/50`, so a material
     * carrying `dark:bg-red-500/50` alongside one covered tint was marked covered and its dark-mode
     * surface stayed translucent — precisely the state this gate exists to prevent.
     */
    for (const t of cls.matchAll(/bg-(?:\[[^\]\s]*\]|[a-z0-9-]+)\/[0-9]+/g)) {
      const before = t.index === 0 ? ' ' : cls[t.index - 1]
      const after = cls[t.index + t[0].length] ?? ' '
      const bare = /\s/.test(before) && /\s/.test(after)
      if (bare && MATERIAL_TINTS.has(t[0])) { covered = true; continue }
      n++
      console.error(
        `${rel}:${i + 1}  ${t[0]} on a material  — ` +
          (bare
            ? `this tint is NOT covered by the material block in globals.css, so a reduced-transparency ` +
              `user keeps the transparency. It cannot be fixed generically: removing the blur without ` +
              `raising the alpha makes text over a photo HARDER to read. Add \`${t[0]}\` to that block ` +
              `(tint at full opacity) and to MATERIAL_TINTS in this file.`
            : `it carries a MODIFIER (a variant prefix, or \`!\` important), which compiles to a different ` +
              `escaped selector that the material block cannot match. Put the tint on the material ` +
              `element bare.`),
      )
    }

    /**
     * ⛔ AND A MATERIAL WITH NO TINT AT ALL IS THE WORST CASE, not a harmless one: the rules strip
     * its blur and have no background to raise, so a reduced-transparency user is left with a MORE
     * transparent surface than before. Silent, and strictly a regression.
     */
    if (!covered) {
      n++
      console.error(
        `${rel}:${i + 1}  material with no covered background tint  — the rules would remove this ` +
          `surface's blur and have no background to make solid, leaving a reduced-transparency user ` +
          `WORSE off than before. Give it one of: ${[...MATERIAL_TINTS].join(', ')}.`,
      )
    }
  }
  return n
}

/**
 * ⛔ `tour-mask` IS A MATERIAL WHOSE TWO VALUES LIVE IN CSS — AND THAT IS EXACTLY WHY IT NEEDS ITS
 * OWN GUARD. The onboarding tour's four spotlight panels used to carry `bg-black/40 backdrop-blur-md`
 * like any other material, which meant the blocks in globals.css that force a material solid under
 * `prefers-contrast: more` also caught them: measured on an iPhone viewport, every panel came back
 * `rgb(0, 0, 0)` with the blur stripped, so four opaque rectangles around a small hole turned the
 * page black for anyone with Increase Contrast on. Going solid is right for a bar with text on it
 * and wrong for a mask, so `.tour-mask` owns its tint and blur and states its own accessible
 * fallback — a DEEPER but still translucent scrim.
 *
 * ⚠️ THE FAILURE THIS CATCHES IS A REVERSION, and it is invisible without the accessibility setting
 * turned on: someone tidies the mask by "restoring" a Tailwind tint or blur, the covered-tint rules
 * start matching again, and the blackout is back with every test still green. `checkMaterials`
 * cannot see it — that gate only reads lines carrying a `backdrop-blur` utility, which is precisely
 * what this element no longer has.
 */
/**
 * ⚠️ IT READS A WINDOW, NOT THE LINE AND NOT THE ENCLOSING STRING — and both of the simpler versions
 * were tried and shown to miss. Line-local misses `cn('tour-mask',\n  'bg-black/40')`, which a
 * formatter produces on its own. Enclosing-string ALSO misses it, and less obviously: the tint is a
 * SIBLING literal, so the span holding `tour-mask` never contains it. A reviewer proposed the second
 * fix for the first miss; running it showed it did not bite, which is why this reads the neighbourhood
 * instead — every string literal overlapping a window around the occurrence.
 * ⚠️ THE WINDOW IS A HEURISTIC AND THAT IS ACCEPTABLE HERE. `tour-mask` appears in exactly one file
 * and one expression, so the realistic failure this guards is "someone puts a tint back beside it",
 * not an adversarial layout. A false positive is a one-line lint message telling a developer to move
 * a value into `.tour-mask`, which is where it belongs anyway.
 */
const TOUR_MASK_WINDOW = 250
function checkTourMask(rel, code) {
  // ⚠️ CHEAP EXIT FIRST. `stringSpans` is a char-by-char pass over the whole file, and this lint runs
  // on every .tsx edit via a hook and at the head of every build — for a token that lives in one file.
  if (!code.includes('tour-mask')) return 0
  let n = 0
  const spans = stringSpans(code)
  for (const m of code.matchAll(/\btour-mask\b/g)) {
    const lo = m.index - TOUR_MASK_WINDOW
    const hi = m.index + TOUR_MASK_WINDOW
    const near = spans.filter(([a, b]) => a < hi && b > lo).map(([a, b]) => code.slice(a, b)).join(' ')
    const line = code.slice(0, m.index).split('\n').length
    // ⚠️ THE OPACITY IS OPTIONAL IN THIS PATTERN, deliberately: `bg-black` with no slash is a FULLY
    // opaque mask — worse than the bug this guards — and a reviewer pointed out the first version
    // could not see it, because it required the `/N`.
    for (const t of near.matchAll(/\b(bg-(?:\[[^\]\s]*\]|[a-z0-9-]+)(?:\/[0-9]+)?|backdrop-blur[a-z-]*)\b/g)) {
      n++
      console.error(
        `${rel}:${line}  \`${t[1]}\` beside \`tour-mask\`  — the mask owns its tint and blur in ` +
          `globals.css on purpose. A covered tint here is matched again by the material blocks, which ` +
          `force it to #000 under prefers-contrast/reduce-transparency and black out the whole page ` +
          `for the reader who asked for MORE contrast. Change the values in \`.tour-mask\` instead.`,
      )
    }
  }
  return n
}

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

// ── THE MONEY GATE ────────────────────────────────────────────────────────────────
// docs/design-language.md §2: money is formatted by `src/lib/vnd.ts` and by nothing else. That is
// not tidiness. Vietnamese groups thousands with a DOT and suffixes "đ"; English groups with a
// comma and suffixes "VND". Every hand-rolled formatter re-decides that, and they drift: an
// itinerary export shipped Intl's symbol-led "₫12,000,000"/"12.000.000 ₫" into a downloadable
// document while every screen it was exported FROM said "12,000,000 VND"/"12.000.000 đ", and a
// trip-budget hint pinned comma grouping for Vietnamese readers looking at dot-grouped đồng two
// lines above it. Both are fixed; this gate is what stops the third one.
//
// ⚠️ THIS GATE SEES .ts FILES, AND IT IS THE ONLY ONE THAT DOES. Rules 1–3 above walk .tsx only,
// which is correct for them (they are about markup) — but it means a .ts helper is INVISIBLE to
// this file's other checks, and that is exactly where the worst money bypass was hiding. The main
// loop below therefore walks both extensions and `continue`s past the markup rules for .ts.
//
// ⚠️ WHAT IT CANNOT SEE — do not trust it further than this:
//   · Money with no currency sigil ON THE SAME LINE. `src/lib/vnd.ts` exports `groupVnd()` for
//     grouping bare digits, and a call site that writes `new Intl.NumberFormat(…).format(n)` with
//     the "VND"/"đ" living in separate JSX is not matched. `price-range-filter.tsx` does precisely
//     that with the price-input display and this rule stays silent on it — a KNOWN uncovered
//     bypass, not a clean bill of health.
//   · A formatter and its sigil more than ~40–60 chars apart, or split across lines.
//   · Anything outside `src/`, and any .js/.mjs/.jsx/.cjs file anywhere.
//   · A `formatMoney`-shaped helper that hand-builds a string with no Intl call at all.
//   · `src/generated/prisma`, skipped by the walk (see the note there — it is the ONLY skip, and
//     the rest of `src/generated`, including the Vietnamese copy files, stays in scope).
//   · `style: 'currency'` is matched on the line alone, without proving an Intl call is on it.
//     In practice that string only ever appears in Intl options, and the whole tree yields three
//     hits, all real — but it is a line test, not a parse.
// And one shape that can FALSE-POSITIVE rather than miss: a regex replacement backreference
// (`.replace(/…/, '$1')`) reads as a `$`-before-digit sigil, so it would trip if it ever shared a
// line with a formatter. Measured: zero such lines in the tree today. If one appears, that is what
// the `design-lint-allow` line comment is for — do not widen the sigil to dodge it.
//
// The sigil test is deliberately narrow so it does not fire on dates (`toLocaleString` on a Date
// is everywhere in admin) or on non-money numbers (mileage, spec ranges, saved counts). Every
// boundary below was MEASURED against the whole tree, not reasoned about:
//   · `$` counts only before `${`, a digit, or a quote-then-operator (the `"$" + n.toLocale…`
//     concatenation shape). A regex literal's end-anchor (`/\.0$/`) is therefore not a currency
//     symbol — that exact false positive fired on range-facet-control.tsx in an earlier draft.
//   · ⚠️ THE `đ` TEST USES `(?!\p{L})` WITH THE `u` FLAG, NOT `\b`, AND THAT IS NOT PEDANTRY.
//     `\b` is ASCII-only and `đ` is not a word character, so ` đ\b` asserts a boundary that exists
//     only when the NEXT char is [A-Za-z0-9_] — i.e. it never matched the app's own "12.000.000 đ"
//     (đ before a quote or EOL) and DID match Vietnamese prose like " đang"/" đi". It was exactly
//     inverted: blind to money, noisy on copy. A reviewer caught it and the four cases above were
//     then run through both patterns to confirm before this was changed.
// ⚠️ AN ENTRY WITH NO `match` IS A WHOLE-FILE AMNESTY, so only the two files whose ENTIRE JOB is
// formatting money get one. Everything else names a `match`: a substring of the offending line,
// exactly as RAW_CONTROL_ALLOW does and for the same reason its comment gives — a blanket per-file
// exemption silently blesses the NEXT money string added to that file, which for an API route is
// a live possibility. Content match, never a line number.
const MONEY_ALLOW = [
  { file: 'src/lib/vnd.ts', reason: 'THE money formatter. Its Intl.NumberFormat calls are the ones every other file is supposed to route through — this is the gate\'s destination, not a violation. Whole-file: formatting money is the entire contents.' },
  { file: 'src/lib/currencies.ts', reason: 'formatMoney() for the dual-currency picker. It delegates every VND/₫ amount to vnd.ts and only reaches for Intl to render a FOREIGN display currency in its native symbol, which vnd.ts has no equivalent for. Whole-file for the same reason as vnd.ts; folding the two together is a real follow-up, not a rewrite this gate should force.' },
  { file: 'src/app/api/admin/ai-review/route.ts', match: 'const vnd = (n: number) =>', reason: 'Builds "<amount> VND" for the Gemini PROMPT that reviews a dispute — model input, never rendered to a user, so the vi/en separator question does not arise. Scoped to that one helper: the rest of the route is a normal API surface and any money it grows LATER should still trip this gate.' },
]
const MONEY_ALLOW_MAP = new Map()
for (const e of MONEY_ALLOW) {
  if (!MONEY_ALLOW_MAP.has(e.file)) MONEY_ALLOW_MAP.set(e.file, [])
  MONEY_ALLOW_MAP.get(e.file).push(e.match ?? null)
}

// A currency symbol/code used AS one — see the measured boundaries in the note above. The `\s*`
// after `$` covers the spaced form (`` `$ ${n}` ``, `'$ ' + n`), which a reviewer found slipping
// through the first draft's tighter lookahead.
const MONEY_SIGIL = String.raw`(?:\$(?=\s*(?:\$\{|\d|["']\s*[+,)\]]))|₫| đ(?!\p{L})|\bVND\b|\bUSD\b)`
const MONEY_FMT = String.raw`(?:toLocaleString|Intl\.NumberFormat)`
// Shape A: any Intl formatter asking for currency style, anywhere.
const MONEY_CURRENCY_RE = /style:\s*['"]currency['"]/
// Shape B: a number formatter sitting next to a currency sigil on the same line.
// `u` is REQUIRED — `\p{L}` in the đ test is a syntax error without it.
const MONEY_SIGIL_RE = new RegExp(
  `${MONEY_SIGIL}[^\\n]{0,40}?${MONEY_FMT}|${MONEY_FMT}[^\\n]{0,60}?${MONEY_SIGIL}`,
  'u',
)

function checkMoney(rel, codeLines, rawLines) {
  const allowed = MONEY_ALLOW_MAP.get(rel)
  // A `null` in the list is the whole-file entry; otherwise every hit must match a signature.
  if (allowed?.includes(null)) return 0
  let n = 0
  codeLines.forEach((line, i) => {
    if (rawLines[i]?.includes('design-lint-allow')) return
    if (!MONEY_CURRENCY_RE.test(line) && !MONEY_SIGIL_RE.test(line)) return
    if (allowed?.some((sig) => sig && line.includes(sig))) return
    n++
    console.error(
      `${rel}:${i + 1}  money formatted outside src/lib/vnd.ts  — vnd.ts is the ONE formatter ` +
        `(docs/design-language.md §2): formatMoneyFull · formatUsdCents · compactPrice · groupVnd · ` +
        `vndWords, each taking the MoneyLocale from moneyLocale(lang). A hand-rolled Intl call ` +
        `re-decides the vi/en separator question — Vietnamese groups thousands with a DOT and ` +
        `suffixes "đ" — and every hand-roll has eventually disagreed with the screen beside it. ` +
        `If this genuinely is not user-facing money, add it to MONEY_ALLOW in this file WITH A REASON.`,
    )
  })
  return n
}

/**
 * ⚠️ THE APP SHIPS TWO FONT FILES — 400 AND 700 — SO A RAW 500 OR 600 REQUESTS A FACE THAT IS NOT
 * THERE (owner, 2026-08-13: "drop font weights to 2 bold for prices and bold parts and normal
 * else"). It does not fail visibly: CSS font-matching quietly resolves 500 down to 400 and 600 up
 * to 700, so the glyphs look plausible and only the computed style disagrees with the file. That is
 * the worst shape a regression can take — a number in the source that is not the number that
 * paints. globals.css `@theme` maps the two tiers ON PURPOSE (`--font-weight-medium: 400`,
 * `--font-weight-semibold: 700`); this refuses any OTHER site from re-deciding it by hand.
 *
 * The Tailwind CLASSES stay legal — `font-medium` and `font-semibold` are exactly how a call site
 * should name the tier, and they now resolve through the retargeted tokens. Only a hardcoded
 * numeric weight is refused, in CSS (`font-weight: 600`) and in JSX (`fontWeight: 600`,
 * `fontWeight="600"` — SVG <text> takes it as an attribute).
 *
 * If a middle weight is genuinely wanted again, add the woff2 back in scripts/gen-fonts.sh AND
 * src/app/layout.tsx AND drop its retarget — then this rule can go. Do not silence it alone; that
 * only restores the mismatch it exists to catch.
 */
const SHIPPED_FONT_WEIGHTS = new Set(['400', '700'])
// ⚠️ `(?!\d)` — WITHOUT IT, `font-weight: 1000` MATCHES ITS FIRST THREE DIGITS and gets reported as
// a bogus "font-weight 100". Caught reviewing the rule; 1000 is a legal CSS value even though this
// app has none.
const FONT_WEIGHT_RE = /font-weight:\s*(\d{3})(?!\d)|fontWeight[:=]\s*["'{]?\s*(\d{3})(?!\d)/g

/**
 * ⚠️ EMAIL IS NOT THE APP, AND THIS EXEMPTION IS THE WHOLE REASON THE RULE IS SAFE TO TURN ON.
 * `src/lib/emails/*` builds HTML for Gmail, Outlook and Apple Mail. Those clients never load
 * eno's webfont — a mail template cannot preload a woff2 and would not be allowed to — so they
 * render in the recipient's own stack, where 600 and 800 are ordinary requests that the client
 * matches or synthesises itself. Linting them against what eno.vn ships would be flagging a value
 * for a constraint that does not exist there, and the only way to "fix" it would be to make the
 * emails worse. Caught by the rule's own first run: 8 of its 10 initial hits were mail templates.
 */
const FONT_WEIGHT_ALLOW_RE = /^src\/lib\/emails\//

function checkFontWeights(rel, codeLines, rawLines) {
  if (FONT_WEIGHT_ALLOW_RE.test(rel)) return 0
  let n = 0
  codeLines.forEach((line, i) => {
    if (rawLines[i]?.includes('design-lint-allow')) return
    for (const m of line.matchAll(FONT_WEIGHT_RE)) {
      const w = m[1] ?? m[2]
      if (SHIPPED_FONT_WEIGHTS.has(w)) continue
      n++
      console.error(
        `${rel}:${i + 1}  font-weight ${w}  — the app ships only 400 and 700 (Open Runde is not a ` +
          `variable font, so each weight is a separate ~64 KB preload). ${w} silently resolves to ` +
          `${Number(w) < 500 || w === '500' ? '400' : '700'} instead. Use the font-normal/font-bold ` +
          `classes, or the retargeted font-medium/font-semibold, so the tier is named rather than ` +
          `numbered. See the @theme note in src/app/globals.css.`,
      )
    }
  })
  return n
}

/**
 * ⚠️ TAILWIND v4 SPLIT `transform` INTO `translate` / `scale` / `rotate`, AND A HAND-WRITTEN
 * TRANSITION LIST THAT STILL SAYS `transform` ANIMATES NOTHING.
 *
 * `-translate-y-full` compiles to `translate: var(--tw-translate-x) var(--tw-translate-y)` and
 * `active:scale-[0.96]` to `scale: …` — the standalone properties, NOT the `transform` shorthand
 * (verified in the built CSS, not inferred). So `transition-[transform,opacity]` on an element that
 * moves via those utilities subscribes to a property nothing ever writes: the movement lands in ONE
 * frame while whatever else is in the list tweens normally. It does not throw, it does not look like
 * a bug in review, and it reads on screen as the element snapping or jittering.
 *
 * This was not hypothetical — a multi-agent sweep found it on TEN call sites at once, including the
 * sticky header and the mobile tab bar, i.e. the two largest surfaces on the site, on every
 * scroll-direction reversal. The repo already documented the trap in four separate comments
 * (ui/button.tsx, ui/sticky-action-bar.tsx, pdp-shop-link.tsx, globals.css §motion) and it kept
 * happening anyway, which is the definition of something that needs a gate rather than a note.
 *
 * The rule is deliberately narrow: it fires only when a line names `transform` inside a
 * `transition-[…]` AND uses a `scale-`/`translate-` utility on that same line, and only when the
 * list does NOT already name the matching property. Prefer `.press` or the primitive's own
 * transition over hand-writing a list at all.
 */
const TRANSITION_LIST_RE = /transition-\[([^\]]*)\]/
// ⚠️ GLOBAL, AND EVERY MATCH IS CHECKED — NOT JUST THE FIRST. agy caught this on the review of the
// rule itself: `transition-[transform,scale] scale-95 translate-y-4` used to match `scale`, find
// `scale` in the list and return, silently passing a line where `translate` is still unanimated.
// ⚠️ `rotate` IS IN THE SET TOO. The doc comment above always named all three properties v4 split
// out; the first version of this regex only hunted two of them, which opus caught.
// (opus also reported that `group-hover:-translate-y-0.5` escapes this pattern. Measured against
// the actual regex: it does NOT — the leading character class includes `:`, so the match can begin
// at the variant's own colon and the `-?` then takes the minus. Left as-is on the evidence.)
const MOVES_VIA_SPLIT_RE = /(?:^|[\s:'"`])-?(?:group-hover:|hover:|focus:|focus-visible:|active:|data-\[[^\]]*\]:|[a-z]+:)*(scale|translate|rotate)-/g

/**
 * ⚠️ IT SCANS A WINDOW, NOT ONE LINE, AND THE FLAGSHIP CASE IS WHY. The first version required the
 * `transition-[…]` and the `scale-`/`translate-` utility on the SAME physical line — and opus
 * pointed out, correctly, that neither of the two worst real offenders looks like that. In
 * header.tsx and mobile-nav.tsx the transition sits on one argument of a `cn()` call and the
 * movement on the next:
 *     'sticky top-0 … transition-[translate,opacity] …',
 *     hidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100',
 * A gate that cannot see its own motivating case is theatre. The window is the rest of the class
 * expression, bounded: from the transition line to whichever comes first of a closing `)` at the
 * `cn(` indent, a blank line, or WINDOW lines. That is a heuristic — a `cn()` describing two
 * different elements could pair a transition with an unrelated sibling's translate — so the escape
 * hatch is the usual trailing `design-lint-allow` on the offending line.
 */
const TRANSITION_WINDOW = 12

function checkTransitionProps(rel, codeLines, rawLines) {
  let n = 0
  codeLines.forEach((line, i) => {
    if (rawLines[i]?.includes('design-lint-allow')) return
    const list = line.match(TRANSITION_LIST_RE)
    if (!list || !list[1].includes('transform')) return
    // Gather the movement utilities on this line AND the following few, stopping at a blank line
    // so the scan cannot wander out of the class expression into unrelated JSX.
    let scanned = line
    for (let j = i + 1; j < Math.min(codeLines.length, i + TRANSITION_WINDOW); j++) {
      if (!codeLines[j].trim()) break
      // A new top-level declaration or a new capitalised JSX element means we have left this
      // element's class expression; without this the window bled into the NEXT component and
      // reported its utilities against this one's transition (seen while testing the rule).
      if (/^\s*(export|const|function|class|return)\b|^\s*<[A-Z]/.test(codeLines[j])) break
      if (rawLines[j]?.includes('design-lint-allow')) continue
      scanned += '\n' + codeLines[j]
      if (/^\s*\)/.test(codeLines[j])) break
    }
    const missing = [...new Set([...scanned.matchAll(MOVES_VIA_SPLIT_RE)].map((m) => m[1]))]
      .filter((prop) => !list[1].includes(prop))
    for (const prop of missing) {
      n++
      console.error(
        `${rel}:${i + 1}  transition-[${list[1]}] with a \`${prop}-\` utility  — Tailwind v4 compiles ` +
          `\`${prop}-*\` to the standalone \`${prop}\` property, NOT \`transform\`, so this transition ` +
          `subscribes to something nothing writes and the movement happens in one frame. Name ` +
          `\`${prop}\` in the list (or drop the hand-written list and use \`.press\`).`,
      )
    }
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
    // §1 caps the markup scale at 3xl/30px and routes anything larger through the FLUID
    // `.h-display` class. Rule 1 above never enforced that: it bans arbitrary bracket sizes
    // (`text-[13px]`), and a canonical Tailwind step one notch too far is not arbitrary — it is
    // a perfectly valid utility that simply is not on this app's scale. So the cap was prose
    // only, and prose lost: `signin/page.tsx` carried the app's one off-scale heading for
    // months, passing this gate every single run. A reviewer put it exactly right — either the
    // rule does not catch it or a stale exemption exists; it was the former.
    //
    // Fixing the heading without fixing the hole would have left the next one free to land.
    // Zero violations at the time this was added (measured across all of src, responsive
    // prefixes included), so it costs nothing today and refuses the drift tomorrow.
    // Written as a character range rather than spelled out: Tailwind scans raw TEXT, so a
    // literal class name in this file would be a candidate emitted into the bundle.
    name: 'off-scale heading — the type scale stops at 3xl/30px; use the fluid .h-display class (docs/design-language.md §1)',
    re: /(?<![-\w])text-[4-9]xl(?![-\w])/g,
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

/**
 * ⚠️ `*.test.tsx` IS SKIPPED, AND THE REASON IS THAT THIS LINTER GUARDS SHIPPED UI.
 * Every rule here — use the primitive, tokens not hex, no raw control — is about what a user sees.
 * A test renders FIXTURES: a bare `<textarea>` next to the component under test exists to receive
 * focus, not to be designed, and routing it through `ui/textarea` would couple a behavioural test to
 * a primitive's styling for no gain. Added 2026-08-05 when the first component test in the repo was
 * blocked for exactly that, plus a second hit on the word `<button>` inside a PROSE COMMENT — the
 * comment-stripping runs on JSX, not on a sentence describing JSX.
 *
 * This does not weaken the canon: a test file ships to nobody, and the components it exercises are
 * still linted in their own files. If a test ever needs to assert something ABOUT the design system,
 * assert it against the primitive's own file rather than re-declaring markup here.
 *
 * ⚠️ THIS NOW YIELDS .ts AS WELL AS .tsx, AND ONLY THE MONEY GATE READS THE .ts FILES.
 * It was .tsx-only until 2026-08-11, and that limit was invisible from the outside: the money
 * rule would have looked like a working ban on hand-rolled Intl formatters while being
 * structurally incapable of opening `src/lib/itinerary-docx.ts`, the file with the worst
 * instance in the repo. Widening the walk is the fix; widening the RULES is not — running the
 * markup rules over .ts was measured first and produces 28 hits across 522 files, essentially
 * all legitimate (email HTML has no stylesheet and no tokens, `manifest.ts` theme colours,
 * canvas drawing code, and the literal word "rounded" inside prompt/copy strings). Buying that
 * would mean eight new blanket per-file hex exemptions to catch nothing. So the main loop
 * `continue`s past every markup rule for a .ts file — see the guard, which is the enforcement
 * of this paragraph.
 */
const isMarkupFile = (p) => p.endsWith('.tsx')
// ⚠️ EXACTLY ONE DIRECTORY IS SKIPPED, AND IT IS MATCHED BY PATH, NOT BY BASENAME.
// `src/generated/prisma` is the Prisma client: machine-written, rewritten by every
// `prisma generate`, so a violation there could not be fixed — only allowlisted, and it would come
// back. In a git worktree it is also a SYMLINK to the primary checkout, and `statSync` follows
// symlinks: measured, the walk yields 850 files with it and 790 without, i.e. 60 files that are
// not even in this checkout. That mattered only once .ts entered scope; the client emits no .tsx,
// which is why nobody noticed before.
//
// ⚠️ IT DOES NOT SKIP `src/generated` — do not "simplify" this to the basename `generated`.
// That directory ALSO holds `ui-strings.ts`, `ui-strings.services.ts` and `vi-overrides.ts`: the
// app's Vietnamese copy, which is generated by a pipeline but is real shipped content and exactly
// the kind of file a money-shaped string would hide in. A basename skip would have made all three
// invisible to every rule here, silently. (Measured: they contain 0 money-gate hits today — so
// keeping them in scope is free, and losing them would have cost coverage for nothing.)
const SKIP_DIRS = new Set(['src/generated/prisma'])
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(relative(ROOT, p))) yield* walk(p) }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) yield p
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
  // The money gate runs on BOTH extensions — it is about values, not markup. Everything after
  // the guard below is markup-only and must not see a .ts file (see the note on walk()).
  violations += checkMoney(rel, lines, rawLines)
  // Same reasoning: a hardcoded weight is about a VALUE, so it is checked on .ts too (SVG <text>
  // and inline styles both live outside .tsx in places). The stylesheet is swept separately below
  // — walk() yields only .tsx?, and widening it would hand every markup rule a CSS file.
  violations += checkFontWeights(rel, lines, rawLines)
  if (!isMarkupFile(file)) continue
  violations += checkTransitionProps(rel, lines, rawLines)
  violations += checkRawControls(rel, lines, rawLines)
  violations += checkPortals(rel, lines, rawLines)
  violations += checkScrollBehavior(rel, lines, rawLines)
  violations += checkMaterials(rel, lines, rawLines)
  violations += checkTourMask(rel, code)
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

// ── the stylesheet ───────────────────────────────────────────────────────────────────────────
// Swept on its own rather than through walk(): walk() yields .tsx? because every rule above reads
// markup, and widening it to .css would hand a stylesheet to the raw-control, portal and JSX-comment
// gates. Only the value-shaped check applies here. Globbed rather than hardcoded to globals.css so
// a second stylesheet is covered the day it appears instead of the day someone remembers.
function* walkCss(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(relative(ROOT, p))) yield* walkCss(p) }
    else if (name.endsWith('.css')) yield p
  }
}
for (const file of walkCss(SRC)) {
  const rel = relative(ROOT, file)
  const raw = readFileSync(file, 'utf8')
  const rawLines = raw.split('\n')
  // ⚠️ stripComments() is written for // and /* */ in TS; a CSS file has only the block form and
  // the same helper handles it, so the @theme note explaining the retarget does not trip its own rule.
  violations += checkFontWeights(rel, stripComments(raw).split('\n'), rawLines)
}

if (violations) {
  console.error(`\ndesign-lint: ${violations} violation(s). See docs/design-language.md.`)
  process.exit(1)
}
console.log('design-lint: clean')
