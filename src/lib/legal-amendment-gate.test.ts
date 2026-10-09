import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LEGAL_AMENDMENT, REGULATIONS_AMENDMENT } from '@/lib/compliance/legal-amendment'
import { PRIVACY_TEXT_PUBLISHED } from '@/lib/compliance/privacy-updated'

/**
 * infra/vn-node/legal-amendment-gate.sh — the deploy refuses to PUBLISH a legal amendment on any day but
 * the publication date its pages print (2026-10-01 review: a deploy on a later day prints a false date,
 * shortens the promised 5 days' notice, or — from the in-force date — skips the notice altogether).
 *
 * Each case runs the real script against a throwaway git repository whose "deployed commit" carries
 * whatever dates the case needs, with the clock replaced by ENO_GATE_TODAY.
 *
 * ⚠️ TWO RECORDS SINCE 2026-10-05 (legal-amendment.ts): LEGAL_AMENDMENT and REGULATIONS_AMENDMENT, each held
 * to the same rules. The cases written for one amendment set BOTH records to the same dates (withDates'
 * default), so each of them proves the rule for both records at once; the REGULATIONS_AMENDMENT block
 * further down moves the Quy chế's record on its own.
 */
const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'infra/vn-node/legal-amendment-gate.sh')
const F = 'src/lib/compliance/legal-amendment.ts'
const SOURCE = readFileSync(join(ROOT, F), 'utf8')

type Dates = [published: string, inForce: string, immediate?: boolean]
const RECORDS = ['LEGAL_AMENDMENT', 'REGULATIONS_AMENDMENT'] as const
type Rec = (typeof RECORDS)[number]

/** The `immediate: true` field line — the only form the gate reads as the flag. */
const IMMEDIATE_LINE = /^[ \t]*immediate: true,?[ \t]*$/m

/** [start, end) of `export const <name>` through its closing `}` line — exactly the lines the gate's obj() reads. */
function span(src: string, name: string): [number, number] {
  const start = src.search(new RegExp(`^export const ${name}[ :=]`, 'm'))
  if (start < 0) throw new Error(`${name} is not in the source`)
  const close = /^}.*$/m.exec(src.slice(start))
  if (!close) throw new Error(`${name} has no closing brace`)
  return [start, start + close.index + close[0].length]
}

/** The source with one record's two dates replaced and its flag kept or removed — inside its own object only. */
function setRecord(src: string, name: Rec, [published, inForce, immediate = false]: Dates): string {
  const [a, b] = span(src, name)
  let o = src.slice(a, b)
    .replace(/published: '\d{4}-\d{2}-\d{2}'/, `published: '${published}'`)
    .replace(/inForce: '\d{4}-\d{2}-\d{2}'/, `inForce: '${inForce}'`)
    .replace(IMMEDIATE_LINE, '')
  if (immediate) o = o.replace(/^([ \t]*)(inForce: '[^']+',)$/m, '$1$2\n$1immediate: true,')
  return src.slice(0, a) + o + src.slice(b)
}

/**
 * The real module's source with LEGAL_AMENDMENT set to `legal` and REGULATIONS_AMENDMENT to `regs` — by
 * default THE SAME, so the two records move together and a case reads as one amendment. It edits the real
 * text in place: the gate must parse the file as it is written.
 */
const withDates = (legal: Dates, regs: Dates = legal) => setRecord(setRecord(SOURCE, 'LEGAL_AMENDMENT', legal), 'REGULATIONS_AMENDMENT', regs)

/** The source without one record's object — a deployed commit from before that record existed. */
function without(src: string, name: Rec): string {
  const [a, b] = span(src, name)
  return src.slice(0, a) + src.slice(b)
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
 * A repository whose DEPLOYED commit holds `deployed` (or no legal-amendment.ts at all), and whose
 * working tree — what this deploy builds — holds `building`. Plumbing only: no hooks, no branch moves.
 */
function boxSrc(building: string, deployed: string | null): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
  git(dir, 'init', '-q')
  mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
  const file = join(dir, F)
  writeFileSync(file, deployed ?? '// before the amendment existed\n')
  git(dir, 'add', F)
  const sha = git(dir, 'commit-tree', git(dir, 'write-tree'), '-m', 'deployed')
  writeFileSync(file, building)
  return { dir, sha }
}

/** The same from dates, both records carrying them (withDates' default). */
const box = (building: Dates, deployed: Dates | null) => boxSrc(withDates(building), deployed ? withDates(deployed) : null)

function gate(at: { dir: string; sha: string }, today: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [GATE, at.dir, at.sha], {
    encoding: 'utf8',
    env: { ...ENV, LEGAL_AMENDMENT_ACK: '', LEGAL_AMENDMENT_IMMEDIATE: '', PRIVACY_TEXT_ACK: '', ...env, ENO_GATE_TODAY: today },
  })
  return { status: r.status, out: r.stdout + r.stderr }
}

/** The window 110295be shipped (prod 1cf99b2), and the immediate amendment that replaces it. */
const OCT: Dates = ['2026-10-01', '2026-10-07']
const NOW: Dates = ['2026-10-01', '2026-10-01', true]

describe('legal-amendment-gate.sh', () => {
  // ⛔ THE STATE THE NEXT DEPLOY MEETS (2026-10-07): the box's deployed commit carries October's LEGAL_AMENDMENT
  // (immediate, 01/10 — prod since 86f531e1) and the Quy chế's version 3 (immediate, 05/10 — prod since its
  // deploy); the working tree is the real module, verbatim — the Terms' version 3, IMMEDIATE (owner, 2026-10-07:
  // "Immediately (Recommended)"). So the Quy chế's record is routine and the Terms' version 3 publishes on its
  // own day ONLY with the owner's waiver acked: LEGAL_AMENDMENT_IMMEDIATE=2026-10-07.
  it('reads the dates and the flags the module exports, in the state the next deploy meets', () => {
    expect(LEGAL_AMENDMENT.immediate).toBe(true)
    expect(REGULATIONS_AMENDMENT.immediate).toBe(true)
    const prod = setRecord(SOURCE, 'LEGAL_AMENDMENT', ['2026-10-01', '2026-10-01', true])
    const at = boxSrc(SOURCE, prod)
    const day = LEGAL_AMENDMENT.published
    expect(day).toBe('2026-10-07')
    expect(LEGAL_AMENDMENT.inForce).toBe(day)
    // Without the ack it refuses: no notice window is the owner's waiver, acknowledged for its day.
    const bare = gate(at, day)
    expect(bare.status).toBe(1)
    expect(bare.out).toContain(`published AND in force ${day}, with NO notice window`)
    expect(bare.out).toContain(`LEGAL_AMENDMENT_IMMEDIATE=${day} bash eno-deploy.sh`)
    const r = gate(at, day, { LEGAL_AMENDMENT_IMMEDIATE: day })
    expect(r.status).toBe(0)
    expect(r.out).toContain(`proceeding on LEGAL_AMENDMENT_IMMEDIATE=${day}`)
    expect(r.out).toContain(`Quy chế amendment (REGULATIONS_AMENDMENT) published ${REGULATIONS_AMENDMENT.published} (in force ${REGULATIONS_AMENDMENT.inForce}, immediate) is already live`)
    // Neither October's date nor the late-publication ack unlocks it.
    expect(gate(at, day, { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' }).status).toBe(1)
    expect(gate(at, day, { LEGAL_AMENDMENT_ACK: day }).status).toBe(1)
    // Any other day refuses, acked or not, and says to re-date both — the day after (a false date on /terms and
    // /privacy) and the day before (a date that has not happened).
    const dayAfter = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const dayBefore = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    for (const other of [dayBefore, dayAfter]) {
      const off = gate(at, other, { LEGAL_AMENDMENT_IMMEDIATE: day })
      expect(off.status, other).toBe(1)
      expect(off.out, other).toContain(`set published: '${other}' and inForce: '${other}'`)
    }
    // …and once it is deployed, every later deploy is routine, with no ack.
    const live = boxSrc(SOURCE, SOURCE)
    for (const d of [day, dayAfter, '2026-10-13', '2027-03-01']) {
      const routine = gate(live, d)
      expect(routine.status, d).toBe(0)
      expect(routine.out, d).toContain(`legal amendment published ${day} (in force ${day}, immediate) is already live`)
    }
  })

  // The Terms' version 3 AS IT WAS WRITTEN — the default window, published 07/10, in force 13/10/2026 — before
  // the owner made it immediate, on a fixture of the real module: it would publish on its own day with no ack (a
  // windowed amendment waives nothing), on no other day, and an immediate ack would not unlock it.
  it('publishes the Terms’ version 3 as written — with its window — on its own day, with no ack', () => {
    const day = '2026-10-07'
    const prod = setRecord(SOURCE, 'LEGAL_AMENDMENT', ['2026-10-01', '2026-10-01', true])
    const asWritten = setRecord(SOURCE, 'LEGAL_AMENDMENT', [day, '2026-10-13'])
    const at = boxSrc(asWritten, prod)
    const r = gate(at, day)
    expect(r.status).toBe(0)
    expect(r.out).toContain(`publishes the legal amendment today (${day}); in force 2026-10-13, 6 days later`)
    expect(r.out).toContain(`Quy chế amendment (REGULATIONS_AMENDMENT) published ${REGULATIONS_AMENDMENT.published} (in force ${REGULATIONS_AMENDMENT.inForce}, immediate) is already live`)
    const late = gate(at, '2026-10-08', { LEGAL_AMENDMENT_IMMEDIATE: day })
    expect(late.status).toBe(1)
    expect(late.out).toContain('/terms and /privacy would print a false publication date')
    expect(late.out).toContain('only 4 clear day(s) of notice would remain of the 5 promised')
    expect(gate(at, '2026-10-06').out).toContain('has not happened yet')
    // …and once deployed, every later deploy is routine.
    const live = boxSrc(asWritten, asWritten)
    for (const d of [day, '2026-10-08', '2026-10-13', '2027-03-01']) {
      const routine = gate(live, d)
      expect(routine.status, d).toBe(0)
      expect(routine.out, d).toContain(`legal amendment published ${day} (in force 2026-10-13) is already live`)
    }
  })

  it('withDates sets each record inside its own object — dates and flag', () => {
    const windowed = withDates(OCT)
    const both = withDates(NOW)
    const apart = withDates(OCT, ['2026-11-02', '2026-11-02', true])
    for (const name of RECORDS) {
      expect(IMMEDIATE_LINE.test(windowed.slice(...span(windowed, name))), name).toBe(false)
      expect(IMMEDIATE_LINE.test(both.slice(...span(both, name))), name).toBe(true)
    }
    expect(apart.slice(...span(apart, 'LEGAL_AMENDMENT'))).toContain("inForce: '2026-10-07'")
    expect(IMMEDIATE_LINE.test(apart.slice(...span(apart, 'LEGAL_AMENDMENT')))).toBe(false)
    expect(apart.slice(...span(apart, 'REGULATIONS_AMENDMENT'))).toContain("published: '2026-11-02'")
    expect(IMMEDIATE_LINE.test(apart.slice(...span(apart, 'REGULATIONS_AMENDMENT')))).toBe(true)
    expect(() => span(without(SOURCE, 'REGULATIONS_AMENDMENT'), 'REGULATIONS_AMENDMENT')).toThrow()
  })

  // ⛔ A RECORD THE GATE DOES NOT KNOW SHIPS UNGATED. Every exported object carrying amendment dates is one
  // `check` line in the script — the annotated LegalAmendment consts and any unannotated look-alike.
  it('checks exactly the records the module exports, each an object literal of its own', () => {
    const dated = [...SOURCE.matchAll(/^export const (\w+)[ :=]/gm)]
      .map((m) => m[1])
      .filter((name) => {
        // A const with no object after it (a number, a call) spans to the next closing brace or the end.
        let body: string
        try { body = SOURCE.slice(...span(SOURCE, name)) } catch { body = SOURCE.slice(SOURCE.search(new RegExp(`^export const ${name}[ :=]`, 'm'))) }
        return /published: '\d{4}-\d{2}-\d{2}'/.test(body)
      })
      .sort()
    expect(dated).toEqual([...RECORDS].sort())
    const annotated = [...SOURCE.matchAll(/^export const (\w+): LegalAmendment\b/gm)].map((m) => m[1]).sort()
    expect(annotated).toEqual(dated)
    const gated = [...readFileSync(GATE, 'utf8').matchAll(/^check (\w+) /gm)].map((m) => m[1]).sort()
    expect(gated).toEqual(dated)
    for (const name of RECORDS) expect(SOURCE.slice(...span(SOURCE, name)), name).toMatch(/inForce: '\d{4}-\d{2}-\d{2}'/)
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
    // The next amendment re-uses a record: dates that differ from the deployed commit's publish anew.
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
    const src = withDates(OCT).replace(/^export const LEGAL_AMENDMENT\b/m, `${other('EXAMPLE_BEFORE')}\n$&`) + `\n${other('EXAMPLE_AFTER')}`
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
    // The shape prod carries: `export const LEGAL_AMENDMENT = {` … `} as const`, then other objects — and no
    // Quy chế record, which this deploy then publishes (on its own day, here 2026-10-05, windowed).
    const deployed = "export const LEGAL_AMENDMENT = {\n  published: '2026-10-01',\n  inForce: '2026-10-07',\n} as const\n\nexport const X = {\n  immediate: true,\n}\n"
    const r = gate(boxSrc(withDates(OCT, ['2026-10-05', '2026-10-11']), deployed), '2026-10-05')
    expect(r.status).toBe(0)
    expect(r.out).toContain('legal amendment published 2026-10-01 (in force 2026-10-07) is already live')
    expect(r.out).toContain('publishes the Quy chế amendment (REGULATIONS_AMENDMENT) today (2026-10-05)')
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
      writeFileSync(join(dir, F), withDates(['2026-10-01', '2026-10-01']).replace(/^(\s*)(inForce: '[^']+',)$/m, '$1$2\n$1// immediate: true,'))
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

  // ⛔ THE QUY CHẾ'S OWN RECORD (2026-10-05). Version 3 amended the Quy chế alone (owner: "apply best
  // recommended" — immediate, the 2026-10-01 precedent), so REGULATIONS_AMENDMENT moves while LEGAL_AMENDMENT
  // stays as prod has it. The same rules, on its own dates — and nothing about it may lean on the other record.
  describe('the Quy chế record (REGULATIONS_AMENDMENT), moved on its own', () => {
    const V3: Dates = ['2026-10-06', '2026-10-06', true]
    // Prod: October's amendment live, no Quy chế record yet.
    const PROD = without(withDates(NOW), 'REGULATIONS_AMENDMENT')

    it('publishes on its day with LEGAL_AMENDMENT_IMMEDIATE=<its date>, October staying routine', () => {
      const at = boxSrc(withDates(NOW, V3), PROD)
      const bare = gate(at, '2026-10-06')
      expect(bare.status).toBe(1)
      expect(bare.out).toContain('legal amendment published 2026-10-01 (in force 2026-10-01, immediate) is already live')
      expect(bare.out).toContain('IMMEDIATE Quy chế amendment (REGULATIONS_AMENDMENT): published AND in force 2026-10-06, with NO notice window')
      expect(bare.out).toContain('LEGAL_AMENDMENT_IMMEDIATE=2026-10-06 bash eno-deploy.sh')
      const acked = gate(at, '2026-10-06', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-06' })
      expect(acked.status).toBe(0)
      expect(acked.out).toContain('proceeding on LEGAL_AMENDMENT_IMMEDIATE=2026-10-06')
      // October's date does not unlock it, and neither does the late-publication ack.
      expect(gate(at, '2026-10-06', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' }).status).toBe(1)
      expect(gate(at, '2026-10-06', { LEGAL_AMENDMENT_ACK: '2026-10-06' }).status).toBe(1)
    })

    it('refuses any other day, and says to re-date the Quy chế record — with no bell-notice hint', () => {
      const at = boxSrc(withDates(NOW, V3), PROD)
      for (const day of ['2026-10-05', '2026-10-07']) {
        const r = gate(at, day, { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-06', LEGAL_AMENDMENT_ACK: '2026-10-06' })
        expect(r.status, day).toBe(1)
        expect(r.out, day).toContain(`set published: '${day}' and inForce: '${day}' in ${F} (REGULATIONS_AMENDMENT)`)
        // The Quy chế record never sent a bell notice (notify-legal-amendment.ts reads LEGAL_AMENDMENT only).
        expect(r.out, day).not.toContain('--retract')
      }
    })

    it('passes every later deploy once version 3 is deployed, with no ack', () => {
      const live = boxSrc(withDates(NOW, V3), withDates(NOW, V3))
      for (const day of ['2026-10-06', '2026-10-07', '2027-03-01']) {
        const r = gate(live, day)
        expect(r.status, day).toBe(0)
        expect(r.out, day).toContain('Quy chế amendment (REGULATIONS_AMENDMENT) published 2026-10-06 (in force 2026-10-06, immediate) is already live')
      }
    })

    it('treats a re-dated Quy chế record as a new publication', () => {
      const at = boxSrc(withDates(NOW, ['2026-10-08', '2026-10-08', true]), withDates(NOW, V3))
      expect(gate(at, '2026-10-08').status).toBe(1)
      expect(gate(at, '2026-10-08', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-08' }).status).toBe(0)
    })

    it('holds a windowed Quy chế-only amendment to the default 6 days', () => {
      const next = boxSrc(withDates(NOW, ['2026-11-02', '2026-11-08']), withDates(NOW, V3))
      const onDay = gate(next, '2026-11-02')
      expect(onDay.status).toBe(0)
      expect(onDay.out).toContain('publishes the Quy chế amendment (REGULATIONS_AMENDMENT) today (2026-11-02); in force 2026-11-08, 6 days later')
      const late = gate(next, '2026-11-03')
      expect(late.status).toBe(1)
      expect(late.out).toContain('/regulations and /legal/ranking would print a false publication date')
      expect(late.out).toContain('only 4 clear day(s) of notice')
      const short = gate(boxSrc(withDates(NOW, ['2026-11-02', '2026-11-05']), withDates(NOW, V3)), '2026-11-02')
      expect(short.status).toBe(1)
      expect(short.out).toContain(`${F} (REGULATIONS_AMENDMENT): in force 2026-11-05 is only 3 day(s) after publication 2026-11-02`)
    })

    it('refuses a working tree whose Quy chế record cannot be read', () => {
      const r = gate(boxSrc(PROD, PROD), '2026-10-06', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-06' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('legal amendment published 2026-10-01 (in force 2026-10-01, immediate) is already live')
      expect(r.out).toContain('cannot read REGULATIONS_AMENDMENT.published')
    })

    it('reads each record’s dates and flag from its own object, never the other’s', () => {
      // October immediate + a windowed Quy chế record on the same day: the window is the Quy chế's own.
      const a = gate(boxSrc(withDates(NOW, OCT), null), '2026-10-01', { LEGAL_AMENDMENT_IMMEDIATE: '2026-10-01' })
      expect(a.status).toBe(0)
      expect(a.out).toContain('publishes the Quy chế amendment (REGULATIONS_AMENDMENT) today (2026-10-01); in force 2026-10-07, 6 days later')
      // …and the reverse: an immediate Quy chế record still wants its ack beside a windowed October.
      const b = gate(boxSrc(withDates(OCT, NOW), null), '2026-10-01')
      expect(b.status).toBe(1)
      expect(b.out).toContain('publishes the legal amendment today (2026-10-01); in force 2026-10-07, 6 days later')
      expect(b.out).toContain('IMMEDIATE Quy chế amendment (REGULATIONS_AMENDMENT): published AND in force 2026-10-01')
    })
  })

  // ⛔ /privacy's OWN DATE (D12, 2026-10-08): src/lib/compliance/privacy-updated.ts's PRIVACY_TEXT_PUBLISHED dates a
  // /privacy change made outside an amendment — the Sign in with Apple rows and the teacher paragraph — and was a
  // PLANNED day with nothing holding it. The same rule as an amendment's `published`, without a notice window. Here
  // the amendments are the real module, already deployed, so only the privacy date moves.
  describe("/privacy's own date (PRIVACY_TEXT_PUBLISHED)", () => {
    const PF = 'src/lib/compliance/privacy-updated.ts'
    const PRIVACY = readFileSync(join(ROOT, PF), 'utf8')
    const DECL = /^(export const PRIVACY_TEXT_PUBLISHED: string = ')\d{4}-\d{2}-\d{2}(')$/m
    const dated = (day: string) => PRIVACY.replace(DECL, `$1${day}$2`)
    /** The deployed commit holds `deployed` (null: no privacy-updated.ts yet), the working tree `building` (null: none). */
    function privacyBox(building: string | null, deployed: string | null): { dir: string; sha: string } {
      const dir = mkdtempSync(join(tmpdir(), 'eno-gate-'))
      git(dir, 'init', '-q')
      mkdirSync(join(dir, 'src/lib/compliance'), { recursive: true })
      writeFileSync(join(dir, F), SOURCE)
      git(dir, 'add', F)
      if (deployed !== null) {
        writeFileSync(join(dir, PF), deployed)
        git(dir, 'add', PF)
      }
      const sha = git(dir, 'commit-tree', git(dir, 'write-tree'), '-m', 'deployed')
      if (building === null) rmSync(join(dir, PF), { force: true })
      else writeFileSync(join(dir, PF), building)
      return { dir, sha }
    }

    it('reads the real module, in the shape the gate parses, and publishes it on its own day', () => {
      expect(PRIVACY).toMatch(DECL)
      expect(dated(PRIVACY_TEXT_PUBLISHED)).toBe(PRIVACY)
      const r = gate(privacyBox(PRIVACY, null), PRIVACY_TEXT_PUBLISHED)
      expect(r.status, r.out).toBe(0)
      expect(r.out).toContain(`publishes /privacy's own text dated today (${PRIVACY_TEXT_PUBLISHED})`)
    })

    it('refuses any other day — a false date after it, a date that has not happened before it', () => {
      const at = privacyBox(dated('2026-10-09'), null)
      const late = gate(at, '2026-10-10')
      expect(late.status).toBe(1)
      expect(late.out).toContain('/privacy would print a false "Last updated" date')
      expect(late.out).toContain(`set PRIVACY_TEXT_PUBLISHED = '2026-10-10' in ${PF}`)
      const early = gate(at, '2026-10-08')
      expect(early.status).toBe(1)
      expect(early.out).toContain('an update date that has not happened yet')
    })

    it('passes every later deploy once the deployed commit carries the same date', () => {
      const live = privacyBox(dated('2026-10-09'), dated('2026-10-09'))
      for (const day of ['2026-10-09', '2026-10-10', '2027-03-01']) {
        const r = gate(live, day)
        expect(r.status, day).toBe(0)
        expect(r.out, day).toContain("/privacy's own text dated 2026-10-09 is already live")
      }
    })

    it('treats a re-dated text as a new publication', () => {
      const next = privacyBox(dated('2026-11-02'), dated('2026-10-09'))
      expect(gate(next, '2026-11-02').status).toBe(0)
      expect(gate(next, '2026-11-03').status).toBe(1)
    })

    it('takes an acknowledgement scoped to the date, never a bare flag — and never the amendment acks', () => {
      const at = privacyBox(dated('2026-10-09'), null)
      for (const ack of ['1', 'true', '2026-10-10', '']) expect(gate(at, '2026-10-10', { PRIVACY_TEXT_ACK: ack }).status, ack).toBe(1)
      expect(gate(at, '2026-10-10', { LEGAL_AMENDMENT_ACK: '2026-10-09', LEGAL_AMENDMENT_IMMEDIATE: '2026-10-09' }).status).toBe(1)
      const acked = gate(at, '2026-10-10', { PRIVACY_TEXT_ACK: '2026-10-09' })
      expect(acked.status).toBe(0)
      expect(acked.out).toContain('proceeding on PRIVACY_TEXT_ACK=2026-10-09')
    })

    it('refuses a file whose date it cannot read; a commit without the file has nothing to hold', () => {
      const unreadable = gate(privacyBox(PRIVACY.replace(DECL, "export const PRIVACY_TEXT_PUBLISHED = new Date().toISOString().slice(0, 10)"), null), '2026-10-09')
      expect(unreadable.status).toBe(1)
      expect(unreadable.out).toContain('cannot read PRIVACY_TEXT_PUBLISHED')
      const none = gate(privacyBox(null, null), '2026-10-09')
      expect(none.status).toBe(0)
      expect(none.out).toContain('has no date of its own to hold')
    })
  })

  it('runs in eno-deploy.sh after the schema gate and before anything is built, and stops the deploy', () => {
    const deploy = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
    const call = deploy.indexOf('bash "$APP/infra/vn-node/legal-amendment-gate.sh" "$APP" "$LAST" || exit 1')
    expect(call).toBeGreaterThan(deploy.indexOf('say "2. schema"'))
    expect(call).toBeLessThan(deploy.indexOf('say "3. pin the rollback"'))
  })
})
