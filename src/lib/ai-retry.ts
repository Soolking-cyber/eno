export type AiAttempt = { model: string; delay: number }

export function aiErrorStatus(error: unknown): number | null {
  const failure = error as { status?: number; code?: number | string }
  const value = Number(failure?.status || failure?.code)
  return Number.isFinite(value) ? value : null
}

/**
 * ⚠️ A TIMEOUT HAS NO STATUS CODE, AND THAT MADE THE FALLBACK MODEL DEAD CODE.
 *
 * `aiErrorStatus` reads `.status`/`.code`. An aborted fetch carries neither, so `Number(undefined)`
 * is NaN, the helper returns null, and this predicate used to answer false — which sent
 * `withAiRetry` down its `throw` branch on the FIRST attempt. Every caller that lists a fallback
 * model was therefore never reaching it on the single most likely transient failure.
 *
 * It bit hardest on the visa portrait check, whose per-call budget is 12s: a slow vision call
 * became a 502 telling the applicant their image failed, each retry burned one of their ten
 * analyses per hour, and the row was left `unavailable`. The photo was never the problem.
 *
 * Matched by NAME first (`AbortError`/`TimeoutError` are what fetch and undici raise) and only
 * then by message, because message text is provider-controlled and changes between SDK versions.
 */
function isTimeoutLikeError(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'ConnectTimeoutError' || name === 'HeadersTimeoutError') return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('timeout') || message.includes('timed out') || message.includes('aborted') || message.includes('etimedout') || message.includes('econnreset')
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export function isRetryableAiError(error: unknown) {
  // ⚠️ A KNOWN STATUS IS THE AUTHORITY, AND IT IS CHECKED FIRST — NOTHING BELOW CAN OVERRIDE IT.
  //
  // My first cut checked the transient allowlist and then, on any miss, still ran the name/message
  // test. That made a PERMANENT failure retryable whenever its text happened to contain one of
  // these words: a 400 whose message mentions a bad `timeout` parameter, or a 401 saying the
  // request was `aborted`, would be retried against the fallback model — burning a second paid
  // call and a second slice of the shared ai-global daily budget to be told the same thing.
  // Message text is provider-controlled, so that is a coin-flip we do not need to take.
  //
  // The second cut hoisted the SyntaxError branch ABOVE this one, which reopened the same hole
  // through a narrower door: a SyntaxError carrying a 400 would still have been retried. No SDK
  // path is known to produce one — `JSON.parse` and the route's own
  // `new SyntaxError('image_analysis_missing_checks')` are both statusless — but an invariant that
  // holds only because no caller currently violates it is not an invariant. Both cuts were caught
  // by codex on review of this diff.
  const status = aiErrorStatus(error)
  if (status !== null) return TRANSIENT_STATUSES.has(status)

  // STATUSLESS ONLY FROM HERE.
  // A malformed or truncated body is the model's output rather than the transport, so it is worth
  // one more attempt on the fallback model.
  if (error instanceof SyntaxError) return true
  // And this is the timeout/abort case that made the fallback unreachable in the first place.
  return isTimeoutLikeError(error)
}

/**
 * Runs only the explicit attempts supplied by the caller. Every Gemini request
 * also disables the SDK's default five-attempt behavior, so this helper is the
 * single source of truth for paid retries.
 */
export async function withAiRetry<T>(
  attempts: AiAttempt[],
  run: (attempt: AiAttempt, index: number) => Promise<T>,
  pause: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  let lastError: unknown
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.delay) await pause(attempt.delay)
    try {
      return await run(attempt, index)
    } catch (error) {
      lastError = error
      if (!isRetryableAiError(error) || index === attempts.length - 1) throw error
    }
  }
  throw lastError
}
