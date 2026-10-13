import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * scripts/import-nhatot-com.ts --fresh-crawl, SPAWNED (review of 2026-10-13: the job's own test stubs `npx`, so the
 * flag the job's Nhà Tốt stage reads now pass had never met the real script). Its argument rules
 * (nhatotFreshCrawlProblem, unit-tested in nhatot-fresh.test.ts) must refuse BEFORE a request or a database is
 * touched. ⛔ HERMETIC: every spawn preloads a module that replaces `fetch` with one that only writes the URL it was
 * asked for to a log and throws — a refusal that regressed can never crawl Chợ Tốt from a test run, and the log shows
 * whether any request was even attempted. No DATABASE_URL is set, and DOTENV_CONFIG_PATH names no file: the importer's
 * `dotenv/config` must never load a checkout's .env (in ~/eno.vn that is the production database).
 */
const dir = mkdtempSync(join(tmpdir(), 'nhatot-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const BLOCK = join(dir, 'no-network.mjs')
writeFileSync(BLOCK, [
  "import { appendFileSync } from 'node:fs'",
  "globalThis.fetch = async (u) => { appendFileSync(process.env.ENO_FETCH_LOG, String(u) + '\\n'); throw new Error('ENO TEST: network blocked') }",
  '',
].join('\n'))
let runs = 0
/** Runs the importer; `fetched` = every URL it tried to request (none, for a refusal). */
const run = (args: string[]) => {
  const log = join(dir, `fetch-${runs++}.log`)
  const r = spawnSync('npx', ['tsx', join(process.cwd(), 'scripts/import-nhatot-com.ts'), ...args], {
    encoding: 'utf8', timeout: 120_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: `--import=${BLOCK}`, ENO_FETCH_LOG: log, DOTENV_CONFIG_PATH: join(dir, 'no.env') },
  })
  return { ...r, fetched: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] }
}

describe('import-nhatot-com.ts --fresh-crawl refuses on its arguments before any request', () => {
  it('with --fresh-out (pass one), without --max-age-days, as a --src replay, and with --retire', { timeout: 240_000 }, () => {
    const both = run(['--cg', '1010', '--max-age-days', '7', '--fresh-crawl', '--fresh-out', '/nonexistent-eno-dir/x.json'])
    expect(both.status).toBe(1)
    expect(both.stderr).toContain('--fresh-crawl and --fresh-out are two kinds of the same read — pass one')
    const noWindow = run(['--cg', '1020,1030,1050', '--fresh-crawl'])
    expect(noWindow.status).toBe(1)
    expect(noWindow.stderr).toContain('--fresh-crawl needs the window to read down to: pass --max-age-days 7')
    const replay = run(['--src', '/nonexistent-eno-dir/stage.json', '--max-age-days', '7', '--fresh-crawl'])
    expect(replay.status).toBe(1)
    expect(replay.stderr).toContain('--fresh-crawl is the run that READS the source (with --save) — not a --src replay or --apply')
    const retire = run(['--retire', '--fresh-crawl'])
    expect(retire.status).toBe(1)
    expect(retire.stderr).toContain('--fresh-crawl is a stage read, not --retire')
    for (const r of [both, noWindow, replay, retire]) expect(r.fetched).toEqual([])                              // refused before any request
  })
  it('the block is live: a run past its argument checks reaches its first request — robots.txt — and is stopped there', { timeout: 120_000 }, () => {
    const live = run(['--cg', '1020', '--max-age-days', '7', '--fresh-crawl'])
    expect(live.status).not.toBe(0)
    expect(live.fetched[0]).toMatch(/\/robots\.txt$/)
    expect(live.stderr).toContain('--fresh-crawl: a list was not read whole')                                     // the stop ends the read, exit 3…
    expect(live.stderr).toContain('DIRECT_URL / DATABASE_URL unset')                                             // …then no database to report against
  })
})
