import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pdpTombstoneTags } from './job-listing'
import { EXPIRE_WITH_TOMBSTONES_SQL, expireStatementParams, parseExpireRentalsArgs } from './rental-expiry'

/**
 * scripts/expire-rentals.ts, its pure half (src/lib/rental-expiry.ts) — review of 2026-10-13: the sweep's argument
 * checks had no test, and its one write statement (the expiry and its ISR tombstones together) had only been run by
 * hand on a scratch Postgres. Here the rules are tested on their own, the script is spawned to show it refuses before
 * it needs a database, and the statement is EXECUTED in PGlite against fixture rows.
 */
const ok = (argv: string[]) => {
  const r = parseExpireRentalsArgs(argv)
  if (!r.ok) throw new Error(r.error)
  return r.args
}
const refused = (argv: string[]) => {
  const r = parseExpireRentalsArgs(argv)
  return r.ok ? null : r.error
}

describe('parseExpireRentalsArgs — the sweep\'s rules', () => {
  it('the job\'s own calls parse: a dry sweep, and the applied one with its journal and stamps', () => {
    expect(ok(['--sweep', '--stamps-dir', '/s'])).toMatchObject({ sweep: true, apply: false, stampsDir: '/s', expect: null })
    expect(ok(['--sweep', '--stamps-dir', '/s', '--journal-dir', '/j', '--apply'])).toMatchObject({ sweep: true, apply: true, journalDir: '/j', stampsDir: '/s' })
    expect(ok(['--sweep', '--allow-mass-expiry']).allowMass).toBe(true)
  })
  it('⛔ the job\'s real sweep line passes these rules: only --sweep, --stamps-dir and its journal/apply arguments, once each', () => {
    const sh = readFileSync('scripts/apartments-weekly.sh', 'utf8')
    expect(sh).toMatch(/npx tsx scripts\/expire-rentals\.ts --sweep --stamps-dir "\$STATE" \$\{JOURNAL\[@\]\+"\$\{JOURNAL\[@\]\}"\} \$APPLY; rc=\$\?/)
    expect(sh).toMatch(/JOURNAL=\(\); \[ -n "\$APPLY" \] && JOURNAL=\(--journal-dir "\$RUN\/journal"\)/)
    expect(ok(['--sweep', '--stamps-dir', '/state', '--journal-dir', '/run/journal', '--apply'])).toMatchObject({ sweep: true, apply: true })   // the --apply run
    expect(ok(['--sweep', '--stamps-dir', '/state'])).toMatchObject({ sweep: true, apply: false })                                        // the dry run
  })
  it('⛔ --sweep --apply without --journal-dir is refused — never a write with no journal', () => {
    expect(refused(['--sweep', '--apply'])).toBe('--apply needs --journal-dir <durable dir>')
    expect(refused(['--sweep', '--stamps-dir', '/s', '--apply'])).toBe('--apply needs --journal-dir <durable dir>')
    // the sweep needs no --expect; the one-off modes do
    expect(refused(['--places-older-than', '7', '--journal-dir', '/j', '--apply'])).toBe('--apply needs --journal-dir <durable dir> and --expect <count from the dry run>')
    expect(ok(['--places-older-than', '7', '--journal-dir', '/j', '--expect', '12', '--apply']).expect).toBe(12)
  })
  it('⛔ --stamps-dir and --allow-mass-expiry belong to --sweep', () => {
    for (const extra of [['--stamps-dir', '/s'], ['--allow-mass-expiry']]) {
      expect(refused(['--places-older-than', '7', ...extra]), extra[0]).toBe('--allow-mass-expiry and --stamps-dir belong to --sweep')
    }
    expect(refused(['--sweep', '--stamps-dir'])).toBe("--stamps-dir needs a value (the job's state dir)")
    expect(refused(['--sweep', '--stamps-dir', '--apply'])).toBe("--stamps-dir needs a value (the job's state dir)")
    expect(refused(['--sweep', '--stamps-dir', ''])).toBe("--stamps-dir needs a value (the job's state dir)")      // an empty one too
  })
  it('⛔ exactly one mode: --sweep with --places-older-than (or any other mode) is refused', () => {
    const one = 'pick exactly one of --sweep | --places-older-than N | --vehicle-ids <file> | --rollback <journal> | --tombstone <journal>'
    expect(refused(['--sweep', '--places-older-than', '7'])).toBe(one)
    expect(refused(['--sweep', '--rollback', 'j.json'])).toBe(one)
    expect(refused([])).toBe(one)
    expect(refused(['--places-older-than'])).toBe(one)                                    // a mode with no value is no mode
  })
  it('⛔ an option given twice is refused — only the first would count, the second silently ignored', () => {
    expect(refused(['--sweep', '--stamps-dir', '/a', '--stamps-dir', '/b'])).toBe('--stamps-dir is given twice — say it once')
    expect(refused(['--places-older-than', '7', '--places-older-than', '30'])).toBe('--places-older-than is given twice — say it once')
    expect(refused(['--sweep', '--apply', '--journal-dir', '/j', '--apply'])).toBe('--apply is given twice — say it once')
  })
  it('the one-off rules are unchanged: whole days ≥ 1, --expect-sha with --vehicle-ids --apply', () => {
    expect(refused(['--places-older-than', '0'])).toBe('--places-older-than needs a whole number of days ≥ 1')
    expect(refused(['--places-older-than', '1.5'])).toBe('--places-older-than needs a whole number of days ≥ 1')
    expect(refused(['--vehicle-ids', 'ids.txt', '--journal-dir', '/j', '--expect', '3', '--apply'])).toBe('--vehicle-ids --apply needs --expect-sha <sha256 printed by the dry run>')
    expect(ok(['--rollback', 'j.json', '--apply'])).toMatchObject({ rollback: 'j.json', apply: true })   // a rollback needs no journal dir
    expect(Number.isNaN(ok(['--places-older-than', '7', '--expect', 'abc']).expect)).toBe(true)        // and then never equals a count
  })
  it('⛔ an unknown argument is refused — a typo never silently changes what runs', () => {
    expect(refused(['--sweep', '--allow-mass-expire'])).toBe('unknown argument "--allow-mass-expire"')
    expect(refused(['--sweep', '--journal', '/j', '--apply'])).toBe('unknown argument "--journal"')
    expect(refused(['--sweep', 'apply'])).toBe('unknown argument "apply"')
  })
})

describe('scripts/expire-rentals.ts refuses on its arguments BEFORE it needs a database', () => {
  const run = (args: string[]) => spawnSync('npx', ['tsx', join(process.cwd(), 'scripts/expire-rentals.ts'), ...args], {
    // DOTENV_CONFIG_PATH names no file: should the script ever load dotenv, a checkout's .env (in ~/eno.vn, production) stays out
    encoding: 'utf8', env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, DOTENV_CONFIG_PATH: '/nonexistent-eno-dir/no.env' }, timeout: 60_000,
  })
  it('a refused argument exits 1 with the rule; good arguments reach the database check (none is configured here)', { timeout: 120_000 }, () => {
    const bad = run(['--sweep', '--apply'])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('--apply needs --journal-dir <durable dir>')
    const good = run(['--sweep', '--stamps-dir', '/nonexistent'])
    expect(good.status).toBe(1)
    expect(good.stderr).toContain('DIRECT_URL (or DATABASE_URL) is not set')
  })
})

type Pg = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

/**
 * ⛔ THE STATEMENT, EXECUTED. PGlite is Postgres compiled to WASM, in-process. The fixture tables carry the columns the
 * statement touches, as production has them: "Listing"(id, status, "updatedAt" timestamp(3)) and next_cache_tag (the
 * DDL of scripts/rate-limit-pg.mjs). A missing PGlite skips this block locally and FAILS it in CI.
 */
describe.skipIf(!pglite && !process.env.CI)(`EXPIRE_WITH_TOMBSTONES_SQL — run in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  const STAMP = '2026-10-14 06:30:00.123'
  beforeAll(async () => {
    if (!pglite) throw new Error('@electric-sql/pglite is not installed — this block must run in CI')
    pg = await pglite.PGlite.create()
    await pg.exec(`
      CREATE TABLE "Listing" (id text PRIMARY KEY, status text NOT NULL, "updatedAt" timestamp(3) NOT NULL);
      CREATE TABLE next_cache_tag (tag text PRIMARY KEY, stamp bigint NOT NULL, expires_at timestamptz NOT NULL);
    `)
  }, 120_000)   // PGlite's WASM start takes seconds, and minutes on a loaded machine (as price-stat.sql.test.ts allows)
  afterAll(async () => { await pg?.close() })

  /** The rows as the script reads them: status, and updatedAt as text. */
  const read = async (ids: string[]) => (await pg.query<{ id: string; status: string; updatedAt: string }>(
    `SELECT id, status, "updatedAt"::text AS "updatedAt" FROM "Listing" WHERE id = ANY($1::text[]) ORDER BY id`, [ids])).rows
  /** The tags, their stamp, and their expiry as epoch ms — read as a number, so no session time zone can shift it. */
  const tagsOf = async () => (await pg.query<{ tag: string; stamp: string; expires_ms: string }>('SELECT tag, stamp::text, (extract(epoch from expires_at) * 1000)::bigint::text AS expires_ms FROM next_cache_tag ORDER BY tag')).rows

  it('⛔ moves ONLY rows still exactly as read (status AND updatedAt), stamps them, and tombstones exactly those pages', async () => {
    await pg.exec(`
      INSERT INTO "Listing" VALUES
        ('cma', 'active', '2026-10-01 10:00:00.111'),
        ('cmb', 'active', '2026-10-01 10:00:00.222'),
        ('cmc', 'active', '2026-10-01 10:00:00.333');
    `)
    const journal = (await read(['cma', 'cmb', 'cmc'])).map((r) => ({ id: r.id, priorStatus: r.status, updatedAt: r.updatedAt }))
    // between the read and the write: a refresh re-dated cmb (updatedAt moved), a moderator hid cmc
    await pg.exec(`UPDATE "Listing" SET "updatedAt" = '2026-10-14 05:00:00.000' WHERE id = 'cmb'; UPDATE "Listing" SET status = 'hidden' WHERE id = 'cmc';`)
    const moved = (await pg.query<{ id: string }>(EXPIRE_WITH_TOMBSTONES_SQL, expireStatementParams(journal, 'expired', STAMP))).rows.map((r) => r.id)
    expect(moved).toEqual(['cma'])
    expect(await read(['cma', 'cmb', 'cmc'])).toEqual([
      { id: 'cma', status: 'expired', updatedAt: STAMP },                                      // the stamp --rollback matches on
      { id: 'cmb', status: 'active', updatedAt: '2026-10-14 05:00:00' },
      { id: 'cmc', status: 'hidden', updatedAt: '2026-10-01 10:00:00.333' },
    ])
    expect((await tagsOf()).map((t) => t.tag)).toEqual(pdpTombstoneTags('cma').sort())        // en + vi, nothing for cmb/cmc
  })

  it('a second run moves nothing and writes no tag (idempotent: the rows are no longer as read)', async () => {
    const journal = [{ id: 'cma', priorStatus: 'active', updatedAt: '2026-10-01 10:00:00.111' }]
    const before = await tagsOf()
    const moved = (await pg.query(EXPIRE_WITH_TOMBSTONES_SQL, expireStatementParams(journal, 'expired', STAMP))).rows
    expect(moved).toEqual([])
    expect(await tagsOf()).toEqual(before)
  })

  it('⛔ an existing tag keeps the GREATER stamp and expiry (a newer render is never undone); an older one is raised', async () => {
    const [newer, older] = pdpTombstoneTags('cmd')
    await pg.exec(`
      INSERT INTO "Listing" VALUES ('cmd', 'active', '2026-10-02 08:00:00.000');
      INSERT INTO next_cache_tag VALUES ('${newer}', 99999999999999, '2099-01-01 00:00:00+00'), ('${older}', 1, '2000-01-01 00:00:00+00');
    `)
    const journal = (await read(['cmd'])).map((r) => ({ id: r.id, priorStatus: r.status, updatedAt: r.updatedAt }))
    const startedMs = Date.now()
    expect((await pg.query(EXPIRE_WITH_TOMBSTONES_SQL, expireStatementParams(journal, 'expired', STAMP))).rows).toEqual([{ id: 'cmd' }])
    const t = new Map((await tagsOf()).map((x) => [x.tag, x]))
    expect(t.get(newer)).toMatchObject({ stamp: '99999999999999' })
    expect(Number(t.get(newer)!.expires_ms)).toBe(Date.parse('2099-01-01T00:00:00Z'))
    expect(Number(t.get(older)!.stamp)).toBeGreaterThanOrEqual(startedMs - 1000)              // raised to "now" (ms)
    expect(Number(t.get(older)!.expires_ms)).toBeGreaterThan(Date.now() + 39 * 86_400_000)    // now + 40 days
  })

  it('expireStatementParams: the seven parameters in the statement\'s order, two tags per id', () => {
    const p = expireStatementParams([{ id: 'x1', priorStatus: 'active', updatedAt: 'u1' }, { id: 'x2', priorStatus: 'active', updatedAt: 'u2' }], 'expired', STAMP)
    expect(p).toEqual([['x1', 'x2'], ['active', 'active'], ['u1', 'u2'], 'expired', STAMP, ['x1', 'x1', 'x2', 'x2'], [...pdpTombstoneTags('x1'), ...pdpTombstoneTags('x2')]])
  })
})
