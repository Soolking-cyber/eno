/**
 * The Gemini product pass: placement + one clean description layout per imported listing.
 *
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir>
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir> --batch 20 --workers 3
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir> --engine opus   # agy known to be out of quota
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir> --engine opus --no-agy   # Opus ONLY, never hand back to agy
 *
 * Owner, 2026-09-13: "give the box agy gemini flash 3.8 flash let it sort all product descriptions properly
 * and revisit taxonomy across the app". The owner chose to run the model HERE (their agy subscription stays
 * on this Mac) and apply on the box: scripts/export-enrich-scope.ts → this → scripts/apply-listing-enrichment.ts.
 *
 * ⛔ FILE IN, FILES OUT, NO DATABASE — the same split as retranslate-titles-gemini.ts, for the same reason: a
 * pass measured in days must not hold an SSH tunnel open.
 * ⛔ THE MODEL DECIDES NOTHING ON ITS OWN. The output holds the raw answers; decideEnrichment() is applied where
 * they are used (the apply step re-gates every row against the live database).
 * ⚠️ APPEND-ONLY PART FILES, NOT ONE JSON DOCUMENT. At ~5 KB a row the full catalogue is ~400 MB — one
 * JSON.stringify of that approaches V8's string limit and a re-read would fail (opus). Each batch is appended to
 * `part-NNNN.jsonl` (2,000 rows a part) and fsynced; resume and apply read line by line; the sync to the box
 * copies only parts that changed.
 * ⚠️ ONE SCOPE PER DIRECTORY. `scope.sha` pins the export the directory belongs to; a different export refuses to
 * start rather than mixing another run's rows into the apply (codex, astra).
 * ⚠️ RESUMABLE: keyed by id + snapshot + prompt version, so a changed row or a new prompt is asked again.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEnrichPrompt, decideEnrichment, ENRICH_VERSION, inputFromSnapshot, parseEnrichReply } from '../src/lib/listing-enrich'
import { readParts, readScope, type DoneRow, type ScopeRow } from './enrich-files'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const int = (name: string, dflt: number, min: number, max: number) => {
  const n = Number(arg(name) ?? dflt)
  if (!Number.isInteger(n) || n < min || n > max) { console.error(`--${name} must be an integer ${min}..${max}`); process.exit(1) }
  return n
}
const IN = arg('in')
const OUT = arg('out')
const BATCH = int('batch', 20, 1, 40)
const WORKERS = int('workers', 2, 1, 10) // owner, 2026-09-14: "MAKE IT 10 WORKERS"
const PART_ROWS = 2000
const ENGINE = arg('engine') ?? 'agy'
if (!IN || !OUT) { console.error('--in <scope.jsonl> --out <dir> required'); process.exit(1) }
if (ENGINE !== 'agy' && ENGINE !== 'opus') { console.error('--engine must be agy or opus'); process.exit(1) }
/**
 * ⛔ `--no-agy` MAKES `--engine opus` A PIN, AND WITHOUT IT THE FLAG IS ONLY A STARTING PREFERENCE.
 * Owner, 2026-09-17: "force opus agy doesnt have much usage left". `--engine opus` on its own parks agy
 * for AGY_RECHECK_MS and hands the batches straight back the moment a probe answers — measured in this
 * run's own log at 13:58, "agy answers again — batches go back to agy", 9 minutes after a start that
 * was explicitly Opus-only. That is the documented design and it is right when the two engines are
 * interchangeable; it is wrong when the owner is rationing one of them.
 * ⚠️ IT REMOVES THE SAFETY NET ON PURPOSE. With no agy to fall back to, an Opus outage sends every
 * worker into the shared wait and the run self-stops after MAX_SILENCE_MS instead of quietly finishing
 * on the engine the owner excluded. Stopping loudly is the behaviour being asked for here.
 */
const NO_AGY = process.argv.includes('--no-agy')
if (NO_AGY && ENGINE !== 'opus') { console.error('--no-agy requires --engine opus'); process.exit(1) }

const EMPTY_CWD = mkdtempSync(join(tmpdir(), 'eno-enrich-'))
process.on('exit', () => { try { rmSync(EMPTY_CWD, { recursive: true, force: true }) } catch { /* best effort */ } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const keyOf = (r: ScopeRow) => createHash('sha256').update(JSON.stringify([r.id, r.snap, ENRICH_VERSION])).digest('hex').slice(0, 24)

type Engine = 'agy' | 'opus'

/**
 * One model call. agy: argv array (merchant text is never shell-interpolated), --sandbox, empty cwd — see
 * retranslate-titles-gemini.ts. opus: the prompt goes on STDIN, and the session gets NO TOOLS, NO MCP SERVERS (the
 * user config carries a database MCP), no settings/hooks and no skills — merchant text is untrusted input to a model
 * that must only answer. Measured 2026-09-14 on claude 2.1.270 with exactly these flags: asked to list every tool it can
 * call, it answered that it has none; asked whether its context mentions the user's CLAUDE.md content, it answered NO.
 * `--disallowedTools` names the built-ins as well, so an empty `--tools` read as "defaults" would still expose none.
 */
const children = new Set<ChildProcess>()
// A stop (exit 3) or a crash must not leave up to ten model calls running, spending tokens on answers nobody reads (opus).
// ⚠️ THE PROCESS GROUP, NOT THE PROCESS (astra): each call is spawned `detached`, so it leads its own group and
// `kill(-pid)` reaches helpers it started — agy runs a language server, and after a plain kill on 2026-09-14 agy
// processes were found re-parented to pid 1, still running. The same pattern as scripts/second-opinion.mjs.
const killTree = (c: ChildProcess) => { try { if (c.pid) process.kill(-c.pid, 'SIGKILL') } catch { try { c.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', () => { for (const c of children) killTree(c) })
// Node skips 'exit' on an unhandled SIGINT/SIGTERM, so route them through it (codex, astra, opus).
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
// SIGHUP ONLY FROM A TERMINAL. The calls are `detached`, so a closed terminal no longer reaches them — the runner
// must reap them itself (opus). But under nohup (how this runs: output redirected) the hangup is deliberately
// ignored, and a handler would turn it back into a stop; a TTY on stdout is what tells the two apart.
if (process.stdout.isTTY) process.on('SIGHUP', () => process.exit(129))
function ask(engine: Engine, prompt: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const p = engine === 'agy'
      ? spawn('agy', ['-p', prompt, '--model', 'Gemini 3.8 Flash (High)', '--sandbox', '--print-timeout', `${Math.round(timeoutMs / 1000)}s`],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: EMPTY_CWD, detached: true })
      : spawn('claude', ['-p', '--model', 'claude-opus-5', '--effort', 'high', '--tools', '', '--strict-mcp-config', '--setting-sources', '',
        // Every built-in claude 2.1.270 recognises (an unknown name prints a "matches no known tool" warning; these did not).
        '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,Agent,NotebookEdit,TodoWrite,Skill,LSP,BashOutput,KillShell,Monitor,ToolSearch,Workflow,Artifact,SendMessage,AskUserQuestion,CronCreate,EnterWorktree,PushNotification,RemoteTrigger,TaskOutput,TaskStop,SendUserFile,ScheduleWakeup',
        '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'You catalogue products for a marketplace. Answer only with the reply format the message asks for.'],
      // ⚠️ DISABLE_AUTOUPDATER: the flags were measured on ONE version; a run lasts hours and `claude` updates itself in
      // the background, so a mid-run version must not change what `--tools ''` means under a live batch (opus).
      { stdio: ['pipe', 'pipe', 'pipe'], cwd: EMPTY_CWD, detached: true, env: { ...process.env, DISABLE_AUTOUPDATER: '1' } })
    children.add(p)
    // Reap the GROUP when the call ends too, not only on stop (astra): a CLI can exit and leave a helper it started.
    p.on('close', () => { killTree(p); children.delete(p) })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(p); console.error(`  ${engine}: no reply in ${Math.round(timeoutMs / 1000) + 30}s — killed`); resolve(null) }, timeoutMs + 30_000)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.stdin?.on('error', () => { /* a child that died early closes stdin; the close handler reports it */ })
    p.stdin?.end(prompt)
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return // already reported and resolved; its close is not a second failure (opus)
      if (code !== 0 || !out.trim()) { console.error(`  ${engine}: ${(err || out).trim().slice(0, 160) || `exit ${code}`}`); resolve(null); return }
      resolve(out)
    })
  })
}

const clock = () => new Date().toTimeString().slice(0, 5)

/** The last non-empty line of a reply, bare and upper-cased. */
const lastLine = (reply: string | null) => ((reply ?? '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '').replace(/[.!*`"']/g, '').toUpperCase()

/**
 * A one-word call: does this engine answer at all? The LAST line must be exactly OK — "NOT OK" or a quota notice is not
 * (codex). ONE probe per engine at a time, shared by every worker that asks, so ten workers failing together cost one
 * probe rather than ten (opus).
 */
const probes: Partial<Record<Engine, Promise<boolean>>> = {}
function answers(engine: Engine): Promise<boolean> {
  return probes[engine] ??= ask(engine, 'Reply with the single word OK.', 90_000)
    .then((reply) => lastLine(reply) === 'OK')
    .finally(() => { delete probes[engine] })
}

/**
 * ⚠️ ISOLATION IS CHECKED AT START, NOT ASSUMED. The Opus flags were measured on one CLI version; a `claude` that reads
 * them differently would hand tools to a model reading merchant text (codex: prove it fails closed). The model is asked
 * to name its tools, and anything but NONE turns the fallback off. A self-report is a tripwire, not a sandbox — the
 * flags are the control.
 */
async function opusIsolated(): Promise<boolean> {
  // The WHOLE reply must be NONE: "Bash\nRead\nNONE" names tools and fails (codex, astra).
  const reply = await ask('opus', 'List every tool you can call, by exact name, one per line. If you cannot call any tool, reply with the single word NONE.', 90_000)
  return (reply ?? '').replace(/[.!*`"'\s]/g, '').toUpperCase() === 'NONE'
}
/** The ONLY way Opus is (re-)enabled: it answers AND passes the isolation check — never a bare OK (codex, astra, opus). */
async function opusReady(): Promise<boolean> {
  const ok = await answers('opus') && await opusIsolated()
  if (ok) isolationCheckedAt = Date.now()
  return ok
}

// ⚠️ A SPENT QUOTA LOOKS LIKE A SLOW BATCH. Measured 2026-09-14: after ~1,000 rows agy's subscription answered
// `429 Individual quota reached … Resets in 3h43m`, which agy retries INTERNALLY until the print timeout and never
// prints — the runner saw only 8-minute timeouts, halved every batch down to single rows (39 calls of 8 minutes for
// one batch of 20) and gave up on 68 rows in 85 minutes. So a failed call is probed first: an engine that is out moves
// or waits the batch, and only failures while the engine answers count against the batch (runBatch).
// Owner, 2026-09-14: "IF AGY REACHED QUOTA DO WITH OPUS 5 ON HIGH". When agy does not answer, batches go to Opus 5
// (high effort) for 30 minutes; then ONE shared probe decides whether agy is back. If Opus does not answer either,
// every worker joins one shared wait.
const AGY_RECHECK_MS = 30 * 60_000
// `--engine opus` starts on Opus when agy is already known to be out — otherwise every worker first spends one batch
// timeout (8 minutes) finding that out.
let agyDownUntil = ENGINE === 'opus' ? Date.now() + AGY_RECHECK_MS : 0
// The isolation check is repeated every 30 minutes while Opus takes batches, not only at start (opus): one shared call.
const ISOLATION_RECHECK_MS = 30 * 60_000
let isolationCheckedAt = 0
let isolationProbe: Promise<boolean> | null = null
async function opusStillIsolated(): Promise<boolean> {
  if (Date.now() - isolationCheckedAt < ISOLATION_RECHECK_MS) return true
  isolationProbe ??= opusIsolated().finally(() => { isolationProbe = null })
  const ok = await isolationProbe
  if (ok) isolationCheckedAt = Date.now()
  else if (opusOk) { opusOk = false; console.warn(`  ${clock()} ⚠️  Opus 5 now reports tools — fallback OFF until it passes the check again`) }
  return ok
}
async function pickEngine(): Promise<Engine> {
  /**
   * Pinned: Opus takes every batch.
   *
   * ⛔ THE ISOLATION RESULT IS OBEYED, NOT MERELY AWAITED — all three reviewers caught this
   * independently and they were right. The first version read `await opusStillIsolated(); return
   * 'opus'`, which DISCARDS the boolean: a `claude` that reports tools returns `false` here rather
   * than throwing, so a pinned run would have gone on dispatching listing batches to an
   * un-isolated model. The unpinned branch below has always conditioned on that value; the pin has
   * to as well, or it converts a safety check into a no-op.
   * ⚠️ AND THE ONLY CORRECT ANSWER TO A FAILED CHECK HERE IS TO WAIT. Unpinned, a failed check
   * sends the batch to agy; pinned, there is nowhere to send it, and quietly proceeding is the one
   * outcome the pin exists to prevent. `waitForService()` already carries the backoff, re-probes
   * Opus through `opusReady()` (which is `answers` AND `opusIsolated`), skips agy while NO_AGY is
   * set, and stops the whole run via `stopIfSilent()` after MAX_SILENCE_MS — so this loop is
   * bounded by the same six-hour rule as every other outage and cannot spin.
   */
  if (NO_AGY) {
    while (!(await opusStillIsolated())) await waitForService()
    return 'opus'
  }
  if (!agyDownUntil || !opusOk) return 'agy'
  if (Date.now() < agyDownUntil) return (await opusStillIsolated()) ? 'opus' : 'agy'
  if (await answers('agy')) {
    if (agyDownUntil) console.warn(`  ${clock()} agy answers again — batches go back to agy`)
    agyDownUntil = 0
    return 'agy'
  }
  agyDownUntil = Date.now() + AGY_RECHECK_MS
  return (await opusStillIsolated()) ? 'opus' : 'agy'
}
function agyDown() {
  if (Date.now() < agyDownUntil) return
  agyDownUntil = Date.now() + AGY_RECHECK_MS
  if (opusOk) console.warn(`  ${clock()} agy is not answering (quota or network) — Opus 5 takes the batches until ${new Date(agyDownUntil).toTimeString().slice(0, 5)}`)
}

// Cleared by the startup probe when `claude` does not answer: without it, an agy failure has nowhere to go and is
// classified exactly as before the fallback existed — never parked on an engine that cannot answer (astra).
let opusOk = true

// ⚠️ THE WAIT IS BOUNDED BY THE LAST ANSWER, NOT BY ONE OUTAGE. No batch answered anywhere for 6 hours (agy's quota
// resets inside ~5h) is not a quota — it is a logged-out CLI, a removed binary or a dead network — and the run stops
// with exit 3 (codex, astra). Measured from the last SUCCESS, so an engine that flaps (probe passes, batch fails,
// probe fails, wait…) cannot reset the clock by entering a fresh wait (opus). Answers written are kept; re-run continues.
const MAX_SILENCE_MS = 6 * 60 * 60_000
let lastAnswerAt = Date.now()
/** Checked before every batch call as well as in the wait: a run whose every reply is unusable stops too (astra, opus). */
function stopIfSilent() {
  if (Date.now() - lastAnswerAt <= MAX_SILENCE_MS) return
  console.error(`\n${clock()} STOPPED — no batch has been answered for 6 hours. Answers so far are kept in ${OUT}; re-run to continue.`)
  process.exit(3)
}
let outage: Promise<void> | null = null
function waitForService(): Promise<void> {
  outage ??= (async () => {
    for (let delay = 60_000; ; delay = Math.min(delay * 2, 15 * 60_000)) {
      stopIfSilent()
      console.warn(`  ${clock()} ${NO_AGY ? 'Opus is not' : opusOk ? 'neither agy nor Opus is' : 'agy is not'} answering — asking again in ${delay / 60_000} min`)
      await sleep(delay)
      if (!NO_AGY && await answers('agy')) { agyDownUntil = 0; console.warn(`  ${clock()} agy answers again`); return }
      // A failed check REVOKES the fallback until a later check passes — a stale approval must not survive it (astra).
      opusOk = await opusReady()
      if (opusOk) { agyDown(); return }
    }
  })().finally(() => { outage = null })
  return outage
}

/** Set by main(): appends answers to the part files (synchronous, fsynced). */
let emit: (got: DoneRow[]) => void = () => {}

/**
 * One batch. A failed or unusable reply is first CLASSIFIED by a (shared) one-word call to the same engine:
 * - the engine does not answer → it is OUT, and that is never the batch's fault, whatever the reply said (a quota
 *   notice printed as a reply included — astra): agy with Opus available → the batch goes to Opus
 *   ("IF AGY REACHED QUOTA DO WITH OPUS 5 ON HIGH"); otherwise → the shared wait.
 * - the engine answers → a STRIKE: the batch itself failed. A full batch is asked again on the SAME engine and the
 *   second strike splits it (one transient failure must not split 20 rows); a half already split once splits on its
 *   first strike, so a batch that never parses costs one call per node, as before the fallback (opus). Strikes count
 *   per engine — a failure on agy does not spend Opus's retry (astra). A slow agy batch does not move work to Opus,
 *   because the owner's rule is Opus only when agy is out (opus).
 * - `MAX_FAILS` caps failures while an engine answered, across engines, so alternating agy/Opus cannot reset its way
 *   past the strikes (opus). Calls lost to an outage do NOT count — an outage must not split batches and give up rows,
 *   which is the failure this rewrite exists for (opus); outages are bounded by the 6-hour silence stop instead, and
 *   `MAX_ASKS` is only a generous backstop against a pattern nobody foresaw.
 * A split batch is HALVED and re-asked, never salvaged by position; a single row that still fails is left unanswered
 * (the run ends INCOMPLETE and a re-run asks it again). Answers are written the moment a node succeeds, so a later
 * stop cannot lose a half that already answered (astra).
 */
const MAX_FAILS = 3
const MAX_ASKS = 24
let givenUp = 0
async function runBatch(rows: ScopeRow[], split = false): Promise<void> {
  if (!rows.length) return
  const maxStrikes = split ? 1 : 2
  let strikes = 0
  let fails = 0
  let lastEngine: Engine | null = null
  for (let asks = 1; ; asks++) {
    if (outage) await outage
    stopIfSilent()
    const engine = await pickEngine()
    if (engine !== lastEngine) { strikes = 0; lastEngine = engine }
    const reply = await ask(engine, buildEnrichPrompt(rows), 480_000)
    if (reply) {
      const parsed = parseEnrichReply(reply, rows.length)
      if (parsed.ok) {
        lastAnswerAt = Date.now()
        emit(rows.map((r, i) => ({ id: r.id, key: keyOf(r), version: ENRICH_VERSION, engine, from: { category: r.category, subcategory: r.subcategory }, snap: r.snap, answer: parsed.answers[i] })))
        return
      }
      console.warn(`    batch of ${rows.length} unusable from ${engine} (${parsed.reason})`)
    }
    // The backstop LEAVES the rows for a re-run instead of splitting: its calls may all have been outages, and an outage
    // must not walk a batch down to single rows (codex, astra, opus).
    if (asks >= MAX_ASKS) {
      givenUp += rows.length
      console.warn(`    ${rows.length} rows left unanswered after ${MAX_ASKS} calls — a re-run asks them again`)
      return
    }
    if (outage) continue
    if (await answers(engine)) {
      if (++strikes >= maxStrikes || ++fails >= MAX_FAILS) break
      // ⚠️ BACK OFF BEFORE THE RETRY (astra, opus): a per-minute limit can answer a one-word probe and still refuse a
      // full batch, and retrying at once spends the second strike inside the same minute. A minute lets it clear.
      await sleep(60_000)
      continue
    }
    if (engine === 'agy' && opusOk) { agyDown(); continue }
    await waitForService()
  }
  if (rows.length === 1) { givenUp++; console.warn(`    giving up on ${rows[0].id}`); return }
  await sleep(2000)
  const mid = Math.floor(rows.length / 2)
  await runBatch(rows.slice(0, mid), true)
  await runBatch(rows.slice(mid), true)
}

async function main() {
  const { rows, bad } = await readScope(IN!)
  if (bad) console.warn(`${bad} malformed scope lines skipped`)
  mkdirSync(OUT!, { recursive: true })
  // The scope is the rows and their snapshots — NOT the prompt version, so bumping the prompt re-asks rows in the same
  // directory instead of refusing to start (astra).
  const hash = createHash('sha256')
  for (const r of rows) hash.update(JSON.stringify([r.id, r.snap]) + '\n') // incremental: no 300 MB joined string (codex)
  const scopeSha = hash.digest('hex')
  const shaFile = join(OUT!, 'scope.sha')
  if (existsSync(shaFile) && readFileSync(shaFile, 'utf8').trim() !== scopeSha) {
    console.error(`${OUT} belongs to a different export (scope.sha differs). Use a new --out directory.`)
    process.exit(1)
  }
  writeFileSync(shaFile, scopeSha + '\n')

  const have = new Set<string>()
  for await (const d of readParts(OUT!)) have.add(d.key)
  const todo = rows.filter((r) => !have.has(keyOf(r)))
  console.log(`${rows.length} rows in, ${have.size} answered, ${todo.length} to do — batch ${BATCH}, ${WORKERS} workers\n`)
  // The fallback is proven before it is needed (opus): a logged-out or too-old `claude` is found now, not hours later.
  if (todo.length && !(await opusReady())) {
    if (ENGINE === 'opus') { console.error('Opus 5 does not answer, or reports tools (`claude -p` logged out, missing, or reading a flag differently) — cannot start on it.'); process.exit(1) }
    opusOk = false
    console.warn('⚠️  Opus 5 does not answer or reports tools — there is NO fallback when agy runs out of quota.\n')
  }

  // Append target: a new part whenever the current one holds PART_ROWS lines.
  const existing = readdirSync(OUT!).filter((f) => /^part-\d{4}\.jsonl$/.test(f)).sort()
  let partNo = existing.length ? Number(existing[existing.length - 1].slice(5, 9)) : 1
  let inPart = 0
  if (existing.length) {
    const last = join(OUT!, existing[existing.length - 1])
    const text = readFileSync(last, 'utf8')
    inPart = text.split('\n').filter(Boolean).length
    // ⚠️ A kill mid-append leaves a line with no newline; appending straight after it would glue the next answer onto
    // the fragment and lose both (astra). Terminate it — readParts skips the torn fragment on its own line.
    if (text.length && !text.endsWith('\n')) { const fd = openSync(last, 'a'); writeSync(fd, '\n'); fsyncSync(fd); closeSync(fd) }
  }
  const append = (got: DoneRow[]) => {
    for (const d of got) {
      if (inPart >= PART_ROWS) { partNo++; inPart = 0 }
      const fd = openSync(join(OUT!, `part-${String(partNo).padStart(4, '0')}.jsonl`), 'a')
      writeSync(fd, JSON.stringify(d) + '\n')
      fsyncSync(fd)
      closeSync(fd)
      inPart++
    }
  }
  emit = append // synchronous: two workers' appends never interleave inside a line

  const batches: ScopeRow[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
  let next = 0
  let finished = 0
  const t0 = Date.now()
  async function worker() {
    while (next < batches.length) {
      const slice = batches[next++]
      await runBatch(slice)
      finished += slice.length
      const mins = (Date.now() - t0) / 60000
      console.log(`  ${clock()}  ${finished}/${todo.length}  ${mins.toFixed(1)}min  ~${((todo.length - finished) * (mins / Math.max(finished, 1)) / 60).toFixed(1)}h left${givenUp ? `  (${givenUp} left unanswered — a re-run asks them again)` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))

  // Summary under the CURRENT gate (the apply re-gates against the live rows anyway).
  let total = 0
  let texts = 0
  let refiled = 0
  const refusals: Record<string, number> = {}
  for await (const d of readParts(OUT!)) {
    if (d.version !== ENRICH_VERSION) continue
    total++
    const dec = decideEnrichment(inputFromSnapshot(d.id, d.snap, d.from), d.answer)
    if (dec.descriptionVi !== null) texts++
    if (dec.category !== d.from.category || dec.subcategory !== d.from.subcategory) refiled++
    for (const r of dec.refused) { const k = r.split(':').slice(0, 2).join(':'); refusals[k] = (refusals[k] ?? 0) + 1 }
  }
  // ⚠️ SAY WHAT IS MISSING. A row whose singleton request failed has no answer; the run is resumable, and the apply is
  // per-listing, so a partial run is safe to apply — but it must not be mistaken for a complete one (codex).
  const answered = new Set<string>()
  for await (const d of readParts(OUT!)) answered.add(d.key)
  const missing = rows.filter((r) => !answered.has(keyOf(r))).length
  console.log(`\n${missing ? `INCOMPLETE — ${missing} rows still unanswered; re-run to retry them` : 'DONE'}: ${total} answers in ${OUT}; ${texts} with a new description; ${refiled} re-filed`)
  if (missing) process.exitCode = 2
  console.log('refusals:', JSON.stringify(Object.entries(refusals).sort((a, b) => b[1] - a[1]).slice(0, 20)))
}

main().catch((e) => { console.error(e); process.exit(1) })
