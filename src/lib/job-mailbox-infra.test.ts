import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INGEST_LIMITS } from '@/lib/teachers/job-dms/ingest'

/**
 * infra/vn-node/job-mailbox — the box's reader for LinkedIn job alerts and the team's "JOB:" forwards in alex@eno.vn
 * (teacher job DMs, owner 2026-10-20). Its own tests (test_eno_job_mailbox.py: read-only doveadm, the two kinds of mail
 * and how each is authenticated, parsing, the checkpoint, no body in a log) run here whenever a python3 ≥ 3.10 is on
 * the PATH — so CI runs them too, as laya-infra.test.ts does for the Laya server — and the units are held to what the
 * README installs.
 */
const ROOT = join(__dirname, '../..')
const DIR = join(ROOT, 'infra/vn-node/job-mailbox')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

const PYTHON = (() => {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8', timeout: 10_000 })
    if (r.status === 0 && r.stdout.trim() === 'True') return bin
  }
  return null
})()

describe('infra/vn-node/job-mailbox', () => {
  it.skipIf(!PYTHON)('passes its own tests (test_eno_job_mailbox.py — no network, no docker)', () => {
    const r = spawnSync(PYTHON!, ['-B', join(DIR, 'test_eno_job_mailbox.py')], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stderr).toMatch(/^OK$/m)
  }, 120_000)

  it('reads ONE mailbox, and only with read commands', () => {
    const py = read('eno-job-mailbox.py')
    expect(py).toMatch(/^MAILBOX_USER = 'alex@eno\.vn'$/m)
    expect(py).toMatch(/^MAILBOX = 'INBOX'$/m)
    expect(py).toMatch(/^_READ_COMMANDS = \(\('mailbox', 'status'\), \('search',\), \('fetch',\)\)$/m)
    // nothing that changes a message: no expunge, move, flags or delivery anywhere in the script
    expect(py).not.toMatch(/['"](expunge|move|copy|flags|deliver|altmove|purge|force-resync)['"]/)
  })

  it('sends within the post door\'s limits (ingest.ts INGEST_LIMITS): a request the door refused WHOLE would stall the reader', () => {
    const py = read('eno-job-mailbox.py')
    const num = (name: string) => Number(new RegExp(`^${name} = (\\d+)$`, 'm').exec(py)?.[1])
    expect(num('BATCH_MAX')).toBeLessThanOrEqual(INGEST_LIMITS.posts)
    expect(num('TEXT_MAX')).toBe(INGEST_LIMITS.text)
    expect(num('SHORT_MAX')).toBe(INGEST_LIMITS.short)
  })

  it('the unit runs the INSTALLED copy, isolated, capped, with "nothing new" (2) as a success; the timer is 07:00–21:00 ICT', () => {
    const svc = read('eno-job-mailbox.service')
    expect(svc).toMatch(/^ExecStart=\/usr\/bin\/python3 -I \/opt\/eno\/bin\/eno-job-mailbox\.py$/m)
    expect(svc).toMatch(/^SuccessExitStatus=2$/m)
    expect(svc).toMatch(/^MemoryMax=256M$/m)
    expect(svc).toMatch(/^PrivateTmp=yes$/m)
    const timer = read('eno-job-mailbox.timer')
    expect(timer.match(/^OnCalendar=.*$/gm)).toEqual(['OnCalendar=*-*-* 00..13:00,30:00 UTC', 'OnCalendar=*-*-* 14:00:00 UTC'])
    expect(read('README.md')).toContain('install -m 0755 /opt/eno/app/infra/vn-node/job-mailbox/eno-job-mailbox.py /opt/eno/bin/eno-job-mailbox.py')
  })
})
