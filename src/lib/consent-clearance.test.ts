// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { clearanceStyle, consentClearance, setConsentClearance, useConsentClearance } from './consent-clearance'

afterEach(() => setConsentClearance(0))

describe('the consent bar\'s clearance (home speed, 2026-11-19)', () => {
  it('holds the bar\'s reach; 0 or less is no bar', () => {
    setConsentClearance(188)
    expect(consentClearance()).toBe(188)
    setConsentClearance(-4)
    expect(consentClearance()).toBe(0)
  })

  it('is the reader\'s own style — the variable on its element, nothing when there is no bar', () => {
    expect(clearanceStyle(0)).toBeUndefined()
    expect(clearanceStyle(188)).toEqual({ '--consent-clearance': '188px' })
  })

  it('a reader re-renders when the reach changes, and not when the same value is written again', () => {
    let renders = 0
    const { result } = renderHook(() => { renders++; return useConsentClearance() })
    expect(result.current).toBe(0)
    const before = renders
    act(() => setConsentClearance(188))
    expect(result.current).toBe(188)
    expect(renders).toBe(before + 1)
    act(() => setConsentClearance(188))
    expect(renders).toBe(before + 1)
  })
})

/**
 * ⛔ THE CONTRACT THAT KEEPS THE 236 ms AWAY: every component that reads `var(--consent-clearance` sets the variable on that same
 * element (`clearanceStyle`), and nothing writes it on <html> — a custom property there restyles the whole page (3,584 elements
 * on the home page, measured 2026-11-19). A new reader that forgets the style would sit under the bar again.
 */
describe('who reads --consent-clearance', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
    }
  }
  walk(join(process.cwd(), 'src'))
  const src = (f: string) => readFileSync(f, 'utf8')

  it('every reader sets the variable on its own element', () => {
    const readers = files.filter((f) => src(f).includes('var(--consent-clearance'))
    expect(readers.map((f) => f.split('/src/')[1]).sort()).toEqual(['components/concierge/concierge-host.tsx', 'components/marketplace/lang-suggestion-banner.tsx'])
    for (const f of readers) expect(src(f), f).toMatch(/style=\{clearanceStyle\(/)
  })

  it('nothing writes it on <html> (or any element by hand)', () => {
    for (const f of files) {
      const s = src(f)
      expect(s, f).not.toMatch(/setProperty\(\s*(CONSENT_CLEARANCE_VAR|['"]--consent-clearance['"])/)
    }
  })
})
