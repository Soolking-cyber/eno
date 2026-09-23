#!/usr/bin/env node
/**
 * Smoke-test the eno-mailer Worker with ONE signed request — the cutover check in
 * infra/cloudflare/eno-mailer.README.md, run BEFORE the app that depends on it is deployed.
 *
 *   node scripts/mailer-smoke.mjs --edition vn --to seed@example.com [--attach-bytes 3670016]
 *     [--class signin|security|transactional] [--bad-signature] [--stale] [--key-stdin]
 *
 * MAILER_URL and the edition's key come from the environment (MAILER_KEY) or, with --key-stdin,
 * the key arrives on stdin. ⛔ NEVER TYPE THE KEY INTO A COMMAND LINE — `MAILER_KEY=… node …` lands
 * in shell history. The two supported ways to run it (runbook step 6):
 *   · ON THE BOX, inside the edition's own container, which reads the key from the env file itself:
 *       docker exec -i --env-file /opt/eno/secrets/eno-vn.env eno-vn-app \
 *         node --input-type=module - --edition vn --to seed@example.com < scripts/mailer-smoke.mjs
 *   · FROM A LAPTOP, with the key piped over ssh straight into --key-stdin:
 *       ssh … 'grep -m1 ^MAILER_KEY= /opt/eno/secrets/eno-vn.env | cut -d= -f2-' \
 *         | MAILER_URL=https://eno-mailer.<sub>.workers.dev/v1/send \
 *           node scripts/mailer-smoke.mjs --edition vn --to seed@example.com --key-stdin
 *
 * ⛔ SEND TO AN EXTERNAL SEED MAILBOX, NOT A VERIFIED DESTINATION ADDRESS. Cloudflare treats a
 * verified destination differently — free, outside the daily quota, and allowed 25 MiB instead of
 * 5 MiB — so a green result there proves nothing about Workers Paid being active, the quota, the
 * size cap or where real mail lands (inbox or spam).
 *
 * ⚠️ `--bad-signature` and `--stale` must come back 401 `unauthorized`; anything else means the
 * Worker is accepting mail it should refuse. `--attach-bytes` sends a zero-filled `smoke.pdf` of
 * that many RAW bytes: 3670016 (3.5 MiB) is the largest file the app attaches and must deliver;
 * much more than that is expected to be refused `too_large`.
 *
 * Signing mirrors src/lib/mail.ts `signMailerRequest`; src/lib/mailer-worker.test.ts runs this
 * script's signer against the real Worker so the two cannot drift apart unnoticed.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function sign({ key, ts, edition, idempotencyKey, body }) {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')
  return 'v1=' + createHmac('sha256', key).update(`${ts}\n${edition}\n${idempotencyKey}\n${bodyHash}`).digest('hex')
}

export function parseArgs(argv) {
  const out = { edition: null, to: null, attachBytes: 0, cls: 'transactional', badSignature: false, stale: false, keyStdin: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--edition') out.edition = argv[++i]
    else if (a === '--to') out.to = argv[++i]
    else if (a === '--attach-bytes') out.attachBytes = Number(argv[++i])
    else if (a === '--class') out.cls = argv[++i]
    else if (a === '--bad-signature') out.badSignature = true
    else if (a === '--stale') out.stale = true
    else if (a === '--key-stdin') out.keyStdin = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (out.edition !== 'vn' && out.edition !== 'forum') throw new Error('--edition vn|forum is required')
  if (!out.to || !out.to.includes('@')) throw new Error('--to <external seed address> is required')
  if (!Number.isInteger(out.attachBytes) || out.attachBytes < 0) throw new Error('--attach-bytes must be a whole number')
  return out
}

/** Build the exact request the Worker expects (exported so the drift test can feed it to the Worker). */
export function buildRequest({ url, key, edition, to, attachBytes = 0, cls = 'transactional', badSignature = false, stale = false, now = Date.now() }) {
  const stamp = new Date(now).toISOString()
  const payload = {
    to,
    subject: `eno-mailer smoke test (${edition}) ${stamp}`,
    html: `<p>eno-mailer smoke test from the <b>${edition}</b> edition at ${stamp}.</p><p>Check: From, Reply-To, SPF/DKIM/DMARC and inbox placement.</p>`,
    text: `eno-mailer smoke test from the ${edition} edition at ${stamp}.`,
    class: cls,
    tag: 'smoke',
  }
  if (attachBytes > 0) {
    payload.attachments = [{ filename: 'smoke.pdf', type: 'application/pdf', content: Buffer.alloc(attachBytes).toString('base64') }]
  }
  const body = JSON.stringify(payload)
  const ts = Math.floor(now / 1000) - (stale ? 900 : 0)
  const idempotencyKey = `smoke-${randomUUID()}`
  const signature = badSignature ? `v1=${'0'.repeat(64)}` : sign({ key, ts, edition, idempotencyKey, body })
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-eno-edition': edition,
      'x-eno-timestamp': String(ts),
      'idempotency-key': idempotencyKey,
      'x-eno-signature': signature,
    },
    body,
  })
}

async function readAllStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {(line: string) => void} [log]
 * @param {typeof fetch} [fetchImpl]
 * @param {() => Promise<string>} [readStdin]
 */
export async function main(argv, env = process.env, log = console.log, fetchImpl = fetch, readStdin = readAllStdin) {
  let args
  try { args = parseArgs(argv) } catch (e) { log(String(e.message)); return 2 }
  const url = env.MAILER_URL
  // --key-stdin: the whole of stdin, whitespace dropped — what `grep … | cut …` over ssh prints.
  const key = args.keyStdin ? (await readStdin()).replace(/\s+/g, '') : env.MAILER_KEY
  if (!url || !key) { log(`MAILER_URL and ${args.keyStdin ? 'a key on stdin' : 'MAILER_KEY'} (the key for --edition) must be set`); return 2 }
  const req = buildRequest({ url, key, edition: args.edition, to: args.to, attachBytes: args.attachBytes, cls: args.cls, badSignature: args.badSignature, stale: args.stale })
  const started = Date.now()
  const res = await fetchImpl(req)
  const text = await res.text()
  log(`HTTP ${res.status} in ${Date.now() - started} ms: ${text.slice(0, 500)}`)
  if (args.badSignature || args.stale) return res.status === 401 ? 0 : 1
  return res.ok ? 0 : 1
}

// Run as a file (`node scripts/mailer-smoke.mjs …`) or piped into `node --input-type=module - …`
// inside the app container, where there is no file path to compare: argv[1] is then '-', and Node
// ≥ 24.2 also sets import.meta.main. Without this the piped run would exit 0 having sent NOTHING.
if (import.meta.main === true || process.argv[1] === '-' || import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
