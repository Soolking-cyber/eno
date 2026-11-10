import type { ApiErrorCode } from '@/lib/api/errors'

// Its own module so the body readers (src/lib/api/body.ts) can throw it without importing the route wrapper, which
// imports them. handler.ts re-exports it: import it from '@/lib/api/handler' as before.

/** Thrown by a handler to return a specific code+status without constructing a Response. */
export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status = 400) {
    super(code)
    this.name = 'ApiError'
  }
}
