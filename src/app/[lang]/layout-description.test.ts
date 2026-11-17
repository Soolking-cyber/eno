import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The site's default meta description (the homepage's and every page's that sets none): 50–160 characters (owner 2026-11-17). */
describe('the default meta description', () => {
  it('fits 50–160 characters on eno.vn, free or not', () => {
    const src = readFileSync(fileURLToPath(new URL('./layout.tsx', import.meta.url)), 'utf8')
    const m = /: `\$\{SITE_NAME\} is a \$\{POSTING_IS_FREE \? "free " : ""\}([^`]*)`/.exec(src)
    expect(m).not.toBeNull()
    for (const free of ['free ', '']) {
      const text = `eno.vn is a ${free}${m![1]}`
      expect(text.length).toBeGreaterThanOrEqual(50)
      expect(text.length).toBeLessThanOrEqual(160)
    }
  })
})
