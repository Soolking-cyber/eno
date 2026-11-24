import { describe, expect, it } from 'vitest'
import { allToolDescriptors } from '@/lib/mcp/all-tools'
import { SEARCH_TOOLS_BY_NAME } from '@/app/api/mcp/search/tools'
import { TAXONOMY, isPostableCategory } from '@/lib/taxonomy'

/**
 * ── THE TOOL LIST'S CONTEXT BUDGET (ora.ai "MCP tool listing", 2026-11-24) ─────────────────────────────────────────────
 * ora docks a server whose tools/list "costs" more than 10,000 tokens. Its figure is characters ÷ 4 of the tools as
 * name + title + description + inputSchema + annotations (outputSchema and _meta excluded) written as SPACED JSON — ", "
 * and ": " between items: on its 2026-11-24 scan that measure was 44,986 characters = 11,246 against ora's "about 11,219".
 * `oraTokens` reproduces it (compact JSON plus one space per structural separator). The budget is 9,800 — 2% under the
 * line. A tool added to the one server, or a description grown in a Manufact round, fails here before ora docks it; trim
 * repeated text first (the 2026-11-24 pass: rowItem, annotations.title, restated rules).
 */
const BUDGET_TOKENS = 9_800

/** Structural separators in a JSON value: one ", " per item after the first, one ": " per key. */
function separators(v: unknown): number {
  if (Array.isArray(v)) return Math.max(0, v.length - 1) + v.reduce((n: number, x) => n + separators(x), 0)
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>)
    return Math.max(0, e.length - 1) + e.length + e.reduce((n, [, x]) => n + separators(x), 0)
  }
  return 0
}
function oraTokens(tools: Record<string, unknown>[]): number {
  const list = tools.map((t) => Object.fromEntries(['name', 'title', 'description', 'inputSchema', 'annotations'].filter((k) => k in t).map((k) => [k, t[k]])))
  return (JSON.stringify(list).length + separators(list)) / 4
}

describe('tools/list context budget', () => {
  it(`costs under ${BUDGET_TOKENS.toLocaleString('en')} tokens as ora counts them`, () => {
    const tokens = oraTokens(allToolDescriptors() as unknown as Record<string, unknown>[])
    expect(tokens, `tools/list costs ${Math.round(tokens)} ora tokens (budget ${BUDGET_TOKENS})`).toBeLessThanOrEqual(BUDGET_TOKENS)
  })
  // Runs under the test env's edition (SITE_NAME "eno.forum"); eno.vn's text is a few characters SHORTER per mention, and
  // both editions serve the same 28 tools.

  it('says each title once: no tool repeats it in annotations', () => {
    for (const t of allToolDescriptors() as unknown as { name: string; title?: string; annotations?: Record<string, unknown> }[]) {
      expect(t.title, t.name).toBeTruthy()
      expect(t.annotations?.title, t.name).toBeUndefined()
    }
  })

  it('create_listing points at list_categories for its slugs: both are served together, and list_categories names exactly the postable set', async () => {
    const names = (allToolDescriptors() as unknown as { name: string }[]).map((t) => t.name)
    expect(names).toContain('list_categories')
    expect(names).toContain('create_listing')
    const out = await SEARCH_TOOLS_BY_NAME.get('list_categories')!.handler({}) as { categories: { slug: string }[] }
    expect(out.categories.map((c) => c.slug).sort()).toEqual(TAXONOMY.filter((c) => isPostableCategory(c.slug)).map((c) => c.slug).sort())
  })
})
