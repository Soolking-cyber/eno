/**
 * ONE MORE ASK FOR A CODE-SPLIT CHUNK, ABOUT 1.5 S AFTER THE BUNDLER GAVE UP (R22, 2026-11-10).
 *
 * The Turbopack runtime already asks twice for a chunk that fails (the second ask 200-600 ms after the first). When both
 * fail, next/dynamic's React.lazy keeps the rejection for the life of the page: every later render throws it again, and
 * neither "Try again" nor a soft navigation clears it; only a reload does (resilience-01). A dropped connection that
 * outlasts half a second can still be over by 1.5 s, so the loader waits and asks once more before it gives up.
 * The runtime forgets a chunk that failed, so this ask goes back to the network, not to a cached failure (and the runtime
 * may repeat it once itself, as it did the first).
 *
 * ⚠️ ONCE, AND NEVER FROM A RENDER (react-lazy-settles-once): hand it to `dynamic()`, whose React.lazy calls its loader a
 * single time per page life. Offline that is one more ask for the whole page however many cards render the island,
 * never a loop. The rejection that comes out is the second failure's.
 */
export function withOneRetry<T>(load: () => Promise<T>, waitMs = 1500): Promise<T> {
  return load().catch(() => new Promise<void>((resolve) => setTimeout(resolve, waitMs)).then(load))
}
