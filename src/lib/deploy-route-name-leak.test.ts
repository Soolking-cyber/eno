import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The two deploy gates for eno.vn's route-name leak (infra/vn-node/eno-deploy.sh): SIB_JS reads the
 * built IMAGE before the swap, route_name_leak_live reads the served 404 after it. Both are driven
 * here against fixtures shaped exactly like what was measured:
 *   · the compiled server chunk of a local `next build` of this commit holds the `[lang]` sibling list
 *     as a JS array — `{metadata:{}},["about","account",…,"vietnam-evisa",…]`;
 *   · the live 404 at https://eno.vn/<random> holds it in escaped flight data —
 *     `\"handle\",\"<random>\",\"d\",[\"about\",…,\"itinerary\",…]`.
 * The point of each fixture pair is that the gate tells a leak from a clean build AND refuses when it
 * finds nothing to judge — "no list found" must never read as "clean".
 */
const ROOT = join(__dirname, '..', '..')
const DEPLOY = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'eno-leak-')); tmp.push(d); return d }

const SIBLINGS = ['about', 'account', 'admin', 'brands', 'c', 'contact', 'dashboard', 'help', 'listings', 'privacy', 'terms']
const withLeak = (list: string[]) => [...list.slice(0, 5), 'itinerary', ...list.slice(5), 'vietnam-evisa'].sort()

describe('step 6 · the image scan (SIB_JS)', () => {
  const SIB_JS = DEPLOY.match(/^SIB_JS='(.*)'$/m)?.[1]
  const scan = (chunk: string) => {
    const d = tempDir()
    mkdirSync(join(d, '.next/server/chunks/ssr'), { recursive: true })
    writeFileSync(join(d, '.next/server/chunks/ssr/[root-of-the-server]__x._.js'), chunk)
    return execFileSync('node', ['-e', SIB_JS as string], { cwd: d, encoding: 'utf8' })
  }

  it('is present in the deploy script', () => { expect(SIB_JS).toBeTruthy() })

  it('reports the services names in an unpruned bundle', () => {
    const out = scan(`a.r(1),"[project]/src/app/[lang]/[...rest]/page.tsx"]},[]]},{metadata:{}},${JSON.stringify(withLeak(SIBLINGS))}]`)
    expect(out).toMatch(/lists=1 leaks=itinerary,vietnam-evisa\n__SIBLINGS_END__/)
  })

  it('reports clean for a pruned bundle', () => {
    const out = scan(`{metadata:{}},${JSON.stringify(SIBLINGS)}]`)
    expect(out).toMatch(/lists=1 leaks=\n__SIBLINGS_END__/)
  })

  it('reads the escaped form a prerendered page carries', () => {
    const escaped = JSON.stringify(withLeak(SIBLINGS)).replace(/"/g, '\\"')
    expect(scan(`self.__next_f.push([1,"0:[\\"handle\\",\\"x\\",\\"d\\",${escaped}]"])`)).toMatch(/leaks=itinerary,vietnam-evisa/)
  })

  it('finds ZERO lists when there is no [lang] list — which the gate refuses rather than passing', () => {
    expect(scan('const kinds=["general","visa","itinerary","trips","offers","photos","files","links","calls"];')).toMatch(/lists=0 /)
    expect(DEPLOY).toMatch(/found NO \[lang\] route-sibling list/)
  })
})

describe('step 9 · the served 404 (route_name_leak_live)', () => {
  const fn = DEPLOY.match(/^route_name_leak_live\(\)\{[\s\S]*?^\}$/m)?.[0]

  /** A fake `curl` on PATH that answers with a Next 404 echoing the requested path, like eno.vn does. */
  function runLive(opts: { leak: boolean; status?: string; nextPage?: boolean; prune?: '0' | '1' }) {
    const d = tempDir()
    // The exact byte shape of the live page: flight data inside a JS string, so every quote is \".
    const list = JSON.stringify(opts.leak ? withLeak(SIBLINGS) : SIBLINGS).replace(/"/g, '\\"')
    const body = opts.nextPage === false
      ? '<html>edge error</html>'
      : `<html><script>self.__next_f.push([1,"0:[\\"handle\\",\\"__P__\\",\\"d\\",${list}]"])</script></html>`
    writeFileSync(join(d, 'body.html'), body)
    writeFileSync(join(d, 'curl'), [
      '#!/usr/bin/env bash',
      'for a in "$@"; do case "$a" in https://*) U="$a";; esac; done',
      'P=${U#https://eno.vn/}',
      `sed "s#__P__#$P#g" "${d}/body.html"`,
      `printf '\n__HTTP_CODE__%s' "${opts.status ?? '404'}"`,
      '',
    ].join('\n'))
    chmodSync(join(d, 'curl'), 0o755)
    writeFileSync(join(d, 'fn.sh'), `${fn}\n`)
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${d}:${process.env.PATH}` }
    if (opts.prune) env.ENO_PRUNE_FORUM_ROUTE_DIRS = opts.prune
    return spawnSync('bash', ['-c', `set -uo pipefail; warn(){ echo "WARN $*"; }; sleep(){ :; }; source "${d}/fn.sh"; route_name_leak_live; echo "rc=$?"`], { encoding: 'utf8', env })
  }

  it('is present, and runs after probe() — outside it, so a rollback never trips on it', () => {
    expect(fn).toBeTruthy()
    expect(DEPLOY).toMatch(/if ! probe; then restore; exit 1; fi\n[\s\S]{0,120}if ! route_name_leak_live; then/)
    const probe = DEPLOY.match(/^probe\(\)\{[\s\S]*?^\}$/m)?.[0] ?? ''
    expect(probe).not.toContain('route_name_leak_live')
  })

  it('fails on a 404 that carries the names — both the [handle] and the [...rest] probe', () => {
    const r = runLive({ leak: true })
    expect(r.stdout).toMatch(/rc=1/)
    expect(r.stdout.match(/ships services route names/g)).toHaveLength(2)
  })

  it('passes on a clean 404, having actually found the sibling list', () => {
    const r = runLive({ leak: false })
    expect(r.stdout, r.stderr).toMatch(/rc=0/)
    expect(r.stdout).toMatch(/404 clean \(11 route siblings checked\)/)
  })

  it('refuses when the answer is not a readable Next 404 — never "clean" by default', () => {
    expect(runLive({ leak: false, status: '200' }).stdout).toMatch(/rc=1/)
    expect(runLive({ leak: false, nextPage: false }).stdout).toMatch(/not a readable Next 404 page[\s\S]*rc=1/)
  })

  it('is advisory when the prune is switched off for the run', () => {
    const r = runLive({ leak: true, prune: '0' })
    expect(r.stdout).toMatch(/WARN route-name leak check failed[\s\S]*rc=0/)
  })

  it('the deploy script still parses', () => {
    execFileSync('bash', ['-n', join(ROOT, 'infra/vn-node/eno-deploy.sh')])
  })
})
