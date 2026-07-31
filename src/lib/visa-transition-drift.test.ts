import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Visa ADMIN TRANSITION-MAP drift guard.
//
// The legal status transitions for a visa application are written out TWICE, by hand:
//   · src/lib/visa-admin.ts                                        → VISA_ADMIN_TRANSITIONS
//   · apps/forum/src/app/api/visa/admin/applications/[id]/route.ts → transitions
// Both files' comments say they must stay identical, and until now nothing enforced it. The
// two apps deploy independently against the SAME Supabase rows, so a divergence produces no
// merge conflict and no type error — just one admin surface permitting a transition the other
// forbids, on a money-adjacent workflow (payment_required / submitted / approved). This repo
// has already been bitten that way once, which is why sync-pairs.test.ts exists.
//
// ⚠️ NOT refactored into a shared module, deliberately: the forum/eno.vn deployment boundary
// is intentional. This test makes divergence FAIL; it does not couple the two apps.
//
// ⚠️ These are NOT byte-comparable sync pairs — one is a library, the other a route handler,
// and the constants even have different names. So the maps are compared by MEANING.
//
// ⚠️ PARSED WITH THE TYPESCRIPT AST, not regex. A hand-rolled text parser was the first cut and
// both external reviewers refuted it for the same reason: a regex silently SKIPS syntax it does
// not understand (a spread, a quoted or computed key, a template literal, a `]` inside a string
// or comment, a nested array). If both files adopted such syntax for the same key, both maps
// would skip it identically, compare equal, and the guard would report green while the two
// production maps disagreed. The AST cannot skip anything: every property is visited, and
// anything that is not a plain `identifier: ['literal', …]` throws instead of being ignored.

const ROOT_FILE = 'src/lib/visa-admin.ts'
// ⚠️ NOT `.svc.` — this one points into apps/forum, whose copies were NOT renamed by the edition
// split. A blanket path rewrite caught it because the string contains `app/api/visa` too.
const FORUM_FILE = 'apps/forum/src/app/api/visa/admin/applications/[id]/route.ts'

type TransitionMap = Record<string, string[]>

/**
 * Read `<name> = { … }` out of a file via the TypeScript AST.
 *
 * Every failure mode throws with the file and the offending construct, because for this guard a
 * parse that cannot be trusted must be indistinguishable from drift — silence is the one
 * outcome that would make the whole test worthless.
 */
function extractMap(file: string, constName: string): TransitionMap {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

  let literal: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName
    ) {
      if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) {
        throw new Error(`${file}: ${constName} is no longer a plain object literal — this guard cannot verify it.`)
      }
      literal = node.initializer
    }
    if (!literal) ts.forEachChild(node, visit)
  }
  visit(source)
  if (!literal) throw new Error(`${file}: could not find "${constName}" — was the constant renamed or moved?`)

  const out: TransitionMap = {}
  for (const prop of literal.properties) {
    const where = `${file}: ${constName}`
    // Anything other than `key: value` — a spread, a shorthand, a getter, a method — is a
    // construct this guard cannot compare. Fail rather than ignore.
    if (!ts.isPropertyAssignment(prop)) {
      throw new Error(`${where}: unsupported entry "${prop.getText()}" (spread/shorthand/method). Compare it by hand or extend this guard.`)
    }
    const nameNode = prop.name
    const key = ts.isIdentifier(nameNode) ? nameNode.text
      : ts.isStringLiteral(nameNode) ? nameNode.text
      : undefined
    if (key === undefined) {
      throw new Error(`${where}: computed or non-literal key "${nameNode.getText()}" cannot be compared.`)
    }
    if (key in out) throw new Error(`${where}: duplicate key "${key}" — the later one silently wins at runtime.`)
    if (!ts.isArrayLiteralExpression(prop.initializer)) {
      throw new Error(`${where}: "${key}" is not an array literal (${prop.initializer.getText()}). A variable or call cannot be compared statically.`)
    }
    out[key] = prop.initializer.elements.map((el) => {
      if (!ts.isStringLiteral(el) && !ts.isNoSubstitutionTemplateLiteral(el)) {
        throw new Error(`${where}: "${key}" contains a non-literal target (${el.getText()}).`)
      }
      return el.text
    })
  }
  return out
}

const root = extractMap(ROOT_FILE, 'VISA_ADMIN_TRANSITIONS')
const forum = extractMap(FORUM_FILE, 'transitions')

describe('visa admin transition map — root/forum drift guard', () => {
  // Everything below compares root to forum, and two EMPTY maps compare equal. The AST parser
  // above throws rather than returning a partial map, so this floor is a second belt: it proves
  // the extraction found a real workflow, not a plausible-looking fragment.
  it('extracted two real maps (a broken parser must fail, not pass silently)', () => {
    for (const [label, map] of [['root', root], ['forum', forum]] as const) {
      expect({ label, keys: Object.keys(map).length >= 10 }).toEqual({ label, keys: true })
      for (const key of ['draft', 'ready_for_review', 'payment_required', 'processing', 'approved', 'cancelled']) {
        expect({ label, key, present: key in map }).toEqual({ label, key, present: true })
      }
      // A real workflow has states that can still move, and states that are terminal.
      expect({ label, movable: Object.values(map).some((v) => v.length > 0) }).toEqual({ label, movable: true })
      expect({ label, terminal: Object.values(map).some((v) => v.length === 0) }).toEqual({ label, terminal: true })
    }
  })

  it('both copies define exactly the same set of statuses', () => {
    expect(Object.keys(root).sort()).toEqual(Object.keys(forum).sort())
  })

  it('every status permits exactly the same transitions, in the same order', () => {
    // Order-SENSITIVE on purpose. "Identical" is what both files claim, and comparing as sets
    // would hide a reorder — which a consumer rendering admin actions in declaration order
    // would show the operator as a differently-ordered set of buttons on the two apps.
    // Asserted per status so a failure names the one that drifted instead of dumping both maps.
    for (const status of Object.keys(root).sort()) {
      expect({ status, to: root[status] }).toEqual({ status, to: forum[status] })
    }
  })

  it('neither copy lists a duplicate target', () => {
    // Harmless at runtime, but the fingerprint of a hand-merge — precisely the edit that drifts
    // these two files.
    for (const [label, map] of [['root', root], ['forum', forum]] as const) {
      for (const [status, targets] of Object.entries(map)) {
        expect({ label, status, unique: [...new Set(targets)].length }).toEqual({ label, status, unique: targets.length })
      }
    }
  })

  it('every transition target is itself a declared status', () => {
    // Referential integrity — catches a typo'd destination ('cancelled' → 'canceled') that would
    // otherwise just make a transition quietly unreachable in one app.
    for (const [label, map] of [['root', root], ['forum', forum]] as const) {
      const declared = new Set(Object.keys(map))
      for (const [status, targets] of Object.entries(map)) {
        for (const target of targets) {
          expect({ label, status, target, declared: declared.has(target) }).toEqual({ label, status, target, declared: true })
        }
      }
    }
  })

  it('both files still carry the comment that says they must match', () => {
    // If the warning is deleted, the next reader has no reason to keep them in step and this
    // test's reason for existing becomes invisible.
    expect(readFileSync(ROOT_FILE, 'utf8')).toMatch(/MUST stay identical to the forum route/i)
  })
})

// ── What this guard does NOT cover (both reviewers raised these; they are inherent to a static
// check, and are written down rather than papered over):
//   · a map MUTATED after declaration, or a caller that hardcodes its own transitions instead of
//     reading the constant;
//   · production running a different revision than the checkout this test ran against.
// Neither is reachable by reading a source file. If either becomes a real risk, the answer is a
// runtime assertion at the admin PATCH boundary, not a bigger parser here.
