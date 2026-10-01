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

/**
 * The real module's source with its two dates replaced, and its `immediate: true` line kept or removed —
 * the gate must parse the file as it is written.
 */
const IMMEDIATE_LINE = /^[ \t]*immediate: true,?[ \t]*$/m
const withDates = (published: string, inForce: string, immediate = false) => {
  const dated = SOURCE.replace(/published: '\d{4}-\d{2}-\d{2}'/, `published: '${published}'`).replace(/inForce: '\d{4}-\d{2}-\d{2}'/, `inForce: '${inForce}'`)
  if (!immediate) return dated.replace(IMMEDIATE_LINE, '')
  return IMMEDIATE_LINE.test(dated) ? dated : dated.replace(/^([ \t]*)(inForce: '[^']+',)$/m, '$1$2\n$1immediate: true,')
}

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
type Dates = [published: string, inForce: string, immediate?: boolean]

function box(building: Dates, deployed: Dates | null): { dir: string; sha: string } {
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
  const r = spawnSync('bash', [GATE, at.dir, at.sha], {
    encoding: 'utf8',
    env: { ...ENV, LEGAL_AMENDMENT_ACK: '', LEGAL_AMENDMENT_IMMEDIATE: '', ...env, ENO_GATE_TODAY: today },
  })
  return { status: r.status, out: r.stdout + r.stderr }
}

/** The window 110295be shipped (prod 1cf99b2), and the immediate amendment that replaces it. */
const OCT: Dates = ['2026-10-01', '2026-10-07']
const NOW: Dates = ['2026-10-01', '2026-10-01', true]

describe('legal-amendment-gate.sh', () => {
  it('reads the dates and the immediate flag the TypeScript module exports', () => {
    expect(LEGAL_AMENDMENT.immediate).toBe(true)
    const day = LEGAL_AMENDMENT.published
    const unacked = gate({ dir: ROOT, sha: '' }, day)
    expect(unacked.status).toBe(1)
    expect(unacked.out).toContain(`LEGAL_AMENDMENT_IMMEDIATE=${day} bash eno-deploy.sh`)
    const r = gate({ dir: ROOT, sha: '' }, day, { LEGAL_AMENDMENT_IMMEDIATE: day })
    expect(r.status).toBe(0)
    expect(r.out).toContain(`IMMEDIATE legal amendment: published and in force ${LEGAL_AMENDMENT.inForce} (today)`)
  })

  it('withDates really writes and removes the flag the gate reads', () => {
    expect(IMMEDIATE_LINE.test(withDates(...OCT))).toBe(false)
    expect(IMMEDIATE_LINE.test(withDates(...NOW))).toBe(true)
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

  // ⛔ 2026-10-01 review: the dates and the flag are LEGAL_AMENDMENT's, not the first matching lines anywhere
  // in the file. Another amendment-shaped object — before it (for the dates) and after it (for the flag) —
  // must change nothing; unscoped, this windowed amendment would read as an immediate one dated 2026-01-01.
  it('reads the dates and the flag from LEGAL_AMENDMENT only, never from another object in the file', () => {
    const other = (name: string) => `export const ${name}: LegalAmendment = {\n  published: '2026-01-01',\n  inForce: '2026-01-01',\n  immediate: true,\n}\n`
    const src = withDates(...OCT).replace(/^export const LEGAL_AMENDMENT\b/m, `${other('EXAMPLE_BEFORE')}\n$&`) + `\n${other('EXAMPLE_AFTER')}`
    expect(src.match(/^[ \t]*immediate: true,$/gm)?.length).toBe(2)
    const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
    mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
    writeFileSync(join(dir, F), src)
    const r = gate({ dir, sha: '' }, '2026-10-01')
    expect(r.status).toBe(0)
    expect(r.out).toContain('publishes the legal amendment today (2026-10-01); in force 2026-10-07, 6 days later')
    // …and without LEGAL_AMENDMENT at all, nothing else stands in for it.
    writeFileSync(join(dir, F), other('NOT_THE_AMENDMENT'))
    const none = gate({ dir, sha: '' }, '2026-01-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-01-01' })
    expect(none.status).toBe(1)
    expect(none.out).toContain('cannot read LEGAL_AMENDMENT.published')
  })

  it('reads the deployed commit the same way — its `} as const` object (1cf99b2) included', () => {
    // The shape prod carries: `export const LEGAL_AMENDMENT = {` … `} as const`, then other objects.
    const deployed = "export const LEGAL_AMENDMENT = {\n  published: '2026-10-01',\n  inForce: '2026-10-07',\n} as const\n\nexport const X = {\n  immediate: true,\n}\n"
    const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
    git(dir, 'init', '-q')
    mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
    writeFileSync(join(dir, F), deployed)
    git(dir, 'add', F)
    const sha = git(dir, 'commit-tree', git(dir, 'write-tree'), '-m', 'deployed')
    writeFileSync(join(dir, F), withDates(...OCT))
    const r = gate({ dir, sha }, '2026-10-05')
    expect(r.status).toBe(0)
    expect(r.out).toContain('is already live')
  })

  // ⛔ Owner, 2026-10-01: "just change now we dont have users so its safe to implement just new terms no
  // need for announcement". An immediate amendment publishes on its day, with the owner's waiver acked.
  describe('an immediate amendment (in force the day it is published, no notice)', () => {
    it('publishes over the deployed window only on its day, and only with LEGAL_AMENDMENT_IMMEDIATE=<published>', () => {
      const over = box(NOW, OCT)
      const bare = gate(over, '2026-10-01')
      expect(bare.status).toBe(1)
      expect(bare.out).toContain('NO notice window')
      expect(bare.out).toContain('LEGAL_AMENDMENT_IMMEDIATE=2026-10-01 bash eno-deploy.sh')
      const acked = gate(over, '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' })
      expect(acked.status).toBe(0)
      expect(acked.out).toContain('proceeding on LEGAL_AMENDMENT_IMMEDIATE=2026-10-01')
      // The first publication of an immediate amendment follows the same rule.
      expect(gate(box(NOW, null), '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' }).status).toBe(0)
    })

    it('takes the ack scoped to the date — never a bare flag, and never the late-publication ack', () => {
      const over = box(NOW, OCT)
      for (const ack of ['1', 'true', '2026-10-02', '']) expect(gate(over, '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: ack }).status, ack).toBe(1)
      expect(gate(over, '2026-10-01', { LEGAL_AMENDMENT_ACK: '2026-10-01' }).status).toBe(1)
    })

    it('refuses any other day, acknowledged or not, and says to re-date both', () => {
      const over = box(NOW, OCT)
      for (const day of ['2026-09-30', '2026-10-02', '2026-10-07']) {
        const r = gate(over, day, { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01', LEGAL_AMENDMENT_ACK: '2026-10-01' })
        expect(r.status, day).toBe(1)
        expect(r.out, day).toContain(`set published: '${day}' and inForce: '${day}'`)
        expect(r.out, day).toContain('--retract --published=2026-10-01')
      }
    })

    it('must have inForce equal to published — immediate is never a shorter window', () => {
      const r = gate(box(['2026-10-01', '2026-10-07', true], OCT), '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' })
      expect(r.status).toBe(1)
      expect(r.out).toContain("set inForce: '2026-10-01'")
    })

    it('equal dates WITHOUT the flag are still a 0-day window, refused whatever is exported', () => {
      const r = gate(box(['2026-10-01', '2026-10-01'], OCT), '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01', LEGAL_AMENDMENT_ACK: '2026-10-01' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('only 0 day(s) after publication')
    })

    it('reads the flag only from the field, never from a comment that mentions it', () => {
      const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
      mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
      writeFileSync(join(dir, F), withDates('2026-10-01', '2026-10-01').replace(/^(\s*)(inForce: '[^']+',)$/m, '$1$2\n$1// immediate: true,'))
      const r = gate({ dir, sha: '' }, '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('only 0 day(s)')
    })

    it('passes every later deploy once the deployed commit carries it, with no ack', () => {
      const live = box(NOW, NOW)
      for (const day of ['2026-10-01', '2026-10-02', '2026-10-07', '2027-03-01']) {
        const r = gate(live, day)
        expect(r.status, day).toBe(0)
        expect(r.out, day).toContain('immediate) is already live')
      }
    })

    it('treats dropping or adding the flag on the same dates as a change, not a routine deploy', () => {
      // Deployed immediate, building the same dates without it: a 0-day window — refused before the routine check.
      expect(gate(box(['2026-10-01', '2026-10-01'], NOW), '2026-10-05').status).toBe(1)
    })
  })

  it('runs in eno-deploy.sh after the schema gate and before anything is built, and stops the deploy', () => {
    const deploy = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
    const call = deploy.indexOf('bash "$APP/infra/vn-node/legal-amendment-gate.sh" "$APP" "$LAST" || exit 1')
    expect(call).toBeGreaterThan(deploy.indexOf('say "2. schema"'))
    expect(call).toBeLessThan(deploy.indexOf('say "3. pin the rollback"'))
  })
})
