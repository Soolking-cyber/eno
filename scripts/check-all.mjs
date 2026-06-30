#!/usr/bin/env node
// ── Full verification runner ────────────────────────────────────────────────────────
// Runs the whole test suite in dependency order and aggregates the result:
//   1. unit         — vitest (pure logic; offline, deterministic)
//   2. typecheck    — tsc --noEmit
//   3. live probes  — smoke · seo-check · content-integrity · sec-probe (against a deploy)
// Unit + typecheck always run. The live probes run against `[baseUrl]` (default the prod
// site, or PROBE_BASE) and are skipped with --offline when no deploy is reachable.
//
//   node scripts/check-all.mjs                     # unit + typecheck + probes vs https://eno.vn
//   node scripts/check-all.mjs http://localhost:3000
//   node scripts/check-all.mjs --offline           # unit + typecheck only
// Exits non-zero if any step fails.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const offline = args.includes('--offline')
const BASE = (args.find((a) => !a.startsWith('--')) || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')

const run = (label, cmd, cmdArgs) => {
  console.log(`\n\x1b[1m── ${label} ─────────────────────────────────────────\x1b[0m`)
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', encoding: 'utf8' })
  const okStep = r.status === 0
  console.log(okStep ? `\x1b[32m✓ ${label}\x1b[0m` : `\x1b[31m✗ ${label} (exit ${r.status})\x1b[0m`)
  return { label, ok: okStep }
}

const steps = []
steps.push(run('unit (vitest)', 'npx', ['vitest', 'run']))
steps.push(run('typecheck (tsc)', 'npx', ['tsc', '--noEmit']))
if (!offline) {
  for (const s of ['smoke', 'seo-check', 'content-integrity', 'sec-probe']) {
    steps.push(run(`live: ${s} @ ${BASE}`, 'node', [`scripts/${s}.mjs`, BASE]))
  }
} else {
  console.log('\n(skipping live probes — --offline)')
}

const failed = steps.filter((s) => !s.ok)
console.log('\n\x1b[1m══ summary ══════════════════════════════════════════\x1b[0m')
for (const s of steps) console.log(`  ${s.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${s.label}`)
console.log(failed.length ? `\n\x1b[31m${failed.length}/${steps.length} step(s) FAILED\x1b[0m` : `\n\x1b[32mall ${steps.length} steps passed\x1b[0m`)
process.exit(failed.length ? 1 : 0)
