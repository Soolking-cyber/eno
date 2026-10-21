/**
 * In-app calls — what the always-loaded parts of a page may know about the lazily loaded call runtime, without
 * importing it (call-host.tsx ships to every signed-in page view; this file is a few lines).
 *   · runtimeMounted: CallRuntime — the only place a call screen exists — is mounted. The thread's call buttons render
 *     only while it is, so no call can start without the screen that ends it (client review).
 *   · the engine's shutdown, registered by the engine module when it loads (a call may exist from then on): a change
 *     of account calls it SYNCHRONOUSLY in the host's cleanup — never through an import chain that could land after
 *     the next account's runtime has started, and shut THAT down (client review).
 */
let mounted = false
let engineShutdown: (() => void) | null = null
const listeners = new Set<() => void>()

export function setRuntimeMounted(on: boolean): void {
  mounted = on
  for (const l of listeners) l()
}

export const runtimeMounted = (): boolean => mounted

export function subscribeRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function registerEngineShutdown(fn: () => void): void {
  engineShutdown = fn
}

/** End whatever call or ring the engine holds — right now, if the engine was ever loaded in this page. */
export function shutdownEngineNow(): void {
  engineShutdown?.()
}
