// ── Take a TCP port by force, or refuse to continue ──────────────────────────────────
//
// Owner, 2026-08-17: "kill 3000 and 3100 use only 3000 from now on". One port only works
// if claiming it is guaranteed, so this is the guarantee.
//
// ⚠️ A SERVER THAT LOSES THE BIND DOES NOT FAIL LOUDLY — IT LOSES SILENTLY AND THE
// INCUMBENT KEEPS SERVING. Node prints EADDRINUSE and exits; `next dev` is worse, it
// quietly moves to the NEXT port and tells you in one line you will not read. Either way
// the URL still answers 200 with whatever code the old process was started with, which is
// indistinguishable from "my change did nothing". On 2026-08-17 a three-day-old server on
// :3000 cost real time exactly that way.
//
// ⚠️ CALL THIS BEFORE THE BUILD, NOT BEFORE THE BIND. Two reviewers caught the first
// version of this doing it last, and they were right: a preview takes minutes to build,
// and for every one of those minutes the stale server is still answering 200 — so anything
// that "waits for the port to answer" (both e2e skills did) latches onto the OLD server,
// runs a whole suite against it, and then gets killed mid-run when the new one binds. The
// window has to be closed before it opens, and freeing early also stops a live `next dev`
// writing into the `.next` directory a preview is about to wipe.
import { spawnSync } from 'node:child_process'

// ⚠️ AN `lsof` THAT NEVER RAN LOOKS EXACTLY LIKE A FREE PORT. spawnSync sets `.error` when the
// binary is missing (a slim CI image, a stripped container) and leaves stdout null, which falls
// through `|| ''` to an empty list and reports "already free" — the precise fail-open this file
// exists to remove, one level down. Exit code 1 with no output is NORMAL for lsof and means
// "nothing matched"; anything above that is a real failure and must not be read as emptiness.
const listeners = (port) => {
  const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (r.error || (r.status ?? 0) > 1) {
    console.error(`\n\x1b[31m✗ cannot check :${port} — lsof failed (${r.error?.message || `exit ${r.status}`}).\x1b[0m`)
    console.error('  Refusing to guess the port is free; a stale server here silently serves old code.')
    process.exit(1)
  }
  return (r.stdout || '').trim().split('\n').filter(Boolean)
}

// ⚠️ ONLY EVER KILL A NODE PROCESS. `kill -9` on whatever happens to hold :3000 is far too big
// a hammer for a dev script: on macOS a Docker container publishing the port shows up as
// `com.docker.backend`, so this would take Docker Desktop and every container with it. Anything
// that is not node/next is reported and refused rather than killed — the owner can decide.
// ⚠️ MATCH THE BASENAME EXACTLY, AND TREAT A VANISHED PID AS GONE. A substring/word-boundary
// test over the whole path is wrong in BOTH directions: `/opt/node-tools/bin/redis-server`
// contains a path segment starting with "node" and would have been SIGKILLed as "ours", while a
// process that exits between `lsof` and `ps` yields an empty comm and would have been reported
// as a foreign holder — a RED that is really just a race.
const OURS = new Set(['node', 'next', 'next-server', 'npm'])
const isOurs = (pid) => {
  const comm = (spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout || '').trim()
  if (!comm) return true // already gone; nothing to refuse
  const base = comm.split('/').pop().split(' ')[0]
  return OURS.has(base)
}

/**
 * Kill whatever is LISTENing on `port` (TERM, then KILL), then prove it worked.
 * Exits the process with status 1 rather than returning if the port cannot be freed —
 * continuing would hand the caller a silent false-green, which is the whole failure
 * mode this file exists to remove.
 */
export function freePort(port) {
  const held = listeners(port)
  if (!held.length) return false
  const foreign = held.filter((pid) => !isOurs(pid))
  if (foreign.length) {
    console.error(`\n\x1b[31m✗ :${port} is held by a NON-node process (${foreign.join(', ')}) — refusing to kill it.\x1b[0m`)
    console.error(`  Inspect with:  lsof -nP -iTCP:${port} -sTCP:LISTEN`)
    process.exit(1)
  }
  console.log(`── freeing :${port} — killing ${held.join(', ')}`)
  spawnSync('kill', held)
  spawnSync('sleep', ['1'])
  // ⚠️ RE-CHECK OWNERSHIP BEFORE ESCALATING. The TERM above takes a second to land, and the
  // port can be grabbed by something else in that window — sending SIGKILL to whatever `lsof`
  // reports NOW, on the strength of a check made a second ago, is how a dev script kills a
  // process nobody asked it to touch.
  const stubborn = listeners(port).filter(isOurs)
  if (stubborn.length) {
    spawnSync('kill', ['-9', ...stubborn])
    spawnSync('sleep', ['1'])
  }
  // ⚠️ RECHECK AND ABORT. Printing "freeing" and carrying on is not the same as having
  // freed it — a process we lack permission to signal survives both kills, and the caller
  // would then serve/test against it while believing the port was theirs.
  const survivors = listeners(port)
  if (survivors.length) {
    console.error(`\n\x1b[31m✗ :${port} is still held by ${survivors.join(', ')} — refusing to continue.\x1b[0m`)
    console.error(`  Inspect with:  lsof -nP -iTCP:${port} -sTCP:LISTEN`)
    process.exit(1)
  }
  return true
}

/** The PIDs currently LISTENing on `port` — used to prove a server we spawned actually took it. */
export function listening(port) {
  return listeners(port)
}

// Usable directly: `node scripts/free-port.mjs 3000`
if (process.argv[1] && process.argv[1].endsWith('free-port.mjs')) {
  const port = Number(process.argv[2])
  if (!Number.isInteger(port)) { console.error('usage: node scripts/free-port.mjs <port>'); process.exit(1) }
  if (!freePort(port)) console.log(`── :${port} was already free`)
}
