import 'server-only'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { Resend, type CreateEmailRequestOptions } from 'resend'
import { EDITION, IS_MARKETPLACE } from '@/lib/edition'

// ── EVERY EMAIL THE APP SENDS LEAVES THROUGH THIS FILE ────────────────────────────────────────
//
// ⛔ CLOUDFLARE EMAIL SENDING IS PRIMARY; RESEND IS THE FALLBACK, ON eno.vn ONLY (owner, 2026-09-23:
// "resend fallback", which replaced that morning's hard cut). Every message goes to the eno-mailer
// Worker first. Only when the Worker did NOT ACCEPT it (unreachable, timed out, 5xx, 429 quota or
// budget, 401/403 key/clock/plan, a config error: FALLBACK_CODES below) is the same message handed
// to Resend, under the same idempotency key, inside the same deadline. A Worker VERDICT is final:
// a suppressed or invalid recipient would bounce through Resend too, an oversized message is the
// caller's to degrade, and a key the Worker already used for a different body (409) would
// double-send. The Worker's source and contract are infra/cloudflare/eno-mailer.js; the deploy,
// cutover and fallback runbook is infra/cloudflare/eno-mailer.README.md.
//
// ⛔ THE FORUM BUILD HAS NO RESEND FALLBACK, AND THAT IS THE FIX FOR A KNOWN LEAK. Under Resend every
// eno.forum email, the finished e-Visa included, arrived From "eno.vn <no-reply@eno.vn>", the
// licensed marketplace: eno.forum is not a verified Resend domain, so eno.vn was the only sender
// Resend would take. On the Worker path this file does not choose the sender at all. Each container
// holds ONE key, its own edition's, and the Worker sets From and Reply-To from the edition whose key
// verified, so the forum container cannot send as eno.vn whatever this file or its env says. The
// Resend path DOES choose a sender (MAIL_FROM), which is exactly why it is gated on IS_MARKETPLACE:
// the edition is inlined at build time, so the services image cannot take it even with
// RESEND_API_KEY and MAIL_FROM in its env.
// ⚠️ WHAT THAT GATE DOES NOT DO. An eno.vn build with MARKETPLACE_HOSTS_SERVICES (next.config.ts)
// compiles the partner-hosted visa desk, so eno.vn itself can send a visa result. That mail is
// eno.vn's on BOTH transports: the Worker verifies the vn key and sends it From no-reply@eno.vn,
// Reply-To support@eno.vn, exactly what the fallback uses. The fallback changes the provider, never
// the sender. Whether eno.vn may send it at all is the edition boundary's question, not this file's.
//
// Env, per container, all server-only and read at CALL time (not inlined at build):
//   MAILER_URL      the Worker's send endpoint, https://eno-mailer.<subdomain>.workers.dev/v1/send
//   MAILER_KEY      THIS edition's HMAC key: MAILER_KEY_VN's value on eno.vn, MAILER_KEY_FORUM's on
//                   eno.forum. Never both in one container.
//   RESEND_API_KEY  eno.vn ONLY: the fallback. Both it and MAIL_FROM must be set, or there is no
//   MAIL_FROM       fallback. MAIL_FROM is an eno.vn sender, "eno.vn <no-reply@eno.vn>". The forum
//                   build ignores both.
// Nothing set (local dev, CI) → every send is a logged no-op returning `disabled`, the same
// env-gated shape push.ts uses.
//
// LOGS, one line per outcome and never a body: `[mail] sent` (info) with `transport: "worker"` or
// `"resend"`; `[mail] FALLBACK to Resend` (warn, `evt: "mail_fallback"`) EVERY time the fallback is
// used, the line to alert on, since it means the Worker refused or could not be reached; and
// `[mail] send failed` (error) with the code, and `fallback: …` when Resend was tried or had no time.

/** What kind of mail this is. It decides the Worker's daily budget and whether it may send at all. */
export type MailClass =
  /** A sign-in link or code. Reserved quota; no Reply-To (its body is a live credential). */
  | 'signin'
  /** An alert a user must not miss (payout account changed). Reserved quota, last to be refused. */
  | 'security'
  /** Everything else a user triggered or is owed: outcomes, results. Refused first when quota is short. */
  | 'transactional'
  /** Newsletters/digests. ⛔ REFUSED — Cloudflare Email Sending is transactional-only. */
  | 'marketing'

export type MailFailureCode =
  | 'disabled' // MAILER_URL / MAILER_KEY unset
  | 'config' // MAILER_URL malformed, or the Worker/Cloudflare side is misconfigured
  | 'marketing_refused'
  | 'too_large'
  | 'invalid'
  | 'unauthorized'
  | 'suppressed' // the address is on Cloudflare's account-wide suppression list
  | 'rate_limited'
  | 'daily_limit' // Cloudflare's own daily quota is spent
  | 'budget' // the Worker's per-class share of the quota is spent
  | 'budget_unknown' // the Worker could not read its counters and this isolate's cap on BACKGROUND mail is spent
  | 'idempotency_conflict' // this idempotency key was already used for a DIFFERENT message
  | 'unavailable'
  | 'network'
  | 'timeout'

/** Which provider delivered: the eno-mailer Worker, or (eno.vn only) the Resend fallback. */
export type MailTransport = 'worker' | 'resend'

type MailFailure = { ok: false; code: MailFailureCode; status?: number }

export type MailResult =
  | { ok: true; messageId: string | null; deduped?: boolean; transport: MailTransport }
  | MailFailure

/** One call to the Worker, before this file says which transport delivered. */
type WorkerResult = { ok: true; messageId: string | null; deduped?: boolean } | MailFailure

/**
 * One file attached to an outgoing email.
 *
 * ⚠️ `content` is BASE64 TEXT, not raw bytes and not a Buffer: it travels inside a JSON body to the
 * Worker, and a Buffer would serialise as `{"type":"Buffer","data":[…]}` and arrive as a corrupt
 * file. Encode at the call site: `buf.toString('base64')`.
 *
 * ⚠️ `filename` is the ONE part of an attachment the recipient's mail client, their provider's
 * virus scanner and every forwarding hop can all read in the clear. It must never carry identity
 * data — no passport number, no name, no date of birth. Name result files after the case reference
 * (`EV-1042-evisa.pdf`) and nothing else. The Worker accepts `[A-Za-z0-9][A-Za-z0-9._ -]{0,127}`.
 *
 * ⚠️ THE CEILING IS 5 MiB FOR THE WHOLE MESSAGE (Cloudflare), base64 and MIME line breaks included —
 * about 3.5 MiB of file, and it holds on the Resend fallback too (Resend itself allows 40 MB): a
 * caller that can exceed it must degrade itself (src/lib/visa/result.ts sends a link instead). At
 * most ONE attachment, PDF/PNG/JPEG only.
 */
export type MailAttachment = {
  filename: string
  /** Base64-encoded file contents — see the note above. */
  content: string
  /** e.g. 'application/pdf'. Derived from the filename when omitted. */
  contentType?: string
}

export type MailMessage = {
  to: string
  subject: string
  html: string
  text?: string
  /** Extra headers. The Worker allows List-Unsubscribe(-Post), Auto-Submitted and X-* only. */
  headers?: Record<string, string>
  /** Files to attach. Omit for ordinary transactional mail. */
  attachments?: MailAttachment[]
  /** Defaults to 'transactional'. */
  class?: MailClass
  /**
   * Same key → the Worker sends once (best effort, 24 h). Defaults to a fresh random key per
   * sendMail call, which still makes the one internal retry safe. Pass a deterministic key only
   * when the SAME logical email could be requested twice. `[A-Za-z0-9:._-]{8,128}`. The Resend
   * fallback gets the same key as its `Idempotency-Key` (Resend also remembers it for 24 h).
   *
   * ⚠️ DERIVE IT FROM THE CONTENT, NOT JUST THE RECORD. The Worker remembers the body's hash with
   * the key and answers `idempotency_conflict` (a failure) when the key returns with a different
   * body — so a key per case, reused for a corrected document, fails loudly instead of silently
   * reporting the first send. src/lib/visa/result.ts keys on the case AND the PDF's hash.
   */
  idempotencyKey?: string
  /** A short label for logs (`[a-z0-9_-]{1,40}`), e.g. 'signin-link'. Never user data. */
  tag?: string
  /**
   * Epoch ms by which this call must have returned. Each attempt's timeout is cut to what is left,
   * and no attempt (first or retry) starts with less than MAILER_MIN_ATTEMPT_MS to go — it answers
   * `timeout` instead. Pass one when the CALLER has a hard answer-by time (the visa result route has
   * maxDuration 30) and several sends share it. Never sent to the Worker. The Resend fallback lives
   * inside the same deadline: it is tried only with MAILER_MIN_ATTEMPT_MS still left, else the
   * send reports the Worker's failure.
   */
  deadline?: number
}

/** 4.9 MiB of serialised request. Keep in step with MAX_BODY_BYTES in the Worker. */
export const MAILER_MAX_REQUEST_BYTES = 5138022
/** Per attempt. Sign-in waits on this, so it is short; a message with a file gets longer. */
export const MAILER_TIMEOUT_MS = 6000
/**
 * The ONE attempt a message with a file gets — see RETRYABLE: an attachment is never retried, so a
 * 4.8 MB body is never in flight twice and never costs 20 s + 20 s.
 */
export const MAILER_ATTACHMENT_TIMEOUT_MS = 20000
/** With less than this left before `deadline`, an attempt is not started: it could not finish. */
export const MAILER_MIN_ATTEMPT_MS = 1000
const RETRY_DELAY_MS = 300

const KNOWN_CODES: ReadonlySet<string> = new Set<MailFailureCode>([
  'disabled', 'config', 'marketing_refused', 'too_large', 'invalid', 'unauthorized', 'suppressed',
  'rate_limited', 'daily_limit', 'budget', 'budget_unknown', 'idempotency_conflict', 'unavailable', 'network', 'timeout',
])

/**
 * Worth ONE more try, with the same idempotency key. Everything else is a verdict: a suppressed
 * address, an oversized message, a spent quota or a bad key will not change in 300 ms.
 *
 * ⛔ ONLY FOR A MESSAGE WITHOUT A FILE. An attachment send gets exactly one attempt: a retry would
 * re-post up to 4.8 MB, could double-send if the first attempt's idempotency record had not landed
 * yet, and turned a 20 s timeout into ~40 s — past the visa result route's maxDuration of 30 s.
 */
const RETRYABLE: ReadonlySet<MailFailureCode> = new Set<MailFailureCode>(['network', 'timeout', 'rate_limited', 'unavailable'])

/**
 * The Worker's answers on which eno.vn hands the message to Resend: the Worker did NOT ACCEPT it.
 * Not configured in this container, or misconfigured (`disabled`, `config`); a key, clock or plan
 * problem (`unauthorized`, which is every 401 and an edge 403); a spent quota or budget, or a
 * counter it could not read (`rate_limited`, `daily_limit`, `budget`, `budget_unknown`); down,
 * unreachable or too slow (`unavailable`, `network`, `timeout`).
 *
 * ⛔ DELIBERATELY NOT HERE. `suppressed` and `invalid` are verdicts on the recipient or the message,
 * and Resend would bounce the one and send what the Worker refused in the other.
 * `idempotency_conflict` means this key already SENT a different body: a second provider would
 * double-send. `too_large` is the caller's to degrade (the visa result sends a link). And
 * `marketing_refused` is policy: no transport may carry marketing mail.
 *
 * ⚠️ `timeout` IS AMBIGUOUS AND IS HERE ANYWAY (owner's list). A Worker that timed out may still
 * have sent. For a message without a file the Worker retry uses the same key, so it answers a
 * deduped 200 when the first attempt's record has landed, and only a second failure reaches Resend.
 * What is left is a rare duplicate, which the owner preferred to a sign-in link that never arrives.
 */
const FALLBACK_CODES: ReadonlySet<MailFailureCode> = new Set<MailFailureCode>([
  'disabled', 'config', 'unauthorized', 'rate_limited', 'daily_limit', 'budget', 'budget_unknown', 'unavailable', 'network', 'timeout',
])

/**
 * Reply-To on the fallback, mirroring what the Worker sets for eno.vn. The fallback only exists on the
 * marketplace build, so this is only ever eno.vn's inbox. Sign-in mail gets NONE, as on the Worker:
 * its body is a live link or code, and a reply would carry it into the support inbox.
 */
const RESEND_REPLY_TO = 'support@eno.vn'

type ResendFallback = { key: string; from: string }

/**
 * eno.vn's Resend fallback, or null when there is none.
 *
 * ⛔ ALWAYS null ON THE SERVICES BUILD, WHATEVER ITS ENV HOLDS. IS_MARKETPLACE is inlined at build
 * time, so the forum image cannot reach Resend even with RESEND_API_KEY and MAIL_FROM set. eno.forum
 * is not verified in Resend, and the only sender it would take is eno.vn: a forum email would go out
 * as the licensed marketplace, the leak the header describes.
 */
function resendFallback(): ResendFallback | null {
  if (!IS_MARKETPLACE) return null
  const key = process.env.RESEND_API_KEY?.trim()
  const from = process.env.MAIL_FROM?.trim()
  return key && from ? { key, from } : null
}

let resendClient: { key: string; client: Resend } | null = null

/** One client per key, rebuilt only if the key in the env changes. */
function resendFor(key: string): Resend {
  if (resendClient?.key !== key) resendClient = { key, client: new Resend(key) }
  return resendClient.client
}

/** The edition this build signs as. The edition flag is inlined at build time: the image IS the edition. */
export function mailerEdition(): 'vn' | 'forum' {
  return EDITION === 'marketplace' ? 'vn' : 'forum'
}

/** `v1=` + hex HMAC-SHA256 over ts, edition, idempotency key and the body's SHA-256 — the Worker's contract. */
export function signMailerRequest(input: { key: string; ts: number; edition: string; idempotencyKey: string; body: string }): string {
  const bodyHash = createHash('sha256').update(input.body, 'utf8').digest('hex')
  return 'v1=' + createHmac('sha256', input.key).update(`${input.ts}\n${input.edition}\n${input.idempotencyKey}\n${bodyHash}`).digest('hex')
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

type MailerConfig = { ok: true; url: string; key: string } | { ok: false; code: 'disabled' | 'config' }

function mailerConfig(): MailerConfig {
  const url = process.env.MAILER_URL?.trim()
  const key = process.env.MAILER_KEY?.trim()
  if (!url || !key) return { ok: false, code: 'disabled' }
  try {
    const u = new URL(url)
    // The request carries a sign-in credential in its body: https only, except a local
    // `wrangler dev` on loopback.
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname))) return { ok: true, url, key }
  } catch { /* falls through */ }
  return { ok: false, code: 'config' }
}

/**
 * May this deployment send mail of this kind at all? The digest cron asks before looping its
 * recipients. Marketing is ALWAYS false: Cloudflare Email Sending is transactional-only, and its
 * suppression list is shared with sign-in. The Resend fallback does not change that: sendMailDetailed
 * refuses marketing before it picks a transport. Transactional mail is enabled when the Worker is
 * configured, or (eno.vn only) when the Resend fallback is.
 */
export function mailEnabled(purpose: 'transactional' | 'marketing' = 'transactional'): boolean {
  if (purpose === 'marketing') return false
  return mailerConfig().ok || resendFallback() !== null
}

/**
 * Recipients in logs are reduced to `a…e@gmail.com`: enough to tell two failures apart
 * while debugging a bounce, not enough to be a copy of the address book. Log retention
 * outlives the data that produced these lines, and one of the senders here carries a visa
 * result — an address that must not outlive its case.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  const domain = address.slice(at)
  const head = local.length > 1 ? `${local[0]}…${local[local.length - 1]}` : '*'
  return head + domain
}

function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream' // the Worker refuses it — say so there, not silently here
}

function codeForStatus(status: number): MailFailureCode {
  // A success status WITHOUT the Worker's `{ ok: true }` (an interstitial or proxy page answering 200;
  // a redirect cannot get here, fetch is `redirect: 'error'`) means the Worker did not answer at all.
  // That is an outage to retry and, on eno.vn, to fall back on, never a verdict on the message.
  if (status < 400) return 'unavailable'
  if (status === 401 || status === 403) return 'unauthorized'
  // Only a MAILER_URL that points at the wrong path, or a Worker that is not deployed there, gets a
  // 404 or 405: configuration, not a verdict on the message (so eno.vn falls back on it).
  if (status === 404 || status === 405) return 'config'
  if (status === 409) return 'idempotency_conflict'
  if (status === 413) return 'too_large'
  if (status === 422) return 'suppressed'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'invalid'
}

/** What the Worker answers — unknown until checked, because an edge error page can stand in for it. */
type WorkerReply = { ok?: unknown; code?: unknown; messageId?: unknown; deduped?: unknown }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A log line's fields as ONE line of JSON. Node prints a plain object through util.inspect
 * (`{ code: 'x' }`), which wraps a long object over several lines; the runbook greps these lines
 * (`"evt":"mail_fallback"`, `"transport":"resend"`), so each must be a single, stable string.
 */
const fields = (o: Record<string, unknown>) => JSON.stringify(o)

async function attempt(url: string, key: string, edition: string, idempotencyKey: string, body: string, timeoutMs: number): Promise<WorkerResult> {
  const ts = Math.floor(Date.now() / 1000)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-eno-edition': edition,
        'x-eno-timestamp': String(ts),
        'idempotency-key': idempotencyKey,
        'x-eno-signature': signMailerRequest({ key, ts, edition, idempotencyKey, body }),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      // A redirect would re-send a signed body carrying a live credential somewhere else.
      redirect: 'error',
    })
  } catch (e) {
    const name = (e as Error)?.name
    return { ok: false, code: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
  let data: WorkerReply | null = null
  try { data = (await res.json()) as WorkerReply } catch { /* an edge error page is HTML — the status decides */ }
  if (res.ok && data?.ok === true) {
    return { ok: true, messageId: typeof data.messageId === 'string' ? data.messageId : null, ...(data.deduped === true ? { deduped: true } : {}) }
  }
  const code = typeof data?.code === 'string' && KNOWN_CODES.has(data.code) ? (data.code as MailFailureCode) : codeForStatus(res.status)
  return { ok: false, code, status: res.status }
}

/** Resend's HTTP status → our code, for the log. Resend's 422 is a validation error, not a suppression. */
function codeForResendStatus(status: number): MailFailureCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 409) return 'idempotency_conflict'
  if (status === 413) return 'too_large'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'invalid'
}

/**
 * ONE attempt through Resend: eno.vn's fallback, same message, same idempotency key. No retry: the
 * Worker already had its own, and the deadline is what is left after it.
 */
async function sendViaResend(fb: ResendFallback, msg: MailMessage, cls: MailClass, idempotencyKey: string, timeoutMs: number): Promise<MailResult> {
  const signal = AbortSignal.timeout(timeoutMs)
  // ⚠️ `signal`, `redirect` and `cache` are not in the SDK's option type, but its post() spreads the
  // options into the fetch init (resend 6.x, dist/index.mjs `post`). mail.test.ts asserts the request
  // Resend receives carries all three, so an SDK change that drops them fails a test, not a sign-in.
  const options = { idempotencyKey, signal, redirect: 'error', cache: 'no-store' } as CreateEmailRequestOptions
  try {
    const { data, error } = await resendFor(fb.key).emails.send({
      from: fb.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
      ...(msg.attachments?.length
        ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType ?? contentTypeFor(a.filename) })) }
        : {}),
      ...(cls === 'signin' ? {} : { replyTo: RESEND_REPLY_TO }),
    }, options)
    if (error) {
      // The SDK folds a failed fetch (network, abort, a refused redirect) into statusCode null.
      if (typeof error.statusCode === 'number') return { ok: false, code: codeForResendStatus(error.statusCode), status: error.statusCode }
      return { ok: false, code: signal.aborted ? 'timeout' : error.statusCode === null ? 'network' : 'unavailable' }
    }
    return { ok: true, messageId: typeof data?.id === 'string' ? data.id : null, transport: 'resend' }
  } catch {
    return { ok: false, code: signal.aborted ? 'timeout' : 'network' }
  }
}

/**
 * Send one email and say what happened. NEVER THROWS: a failure is logged (with a masked
 * recipient) and returned as a code, so a caller that must not reveal WHY (sign-in) can still
 * collapse every code into one answer, and a caller that can degrade (the visa result) can see
 * `too_large` and send a link instead.
 *
 * The Worker first. On eno.vn only, when the Worker did not accept the message (FALLBACK_CODES) and
 * the deadline leaves room, Resend. A failure reports the WORKER's code: that is the verdict the
 * caller branches on, and Resend's own code is in the log line.
 */
export async function sendMailDetailed(msg: MailMessage): Promise<MailResult> {
  const who = maskEmail(String(msg.to ?? ''))
  const cls: MailClass = msg.class ?? 'transactional'
  const edition = mailerEdition()
  const context = { edition, class: cls, tag: msg.tag }
  try {
    if (cls === 'marketing') {
      console.warn('[mail] refused: marketing mail cannot go through Cloudflare Email Sending', who, fields(context))
      return { ok: false, code: 'marketing_refused' }
    }

    const idempotencyKey = msg.idempotencyKey ?? `m-${randomUUID()}`
    const hasFiles = !!msg.attachments?.length
    const body = JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
      ...(hasFiles
        ? { attachments: msg.attachments!.map((a) => ({ filename: a.filename, content: a.content, type: a.contentType ?? contentTypeFor(a.filename) })) }
        : {}),
      class: cls,
      ...(msg.tag ? { tag: msg.tag } : {}),
    })
    // Checked before either transport: the ceiling is the same whichever one sends, so a caller that
    // degrades on `too_large` (the visa result) behaves the same with or without the fallback.
    if (Buffer.byteLength(body, 'utf8') > MAILER_MAX_REQUEST_BYTES) {
      console.error('[mail] send failed', who, fields({ ...context, code: 'too_large', bytes: Buffer.byteLength(body, 'utf8') }))
      return { ok: false, code: 'too_large' }
    }

    const perAttempt = hasFiles ? MAILER_ATTACHMENT_TIMEOUT_MS : MAILER_TIMEOUT_MS
    const deadline = typeof msg.deadline === 'number' && Number.isFinite(msg.deadline) ? msg.deadline : null
    /** This attempt's timeout: the per-attempt ceiling, cut to what is left before the deadline. */
    const budget = () => (deadline === null ? perAttempt : Math.min(perAttempt, Math.floor(deadline - Date.now())))

    // ── 1. The Worker ──────────────────────────────────────────────────────────────────────────
    const cfg = mailerConfig()
    let attempts = 0
    let result: WorkerResult = cfg.ok ? { ok: false, code: 'timeout' } : { ok: false, code: cfg.code }
    if (cfg.ok && budget() >= MAILER_MIN_ATTEMPT_MS) {
      result = await attempt(cfg.url, cfg.key, edition, idempotencyKey, body, budget())
      attempts = 1
      if (!result.ok && !hasFiles && RETRYABLE.has(result.code) && budget() - RETRY_DELAY_MS >= MAILER_MIN_ATTEMPT_MS) {
        await sleep(RETRY_DELAY_MS)
        result = await attempt(cfg.url, cfg.key, edition, idempotencyKey, body, budget())
        attempts = 2
      }
    }
    if (result.ok) {
      console.log('[mail] sent', who, fields({ ...context, transport: 'worker', messageId: result.messageId, attempts, ...(result.deduped ? { deduped: true } : {}) }))
      return { ...result, transport: 'worker' }
    }
    const failed = { ...context, code: result.code, status: result.status, attempts }

    // ── 2. eno.vn only: Resend, when the Worker did not accept it ───────────────────────────────
    const fallback = FALLBACK_CODES.has(result.code) ? resendFallback() : null
    if (fallback) {
      const left = budget()
      if (left < MAILER_MIN_ATTEMPT_MS) {
        console.error('[mail] send failed', who, fields({ ...failed, fallback: 'no_time' }))
        return result
      }
      // ⛔ THE LINE TO ALERT ON, every time: the Worker refused or could not be reached, and eno.vn is
      // sending through Resend instead.
      console.warn('[mail] FALLBACK to Resend', who, fields({ ...failed, evt: 'mail_fallback' }))
      const viaResend = await sendViaResend(fallback, msg, cls, idempotencyKey, left)
      if (viaResend.ok) {
        console.log('[mail] sent', who, fields({ ...context, transport: 'resend', messageId: viaResend.messageId, workerCode: result.code }))
        return viaResend
      }
      console.error('[mail] send failed', who, fields({ ...failed, fallback: 'resend', fallbackCode: viaResend.code, fallbackStatus: viaResend.status }))
      return result
    }

    // eno.vn, a failure Resend would have taken, and no fallback configured: say so. A half-set
    // fallback (RESEND_API_KEY without MAIL_FROM, which the old code defaulted) otherwise looks
    // exactly like a deliberate absence of one.
    const unconfigured = IS_MARKETPLACE && FALLBACK_CODES.has(result.code) ? { fallback: 'unconfigured' } : null
    const hint = unconfigured ? [fields(unconfigured)] : []
    if (result.code === 'disabled') console.warn('[mail] MAILER_URL/MAILER_KEY not set — email disabled (skipped', who + ')', ...hint)
    else if (result.code === 'config' && attempts === 0) console.error('[mail] MAILER_URL is not an https URL — email disabled (skipped', who + ')', ...hint)
    else console.error('[mail] send failed', who, fields({ ...failed, ...unconfigured }))
    return result
  } catch (e) {
    console.error('[mail] send threw', who, fields({ ...context, error: (e as Error)?.name }))
    return { ok: false, code: 'unavailable' }
  }
}

/** Send one email. Returns true on success; never throws (logs + returns false). */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  return (await sendMailDetailed(msg)).ok
}
