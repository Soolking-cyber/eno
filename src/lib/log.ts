/**
 * STRUCTURED LOGGING FOR CLOUD RUN — no dependency, no agent, no vendor.
 *
 * ⚠️ WHY THIS EXISTS. Before 2026-08-05 this codebase had 265 bare `console.*` calls and NO error
 * tracking of any kind — grep for sentry|opentelemetry|datadog|pino|winston across src/ and
 * package.json returns nothing. The errors were being noticed; they just left as unstructured text,
 * which Cloud Logging cannot group, filter, correlate or route. A user-reported failure could not be
 * traced to a log line, and a moderation write that failed silently looked exactly like one that
 * succeeded.
 *
 * ⚠️ AND WHY IT IS FORTY LINES RATHER THAN A DEPENDENCY. This app runs on Cloud Run, which already
 * ships every stdout/stderr line to Cloud Logging. Cloud Logging parses a line that is a single JSON
 * object and promotes known fields into the LogEntry; Error Reporting then ingests entries at ERROR
 * severity. So the entire integration is "print the right JSON shape" — an agent, a collector or an
 * SDK would add cost, cold-start weight and a second failure mode for nothing.
 *
 * The field contract is not guesswork; it was read from the Google docs on 2026-08-05:
 *   · `severity`      — DEBUG | INFO | WARNING | ERROR | CRITICAL, promoted to LogEntry.severity
 *   · `message`       — the human line; Error Reporting also accepts `stack_trace` / `exception`
 *   · `stack_trace`   — a real stack here is what makes Error Reporting group the failure
 *   · `@type`         — REQUIRED for a text-only error with no stack, optional when a stack exists.
 *                       Set unconditionally on errors below: it costs 80 bytes and removes the
 *                       "why did that one not appear in Error Reporting" class of question.
 *   · `httpRequest`, `logging.googleapis.com/trace`, `.../spanId`, `.../labels` — recognised too.
 *
 * ⚠️ IT MUST NEVER THROW. This runs on the failure path: a logger that throws while reporting an
 * error turns a handled problem into a 500 and destroys the evidence. Everything below is
 * defensive — a circular `ctx`, a getter that throws, a BigInt, an exotic `err` — and the last
 * resort still prints something.
 *
 * ⚠️ IT REDACTS. `CLAUDE.md` records that Prisma query logs carry seller phone numbers, and WS1
 * fixed a route that logged a whole phone number during an outage. Context values are scrubbed by
 * KEY (phone, email, token, secret, …) and by SHAPE (anything that looks like a VN phone or an
 * email), because the point of a shared logger is that the redaction happens once instead of at 265
 * call sites that each have to remember.
 */

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'

/** Structured context. Keep it flat and small — it is indexed, not archived. */
export type LogContext = Record<string, unknown>

const IS_PROD = process.env.NODE_ENV === 'production'

/** Error Reporting's marker for an event with no stack of its own. */
const REPORTED_ERROR = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent'

/**
 * Keys whose VALUE is never safe to print, matched case-insensitively as a substring so
 * `sellerPhone`, `user_email` and `refreshToken` are all covered without enumerating them.
 */
const SECRET_KEY_RE = /(phone|email|token|secret|password|passwd|authorization|cookie|apikey|api_key|salt|pepper|otp|jwt|credential|ssn|passport)/i

/** Values that look like contact details even under an innocent key. */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const PHONE_RE = /(?:\+?84|0)\d{8,10}\b/g

/** Keep a redacted value useful for debugging without being identifying. */
function maskString(s: string): string {
  return s.replace(EMAIL_RE, (m) => `${m.slice(0, 2)}***@***`).replace(PHONE_RE, (m) => `${m.slice(0, 4)}***`)
}

/**
 * Redact a context object one level deep, then a bounded recursion. Depth is capped because a log
 * line is a signal, not a heap dump — and because an unbounded walk over a Prisma model is how a
 * logger starts costing more than the request it describes.
 */
function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return maskString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return { name: value.name, message: maskString(value.message) }
  if (depth >= 3) return '[depth]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    // ⚠️ KEYS FIRST, THEN READ EACH VALUE INSIDE THE try — NOT `Object.entries`.
    // `Object.entries` invokes every getter as it builds the array, so a property that throws blows
    // up BEFORE any per-key guard can catch it, and the whole log line degrades to the last-resort
    // branch. Caught by the test for exactly that case; a hostile or merely lazy getter is ordinary
    // in ORM rows and framework objects, which is what tends to get passed to a logger.
    let keys: string[] = []
    try { keys = Object.keys(value as object) } catch { return '[unreadable]' }
    for (const k of keys) {
      if (SECRET_KEY_RE.test(k)) { out[k] = '[redacted]'; continue }
      try { out[k] = redact((value as Record<string, unknown>)[k], depth + 1) } catch { out[k] = '[unreadable]' }
    }
    return out
  }
  return undefined // functions, symbols — nothing a log line wants
}

/** JSON.stringify that cannot throw, whatever it is handed. */
function safeStringify(payload: Record<string, unknown>): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(payload, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]'
        seen.add(v)
      }
      return v
    })
  } catch {
    return JSON.stringify({ severity: 'ERROR', message: '[log serialisation failed]' })
  }
}

function normaliseError(err: unknown): { message: string; stack?: string; name?: string; digest?: string } {
  if (err instanceof Error) {
    return {
      message: maskString(err.message || err.name),
      stack: err.stack ? maskString(err.stack) : undefined,
      name: err.name,
      /**
       * ⚠️ THE DIGEST IS THE WHOLE POINT OF THE REFERENCE CODE ON THE ERROR SCREEN.
       * Next attaches `digest` to the error it hands `onRequestError`, and `src/app/error.tsx`
       * shows that same string to the user as "Reference". Carrying it here is what makes the two
       * ends meet: a support message quoting the code resolves to one log entry. An earlier version
       * of this function destructured only message/stack/name, so the digest was dropped and the
       * promise on the error screen was false — caught by a reviewer, and it would have been
       * discovered otherwise only by someone searching for a code that was never logged.
       */
      digest: typeof (err as Error & { digest?: unknown }).digest === 'string'
        ? String((err as Error & { digest?: unknown }).digest)
        : undefined,
    }
  }
  if (typeof err === 'string') return { message: maskString(err) }
  try { return { message: maskString(JSON.stringify(err)) } } catch { return { message: String(err) } }
}

function emit(severity: Severity, message: string, ctx?: LogContext, extra?: Record<string, unknown>): void {
  try {
    /**
     * ⚠️ CONTEXT GOES IN FIRST, RESERVED FIELDS LAST, AND THE ORDER IS LOAD-BEARING.
     * These keys are a contract with Cloud Logging: `severity` decides routing and alerting,
     * `message` is what the console displays, `@type` is what Error Reporting ingests on. An
     * earlier version assigned the context OVER them, so an innocent
     * `logError(e, { message: 'while saving' })` would replace the real error text — or worse,
     * `{ severity: 'low' }` would produce an unroutable entry that quietly never alerts. Caller
     * context can never be trusted to avoid a four-word English noun, so the logger wins instead.
     */
    const payload: Record<string, unknown> = {}
    if (ctx) {
      const r = redact(ctx)
      if (r && typeof r === 'object') Object.assign(payload, r)
    }
    Object.assign(payload, { severity, message: maskString(message), ...extra })
    /**
     * ⚠️ DEV PRINTS HUMAN TEXT, PRODUCTION PRINTS JSON, AND THAT IS NOT A COSMETIC CHOICE.
     * A wall of JSON in `next dev` is unreadable enough that people stop reading it, which is how
     * a logger gets bypassed. Only the deployed process needs the machine shape.
     */
    if (!IS_PROD) {
      const tail = ctx && Object.keys(ctx).length ? ` ${safeStringify(redact(ctx) as Record<string, unknown>)}` : ''
      const line = `${severity} ${message}${tail}`
      if (severity === 'ERROR' || severity === 'CRITICAL') console.error(line, extra?.stack_trace ?? '')
      else if (severity === 'WARNING') console.warn(line)
      else console.log(line)
      return
    }
    const line = safeStringify(payload)
    if (severity === 'ERROR' || severity === 'CRITICAL') console.error(line)
    else console.log(line)
  } catch {
    // Last resort. Never let the logger be the thing that fails.
    try { console.error(`[log] emit failed for: ${message}`) } catch { /* nothing left to do */ }
  }
}

/**
 * Report a caught error. `ctx.op` is the one field worth always setting — it is what makes a
 * failure greppable and what Error Reporting groups on when the stack is shallow.
 *
 *   catch (e) { logError(e, { op: 'trust.record', profileId }) }
 */
export function logError(err: unknown, ctx?: LogContext): void {
  const { message, stack, name, digest } = normaliseError(err)
  emit('ERROR', message, ctx, {
    ...(stack ? { stack_trace: stack } : {}),
    ...(name ? { errorName: name } : {}),
    // The code shown to the user on src/app/error.tsx. Searchable in Cloud Logging as `digest`.
    ...(digest ? { digest } : {}),
    // Harmless when a stack is present, REQUIRED when it is not — so it is unconditional.
    '@type': REPORTED_ERROR,
  })
}

/** Something recoverable that an operator should still be able to find. */
export function logWarn(message: string, ctx?: LogContext): void {
  emit('WARNING', message, ctx)
}

/** Deliberate, low-volume operational facts. Not a debug channel. */
export function logInfo(message: string, ctx?: LogContext): void {
  emit('INFO', message, ctx)
}
