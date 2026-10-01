#!/usr/bin/env node
/**
 * ⛔ THE MARKETPLACE IMAGE IS BUILT WITHOUT eno.forum'S FORUM-ONLY PAGE DIRECTORIES — the e-visa and
 * itinerary trees, and the three expat guides that only eno.forum renders.
 *
 * WHY THIS EXISTS (measured on https://eno.vn, 2026-10-01): every 404 and storefront page eno.vn
 * served carried, inside its RSC payload, the list of every directory under `src/app/[lang]` —
 * `…,"iphone-vs-samsung-vietnam","itinerary","jobs-vietnam-expats",…,"vietnam-evisa",…`. Next 16's
 * optimistic client routing (`experimental.optimisticRouting`, default ON) ships the STATIC SIBLINGS
 * of a dynamic segment (`[handle]`, `[...rest]`) so the browser can tell `/about` from a storefront
 * handle without a round trip, and the build computes those siblings from the DIRECTORY TREE.
 * `pageExtensions` decides which files are routes; it does not hide a directory's NAME. So the
 * `.forum.svc.` fold kept `/vietnam-evisa` a 404 on eno.vn while the licensed marketplace still
 * published the name of eno.forum's e-visa storefront in its own HTML.
 *
 * THE FIX IS SUBTRACTION, ON A COPY. The Dockerfile's builder stage runs this with `--delete` after
 * `COPY . .` and before `npm run build`, for the marketplace edition only. That filesystem is the
 * image's own throwaway copy of the source, so the checkout on the box (which the services build
 * uses next) is never touched — the same reasoning as the `public/banners/evisa-*` prune already in
 * the Dockerfile.
 *
 * ⚠️ WHY DELETING THEM IS SAFE, AND WHAT KEEPS IT SAFE. A directory is only ever listed here if:
 *   · every file in it is a `.forum.svc.` route file — the infix NO marketplace build compiles, at
 *     any MARKETPLACE_HOSTS_SERVICES setting (next.config.ts FORUM_ONLY_EXTENSIONS) — or a test, which
 *     Next never compiles. So the marketplace bundle contains exactly what it contained before;
 *   · no source file outside the pruned directories imports anything inside them. "Source file" means
 *     the whole TYPECHECKED program, not just src/: `next build` typechecks everything tsconfig.json
 *     includes (every `.ts`/`.tsx` file: scripts/*.ts, e2e/, the root *.config.ts files — minus its
 *     `exclude` list), and one importer anywhere in that set would fail the image's typecheck
 *     (next.config.ts `ignoreBuildErrors: false`). The scan below walks exactly that tree and is
 *     STRICTER than it in two ways, on purpose: it also reads .js/.jsx/.mjs/.cjs (a script that
 *     imports a page module would break when it runs, typechecked or not), and it reads e2e/ even
 *     though .dockerignore keeps e2e/ out of the image. It skips dot-directories because TypeScript's
 *     `**` wildcard does too (`.next/types` is generated per build from the routes that exist).
 *     ⚠️ What it does NOT see: a file READ by path at build time (fs.readFileSync('src/app/…')), as
 *     opposed to imported. Nothing in `npm run build` does that to these directories today
 *     (edition-lint, design-lint and regex-lint WALK the tree, so an absent directory is simply not
 *     walked); a future build step that does would fail the image build, not eno.vn.
 * Both are re-checked by THIS SCRIPT before it deletes anything, and it refuses (exit 1, failing the
 * image build) rather than delete a directory that no longer satisfies them. A failed build swaps
 * nothing (infra/vn-node/eno-deploy.sh step 5), so the failure direction is "deploy refused", never
 * "eno.vn loses a page". The shared modules the e-visa pages import were moved OUT of the route
 * directory to src/lib/vietnam-evisa/ for exactly this reason.
 *
 * ⚠️ NOT THE API ROUTES. eno.vn hosts the partner-run visa/trip flow (eno-build.sh sets
 * MARKETPLACE_HOSTS_SERVICES=true, owner-approved), and `src/app/api/visa|trips|itineraries` are its
 * endpoints. They are route handlers, which never render an RSC tree, so their names cannot leak this
 * way — and removing them would break the partner desk. Only PAGE directories whose names leak and
 * whose pages eno.vn never compiles belong here.
 *
 *   node scripts/marketplace-route-prune.mjs            # check only — safe anywhere (tests run this)
 *   node scripts/marketplace-route-prune.mjs --delete   # Docker builder stage ONLY; refuses in a checkout
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The page directories removed from the marketplace build — relative to the repo root.
 *
 * The first two are the leak that was measured (services vocabulary in eno.vn's RSC route tree). The
 * three guides were added 2026-10-01 because they pass the SAME proof — one `page.forum.svc.tsx`
 * each, no importer anywhere (checked by this script, not asserted) — and are the same kind of thing:
 * eno.forum pages that 404 on eno.vn yet whose names eno.vn's route tree still published. Their
 * names carry no visa/itinerary/PayPal word, so this is tidiness and a smaller fingerprint of the
 * services edition, not a boundary fix. Their prose names the e-visa (scripts/edition-lint.mjs
 * SERVICES_TREES), which is why they are forum-only in the first place.
 * ⚠️ src/lib/marketplace-route-prune.test.ts fails if a forum-only page directory beside a dynamic
 * segment is NOT on this list, so a sixth one cannot be added to src/app/[lang] and forgotten here.
 */
export const PRUNED_ROUTE_DIRS = [
  'src/app/[lang]/itinerary',
  'src/app/[lang]/vietnam-evisa',
  'src/app/[lang]/moving-to-vietnam',
  'src/app/[lang]/first-month-in-vietnam',
  'src/app/[lang]/services-for-expats-vietnam',
]

/**
 * What a pruned directory may hold. A Next special file with the forum-only infix (never compiled on a
 * marketplace build at any flag setting), or a vitest file (never compiled by Next at all). Anything
 * else — a plain `.ts` module, a `.svc.` page the marketplace DOES compile with the flag on, a
 * component — means deleting the directory would change what eno.vn serves or break its typecheck.
 */
const FORUM_ONLY_ROUTE_FILE =
  /^(page|layout|template|loading|error|not-found|default|route|opengraph-image|twitter-image)\.forum\.svc\.(ts|tsx|js|jsx)$/
const TEST_FILE = /\.test\.(ts|tsx)$/

/** True for a file name a pruned directory may hold (see above). Shared with the test's new-directory guard. */
export const isPrunableFile = (base) => FORUM_ONLY_ROUTE_FILE.test(base) || TEST_FILE.test(base)

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
/** `from '…'`, `import '…'`, `import('…')`, `require('…')`, `export … from '…'`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g

function walk(dir, out = [], skip = () => false) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (skip(full)) continue
    if (statSync(full).isDirectory()) walk(full, out, skip)
    else out.push(full)
  }
  return out
}

/**
 * tsconfig.json's `exclude` list as absolute paths (node_modules is always skipped by walk()). Read,
 * not copied, so the scan cannot drift from the program `next build` typechecks. A tsconfig that
 * does not parse as JSON excludes NOTHING — the scan only gets wider, never narrower.
 */
function tsconfigExcludes(root) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
    return (Array.isArray(cfg.exclude) ? cfg.exclude : [])
      .filter((e) => typeof e === 'string' && !/[*?]/.test(e))
      .map((e) => resolve(root, e))
  } catch {
    return []
  }
}

const within = (abs, dirAbs) => abs === dirAbs || abs.startsWith(dirAbs + sep)

/** Comments out, so prose that QUOTES an old import path is not mistaken for an import (same rule as edition-lint). */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * Every reason the listed directories may NOT be deleted from this tree. Empty means prunable.
 * Pure read — never modifies anything.
 */
export function pruneProblems(root) {
  const problems = []
  const prunedAbs = PRUNED_ROUTE_DIRS.map((d) => resolve(root, d))

  // 1. Contents: forum-only route files and tests, nothing else.
  for (const [i, dirAbs] of prunedAbs.entries()) {
    if (!existsSync(dirAbs)) continue // already absent: nothing to delete, nothing to leak
    for (const file of walk(dirAbs)) {
      const base = file.split(sep).pop()
      if (isPrunableFile(base)) continue
      problems.push(
        `${relative(root, file)} — only \`.forum.svc.\` route files may live in ${PRUNED_ROUTE_DIRS[i]}/ ` +
          '(it is deleted from the marketplace build); move shared modules to src/lib/ like src/lib/vietnam-evisa/',
      )
    }
  }

  // 2. Importers: nothing that survives the prune may import from a pruned directory — anywhere in
  //    the typechecked program (the repo minus tsconfig's exclude list), not just src/.
  const excluded = tsconfigExcludes(root)
  const skip = (abs) => excluded.some((d) => within(abs, d)) || prunedAbs.some((d) => within(abs, d))
  for (const file of walk(resolve(root), [], skip)) {
    if (!SOURCE_FILE.test(file)) continue
    const src = decomment(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(SPECIFIER)) {
      const spec = m[2]
      let target = null
      if (spec.startsWith('@/')) target = resolve(root, 'src', spec.slice(2))
      else if (spec.startsWith('.')) target = resolve(dirname(file), spec)
      if (!target) continue
      const hit = prunedAbs.findIndex((d) => within(target, d))
      if (hit === -1) continue
      const line = src.slice(0, m.index).split('\n').length
      problems.push(`${relative(root, file)}:${line} imports ${spec} — inside ${PRUNED_ROUTE_DIRS[hit]}/, which the marketplace build deletes`)
    }
  }
  return problems
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const del = argv.includes('--delete')
  const problems = pruneProblems(root)
  if (problems.length) {
    console.error('marketplace-route-prune: REFUSING — these directories cannot be removed from the marketplace build safely:')
    for (const p of problems) console.error(`  ${p}`)
    return 1
  }
  if (!del) {
    console.log(`marketplace-route-prune: prunable (${PRUNED_ROUTE_DIRS.join(', ')})`)
    return 0
  }
  // ⛔ NEVER IN A CHECKOUT. The Docker build context excludes .git (.dockerignore), so its absence is
  // what identifies the builder's throwaway copy. A developer or the box running this by hand in a
  // git tree would otherwise delete eno.forum's pages from the very checkout the forum build uses.
  if (existsSync(join(root, '.git'))) {
    console.error('marketplace-route-prune: REFUSING --delete in a git checkout — this runs only in the Docker builder stage')
    return 1
  }
  if (process.env.NEXT_PUBLIC_ENO_EDITION !== 'marketplace') {
    console.error(`marketplace-route-prune: REFUSING --delete for edition ${JSON.stringify(process.env.NEXT_PUBLIC_ENO_EDITION)} — marketplace only`)
    return 1
  }
  for (const d of PRUNED_ROUTE_DIRS) {
    const abs = resolve(root, d)
    if (!existsSync(abs)) { console.log(`  absent already: ${d}`); continue }
    const n = walk(abs).length
    rmSync(abs, { recursive: true, force: true })
    if (existsSync(abs)) { console.error(`marketplace-route-prune: ${d} still exists after rm`); return 1 }
    console.log(`  removed ${d}/ (${n} file${n === 1 ? '' : 's'})`)
  }
  console.log('marketplace-route-prune: done')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
