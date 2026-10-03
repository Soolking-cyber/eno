import { afterEach, describe, expect, it } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * infra/cloudflare/deploy-worker.sh — the only supported way to push the edge Worker.
 *
 * ⛔ ITS FIRST REAL RUN FAILED (2026-10-03): Cloudflare answered 10021 "Uncaught Error: No such module:
 * worker.js". `-F "worker.js=@$SRC"` names the multipart FIELD worker.js, but curl sends the source
 * file's own basename (eno-html-edge-cache.js) as the part's FILENAME, and Cloudflare resolves
 * `main_module` by filename. Nothing had ever run the script end to end: the token on the box had been
 * purge-only since it was written.
 *
 * So this RUNS it, with the REAL curl building the REAL multipart body: a wrapper named `curl` first on
 * PATH records its argv and stdin, points the Cloudflare origin at a stub in this process, and execs
 * the real binary (a fake that parsed `-F` itself would re-implement exactly the curl behaviour the bug
 * lived in). The stub answers the way Cloudflare did: success only when a part's filename equals
 * metadata.main_module. Pinned:
 *   · the module part's filename equals main_module, and carries the source file byte for byte;
 *   · the token never appears in curl's argv (it reaches curl on stdin via `--config -`) or the output;
 *   · any non-success answer exits non-zero, and the pre-fix script fails here the way it failed live.
 *
 * ⚠️ ASYNC execFile, NEVER execFileSync: the stub runs in this process, and a synchronous child would
 * block the event loop that has to answer it.
 * ⚠️ The wrapper refuses any URL it did not rewrite to the stub, so no run of this can reach Cloudflare.
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'infra/cloudflare/deploy-worker.sh')
const SOURCE = join(ROOT, 'infra/cloudflare/eno-html-edge-cache.js')
const REAL_CURL = execFileSync('bash', ['-c', 'command -v curl'], { encoding: 'utf8' }).trim()

/** Written with `@{` for bash's `${`, so the template literal does not interpolate it. */
const FAKE_CURL = String.raw`#!/usr/bin/env bash
echo call >> "$FAKE_DIR/calls"
: > "$FAKE_DIR/argv"
for a in "$@"; do printf '%s\0' "$a" >> "$FAKE_DIR/argv"; done
cat > "$FAKE_DIR/stdin"
args=() cf=https://api.cloudflare.com
for a in "$@"; do
  a=@{a/"$cf"/$STUB_ORIGIN}
  case "$a" in *://*) case "$a" in "$STUB_ORIGIN"/*) ;; *) echo "fake curl: refusing $a" >&2; exit 97 ;; esac ;; esac
  args+=("$a")
done
exec "$REAL_CURL" "@{args[@]}" < "$FAKE_DIR/stdin"
`.replaceAll('@{', '${')

type Part = { name?: string; filename?: string; type?: string; body: Buffer }
type Seen = { method?: string; url?: string; auth?: string; parts: Part[] }
/** cloudflare: answer like the real API (filename must match main_module); noAccess: the purge-only
 *  token's answer (09-22); gateway: an HTML 502 instead of JSON. */
type Mode = 'cloudflare' | 'noAccess' | 'gateway'

function parseMultipart(contentType: string, body: Buffer): Part[] {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentType)
  if (!m) return []
  const delim = Buffer.from(`--${m[1] ?? m[2]}`)
  const parts: Part[] = []
  for (let i = body.indexOf(delim); i !== -1; ) {
    const start = i + delim.length
    if (body.subarray(start, start + 2).toString() === '--') break
    const next = body.indexOf(delim, start)
    if (next === -1) break
    const chunk = body.subarray(start + 2, next - 2) // the CRLF after this delimiter, and the one before the next
    const sep = chunk.indexOf('\r\n\r\n')
    const head = chunk.subarray(0, sep).toString('latin1')
    const disp = /^content-disposition:(.*)$/im.exec(head)?.[1] ?? ''
    parts.push({
      name: /\bname="([^"]*)"/.exec(disp)?.[1],
      filename: /\bfilename="([^"]*)"/.exec(disp)?.[1],
      type: /^content-type:\s*(.*)$/im.exec(head)?.[1]?.trim(),
      body: chunk.subarray(sep + 4),
    })
    i = next
  }
  return parts
}

const servers: Server[] = []
const dirs: string[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function stub(mode: Mode, token: string): Promise<{ origin: string; seen: Seen }> {
  const seen: Seen = { parts: [] }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.method = req.method
      seen.url = req.url
      seen.auth = req.headers.authorization
      seen.parts = parseMultipart(req.headers['content-type'] ?? '', Buffer.concat(chunks))
      const json = (code: number, o: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (mode === 'gateway') { res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<html>502 Bad Gateway</html>'); return }
      if (mode === 'noAccess') return json(403, { success: false, errors: [{ code: 10000, message: 'No access to the specified resource' }] })
      if (seen.auth !== `Bearer ${token}`) return json(400, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })
      let main = ''
      try { main = JSON.parse(seen.parts.find((p) => p.name === 'metadata')?.body.toString() ?? '{}').main_module ?? '' } catch { /* below */ }
      if (!main || !seen.parts.some((p) => p.filename === main)) {
        return json(400, { success: false, errors: [{ code: 10021, message: `Uncaught Error: No such module: ${main}` }] })
      }
      json(200, { success: true, result: { id: req.url?.split('/').pop(), modified_on: '2026-10-03T00:00:00Z' } })
    })
  })
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address()
    resolve({ origin: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, seen })
  }))
}

async function deploy(mode: Mode, opts: { script?: string; args?: string[] } = {}) {
  const token = `cf-test-${randomUUID()}`
  const { origin, seen } = await stub(mode, token)
  const d = mkdtempSync(join(tmpdir(), 'eno-deploy-worker-'))
  dirs.push(d)
  writeFileSync(join(d, 'curl'), FAKE_CURL)
  chmodSync(join(d, 'curl'), 0o755)
  // no proxy may intercept the loopback stub, and no ~/.curlrc may change what curl sends
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of Object.keys(env)) if (/proxy/i.test(k)) delete env[k]
  Object.assign(env, {
    PATH: `${d}:${process.env.PATH}`, FAKE_DIR: d, STUB_ORIGIN: origin, REAL_CURL,
    CURL_HOME: d, XDG_CONFIG_HOME: d, NO_PROXY: '*', CF_TOKEN: token, CF_TOKEN_FILE: join(d, 'no-such-file'),
  })
  const { code, out } = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile('bash', [opts.script ?? SCRIPT, ...(opts.args ?? [])], { env, timeout: 15_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout + stderr })
    })
  })
  // absent when the script stopped before curl: the assertions then fail on r.out, not on an ENOENT
  const read = (f: string) => (existsSync(join(d, f)) ? readFileSync(join(d, f), 'utf8') : '')
  const calls = read('calls').split('\n').filter(Boolean).length
  return { code, out, seen, token, calls, argv: read('argv').split('\0').slice(0, -1), stdin: read('stdin') }
}

// One run is ~0.1-0.3 s (bash + curl + python3); 20 s leaves room for a loaded parallel suite. A hang
// is bounded by execFile's own timeout.
describe('deploy-worker.sh', { timeout: 20_000 }, () => {
  it('uploads the module under the filename main_module names, with the source byte for byte', async () => {
    const r = await deploy('cloudflare')
    expect(r.code, r.out).toBe(0)
    expect(r.calls).toBe(1) // the wrapper keeps the LAST call's argv/stdin, and the stub its last request
    expect(r.out).toMatch(/deployed: eno-html-edge-cache modified 2026-10-03T00:00:00Z/)
    expect(r.seen.method).toBe('PUT')
    expect(r.seen.url).toBe('/client/v4/accounts/c91cf27edd31b01aba677ac9e007d569/workers/scripts/eno-html-edge-cache')
    const meta = JSON.parse(r.seen.parts.find((p) => p.name === 'metadata')?.body.toString() ?? 'null')
    // a PUT replaces the script's settings: whatever is not sent is dropped (see the script's header)
    expect(meta).toEqual({ main_module: 'worker.js', compatibility_date: '2026-09-01', bindings: [], compatibility_flags: [] })
    const modules = r.seen.parts.filter((p) => p.filename !== undefined)
    expect(modules.map((p) => p.filename)).toEqual([meta.main_module])
    expect(modules[0].type).toBe('application/javascript+module')
    expect(modules[0].body.equals(readFileSync(SOURCE))).toBe(true)
  })

  it('keeps the token out of argv: it reaches curl on stdin through --config -', async () => {
    const r = await deploy('cloudflare')
    expect(r.code, r.out).toBe(0)
    expect(r.argv.length).toBeGreaterThan(3)
    expect(r.argv.filter((a) => a.includes(r.token))).toEqual([])
    expect(r.argv[r.argv.indexOf('--config') + 1]).toBe('-')
    expect(r.stdin).toBe(`header = "Authorization: Bearer ${r.token}"\n`)
    expect(r.seen.auth).toBe(`Bearer ${r.token}`)
    expect(r.out).not.toContain(r.token)
  })

  it('exits non-zero on any answer that is not success', async () => {
    const denied = await deploy('noAccess')
    expect(denied.code, denied.out).not.toBe(0)
    expect(denied.out).toMatch(/FAILED: .*No access to the specified resource/)
    const gateway = await deploy('gateway')
    expect(gateway.code, gateway.out).not.toBe(0)
    // the PUT went out and python3 choked on the HTML: not a hang, not a stop before curl
    expect([denied.calls, gateway.calls]).toEqual([1, 1])
    expect(gateway.out).toMatch(/JSONDecodeError/)
    expect(gateway.out).not.toMatch(/deployed:/)
  })

  it('the trap is real: without filename= the stub answers what Cloudflare did on 2026-10-03', async () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src.split(';filename=$MODULE')).toHaveLength(2) // exactly one: the -F argument
    const pre = src.replace(';filename=$MODULE', '')
    const d = mkdtempSync(join(tmpdir(), 'eno-deploy-worker-pre-'))
    dirs.push(d)
    writeFileSync(join(d, 'deploy-worker.sh'), pre)
    const r = await deploy('cloudflare', { script: join(d, 'deploy-worker.sh'), args: [SOURCE] })
    expect(r.code, r.out).not.toBe(0)
    expect(r.out).toMatch(/FAILED: .*"code": 10021.*No such module: worker\.js/)
    expect(r.seen.parts.filter((p) => p.filename !== undefined).map((p) => p.filename)).toEqual(['eno-html-edge-cache.js'])
  })
})
