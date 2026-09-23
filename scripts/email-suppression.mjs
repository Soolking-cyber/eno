#!/usr/bin/env node
/**
 * Find, and lift, a Cloudflare Email Sending suppression — the FALLBACK for an admin unblocking a
 * user. ⛔ THE PRIMARY PATH IS THE DASHBOARD, AND IT NEEDS NO TOKEN: Cloudflare dashboard → Email
 * Service → Sending → Suppressions → find the address → Delete (runbook: eno-mailer.README.md,
 * "Operating it"). Use this script only when the dashboard cannot do the job (a bulk review, say).
 *
 *   node scripts/email-suppression.mjs list <email>          one address's entries
 *   node scripts/email-suppression.mjs list --all            every entry on the account
 *   node scripts/email-suppression.mjs remove <email>        DRY RUN: show what would be lifted
 *   node scripts/email-suppression.mjs remove <email> --yes  lift it
 *
 * ⛔ THE TOKEN THIS NEEDS CAN SEND MAIL AS eno.vn AND eno.forum. The suppressions API wants
 * Account · Email Sending: Edit, and that same permission sends over Cloudflare's REST/SMTP API as
 * either domain — skipping the eno-mailer Worker's per-edition keys, its class allowlist, its
 * marketing refusal and its daily budget. So, every time:
 *   · mint it on a LAPTOP, scoped to that one permission, with an EXPIRY (a few hours at most);
 *   · never put it on the box, and never in /opt/eno/secrets — that is where a box compromise looks;
 *   · give it to this script from a hidden prompt (run it in a terminal and paste when asked), from
 *     a pipe (`pbpaste | node scripts/email-suppression.mjs …`), or from a mode-0600 file named by
 *     CF_EMAIL_TOKEN_FILE — NEVER as `CF_EMAIL_TOKEN=… node …`, which writes it into shell history
 *     (the script refuses to run when CF_EMAIL_TOKEN is set, so the habit cannot stick);
 *   · REVOKE it (My Profile → API Tokens → Delete) as soon as the job is done, expiry or not.
 * CF_ACCOUNT_ID overrides the account (default: eno's).
 *
 * ⛔ WHY THIS EXISTS. Suppressions are ACCOUNT-WIDE and a spam complaint never expires, so ONE
 * complaint — about an eno.forum mail, or about a sign-in mail somebody else triggered by typing
 * the victim's address into the sign-in form — stops that address receiving sign-in links, KYC
 * outcomes, payout alerts and visa results on BOTH editions, forever. The sign-in route answers the
 * generic `send_failed` (it must not reveal a suppression to an anonymous caller), and logs
 * "recipient is on the Cloudflare suppression list" server-side; this is what an admin runs next.
 *
 * ⛔ LIFT IT ONLY AFTER THE PERSON PROVES THEY CONTROL THE ADDRESS — e.g. they sign in with Google
 * as that same address, or write to support FROM it. Lifting a suppression on someone's say-so lets
 * whoever asked mail an inbox that complained or bounced, and a second complaint costs sender
 * reputation for every user.
 *
 * ⚠️ `read_only` ENTRIES CANNOT BE LIFTED HERE — Cloudflare decides mutability (never infer it from
 * `reason`), and the API answers 403. Those go to Cloudflare Support (dashboard → Support → Email
 * Service), quoting the entry's id.
 *
 * The token travels in a request header built in-process, never on a command line.
 */
import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DEFAULT_ACCOUNT = 'c91cf27edd31b01aba677ac9e007d569'
const API = 'https://api.cloudflare.com/client/v4'
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/

export class SuppressionError extends Error {}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function cfJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init)
  let body = null
  try { body = await res.json() } catch { /* non-JSON error page */ }
  if (!res.ok || !body?.success) {
    const msg = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`
    throw new SuppressionError(`${init?.method || 'GET'} ${new URL(url).pathname}: ${msg}`)
  }
  return body
}

/**
 * Every entry for one address (or every entry on the account when `email` is null), all pages.
 * @param {{ token: string, account?: string, email?: string | null, fetchImpl?: typeof fetch }} opts
 */
export async function listSuppressions({ token, account = DEFAULT_ACCOUNT, email = null, fetchImpl = fetch }) {
  if (email !== null && !EMAIL_RE.test(email)) throw new SuppressionError('not an email address')
  const out = []
  let cursor = null
  for (let page = 0; page < 1000; page++) {
    const q = new URLSearchParams({ per_page: '1000' })
    if (email) q.set('email', email)
    if (cursor) q.set('cursor', cursor)
    const body = await cfJson(fetchImpl, `${API}/accounts/${account}/email/sending/suppressions?${q}`, { headers: authHeaders(token) })
    out.push(...(body.result || []))
    cursor = body.result_info?.next_cursor || null
    if (!cursor) break
  }
  return out
}

/**
 * Lift every MUTABLE entry for one address. Dry run unless `confirm`. Returns what was (or would be)
 * removed and what could not be, so the caller can print the Cloudflare Support path for the rest.
 * @param {{ token: string, account?: string, email: string, confirm?: boolean, fetchImpl?: typeof fetch }} opts
 */
export async function removeSuppressions({ token, account = DEFAULT_ACCOUNT, email, confirm = false, fetchImpl = fetch }) {
  if (!email || !EMAIL_RE.test(email)) throw new SuppressionError('not an email address')
  const entries = await listSuppressions({ token, account, email, fetchImpl })
  // The API filters exactly already; re-check so a filter the API ever ignores cannot turn this
  // into "delete the first page of the account".
  const mine = entries.filter((e) => typeof e.email === 'string' && e.email.toLowerCase() === email.toLowerCase())
  const removable = mine.filter((e) => e.read_only === false)
  const readOnly = mine.filter((e) => e.read_only !== false)
  const removed = []
  if (confirm) {
    for (const e of removable) {
      await cfJson(fetchImpl, `${API}/accounts/${account}/email/sending/suppressions/${encodeURIComponent(e.id)}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      removed.push(e)
    }
  }
  return { found: mine, removable, removed, readOnly, dryRun: !confirm }
}

/**
 * The API token, from a mode-0600 file (CF_EMAIL_TOKEN_FILE) or stdin — a hidden prompt on a
 * terminal, the whole input when piped. Throws SuppressionError with the reason; never logs it.
 * @param {Record<string, string | undefined>} env
 * @param {{ readStdin?: () => Promise<string>, promptHidden?: (q: string) => Promise<string>, isTTY?: boolean }} [io]
 */
export async function readToken(env, io = {}) {
  if (env.CF_EMAIL_TOKEN) {
    throw new SuppressionError('CF_EMAIL_TOKEN is set — refusing: an inline or exported token lands in shell history. Unset it (and clear it from history), then paste the token at the prompt, pipe it in, or point CF_EMAIL_TOKEN_FILE at a 0600 file.')
  }
  let token
  if (env.CF_EMAIL_TOKEN_FILE) {
    let st
    try { st = statSync(env.CF_EMAIL_TOKEN_FILE) } catch { throw new SuppressionError('CF_EMAIL_TOKEN_FILE cannot be read') }
    if (!st.isFile()) throw new SuppressionError('CF_EMAIL_TOKEN_FILE is not a regular file')
    if ((st.mode & 0o077) !== 0) throw new SuppressionError('CF_EMAIL_TOKEN_FILE must be readable by its owner only (chmod 600)')
    token = readFileSync(env.CF_EMAIL_TOKEN_FILE, 'utf8')
  } else {
    const isTTY = io.isTTY ?? Boolean(process.stdin.isTTY)
    token = isTTY
      ? await (io.promptHidden ?? promptHidden)('Cloudflare API token (Email Sending: Edit, short-lived; input hidden): ')
      : await (io.readStdin ?? readAllStdin)()
  }
  token = String(token ?? '').replace(/\s+/g, '')
  if (!token) throw new SuppressionError('no API token given (prompt, pipe, or CF_EMAIL_TOKEN_FILE)')
  return token
}

async function readAllStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

/** Read one line from the terminal without echoing it. */
async function promptHidden(question) {
  const { createInterface } = await import('node:readline')
  const { Writable } = await import('node:stream')
  // Everything readline would echo goes to this sink and is dropped; only the question is shown.
  const sink = new Writable({ write(_chunk, _enc, cb) { cb() } })
  process.stderr.write(question)
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true })
  try {
    return await new Promise((resolve) => rl.question('', resolve))
  } finally {
    rl.close()
    process.stderr.write('\n')
  }
}

function describe(e) {
  return `  ${e.id}  ${e.email}  reason=${e.reason}  since=${e.created_at}  expires=${e.expires_at ?? 'never'}  ${e.read_only ? 'READ-ONLY' : 'mutable'}`
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {(line: string) => void} [log]
 * @param {typeof fetch} [fetchImpl]
 * @param {(env: Record<string, string | undefined>) => Promise<string>} [getToken]
 */
export async function main(argv, env = process.env, log = console.log, fetchImpl = fetch, getToken = (e) => readToken(e)) {
  const [cmd, arg, ...rest] = argv
  const account = env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT
  const usage = 'usage: email-suppression.mjs list <email>|--all · remove <email> [--yes]   (the dashboard is the primary path: Email Service → Sending → Suppressions)'
  if (!cmd || !['list', 'remove'].includes(cmd)) { log(usage); return 2 }
  if (!arg || (cmd === 'remove' && arg.startsWith('--'))) { log(usage); return 2 }
  let token
  try { token = await getToken(env) } catch (e) { log(e instanceof SuppressionError ? e.message : 'could not read the API token'); return 2 }

  try {
    if (cmd === 'list') {
      const email = arg === '--all' ? null : arg.trim()
      const entries = await listSuppressions({ token, account, email, fetchImpl })
      if (!entries.length) log(email ? 'no suppression for that address' : 'no suppressions on the account')
      for (const e of entries) log(describe(e))
      return 0
    }

    const confirm = rest.includes('--yes')
    const r = await removeSuppressions({ token, account, email: arg.trim(), confirm, fetchImpl })
    if (!r.found.length) { log('no suppression for that address — nothing to lift'); return 0 }
    log('⛔ Lift a suppression ONLY after the person proved they control this address')
    log('   (Google sign-in as the same address, or a message to support sent FROM it).')
    for (const e of r.found) log(describe(e))
    if (r.dryRun) {
      log(r.removable.length ? `DRY RUN — re-run with --yes to lift ${r.removable.length} entr${r.removable.length === 1 ? 'y' : 'ies'}.` : 'Nothing here is mutable.')
    } else {
      for (const e of r.removed) log(`lifted ${e.id}`)
    }
    if (r.readOnly.length) {
      log(`${r.readOnly.length} READ-ONLY entr${r.readOnly.length === 1 ? 'y' : 'ies'}: only Cloudflare Support can lift ${r.readOnly.length === 1 ? 'it' : 'them'}`)
      log('   (dashboard → Support → Email Service; quote the id above). The API answers 403 for these.')
      return 1
    }
    return 0
  } catch (e) {
    log(e instanceof SuppressionError ? `failed: ${e.message}` : `failed: ${e?.name || 'error'}`)
    return 1
  } finally {
    log(REVOKE_REMINDER)
  }
}

/** Printed on every run that got as far as holding a token. */
export const REVOKE_REMINDER = '⛔ Revoke this API token now (My Profile → API Tokens → Delete): it can send mail as eno.vn and eno.forum.'

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
