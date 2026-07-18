import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Characterization (audit Phase 0 / P2 #13): every issue code the visa validator can
// EMIT must be routable to a wizard step — an emitted code missing from STEP_ISSUES
// makes validateVisaStep silently pass an incomplete page (the applicant only learns
// at final submit). This was live: the validator emitted the singular
// `previous_visit_details_required` while STEP_ISSUES listed only the plural form.
//
// The test reads the SOURCE of both schema copies (root + forum — a designated
// sync-pair), extracts every emittable code, and asserts membership + cross-app
// equality. Static extraction keeps it self-maintaining: add a new issue code and
// forget the step map, and this fails.

const FILES = ['src/lib/visa/schema.ts', 'apps/forum/src/lib/visa/schema.ts']

// Codes that are deliberately NOT step-routed (final-submit-only checks).
const SUBMIT_ONLY = new Set<string>([])

function extract(source: string) {
  // 1. The `required` tuples: ['field', 'code']
  const required = [...source.matchAll(/\['[A-Za-z]+',\s*'([a-z0-9_]+_required)'\]/g)].map((m) => m[1])
  // 2. Conditional pushes: issues.push('code')
  const pushed = [...source.matchAll(/issues\.push\('([a-z0-9_]+)'\)/g)].map((m) => m[1])
  // 3. STEP_ISSUES sets: every quoted code inside the STEP_ISSUES block
  const stepBlock = source.slice(source.indexOf('const STEP_ISSUES'), source.indexOf('export function validateVisaStep'))
  const step = new Set([...stepBlock.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))
  return { emittable: new Set([...required, ...pushed]), step }
}

describe('visa STEP_ISSUES routing', () => {
  const parsed = FILES.map((f) => ({ file: f, ...extract(readFileSync(f, 'utf8')) }))

  for (const { file, emittable, step } of parsed) {
    it(`${file}: every emittable issue code is step-routed`, () => {
      const missing = [...emittable].filter((code) => !step.has(code) && !SUBMIT_ONLY.has(code))
      expect(missing, `codes emitted but missing from STEP_ISSUES in ${file}`).toEqual([])
    })
  }

  it('root and forum schema copies route the identical code set (sync-pair drift guard)', () => {
    expect([...parsed[0].step].sort()).toEqual([...parsed[1].step].sort())
    expect([...parsed[0].emittable].sort()).toEqual([...parsed[1].emittable].sort())
  })
})
