import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Speed plan item 2 (2026-10-16): a deploy no longer purges Cloudflare everywhere.
 *   · step 6b copies every build's /_next/static to disk BEFORE the swap (eno-static-sync.sh), nginx serves it
 *     (nginx/static-<edition>.conf), so HTML that outlives a deploy still hydrates;
 *   · step 8 purges only the tags that change with a deploy (eno-html, eno-public);
 *   · photos are purged nightly (eno-edge-nightly-purge.sh) — the erasure bound purge_everything used to give.
 * These pin the orderings and the boundaries that make that safe; each one is a way the change could rot.
 */
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const deploy = read('infra/vn-node/eno-deploy.sh')
const at = (needle: string) => {
  const i = deploy.indexOf(needle)
  expect(i, `eno-deploy.sh no longer contains: ${needle}`).toBeGreaterThan(-1)
  return i
}

describe('eno-deploy.sh — static on disk before the swap, tags instead of purge_everything', () => {
  it('step 6b runs after every edition gate and before anything is swapped', () => {
    const gate = at('ok "forum: services edition confirmed')
    const ingest = at('say "6b. publish static from disk')
    const swap = at('say "7. swap"')
    expect(gate).toBeLessThan(ingest)
    expect(ingest).toBeLessThan(swap)
    // …and the marker that blocks the next deploy is written only by the swap, after 6b.
    expect(ingest).toBeLessThan(at('touch /opt/eno/deploy-incomplete'))
  })

  it('a failed ingest or an nginx that does not serve the new build stops the deploy before the swap', () => {
    const block = deploy.slice(at('say "6b. publish static from disk'), at('say "7. swap"'))
    expect(block).toMatch(/ingest "\$ed" "\$img:local"\) \|\| \{ bad [^}]*untag_bad; exit 1; \}/)
    expect(block).toMatch(/untag_bad; exit 1\n\s+fi/)
    // Through the tunnel listener on loopback, never through Cloudflare (that would cache the new build early).
    expect(block).toContain('http://127.0.0.1:8181/_next/static/$nb/_buildManifest.js')
    expect(block).not.toMatch(/https:\/\/\$host\/_next/)
  })

  it('a normal deploy purges tags; purge_everything only on demand, with --no-static, or on a licensing leak', () => {
    expect(deploy).toMatch(/^EDGE_DEPLOY_TAGS="eno-html,eno-public"$/m)
    const fn = deploy.slice(at('purge_edge(){'), at('edge_html_fresh(){'))
    expect(fn).toMatch(/if \[ "\$PURGE_ALL" = 1 \]; then cf_purge '\{"purge_everything":true\}'/)
    expect(fn).toMatch(/cf_purge "\{\\"tags\\":\[/)
    expect(deploy).toMatch(/--no-static\) NO_STATIC=1; PURGE_ALL=1;;/)
    // Every rollback — the licensing leak, a failed probe, a failed swap — goes through restore(), which purges
    // EVERYTHING and drops the refused build's own files from disk (codex, gate round 2).
    const leak = deploy.slice(at('if ! route_name_leak_live; then'), at('ok "serving $(git log --oneline -1)"'))
    expect(leak).toContain('restore; exit 1')
  })

  it('restore() purges everything and drops the refused build before it purges', () => {
    const restore = deploy.slice(at('restore(){'), at('# ⛔ THE GATE COVERS ROLLBACK TOO.'))
    const all = restore.indexOf('PURGE_ALL=1'), drop = restore.indexOf('drop_new_static'), purge = restore.indexOf('elif ! purge_edge; then')
    expect(all).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(all)
    expect(purge).toBeGreaterThan(drop)
    const fn = deploy.slice(at('drop_new_static(){'), at('restore(){'))
    expect(fn).toMatch(/"\$NEWBID_VN" != "\$\{PREVBID_VN:-\}"/)   // never drops the build that is still serving
  })

  it('the tag body the script builds is the JSON Cloudflare expects', () => {
    const line = deploy.split('\n').find((l) => l.includes('cf_purge "{\\"tags\\"'))!
    const expr = /cf_purge (".*?") "tags/.exec(line)![1]
    const out = execFileSync('bash', ['-c', `EDGE_DEPLOY_TAGS="eno-html,eno-public"; printf '%s' ${expr}`], { encoding: 'utf8' })
    expect(JSON.parse(out)).toEqual({ tags: ['eno-html', 'eno-public'] })
  })

  it('a rollback purges through purge_edge — so the leak path\'s PURGE_ALL=1 really empties the edge (opus, gate review)', () => {
    const restore = deploy.slice(at('restore(){'), at('# ⛔ THE GATE COVERS ROLLBACK TOO.'))
    expect(restore).toMatch(/elif ! purge_edge; then/)
  })

  it('no SUCCESSFUL nightly photo purge in 26 h → this deploy purges everything (both reviewers, gate rounds 1–2)', () => {
    const block = deploy.slice(at('systemctl enable --now eno-edge-nightly-purge.timer'), at('SS=/opt/eno/bin/eno-static-sync.sh'))
    expect(block).toContain('systemctl show -p Result --value eno-edge-nightly-purge.service')
    expect(block).toMatch(/is-active --quiet eno-edge-nightly-purge\.timer && \[ "\$NIGHT_RES" = success \]/)
    expect(block).toMatch(/-lt 93600 \]; then[\s\S]*else[\s\S]*PURGE_ALL=1\nfi/)
  })

  it('a tag purge the edge does not reflect falls back to purge_everything, and a failed fallback is fatal', () => {
    const block = deploy.slice(at('# ⛔ READ IT BACK, AND FALL BACK'), at('say "9. verify through the edge"'))
    // Exact, not a timing guess: the edge's `/` must embed the BUILD_ID the new containers report.
    expect(block).toMatch(/if ! \{ edge_html_fresh eno\.vn "\$BID_VN" && edge_html_fresh www\.eno\.forum "\$BID_FO"; \}; then/)
    expect(block).toMatch(/PURGE_ALL=1\n\s+if ! purge_edge; then[\s\S]*?exit 1/)
    const fresh = deploy.slice(at('edge_html_fresh(){'), at('# ⛔ BEFORE THE SWAP') > 0 ? at('# ⛔ BEFORE THE SWAP') : undefined)
    expect(fresh).toMatch(/grep -qF -- "\$bid" <<<"\$body"/)
  })

  it('pruning old static runs only after the deploy is verified and recorded', () => {
    expect(at('rm -f /opt/eno/deploy-incomplete\n\nsay "10. state"')).toBeLessThan(at('"$SS" prune marketplace'))
  })
})

describe('eno-static-sync.sh — never deletes what a retained build ships', () => {
  const src = read('infra/vn-node/eno-static-sync.sh')
  it('parses', () => { execFileSync('bash', ['-n', join(ROOT, 'infra/vn-node/eno-static-sync.sh')]) })
  it('never rsyncs with --delete and never prunes files by mtime', () => {
    expect(src).not.toMatch(/^[^#]*rsync[^#\n]*--delete/m)
    expect(src).not.toMatch(/^[^#]*find "\$dst"[^\n]*-mtime/m)
  })
  it('cleans up on EXIT (RETURN never fires when set -e exits)', () => {
    expect(src).toMatch(/^trap cleanup EXIT/m)
  })
  it('refuses a same-name file with different bytes unless deliberately overridden (codex, gate review)', () => {
    expect(src).toMatch(/if \[ "\$coll" -gt 0 \] && \[ "\$\{ENO_STATIC_ALLOW_COLLISION:-0\}" != 1 \]; then[\s\S]*?return 1/)
    // …and the refusal comes before anything is written to the served tree.
    expect(src.indexOf('ENO_STATIC_ALLOW_COLLISION:-0')).toBeLessThan(src.indexOf('rsync -a --ignore-existing'))
  })
})

describe('nginx — each edition serves only its own static directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eno-static-boundary-'))
  const stage = (mkt = 'static-marketplace.conf', svc = 'static-services.conf') => {
    copyFileSync(join(ROOT, 'infra/vn-node/nginx', mkt), join(dir, 'eno-static-marketplace.conf'))
    copyFileSync(join(ROOT, 'infra/vn-node/nginx', svc), join(dir, 'eno-static-services.conf'))
    copyFileSync(join(ROOT, 'infra/vn-node/nginx/static-common.conf'), join(dir, 'eno-static-common.conf'))
  }
  const check = () => {
    try {
      execFileSync('bash', [join(ROOT, 'infra/vn-node/nginx/check-static-boundary.sh'), join(ROOT, 'infra/vn-node/nginx/eno.conf'), dir], { encoding: 'utf8' })
      return 0
    } catch { return 1 }
  }

  it('the repo config passes the boundary check', () => { stage(); expect(check()).toBe(0) })

  it('a crossed snippet fails it', () => {
    stage()
    writeFileSync(join(dir, 'eno-static-marketplace.conf'), read('infra/vn-node/nginx/static-marketplace.conf').replace(/3001/g, '3002'))
    expect(check()).toBe(1)
  })

  it('every app location / tags its responses eno-public, and /_next/image is tagged eno-img', () => {
    const conf = read('infra/vn-node/nginx/eno.conf')
    const appLocations = conf.match(/location \/ \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:300[12];[\s\S]*?\n {2}\}/g) ?? []
    expect(appLocations).toHaveLength(4)
    for (const l of appLocations) expect(l).toContain('add_header Cache-Tag "eno-public" always;')
    for (const ed of ['marketplace', 'services']) {
      expect(read(`infra/vn-node/nginx/static-${ed}.conf`)).toMatch(/location = \/_next\/image \{[\s\S]*add_header Cache-Tag "eno-img" always;/)
    }
  })
})

describe('the nightly purge — the erasure bound that replaced the per-deploy purge_everything', () => {
  const sh = read('infra/vn-node/eno-edge-nightly-purge.sh')
  it('purges image variants on both zones and the storage host', () => {
    expect(sh).toMatch(/purge "\$VN" '\{"tags":\["eno-img"\]\}'/)
    expect(sh).toMatch(/purge "\$FO" '\{"tags":\["eno-img"\]\}'/)
    expect(sh).toMatch(/purge "\$VN" '\{"hosts":\["sb\.eno\.vn"\]\}'/)
  })
  it('never puts the token in argv', () => {
    expect(sh).toContain('curl -sS --config -')
    expect(sh).not.toMatch(/Authorization: Bearer \$/)
  })
  it('runs every night and catches up after downtime', () => {
    const timer = read('infra/vn-node/eno-edge-nightly-purge.timer')
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* 04:10:00$/m)
    expect(timer).toMatch(/^Persistent=true$/m)
    expect(deploy).toContain('systemctl enable --now eno-edge-nightly-purge.timer')
  })
})
