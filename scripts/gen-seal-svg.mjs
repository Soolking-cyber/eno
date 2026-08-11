#!/usr/bin/env node
/**
 * THE ENO SEAL AS THREE STANDALONE FILES — GENERATED, NEVER DRAWN BY HAND.
 *
 *     node scripts/gen-seal-svg.mjs          # write public/seal{,-line,-white}.svg
 *     node scripts/gen-seal-svg.mjs --check  # exit 1 if any file is stale (CI/pre-flight)
 *
 * ⚠️ WHY THIS EXISTS: A SEAL THAT DRIFTS IS A COUNTERFEIT (docs/icon-language.md §0b).
 * The geometry lives in exactly one place — the three paths exported by
 * src/components/marketplace/eno-seal.tsx — and everything the app renders imports them.
 * A standalone .svg cannot import, so the moment someone traces one by hand it becomes a
 * second source of truth that nothing updates: the component gets a nudge, the file keeps
 * the old shape, and the marketplace ships two subtly different seals. That already
 * happened once INSIDE the app (safety-strip.tsx hand-rolled the mark and inherited a
 * miter spike for four days), which is the whole reason this script parses the component
 * rather than restating it. src/lib/seal-assets.test.ts re-runs the same generation in CI
 * and fails if these files differ, so "edited the paths, forgot to regenerate" is a red
 * test rather than three stale assets in production.
 *
 * ⚠️ THE MARK IS RESERVED, AND THE FILES INHERIT THAT. The seal means FIRST-PARTY trust —
 * trust score, protections, fee safety, verification (§0b). It is not a decoration and it
 * is not a slot: never hand seal.svg to a partner, an advertiser or a third-party badge,
 * and never stamp it on an enforcement/suspension surface (the interior is a CHECK, and a
 * check asserts "verified"). Each generated file repeats this in its own header, because
 * the person who drops an asset into a deck will never open this script.
 *
 * ⚠️ THE INTERIOR IS A CHECK. The bar (`SEAL_BAR`) was deleted on 2026-08-11 and must not
 * come back in any form — see §0b. This script asserts the component still exports the
 * three current paths and refuses to emit anything it cannot find.
 *
 * NOTHING HERE IS GUESSED — every value is read back out of the tree:
 *   · the three path `d` strings ......... src/components/marketplace/eno-seal.tsx
 *   · the stroke tier (STROKE_UI) ........ src/lib/icon-tokens.ts
 *   · the wash class (WASH) .............. src/lib/icon-tokens.ts  → its CSS variable
 *   · the hexes behind those variables ... src/app/globals.css (`:root`, the LIGHT theme)
 * The one authored decision is the INK, and it is authored because it has to be: the
 * component strokes `currentColor` and inherits its ink from the call site, which a file
 * opened outside the app has no way to resolve. These files therefore BAKE the ink —
 * `--brand` for wash/line, white for seal-white.svg.
 *
 * ⚠️ BAKED, NOT `currentColor` + a `color` attribute — WHICH IS WHAT THE FIRST DRAFT DID
 * AND A REVIEWER KILLED. `color` is a valid SVG presentation attribute and every browser
 * and librsvg honour it (measured: seal-white.svg rasterises to rgb(255,255,255)), but the
 * consumers these files exist FOR are not browsers: Figma, Illustrator and slide-deck SVG
 * import drop it and fall back to black. That turns seal-white.svg — the one variant whose
 * entire job is dark and photographic grounds — into a black mark on a dark ground, i.e.
 * invisible, in the exact place someone would use it. Themed ink is what `<EnoSeal>` is
 * for; a file is for everywhere the component cannot go, and it must survive the trip.
 *
 * ⚠️ TWO LIMITS THAT COME WITH BAKING, STATED SO NOBODY REDISCOVERS THEM AS BUGS:
 *   · A static file has no theme. These carry the LIGHT `:root` values, and the dark case
 *     is a separate file (seal-white.svg) rather than a media query — an inlined seal.svg
 *     will NOT follow `.dark`. Inside the app, render <EnoSeal>; that is not a workaround,
 *     it is the rule (§0b: never redraw the seal locally).
 *   · Inlining a baked file cannot be re-inked with a `text-*` class. Also deliberate: an
 *     asset that can be recoloured is an asset that can be dressed up as another tier.
 *
 * ⚠️ ONE GAP THAT IS REAL AND NOT CLOSED HERE: THE DRIFT GUARD IS A TEST, AND TESTS ARE NOT
 * ON THE DEPLOY PATH. `npx vitest run` runs in GitHub Actions; a push builds and ships via
 * Cloud Build, which runs `npm run build` → design-lint + edition-lint + next build. So a
 * drifted seal fails CI and still deploys. The one-line close is to add
 * `node scripts/gen-seal-svg.mjs --check` to the `lint` script in package.json (it is why
 * `--check` exists, and it needs no network and no DB). That file was outside this change's
 * allowlist, so the gap is written down here rather than half-closed.
 *
 * FOUR THINGS REVIEWERS RAISED AND MEASUREMENT REFUTED, RECORDED SO THE NEXT ROUND DOES
 * NOT SPEND ITSELF ON THEM AGAIN:
 *   · "aria-label should say verified, not eno." The app is bilingual and a file cannot call
 *     tr(); an English "verified" would be wrong on every VI page, and an <img> takes its
 *     accessible name from the EMBEDDER's alt anyway. The label is the brand name — language
 *     neutral, and the same choice public/logo-mark.svg already made.
 *   · "a seller could embed /seal.svg in a listing to counterfeit trust." Measured: listing
 *     descriptions are parsed into known React elements with escaped text and NO
 *     dangerouslySetInnerHTML (listing-content.tsx), so user text cannot emit an <img> at
 *     all. The seal is also already inline in the DOM of every page that renders it.
 *   · "nothing proves the test runs in CI." .github/workflows/ci.yml runs `npx vitest run`,
 *     and vitest's include glob is src/**\/*.test.ts — which is why the test lives in src/lib
 *     rather than next to this script.
 *   · "CRLF checkouts will see every file as stale." True in principle and left alone: the
 *     repo carries no .gitattributes and has no Windows developer, so normalising line
 *     endings on read would blind a real byte comparison to protect a machine that does not
 *     exist. If one ever does, the fix is `*.svg -text` in .gitattributes, not here.
 *
 * ⚠️ RE-RUNNABLE AND BYTE-STABLE, BY CONSTRUCTION. The output is a pure function of the
 * three source files: no timestamp, no version stamp, no hostname, no map iteration order,
 * fixed attribute order, LF newlines, exactly one trailing newline. Regenerating without a
 * source change therefore produces identical bytes — and the writer compares before it
 * writes, so an unchanged file is not even touched (no mtime churn in a watch/dev loop).
 * If you add anything to the output, add it deterministically or the test below becomes a
 * coin flip.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The three files this script reads. Nothing else may influence the output. */
export const SOURCES = {
  component: 'src/components/marketplace/eno-seal.tsx',
  tokens: 'src/lib/icon-tokens.ts',
  css: 'src/app/globals.css',
}

/**
 * variant → generated file. The keys are the seal's rendering treatments:
 *   wash  — tinted chief + line, `<EnoSeal>`'s default; neutral LIGHT surfaces.
 *   line  — pure line, no chief; `<EnoSeal variant="line">`.
 *   white — the line treatment in white ink, for dark or photographic grounds.
 * ⚠️ WHITE IS THE LINE TREATMENT ON PURPOSE, NOT AN OVERSIGHT. §0b's echo ladder sends
 * every NON-NEUTRAL surface to the line variant: a brand-100 chief over a photo or a dark
 * panel is a pale smear that reads as a rendering fault, and the ink alone already carries
 * the mark. A "wash on white" file would be a fourth treatment the component cannot render.
 */
export const SEAL_FILES = {
  wash: 'public/seal.svg',
  line: 'public/seal-line.svg',
  white: 'public/seal-white.svg',
}

/** The CSS variable the standalone files bake as their ink (see the header). */
const INK_TOKEN = 'brand'
/** White ink is surface-independent — it is not a theme token and must not become one. */
const WHITE_INK = '#ffffff'
/** The 24-grid (docs/icon-language.md §1). The viewBox is authoritative; these are hints. */
const BOX = 24

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Strip block comments and whole-line `//` comments before pattern-matching.
 * eno-seal.tsx is more comment than code — its header discusses `SEAL_BAR`,
 * `strokeLinecap` and the old geometry in prose — and every assertion below would happily
 * match that prose and conclude the wrong thing about the code.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** `export const NAME = '…'` → the string. Throws rather than emitting a seal without it. */
export function readStringConst(source, name) {
  const m = stripComments(source).match(new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`))
  if (!m) throw new Error(`gen-seal-svg: ${name} is not exported as a single-quoted string constant`)
  return m[1]
}

/**
 * Path data is interpolated straight into an XML attribute, so it is CHECKED, not escaped.
 *
 * ⚠️ A `"` OR A `<` IN A PATH CONSTANT WOULD NOT BE A STYLING BUG. It would close the
 * attribute and let the rest of the string become markup — in a file served from our own
 * origin, which is the stored-XSS shape. Escaping would dutifully preserve such a value;
 * refusing is correct, because there is no legitimate SVG path containing either.
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT PROMISE, because an earlier version of this comment said
 * "a corrupted one never gets written" and a reviewer was right to call that overclaiming.
 * It guarantees the value cannot escape its attribute, and it catches the gross shapes (no
 * moveto, no coordinates). It is NOT a path-grammar parser: `M1,,2` or a half-written arc
 * still pass, and the thing that catches those is the eye — every change here is looked at
 * rendered, and the byte-compare then pins whatever was approved.
 */
export function assertPathData(name, d) {
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE\s]+$/.test(d)) {
    throw new Error(`gen-seal-svg: ${name} contains characters that are not SVG path data — refusing to write it into an attribute`)
  }
  // Every path starts with a moveto and every real one carries coordinates; a constant that
  // has been half-deleted usually fails one of these.
  if (!/^[Mm]/.test(d.trim()) || !/\d/.test(d)) {
    throw new Error(`gen-seal-svg: ${name} is not a drawable path (it must start with a moveto and carry coordinates)`)
  }
  return d
}

/** `export const NAME = 2` → the number (the stroke tier lives in icon-tokens, not here). */
export function readNumberConst(source, name) {
  const m = stripComments(source).match(new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`))
  if (!m) throw new Error(`gen-seal-svg: ${name} is not exported as a numeric constant`)
  return Number(m[1])
}

/**
 * A hex from the `:root` block of globals.css — i.e. the LIGHT theme.
 *
 * ⚠️ SCOPED TO `:root` DELIBERATELY. `.dark` redefines both tokens we read (--brand and
 * --brand-100), so a whole-file search would return whichever the file happens to declare
 * first and silently make the answer depend on edit order. A static asset has no theme to
 * follow, so it takes the light values and seal-white.svg covers the dark case.
 */
export function readRootToken(rawCss, name) {
  // ⚠️ COMMENTS FIRST, AND FOR TWO REASONS. globals.css is heavily commented: a `}` inside a
  // comment derails the brace scan below, and a commented-out `/* --brand: #old; */` left in
  // `:root` makes the count 2 and aborts generation with a message about duplicates —
  // blaming the wrong thing, which is worse than not checking at all.
  const css = stripComments(rawCss)
  // Line-anchored rather than `indexOf('\n:root {')`: the literal form misses a `:root`
  // sitting on line 1 and tolerates no whitespace variation, and failing to FIND the block
  // is indistinguishable from the file not having one.
  const start = css.search(/^:root\s*\{/m)
  if (start < 0) throw new Error('gen-seal-svg: globals.css has no top-level `:root {` block')
  // ⚠️ BRACE DEPTH, NOT `indexOf('\n}')`. The cheap version ends the block at the first
  // line-initial `}`, so it needs the closer to be unindented and the block to nest nothing —
  // two assumptions about a 1150-line stylesheet that no one editing it would know they were
  // holding. It also breaks on CRLF. A depth scan is four lines and holds regardless.
  let end = -1
  for (let i = css.indexOf('{', start), depth = 0; i < css.length && i > -1; i++) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && --depth === 0) { end = i; break }
  }
  if (end < 0) throw new Error('gen-seal-svg: the `:root {` block in globals.css is not closed')
  const block = css.slice(start, end)
  // The value runs to `;`, end of line, or the block's `}` — the last declaration in a CSS
  // block is allowed to drop its semicolon, and demanding one would read the token as absent
  // rather than as unterminated.
  const declared = [...block.matchAll(new RegExp(`--${name}:\\s*([^;\\n}]+)`, 'g'))].map((m) => m[1].trim())
  // Two hits means the slice swallowed a second block (the light/dark pairs are identical
  // in name), and picking one of them at random is exactly the drift this file exists to stop.
  if (declared.length !== 1) {
    throw new Error(`gen-seal-svg: expected exactly one --${name} in :root, found ${declared.length}`)
  }
  // ⚠️ A HEX IS A REQUIREMENT OF THE ARTEFACT, NOT A LIMITATION OF THIS PARSER — so the value
  // is read first and rejected with its actual content. A static file gets opened by design
  // tools, old rasterisers and email clients; `oklch()`, `color-mix()` or a `var()` chain
  // resolves to nothing there and the mark disappears. If the palette moves to a modern
  // colour space, this asset needs a converted hex, not a looser regex.
  // 3, 4, 6 or 8 digits — the only lengths CSS defines. `{3,8}` also accepts `#12345` and
  // `#1234567`, which are not colours: a browser drops the whole declaration and the mark
  // renders black or not at all, which is precisely the silent-wrong-output case this file
  // is built to make impossible.
  if (!/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(declared[0])) {
    throw new Error(`gen-seal-svg: --${name} is "${declared[0]}", and a standalone asset needs a plain hex — convert it here rather than emitting a value the renderer may not support`)
  }
  return declared[0]
}

/** Every `<path …/>` in the component, comments removed. */
function pathTags(component) {
  return stripComments(component).match(/<path[\s\S]*?\/>/g) ?? []
}

/**
 * The two stroked paths, in paint order, with their round caps VERIFIED.
 *
 * ⚠️ THIS ASSERTION IS THE POINT, NOT PARANOIA. `strokeLinecap` without `strokeLinejoin`
 * shipped a MITER SPIKE on the check's vertex (§0b): the old bar was one straight segment
 * with no interior vertex, so the missing join was invisible until the check replaced it.
 * The files must set whatever the component sets, so the generator refuses to write rather
 * than bake a treatment the component no longer uses.
 */
export function readStrokeTreatment(component) {
  const stroked = pathTags(component).filter((t) => t.includes('stroke="currentColor"'))
  if (stroked.length !== 2) {
    throw new Error(`gen-seal-svg: expected 2 currentColor-stroked paths in the seal, found ${stroked.length}`)
  }
  const order = ['SEAL_OUTLINE', 'SEAL_CHECK']
  return stroked.map((tag, i) => {
    if (!tag.includes(`d={${order[i]}}`)) {
      throw new Error(`gen-seal-svg: stroked path ${i + 1} is not ${order[i]} — paint order changed`)
    }
    for (const attr of ['strokeLinecap', 'strokeLinejoin']) {
      const m = tag.match(new RegExp(`${attr}="([^"]+)"`))
      if (!m) throw new Error(`gen-seal-svg: ${order[i]} has no ${attr} (the check's vertex needs a round JOIN, not just a cap)`)
      if (m[1] !== 'round') throw new Error(`gen-seal-svg: ${order[i]} sets ${attr}="${m[1]}" — icon-language §3 requires round`)
    }
    if (!tag.includes('fill="none"')) throw new Error(`gen-seal-svg: ${order[i]} is not fill="none"`)
    return { path: order[i], linecap: 'round', linejoin: 'round' }
  })
}

/**
 * The wash class on the chief, plus the proof that only the WASH variant paints it.
 * The component gates the chief behind `variant === 'wash'`; the line and white files omit
 * it for that reason and not because this script decided to.
 */
export function readChiefTreatment(component, wash) {
  const src = stripComments(component)
  // Tolerant of whitespace AND attribute order: a formatter may break this JSX across lines,
  // and a `key`/`aria-hidden` may legitimately precede `d`. What must not change silently is
  // WHICH variant paints the chief, so that is all this insists on.
  if (!/variant\s*===\s*'wash'\s*&&\s*<path\b[^>]*d=\{SEAL_CHIEF\}/.test(src)) {
    throw new Error('gen-seal-svg: the chief is no longer gated behind `variant === \'wash\'` — re-read the component before generating')
  }
  const tag = pathTags(component).find((t) => t.includes('d={SEAL_CHIEF}'))
  // ⚠️ `className={WASH}` IS ACCEPTED, NOT JUST THE LITERAL. Importing the token is the
  // BETTER form of this code, and a generator that hard-fails on the improvement teaches
  // people to leave the worse version alone.
  if (tag && /className=\{WASH\}/.test(tag)) return wash
  const m = tag?.match(/className="([^"]+)"/)
  if (!m) throw new Error('gen-seal-svg: the chief path carries no className (expected the WASH token or its literal class)')
  if (m[1] !== wash) {
    throw new Error(`gen-seal-svg: the chief washes with "${m[1]}" but icon-tokens' WASH is "${wash}"`)
  }
  return m[1]
}

/** `fill-brand-100` → `brand-100`, the CSS variable behind the wash. */
export function washVariable(washClass) {
  if (!washClass.startsWith('fill-')) {
    throw new Error(`gen-seal-svg: WASH ("${washClass}") is not a fill-* class, so it names no CSS variable`)
  }
  return washClass.slice('fill-'.length)
}

/**
 * Everything the three files are made of, resolved from source text.
 * Pure: same inputs → same spec → same bytes. The test feeds it the real files.
 */
export function collectSealSpec({ component, tokens, css }) {
  const wash = readStringConst(tokens, 'WASH')
  const [outlineStroke] = readStrokeTreatment(component)
  const path = (name) => assertPathData(name, readStringConst(component, name))
  return {
    outline: path('SEAL_OUTLINE'),
    check: path('SEAL_CHECK'),
    chief: path('SEAL_CHIEF'),
    strokeWidth: readNumberConst(tokens, 'STROKE_UI'),
    linecap: outlineStroke.linecap,
    linejoin: outlineStroke.linejoin,
    washHex: readRootToken(css, washVariable(readChiefTreatment(component, wash))),
    inkHex: readRootToken(css, INK_TOKEN),
  }
}

/** Read the three sources off disk in one place, so nothing else has to know the paths. */
export function readSealSources() {
  return { component: read(SOURCES.component), tokens: read(SOURCES.tokens), css: read(SOURCES.css) }
}

const VARIANT_NOTE = {
  wash: 'wash — brand-tinted chief under the line. Neutral LIGHT surfaces.',
  line: 'line — no chief. Uniform icon sets, and any tinted or coloured panel.',
  white: 'white — the line treatment in white ink. Dark or photographic grounds.',
}

/**
 * The banner every generated file carries.
 * ⚠️ NO `--` ANYWHERE IN HERE: a double hyphen terminates an XML comment, so a token
 * written the CSS way ("--brand-100") would produce an .svg that no parser will open.
 * renderSealSvg() asserts this rather than trusting whoever edits the strings next.
 */
function banner(variant) {
  return [
    'GENERATED FILE. DO NOT EDIT, AND DO NOT TRACE IT BY HAND.',
    'Written by scripts/gen-seal-svg.mjs from the paths exported by',
    'src/components/marketplace/eno-seal.tsx. Change the component, then re-run',
    'the script; src/lib/seal-assets.test.ts fails CI when these bytes drift.',
    '',
    `Variant: ${VARIANT_NOTE[variant]}`,
    '',
    'RESERVED MARK: the eno seal stands for FIRST-PARTY trust (trust score,',
    'protections, fee safety, verification) per docs/icon-language.md §0b. It is',
    'not decoration and not a slot: never place it beside a partner, advertiser',
    'or third-party claim, and never on an enforcement or suspension surface —',
    'its interior is a check, and a check asserts "verified".',
  ]
}

/**
 * One variant → one SVG document. Attribute order is fixed and hand-written (not derived
 * from an object) so the bytes cannot move when someone reorders a literal.
 */
export function renderSealSvg(variant, spec) {
  if (!(variant in SEAL_FILES)) throw new Error(`gen-seal-svg: unknown variant "${variant}"`)
  const ink = variant === 'white' ? WHITE_INK : spec.inkHex
  const stroke = `fill="none" stroke="${ink}" stroke-width="${spec.strokeWidth}"`
    + ` stroke-linecap="${spec.linecap}" stroke-linejoin="${spec.linejoin}"`

  const lines = banner(variant)
  for (const line of lines) {
    if (line.includes('--')) throw new Error(`gen-seal-svg: banner line contains "--", which closes an XML comment: ${line}`)
  }

  const out = [
    // The ink is baked into every stroke (see the header). width/height are hints for an
    // <img> with no CSS; the viewBox is what actually scales. role/aria-label follow
    // public/logo-mark.svg's precedent, and the label is the brand name — language-neutral,
    // so the file needs no translated twin.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}"`
      + ` role="img" aria-label="eno">`,
    '  <!--',
    ...lines.map((line) => (line ? `    ${line}` : '')),
    '  -->',
    ...(variant === 'wash' ? [`  <path d="${spec.chief}" fill="${spec.washHex}"/>`] : []),
    `  <path d="${spec.outline}" ${stroke}/>`,
    `  <path d="${spec.check}" ${stroke}/>`,
    '</svg>',
  ]
  return `${out.join('\n')}\n`
}

/** variant → the exact bytes that file must contain. */
export function renderAllSeals(sources = readSealSources()) {
  const spec = collectSealSpec(sources)
  return Object.fromEntries(Object.keys(SEAL_FILES).map((v) => [v, renderSealSvg(v, spec)]))
}

function main() {
  const check = process.argv.includes('--check')
  const rendered = renderAllSeals()
  let stale = 0
  for (const [variant, rel] of Object.entries(SEAL_FILES)) {
    const want = rendered[variant]
    let have = null
    try {
      have = readFileSync(join(ROOT, rel), 'utf8')
    } catch {
      have = null
    }
    if (have === want) {
      console.log(`  unchanged  ${rel}`)
      continue
    }
    stale += 1
    if (check) {
      console.error(`  STALE      ${rel}${have === null ? ' (missing)' : ''}`)
      continue
    }
    // Only write on a real difference: identical bytes must not churn the mtime.
    writeFileSync(join(ROOT, rel), want)
    console.log(`  ${have === null ? 'created   ' : 'updated   '} ${rel}`)
  }
  if (check && stale) {
    console.error(`\n${stale} seal asset(s) do not match the component. Run: node scripts/gen-seal-svg.mjs`)
    process.exit(1)
  }
}

// Import-safe: the test imports the pure functions above and must not write anything.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) main()
