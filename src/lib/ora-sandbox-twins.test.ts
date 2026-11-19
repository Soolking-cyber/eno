import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isReservedHandle } from './handle-format'
import { DOC_PATHS } from './api/discovery-links'

// The 2026-11-19 ora.ai gaps (owner pasted the scan): the sandbox page at the two addresses ora checks, and a .md twin for a
// model's price pages. Source checks on next.config.ts, like the other alias pins: its rewrites and twinRoots run at build.
const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')

describe('the sandbox page is reachable where agent checks look for it', () => {
  it('/sandbox and /docs/sandbox serve /developers/sandbox, the canonical', () => {
    expect(DOC_PATHS.sandbox).toBe('/developers/sandbox')
    expect(config).toContain('{ source: "/:lang(en|vi)/sandbox", destination: "/:lang/developers/sandbox" }')
    expect(config).toContain('{ source: "/:lang(en|vi)/docs/sandbox", destination: "/:lang/developers/sandbox" }')
  })
  it('⛔ no shop can take the sandbox address (the rewrite outranks a storefront)', () => {
    expect(isReservedHandle('sandbox')).toBe(true)
  })
})

describe('a model price page has a .md twin', () => {
  it('price and gia are twin roots (they have no root page of their own, like sellers and listings)', () => {
    expect(config).toMatch(/\[\.\.\.roots, "sellers", "listings", "price", "gia"\]/)
  })
})
