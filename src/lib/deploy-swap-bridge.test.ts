import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The swap bridge (2026-11-22): `up -d --force-recreate eno-vn` left a 1-3 s gap in which nginx answered 502, and Google
 * filed the listings it fetched then under "Server error (5xx)". The deploy now runs the PREVIOUS marketplace build on
 * :3011 for the swap only, and nginx falls back to it on its own 502. These pin the two things that make that safe:
 * the bridge is always a marketplace image on a marketplace port, and it is gone before anything reads the new build.
 */
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

describe('swap bridge', () => {
  it('compose: the previous marketplace image, :3011 only, off unless the deploy asks for it', () => {
    const apps = read('infra/vn-node/apps.compose.yml')
    const at = apps.search(/^ {2}eno-vn-bridge:\s*$/m)
    expect(at).toBeGreaterThan(-1)
    const rest = apps.slice(at + 1)
    const block = rest.slice(0, rest.search(/^ {2}[a-z][\w-]*:/m))
    expect(block).toMatch(/^ {4}<<: \*eno-vn$/m)
    expect(block).toMatch(/^ {4}image: eno-vn:prev$/m)
    expect(block).toMatch(/^ {4}ports: \["127\.0\.0\.1:3011:8080"\]$/m)
    expect(block).toMatch(/^ {4}volumes: \[\]$/m)
    expect(block).toMatch(/^ {4}profiles: \[bridge\]$/m)
    expect(apps).toMatch(/^ {2}eno-vn: &eno-vn\b/m)
  })

  it('nginx: only its own 502 goes to the bridge, on both marketplace vhosts, with the purge tag', () => {
    const conf = code(read('infra/vn-node/nginx/eno.conf'))
    expect(conf.match(/error_page 502 = @eno_vn_bridge;/g)).toHaveLength(2)
    expect(conf).not.toMatch(/proxy_intercept_errors/)
    expect(conf).not.toMatch(/error_page[^;]*\b50[34]\b[^;]*@eno_vn_bridge/)
    const named = conf.split('location @eno_vn_bridge {').slice(1).map((b) => b.slice(0, b.indexOf('\n  }')))
    expect(named).toHaveLength(2)
    for (const b of named) {
      // A 502 can mean the old container died mid-POST: never replay a write on the bridge.
      expect(b).toContain('if ($request_method !~ ^(GET|HEAD)$) { return 502; }')
      expect(b.indexOf('return 502')).toBeLessThan(b.indexOf('proxy_pass'))
      expect(b).toContain('proxy_pass http://127.0.0.1:3011;')
      expect(b).toContain('add_header Cache-Tag "eno-public" always;')
    }
    // The edition check counts :3011 as the marketplace, so a services vhost can never proxy there.
    expect(read('infra/vn-node/nginx/check-static-boundary.sh')).toContain('/proxy_pass http:\\/\\/127\\.0\\.0\\.1:30[01]1/ { p1++ }')
  })

  it('deploy: up before eno-vn is recreated, down once it listens, before the purge and the probe', () => {
    const s = code(read('infra/vn-node/eno-deploy.sh'))
    const up = s.indexOf('[ "$svc" = eno-vn ] && bridge_up')
    const swap = s.indexOf('docker compose -f "$COMPOSE" up -d --force-recreate "$svc" || { restore; exit 1; }')
    const listening = s.indexOf('ok "$svc up"')
    const down = s.indexOf('if [ "$svc" = eno-vn ] && ! bridge_down; then')
    const purge = s.indexOf('say "8. purge')
    expect(up).toBeGreaterThan(-1)
    expect(up).toBeLessThan(swap)
    expect(swap).toBeLessThan(listening)
    expect(listening).toBeLessThan(down)
    expect(down).toBeLessThan(purge)
    // A rollback also removes it before its own probe.
    const restore = s.slice(s.indexOf('restore(){'))
    const rDown = restore.indexOf('bridge_down || return 1')
    expect(rDown).toBeGreaterThan(restore.indexOf('sleep 10'))
    expect(rDown).toBeLessThan(restore.indexOf('if probe rollback'))
    // Only this run's bridge is removed on exit, and the bridge starts alone.
    expect(s).toContain(`[ "\${BRIDGE_MINE:-0}" = 1 ] && bridge_down' EXIT`)
    expect(s).toContain('--profile bridge up -d --no-deps --force-recreate eno-vn-bridge')
  })
})
