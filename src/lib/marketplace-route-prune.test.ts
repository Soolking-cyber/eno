import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRUNED_ROUTE_DIRS, isPrunableFile, pruneProblems } from '../../scripts/marketplace-route-prune.mjs'

/**
 * eno.vn's 404 and storefront pages shipped `"itinerary"` and `"vietnam-evisa"` in their RSC route
 * tree (measured on https://eno.vn, 2026-10-01 — the same 404 also carried `"moving-to-vietnam"`,
 * `"first-month-in-vietnam"` and `"services-for-expats-vietnam"`, three more forum-only pages): Next
 * lists a dynamic segment's static SIBLINGS from the directory tree, so pageExtensions kept the pages
 * out while their names still shipped. The Dockerfile now deletes those directories from the
 * marketplace build's copy of the source (scripts/marketplace-route-prune.mjs). These tests hold the
 * things that keep that safe:
 *   1. the directories are deletable — forum-only route files only, and no importer anywhere in the
 *      typechecked program (not just src/);
 *   2. no OTHER page-tree directory with a services name — and no other forum-only page directory —
 *      sits beside a dynamic segment unpruned;
 *   3. --delete refuses anywhere but a throwaway marketplace copy, and the Dockerfile wires it in.
 */
const ROOT = join(__dirname, '..', '..')
const LEAK = /visa|itinerar|paypal/i

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })
function fixture(): string {
  const d = mkdtempSync(join(tmpdir(), 'eno-prune-'))
  tmp.push(d)
  mkdirSync(join(d, 'scripts'), { recursive: true })
  cpSync(join(ROOT, 'scripts/marketplace-route-prune.mjs'), join(d, 'scripts/marketplace-route-prune.mjs'))
  for (const rel of PRUNED_ROUTE_DIRS) {
    mkdirSync(join(d, rel), { recursive: true })
    writeFileSync(join(d, rel, 'page.forum.svc.tsx'), 'export default function P() { return null }\n')
  }
  mkdirSync(join(d, 'src/lib'), { recursive: true })
  writeFileSync(join(d, 'src/lib/shared.ts'), "import { x } from '@/lib/other'\nexport const y = x\n")
  writeFileSync(join(d, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules', 'apps/forum'] }))
  return d
}
const run = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync('node', ['scripts/marketplace-route-prune.mjs', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })

describe('marketplace route prune · this repository', () => {
  it('the listed directories are deletable from the marketplace build', () => {
    expect(pruneProblems(ROOT)).toEqual([])
  })

  it('lists exactly the five forum-only page trees whose names leaked', () => {
    expect([...PRUNED_ROUTE_DIRS].sort()).toEqual([
      'src/app/[lang]/first-month-in-vietnam',
      'src/app/[lang]/itinerary',
      'src/app/[lang]/moving-to-vietnam',
      'src/app/[lang]/services-for-expats-vietnam',
      'src/app/[lang]/vietnam-evisa',
    ])
  })

  /**
   * ⛔ THE RENAME / NEW-DIRECTORY GUARD. The prune list is a list, and lists rot: rename
   * `vietnam-evisa` to `e-visa`, or add `src/app/[lang]/visa-guide/page.forum.svc.tsx`, and the name
   * ships again with the prune still "passing". Every directory in a PAGE tree that sits beside a
   * dynamic segment is a static sibling Next will publish; any such name containing visa, itinerary or
   * PayPal must be on the prune list. (`src/app/api` is skipped: route handlers render no RSC tree,
   * and the partner flow's /api/visa, /api/trips, /api/itineraries must stay compiled on eno.vn.)
   */
  it('no services-named directory sits unpruned beside a dynamic page segment', () => {
    const offenders: string[] = []
    const pruned = new Set(PRUNED_ROUTE_DIRS)
    const isDir = (p: string) => statSync(p).isDirectory()
    // A route group's children share its parent's URL level, so a group is expanded in place.
    const childDirs = (dir: string): string[] =>
      readdirSync(dir).filter((n) => isDir(join(dir, n))).flatMap((n) =>
        n.startsWith('(') ? childDirs(join(dir, n)).map((c) => `${n}/${c}`) : [n])
    const walk = (rel: string) => {
      const abs = join(ROOT, rel)
      const kids = childDirs(abs)
      const leaf = (k: string) => k.split('/').pop() as string
      if (kids.some((k) => leaf(k).startsWith('['))) {
        for (const k of kids) {
          const name = leaf(k)
          if (name.startsWith('[') || name.startsWith('_') || name.startsWith('@')) continue
          if (LEAK.test(name) && !pruned.has(`${rel}/${k}`)) offenders.push(`${rel}/${k}`)
        }
      }
      for (const k of kids) if (`${rel}/${k}` !== 'src/app/api') walk(`${rel}/${k}`)
    }
    walk('src/app')
    expect(offenders, 'add it to PRUNED_ROUTE_DIRS (if eno.vn compiles no page in it) or rename it').toEqual([])
  })

  /**
   * The same guard by CONTENT rather than by name: a directory beside a dynamic page segment whose
   * every file is a `.forum.svc.` route file (or a test) is a page eno.vn never compiles, so its name
   * in eno.vn's route tree is pure leak and it belongs on the list. This is how the three expat guides
   * were found; it keeps a sixth from being added and forgotten.
   */
  it('every forum-only page directory beside a dynamic segment is on the prune list', () => {
    const pruned = new Set(PRUNED_ROUTE_DIRS)
    const missing: string[] = []
    const filesUnder = (abs: string): string[] =>
      readdirSync(abs).flatMap((n) => (statSync(join(abs, n)).isDirectory() ? filesUnder(join(abs, n)) : [n]))
    const walk = (rel: string, insidePruned: boolean) => {
      const abs = join(ROOT, rel)
      const kids = readdirSync(abs).filter((n) => statSync(join(abs, n)).isDirectory())
      const besideDynamic = kids.some((k) => k.startsWith('['))
      for (const k of kids) {
        const child = `${rel}/${k}`
        const inside = insidePruned || pruned.has(child)
        if (besideDynamic && !inside && !k.startsWith('[') && !k.startsWith('(')) {
          const files = filesUnder(join(ROOT, child))
          if (files.length > 0 && files.every(isPrunableFile)) missing.push(child)
        }
        if (child !== 'src/app/api') walk(child, inside)
      }
    }
    walk('src/app', false)
    expect(missing, 'eno.vn compiles nothing in these, yet their names ship — add them to PRUNED_ROUTE_DIRS').toEqual([])
  })

  it('the e-visa shared modules live outside the pruned route directory', () => {
    expect(existsSync(join(ROOT, 'src/lib/vietnam-evisa/links.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'src/lib/vietnam-evisa/service-jsonld.ts'))).toBe(true)
  })
})

describe('marketplace route prune · refuses what would change eno.vn or break its build', () => {
  it('a plain module inside a pruned directory blocks the prune', () => {
    const d = fixture()
    writeFileSync(join(d, PRUNED_ROUTE_DIRS[1], 'links.ts'), 'export const A = 1\n')
    expect(pruneProblems(d).join('\n')).toMatch(/links\.ts — only `\.forum\.svc\.` route files/)
  })

  it('a `.svc.` page (compiled on eno.vn with the partner flag on) blocks the prune', () => {
    const d = fixture()
    writeFileSync(join(d, PRUNED_ROUTE_DIRS[0], 'page.svc.tsx'), 'export default function P() { return null }\n')
    expect(pruneProblems(d)).toHaveLength(1)
  })

  it('an importer outside — by alias or relative path — blocks the prune; a comment quoting one does not', () => {
    const d = fixture()
    // ⚠️ Specifiers assembled at runtime: written out whole, THIS file would be an importer of the
    // pruned trees as far as the scanner is concerned — it reads source text, not the TS AST.
    const q = (spec: string) => `'${spec}'`
    const evisa = '@/app/[lang]/' + 'vietnam-evisa'
    const itin = '../app/[lang]/' + 'itinerary'
    writeFileSync(join(d, 'src/lib/a.ts'), `import { A } from ${q(`${evisa}/x`)}\nexport const B = A\n`)
    writeFileSync(join(d, 'src/lib/b.ts'), `export { C } from ${q(`${itin}/y`)}\n`)
    writeFileSync(join(d, 'src/lib/c.ts'), `// it used to import from ${q(`${evisa}/links`)}\nexport const D = 1\n`)
    const problems = pruneProblems(d)
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/src\/lib\/a\.ts:1 imports @\/app\/\[lang\]\/vietnam-evisa\/x/)
    expect(problems.join('\n')).toMatch(/src\/lib\/b\.ts:1 imports \.\.\/app\/\[lang\]\/itinerary\/y/)
  })

  /**
   * The typecheck `next build` runs covers everything tsconfig includes, not just src/, so an importer
   * in scripts/, e2e/ or a root config file would fail the image build just the same. The scan follows
   * tsconfig's exclude list (read from the file), so a directory the typecheck never sees is skipped.
   */
  it('an importer anywhere in the typechecked program blocks the prune — not only under src/', () => {
    const d = fixture()
    const q = (spec: string) => `'${spec}'`
    const guide = '@/app/[lang]/' + 'moving-to-vietnam'
    for (const rel of ['scripts', 'e2e', 'apps/forum', 'apps/other']) mkdirSync(join(d, rel), { recursive: true })
    writeFileSync(join(d, 'scripts/seed.ts'), `import P from ${q(`${guide}/page.forum.svc`)}\nexport default P\n`)
    writeFileSync(join(d, 'e2e/guide.spec.ts'), `const m = await import(${q(`${guide}/page.forum.svc`)})\nexport { m }\n`)
    writeFileSync(join(d, 'tool.config.ts'), `export * from ${q('./src/app/[lang]/' + 'itinerary/page.forum.svc')}\n`)
    writeFileSync(join(d, 'scripts/run.mjs'), `const m = require(${q('../src/app/[lang]/' + 'vietnam-evisa/page.forum.svc.tsx')})\n`)
    // Excluded by the fixture's tsconfig: never typechecked, so never a reason to refuse.
    writeFileSync(join(d, 'apps/forum/x.ts'), `import P from ${q(`${guide}/page.forum.svc`)}\nexport default P\n`)
    // Not excluded: apps/other IS in the program.
    writeFileSync(join(d, 'apps/other/y.ts'), `import P from ${q(`${guide}/page.forum.svc`)}\nexport default P\n`)
    const problems = pruneProblems(d).join('\n')
    expect(problems).toMatch(/^scripts\/seed\.ts:1 imports /m)
    expect(problems).toMatch(/^e2e\/guide\.spec\.ts:1 imports /m)
    expect(problems).toMatch(/^tool\.config\.ts:1 imports /m)
    expect(problems).toMatch(/^scripts\/run\.mjs:1 imports /m)
    expect(problems).toMatch(/^apps\/other\/y\.ts:1 imports /m)
    expect(problems).not.toMatch(/apps\/forum/)
  })

  it('--delete refuses in a git checkout, and for the services edition', () => {
    const d = fixture()
    writeFileSync(join(d, '.git'), 'gitdir: elsewhere\n')
    const inCheckout = run(d, ['--delete'], { NEXT_PUBLIC_ENO_EDITION: 'marketplace' })
    expect(inCheckout.status).toBe(1)
    expect(inCheckout.stderr).toMatch(/REFUSING --delete in a git checkout/)
    rmSync(join(d, '.git'))
    const services = run(d, ['--delete'], { NEXT_PUBLIC_ENO_EDITION: 'services' })
    expect(services.status).toBe(1)
    for (const rel of PRUNED_ROUTE_DIRS) expect(existsSync(join(d, rel))).toBe(true)
  })

  it('--delete removes exactly the listed directories in a marketplace copy', () => {
    const d = fixture()
    mkdirSync(join(d, 'src/app/[lang]/about'), { recursive: true })
    writeFileSync(join(d, 'src/app/[lang]/about/page.tsx'), 'export default function P() { return null }\n')
    const r = run(d, ['--delete'], { NEXT_PUBLIC_ENO_EDITION: 'marketplace' })
    expect(r.status, r.stderr).toBe(0)
    for (const rel of PRUNED_ROUTE_DIRS) expect(existsSync(join(d, rel))).toBe(false)
    expect(existsSync(join(d, 'src/app/[lang]/about/page.tsx'))).toBe(true)
  })

  it('--delete deletes nothing when a check fails', () => {
    const d = fixture()
    writeFileSync(join(d, PRUNED_ROUTE_DIRS[1], 'helpers.ts'), 'export const A = 1\n')
    const r = run(d, ['--delete'], { NEXT_PUBLIC_ENO_EDITION: 'marketplace' })
    expect(r.status).toBe(1)
    for (const rel of PRUNED_ROUTE_DIRS) expect(existsSync(join(d, rel))).toBe(true)
  })
})

describe('marketplace route prune · wired into the image build', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  it('runs before `npm run build`, for the marketplace only, and fails the layer on refusal', () => {
    const prune = dockerfile.indexOf('node scripts/marketplace-route-prune.mjs --delete || exit 1')
    const build = dockerfile.indexOf('npm run build &&', prune)
    expect(prune).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(prune)
    expect(dockerfile.slice(prune - 220, prune)).toMatch(/"\$NEXT_PUBLIC_ENO_EDITION" = "marketplace"/)
  })
  it('the build context excludes .git — the marker --delete relies on to know it is not in a checkout', () => {
    const ignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim())
    expect(ignore).toContain('.git')
  })
  it('eno-build.sh passes the switch to the marketplace build, validated', () => {
    const build = readFileSync(join(ROOT, 'infra/vn-node/eno-build.sh'), 'utf8')
    expect(build).toMatch(/ENO_PRUNE_FORUM_ROUTE_DIRS=%s/)
    expect(build).toMatch(/case "\$PRUNE" in 0\|1\)/)
    execFileSync('bash', ['-n', join(ROOT, 'infra/vn-node/eno-build.sh')])
  })
})
