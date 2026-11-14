import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOT_GOODS_CATEGORIES, goodsScope, isGoodsCategory } from './goods-surface'

describe('goods surface (owner-approved 2026-11-14, cook r06 goods)', () => {
  it('every category that sells things is goods; the four with their own redesign are not', () => {
    for (const slug of ['electronics', 'fashion', 'vehicles', 'furniture-appliances', 'hobbies-sports', 'kids']) expect(isGoodsCategory(slug)).toBe(true)
    for (const slug of ['rentals', 'jobs', 'teachers', 'services']) expect(isGoodsCategory(slug)).toBe(false)
  })

  it('no category is not a goods category, and "all" is a scope, not a category', () => {
    expect(isGoodsCategory(undefined)).toBe(false)
    expect(isGoodsCategory(null)).toBe(false)
    expect(isGoodsCategory('')).toBe(false)
    expect(isGoodsCategory('all')).toBe(false)
  })

  it('a search over every category and a goods category take the goods look; rentals, jobs, teachers and services do not', () => {
    expect(goodsScope('all')).toBe(true)
    expect(goodsScope('electronics')).toBe(true)
    for (const slug of ['rentals', 'jobs', 'teachers', 'services']) expect(goodsScope(slug)).toBe(false)
  })

  it('imports nothing (a server layout and a Playwright spec read it before any data)', () => {
    const src = readFileSync(join(__dirname, 'goods-surface.ts'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/\brequire\(/)
  })

  it('lede-placement.ts reads the list from here, by a RELATIVE path (a Playwright spec resolves no alias), and nothing else', () => {
    const src = readFileSync(join(__dirname, '../app/[lang]/c/[category]/(index)/lede-placement.ts'), 'utf8')
    const imports = [...src.matchAll(/^\s*import\s.*from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['../../../../../lib/goods-surface'])
    expect(src).not.toMatch(/'electronics'|'fashion'/)
  })

  it('globals.css\'s cold goods-link rules leave out exactly the same four categories, every one of them', () => {
    const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
    // The sort pill's glyph, its "Sort" word and its shown label, and (build 8) the filled pills and their pressed state.
    const rules = [...css.matchAll(/html\[data-explorer-fold\]:not\(([^)]*)\) #explorer-toolbar /g)]
    expect(rules.length).toBeGreaterThanOrEqual(4)
    expect(css).toMatch(/html\[data-explorer-fold\]:not\([^)]*\) #explorer-toolbar :is\(\.sort-glyph-default, \.sort-word-default\)/)
    expect(css).toMatch(/html\[data-explorer-fold\]:not\([^)]*\) #explorer-toolbar \.pill-rest:not\(\[data-pressed\]\)/)
    for (const rule of rules) {
      const slugs = [...rule[1].matchAll(/\[data-explorer-cat="([^"]+)"\]/g)].map((m) => m[1])
      expect([...slugs].sort()).toEqual([...NOT_GOODS_CATEGORIES].sort())
    }
  })
})
