// scripts/sync-visa-pairs.test.mjs — tests for the root↔forum sync-pair generator.
//
// Run: node --test scripts/sync-visa-pairs.test.mjs
// (vitest.config.ts only globs src/**/*.test.ts, and this file must stay runnable with no
// build step, exactly like the script it covers — so it uses node:test.)
//
// EVERY test builds a throwaway fixture repo under os.tmpdir() and points the generator at
// it with { root, pairs }. Nothing here reads, writes or compares this repo's real files:
// a test that regenerated apps/forum/src/lib/visa/* would be able to *cause* the data loss
// it is supposed to detect.
//
// The regression that motivated most of this: the generator used to strip the root file's
// leading comment block, which deleted whole LINES — taking code that shared a line with
// the comment, and any leading `/* eslint-disable */` / `// @ts-nocheck` directive. It was
// invisible to every guard, because normalize() folds comment lines out on BOTH sides.
// `keeps code that shares its line with a leading block comment` is the test that fails
// against that behaviour; do not weaken it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'

import {
  PAIRS,
  assertGeneratedPassesCheck,
  banner,
  generate,
  generateNormalized,
  normalize,
  runCheck,
  runWrite,
} from './sync-visa-pairs.mjs'

const SCRIPT = fileURLToPath(new URL('./sync-visa-pairs.mjs', import.meta.url))
const fixtures = []

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true })
})

function fixtureRepo() {
  // realpath: on macOS os.tmpdir() is /var/... which is a symlink to /private/var/...,
  // and the CLI's own entry-point detection compares resolved paths.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'sync-visa-pairs-')))
  fixtures.push(dir)
  return dir
}

function put(dir, rel, content) {
  const target = path.join(dir, rel)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

const get = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8')

/** A one-pair fixture repo whose forum copy starts out stale, so --write must rewrite it. */
function oneNormalizedPair(rootSource, { rootRel = 'src/lib/visa/fixture.ts', forumRel = 'apps/forum/src/lib/visa/fixture.ts' } = {}) {
  const dir = fixtureRepo()
  put(dir, rootRel, rootSource)
  put(dir, forumRel, '// stale\n')
  return { dir, rootRel, forumRel, pairs: [{ mode: 'normalized', root: rootRel, forum: forumRel }] }
}

const silent = { log: () => {}, error: () => {} }

describe('sync-visa-pairs generator', () => {
  it('keeps code that shares its line with a leading block comment (no stripping, ever)', () => {
    // The exact shape the old stripLeadingCommentBlock() swallowed whole.
    const source = '/* header */ export const KEEP = 1\nexport const ALSO = 2\n'
    const { dir, forumRel, pairs } = oneNormalizedPair(source)

    runWrite({ root: dir, pairs, ...silent })

    const written = get(dir, forumRel)
    assert.ok(written.includes('export const KEEP = 1'), `payload line vanished from the generated copy:\n${written}`)
    assert.ok(written.includes('/* header */ export const KEEP = 1'), 'the line must survive byte-for-byte, comment included')
    assert.ok(written.includes('export const ALSO = 2'))
    // …and the drift guard is blind to it (normalize() drops /*-leading lines on both
    // sides), which is precisely why this assertion is on the CONTENT, not on runCheck.
    assert.equal(normalize(source).includes('KEEP'), false)
  })

  it('preserves leading directive comments', () => {
    const source = [
      '/* eslint-disable no-console */',
      '// @ts-nocheck',
      '/// <reference types="node" />',
      '',
      "import { z } from 'zod'",
      'export const A = z',
      '',
    ].join('\n')
    const { dir, forumRel, pairs } = oneNormalizedPair(source)

    runWrite({ root: dir, pairs, ...silent })

    const written = get(dir, forumRel)
    for (const directive of ['/* eslint-disable no-console */', '// @ts-nocheck', '/// <reference types="node" />']) {
      assert.ok(written.includes(directive), `directive dropped: ${directive}\n${written}`)
    }
    // Order preserved, and they still sit above the code.
    assert.ok(written.indexOf('/* eslint-disable no-console */') < written.indexOf('// @ts-nocheck'))
    assert.ok(written.indexOf('// @ts-nocheck') < written.indexOf("import { z } from 'zod'"))
  })

  it('rewrites relative visa import specifiers on import/export lines only', () => {
    const source = [
      "import { visaPayloadSchema } from './schema'",
      "export { checkpoints } from './checkpoints'",
      "const notAnImport = './schema'",
      'export const A = 1',
      '',
    ].join('\n')
    const { dir, forumRel, pairs } = oneNormalizedPair(source)

    runWrite({ root: dir, pairs, ...silent })

    const written = get(dir, forumRel)
    assert.ok(written.includes("import { visaPayloadSchema } from '@/lib/visa/schema'"))
    assert.ok(written.includes("export { checkpoints } from '@/lib/visa/checkpoints'"))
    assert.ok(written.includes("const notAnImport = './schema'"), 'non-import lines must not be touched')
    assert.equal(runCheck({ root: dir, pairs, ...silent }), 0)
  })

  it('is the root file verbatim plus a banner — the only removed thing is nothing', () => {
    const source = ['// a root-only ops note', 'export const A = 1', '', '// trailing note', ''].join('\n')
    const generated = generateNormalized('src/lib/visa/fixture.ts', source)

    assert.equal(generated, `${banner('src/lib/visa/fixture.ts')}\n${source}`)
    assert.ok(banner('src/lib/visa/fixture.ts').includes('GENERATED FROM src/lib/visa/fixture.ts'))
    // Finding 3: the banner must SAY the comments are root-perspective rather than the
    // generator hand-editing false prose into the copy.
    assert.match(banner('src/lib/visa/fixture.ts'), /written from the ROOT's perspective/)
    assert.match(banner('src/lib/visa/fixture.ts'), /not apps\/forum\//)
    // Every banner line is a whole-line comment, so normalize() folds it away and the pair
    // guard still passes.
    for (const line of banner('x').split('\n')) assert.match(line, /^\s*\/\//)
  })

  // ── the three narrowings of what counts as a REAL specifier ────────────────────────────
  // Each of these failed against the first version of the leftover guard. They are the
  // reason SPECIFIER_LINE carries `[^=]*` and the reason comment lines are excluded.

  it('does not treat a comment that merely MENTIONS a specifier as an unresolved import', () => {
    // Realistic: these files document their own import idiom, so a comment naming the
    // relative form is expected. The first guard threw on it, which made --write refuse to
    // sync ALL EIGHT pairs — a total outage of the tool over a comment.
    // ⚠️ The comment must END with the specifier. A trailing-prose variant is caught by the
    // end-anchor in SURVIVING_SPECIFIER and would pass even with the comment exclusion removed —
    // i.e. it would assert nothing. This form is the one that genuinely needs the exclusion.
    const source = ["// ported from './schema'", 'export const A = 1', ''].join('\n')
    const generated = generateNormalized('src/lib/visa/fixture.ts', source)

    assert.equal(generated, `${banner('src/lib/visa/fixture.ts')}\n${source}`)
    assert.ok(
      generated.includes("// ported from './schema'"),
      'the comment must survive byte-identical, not be rewritten to the alias',
    )
  })

  it('does not rewrite a relative path INSIDE a string on an export line', () => {
    // `export const X = "…from './schema'"` starts with `export`, so the old line test matched
    // and the generator silently edited the string's CONTENTS in the forum copy. normalize()
    // folds './x' and '@/lib/visa/x' together, so no guard could see the mutation.
    const source = ['export const AAD_DOC = "the AAD literal is copied from \'./schema\'"', ''].join('\n')
    const generated = generateNormalized('src/lib/visa/fixture.ts', source)

    assert.ok(
      generated.includes('export const AAD_DOC = "the AAD literal is copied from \'./schema\'"'),
      'string contents must be carried through verbatim',
    )
    assert.ok(!generated.includes("copied from '@/lib/visa/schema'"), 'the string must not be rewritten')
  })

  it('refuses to write when a DYNAMIC import keeps a relative specifier', () => {
    // Never on a statement line, so the rewrite cannot reach it; the forum copy would not
    // resolve it, and normalize() would still report the pair as in sync.
    const source = ['const mod = await import(\'./schema\')', ''].join('\n')

    assert.throws(
      () => generateNormalized('src/lib/visa/fixture.ts', source),
      /keeps a relative visa specifier the rewrite could not reach/,
    )
  })

  it('copies EXACT pairs byte-for-byte, banner and all', () => {
    const dir = fixtureRepo()
    const source = '/* header */ export const KEEP = 1\nexport const B = 2\n'
    put(dir, 'src/lib/visa/exact.ts', source)
    put(dir, 'apps/forum/src/lib/visa/exact.ts', '// stale\n')
    const pairs = [{ mode: 'exact', root: 'src/lib/visa/exact.ts', forum: 'apps/forum/src/lib/visa/exact.ts' }]

    runWrite({ root: dir, pairs, ...silent })

    assert.equal(get(dir, 'apps/forum/src/lib/visa/exact.ts'), source)
  })

  it('--write reports what it rewrote, and is idempotent', () => {
    const { dir, forumRel, pairs } = oneNormalizedPair('export const A = 1\n')

    const first = []
    runWrite({ root: dir, pairs, log: (message) => first.push(message) })
    assert.match(first.join('\n'), /rewrote 1 forum file/)
    assert.match(first.join('\n'), new RegExp(forumRel.replace(/[/.]/g, '\\$&')))

    const second = []
    runWrite({ root: dir, pairs, log: (message) => second.push(message) })
    assert.match(second.join('\n'), /already in sync — nothing rewritten/)
  })

  it('refuses to write — and writes NOTHING at all — when a copy cannot be generated safely', () => {
    // A multi-line import: `} from './schema'` is not an import/export line, so the
    // specifier would survive into the forum copy unresolvable, and normalize() folds
    // './schema' and '@/lib/visa/schema' together so no drift check would ever see it.
    const dir = fixtureRepo()
    put(dir, 'src/lib/visa/good.ts', 'export const A = 1\n')
    put(dir, 'apps/forum/src/lib/visa/good.ts', '// stale good\n')
    put(dir, 'src/lib/visa/bad.ts', ["import {", "  visaPayloadSchema,", "} from './schema'", 'export const B = 1', ''].join('\n'))
    put(dir, 'apps/forum/src/lib/visa/bad.ts', '// stale bad\n')
    const pairs = [
      { mode: 'normalized', root: 'src/lib/visa/good.ts', forum: 'apps/forum/src/lib/visa/good.ts' },
      { mode: 'normalized', root: 'src/lib/visa/bad.ts', forum: 'apps/forum/src/lib/visa/bad.ts' },
    ]

    assert.throws(() => runWrite({ root: dir, pairs, ...silent }), /refusing to write/)
    // The healthy pair is listed FIRST: nothing may be written until every pair generated.
    assert.equal(get(dir, 'apps/forum/src/lib/visa/good.ts'), '// stale good\n')
    assert.equal(get(dir, 'apps/forum/src/lib/visa/bad.ts'), '// stale bad\n')
  })

  it('the outer hard guard rejects generated output that would not pass --check', () => {
    const pair = { mode: 'normalized', root: 'src/lib/visa/fixture.ts', forum: 'apps/forum/src/lib/visa/fixture.ts' }
    const source = ["const AAD = Buffer.from('eno-forum:visa-payload:v1')", 'export const A = 1', ''].join('\n')

    // Sound output passes.
    assert.doesNotThrow(() => assertGeneratedPassesCheck(pair, source, generate(pair, source)))

    // An unsound transform (here: one that dropped the AAD line) must be refused. The
    // guard is deliberately transform-agnostic — it is the net under a FUTURE change to
    // generate(), which is why it survives even though today's transform cannot trip it.
    const corrupted = generate(pair, source).split('\n').filter((line) => !line.includes('AAD')).join('\n')
    assert.throws(() => assertGeneratedPassesCheck(pair, source, corrupted), /would NOT pass --check/)
  })

  it('--check exits 0 in sync and non-zero on drift (real CLI, fixture repo)', () => {
    const dir = fixtureRepo()
    mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    copyFileSync(SCRIPT, path.join(dir, 'scripts', 'sync-visa-pairs.mjs'))
    // Materialise the REAL pair table so the CLI runs its own default pairs.
    for (const pair of PAIRS) {
      const source = `// stub for ${pair.root}\nexport const STUB = ${JSON.stringify(pair.root)}\n`
      put(dir, pair.root, source)
      put(dir, pair.forum, generate(pair, source))
    }
    const run = (args) => {
      try {
        return { code: 0, out: execFileSync(process.execPath, [path.join(dir, 'scripts', 'sync-visa-pairs.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
      } catch (error) {
        return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
      }
    }

    const ok = run(['--check'])
    assert.equal(ok.code, 0, ok.out)
    assert.match(ok.out, new RegExp(`${PAIRS.length} pairs in sync`))

    // Hand-edit a forum copy the way a well-meaning contributor would.
    const victim = PAIRS.at(-1)
    writeFileSync(path.join(dir, victim.forum), `${get(dir, victim.forum)}\nexport const HAND_EDITED = 1\n`)
    const drifted = run(['--check'])
    assert.equal(drifted.code, 1, drifted.out)
    assert.match(drifted.out, /DRIFT/)
    assert.match(drifted.out, /HAND_EDITED/)

    // …and --write puts it back.
    assert.equal(run(['--write']).code, 0)
    assert.equal(run(['--check']).code, 0)
  })

  it('--check reports drift on a NORMALIZED pair only for non-comment differences', () => {
    const { dir, forumRel, pairs } = oneNormalizedPair('export const A = 1\n')
    runWrite({ root: dir, pairs, ...silent })
    assert.equal(runCheck({ root: dir, pairs, ...silent }), 0)

    // A comment-only edit is sanctioned drift → still 0.
    writeFileSync(path.join(dir, forumRel), `// a forum-side note\n${get(dir, forumRel)}`)
    assert.equal(runCheck({ root: dir, pairs, ...silent }), 0)

    // A code edit is not.
    writeFileSync(path.join(dir, forumRel), `${get(dir, forumRel)}export const SNEAKY = 2\n`)
    assert.equal(runCheck({ root: dir, pairs, ...silent }), 1)
  })
})
