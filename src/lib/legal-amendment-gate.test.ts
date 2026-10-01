import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LEGAL_AMENDMENT } from '@/lib/compliance/legal-amendment'

/**
 * infra/vn-node/legal-amendment-gate.sh — the deploy refuses to PUBLISH a legal amendment on any day but
 * the publication date its pages print (2026-10-01 review: a deploy on a later day prints a false date,
 * shortens the promised 5 days' notice, or — from the in-force date — skips the notice altogether).
 *
 * Each case runs the real script against a throwaway git repository whose "deployed commit" carries
 * whatever dates the case needs, with the clock replaced by ENO_GATE_TODAY.
 */
const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'infra/vn-node/legal-amendment-gate.sh')
const F = 'src/lib/compliance/legal-amendment.ts'
const SOURCE = readFileSync(join(ROOT, F), 'utf8')

/** The real module's source with its two dates replaced — the gate must parse the file as it is written. */
const withDates = (published: string, inForce: string) =>
  SOURCE.replace(/published: '\d{4}-\d{2}-\d{2}'/, `published: '${published}'`).replace(/inForce: '\d{4}-\d{2}-\d{2}'/, `inForce: '${inForce}'`)

/**
 * ⛔ THE ENVIRONMENT MINUS EVERY GIT_* VARIABLE. Run from inside a git hook (or any process that exported
 * GIT_DIR / GIT_INDEX_FILE), `git -C <tmp> add` would ignore -C's repository and stage the throwaway
 * legal-amendment.ts into the REAL repository's index — the private-index trap. The throwaway repo must
 * be the only repo these commands can see.
 */
// Typed as ProcessEnv: Next's global types make NODE_ENV a required key, which fromEntries cannot know.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))) as NodeJS.ProcessEnv

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    env: { ...ENV, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
  }).trim()

/**
 * A repository whose DEPLOYED commit carries `deployed` dates (or no legal-amendment.ts at all), and whose
 * working tree — what this deploy builds — carries `building`. Plumbing only: no hooks, no branch moves.
 */
function box(building: [string, string], deployed: [string, string] | null): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
  git(dir, 'init', '-q')
  mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
  const file = join(dir, F)
  writeFileSync(file, deployed ? withDates(...deployed) : '// before the amendment existed\n')
  git(dir, 'add', F)
  const sha = git(dir, 'commit-tree', git(dir, 'write-tree'), '-m', 'deployed')
  writeFileSync(file, withDates(...building))
  return { dir, sha }
}

function gate(at: { dir: string; sha: string }, today: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [GATE, at.dir, at.sha], { encoding: 'utf8', env: { ...ENV, LEGAL_AMENDMENT_ACK: '', ...env, ENO_GATE_TODAY: today } })
  return { status: r.status, out: r.stdout + r.stderr }
}

const OCT: [string, string] = ['2026-10-01', '2026-10-07']

describe('legal-amendment-gate.sh', () => {
  it('reads the same two dates the TypeScript module exports', () => {
    const r = gate({ dir: ROOT, sha: '' }, LEGAL_AMENDMENT.published)
    expect(r.status).toBe(0)
    expect(r.out).toContain(`publishes the legal amendment today (${LEGAL_AMENDMENT.published}); in force ${LEGAL_AMENDMENT.inForce}`)
  })

  it('publishes only on the publication date', () => {
    const first = box(OCT, null)
    expect(gate(first, '2026-10-01').status).toBe(0)

    const late = gate(first, '2026-10-02')
    expect(late.status).toBe(1)
    expect(late.out).toContain('false publication date')
    expect(late.out).toContain('only 4 clear day(s) of notice')

    const inForce = gate(first, '2026-10-07')
    expect(inForce.status).toBe(1)
    expect(inForce.out).toContain('NO notice would ever show')

    const early = gate(first, '2026-09-30')
    expect(early.status).toBe(1)
    expect(early.out).toContain('has not happened yet')
  })

  it('passes every later deploy once the deployed commit carries the same dates', () => {
    const live = box(OCT, OCT)
    for (const day of ['2026-10-03', '2026-10-07', '2027-03-01']) expect(gate(live, day).status).toBe(0)
  })

  it('treats changed dates as a new publication, re-dated or not', () => {
    // The next amendment re-uses LEGAL_AMENDMENT: dates that differ from the deployed commit's publish anew.
    const next = box(['2026-11-02', '2026-11-09'], OCT)
    expect(gate(next, '2026-11-02').status).toBe(0)
    expect(gate(next, '2026-11-05').status).toBe(1)
    // Moving only the in-force date of a live amendment is a change too, and needs a decision.
    expect(gate(box(['2026-10-01', '2026-10-09'], OCT), '2026-10-03').status).toBe(1)
  })

  it('takes an acknowledgement scoped to the publication date, never a bare flag', () => {
    const first = box(OCT, null)
    expect(gate(first, '2026-10-03', { LEGAL_AMENDMENT_ACK: '1' }).status).toBe(1)
    expect(gate(first, '2026-10-03', { LEGAL_AMENDMENT_ACK: '2026-10-02' }).status).toBe(1)
    const acked = gate(first, '2026-10-03', { LEGAL_AMENDMENT_ACK: '2026-10-01' })
    expect(acked.status).toBe(0)
    expect(acked.out).toContain('proceeding on LEGAL_AMENDMENT_ACK=2026-10-01')
  })

  it('refuses a gap shorter than the promised notice even on the day, and even acknowledged', () => {
    const short = box(['2026-10-01', '2026-10-06'], null)
    expect(gate(short, '2026-10-01').status).toBe(1)
    expect(gate(short, '2026-10-01', { LEGAL_AMENDMENT_ACK: '2026-10-01' }).status).toBe(1)
  })

  it('refuses when it cannot read the dates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
    expect(gate({ dir, sha: '' }, '2026-10-01').status).toBe(1)
  })

  it('runs in eno-deploy.sh after the schema gate and before anything is built, and stops the deploy', () => {
    const deploy = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
    const call = deploy.indexOf('bash "$APP/infra/vn-node/legal-amendment-gate.sh" "$APP" "$LAST" || exit 1')
    expect(call).toBeGreaterThan(deploy.indexOf('say "2. schema"'))
    expect(call).toBeLessThan(deploy.indexOf('say "3. pin the rollback"'))
  })
})
