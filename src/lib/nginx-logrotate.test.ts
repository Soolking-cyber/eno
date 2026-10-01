import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * Per counsel review, PENDING LAWYER CONFIRMATION: Decree 333/2026/ND-CP Art. 20(3) keeps system logs
 * at least 12 months (source, LuatVietnam's English translation, Art 20:
 * https://english.luatvietnam.vn/decree-no-333-2026-nd-cp-dated-august-19-2026-of-the-government-detailing-a-number-of-articles-and-measures-for-implementation-of-the-law-on-cyberse-445089-doc1.html ).
 * The nginx package's own /etc/logrotate.d/nginx keeps 14 days. infra/vn-node/nginx/logrotate-nginx.conf
 * is installed BESIDE it as /etc/logrotate.d/eno-nginx — never editing the package's dpkg conffile,
 * which would make unattended-upgrades hold nginx security updates back — and wins through
 * `ignoreduplicates`. What can be held here, without the box: the policy says what it must, it covers
 * every log eno.conf writes, the postrotate signals a HOST nginx, the installer never writes the
 * package's file, logrotate itself resolves the two stanzas the way the comments claim (when a
 * logrotate >= 3.21.0 binary is available), and bootstrap.sh configures security updates before —
 * and survives — a failing installer.
 */
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const POLICY = read('infra/vn-node/nginx/logrotate-nginx.conf')
const INSTALLER = read('infra/vn-node/install-logrotate.sh')
const stanza = POLICY.split('\n').filter((l) => !l.startsWith('#')).join('\n')
const SOURCE_URL =
  'https://english.luatvietnam.vn/decree-no-333-2026-nd-cp-dated-august-19-2026-of-the-government-detailing-a-number-of-articles-and-measures-for-implementation-of-the-law-on-cyberse-445089-doc1.html'

/**
 * nginx-common 1.24.0-2ubuntu7.18 (Ubuntu 24.04 noble-updates), debian/nginx-common.nginx.logrotate,
 * verbatim — the stanza the eno policy has to coexist with on the box.
 */
const UBUNTU_NGINX_STANZA = `/var/log/nginx/*.log {
\tdaily
\tmissingok
\trotate 14
\tcompress
\tdelaycompress
\tnotifempty
\tcreate 0640 www-data adm
\tsharedscripts
\tprerotate
\t\tif [ -d /etc/logrotate.d/httpd-prerotate ]; then \\
\t\t\trun-parts /etc/logrotate.d/httpd-prerotate; \\
\t\tfi \\
\tendscript
\tpostrotate
\t\tinvoke-rc.d nginx rotate >/dev/null 2>&1
\tendscript
}
`

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'eno-logrotate-')); tmp.push(d); return d }

describe('nginx log retention policy', () => {
  it('rotates daily and keeps 400 compressed days', () => {
    for (const directive of ['daily', 'rotate 400', 'compress', 'delaycompress', 'missingok', 'notifempty']) {
      expect(stanza, directive).toMatch(new RegExp(`^\\s+${directive}$`, 'm'))
    }
    // 400 days is the floor of "12 months" with slack — never let it drift under a year.
    expect(Number(stanza.match(/^\s+rotate (\d+)$/m)?.[1])).toBeGreaterThanOrEqual(366)
  })

  it('reopens the HOST nginx after rotating, and does not hide a failed reopen', () => {
    const post = stanza.match(/postrotate\n([\s\S]*?)endscript/)?.[1] ?? ''
    expect(post).toMatch(/invoke-rc\.d nginx rotate/)
    expect(post).not.toMatch(/\|\|\s*true/)
    expect(post).not.toMatch(/docker/)
  })

  it('is ONE stanza on the package glob, marked ignoreduplicates so it can sit beside the package file', () => {
    expect(stanza.match(/^\/var\/log\/nginx\/\*\.log \{$/gm)).toHaveLength(1)
    expect(stanza).toMatch(/^\s+ignoreduplicates$/m)
  })

  it('covers every log path eno.conf writes (the glob does not recurse)', () => {
    const paths = [...read('infra/vn-node/nginx/eno.conf').matchAll(/^\s*(?:access_log|error_log)\s+(\S+?);?(?:\s|$)/gm)].map((m) => m[1])
    expect(paths.length).toBeGreaterThanOrEqual(3)
    for (const p of paths) expect(p, `${p} would fall out of retention`).toMatch(/^\/var\/log\/nginx\/[^/]+\.log$/)
  })

  it('nginx runs on the host: no compose file defines an nginx service', () => {
    expect(read('infra/vn-node/apps.compose.yml')).not.toMatch(/^\s+nginx:|image:\s*nginx/m)
  })

  /** The retention figure is a legal reading, so every file that states it says where it came from. */
  it('every file that states the retention rule cites its source and says it awaits counsel', () => {
    for (const rel of [
      'infra/vn-node/nginx/logrotate-nginx.conf',
      'infra/vn-node/install-logrotate.sh',
      'infra/vn-node/bootstrap.sh',
      'infra/vn-node/origin-bootstrap.sh',
      'infra/vn-node/nginx/eno.conf',
      'infra/vn-node/nginx/README.md',
    ]) {
      const text = read(rel)
      // Comment prose wraps, so the phrases are matched across line breaks and comment markers.
      const prose = text.replace(/\n[ \t]*(?:#|\*|\/\/)?[ \t]*/g, ' ').toLowerCase()
      expect(text, rel).toContain(SOURCE_URL)
      expect(text, rel).toMatch(/Art(?:\.|icle)? 20/)
      expect(prose, rel).toMatch(/per counsel review/)
      expect(prose, rel).toMatch(/pending lawyer confirmation/)
    }
  })
})

describe('nginx log retention · never edits the package conffile', () => {
  it('installs to /etc/logrotate.d/eno-nginx, a name logrotate reads BEFORE the package file', () => {
    expect(INSTALLER).toMatch(/^DEST=\/etc\/logrotate\.d\/eno-nginx$/m)
    expect(INSTALLER).toMatch(/^PKG_FILE=\/etc\/logrotate\.d\/nginx$/m)
    // logrotate sorts /etc/logrotate.d with strcoll; the first stanza to claim a file keeps it.
    expect('eno-nginx' < 'nginx').toBe(true)
    expect('eno-nginx'.localeCompare('nginx')).toBeLessThan(0)
  })

  it('never writes, moves or deletes /etc/logrotate.d/nginx — it only reads it', () => {
    const code = INSTALLER.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    // Every command that names the package file by path or variable must be a read.
    for (const line of code.split('\n').filter((l) => /\$PKG_FILE|\/etc\/logrotate\.d\/nginx\b/.test(l))) {
      expect(line, line).not.toMatch(/\b(install|cp|mv|rm|tee|ln|sed -i)\b[^|]*(\$PKG_FILE|\/etc\/logrotate\.d\/nginx\b)/)
      expect(line, line).not.toMatch(/>\s*"?(\$PKG_FILE|\/etc\/logrotate\.d\/nginx\b)/)
    }
    // The one write the installer makes is to DEST.
    expect(code.match(/\binstall -m 0644[^\n]*/g)).toEqual(['install -m 0644 -o root -g root "$SRC" "$DEST" || { bad "could not write $DEST"; exit 1; }'])
  })

  it('refuses a logrotate too old for ignoreduplicates, and checks the outcome in the dry run', () => {
    expect(INSTALLER).toMatch(/^MIN_LOGROTATE=3\.21\.0\b/m)
    expect(INSTALLER).toMatch(/sort -V/)
    // The per-file check reads logrotate's own "considering log" lines under each pattern header.
    expect(INSTALLER).toMatch(/^LOG_DIR=\/var\/log\/nginx\b/m)
    expect(INSTALLER).toContain('awk -v d="considering log $LOG_DIR/"')
    expect(INSTALLER).toMatch(/rotations\\\)/)
  })

  it('stays strict on its own: every failure path ends in exit 1', () => {
    expect(INSTALLER).toMatch(/^set -uo pipefail$/m)
    expect(INSTALLER.trimEnd().endsWith('bad "nginx log retention is NOT verified — see the [XX] lines above"; exit 1')).toBe(true)
  })
})

/**
 * THE CLAIM THE WHOLE DESIGN RESTS ON, CHECKED AGAINST logrotate ITSELF. Runs whenever a logrotate
 * >= 3.21.0 binary is available — $LOGROTATE_BIN, else `logrotate` on PATH or in /usr/sbin (Ubuntu
 * 24.04, which CI runs on, ships 3.21.0) — and is skipped otherwise. `-d` is a dry run: it parses,
 * decides and prints, and rotates nothing. Ownership in `create` is rewritten to the current user,
 * since `www-data`/`adm` exist on the box and not on every machine that runs the suite.
 */
function findLogrotate(): string | null {
  const candidates = [process.env.LOGROTATE_BIN, 'logrotate', '/usr/sbin/logrotate'].filter(Boolean) as string[]
  for (const bin of candidates) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    const ver = /logrotate\s+(\d+)\.(\d+)\.(\d+)/.exec(`${r.stdout}${r.stderr}`)
    if (r.status === 0 && ver) {
      const [maj, min] = [Number(ver[1]), Number(ver[2])]
      if (maj > 3 || (maj === 3 && min >= 21)) return bin
    }
  }
  return null
}
const LOGROTATE = findLogrotate()

describe.skipIf(!LOGROTATE)('nginx log retention · logrotate resolves the two stanzas as claimed', () => {
  const LOGS = ['access.log', 'error.log', 'eno-vn.access.log', 'eno-forum.access.log', 'eno-sb.access.log']
  const group = () => execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim()

  function dryRun(files: Record<string, string>) {
    const d = scratch()
    const logDir = join(d, 'log')
    const confDir = join(d, 'logrotate.d')
    mkdirSync(logDir); mkdirSync(confDir)
    // Modes set explicitly, never left to the umask: logrotate skips a log whose directory is group-
    // or world-writable, and (as root) ignores a config file that is.
    for (const dir of [d, logDir, confDir]) chmodSync(dir, 0o755)
    for (const f of LOGS) writeFileSync(join(logDir, f), 'x\n')
    const localise = (s: string) =>
      s.replaceAll('/var/log/nginx', logDir).replaceAll('www-data adm', `${userInfo().username} ${group()}`)
    for (const [name, body] of Object.entries(files)) writeFileSync(join(confDir, name), localise(body), { mode: 0o644 })
    writeFileSync(join(d, 'logrotate.conf'), `include ${confDir}\n`, { mode: 0o644 })
    const r = spawnSync(LOGROTATE as string, ['-d', '-s', join(d, 'state'), join(d, 'logrotate.conf')], { encoding: 'utf8' })
    const out = `${r.stdout}${r.stderr}`
    // "considering log X" belongs to the "rotating pattern: … (N rotations)" header above it — the
    // same reading install-logrotate.sh step 4 makes on the box.
    const rotations = new Map<string, number>()
    let current = NaN
    for (const line of out.split('\n')) {
      const header = /^rotating pattern: .*\((\d+) rotations\)/.exec(line)
      if (header) current = Number(header[1])
      const considered = /^considering log (\S+)/.exec(line)
      if (considered) rotations.set(considered[1].slice(logDir.length + 1), current)
    }
    return { status: r.status, out, rotations, wroteState: existsSync(join(d, 'state')) }
  }

  it('the eno policy beside the stock Ubuntu stanza: no error, every log under 400, the package stanza empty', () => {
    const r = dryRun({ 'eno-nginx': POLICY, nginx: UBUNTU_NGINX_STANZA })
    expect(r.out).not.toMatch(/^error:/m)
    expect(r.status, r.out).toBe(0)
    for (const f of LOGS) {
      expect(r.out).toMatch(new RegExp(`^nginx:1 ignore duplicate log entry for \\S+/${f.replace(/\./g, '\\.')}$`, 'm'))
      expect(r.rotations.get(f), f).toBe(400)
    }
    expect(r.out).toMatch(/\(14 rotations\)\n[^\n]*\nNo logs found\. Rotation not needed\./)
    expect(r.wroteState).toBe(false)
  })

  it('without ignoreduplicates the same pair is a logrotate ERROR — the flag is load-bearing', () => {
    const r = dryRun({ 'eno-nginx': POLICY.replace(/^\s+ignoreduplicates\n/m, ''), nginx: UBUNTU_NGINX_STANZA })
    expect(r.out).toMatch(/^error: nginx:1 duplicate log entry for /m)
    expect(r.status).not.toBe(0)
  })

  it('the file name is load-bearing too: read AFTER the package file, the 14-day stanza claims the logs', () => {
    const r = dryRun({ nginx: UBUNTU_NGINX_STANZA, 'zz-eno-nginx': POLICY })
    expect(r.out).toMatch(/^error: zz-eno-nginx:\d+ duplicate log entry for /m)
    for (const f of LOGS) expect(r.rotations.get(f), f).toBe(14)
  })

  /**
   * install-logrotate.sh ITSELF, end to end, in a sandbox: its absolute paths rewritten into a scratch
   * tree that holds the stock Ubuntu nginx stanza, the real logrotate doing the dry runs, and stand-ins
   * only for what needs root or a real box (id -u, nginx -v/-T, invoke-rc.d, docker, dpkg-query,
   * systemctl, install -o root). Proves the verdicts, not just the text: a clean install passes and
   * leaves the package file byte-identical; a stanza that claims the logs first fails it; an edited
   * package file is a warning, not a failure.
   *
   * ⛔ logrotate's DEFAULT state file is made unopenable in every sandbox run. On the box (and on a CI
   * runner) it is Ubuntu's /var/lib/logrotate/status, 0640 root:root after any real run, and even a
   * dry run opens it: a non-root `logrotate -d` without -s prints `error: error opening state file …;
   * assuming empty state: Permission denied` (logrotate.c readState, 3.21.0), which the installer's
   * `^error:` check turns into a failure. A machine whose default state path simply does not exist
   * (a scratch build on macOS) only logs that at debug level, so the bug was green there and red on
   * Linux. The shim points every call that passes no -s at a path UNDER A REGULAR FILE: ENOTDIR reaches
   * the same branch as EACCES (any errno but ENOENT), on every machine and even as root.
   */
  function sandbox() {
    const d = scratch()
    const p = (rel: string) => join(d, rel)
    for (const dir of ['bin', 'etc/logrotate.d', 'etc/init.d', 'etc/nginx', 'var/log/nginx', 'vn-node/nginx', 'var/lib']) mkdirSync(p(dir), { recursive: true })
    writeFileSync(p('var/lib/logrotate'), 'not a directory\n')
    const defaultState = p('var/lib/logrotate/status')
    for (const dir of [d, p('var'), p('var/log'), p('var/log/nginx'), p('etc/logrotate.d')]) chmodSync(dir, 0o755)
    const owner = `${userInfo().username} ${group()}`
    const localise = (s: string) => s
      .replaceAll('/etc/logrotate.d', p('etc/logrotate.d'))
      .replaceAll('/etc/logrotate.conf', p('etc/logrotate.conf'))
      .replaceAll('/var/log/nginx', p('var/log/nginx'))
      .replaceAll('/etc/init.d/nginx', p('etc/init.d/nginx'))
      .replaceAll('/etc/nginx/nginx.conf', p('etc/nginx/nginx.conf'))
      .replaceAll('www-data adm', owner)
    writeFileSync(p('vn-node/install-logrotate.sh'), localise(INSTALLER))
    writeFileSync(p('vn-node/nginx/logrotate-nginx.conf'), localise(POLICY), { mode: 0o644 })
    const pkgStanza = localise(UBUNTU_NGINX_STANZA)
    writeFileSync(p('etc/logrotate.d/nginx'), pkgStanza, { mode: 0o644 })
    writeFileSync(p('etc/logrotate.conf'), `weekly\nrotate 4\ncreate\ninclude ${p('etc/logrotate.d')}\n`, { mode: 0o644 })
    for (const f of LOGS) writeFileSync(p(`var/log/nginx/${f}`), 'x\n')
    writeFileSync(p('etc/init.d/nginx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(p('etc/nginx/nginx.conf'), 'pid /run/nginx.pid;\n')
    const md5 = createHash('md5').update(pkgStanza).digest('hex')
    const shims: Record<string, string> = {
      id: '[ "$1" = "-u" ] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"',
      nginx: `case "$1" in -v) echo "nginx version: nginx/1.24.0 (Ubuntu)" >&2 ;; -T) printf 'http {\\n  access_log ${p('var/log/nginx')}/access.log;\\n  error_log ${p('var/log/nginx')}/error.log;\\n  server { access_log ${p('var/log/nginx')}/eno-vn.access.log; }\\n}\\n' ;; esac`,
      'invoke-rc.d': 'exit 0',
      docker: 'exit 0',
      'dpkg-query': `case "$*" in *Conffiles*) printf '\\n /etc/nginx/nginx.conf 00\\n ${p('etc/logrotate.d/nginx')} ${md5}\\n' ;; *Version*) printf '1.24.0-2ubuntu7.18' ;; esac`,
      systemctl: 'case "$1" in is-enabled|is-active) exit 0 ;; show) echo "tomorrow" ;; esac',
      install: 'while [ $# -gt 2 ]; do case "$1" in -m|-o|-g) shift 2 ;; *) shift ;; esac; done\ncp "$1" "$2"',
      logrotate: `case " $* " in *" -s "*) exec '${LOGROTATE}' "$@" ;; esac\nexec '${LOGROTATE}' -s '${defaultState}' "$@"`,
    }
    for (const [name, body] of Object.entries(shims)) writeFileSync(p(`bin/${name}`), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    const env = { ...process.env, PATH: `${p('bin')}:${process.env.PATH}` }
    const run = (...args: string[]) => {
      const r = spawnSync('bash', [p('vn-node/install-logrotate.sh'), ...args], { encoding: 'utf8', cwd: d, env })
      return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '') }
    }
    /** The logrotate the installer runs (the shim at the front of its PATH). */
    const logrotate = (...args: string[]) => {
      const r = spawnSync(p('bin/logrotate'), args, { encoding: 'utf8', cwd: d, env })
      return { status: r.status, out: `${r.stdout}${r.stderr}` }
    }
    return { p, run, logrotate, pkgStanza }
  }

  it('install-logrotate.sh end to end: installs beside the package file, verifies, and is idempotent', () => {
    const { p, run, pkgStanza } = sandbox()
    const first = run()
    expect(first.status, first.out).toBe(0)
    expect(first.out).toMatch(/\[ok\] every \S+\/\*\.log rotates under 'rotate 400'/)
    expect(first.out).toMatch(/byte-identical to what dpkg installed/)
    expect(first.out).toMatch(/\[ok\] nginx log retention: 400 days, verified/)
    expect(readFileSync(p('etc/logrotate.d/eno-nginx'), 'utf8')).toBe(readFileSync(p('vn-node/nginx/logrotate-nginx.conf'), 'utf8'))
    expect(readFileSync(p('etc/logrotate.d/nginx'), 'utf8')).toBe(pkgStanza)
    const again = run('--check')
    expect(again.status, again.out).toBe(0)
    expect(again.out).toMatch(/already holds this policy — nothing to change/)
  })

  it('install-logrotate.sh fails when another stanza claims the logs first, and only warns on an edited package file', () => {
    const { p, run } = sandbox()
    expect(run().status).toBe(0)
    writeFileSync(p('etc/logrotate.d/aaa-nginx'), `${p('var/log/nginx')}/*.log {\n\tignoreduplicates\n\tdaily\n\trotate 7\n}\n`, { mode: 0o644 })
    const shadowed = run('--check')
    expect(shadowed.status).toBe(1)
    expect(shadowed.out).toMatch(/access\.log\(rotate:7\)/)
    rmSync(p('etc/logrotate.d/aaa-nginx'))
    writeFileSync(p('etc/logrotate.d/nginx'), readFileSync(p('etc/logrotate.d/nginx'), 'utf8').replace('rotate 14', 'rotate 15'), { mode: 0o644 })
    const edited = run('--check')
    expect(edited.status, edited.out).toBe(0)
    expect(edited.out).toMatch(/\[!!\] \S+ was EDITED — unattended-upgrades will hold nginx back/)
  })

  it('install-logrotate.sh passes with an unopenable default state file (CI, non-root): every logrotate call brings its own -s', () => {
    const { p, run, logrotate } = sandbox()
    // The precondition, so this test cannot pass vacuously: in this sandbox a dry run that leaves the
    // state file to logrotate's default prints exactly the error that failed the installer on Linux.
    const bare = logrotate('-d', p('etc/logrotate.conf'))
    expect(bare.out, bare.out).toMatch(/^error: error opening state file \S+; assuming empty state: /m)
    const first = run()
    expect(first.status, first.out).toBe(0)
    expect(first.out).not.toMatch(/error opening state file/)
    expect(first.out).toMatch(/\[ok\] logrotate -d \S+: no errors/)
    const again = run('--check')
    expect(again.status, again.out).toBe(0)
    // And by construction: no logrotate invocation in the installer (besides --version) omits -s.
    const code = INSTALLER.split('\n').filter((l) => !/^\s*#/.test(l))
    // A command position only (start, space, `(`), so the quoted [ok]/[XX] messages naming it are not calls.
    const calls = code.flatMap((l) => l.match(/(?<=^|[\s(])logrotate -[^\n)]*/g) ?? [])
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const c of calls.filter((c) => !c.startsWith('logrotate --version'))) expect(c, c).toMatch(/ -s "\$\w+"/)
  })
})

describe('nginx log retention · installed by provisioning', () => {
  it('bootstrap.sh checks for the installer up front and runs it in the log-rotation step', () => {
    const boot = read('infra/vn-node/bootstrap.sh')
    expect(boot.indexOf('install-logrotate.sh" "$HERE/nginx/logrotate-nginx.conf')).toBeLessThan(boot.indexOf('log "1/7'))
    const step6 = boot.slice(boot.indexOf('log "6/7'), boot.indexOf('log "7/7'))
    // Security updates are switched on BEFORE the installer, and the installer cannot end the run.
    expect(step6.indexOf('> /etc/apt/apt.conf.d/20auto-upgrades')).toBeGreaterThan(-1)
    expect(step6.indexOf('> /etc/apt/apt.conf.d/20auto-upgrades')).toBeLessThan(step6.indexOf('install-logrotate.sh"'))
    expect(step6).toMatch(/^if ! bash "\$HERE\/install-logrotate\.sh"; then$/m)
    expect(step6).not.toMatch(/^bash "\$HERE\/install-logrotate\.sh"\s*$/m)
  })

  /**
   * Step 6 EXECUTED, not just read: its own lines, under the bootstrap's `set -euo pipefail`, with the
   * three absolute paths it writes redirected into a scratch directory and a stand-in installer. The
   * stand-in records whether 20auto-upgrades already existed when it ran, then fails or passes.
   */
  function runStep6(installerExit: 0 | 1) {
    const boot = read('infra/vn-node/bootstrap.sh')
    const start = boot.indexOf('log "6/7')
    const end = boot.indexOf('cat <<EOF', boot.indexOf('log "7/7'))
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const d = scratch()
    const here = join(d, 'vn-node')
    mkdirSync(here)
    const auto = join(d, '20auto-upgrades')
    const dbsync = join(d, 'eno-db-sync')
    const seen = join(d, 'seen')
    writeFileSync(join(here, 'install-logrotate.sh'),
      `if [ -f '${auto}' ]; then echo auto-upgrades-present > '${seen}'; else echo auto-upgrades-MISSING > '${seen}'; fi\necho '  [XX] stand-in failure'\nexit ${installerExit}\n`)
    const block = boot.slice(start, end)
      .replaceAll('/etc/apt/apt.conf.d/20auto-upgrades', auto)
      .replaceAll('/etc/logrotate.d/eno-db-sync', dbsync)
    // Nothing EXECUTED may still point at the real /etc (comments may name it).
    expect(block.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')).not.toMatch(/\/etc\//)
    const script = `set -euo pipefail\nHERE='${here}'\nlog(){ printf '\\n── %s\\n' "$*"; }\n${block}\necho STEP7-REACHED\n`
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    return { ...r, auto, dbsync, seen: readFileSync(seen, 'utf8').trim() }
  }

  it('step 6 survives a failing installer: security updates already on, failure printed twice, run continues', () => {
    const r = runStep6(1)
    expect(r.status, r.stderr).toBe(0)
    expect(r.seen).toBe('auto-upgrades-present')
    expect(readFileSync(r.auto, 'utf8')).toContain('APT::Periodic::Unattended-Upgrade "1";')
    expect(existsSync(r.dbsync)).toBe(true)
    expect(r.stdout).toMatch(/NGINX LOG RETENTION NOT VERIFIED/)
    expect(r.stdout).toMatch(/FIRST: NGINX LOG RETENTION — install-logrotate\.sh FAILED in step 6/)
    expect(r.stdout).toMatch(/STEP7-REACHED/)
  })

  it('step 6 with a passing installer prints no failure banner', () => {
    const r = runStep6(0)
    expect(r.status, r.stderr).toBe(0)
    expect(r.seen).toBe('auto-upgrades-present')
    expect(r.stdout).not.toMatch(/NOT VERIFIED|FAILED in step 6/)
    expect(r.stdout).toMatch(/STEP7-REACHED/)
  })

  it('origin-bootstrap.sh runs it after nginx comes up', () => {
    expect(read('infra/vn-node/origin-bootstrap.sh')).toMatch(/✓ nginx"[\s\S]{0,1200}install-logrotate\.sh" \|\| fail/)
  })

  it('every script involved parses', () => {
    for (const s of ['install-logrotate.sh', 'bootstrap.sh', 'origin-bootstrap.sh']) {
      execFileSync('bash', ['-n', join(ROOT, 'infra/vn-node', s)])
    }
  })
})
