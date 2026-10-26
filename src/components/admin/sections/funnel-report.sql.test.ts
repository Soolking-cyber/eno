import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ⛔ node-postgres sends parameters untyped, so `date - $1` resolves as date − date (an integer) and `day >= integer`
// fails (42883) — the publish funnel was empty on every load until 2026-10-26. Reproduced on Postgres 14:
// `prepare a(unknown) as … where day >= current_date - $1` → "operator does not exist: date >= integer".
describe('publish funnel query', () => {
  const src = readFileSync(new URL('./funnel-report.tsx', import.meta.url), 'utf8')
  it('casts the window parameter, so the date arithmetic stays date − integer', () => {
    expect(src).toMatch(/::date - \$\{WINDOW_DAYS - 1\}::int\b/)
  })
  it('tells a failed read apart from an empty counter', () => {
    expect(src).not.toMatch(/\.catch\(\(\) => \[\]/)
    expect(src).toContain('Could not read the publish funnel')
  })
})
