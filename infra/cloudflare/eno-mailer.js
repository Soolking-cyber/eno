/**
 * eno-mailer — the PRIMARY way eno.vn and eno.forum send email (Cloudflare Email Sending).
 *
 * ⛔ OWNER DECISION 2026-09-23: "resend fallback". This Worker is the PRIMARY path for both editions.
 * When it does not accept a message (unreachable, 5xx, 429, 401/403, a config error), src/lib/mail.ts
 * on eno.vn ONLY hands the same message to Resend. eno.forum has no fallback: if this Worker is down,
 * the forum sends no mail. Deploy with `deploy-mailer.sh` beside this file; the runbook is
 * `eno-mailer.README.md`.
 *
 * WHAT IT IS. A module Worker on workers.dev with ONE route, `POST /v1/send`. Each app container
 * signs its request with ITS OWN edition's key; the Worker picks From and Reply-To from the edition
 * whose key VERIFIED, never from anything the caller sends. So a leaked forum key can only ever
 * send as eno.forum, and nothing a caller puts in the body can make eno.forum mail arrive as the
 * licensed marketplace (the leak src/lib/mail.ts used to carry: every forum mail arrived From
 * no-reply@eno.vn). Each send_email binding is also restricted by `allowed_sender_addresses` to its
 * own address, which is a second guard the code cannot talk its way around.
 *
 * ⚠️ WORKERS.DEV, NOT A ROUTE ON EITHER ZONE. Bot Fight Mode is ON for eno.vn and eno.forum and
 * cannot be skipped on the Free plan; it would challenge the box's server-to-server POSTs. The
 * workers.dev host sits outside both zones. Preview/version URLs are DISABLED by the deploy script:
 * an old version keeps its own secrets, so a live version URL would keep accepting a rotated-out key.
 *
 * REQUEST CONTRACT (src/lib/mail.ts is the one client; scripts/mailer-smoke.mjs the other):
 *   X-Eno-Edition:   vn | forum
 *   X-Eno-Timestamp: unix seconds, within ±300 s of the Worker's clock
 *   Idempotency-Key: [A-Za-z0-9:._-]{8,128}
 *   X-Eno-Signature: v1=hex(HMAC-SHA256(key, ts + "\n" + edition + "\n" + idemKey + "\n" + sha256hex(body)))
 *   body (JSON):     { to, subject, html, text?, headers?, attachments?, class, tag? }
 * Every authentication failure answers the same 401 `unauthorized`, so a caller learns nothing about
 * which part was wrong. Responses: `{ ok: true, messageId, deduped? }` or `{ ok: false, code }`.
 *
 * ⛔ AUTHENTICATION COMES BEFORE ANY CONFIGURATION CHECK. An edition with no key configured does not
 * answer `500 config` — that would tell anyone on the public workers.dev URL which edition is set up.
 * With no key there is simply nothing to verify against, so the request gets the same 401 as a bad
 * signature, and the log line says `reason: "no_key"` for the operator. The same goes for an `_OLD`
 * key on its own: that is a half-finished rotation, not a configuration, and it verifies nothing.
 * Every later `config` answer (a missing binding) is given only to a caller who has already signed.
 *
 * ⛔ TRANSACTIONAL ONLY. Cloudflare Email Sending is not for marketing, and the suppression list is
 * ACCOUNT-WIDE: one spam complaint about a newsletter would block that address's sign-in links on
 * BOTH editions, forever (complaint suppressions do not expire). `class: 'marketing'` is refused
 * here (403) as well as in the app.
 *
 * ⛔ THE DAILY BUDGET PROTECTS SIGN-IN. The account quota (1,000/day when measured on 2026-09-23)
 * is shared by both editions and every kind of mail. Background mail (`transactional`: KYC and
 * business-verification outcomes, visa results) is refused once the day's total reaches
 * DAILY_QUOTA − PRIORITY_RESERVE; `signin` stops at DAILY_QUOTA − SECURITY_RESERVE, so a sign-in
 * spray cannot swallow the payout-change alert either; `security` may use the whole quota.
 * ⚠️ THE COUNTERS ARE KV, SO THEY ARE A BRAKE, NOT A METER. KV is last-write-wins: two sends in the
 * same moment both read N and both write N+1, so a burst UNDER-counts. It is here so a loop or a
 * backlog of background mail stops well before sign-in starves; it is not an exact tally. The
 * upgrade, if it ever needs to be exact, is a Durable Object.
 *
 * ⚠️ A COUNTER THAT CANNOT BE READ FAILS OPEN FOR EVERY CLASS — WITH A SMALL BRAKE ON BACKGROUND
 * MAIL ONLY, AND OUT LOUD. Background mail used to fail closed here, and that was the wrong trade: a
 * visa result or a KYC outcome is sent exactly once and has no re-send path, so a KV incident
 * silently lost every one of them to guard against a quota scare that is far less likely. Now, while
 * KV is unreadable, each isolate keeps its OWN in-memory tally for the UTC day and stops BACKGROUND
 * mail (`transactional`) once that tally reaches its share of BLIND_QUOTA (100).
 * ⛔ SIGN-IN AND SECURITY MAIL ARE EXEMPT FROM THAT CAP (owner, 2026-09-23): they are never refused
 * because a counter could not be read. They still count in the tally (so background mail stops
 * sooner), and Cloudflare's own account quota still applies to them (`429 daily_limit`). A per-isolate
 * guess is no reason to lock a user out of their account or hide a payout change from them.
 * Every request in that state logs `evt:"budget_unknown"` at error level (`action: sending` or
 * `refused`, and `exempt: true` for sign-in and security), and a refusal answers
 * `429 budget_unknown`, so nothing is dropped without a trace in both the Worker's logs and the
 * app's. The in-memory tally is never written back to KV: a long incident under-counts the day,
 * which is the price of not losing the mail.
 *
 * IDEMPOTENCY is best effort and fails OPEN: a hit on `idem:<edition>:<key>` returns the stored
 * messageId without sending; any KV error is logged and the send goes ahead. It exists so a retry of
 * THE SAME REQUEST does not mail the same thing twice — so the record holds the body's SHA-256 next to
 * the messageId, and a key that comes back with a DIFFERENT body answers `409 idempotency_conflict`
 * rather than a deduped 200. (That is exactly how a corrected e-Visa used to vanish: the desk
 * re-uploaded a fixed PDF, the key was per case, and the Worker reported the WRONG visa's messageId
 * as success.) The app treats the 409 as a failure, and never retries it through Resend on eno.vn:
 * the key has already sent a different body, so a second provider would double-send.
 *
 * LOGS: one JSON line per request — edition, class, tag, a MASKED recipient (`a…e@gmail.com`), the
 * code, the messageId and the day's counters. Never the subject, the body, an attachment, the
 * signature or a key: a sign-in mail's body IS a live credential.
 */

/** 4.9 MiB. Keep in step with MAILER_MAX_REQUEST_BYTES in src/lib/mail.ts. */
const MAX_BODY_BYTES = 5138022
const MAX_SKEW_SEC = 300
const IDEM_TTL_SEC = 24 * 60 * 60
const COUNTER_TTL_SEC = 48 * 60 * 60
/** Per isolate, per UTC day: the most this isolate sends while the KV counters cannot be read. */
const BLIND_QUOTA = 100
/**
 * Verified against when an edition has NO usable key, so an unconfigured edition costs the same
 * HMAC as a configured one and answers the same 401. It can never authenticate anything: the
 * result is discarded when no real key exists (see step 2 in fetch). Not random on purpose —
 * Workers forbid generating random values at global scope.
 */
const UNCONFIGURED_KEY = 'eno-mailer:no-key-configured'

const EDITIONS = {
  vn: {
    binding: 'EMAIL_VN',
    keys: ['MAILER_KEY_VN', 'MAILER_KEY_VN_OLD'],
    from: { email: 'no-reply@eno.vn', name: 'eno.vn' },
    replyTo: 'support@eno.vn',
  },
  forum: {
    binding: 'EMAIL_FORUM',
    keys: ['MAILER_KEY_FORUM', 'MAILER_KEY_FORUM_OLD'],
    from: { email: 'no-reply@eno.forum', name: 'eno.forum' },
    replyTo: 'support@eno.forum',
  },
}

const CLASSES = ['signin', 'security', 'transactional']
const IDEM_RE = /^[A-Za-z0-9:._-]{8,128}$/
const SIG_RE = /^v1=([0-9a-f]{64})$/
const TS_RE = /^\d{1,12}$/
const TAG_RE = /^[a-z0-9_-]{1,40}$/
// One mailbox, nothing a header parser could split into two: no list separators, no display-name
// brackets or quotes, no whitespace or control characters.
const ADDRESS_RE = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]{2,}$/
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const X_HEADER_RE = /^X-[A-Za-z0-9_-]{1,98}$/
const NAMED_HEADERS = new Set(['list-unsubscribe', 'list-unsubscribe-post', 'auto-submitted'])
const ATTACHMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/** Binding error code → [HTTP status, our code]. Anything unlisted is 503 `unavailable`. */
const BINDING_ERRORS = {
  E_RECIPIENT_SUPPRESSED: [422, 'suppressed'],
  E_CONTENT_TOO_LARGE: [413, 'too_large'],
  E_VALIDATION_ERROR: [400, 'invalid'],
  E_FIELD_MISSING: [400, 'invalid'],
  E_TOO_MANY_RECIPIENTS: [400, 'invalid'],
  E_TOO_MANY_ATTACHMENTS: [400, 'invalid'],
  E_HEADER_NOT_ALLOWED: [400, 'invalid'],
  E_HEADER_USE_API_FIELD: [400, 'invalid'],
  E_HEADER_VALUE_INVALID: [400, 'invalid'],
  E_HEADER_VALUE_TOO_LONG: [400, 'invalid'],
  E_HEADER_NAME_INVALID: [400, 'invalid'],
  E_HEADERS_TOO_LARGE: [400, 'invalid'],
  E_HEADERS_TOO_MANY: [400, 'invalid'],
  E_RATE_LIMIT_EXCEEDED: [429, 'rate_limited'],
  E_DAILY_LIMIT_EXCEEDED: [429, 'daily_limit'],
  // Configuration, not the caller: the domain is not onboarded, the binding's sender allowlist
  // disagrees with EDITIONS above, or (before onboarding) the recipient is not a verified address.
  E_SENDER_NOT_VERIFIED: [500, 'config'],
  E_SENDER_DOMAIN_NOT_AVAILABLE: [500, 'config'],
  E_RECIPIENT_NOT_ALLOWED: [500, 'config'],
  E_INTERNAL_SERVER_ERROR: [503, 'unavailable'],
  E_DELIVERY_FAILED: [503, 'unavailable'],
}

const encoder = new TextEncoder()

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

/** `a…e@gmail.com` — the same reduction src/lib/mail.ts applies. Never log a whole address. */
function maskEmail(address) {
  if (typeof address !== 'string') return undefined
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  return (local.length > 1 ? `${local[0]}…${local[local.length - 1]}` : '*') + address.slice(at)
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(text) {
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Constant-time equality. Workers ship `crypto.subtle.timingSafeEqual`; the loop is only for a
 * runtime without it (the unit tests run in Node). Both sides are 32-byte HMACs, so the length
 * check leaks nothing.
 */
function timingSafeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b)
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function hmac(key, message) {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(message)))
}

/**
 * Read the body without ever holding more than the cap. A chunked request carries no
 * Content-Length, so the header check alone would let an unauthenticated caller make the Worker
 * buffer anything up to the platform's request limit before refusing it.
 */
async function readCapped(request, max) {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      try { await reader.cancel() } catch { /* already refusing */ }
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

function intVar(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** The day's limits, from plain-text vars so a quota raise is a redeploy, not a code change. */
function limitsFrom(env) {
  const quota = intVar(env.DAILY_QUOTA, 1000)
  const priorityReserve = Math.min(intVar(env.PRIORITY_RESERVE, 400), quota)
  const securityReserve = Math.min(intVar(env.SECURITY_RESERVE, 25), priorityReserve)
  return { quota, priorityReserve, securityReserve }
}

/** The total a class may send UP TO today. Background first, sign-in next, security last. */
function ceilingFor(cls, limits) {
  if (cls === 'transactional') return limits.quota - limits.priorityReserve
  if (cls === 'signin') return limits.quota - limits.securityReserve
  return limits.quota
}

/**
 * The limits applied to an isolate's in-memory tally while KV is unreadable, scaled down to
 * BLIND_QUOTA (never above the real quota: DAILY_QUOTA=0 still stops background mail). Only
 * background mail is refused against them; sign-in and security are exempt (BLIND_EXEMPT).
 */
function blindLimitsFrom(limits) {
  if (limits.quota <= 0) return { quota: 0, priorityReserve: 0, securityReserve: 0 }
  const quota = Math.min(BLIND_QUOTA, limits.quota)
  const scale = quota / limits.quota
  return {
    quota,
    priorityReserve: Math.min(quota, Math.ceil(limits.priorityReserve * scale)),
    securityReserve: Math.min(quota, Math.ceil(limits.securityReserve * scale)),
  }
}

/**
 * The classes an unreadable counter never refuses (owner, 2026-09-23). Cloudflare's own quota still
 * applies to them; see the header.
 */
const BLIND_EXEMPT = new Set(['signin', 'security'])

/** This isolate's own tally, used ONLY while the KV counters cannot be read. Resets each UTC day. */
let blind = { day: '', total: 0, signin: 0, security: 0, transactional: 0 }

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/** What an idempotency record holds: the messageId AND the hash of the body it was sent for. */
function idemRecord(messageId, bodyHash) {
  return JSON.stringify({ m: messageId, h: bodyHash })
}

/** A stored record, or null for one this Worker did not write (it is then ignored — fails open). */
function parseIdemRecord(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const r = JSON.parse(value)
    if (r && typeof r === 'object' && typeof r.h === 'string' && /^[0-9a-f]{64}$/.test(r.h)) {
      return { messageId: typeof r.m === 'string' ? r.m : null, bodyHash: r.h }
    }
  } catch { /* not ours */ }
  return null
}

async function readCounters(kv, day) {
  const values = await Promise.all(CLASSES.map((c) => kv.get(`cnt:${day}:${c}`)))
  const counts = { day }
  let total = 0
  CLASSES.forEach((c, i) => {
    const n = intVar(values[i], 0)
    counts[c] = n
    total += n
  })
  counts.total = total
  return counts
}

/** Validate the signed body. Returns { message } or { field } naming what was wrong. */
function validatePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { field: 'body' }
  if (typeof p.to !== 'string' || p.to.length > 254 || !ADDRESS_RE.test(p.to)) return { field: 'to' }
  if (typeof p.subject !== 'string' || p.subject.length < 1 || p.subject.length > 998 || /[\r\n]/.test(p.subject)) return { field: 'subject' }
  if (typeof p.html !== 'string' || p.html.length < 1) return { field: 'html' }
  if (p.text !== undefined && p.text !== null && typeof p.text !== 'string') return { field: 'text' }
  if (p.tag !== undefined && p.tag !== null && (typeof p.tag !== 'string' || !TAG_RE.test(p.tag))) return { field: 'tag' }

  let headers
  if (p.headers !== undefined && p.headers !== null) {
    if (typeof p.headers !== 'object' || Array.isArray(p.headers)) return { field: 'headers' }
    headers = {}
    for (const [name, value] of Object.entries(p.headers)) {
      const allowed = NAMED_HEADERS.has(name.toLowerCase()) || X_HEADER_RE.test(name)
      if (!allowed || typeof value !== 'string' || !value || encoder.encode(value).byteLength > 2048 || /[\r\n]/.test(value)) {
        return { field: 'headers' }
      }
      headers[name] = value
    }
  }

  let attachments
  if (p.attachments !== undefined && p.attachments !== null) {
    if (!Array.isArray(p.attachments) || p.attachments.length > 1) return { field: 'attachments' }
    attachments = []
    for (const a of p.attachments) {
      if (!a || typeof a !== 'object') return { field: 'attachments' }
      if (typeof a.filename !== 'string' || !FILENAME_RE.test(a.filename)) return { field: 'attachments' }
      if (typeof a.type !== 'string' || !ATTACHMENT_TYPES.has(a.type)) return { field: 'attachments' }
      if (typeof a.content !== 'string' || !a.content || a.content.length % 4 !== 0 || !BASE64_RE.test(a.content)) {
        return { field: 'attachments' }
      }
      attachments.push({ filename: a.filename, type: a.type, content: a.content, disposition: 'attachment' })
    }
    if (!attachments.length) attachments = undefined
  }

  return {
    message: {
      to: p.to,
      subject: p.subject,
      html: p.html,
      ...(typeof p.text === 'string' && p.text ? { text: p.text } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(attachments ? { attachments } : {}),
    },
  }
}

const mailer = {
  async fetch(request, env, ctx) {
    const started = Date.now()
    const log = { evt: 'mail' }
    const done = (status, body, level = 'log') => {
      log.status = status
      log.code = body.ok ? 'sent' : body.code
      log.ms = Date.now() - started
      console[level](JSON.stringify(log))
      return json(status, body)
    }

    const url = new URL(request.url)
    if (url.pathname !== '/v1/send') return json(404, { ok: false, code: 'not_found' })
    if (request.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed' }, { allow: 'POST' })

    // ── 1. Cheap header checks, before a byte of the body is read ─────────────────────────────
    // ⛔ Nothing here reads a key or a binding: which editions are CONFIGURED is not something an
    // unauthenticated caller gets to learn. The first configuration check is after step 2.
    const edition = request.headers.get('x-eno-edition') || ''
    const cfg = Object.prototype.hasOwnProperty.call(EDITIONS, edition) ? EDITIONS[edition] : null
    if (!cfg) { log.reason = 'edition'; return done(401, { ok: false, code: 'unauthorized' }, 'warn') }
    log.edition = edition

    const tsText = request.headers.get('x-eno-timestamp') || ''
    const ts = TS_RE.test(tsText) ? Number(tsText) : NaN
    if (!Number.isFinite(ts) || Math.abs(Math.floor(started / 1000) - ts) > MAX_SKEW_SEC) {
      log.reason = 'timestamp'
      return done(401, { ok: false, code: 'unauthorized' }, 'warn')
    }

    const sigMatch = SIG_RE.exec(request.headers.get('x-eno-signature') || '')
    if (!sigMatch) { log.reason = 'signature'; return done(401, { ok: false, code: 'unauthorized' }, 'warn') }

    const idemKey = request.headers.get('idempotency-key') || ''
    if (!IDEM_RE.test(idemKey)) { log.reason = 'idempotency_key'; return done(400, { ok: false, code: 'invalid', field: 'idempotency_key' }, 'warn') }

    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return done(413, { ok: false, code: 'too_large' }, 'warn')
    }

    // ── 2. Body, capped, then the signature over it ───────────────────────────────────────────
    const raw = await readCapped(request, MAX_BODY_BYTES)
    if (!raw) return done(413, { ok: false, code: 'too_large' }, 'warn')

    const bodyHash = hex(await crypto.subtle.digest('SHA-256', raw))
    const signed = `${ts}\n${edition}\n${idemKey}\n${bodyHash}`
    const provided = fromHex(sigMatch[1])
    // The PRIMARY key must exist. An `_OLD` key alone is a half-finished rotation, not a
    // configuration, so without the primary NOTHING verifies — including a request signed with
    // that old key. The answer is the ordinary 401; only the log says why.
    const primary = env[cfg.keys[0]]
    const hasPrimary = typeof primary === 'string' && primary.length > 0
    const keys = hasPrimary ? cfg.keys.map((name) => env[name]).filter((k) => typeof k === 'string' && k.length > 0) : []
    let verified = false
    for (const key of keys.length ? keys : [UNCONFIGURED_KEY]) {
      // Every configured key is tried, a match does not short-circuit, so the time taken does not
      // say which key (current or rotating-out) matched. With no key, one throwaway HMAC keeps the
      // timing of an unconfigured edition the same as a configured one, and its result is ignored.
      const match = timingSafeEqual(await hmac(key, signed), provided)
      if (match && keys.length) verified = true
    }
    if (!verified) {
      log.reason = hasPrimary ? 'signature' : 'no_key'
      return done(401, { ok: false, code: 'unauthorized' }, hasPrimary ? 'warn' : 'error')
    }

    // ── 3. The message ────────────────────────────────────────────────────────────────────────
    let payload
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch {
      return done(400, { ok: false, code: 'invalid', field: 'json' }, 'warn')
    }
    const cls = payload && typeof payload === 'object' ? payload.class : undefined
    log.class = typeof cls === 'string' ? cls.slice(0, 20) : undefined
    log.tag = payload && typeof payload.tag === 'string' && TAG_RE.test(payload.tag) ? payload.tag : undefined
    log.to = payload && typeof payload.to === 'string' ? maskEmail(payload.to) : undefined
    if (cls === 'marketing') return done(403, { ok: false, code: 'marketing_refused' }, 'warn')
    if (!CLASSES.includes(cls)) return done(400, { ok: false, code: 'invalid', field: 'class' }, 'warn')

    const checked = validatePayload(payload)
    if (!checked.message) return done(400, { ok: false, code: 'invalid', field: checked.field }, 'warn')

    // Configuration, now that the caller has proved who it is.
    const binding = env[cfg.binding]
    if (!binding || typeof binding.send !== 'function') {
      log.reason = 'no_binding'
      return done(500, { ok: false, code: 'config' }, 'error')
    }

    const kv = env.MAILER_KV
    const idemStoreKey = `idem:${edition}:${idemKey}`

    // ── 4. Idempotency (best effort, fails open) — but never across two different bodies ────────
    if (kv) {
      try {
        const prior = parseIdemRecord(await kv.get(idemStoreKey))
        if (prior && prior.bodyHash !== bodyHash) {
          // The same key for a DIFFERENT message. A deduped 200 here would report someone else's
          // send as this one's success and deliver nothing (the corrected-visa bug); say so instead.
          log.reason = 'idempotency_conflict'
          return done(409, { ok: false, code: 'idempotency_conflict' }, 'error')
        }
        if (prior) {
          log.messageId = prior.messageId
          log.deduped = true
          return done(200, { ok: true, messageId: prior.messageId, deduped: true })
        }
      } catch (e) {
        log.idem = 'read_failed'
        console.warn(JSON.stringify({ evt: 'kv_error', op: 'idem_get', message: String(e?.message || e).slice(0, 200) }))
      }
    }

    // ── 5. Daily budget ──────────────────────────────────────────────────────────────────────
    const limits = limitsFrom(env)
    const day = utcDay(started)
    let counts = null
    try {
      if (!kv) throw new Error('MAILER_KV not bound')
      counts = await readCounters(kv, day)
    } catch (e) {
      console.warn(JSON.stringify({ evt: 'kv_error', op: 'budget_get', message: String(e?.message || e).slice(0, 200) }))
    }
    // Set when this request took a place in the isolate's in-memory tally (KV unreadable), so a
    // send the provider then refuses gives it back.
    let blindHeld = false
    if (counts) {
      log.budget = { ...counts, quota: limits.quota }
      if (counts.total >= ceilingFor(cls, limits)) return done(429, { ok: false, code: 'budget' }, 'warn')
    } else {
      // ⛔ BUDGET UNKNOWN: FAIL OPEN, BRAKED PER ISOLATE FOR BACKGROUND MAIL, NEVER QUIETLY. See the
      // header: sign-in and security are exempt from the cap and are never refused here.
      if (blind.day !== day) blind = { day, total: 0, signin: 0, security: 0, transactional: 0 }
      const bl = blindLimitsFrom(limits)
      const exempt = BLIND_EXEMPT.has(cls)
      const cap = exempt ? null : ceilingFor(cls, bl)
      const refused = cap !== null && blind.total >= cap
      // The check and the reservation are one synchronous step, so two requests on this isolate
      // cannot both take the last place.
      if (!refused) { blind.total += 1; blind[cls] += 1; blindHeld = true }
      log.budget = { unknown: true, isolate: { signin: blind.signin, security: blind.security, transactional: blind.transactional, total: blind.total }, quota: bl.quota }
      console.error(JSON.stringify({ evt: 'budget_unknown', action: refused ? 'refused' : 'sending', class: cls, day, isolateTotal: blind.total, cap, ...(exempt ? { exempt: true } : {}) }))
      if (refused) return done(429, { ok: false, code: 'budget_unknown' }, 'error')
    }

    // ── 6. Send, as the edition that signed and nothing else ──────────────────────────────────
    const message = {
      ...checked.message,
      from: cfg.from,
      // ⚠️ NO Reply-To ON SIGN-IN MAIL. Its body is a live magic link or code; a user who hits
      // Reply would carry that credential into the support inbox, where anyone reading it could
      // sign in as them. Their reply goes to no-reply@ instead. ⚠️ Where it goes from THERE is
      // per edition and must be proven, not assumed: eno.vn's Email Routing catch-all was set to
      // drop when last measured, but eno.forum's inbound is PrivateEmail, and a catch-all or alias
      // on either would put the link in a staff mailbox. eno-mailer.README.md step 6 replies to a sign-in smoke message on BOTH
      // editions to check exactly this before cutover.
      ...(cls === 'signin' ? {} : { replyTo: cfg.replyTo }),
    }

    let messageId
    try {
      const result = await binding.send(message)
      messageId = result && typeof result.messageId === 'string' ? result.messageId : null
    } catch (e) {
      // Only into the SAME day's tally: a request that crossed UTC midnight while this send was in
      // flight has already reset `blind`, and a refund there would push the new day below zero.
      if (blindHeld && blind.day === day) { blind.total -= 1; blind[cls] -= 1 }
      const bindingCode = e && typeof e.code === 'string' ? e.code : 'UNKNOWN'
      const [status, code] = BINDING_ERRORS[bindingCode] || [503, 'unavailable']
      log.bindingCode = bindingCode
      return done(status, { ok: false, code }, status >= 500 ? 'error' : 'warn')
    }
    log.messageId = messageId

    // ── 7. Bookkeeping, off the response path ─────────────────────────────────────────────────
    const bookkeeping = []
    if (kv) {
      bookkeeping.push(
        kv.put(idemStoreKey, idemRecord(messageId, bodyHash), { expirationTtl: IDEM_TTL_SEC }).catch((e) =>
          console.warn(JSON.stringify({ evt: 'kv_error', op: 'idem_put', message: String(e?.message || e).slice(0, 200) }))),
      )
      if (counts) {
        const next = counts[cls] + 1
        bookkeeping.push(
          kv.put(`cnt:${day}:${cls}`, String(next), { expirationTtl: COUNTER_TTL_SEC }).catch((e) =>
            console.warn(JSON.stringify({ evt: 'kv_error', op: 'budget_put', message: String(e?.message || e).slice(0, 200) }))),
        )
        const before = counts.total
        const after = before + 1
        log.budget = { ...counts, [cls]: next, total: after, quota: limits.quota }
        for (const [pct, mark] of [[50, limits.quota * 0.5], [80, limits.quota * 0.8], ['background_closed', ceilingFor('transactional', limits)]]) {
          if (before < mark && after >= mark) {
            console.warn(JSON.stringify({ evt: 'budget_threshold', threshold: pct, day, total: after, quota: limits.quota }))
          }
        }
      }
    }
    const settle = Promise.all(bookkeeping)
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(settle)
    else await settle

    return done(200, { ok: true, messageId })
  },
}

export default mailer
