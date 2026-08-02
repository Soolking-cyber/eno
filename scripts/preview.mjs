#!/usr/bin/env node
// ── Local production preview, one edition at a time ─────────────────────────────────
//
// Builds an edition exactly the way Cloud Build does and serves it locally, so a change
// can be reviewed and probed WITHOUT deploying. Once eno.vn is launched, prod stops being
// a place to test — this is the replacement.
//
//   node scripts/preview.mjs vn          # marketplace edition → http://localhost:3100
//   node scripts/preview.mjs forum       # services edition    → http://localhost:3101
//   node scripts/preview.mjs vn --serve  # skip the build, serve what is already in .next
//
// ⚠️ WHY A PRODUCTION BUILD AND NOT `next dev`. Three classes of bug in this repo are
// invisible in dev and have each reached prod: prerendered HTML (the home page is ISR and
// bakes listing data at build time), the inlined NEXT_PUBLIC_* values every canonical and
// OG url derives from, and edition exclusion — `.svc.` routes only disappear because
// `next build` resolves pageExtensions. `next dev` also serves assets from memory, so it
// cannot show the asset-copy problem this script exists to solve. Use `npm run dev` for
// fast iteration; use THIS before saying something is ready to deploy.
//
// ⚠️ ONE EDITION AT A TIME, BY CONSTRUCTION. Both editions build into the same `.next`
// directory, so building the second overwrites the first — there is no way to serve both
// from one tree, and pretending otherwise would silently show you the wrong artifact.
// Run this twice, sequentially, when a change touches both.
import { spawnSync, spawn } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

// ⚠️ NEXT_PUBLIC_APP_URL MUST BE THE PRODUCTION URL, EVEN LOCALLY. next.config.ts refuses to
// build when the host disagrees with the edition (it is the guard that stops eno.forum being
// branded as the licensed marketplace), and it checks the HOST — a localhost value fails the
// build. The consequence is deliberate and worth knowing: canonicals, OG urls and the sitemap
// in this preview point at the real domain. That is correct for reviewing THE ARTIFACT; it
// means you cannot click an OG link and stay local.
const EDITIONS = {
  vn:    { edition: 'marketplace', url: 'https://eno.vn',        port: 3100, label: 'eno.vn (marketplace)' },
  forum: { edition: 'services',    url: 'https://www.eno.forum', port: 3101, label: 'eno.forum (services)' },
}

const [which, ...flags] = process.argv.slice(2)
const cfg = EDITIONS[which]
if (!cfg) {
  console.error(`usage: node scripts/preview.mjs <vn|forum> [--serve]\n  vn    → ${EDITIONS.vn.label} on :${EDITIONS.vn.port}\n  forum → ${EDITIONS.forum.label} on :${EDITIONS.forum.port}`)
  process.exit(1)
}
const serveOnly = flags.includes('--serve')

const env = {
  ...process.env,
  NEXT_PUBLIC_ENO_EDITION: cfg.edition,
  NEXT_PUBLIC_APP_URL: cfg.url,
  NODE_ENV: 'production',
}

if (!serveOnly) {
  // ⚠️ WIPE .next FIRST. The two editions differ by which files were COMPILED, so a stale
  // chunk from the other edition survives an incremental build and can leave visa/itinerary
  // strings in a marketplace artifact — the exact leak class edition-lint and the `.svc.`
  // convention exist to prevent, and the one that a `grep .next/static` check is meant to
  // catch. A clean build is the only honest one here.
  console.log(`\n\x1b[1m── clean build: ${cfg.label} ─────────────────────\x1b[0m`)
  rmSync(join(ROOT, '.next'), { recursive: true, force: true })
  const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env, cwd: ROOT })
  if (b.status !== 0) { console.error(`\n\x1b[31m✗ build failed (exit ${b.status})\x1b[0m`); process.exit(b.status ?? 1) }
}

const standalone = join(ROOT, '.next', 'standalone')
if (!existsSync(standalone)) {
  console.error('\n\x1b[31m✗ no .next/standalone — run without --serve to build first\x1b[0m')
  process.exit(1)
}

// ⚠️ THE COPY THE Dockerfile DOES, REPRODUCED — WITHOUT IT EVERY ASSET 404s AND THE PAGE
// LOOKS BROKEN FOR A REASON THAT HAS NOTHING TO DO WITH YOUR CHANGE. `next build` emits a
// self-contained server at .next/standalone/server.js but deliberately does NOT copy
// .next/static or public/ into it; the Dockerfile does that in two COPY lines (see
// Dockerfile: `COPY .next/static ./.next/static` and `COPY public ./public`). server.js
// resolves both relative to ITS OWN directory, so `npm run start` from the repo root serves
// HTML with no CSS, no JS and no images. That is why `npm run start` alone was never a
// usable preview.
cpSync(join(ROOT, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true })
cpSync(join(ROOT, 'public'), join(standalone, 'public'), { recursive: true })

console.log(`\n\x1b[1m── serving ${cfg.label} → http://localhost:${cfg.port}\x1b[0m`)
console.log(`   verify:  npm run verify:local -- http://localhost:${cfg.port}`)
console.log(`   e2e:     E2E_BASE=http://localhost:${cfg.port} npm run e2e:guest\n`)

const srv = spawn('node', [join(standalone, 'server.js')], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...env, PORT: String(cfg.port), HOSTNAME: '0.0.0.0' },
})
const stop = () => { srv.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
srv.on('exit', (code) => process.exit(code ?? 0))
