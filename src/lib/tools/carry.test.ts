import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GUIDE_BANNED } from '@/lib/guides/edition'
import { applyToolCarry, planToolCarry, readRegistry, renderRegistry, toolCtx } from '../../../scripts/carry-tools.mjs'
import { toolDigest } from './canonical'
import { TOOL_CONTENT } from './content.generated'
import { TOOL_CTX } from './content'
import { TOOLS } from './registry'
import * as spec from './spec'
import vectors from './test-vectors.json'

/**
 * scripts/carry-tools.mjs: approved rows from Reach in, eno.vn's files out — only what a person approved, re-validated by eno.vn's
 * own rules, and nothing kept when anything fails.
 */
const ROOT = join(__dirname, '..', '..', '..')
const SPEC = vectors.spec
const DIGEST = toolDigest(SPEC)
const rules = { today: '2026-11-23', validate: (s: unknown) => spec.validateToolSpec(s, TOOL_CTX), digest: toolDigest }
const row = (over: Record<string, unknown> = {}) => ({ slug: SPEC.slug, status: 'approved', digest: DIGEST, approvedOn: '2026-11-23', spec: SPEC, ...over })
const line = { slug: SPEC.slug, published: '2026-11-20', reviewed: '2026-11-20', reviewedDigest: DIGEST }
const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('planning a carry', () => {
  it('an approved, valid spec with its digest becomes a registry line dated today', () => {
    const plan = planToolCarry([row({ approvedOn: '2026-11-22' })], [], rules)
    expect(plan.problems).toEqual([])
    expect(plan.carry.map((r: { slug: string }) => r.slug)).toEqual([SPEC.slug])
    expect(plan.entries).toEqual([{ slug: SPEC.slug, published: '2026-11-23', reviewed: '2026-11-22', reviewedDigest: DIGEST }])
  })

  it('only approved rows are carried; drafts, ideas and rejected ones are left where they are', () => {
    for (const status of ['idea', 'writing', 'draft', 'failed', 'rejected', 'published']) expect(planToolCarry([row({ status })], [], rules).carry, status).toEqual([])
  })

  it('⛔ a spec that is not what was approved, or that eno.vn refuses, stops the run', () => {
    const changed = { ...SPEC, title: { ...SPEC.title, en: 'Shared home cost splitter, edited' } }
    expect(planToolCarry([row({ spec: changed })], [], rules).problems.join(' ')).toMatch(/not what the person approved/)
    const banned = { ...SPEC, intro: { ...SPEC.intro, en: `${SPEC.intro.en} No visa needed.` } }
    expect(planToolCarry([row({ spec: banned, digest: toolDigest(banned) })], [], rules).problems.join(' ')).toMatch(/eno.vn refuses its spec/)
    expect(planToolCarry([row({ digest: null })], [], rules).problems.join(' ')).toMatch(/not what the person approved/)
    expect(planToolCarry([row({ slug: 'other-slug' })], [], rules).problems.join(' ')).toMatch(/its spec says it is/)
    expect(planToolCarry([row({ approvedOn: '2026-11-24' })], [], rules).problems.join(' ')).toMatch(/no usable approval date/)
  })

  it('⛔ a carried tool Reach no longer has as approved or published stops the run', () => {
    expect(planToolCarry([], [line], rules).problems.join(' ')).toMatch(/in the registry but not in Reach/)
    expect(planToolCarry([row({ status: 'rejected' })], [line], rules).problems.join(' ')).toMatch(/a person took it back/)
    expect(planToolCarry([row({ status: 'published' })], [line], rules).problems).toEqual([])
  })

  it('already carried is nothing to do; a newly approved version keeps the day it first went live', () => {
    expect(planToolCarry([row()], [line], rules).carry).toEqual([])
    const v2 = { ...SPEC, title: { ...SPEC.title, en: 'Shared home cost splitter, second' } }
    const plan = planToolCarry([row({ spec: v2, digest: toolDigest(v2) })], [line], rules)
    expect(plan.problems).toEqual([])
    expect(plan.entries).toEqual([{ ...line, reviewed: '2026-11-23', reviewedDigest: toolDigest(v2) }])
  })

  it('a leftover file no line owns is not written over', () => {
    expect(planToolCarry([row()], [], { ...rules, files: new Set([SPEC.slug]) }).problems.join(' ')).toMatch(/already exists/)
  })

  it('eno.vn’s ctx, as the script builds it, is the one the build uses', () => {
    expect(toolCtx(spec, GUIDE_BANNED)).toEqual(TOOL_CTX)
  })
})

describe('writing a carry', () => {
  const fixture = () => {
    const d = mkdtempSync(join(tmpdir(), 'carry-tools-'))
    tmp.push(d)
    const registry = join(d, 'registry.ts')
    writeFileSync(registry, readFileSync(join(__dirname, 'registry.ts'), 'utf8'))
    const generated = join(d, 'content.generated.ts')
    writeFileSync(generated, 'before\n')
    return { d, registry, generated, contentDir: join(d, 'content') }
  }

  it('the registry block reads back what it writes, the real one included, whatever it holds', () => {
    const source = readFileSync(join(__dirname, 'registry.ts'), 'utf8')
    expect(readRegistry(source)).toEqual(TOOLS.map((e) => ({ ...e })))
    expect(renderRegistry(source, readRegistry(source))).toBe(source)
    expect(readRegistry(renderRegistry(source, [line]))).toEqual([line])
    expect(() => readRegistry(source.replace('// </generated-tools>', "{ slug: 'x', note: 'y' },\n  // </generated-tools>"))).toThrow(/cannot read/)
  })

  it('writes the spec and the line; a failing check puts every file back', () => {
    const f = fixture()
    const plan = planToolCarry([row()], [], rules)
    applyToolCarry(plan, { ...f, check: () => {} })
    expect(JSON.parse(readFileSync(join(f.contentDir, `${SPEC.slug}.json`), 'utf8'))).toEqual(SPEC)
    expect(readRegistry(readFileSync(f.registry, 'utf8'))).toEqual(plan.entries)

    const g = fixture()
    const before = readFileSync(g.registry, 'utf8')
    expect(() => applyToolCarry(plan, { ...g, check: () => { throw new Error('vitest failed') } })).toThrow('vitest failed')
    expect(readFileSync(g.registry, 'utf8')).toBe(before)
    expect(readFileSync(g.generated, 'utf8')).toBe('before\n')
    expect(existsSync(join(g.contentDir, `${SPEC.slug}.json`))).toBe(false)
  })

  it('the script itself, with eno.vn’s TypeScript rules (dry run, so nothing is written)', () => {
    const d = mkdtempSync(join(tmpdir(), 'carry-tools-rows-'))
    tmp.push(d)
    mkdirSync(d, { recursive: true })
    const run = (rows: unknown[]) => {
      writeFileSync(join(d, 'rows.json'), JSON.stringify(rows))
      return spawnSync(process.execPath, ['--no-warnings', 'scripts/carry-tools.mjs', '--from-file', join(d, 'rows.json'), '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
    }
    // As Reach exports them: every tool the real registry holds (on eno.vn, so published), and one new approved tool under an
    // address the registry does not have — so this holds whatever has been carried for real.
    const held = TOOLS.map((e) => ({ slug: e.slug, status: 'published', digest: e.reviewedDigest, approvedOn: e.reviewed, spec: TOOL_CONTENT[e.slug] }))
    let slug = 'carry-dry-run-tool'
    while (TOOLS.some((e) => e.slug === slug) || slug in TOOL_CONTENT) slug += '-x'
    const fresh = { ...SPEC, slug }
    const ok = run([...held, row({ slug, spec: fresh, digest: toolDigest(fresh) })])
    expect(ok.status, ok.stderr).toBe(0)
    expect(ok.stdout).toContain(`would carry https://eno.vn/tools/${slug}`)
    const bad = run([...held, row({ slug, spec: fresh, digest: '0000000000000000' })])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('Nothing written')
  })
})
