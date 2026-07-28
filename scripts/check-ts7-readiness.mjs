#!/usr/bin/env node
/**
 * IS THE ECOSYSTEM READY FOR TYPESCRIPT 7 YET?
 *
 * TypeScript 7 (the native Go port) went GA and is `latest` on npm. This repo CANNOT take it yet,
 * and the reason is not TypeScript — it is that TS 7's main entry no longer exports the compiler
 * API. `package.json#exports["."]` is `./lib/version.cjs`; the API moved to `./unstable/*` and is
 * labelled unstable. Anything doing `import ts from 'typescript'` and calling `createSourceFile`,
 * `forEachChild`, `isIdentifier` … gets nothing.
 *
 * Measured on this repo 2026-07-28 with typescript@7.0.2 actually installed:
 *   · `tsc --noEmit`   6.3s → 3.5s   (~1.8x — the win, and it is small next to a ~120s next build)
 *   · `npm run lint`   CRASHES: "Cannot read properties of undefined (reading 'Cjs')" from
 *                      @typescript-eslint/typescript-estree/dist/create-program/shared.js
 *   · `tsc`            14 errors, all in src/lib/visa-transition-drift.test.ts, which parses two
 *                      source files with the compiler API on purpose (regex was refuted by both
 *                      external reviewers: a regex silently SKIPS syntax it does not understand,
 *                      so two maps could drift identically and the guard would still report green)
 *
 * So the trade today is: spend the lint gate — design-lint, the i18n contract, the Base UI policy,
 * the createPortal rule — to save under three seconds. That is a bad trade on a live marketplace.
 *
 * THE TRIGGER IS typescript-eslint, NOT TypeScript. When a stable typescript-eslint admits 7.x,
 * both blockers clear at once: lint works again, and the drift test can move to
 * `typescript/unstable/ast` in the same pass (there is no reason to write against an unstable API
 * before then). Run this to find out:
 *
 *   node scripts/check-ts7-readiness.mjs
 *
 * Exits 0 when still blocked (this is a status report, not a gate), 0 when ready — read the output.
 */

import semver from 'semver'

const PKGS = ['typescript-eslint', '@typescript-eslint/parser', '@typescript-eslint/typescript-estree']

/**
 * Does a peer range admit the CURRENT typescript@latest?
 *
 * ⚠️ PATTERN-MATCHING THE RANGE STRING WAS WRONG, and it failed the only way that matters — it said
 * "blocked" for ranges that are actually fine. `>=5.0.0 <7.3.0` and `>=4.8.4 <8.0.0` both admit 7.x
 * and both were reported as blocked by a regex looking for a literal "7.". A detector that can only
 * ever return one answer is worse than no detector: this script exists to tell us when to ACT, so a
 * false "still blocked" would keep the migration parked forever. Answered with real semver against
 * the real published version instead of guessed from the shape of the string.
 */
function admits(range, version) {
  if (!range) return false
  if (range === '*') return true
  return semver.satisfies(version, range, { includePrerelease: false })
}

async function view(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`)
  if (!res.ok) throw new Error(`${pkg}: registry ${res.status}`)
  const json = await res.json()
  return { version: json.version, peer: json.peerDependencies?.typescript }
}

const tsLatest = await fetch('https://registry.npmjs.org/typescript/latest')
  .then((r) => r.json())
  .then((j) => j.version)
  .catch(() => 'unknown')

console.log(`typescript@latest is ${tsLatest}\n`)

let ready = true
for (const pkg of PKGS) {
  try {
    const { version, peer } = await view(pkg)
    const ok = admits(peer, tsLatest)
    ready &&= ok
    console.log(`  ${ok ? '✅' : '⛔'} ${pkg}@${version}  peer typescript: ${peer ?? '(none declared)'}`)
  } catch (e) {
    ready = false
    console.log(`  ⚠️  ${pkg}: ${e.message}`)
  }
}

console.log()
if (ready) {
  console.log('READY. typescript-eslint now admits TypeScript 7. The migration is:')
  console.log('  1. npm i -D typescript@7 && npm i -D typescript-eslint@latest (via eslint-config-next)')
  console.log('  2. Port src/lib/visa-transition-drift.test.ts to `typescript/unstable/ast`')
  console.log('     — keep it an AST parse; a regex guard was refuted twice and would fail silently.')
  console.log('  3. Gates that MUST pass before it ships: npm run lint (it crashes today), tsc, vitest, build.')
} else {
  console.log('STILL BLOCKED — stay on typescript@5. Re-run this when convenient; nothing else to do.')
}
