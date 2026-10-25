import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THESE PAGES SERVE BOTH EDITIONS, so their copy names the edition (SITE_NAME), never a hard-coded "eno.vn"
 * (sweep decision, 2026-10-25): eno.forum's appeal, report and unsubscribe pages told forum users "The eno.vn team will
 * review your appeal", "Back to eno.vn", "the weekly eno.vn digest", and the dispute room "the eno.vn team decides".
 */
const PAGES = [
  'src/app/[lang]/appeal/[id]/page.tsx', 'src/app/[lang]/reports/[id]/page.tsx', 'src/app/[lang]/unsubscribe/page.tsx',
  'src/app/[lang]/disputes/[id]/page.tsx', 'src/components/marketplace/disputes-panel.tsx',
]
const COPY_CALL = /\b(?:tr|t)\((?:'[^'\n]*'|"[^"\n]*")\s*,\s*(?:'[^'\n]*'|"[^"\n]*")\)/g

describe('both-edition pages name their own site', () => {
  it.each(PAGES)('%s: no copy hard-codes "eno.vn"; every {site} is filled from SITE_NAME', (p) => {
    const src = readFileSync(p, 'utf8')
    const calls = [...src.matchAll(COPY_CALL)]
    expect(calls.length).toBeGreaterThan(0) // the scanner still sees this file's copy
    expect(calls.map((m) => m[0]).filter((c) => c.includes('eno.vn'))).toEqual([])
    const withSite = calls.filter((m) => m[0].includes('{site}'))
    expect(withSite.length).toBeGreaterThan(0)
    for (const m of withSite) expect(src.slice(m.index! + m[0].length).startsWith('.replace(/\\{site\\}/g, SITE_NAME)'), m[0].slice(0, 60)).toBe(true)
    expect(src).toContain("import { SITE_NAME } from '@/lib/edition'")
  })
})
