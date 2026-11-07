#!/usr/bin/env node
// Fails the build when a CLIENT chunk carries a regex lookbehind, `(?<=` or `(?<!`.
//
// ⛔ WHY (2026-11-07). Safari before 16.4 (iOS and macOS 16.0–16.3) has no lookbehind. A regex LITERAL with one is a
// SyntaxError while the chunk is parsed, so nothing in that chunk runs: on those phones chat, sign-in, posting and the CV
// import never loaded until batch 27 rewrote the four sources (phone.ts, visa-mention.ts, docx-text.ts, job-dms
// replies.ts). Server code may keep lookbehinds; only what the browser parses is read here, .next/static/**/*.js, after
// `next build` (package.json "build"). A dependency update can bring one in too, which no source lint would see.
//
// The match is textual, so a lookbehind inside a string (new RegExp('(?<=…)')) counts as well: that one throws only when
// it runs, but it still breaks the feature on those phones. Rewrite it with a consumed prefix group, as phone.ts does.
// ⚠️ ITS LIMITS (review r33, 2026-11-07). It catches what a minifier leaves as text: every regex literal (the case that
// kills a whole chunk) and plain strings. A pattern assembled at runtime or written with escapes ("\u0028?<=") passes, and
// inert text carrying the marker (a code sample on a page) fails the build: the message names the chunk and the text.
// ⛔ It FAILS when .next/static is missing or holds no .js: it runs right after `next build`, where both always exist,
// so either means the output moved and the guard would be checking nothing.
// `node scripts/chunk-lookbehind-guard.mjs --self-test` checks the detector alone.
import fs from 'node:fs'
import path from 'node:path'

const LOOKBEHIND = /\(\?<[=!]/g

/** Every lookbehind in a chunk's text, with 60 characters either side so the source can be found. */
export function lookbehindsIn(text) {
  const out = []
  for (const m of text.matchAll(LOOKBEHIND)) {
    out.push(text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '))
  }
  return out
}

function selfTest() {
  const hits = ['/(?<=a)b/', '/(?<!\\d)x/g', 'new RegExp("(?<=@)\\\\w+")']
  const misses = ['/(?<name>a)/', '/(?:a)|b/', '"(?"', 'a<=b', '/(?=a)/', '/(?!a)/']
  const bad = [...hits.filter((s) => lookbehindsIn(s).length !== 1), ...misses.filter((s) => lookbehindsIn(s).length !== 0)]
  if (bad.length) {
    console.error('chunk-lookbehind-guard self-test FAILED on:', bad)
    process.exit(1)
  }
}

function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* jsFiles(p)
    else if (e.isFile() && p.endsWith('.js')) yield p
  }
}

selfTest()
if (process.argv.includes('--self-test')) {
  console.log('chunk-lookbehind-guard: self-test passed')
  process.exit(0)
}

// The same output directory next.config.ts builds into (`distDir`: NEXT_DIST_DIR, else .next).
const root = path.join(process.cwd(), process.env.NEXT_DIST_DIR || '.next', 'static')
if (!fs.existsSync(root)) {
  console.error(`chunk-lookbehind-guard: no ${path.relative(process.cwd(), root)} after the build, so nothing was checked. Run it after \`next build\`.`)
  process.exit(1)
}
let files = 0
const found = []
for (const f of jsFiles(root)) {
  files++
  for (const context of lookbehindsIn(fs.readFileSync(f, 'utf8'))) found.push({ file: path.relative(process.cwd(), f), context })
}
if (files === 0) {
  console.error(`chunk-lookbehind-guard: ${path.relative(process.cwd(), root)} holds no .js, so nothing was checked.`)
  process.exit(1)
}
if (found.length) {
  console.error(`chunk-lookbehind-guard: ${found.length} regex lookbehind(s) in client chunks. Safari 16.0–16.3 cannot parse them,`)
  console.error('so the chunk never runs there. Rewrite each one with a consumed prefix group (see src/lib/phone.ts):')
  for (const h of found.slice(0, 20)) console.error(`  ${h.file}\n    …${h.context}…`)
  process.exit(1)
}
console.log(`chunk-lookbehind-guard: ${files} client chunks, no lookbehind`)
