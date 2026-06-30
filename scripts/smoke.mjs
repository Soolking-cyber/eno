#!/usr/bin/env node
// ── Smoke / health / perf-budget probe ────────────────────────────────────────────
// Confirms a deployed eno.vn is alive and well-formed: every critical route answers with
// the right status (no 5xx), under a latency budget; the machine-readable artifacts
// (sitemap, manifest, OpenAPI) parse; a bogus path 404s (no catch-all leaking 200); and the
// baseline security headers are present. NON-DESTRUCTIVE (GET only).
//
//   node scripts/smoke.mjs [baseUrl]      # default https://eno.vn  (or PROBE_BASE)
// Exits non-zero on any failure.
const BASE = (process.argv[2] || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS || 4000)
let pass = 0, fail = 0, warn = 0
const lines = []
const ok = (n, c, d = '') => { lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); c ? pass++ : fail++ }
const warnIf = (n, c, d = '') => { if (c) { lines.push(`WARN  ${n}${d ? `  — ${d}` : ''}`); warn++ } }

async function timed(path, init) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}${path}`, init).catch((e) => ({ status: 0, _err: String(e), headers: new Map() }))
  return { r, ms: Date.now() - t0 }
}

async function main() {
  console.log(`# smoke → ${BASE}  (budget ${BUDGET_MS}ms)\n`)

  // 1. Public pages must 200 and render within budget.
  const PAGES = ['/', '/trust', '/privacy', '/terms', '/guide', '/help', '/safety', '/developers', '/signin', '/saved', '/brands']
  for (const p of PAGES) {
    const { r, ms } = await timed(p)
    ok(`page ${p} → 200`, r.status === 200, `${r.status}${r._err ? ' ' + r._err : ''} · ${ms}ms`)
    warnIf(`page ${p} slow`, r.status === 200 && ms > BUDGET_MS, `${ms}ms > ${BUDGET_MS}ms`)
  }

  // 2. Category + a sample listing resolve (content routes, not just static pages).
  {
    const cat = await timed('/c/electronics')
    ok('category /c/electronics → 200', cat.r.status === 200, `${cat.r.status} · ${cat.ms}ms`)
  }

  // 3. Machine artifacts parse.
  {
    const { r } = await timed('/sitemap.xml')
    const body = r.status === 200 ? await r.text() : ''
    ok('/sitemap.xml → 200 + <urlset>', r.status === 200 && /<urlset[\s>]/.test(body) && /<loc>/.test(body))

    const man = await timed('/manifest.webmanifest')
    let mj = null; try { mj = JSON.parse(await man.r.text()) } catch { /* */ }
    ok('/manifest.webmanifest → valid JSON with name+icons', man.r.status === 200 && !!mj?.name && Array.isArray(mj?.icons) && mj.icons.length > 0)

    const api = await timed('/api/v1/openapi.json')
    let oj = null; try { oj = JSON.parse(await api.r.text()) } catch { /* */ }
    ok('/api/v1/openapi.json → valid spec with paths', api.r.status === 200 && !!oj?.paths && !!oj.paths['/oauth/token'])

    const robots = await timed('/robots.txt')
    ok('/robots.txt → 200', robots.r.status === 200, `${robots.r.status}`)
  }

  // 4. A bogus path must 404 (no catch-all silently 200-ing).
  {
    const { r } = await timed('/this-page-does-not-exist-xyz-123')
    ok('unknown path → 404 (no catch-all 200)', r.status === 404, `${r.status}`)
  }

  // 5. No route in the set returned a 5xx.
  // (covered above; an explicit guard for clarity)
  ok('no 5xx across probed routes', !lines.some((l) => /FAIL/.test(l) && / 5\d\d/.test(l)))

  // 6. Baseline security headers on the shell.
  {
    const { r } = await timed('/')
    const h = r.headers
    const get = (k) => (h.get ? h.get(k) : '') || ''
    ok('headers: CSP present', !!get('content-security-policy'))
    ok('headers: nosniff', get('x-content-type-options').includes('nosniff'))
    ok('headers: clickjacking guard', !!get('x-frame-options') || /frame-ancestors/.test(get('content-security-policy')))
    ok('headers: HSTS', !!get('strict-transport-security'))
  }

  console.log(lines.join('\n'))
  console.log(`\n${pass}/${pass + fail} passed` + (warn ? ` · ${warn} warn` : '') + (fail ? `  (${fail} FAILED)` : '  — all green'))
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('smoke crashed:', e); process.exit(1) })
