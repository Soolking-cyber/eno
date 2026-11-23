import { afterEach, describe, expect, it, vi } from 'vitest'
import { toolDigest } from './canonical'
import vectors from './test-vectors.json'

/**
 * ⛔ THE APPROVAL GATE, AT BUILD TIME (src/lib/tools/content.ts): a spec shows only when the registry has it reviewed, and only
 * while it is still the spec that was reviewed. Run against a stand-in registry and content, since eno.vn ships with none.
 */
const state = vi.hoisted(() => ({ content: {} as Record<string, unknown>, tools: [] as { slug: string; published: string; reviewed: string; reviewedDigest: string }[] }))
vi.mock('./content.generated', () => ({ get TOOL_CONTENT() { return state.content } }))
vi.mock('./registry', () => ({ get TOOLS() { return state.tools } }))

const SPEC = vectors.spec
const SLUG = SPEC.slug
const entry = (over: Partial<(typeof state.tools)[number]> = {}) => ({ slug: SLUG, published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: toolDigest(SPEC), ...over })
const load = async () => { vi.resetModules(); return import('./content') }
afterEach(() => { state.content = {}; state.tools = [] })

describe('which generated tools eno.vn shows', () => {
  it('none at all: no tool, and nothing breaks', async () => {
    const c = await load()
    expect(c.liveTools()).toEqual([])
    expect(c.liveTool(SLUG)).toBeNull()
  })

  it('a reviewed tool whose spec is the one reviewed', async () => {
    state.content = { [SLUG]: SPEC }
    state.tools = [entry()]
    const c = await load()
    expect(c.liveTool(SLUG)?.title.en).toBe(SPEC.title.en)
    expect(c.liveTools().map((t) => t.entry.slug)).toEqual([SLUG])
    expect([c.toolPath(SLUG, 'en'), c.toolPath(SLUG, 'vi')]).toEqual([`/tools/${SLUG}`, `/vi/tools/${SLUG}`])
  })

  it('a spec with no registry line, or one not reviewed, is a 404', async () => {
    state.content = { [SLUG]: SPEC }
    expect((await load()).liveTool(SLUG)).toBeNull()
    state.tools = [entry({ reviewed: '', reviewedDigest: '' })]
    expect((await load()).liveTool(SLUG)).toBeNull()
  })

  it('⛔ a spec changed after its review stops the build', async () => {
    state.content = { [SLUG]: { ...SPEC, title: { ...SPEC.title, en: 'Shared home cost splitter, now different' } } }
    state.tools = [entry()]
    await expect(load()).rejects.toThrow(/changed after its review/)
    state.content = { [SLUG]: SPEC }
    state.tools = [entry({ reviewedDigest: '' })]
    await expect(load()).rejects.toThrow(/no reviewedDigest/)
  })

  it('a spec eno.vn’s own rules refuse, or filed under another address, stops the build', async () => {
    state.content = { [SLUG]: { ...SPEC, intro: { ...SPEC.intro, en: `${SPEC.intro.en} It ignores your visa.` } } }
    await expect(load()).rejects.toThrow(/is invalid/)
    state.content = { 'another-tool': SPEC }
    await expect(load()).rejects.toThrow(/declares slug/)
    state.content = { 'move-in-cost-calculator': { ...SPEC, slug: 'move-in-cost-calculator' } }
    await expect(load()).rejects.toThrow(/hand-built tool/)
  })

  it('a tool listed twice stops the build', async () => {
    state.content = { [SLUG]: SPEC }
    state.tools = [entry(), entry()]
    await expect(load()).rejects.toThrow(/listed twice/)
  })
})
