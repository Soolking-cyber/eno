import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⛔ A REDIRECT INSIDE A PHASE-1 `/vi` FAMILY KEEPS THE LANGUAGE (critic #5, 2026-11-19). `/vi/c/<cat>/<alias>` and the
 * Vietnamese render of plain `/c/<cat>/<alias>` are one ISR entry, so a target written as a plain path sends the
 * Vietnamese twin to the English URL. Every `redirect(` / `permanentRedirect(` in these route trees goes through
 * `localizedHref` (src/lib/lang-pinned.ts). Source-level, so a new redirect cannot skip it unnoticed.
 */
const DIRS = ['src/app/[lang]/c', 'src/app/[lang]/help', 'src/app/[lang]/schools']

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = join(dir, n)
    return statSync(f).isDirectory() ? files(f) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [f] : []
  })

describe('redirects inside the /vi families', () => {
  it('every redirect target is built with localizedHref', () => {
    const calls: string[] = []
    for (const f of DIRS.flatMap(files)) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\b(?:permanentRedirect|redirect)\(([^\n]*)/g)) {
        calls.push(`${f}: ${m[0]}`)
        expect(m[1].trimStart().startsWith('localizedHref('), `${f}: ${m[0]}`).toBe(true)
      }
    }
    // the two known today (district alias → canonical slug, awards → the open year); a third must be added here
    expect(calls.length, calls.join('\n')).toBe(2)
  })
})
