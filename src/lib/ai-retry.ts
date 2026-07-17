export type AiAttempt = { model: string; delay: number }

export function aiErrorStatus(error: unknown): number | null {
  const failure = error as { status?: number; code?: number | string }
  const value = Number(failure?.status || failure?.code)
  return Number.isFinite(value) ? value : null
}

export function isRetryableAiError(error: unknown) {
  const status = aiErrorStatus(error)
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || error instanceof SyntaxError
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
