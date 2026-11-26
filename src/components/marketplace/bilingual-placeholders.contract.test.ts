import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ A <Bilingual> PAIR'S TWO TEMPLATES CARRY THE SAME PLACEHOLDERS. One whose sets differ falls back to the English
 * (placeholders.ts safeTemplate), so the Vietnamese page prints the English line — with no error anywhere. It shipped twice on
 * 2026-11-25: the shop intro (`{n}` / `{nVi}`) and the help centre's H1 (`{site}` in English only), both read English on every
 * Vietnamese page for a day. A value that differs per language goes in `valuesVi` under the same name (bilingual.tsx).
 * Literal pairs only (`en="…" vi="…"`), as the string harvest reads them (gen-ui-strings.mjs).
 */
const SRC = join(process.cwd(), 'src')
const PAIR = /<Bilingual\b[^<>]*?\sen="((?:[^"\\]|\\.)*)"[^<>]*?\svi="((?:[^"\\]|\\.)*)"/g
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('<Bilingual> literal pairs', () => {
  it('every en/vi pair names the same placeholders', () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx') && !f.includes('generated'))
    const bad: string[] = []
    let pairs = 0
    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8')
      for (const m of src.matchAll(PAIR)) {
        pairs++
        const [en, vi] = [placeholders(m[1]), placeholders(m[2])]
        if (en.join() !== vi.join()) bad.push(`${f}: "${m[1].slice(0, 60)}" {${en}} vs {${vi}}`)
      }
    }
    expect(pairs).toBeGreaterThan(200) // the scan reads the tree, not nothing (278 pairs on 2026-11-26)
    expect(bad).toEqual([])
  })
})
