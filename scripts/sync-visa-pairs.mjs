#!/usr/bin/env node
// scripts/sync-visa-pairs.mjs — root↔forum SYNC-PAIR checker + generator.
//
// THE ROOT IS THE SOURCE OF TRUTH. The forum-side copies listed below are GENERATED;
// hand-editing apps/forum/src/lib/visa/* is a mistake. Move a pair like this:
//   1. edit the ROOT file under src/
//   2. node scripts/sync-visa-pairs.mjs --write
//   3. npm run sync:visa  (i.e. --check) and the vitest guard must be green
//
// THE TRANSFORM REMOVES NOTHING — this is a safety property, not a style choice.
// A generated copy is: a banner, then the root file VERBATIM, with only './x' import
// specifiers rewritten to '@/lib/visa/x'. An earlier version also stripped the root's
// leading comment block; that dropped whole LINES, so `/* header */ export const KEEP = 1`
// lost its code, and a leading `/* eslint-disable */` or `// @ts-nocheck` directive was
// silently deleted. None of the guards could see it: normalize() folds comment lines out
// on BOTH sides, so --check, the vitest pair guard and --write's own self-check were all
// blind to the loss — on a file that validates encrypted passport PII. Deleting a line is
// now impossible by construction. Do NOT reintroduce a stripping step.
//
// WHY THE GUARD EXISTS — do not "fix" a drift by deleting a pair: `visaPayloadSchema` is
// z.object(), NOT .strict(), so zod SILENTLY STRIPS unknown keys. Both apps decrypt and
// re-encrypt the SAME visa_applications rows, so if the root gains a payload field and
// the forum copy has not moved, one forum admin edit silently deletes that field from the
// ciphertext — undetectable data loss on encrypted passport PII.
//
// The pair table below is COPIED VERBATIM from src/lib/sync-pairs.test.ts and must stay in
// lockstep with it. ⚠️ Two copies of one list: editing either alone is how this breaks. On
// 2026-07-25 the itinerary pair was retired from the test but not from here, and this script
// crashed ENOENT on the deleted forum file — the test went green while `npm run sync:visa`
// was broken. Change BOTH, every time.
//
// It is deliberately NOT derived by walking directories: the remaining pairs are all visa
// files, but the table has carried an ASYMMETRIC entry before (a root lib mapping to a forum
// component path), which any walk keyed on matching paths would silently drop.
//
// TESTS: scripts/sync-visa-pairs.test.mjs — `node --test scripts/sync-visa-pairs.test.mjs`.
// They build a TEMP FIXTURE REPO and never touch this repo's own files. The exports below
// exist for them; running this file directly still behaves as a plain CLI.
//
// This script imports NOTHING from src/ — it must run standalone, before any build.

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── pair table (verbatim from src/lib/sync-pairs.test.ts) ──────────────────────────────

export const EXACT_PAIRS = [
  ['src/lib/visa/mrz.ts', 'apps/forum/src/lib/visa/mrz.ts'],
  ['src/lib/visa/image-quality.ts', 'apps/forum/src/lib/visa/image-quality.ts'],
  ['src/lib/visa/image-normalization.ts', 'apps/forum/src/lib/visa/image-normalization.ts'],
  ['src/lib/visa/checkpoints.ts', 'apps/forum/src/lib/visa/checkpoints.ts'],
  ['src/lib/languages.ts', 'apps/forum/src/lib/languages.ts'],
  // itinerary-resources: RETIRED 2026-07-25 (forum copy deleted with the trip service move).
  // Kept in lockstep with src/lib/sync-pairs.test.ts, which retired the same entry.
]

// Pairs whose ONLY sanctioned differences are comments and import specifiers
// (root uses relative-or-aliased forms for vitest resolvability; the forum aliases).
export const NORMALIZED_PAIRS = [
  ['src/lib/visa/schema.ts', 'apps/forum/src/lib/visa/schema.ts'],
  ['src/lib/visa/crypto.ts', 'apps/forum/src/lib/visa/crypto.ts'],
]

export const PAIRS = [
  ...EXACT_PAIRS.map(([root, forum]) => ({ mode: 'exact', root, forum })),
  ...NORMALIZED_PAIRS.map(([root, forum]) => ({ mode: 'normalized', root, forum })),
]

// ── comparison (the SAME normalize() as src/lib/sync-pairs.test.ts) ────────────────────

export function normalize(source) {
  return source
    .split('\n')
    // strip whole-line comments (the interop/port annotations differ by design)
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line))
    // unify import specifiers: './x' and '@/lib/visa/x' refer to the same module here
    .map((line) => line.replace(/from '(?:\.\/|@\/lib\/visa\/)([a-z-]+)'/g, "from '<visa>/$1'"))
    .filter((line) => line.trim() !== '')
    .join('\n')
}

export const matches = (mode, rootSource, forumSource) =>
  mode === 'exact' ? rootSource === forumSource : normalize(rootSource) === normalize(forumSource)

// ── generation (forum side FROM root side) ─────────────────────────────────────────────

// A REAL module specifier, not merely the text "from './x'".
//
// ⚠️ Both narrowings below are load-bearing; an adversarial review produced a live probe for each:
//   · `[^=]*` — without it, `export const AAD_DOC = "…copied from './schema'"` matched, and the
//     generator silently REWROTE the string's contents in the forum copy. normalize() folds './x'
//     and '@/lib/visa/x' together, so --check and the vitest pair guard were both blind to it.
//     A specifier clause never contains '=' before `from`; an assignment always does.
//   · comment lines are excluded — a plain comment that merely MENTIONS `from './schema'` (entirely
//     plausible in these files, which document their own import idiom) tripped the leftover guard
//     and made --write refuse to sync ALL EIGHT pairs, with no override.
const SPECIFIER_LINE = /^\s*(?:import|export)\s[^=]*\bfrom\s*'\.\/[a-z-]+'/
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/
const RELATIVE_VISA_IMPORT = /from '\.\/([a-z-]+)'/g
// A specifier that survived rewriting. Deliberately WIDER than SPECIFIER_LINE, because the whole
// point is to catch the forms the rewrite could not reach:
//   · a `from '…'` clause that ENDS the line with no '=' anywhere before it. That covers the
//     continuation line of a multi-line import (`} from './schema'`), which does not start with
//     import/export and so is never rewritten. The '=' exclusion and the end-anchor together are
//     what keep `export const X = "…from './schema'"` out: it has an '=', and it ends in a quote.
//   · any dynamic import(), which never sits on a statement line at all.
const SURVIVING_SPECIFIER = /^[^=]*\bfrom\s*'\.\/[a-z-]+'\s*;?\s*$|\bimport\s*\(\s*'\.\/[a-z-]+'/

export const banner = (rootPath) =>
  [
    `// GENERATED FROM ${rootPath} — do not edit. Regenerate: node scripts/sync-visa-pairs.mjs --write`,
    '// This file is that root file VERBATIM: nothing is stripped, reordered or reworded, and',
    "// only relative visa import specifiers ('./x') become the forum alias ('@/lib/visa/x').",
    "// Every comment below is therefore written from the ROOT's perspective — its paths,",
    '// tooling notes and TODOs describe src/ on eno.vn, not apps/forum/. Read them against',
    '// the root file; correct an inaccurate one THERE and re-run --write.',
  ].join('\n')

/**
 * NORMALIZED pairs: prepend the banner and rewrite './x' import specifiers to
 * '@/lib/visa/x'. NOTHING ELSE — no line is ever removed, so the AAD literal
 * 'eno-forum:visa-payload:v1', the snapshot-hash exclusion destructure, and any leading
 * directive comment carry through untouched.
 *
 * The one hard failure: a surviving relative './x' specifier. Only import/export LINES are
 * rewritten, so a multi-line import (`import {\n  a,\n} from './schema'`) would otherwise
 * emit a forum file whose relative path does not resolve — and normalize() folds './x' and
 * '@/lib/visa/x' together, so neither --check nor the vitest guard would notice. Refuse
 * instead of writing a broken copy.
 */
export function generateNormalized(rootRel, rootSource) {
  const rewritten = rootSource
    .split('\n')
    .map((line) =>
      SPECIFIER_LINE.test(line) && !COMMENT_LINE.test(line)
        ? line.replace(RELATIVE_VISA_IMPORT, "from '@/lib/visa/$1'")
        : line,
    )
  const leftover = rewritten.findIndex(
    (line) => !COMMENT_LINE.test(line) && SURVIVING_SPECIFIER.test(line),
  )
  if (leftover !== -1) {
    throw new Error(
      `sync-visa-pairs: ${rootRel} line ${leftover + 1} keeps a relative visa specifier the rewrite ` +
        `could not reach (a multi-line import, or a dynamic import()), so the forum copy would not ` +
        `resolve it; refusing to write.\n  ${rewritten[leftover]}`,
    )
  }
  return [banner(rootRel), ...rewritten].join('\n')
}

export const generate = (pair, rootSource) =>
  pair.mode === 'exact' ? rootSource : generateNormalized(pair.root, rootSource)

/**
 * The OUTER hard guard: whatever generate() produced must satisfy the very comparison
 * `--check` will make. Deliberately transform-agnostic — it holds even if generate() is
 * changed to something unsound, which is exactly when it matters.
 */
export function assertGeneratedPassesCheck(pair, rootSource, generated) {
  if (matches(pair.mode, rootSource, generated)) return
  throw new Error(
    `sync-visa-pairs: generated output for ${pair.forum} would NOT pass --check against ${pair.root}; refusing to write.\n` +
      unifiedDiff(
        `root/${pair.root}`,
        `generated/${pair.forum}`,
        pair.mode === 'exact' ? rootSource : normalize(rootSource),
        pair.mode === 'exact' ? generated : normalize(generated),
      ),
  )
}

// ── unified diff (no dependencies; the script must not import from src/) ───────────────

function lcsOps(a, b) {
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return [...a.map((line) => ['-', line]), ...b.map((line) => ['+', line])]
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push([' ', a[i]])
      i += 1
      j += 1
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push(['-', a[i]])
      i += 1
    } else {
      ops.push(['+', b[j]])
      j += 1
    }
  }
  while (i < n) ops.push(['-', a[i++]])
  while (j < m) ops.push(['+', b[j++]])
  return ops
}

export function unifiedDiff(fromLabel, toLabel, fromText, toText, context = 3) {
  const a = fromText.split('\n')
  const b = toText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const ops = [
    ...a.slice(0, start).map((line) => [' ', line]),
    ...lcsOps(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((line) => [' ', line]),
  ]

  const aNums = new Array(ops.length)
  const bNums = new Array(ops.length)
  let ai = 0
  let bi = 0
  ops.forEach(([kind], index) => {
    aNums[index] = ai
    bNums[index] = bi
    if (kind !== '+') ai += 1
    if (kind !== '-') bi += 1
  })

  const changed = ops.map(([kind]) => kind !== ' ')
  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`]
  let index = 0
  while (index < ops.length) {
    if (!changed[index]) {
      index += 1
      continue
    }
    const hunkStart = Math.max(0, index - context)
    let last = index
    for (;;) {
      let next = -1
      for (let k = last + 1; k < Math.min(ops.length, last + 1 + context * 2); k += 1) {
        if (changed[k]) {
          next = k
          break
        }
      }
      if (next === -1) break
      last = next
    }
    const hunkEnd = Math.min(ops.length, last + context + 1)
    let aCount = 0
    let bCount = 0
    for (let k = hunkStart; k < hunkEnd; k += 1) {
      if (ops[k][0] !== '+') aCount += 1
      if (ops[k][0] !== '-') bCount += 1
    }
    out.push(`@@ -${aNums[hunkStart] + 1},${aCount} +${bNums[hunkStart] + 1},${bCount} @@`)
    for (let k = hunkStart; k < hunkEnd; k += 1) out.push(`${ops[k][0]}${ops[k][1]}`)
    index = hunkEnd
  }
  return out.join('\n')
}

// ── modes ──────────────────────────────────────────────────────────────────────────────

const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8')

function driftReport(pair, root) {
  const rootSource = read(root, pair.root)
  const forumSource = read(root, pair.forum)
  if (matches(pair.mode, rootSource, forumSource)) return null
  const [from, to] =
    pair.mode === 'exact'
      ? [rootSource, forumSource]
      : [normalize(rootSource), normalize(forumSource)]
  const suffix = pair.mode === 'exact' ? '' : ' (normalized: comments + import specifiers folded out)'
  return `${pair.root} ↔ ${pair.forum} — DRIFT${suffix}\n${unifiedDiff(`root/${pair.root}`, `forum/${pair.forum}`, from, to)}`
}

/** `root` and `pairs` are overridable so the tests can run against a temp fixture repo. */
export function runCheck({ root = REPO_ROOT, pairs = PAIRS, log = console.log, error = console.error } = {}) {
  const drifts = pairs.map((pair) => driftReport(pair, root)).filter(Boolean)
  if (drifts.length === 0) {
    const exact = pairs.filter((pair) => pair.mode === 'exact').length
    log(`sync-visa-pairs: ${pairs.length} pairs in sync (${exact} exact, ${pairs.length - exact} normalized).`)
    return 0
  }
  for (const drift of drifts) error(`\n${drift}\n`)
  error(
    `sync-visa-pairs: ${drifts.length} of ${pairs.length} pairs DRIFTED. The root is the source of truth — ` +
      'regenerate with `node scripts/sync-visa-pairs.mjs --write` (never by hand-editing the forum copy).',
  )
  return 1
}

export function runWrite({ root = REPO_ROOT, pairs = PAIRS, log = console.log } = {}) {
  // Generate everything in memory and prove it passes --check BEFORE touching a file.
  const planned = pairs.map((pair) => {
    const rootSource = read(root, pair.root)
    const generated = generate(pair, rootSource)
    assertGeneratedPassesCheck(pair, rootSource, generated)
    const forumPath = path.join(root, pair.forum)
    return { pair, generated, current: existsSync(forumPath) ? readFileSync(forumPath, 'utf8') : null }
  })

  const written = []
  for (const { pair, generated, current } of planned) {
    if (generated === current) continue
    writeFileSync(path.join(root, pair.forum), generated)
    written.push(pair.forum)
  }

  // Belt and braces: re-read from disk and run the real check.
  const drifts = pairs.map((pair) => driftReport(pair, root)).filter(Boolean)
  if (drifts.length > 0) {
    throw new Error(`sync-visa-pairs: --write did not make --check pass:\n${drifts.join('\n\n')}`)
  }
  log(
    written.length === 0
      ? 'sync-visa-pairs: already in sync — nothing rewritten.'
      : `sync-visa-pairs: rewrote ${written.length} forum file(s) from the root:\n  ${written.join('\n  ')}`,
  )
  return 0
}

// ── CLI (skipped when this module is imported, e.g. by its own tests) ──────────────────

export function main(argv) {
  const unknown = argv.filter((arg) => !['--check', '--write', '--help', '-h'].includes(arg))
  if (unknown.length > 0 || argv.includes('--help') || argv.includes('-h')) {
    const stream = unknown.length > 0 ? console.error : console.log
    if (unknown.length > 0) stream(`sync-visa-pairs: unknown argument(s): ${unknown.join(' ')}`)
    stream('usage: node scripts/sync-visa-pairs.mjs [--check | --write]')
    stream('  --check  (default) fail on any root↔forum sync-pair drift, printing a unified diff')
    stream('  --write  regenerate the forum copies FROM the root copies')
    return unknown.length > 0 ? 2 : 0
  }
  return argv.includes('--write') ? runWrite() : runCheck()
}

/** True only when this file IS the entry point. Node resolves symlinks in import.meta.url
 *  (macOS /var → /private/var, pnpm stores, …), so argv[1] has to be realpath'd too. */
function isEntryPoint() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href
  }
}

if (isEntryPoint()) process.exit(main(process.argv.slice(2)))
