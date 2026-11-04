import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentDigest } from '@/lib/teach-guides/digest'
import { applyCarry, digestOf, guideAddress, planCarry, readRegistry, renderRegistry } from '../../../scripts/carry-guides.mjs'

const TODAY = '2026-11-05'
const doc = (slug: string, extra = {}) => ({ slug, title: 'A title', ...extra })
const row = (slug: string, extra: Record<string, unknown> = {}) => {
  const d = (extra.doc as object | undefined) ?? doc(slug)
  return { slug, lang: 'en', status: 'approved', approvedOn: '2026-11-04', digest: digestOf(d), doc: d, ...extra }
}
const SOURCE = "export const GUIDES = [\n  // <generated-guides>\n  // </generated-guides>\n]\n"

describe('carrying approved guides from Reach', () => {
  it('uses the digest eno.vn checks at build time', () => {
    const d = { slug: 'x', title: 'Thuê xe điện', list: [{ b: 1, a: 2 }] }
    expect(digestOf(d)).toBe(contentDigest(d))
  })

  it('dates a new guide today and keeps the day a person approved it', () => {
    const { problems, carry, entries } = planCarry([row('rent-a-bike', { lang: 'vi' })], [], { today: TODAY })
    expect(problems).toEqual([])
    expect(carry.map((r: { slug: string }) => r.slug)).toEqual(['rent-a-bike'])
    expect(entries).toEqual([{ slug: 'rent-a-bike', lang: 'vi', published: TODAY, reviewed: '2026-11-04', reviewedDigest: digestOf(doc('rent-a-bike')) }])
  })

  it('leaves out what has not been approved, and what is already carried', () => {
    const r = row('done')
    const held = [{ slug: 'done', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: r.digest }]
    const { carry, problems, entries } = planCarry([r, { slug: 'a-draft', lang: 'en', status: 'draft' }, { slug: 'an-idea', lang: 'vi', status: 'idea' }], held, { today: TODAY })
    expect(problems).toEqual([])
    expect(carry).toEqual([])
    expect(entries).toEqual(held)
  })

  it('⛔ refuses text that is not what the person approved', () => {
    const { problems } = planCarry([row('edited', { doc: doc('edited', { title: 'Changed since' }), digest: digestOf(doc('edited')) })], [], { today: TODAY })
    expect(problems[0]).toMatch(/not what the person approved/)
    expect(planCarry([row('no-digest', { digest: null })], [], { today: TODAY }).problems[0]).toMatch(/not what the person approved/)
  })

  it('⛔ stops when a carried guide was taken back in Reach, or is unknown to it', () => {
    const held = { slug: 'taken-back', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: 'abc' }
    for (const status of ['rejected', 'idea', 'draft', 'writing', 'failed']) {
      expect(planCarry([{ slug: 'taken-back', lang: 'en', status }], [held], { today: TODAY }).problems[0], status).toMatch(/took it back/)
    }
    expect(planCarry([], [held], { today: TODAY }).problems[0]).toMatch(/not in Reach/)
    const live = row('taken-back', { status: 'published' })
    expect(planCarry([live], [{ ...held, reviewedDigest: live.digest }], { today: TODAY }).problems).toEqual([])
  })

  it('refuses a slug, language, or date eno.vn could not stand behind', () => {
    const one = (r: object) => planCarry([r], [], { today: TODAY }).problems
    expect(one(row('Bad_Slug'))[0]).toMatch(/not an address/)
    expect(one(row('a-guide', { lang: 'fr' }))[0]).toMatch(/no language/)
    expect(one(row('a-guide', { doc: doc('another') , digest: digestOf(doc('another')) }))[0]).toMatch(/says it is "another"/)
    expect(one(row('a-guide', { approvedOn: '2026-11-06' }))[0]).toMatch(/approval date/)
    expect(one(row('a-guide', { approvedOn: null }))[0]).toMatch(/approval date/)
  })

  it('takes a few at a time, oldest approval first, and says what is waiting', () => {
    const rows = ['one', 'two', 'three', 'four'].map((s) => row(s))
    const { carry, waiting, entries } = planCarry(rows, [], { today: TODAY, max: 3 })
    expect(carry.map((r: { slug: string }) => r.slug)).toEqual(['one', 'two', 'three'])
    expect(waiting).toEqual(['four'])
    expect(entries).toHaveLength(3)
  })

  it('a rewrite approved again replaces the digest and the review day, and keeps its first date', () => {
    const r = row('rewritten', { doc: doc('rewritten', { title: 'New words' }), digest: digestOf(doc('rewritten', { title: 'New words' })), approvedOn: TODAY })
    const held = [{ slug: 'rewritten', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: 'old' }]
    const { carry, entries } = planCarry([r], held, { today: TODAY })
    expect(carry).toHaveLength(1)
    expect(entries).toEqual([{ slug: 'rewritten', lang: 'en', published: '2026-11-04', released: '2026-11-04', updated: TODAY, reviewed: TODAY, reviewedDigest: r.digest }])
  })

  it('a rewrite Reach already calls published still comes over, because the first text is what answered', () => {
    const r = row('live-then-rewritten', { status: 'published', doc: doc('live-then-rewritten', { title: 'New words' }), digest: digestOf(doc('live-then-rewritten', { title: 'New words' })), approvedOn: TODAY })
    const held = [{ slug: 'live-then-rewritten', lang: 'en', published: '2026-11-01', reviewed: '2026-11-02', reviewedDigest: 'old' }]
    const { carry, entries } = planCarry([r], held, { today: TODAY })
    expect(carry).toHaveLength(1)
    expect(entries[0]).toMatchObject({ released: '2026-11-02', updated: TODAY, reviewedDigest: r.digest })
    expect(planCarry([row('never-carried', { status: 'published' })], [], { today: TODAY }).carry, 'not in the registry: not ours to bring').toEqual([])
  })

  it('⛔ stops when the registry and Reach disagree on the language, since that moves the address', () => {
    const r = row('moved', { lang: 'vi' })
    const { problems, carry } = planCarry([r], [{ slug: 'moved', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: r.digest }], { today: TODAY })
    expect(problems[0]).toMatch(/its address would change/)
    expect(carry).toEqual([])
  })

  it('writes registry lines it can read back, and refuses a line it did not write', () => {
    const entries = [{ slug: 'a', lang: 'en', published: TODAY, reviewed: TODAY, reviewedDigest: 'abc' }, { slug: 'b', lang: 'vi', published: TODAY, reviewed: TODAY, reviewedDigest: 'def', pair: 'a' }]
    const written = renderRegistry(SOURCE, entries)
    expect(written).toContain("  { slug: 'a', lang: 'en', published: '2026-11-05', reviewed: '2026-11-05', reviewedDigest: 'abc' },\n")
    expect(readRegistry(written)).toEqual(entries)
    expect(readRegistry(SOURCE)).toEqual([])
    expect(renderRegistry(written, [])).toBe(SOURCE)
    expect(() => readRegistry(SOURCE.replace('// </generated', "// a hand note\n  // </generated"))).toThrow(/cannot read/)
    expect(() => readRegistry('no markers')).toThrow(/markers/)
    for (const lost of ["{ slug: 'a', lang: \"vi\", published: '2026-11-05' },", "{ slug: 'a', draft: true },", "{ slug: 'a', ...more },"]) {
      expect(() => readRegistry(SOURCE.replace('  // </generated', `  ${lost}\n  // </generated`)), lost).toThrow(/cannot read/)
    }
  })

  describe('writing', () => {
    const setUp = () => {
      const dir = mkdtempSync(join(tmpdir(), 'carry-guides-'))
      const registry = join(dir, 'registry.ts')
      const generated = join(dir, 'generated.ts')
      writeFileSync(registry, SOURCE)
      writeFileSync(generated, 'the index\n')
      writeFileSync(join(dir, 'old.json'), 'the first text\n')
      return { dir, registry, generated, contentDir: dir }
    }
    const plan = planCarry([row('new-one'), row('old', { doc: doc('old', { title: 'Second' }), digest: digestOf(doc('old', { title: 'Second' })) })], [], { today: TODAY })

    it('keeps the files when eno.vn accepts them, in the order the digest was taken', () => {
      const at = setUp()
      applyCarry(plan, { ...at, check: () => {} })
      expect(digestOf(JSON.parse(readFileSync(join(at.dir, 'new-one.json'), 'utf8')))).toBe(digestOf(doc('new-one')))
      expect(readRegistry(readFileSync(at.registry, 'utf8')).map((e: { slug: string }) => e.slug)).toEqual(['new-one', 'old'])
    })

    it('⛔ puts every file back when eno.vn refuses them, so the next run is not told they are carried', () => {
      const at = setUp()
      expect(() => applyCarry(plan, { ...at, check: () => { writeFileSync(at.generated, 'half done\n'); throw new Error('refused') } })).toThrow('refused')
      expect(existsSync(join(at.dir, 'new-one.json'))).toBe(false)
      expect(readFileSync(join(at.dir, 'old.json'), 'utf8')).toBe('the first text\n')
      expect(readFileSync(at.registry, 'utf8')).toBe(SOURCE)
      expect(readFileSync(at.generated, 'utf8')).toBe('the index\n')
      expect(planCarry(plan.carry, readRegistry(readFileSync(at.registry, 'utf8')), { today: TODAY }).carry, 'still to carry').toHaveLength(2)
    })
  })

  it('points at the address for its language', () => {
    expect(guideAddress({ slug: 'a', lang: 'en' })).toBe('https://eno.vn/guides/a')
    expect(guideAddress({ slug: 'b', lang: 'vi' })).toBe('https://eno.vn/huong-dan/b')
  })
})
