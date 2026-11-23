import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDITION_BANNED } from '@/test/edition-words'
import { GUIDE_BANNED } from '@/lib/guides/edition'
import { RENT_TOOLS, RENT_TOOL_SLUGS } from '@/lib/rent-tools/registry'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { UNLINKED_CATEGORIES } from '@/lib/retired-categories'
import { formatMoneyFull } from '@/lib/vnd'
import { MAX_ONE_OFF_VND } from '@/lib/rent-tools/calc'
import { canonicalJson, toolDigest } from './canonical'
import { TOOL_CONTENT } from './content.generated'
import { liveTools, TOOL_CTX } from './content'
import { checkFormula, constantsIn, evaluate, FORMULA_LIMITS, namesIn, parseFormula, roundTo, type Kind, type Value } from './expr'
import { TOOLS } from './registry'
import { formatOutput, runTool } from './run'
import { TOOL_INTERNALS_BANNED, TOOL_LINKS, TOOL_SPEC_VERSION, validateToolSpec, type ToolCtx, type ToolSpec } from './spec'
import vectors from './test-vectors.json'

/**
 * The generated tools' rules (owner, 2026-11-23: eno Reach writes one tool a night): the formula language, the spec validator,
 * the digest an approval binds to, and the registry gate. test-vectors.json is run by eno Reach too (its test/tools.test.ts),
 * against its verbatim copy of these modules: the two must agree case by case.
 */
const ROOT = join(__dirname, '..', '..', '..')
const SPEC = vectors.spec as unknown as ToolSpec
const VECTOR_CTX: ToolCtx = { relatedPaths: vectors.ctx.relatedPaths, banned: [...vectors.ctx.banned.map((s) => new RegExp(s, 'i')), TOOL_INTERNALS_BANNED] }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const set = (o: unknown, path: (string | number)[], value: unknown) => {
  let at = o as Record<string | number, unknown>
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>
  at[path[path.length - 1]] = value
}

describe('the shared test vectors (eno Reach runs the same file)', () => {
  it('every formula parses, types and evaluates as the vector says', () => {
    const { names, values, cases } = vectors.expressions
    for (const c of cases) {
      const p = parseFormula(c.formula)
      let got: { error: string } | { result: Value | null }
      if (!p.ok) got = { error: 'parse' }
      else {
        const t = checkFormula(p.node, names as Record<string, Kind>)
        got = t.ok ? { result: evaluate(p.node, values) } : { error: 'type' }
      }
      expect(got, c.formula).toEqual('error' in c ? { error: c.error } : { result: c.result })
    }
  })

  it('the vector spec is valid and has the vector digest', () => {
    expect(validateToolSpec(SPEC, VECTOR_CTX)).toEqual([])
    expect(toolDigest(SPEC)).toBe(vectors.digest)
  })

  it('each mutation is refused for its reason (or, with none, passes)', () => {
    for (const m of vectors.mutations) {
      const s = clone(SPEC)
      for (const [path, value] of m.set as [(string | number)[], unknown][]) set(s, path, value)
      const got = validateToolSpec(s, VECTOR_CTX)
      if (m.problem === null) expect(got, m.name).toEqual([])
      else expect(got.some((p) => p.includes(m.problem!)), `${m.name}: ${JSON.stringify(got)}`).toBe(true)
    }
  })

  it('canonical JSON and its digest', () => {
    for (const c of vectors.canonical) {
      expect(canonicalJson(c.value)).toBe(c.json)
      expect(toolDigest(c.value)).toBe(c.digest)
    }
  })
})

describe('the formula language', () => {
  it('holds its caps: 300 characters, depth 20, 200 parts', () => {
    expect(parseFormula(`a${' + a'.repeat(100)}`)).toMatchObject({ ok: false, error: expect.stringContaining('characters') })
    expect(parseFormula('('.repeat(21) + 'a' + ')'.repeat(21))).toMatchObject({ ok: false, error: expect.stringContaining('deeper') })
    expect(parseFormula(Array.from({ length: 20 }, () => 'a').join('+'))).toMatchObject({ ok: true })
    expect(parseFormula(Array.from({ length: 21 }, () => 'a').join('+'))).toMatchObject({ ok: false, error: expect.stringContaining('deeper') })
    // Wide is fine where deep is not: max() of max()es is 73 parts at depth 3. (200 parts cannot fit in 300 characters at
    // depth 20, so the parts cap is a second guard, not one a formula can reach.)
    const wide = `max(${Array.from({ length: 8 }, () => `max(${Array.from({ length: 8 }, () => 'a').join(',')})`).join(',')})`
    expect(wide.length).toBeLessThanOrEqual(FORMULA_LIMITS.chars)
    expect(parseFormula(wide).ok).toBe(true)
  })

  it('never evaluates text as code, and has no lookbehind (Safari 16.0–16.3)', () => {
    for (const f of ['expr.ts', 'run.ts', 'spec.ts', 'canonical.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/\beval\s*\(|new Function|Function\s*\(/)
      expect(src, f).not.toContain('(?<')
    }
  })

  it('rounds half away from zero, without float drift', () => {
    expect([roundTo(2.5), roundTo(-2.5), roundTo(1.005, 2), roundTo(1234567, -3), roundTo(-0.4), roundTo(1e-7, 2)]).toEqual([3, -3, 1.01, 1235000, 0, 0])
    // Moving the point past 1e21 once gave NaN (codex review, 2026-11-23); a double that large is whole already.
    expect([roundTo(1e15, 6), roundTo(-1e15, 6), roundTo(123456789.123456, 6), roundTo(2 ** 53, 3)]).toEqual([1e15, -1e15, 123456789.123456, 2 ** 53])
    expect(Object.is(roundTo(-0.4), 0)).toBe(true)
  })

  it('names what a formula reads and the numbers written in it (round’s digits aside)', () => {
    const p = parseFormula('round(rent * 12 / pay, 2) + if(x > 3, 1, 0)')
    if (!p.ok) throw new Error(p.error)
    expect(namesIn(p.node).sort()).toEqual(['pay', 'rent', 'x'])
    expect(constantsIn(p.node).sort((a, b) => a - b)).toEqual([0, 1, 3, 12])
  })

  it('a value that is not finite, or absurd, cannot be computed', () => {
    const p = parseFormula('a + 1')
    if (!p.ok) throw new Error(p.error)
    for (const a of [NaN, Infinity, -Infinity, 2e15]) expect(evaluate(p.node, { a }), String(a)).toBeNull()
    expect(evaluate(p.node, {})).toBeNull()
  })
})

describe('the spec validator', () => {
  it('never throws, whatever it is given', () => {
    const junk: unknown[] = [null, undefined, 0, 'x', [], {}, { version: 1 }, { ...SPEC, inputs: 'x' }, { ...SPEC, outputs: [null, 1] }, { ...SPEC, tests: [{}] }, { ...SPEC, title: [] }, { ...SPEC, inputs: [{ id: 'a', kind: 'choice', label: SPEC.title, help: SPEC.title, default: 1, min: 1, max: 2, choices: 'x' }] },
      // An object whose toString is not a function makes String() and a template throw (codex review, 2026-11-23).
      { ...SPEC, title: { en: { toString: null }, vi: { toString: null } }, description: { en: { toString: null }, vi: 'x' }, related: [{ toString: null }] }]
    for (const j of junk) expect(validateToolSpec(j, TOOL_CTX).length, JSON.stringify(j)?.slice(0, 80)).toBeGreaterThan(0)
  })

  it('eno.vn’s rule set: the edition rule itself, and the internals list', () => {
    expect(TOOL_CTX.banned[0]).toBe(GUIDE_BANNED)
    expect(GUIDE_BANNED.source).toBe(EDITION_BANNED.source)
    expect(TOOL_CTX.banned).toContain(TOOL_INTERNALS_BANNED)
    expect(validateToolSpec(SPEC, TOOL_CTX)).toEqual([])
    for (const [w, path] of [['visa', ['intro', 'en']], ['tạm trú', ['faqs', 1, 'a', 'vi']], ['moderation', ['limitations', 'en']], ['ranking algorithm', ['howItWorks', 'en']]] as const) {
      const s = clone(SPEC)
      const at = path.slice(0, -1).reduce<Record<string | number, unknown>>((o, k) => o[k] as Record<string | number, unknown>, s as unknown as Record<string, unknown>)
      at[path[path.length - 1]] = `${String(at[path[path.length - 1]])} It never mentions ${w} or anything like it at all.`
      expect(validateToolSpec(s, TOOL_CTX).join(' | '), w).toMatch(/may not appear on eno\.vn/)
    }
    // An id is read as words too: a camelCase "visaFee" is the word.
    const s = clone(SPEC)
    s.outputs[1].id = 'visaFee'
    expect(validateToolSpec(s, TOOL_CTX).join(' | ')).toMatch(/may not appear on eno\.vn/)
  })

  it('the version every spec carries is this one', () => expect(SPEC.version).toBe(TOOL_SPEC_VERSION))

  it('a formula reads only earlier outputs; a reserved word is no id', () => {
    const s = clone(SPEC)
    s.outputs[0].formula = 'total / people'
    expect(validateToolSpec(s, TOOL_CTX).join(' | ')).toMatch(/"total" is not an input or an earlier output/)
    const r = clone(SPEC)
    r.inputs[0].id = 'max'
    expect(validateToolSpec(r, TOOL_CTX).join(' | ')).toMatch(/a word formulas reserve/)
  })

  it('a test is held to its answer within half a percent or what the page prints of it', () => {
    const near = clone(SPEC)
    near.tests[0].expect = { ...SPEC.tests[0].expect, perPerson: 6750000 * 1.004 }
    expect(validateToolSpec(near, TOOL_CTX)).toEqual([])
    const far = clone(SPEC)
    far.tests[0].expect = { ...SPEC.tests[0].expect, perPerson: 6750000 * 1.006 }
    expect(validateToolSpec(far, TOOL_CTX).join(' | ')).toMatch(/should be/)
  })

  it('a money input goes up to 100 tỷ, the ceiling the page reads money to (MAX_ONE_OFF_VND), and no further', () => {
    const at = clone(SPEC)
    at.inputs[0].max = MAX_ONE_OFF_VND
    expect(validateToolSpec(at, TOOL_CTX)).toEqual([])
    const past = clone(SPEC)
    past.inputs[0].max = MAX_ONE_OFF_VND + 1
    expect(validateToolSpec(past, TOOL_CTX).join(' | ')).toMatch(/a money input is whole đồng from 0 to 100000000000/)
  })

  it('refuses a spec over 20 KB', () => {
    const s = clone(SPEC) as ToolSpec & { [k: string]: unknown }
    s.faqs = Array.from({ length: 5 }, () => ({ q: SPEC.faqs[0].q, a: { en: 'x'.repeat(700), vi: 'ạ'.repeat(690) } }))
    s.howItWorks = { en: 'y'.repeat(1500), vi: 'ạ'.repeat(1500) }
    s.intro = { en: 'z'.repeat(600), vi: 'ạ'.repeat(600) }
    s.limitations = { en: Array.from({ length: 4 }, () => 'w'.repeat(190)).join('\n'), vi: Array.from({ length: 4 }, () => 'ạ'.repeat(190)).join('\n') }
    expect(validateToolSpec(s, TOOL_CTX).join(' | ')).toMatch(/bytes, at most 20480/)
  })
})

describe('the links a tool may print', () => {
  const pageDir = (p: string) => join(ROOT, 'src/app/[lang]', p.slice(1))
  it('each is a live eno.vn page in both languages: a root page, a live category or the tools hub', () => {
    for (const p of Object.keys(TOOL_LINKS)) {
      if (p.startsWith('/c/')) {
        const slug = p.slice(3)
        expect(CATEGORY_BY_SLUG[slug], p).toBeTruthy()
        expect(UNLINKED_CATEGORIES.has(slug), p).toBe(false)
        continue
      }
      // A marketplace page: a page.tsx of its own (a forum-only page has only page.forum.svc.tsx).
      expect(existsSync(join(pageDir(p), 'page.tsx')) && statSync(pageDir(p)).isDirectory(), p).toBe(true)
    }
  })

  it('a rent tool’s link says what its own page is called', () => {
    for (const s of RENT_TOOL_SLUGS) expect(TOOL_LINKS[`/${s}`], s).toEqual(RENT_TOOLS[s].label)
  })

  it('eno.vn’s ctx offers exactly these paths', () => expect([...TOOL_CTX.relatedPaths].sort()).toEqual(Object.keys(TOOL_LINKS).sort()))
})

describe('running a tool', () => {
  it('outputs in order, a later one reading an earlier; notes by their condition', () => {
    const r = runTool(SPEC, { rent: 12000000, bills: 1500000, people: 2 })
    expect(r.outputs).toEqual({ perPerson: 6750000, total: 13500000, perPersonYear: 81000000 })
    expect(r.notes).toEqual([])
    expect(runTool(SPEC, { rent: 1000000, bills: 2000000, people: 3 }).notes).toEqual([0])
  })

  it('an output that cannot be computed takes the outputs reading it with it, and a note on it does not show', () => {
    const s = clone(SPEC)
    s.outputs[0].formula = '(rent + bills) / (people - 2)'
    s.notes = [{ when: 'perPerson > 0', text: SPEC.notes[0].text }]
    const r = runTool(s, { rent: 1, bills: 1, people: 2 })
    expect(r.outputs).toEqual({ perPerson: null, total: 2, perPersonYear: null })
    expect(r.notes).toEqual([])
  })

  it('prints money as the site does, in each language’s grouping', () => {
    for (const v of [0, 999, 1000, 6750000, 1234567.6]) {
      expect(formatOutput(v, 'money', 'en'), String(v)).toBe(formatMoneyFull(v, '₫', 'en'))
      expect(formatOutput(v, 'money', 'vi'), String(v)).toBe(formatMoneyFull(v, '₫', 'vi'))
    }
    expect([formatOutput(32.45, 'percent', 'en'), formatOutput(32.45, 'percent', 'vi')]).toEqual(['32.5%', '32,5%'])
    expect([formatOutput(1, 'months', 'en'), formatOutput(1.5, 'months', 'en'), formatOutput(1.5, 'months', 'vi')]).toEqual(['1 month', '1.5 months', '1,5 tháng'])
    expect(formatOutput(-0.4, 'money', 'en')).toBe('0 đ')
  })
})

describe('input values, at the input’s precision', () => {
  it('a percent to 2 decimals, a number to 4, months to 1, money in đồng, a choice by its words', async () => {
    const { formatInputValue } = await import('./input-format')
    expect([formatInputValue({ kind: 'percent' }, 7.25, 'en'), formatInputValue({ kind: 'percent' }, 0.25, 'vi')]).toEqual(['7.25%', '0,25%'])
    expect([formatInputValue({ kind: 'number' }, 1.2345, 'en'), formatInputValue({ kind: 'months' }, 1.5, 'vi'), formatInputValue({ kind: 'months' }, 1, 'en')]).toEqual(['1.2345', '1,5 tháng', '1 month'])
    expect(formatInputValue({ kind: 'money' }, 1500000, 'vi')).toBe('1.500.000 đ')
    expect(formatInputValue(SPEC.inputs[2], 3, 'en')).toEqual({ en: '3 people', vi: '3 người' })
  })
})

describe('the registry gate', () => {
  it('scripts/gen-tools.mjs runs through a symlink too (its main check compares real paths)', async () => {
    const { mkdtempSync, rmSync, statSync, symlinkSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { spawnSync } = await import('node:child_process')
    const dir = mkdtempSync(join(tmpdir(), 'gen-tools-link-'))
    try {
      const link = join(dir, 'gen-tools.mjs')
      symlinkSync(join(ROOT, 'scripts/gen-tools.mjs'), link)
      const out = join(ROOT, 'src/lib/tools/content.generated.ts')
      const before = readFileSync(out, 'utf8')
      const was = statSync(out).mtimeMs
      const r = spawnSync(process.execPath, [link], { encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      expect(statSync(out).mtimeMs).toBeGreaterThan(was) // it wrote (the same index: nothing changed in the directory)
      expect(readFileSync(out, 'utf8')).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registry and content are one to one, and content.generated.ts matches the directory (node scripts/gen-tools.mjs)', async () => {
    const { contentSlugs, renderIndex } = await import('../../../scripts/gen-tools.mjs')
    const dir = contentSlugs()
    expect(Object.keys(TOOL_CONTENT).sort()).toEqual(dir)
    expect(TOOLS.map((e) => e.slug).sort()).toEqual(dir)
    expect(readFileSync(join(ROOT, 'src/lib/tools/content.generated.ts'), 'utf8')).toBe(renderIndex(dir))
  })

  it('the index imports each spec, so it reaches the standalone build', async () => {
    const { renderIndex } = await import('../../../scripts/gen-tools.mjs')
    expect(renderIndex(['a-tool', 'b-tool'])).toContain("import t0 from '@/content/tools/a-tool.json'")
    expect(renderIndex(['a-tool', 'b-tool'])).toContain("'b-tool': t1,")
    expect(renderIndex([])).toContain('Record<string, unknown>> = {\n}')
  })

  it('every tool in the registry carries the digest of exactly its spec (the build checks it too)', () => {
    for (const e of TOOLS) expect(e.reviewedDigest, e.slug).toBe(toolDigest(TOOL_CONTENT[e.slug]))
    expect(liveTools().length).toBe(TOOLS.length)
  })

  it('the registry block is the carry script’s to write', () => {
    const src = readFileSync(join(__dirname, 'registry.ts'), 'utf8')
    expect(src).toContain('  // <generated-tools>\n')
    expect(src).toContain('  // </generated-tools>\n')
    expect(readdirSync(__dirname)).toContain('test-vectors.json')
  })
})
