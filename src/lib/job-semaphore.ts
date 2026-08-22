import 'server-only'

/**
 * A per-instance cap on how many of an expensive job run at once.
 *
 * ⛔ THIS IS NOT A RATE LIMIT AND DOES NOT REPLACE ONE. A rate limit bounds the daily
 * bill; it says nothing about thirty requests arriving in the same minute. This bounds
 * what ONE instance will accept concurrently, which is the resource actually being
 * protected when a single job saturates a core for minutes.
 *
 * ⚠️ PER-PROCESS, AND THAT IS THE HONEST SCOPE. A counter in one process cannot bound
 * a horizontally-scaled fleet. It is deliberately not backed by Postgres: the point is
 * to protect THIS instance's CPU, and a shared counter would add a database round trip
 * to the hot path of the thing that is already overloading the database's neighbour.
 *
 * ⛔ RELEASE ON EVERY EXIT OR IT IS WORSE THAN NOTHING. A counter that only climbs
 * refuses every subsequent job for the life of the instance. `run()` exists so callers
 * cannot forget — it releases in a finally, covering throws and early returns alike.
 */
export function createJobSemaphore(max: number) {
  let inFlight = 0
  return {
    get inFlight() { return inFlight },
    get busy() { return inFlight >= max },
    /** Runs `fn` if there is room, else returns null WITHOUT running it. */
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      if (inFlight >= max) return null
      inFlight += 1
      try { return await fn() } finally { inFlight -= 1 }
    },
  }
}
