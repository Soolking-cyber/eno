import { describe, expect, it } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * infra/vn-node/eno-docker-prune.sh — the nightly Docker prune, which eno-deploy.sh step 14 also runs after
 * every deploy (2026-10-27: the 7-day build-cache rule reclaimed 0B three nights running while the cache
 * reached 48.8 GB). The script is RUN here with stand-ins for docker, df, flock and timeout on PATH, each
 * logging its arguments; what these pin:
 *   · the build cache is cut by size (`--reserved-space`), never by age and never emptied, and images are
 *     pruned dangling-only — never `-a`, never `system prune`, so the :prev rollback images survive;
 *   · the interlock is the deploy's own lock: held → nothing is pruned, exit 0 (a skip is routine) — unless
 *     the disk is already under 15G free, then exit 1 (an inherited lock would skip every run); free →
 *     released BEFORE pruning, so a deploy started mid-prune is never refused;
 *   · a second prune at the same time skips on the prune's own lock instead of failing;
 *   · a prune that fails exits 1 (systemd shows it, step 14 warns), never a quiet log line;
 *   · a running `docker build` still skips it;
 *   · step 14 is warn-only, after the deploy released its lock, and runs the copy in the deployed commit.
 * ⚠️ The real-lock case needs util-linux flock (Linux CI, the box); it is skipped where flock is absent.
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'infra/vn-node/eno-docker-prune.sh')

type Opts = {
  lockHeld?: boolean; freeG?: number; pruneHeld?: boolean; building?: boolean; keep?: string
  realFlock?: boolean; lock?: string; pruneFails?: boolean; pruneLock?: string
}

function run(opts: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eno-docker-prune-'))
  const log = join(dir, 'calls.log')
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  // `builder prune` also records whether the deploy lock is free while it runs: the script must not hold it.
  stub('docker', `case "$1 $2" in
  "image prune") echo "Total reclaimed space: 2GB";;
  "builder prune") flock -n "$ENO_DEPLOY_LOCK" true && echo "lock free during prune" >> "${log}"; ${opts.pruneFails ? 'echo "unknown flag: --reserved-space" >&2; exit 1' : 'echo "Total: 30GB"'};;
esac; exit 0`)
  stub('df', `echo "Avail"; echo " ${opts.freeG ?? 40}G"`)
  stub('timeout', 'shift; exec "$@"')
  stub('pgrep', opts.building ? 'exit 0' : 'exit 1')
  // fd 7 = the prune's own lock, fd 8 = the deploy lock; anything else (the docker stub's probe) is free
  if (!opts.realFlock) stub('flock', `case "$*" in "-n 7") exit ${opts.pruneHeld ? 1 : 0};; "-n 8") exit ${opts.lockHeld ? 1 : 0};; esac; exit 0`)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    ENO_DEPLOY_LOCK: opts.lock ?? join(dir, 'eno-deploy.lock'),
    ENO_PRUNE_LOCK: opts.pruneLock ?? join(dir, 'eno-docker-prune.lock'),
  }
  if (opts.keep !== undefined) env.ENO_BUILD_CACHE_KEEP = opts.keep
  const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  rmSync(dir, { recursive: true, force: true })
  return { code: r.status, out: r.stdout + r.stderr, calls, docker: calls.filter((c) => c.startsWith('docker ')) }
}

const hasFlock = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0

describe('eno-docker-prune.sh', () => {
  it('prunes dangling images and cuts the build cache to the newest 12GB, never by age, never -a', () => {
    const r = run()
    expect(r.code).toBe(0)
    expect(r.docker).toContain('docker image prune -f')
    expect(r.docker).toContain('docker builder prune -f --reserved-space 12GB')
    expect(r.docker.join('\n')).not.toMatch(/until=|\s-a\b|--all|system prune/)
    expect(r.calls).toContain('flock -n 8')
  })

  it('a prune that fails is a failed run (exit 1), never a quiet log line', () => {
    const r = run({ pruneFails: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/build-cache prune failed/)
  })

  it('takes the size from ENO_BUILD_CACHE_KEEP, and refuses a malformed one without pruning', () => {
    expect(run({ keep: '8GB' }).docker).toContain('docker builder prune -f --reserved-space 8GB')
    const bad = run({ keep: '8GB; rm -rf /' })
    expect(bad.code).toBe(2)
    expect(bad.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it('skips, exit 0, while the deploy lock is held — nothing pruned', () => {
    const r = run({ lockHeld: true })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/deploy lock held/)
    expect(r.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it('fails loudly, exit 1, when it skips on a disk already under 15G free (whoever holds the lock)', () => {
    const r = run({ lockHeld: true, freeG: 9 })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/only 9G free and the prune is skipping/)
    expect(r.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it('a lock that cannot be opened is a failed run (exit 1), not a skip — it would never fix itself', () => {
    const r = run({ pruneLock: '/nonexistent-dir/eno-docker-prune.lock' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/cannot open the prune lock/)
    expect(r.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it('skips, exit 0, while another prune runs — nothing pruned, no false failure', () => {
    const r = run({ pruneHeld: true })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/another prune is running/)
    expect(r.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it('skips, exit 0, while a docker build runs — nothing pruned', () => {
    const r = run({ building: true })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/docker build in progress/)
    expect(r.docker.filter((c) => c.includes('prune'))).toEqual([])
  })

  it.skipIf(!hasFlock)('the real lock: skipped while a process holds it the way eno-deploy.sh does; once free, it prunes unlocked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eno-docker-prune-lock-'))
    const lock = join(dir, 'eno-deploy.lock')
    const ready = join(dir, 'ready')
    const holder = spawn('bash', ['-c', `exec 9>"${lock}"; flock -n 9 || exit 1; touch "${ready}"; exec sleep 20`], { stdio: 'ignore' })
    try {
      for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise((res) => setTimeout(res, 50))
      expect(existsSync(ready)).toBe(true)
      const held = run({ realFlock: true, lock })
      expect(held.code).toBe(0)
      expect(held.out).toMatch(/deploy lock held/)
      expect(held.docker.filter((c) => c.includes('prune'))).toEqual([])
    } finally {
      holder.kill('SIGKILL')
    }
    await new Promise((res) => holder.once('exit', res))
    const free = run({ realFlock: true, lock })
    expect(free.docker).toContain('docker builder prune -f --reserved-space 12GB')
    // released before pruning, so a deploy started meanwhile is not refused
    expect(free.calls).toContain('lock free during prune')
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to the very lock file eno-deploy.sh takes', () => {
    const deploy = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
    const lock = /^LOCK=(\S+)$/m.exec(deploy)?.[1]
    expect(lock).toBe('/var/lock/eno-deploy.lock')
    expect(readFileSync(SCRIPT, 'utf8')).toContain(`LOCK="\${ENO_DEPLOY_LOCK:-${lock}}"`)
  })

  it('parses', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow()
  })
})

describe('eno-deploy.sh step 14 runs the prune warn-only, after the deploy released its lock', () => {
  const src = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
  const step = src.indexOf('say "14. Docker disk')
  const code = src.slice(step).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('runs under pipefail, so the exit code of the prune — not of sed — reaches the warn', () => {
    expect(src).toMatch(/^set -uo pipefail$/m)
  })

  it('sits after the marker removal and after the lock is released, and can only warn', () => {
    expect(step).toBeGreaterThan(src.indexOf('rm -f /opt/eno/deploy-incomplete\n\nsay "10. state"'))
    expect(step).toBeGreaterThan(src.indexOf('\nexec 9>&-\n'))
    expect(src.indexOf('\nexec 9>&-\n')).toBeGreaterThan(0)
    expect(code).not.toMatch(/\brestore\b|exit 1|\bbad\b/)
  })

  it('runs the copy in the deployed commit under a timeout, and refreshes the installed copy atomically', () => {
    expect(code).toMatch(/^timeout --foreground 900 bash "\$APP\/infra\/vn-node\/eno-docker-prune\.sh" .*\\$/m)
    expect(code).toMatch(/\|\| warn "docker prune: exit \$\?/)
    expect(code).toMatch(/install -m 0755 "\$APP\/infra\/vn-node\/eno-docker-prune\.sh" "\/opt\/eno\/bin\/\.eno-docker-prune\.sh\.new\.\$\$"/)
    expect(code).toMatch(/bash -n "\/opt\/eno\/bin\/\.eno-docker-prune\.sh\.new\.\$\$"/)
    expect(code).toMatch(/mv -f "\/opt\/eno\/bin\/\.eno-docker-prune\.sh\.new\.\$\$" \/opt\/eno\/bin\/eno-docker-prune\.sh/)
  })
})
