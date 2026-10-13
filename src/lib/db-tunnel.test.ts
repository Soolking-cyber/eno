import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * scripts/db-tunnel.sh `start` — RUN for real in a sandbox (review of 2026-10-13: the job's own test stubs this script
 * out, so its start lock, the wait for a running supervisor and the replacement of a wedged one had never run).
 * `nc`, `pgrep`, `pkill` and `ssh` are stubs on PATH: the port is "up" while <box>/up exists, "a supervisor is running"
 * while <box>/supervisor-running exists, and the stub ssh "connects" by creating <box>/up (or fails, with
 * <box>/ssh-fails). The script's lock, pid and log files live in the box (its one test switch, ENO_TUNNEL_SANDBOX), so
 * a real tunnel on this machine is never seen, waited for or stopped; the supervisor a case starts (python3 + bash, as
 * in production) is stopped through the script's own `stop`, and afterAll kills anything still naming the sandbox.
 */
const SCRIPT = join(process.cwd(), 'scripts/db-tunnel.sh')
const root = mkdtempSync(join(tmpdir(), 'db-tunnel-'))
afterAll(() => {
  spawnSync('/usr/bin/pkill', ['-f', root])
  rmSync(root, { recursive: true, force: true })
})

const STUBS: Record<string, string> = {
  nc: `#!/bin/bash\n[ -f "$SANDBOX/up" ]\n`,
  ssh: `#!/bin/bash
echo "ssh $*" >> "$SANDBOX/calls.log"
[ -f "$SANDBOX/ssh-fails" ] && exit 255
touch "$SANDBOX/up"
exec sleep 60
`,
  pgrep: `#!/bin/bash\necho "pgrep $*" >> "$SANDBOX/calls.log"\n[ -f "$SANDBOX/supervisor-running" ]\n`,
  pkill: `#!/bin/bash
echo "pkill $*" >> "$SANDBOX/calls.log"
case "$*" in *eno-db-tunnel-supervisor*) rm -f "$SANDBOX/supervisor-running" ;; esac
exit 0
`,
}

let boxes = 0
function sandbox(): string {
  const box = join(root, `box${boxes++}`)
  mkdirSync(join(box, 'bin'), { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) { writeFileSync(join(box, 'bin', name), body); chmodSync(join(box, 'bin', name), 0o755) }
  writeFileSync(join(box, 'key.pem'), 'not a key')
  return box
}
const env = (box: string, waits: Partial<Record<'START' | 'SUPERVISOR' | 'UP', number>> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test', PATH: `${join(box, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: box, SANDBOX: box,
  ENO_BOX_KEY: join(box, 'key.pem'),
  ENO_TUNNEL_SANDBOX: box,
  ENO_TUNNEL_START_WAIT_S: String(waits.START ?? 10), ENO_TUNNEL_SUPERVISOR_WAIT_S: String(waits.SUPERVISOR ?? 10), ENO_TUNNEL_UP_WAIT_S: String(waits.UP ?? 10),
})
type Run = { code: number; out: string; calls: string[] }
/** Runs `db-tunnel.sh <cmd>`; `upAfterMs` brings the port up from outside meanwhile (another caller, a reconnect). */
async function run(box: string, cmd: string, o: { waits?: Parameters<typeof env>[1]; upAfterMs?: number } = {}): Promise<Run> {
  rmSync(join(box, 'calls.log'), { force: true })
  const timer = o.upAfterMs === undefined ? null : setTimeout(() => writeFileSync(join(box, 'up'), ''), o.upAfterMs)
  const child = spawn('/bin/bash', [SCRIPT, cmd], { env: env(box, o.waits), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? -1)))
  if (timer) clearTimeout(timer)
  const log = join(box, 'calls.log')
  return { code, out, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] }
}
/** Is a process of THIS box's supervisor still running? Its command line carries the box's own log path. */
const supervisorAlive = (box: string) => spawnSync('/usr/bin/pgrep', ['-f', join(box, 'tunnel.log')]).status === 0
const SLOW = { timeout: 40_000 }

describe('scripts/db-tunnel.sh start — the start lock, a running supervisor, a wedged one (sandboxed)', SLOW, () => {
  it('⛔ a running supervisor mid-reconnect is WAITED for — never a second one beside it', async () => {
    const box = sandbox()
    writeFileSync(join(box, 'supervisor-running'), '')
    const r = await run(box, 'start', { upAfterMs: 1500 })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/tunnel back up on :5433 \(the running supervisor reconnected\)/)
    expect(r.calls.some((c) => c.startsWith('ssh'))).toBe(false)                    // no new supervisor dialled
    expect(r.calls.some((c) => c.startsWith('pkill'))).toBe(false)                  // and the running one left alone
    expect(existsSync(join(box, 'tunnel.pid'))).toBe(false)
    expect(existsSync(join(box, 'start.lock'))).toBe(false)                         // the lock it took is released
  })

  it('⛔ a supervisor still down after the wait is WEDGED: stopped, and replaced by one from this environment', async () => {
    const box = sandbox()
    writeFileSync(join(box, 'supervisor-running'), '')
    const r = await run(box, 'start', { waits: { SUPERVISOR: 1 } })
    try {
      expect(r.code, r.out).toBe(0)
      expect(r.out).toMatch(/a supervisor is running but :5433 has not come back in 1 s — replacing it/)
      expect(r.out).toMatch(/tunnel up on :5433 \(supervisor \d+, log /)
      const stop = r.calls.findIndex((c) => c === 'pkill -f eno-db-tunnel-supervisor')
      const dial = r.calls.findIndex((c) => c.startsWith('ssh '))
      expect(stop).toBeGreaterThan(-1)
      expect(dial).toBeGreaterThan(stop)                                             // the old one first, then the new
      expect(r.calls[dial]).toMatch(/-L 5433:127\.0\.0\.1:5433 root@162\.4\.176\.233$/)
      expect(supervisorAlive(box)).toBe(true)
    } finally {
      await run(box, 'stop')
    }
    expect(supervisorAlive(box)).toBe(false)
  })

  it('⛔ a second starter finds the start lock held: it waits for the first one\'s tunnel and leaves that lock alone', async () => {
    const box = sandbox()
    mkdirSync(join(box, 'start.lock'))
    const r = await run(box, 'start', { upAfterMs: 1500 })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/tunnel up on :5433 \(another caller started it\)/)
    expect(r.calls.some((c) => c.startsWith('ssh') || c.startsWith('pgrep'))).toBe(false)
    expect(existsSync(join(box, 'start.lock'))).toBe(true)                          // the other caller's, not ours
  })

  it('a start lock that stays held with the port down is a failure — never a second supervisor', async () => {
    const box = sandbox()
    mkdirSync(join(box, 'start.lock'))
    const r = await run(box, 'start', { waits: { START: 1 } })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/another caller is starting the tunnel and :5433 is still down/)
    expect(r.calls.some((c) => c.startsWith('ssh'))).toBe(false)
    expect(existsSync(join(box, 'start.lock'))).toBe(true)
  })

  it('a start lock over two minutes old (its starter died) is cleared; the tunnel is started and the lock released', async () => {
    const box = sandbox()
    const lock = join(box, 'start.lock')
    mkdirSync(lock)
    const old = Date.now() / 1000 - 5 * 60
    utimesSync(lock, old, old)
    const r = await run(box, 'start', { waits: { START: 1 } })
    try {
      expect(r.code, r.out).toBe(0)
      expect(r.out).toMatch(/tunnel up on :5433 \(supervisor \d+/)
      expect(existsSync(lock)).toBe(false)
    } finally {
      await run(box, 'stop')
    }
    expect(supervisorAlive(box)).toBe(false)
  })

  it('⛔ a supervisor that cannot connect is STOPPED, not left dialling every 2 s', async () => {
    const box = sandbox()
    writeFileSync(join(box, 'ssh-fails'), '')
    const r = await run(box, 'start', { waits: { UP: 2 } })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/tunnel FAILED to come up; stopping the supervisor/)
    expect(r.calls.some((c) => c.startsWith('ssh '))).toBe(true)
    expect(supervisorAlive(box)).toBe(false)
    expect(existsSync(join(box, 'tunnel.pid'))).toBe(false)
  })

  it('a port already up is left as it is', async () => {
    const box = sandbox()
    writeFileSync(join(box, 'up'), '')
    const r = await run(box, 'start')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/tunnel already up on :5433/)
    expect(r.calls).toEqual([])
  })
})

describe('scripts/db-tunnel.sh — its one test switch changes nothing unless it is set', () => {
  const sh = readFileSync(SCRIPT, 'utf8')
  it('the production paths and waits are fixed — only ENO_TUNNEL_SANDBOX (an existing dir) redirects them, under fixed names', () => {
    expect(sh).toMatch(/^LOG=\/tmp\/eno-db-tunnel\.log$/m)
    expect(sh).toMatch(/^PIDFILE=\/tmp\/eno-db-tunnel\.pid$/m)
    expect(sh).toMatch(/^STARTLOCK=\/tmp\/eno-db-tunnel\.start\.lock$/m)
    expect(sh).toMatch(/^START_WAIT_S=60 /m)
    expect(sh).toMatch(/^SUPERVISOR_WAIT_S=45 /m)
    expect(sh).toMatch(/^UP_WAIT_S=30 /m)
    expect(sh).toMatch(/^if \[ "\$\{NODE_ENV:-\}" = test \] && \[ -n "\$\{ENO_TUNNEL_SANDBOX:-\}" \] && \[ -d "\$ENO_TUNNEL_SANDBOX" \]; then\n\s+LOG="\$ENO_TUNNEL_SANDBOX\/tunnel\.log"; PIDFILE="\$ENO_TUNNEL_SANDBOX\/tunnel\.pid"; STARTLOCK="\$ENO_TUNNEL_SANDBOX\/start\.lock"$/m)
    // no other way in: no path variable is read from the environment anywhere else
    expect(sh.match(/ENO_TUNNEL_(LOG|PIDFILE|STARTLOCK)\b/g)).toBeNull()
  })
  it('⛔ a stray wait never shortens one: anything but whole seconds ≥ 1 keeps the default (the script\'s own helper, run as written)', () => {
    const helper = sh.split('\n').find((l) => l.startsWith('seconds() {'))!
    const seconds = (v: string) => spawnSync('/bin/bash', ['-c', `${helper}\nseconds "$1" 60`, 'x', v], { encoding: 'utf8' }).stdout.trim()
    for (const bad of ['', 'abc', '-1', '0', '007', '5s', ' 5']) expect(seconds(bad), JSON.stringify(bad)).toBe('60')
    expect(seconds('5')).toBe('5')
    expect(seconds('45')).toBe('45')
  })
})
