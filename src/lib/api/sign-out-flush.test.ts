// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEFORE_SIGN_OUT_EVENT, SIGN_OUT_FLUSH_WAIT_MS, createSignOutFlush, type BeforeSignOutDetail } from './acting-account'

/**
 * signOut()'s first step (src/lib/api/acting-account.ts): the undo windows open in this tab send their
 * writes while the cookie is still the account that tapped, and the session stays until those answer.
 */

const listeners: ((e: Event) => void)[] = []
function onSignOutEvent(fn: (detail: BeforeSignOutDetail) => void) {
  const l = (e: Event) => fn((e as CustomEvent<BeforeSignOutDetail>).detail)
  listeners.push(l)
  window.addEventListener(BEFORE_SIGN_OUT_EVENT, l)
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const l of listeners.splice(0)) window.removeEventListener(BEFORE_SIGN_OUT_EVENT, l)
  vi.useRealTimers()
})

describe('createSignOutFlush', () => {
  it('⛔ announces synchronously — before the caller gets to await anything', () => {
    const flush = createSignOutFlush()
    const seen: string[] = []
    onSignOutEvent(() => { seen.push('announced') })
    void flush()
    expect(seen).toEqual(['announced'])
  })

  it('resolves at once when nothing was handed over', async () => {
    const flush = createSignOutFlush()
    let done = false
    void flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('waits for the writes handed over before resolving', async () => {
    const flush = createSignOutFlush()
    const write = deferred()
    onSignOutEvent((d) => d.waitFor(write.promise))
    let done = false
    void flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toBe(false)
    write.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('⛔ a second sign-out while the first waits finds nothing to flush, and still waits for the FIRST one\'s writes', async () => {
    const flush = createSignOutFlush()
    const write = deferred()
    let handedOver = false
    onSignOutEvent((d) => { if (!handedOver) { handedOver = true; d.waitFor(write.promise) } })
    const done: string[] = []
    void flush().then(() => { done.push('first') })
    void flush().then(() => { done.push('second') })
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toEqual([])
    write.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(done.sort()).toEqual(['first', 'second'])
  })

  it('a write that never answers holds it for SIGN_OUT_FLUSH_WAIT_MS, not forever — and a later sign-out does not wait again', async () => {
    const flush = createSignOutFlush()
    let first = true
    onSignOutEvent((d) => { if (first) { first = false; d.waitFor(new Promise(() => {})) } })
    let done = false
    void flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    let again = false
    void flush().then(() => { again = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(again).toBe(true)
  })
})
