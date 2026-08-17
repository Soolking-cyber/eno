#!/usr/bin/env node
// ── Local production preview, one edition at a time ─────────────────────────────────
//
// Builds an edition exactly the way Cloud Build does and serves it locally, so a change
// can be reviewed and probed WITHOUT deploying. Once eno.vn is launched, prod stops being
// a place to test — this is the replacement.
//
//   node scripts/preview.mjs vn          # marketplace edition → http://localhost:3000
//   node scripts/preview.mjs forum       # services edition    → http://localhost:3101
//   node scripts/preview.mjs vn --serve  # skip the build, serve what is already in .next
//
// ⚠️ WAIT FOR THE `── serving` LINE, NEVER FOR THE PORT TO ANSWER 200. The port is freed
// before the build, so a 200 during those minutes can only be something else — and once the
// build finishes there is nothing else left. "It answers" is not "it is mine".
//
// ⚠️ THE MARKETPLACE PREVIEW IS ON :3000, AND IT TAKES THE PORT BY FORCE (owner, 2026-08-17:
// "kill 3000 and 3100 use only 3000 from now on"). It used to sit on :3100 to dodge an
// unrelated next-server that had squatted :3000 — but that workaround cost more than it
// saved: it left TWO ports to reason about, and on 2026-08-17 a THREE-DAY-OLD next-server
// on :3000 served stale code that read as a live bug for several minutes, while a bare
// `npx playwright test` pointed at neither and silently ran against production.
// ONE port, and this script frees it before binding, so "what is on :3000" always has
// exactly one answer: the last thing you previewed.
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
import { freePort, listening } from './free-port.mjs'

const ROOT = process.cwd()

// ⚠️ NEXT_PUBLIC_APP_URL MUST BE THE PRODUCTION URL, EVEN LOCALLY. next.config.ts refuses to
// build when the host disagrees with the edition (it is the guard that stops eno.forum being
// branded as the licensed marketplace), and it checks the HOST — a localhost value fails the
// build. The consequence is deliberate and worth knowing: canonicals, OG urls and the sitemap
// in this preview point at the real domain. That is correct for reviewing THE ARTIFACT; it
// means you cannot click an OG link and stay local.
const EDITIONS = {
  vn:    { edition: 'marketplace', url: 'https://eno.vn',        port: 3000, label: 'eno.vn (marketplace)' },
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
  // ⛔ MIRRORS cloudbuild.yaml, AND WITHOUT IT THIS PREVIEW IS NOT THE ARTIFACT. Cloud Build
  // appends MARKETPLACE_HOSTS_SERVICES=true to the marketplace build (armed 2026-08-14) — it
  // admits eno.vn to the PARTNER's visa chat, the `.svc.` routes, while payments and eno's own
  // e-visa keep the stricter `.forum.svc.` infix that no marketplace build lists. It is read by
  // next.config.ts to pick `pageExtensions`, so it decides which routes EXIST; there is no
  // runtime equivalent.
  // ⚠️ Its absence here made the local guest suite fail 45 specs that pass against production —
  // `/api/trips/*` and `/api/visa/*` answered 404 locally and 401 on prod, because locally those
  // routes were never compiled. That reads as "the app is broken", and it is really "the preview
  // built a different edition than the one that ships". The forum edition needs nothing: its
  // extension list already includes both tiers.
  // ⚠️ KEEP THE TWO IN STEP. If cloudbuild.yaml ever turns this off, turn it off here in the same
  // commit — a preview that is MORE permissive than production is the worse direction, because a
  // leak would pass locally and only appear once deployed.
  ...(cfg.edition === 'marketplace' ? { MARKETPLACE_HOSTS_SERVICES: 'true' } : {}),
  NODE_ENV: 'production',
  // ⚠️ THE ONE THING THAT MAKES SIGN-IN USABLE LOCALLY, and it is set HERE and nowhere else.
  // Auth pins its return host to NEXT_PUBLIC_APP_URL (a real security control — see
  // src/lib/auth-origin.ts), and the only escape hatch used to be NODE_ENV==='development'. This
  // is a production build on purpose, so without the flag every sign-in on :3100 redirected to
  // https://eno.vn — and worse, the magic link we MINT pointed there too, so clicking it from a
  // local sign-in would have completed the login on PRODUCTION.
  // Cloud Build's env comes from Secret Manager, which does not contain this key, so a deployed
  // artifact has it absent and the hatch folds shut. The server side additionally requires a
  // loopback request host.
  NEXT_PUBLIC_LOCAL_AUTH: '1',
  LOCAL_AUTH: '1',
}

// ⚠️ FREE THE PORT BEFORE THE BUILD, NOT BEFORE THE BIND. A clean build takes minutes, and a
// stale server answers 200 for every one of them — so anything waiting for :3000 to "answer"
// latches onto the OLD process, runs against it, and then dies when the new server binds.
// Freeing here also stops a live `next dev` writing into the `.next` we are about to wipe.
// See scripts/free-port.mjs: it aborts rather than continuing if the port cannot be taken.
freePort(cfg.port)

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

// A SAFETY NET, NOT THE MAIN MECHANISM — `npm run build` already appends this same copy
// (`cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`), and the
// Dockerfile does the equivalent in two COPY lines. It matters because `next build` emits a
// self-contained .next/standalone/server.js that deliberately does NOT include either, and
// server.js resolves both relative to ITS OWN directory — so a standalone server started
// after a bare `next build` serves HTML with no CSS, no JS and no images, which looks like a
// broken change rather than a missing copy. Repeating it here costs milliseconds and covers
// `--serve` against a tree built some other way.
cpSync(join(ROOT, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true })
cpSync(join(ROOT, 'public'), join(standalone, 'public'), { recursive: true })

// ⚠️ FREE IT AGAIN, IMMEDIATELY BEFORE THE BIND. The first free ran minutes ago, before the
// build, and the port was unguarded the whole time — a `dev:vn` started in another terminal
// during the build finds nothing to kill and takes :3000 quite legitimately. Without this
// second pass our own server would lose the bind, exit, and leave the DEV server answering on
// the port a suite is about to trust. Freeing twice is the price of not reserving a socket.
freePort(cfg.port)

const srv = spawn('node', [join(standalone, 'server.js')], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...env, PORT: String(cfg.port), HOSTNAME: '0.0.0.0' },
})
const stop = () => { srv.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
srv.on('exit', (code) => process.exit(code ?? 0))
// ⚠️ NEVER LEAVE AN OWNERLESS SERVER HOLDING THE PORT. Several paths below can end this
// process without going through `stop` — the readiness check's own `process.exit(1)`, and
// `listeners()` aborting if lsof breaks. Without this hook the child survives its parent,
// keeps :3000, and answers 200 with no marker ever printed: an anonymous server, which is
// the precise condition this whole commit exists to make impossible.
process.on('exit', () => { try { srv.kill('SIGKILL') } catch { /* already gone */ } })

// ⛔ `── serving` IS THE HANDSHAKE EVERY CALLER WAITS ON, SO IT MUST NOT BE A GUESS.
// It used to print just before `spawn`, i.e. before anything was listening — which made the
// two e2e skills release their suite at the moment the server was least ready, and, worse,
// would have announced success even if OUR server had lost the bind and some other process
// were answering. It is now emitted only after this child is confirmed to be both ALIVE and
// LISTENING. Nothing downstream should poll the port itself; that cannot tell whose it is.
const settled = await (async () => {
  for (let i = 0; i < 120; i++) {
    if (srv.exitCode !== null) return false
    if (listening(cfg.port).includes(String(srv.pid))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
})()

if (!settled) {
  console.error(`\n\x1b[31m✗ the preview server never took :${cfg.port} — not printing the ready marker.\x1b[0m`)
  srv.kill('SIGTERM')
  process.exit(1)
}

console.log(`\n\x1b[1m── serving ${cfg.label} → http://localhost:${cfg.port}\x1b[0m`)
console.log(`   verify:  npm run verify:local -- http://localhost:${cfg.port}`)
console.log(`   e2e:     E2E_BASE=http://localhost:${cfg.port} npm run e2e:guest\n`)
