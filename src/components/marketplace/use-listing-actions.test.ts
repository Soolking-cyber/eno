// @vitest-environment jsdom
/**
 * The dashboard's undo-delete commit (useListingActions.del) — what the SELLER sees when the server
 * hides a listing instead of deleting it (2026-09-23, deleteListingCore). A 200 is not always a
 * delete: while the account or the listing is under investigation the server answers
 * `{ ok, deleted: false, hidden: true, reason }`, and the row must come back as hidden with the reason
 * in words — not vanish as if it had been deleted, and not "restore" with an error toast.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A real id per toast, and a `dismiss`: the undo window (use-undo-window.tsx) takes its toast down BY ID
// when it closes — and sonner's dismiss(undefined) closes EVERY toast, so an id-less mock would hide that.
const toastFn = vi.hoisted(() => {
  let seq = 0
  return Object.assign(vi.fn((_title?: unknown, _opts?: unknown) => ++seq), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() })
})
vi.mock('sonner', () => ({ toast: toastFn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// Who is signed in — the DELETE names the account that tapped (src/lib/api/acting-account.ts).
const auth = vi.hoisted(() => ({ user: { id: 'p1' } as { id: string } | null }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))

const { useListingActions } = await import('./use-listing-actions')

const listing = { id: 'L1', status: 'active' } as never
const DELETE_INIT = { method: 'DELETE', keepalive: true, headers: { 'x-eno-acting-account': 'p1' } }

function answer(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))
}

beforeEach(() => {
  vi.useFakeTimers()
  toastFn.mockClear(); toastFn.error.mockClear(); toastFn.dismiss.mockClear()
  auth.user = { id: 'p1' }
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function deleteAndCommit(onChanged = vi.fn()) {
  const hook = renderHook(() => useListingActions(listing, onChanged))
  act(() => { hook.result.current.del() })
  expect(hook.result.current.gone).toBe(true) // the optimistic hide during the undo window
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  return { hook, onChanged }
}

describe('useListingActions.del', () => {
  it('an ordinary delete stays gone and says nothing more', async () => {
    answer({ ok: true })
    const { hook, onChanged } = await deleteAndCommit()
    expect(hook.result.current.gone).toBe(true)
    expect(onChanged).toHaveBeenCalled()
    expect(toastFn).toHaveBeenCalledTimes(1) // only the "Listing deleted" undo toast
    expect(toastFn.error).not.toHaveBeenCalled()
  })

  it('a HIDE-instead-of-delete (open report) brings the row back and says why', async () => {
    answer({ ok: true, deleted: false, hidden: true, reason: 'open_report' })
    const { hook, onChanged } = await deleteAndCommit()
    expect(hook.result.current.gone).toBe(false)
    expect(onChanged).toHaveBeenCalled()
    expect(toastFn).toHaveBeenLastCalledWith(expect.stringMatching(/^Hidden, not deleted: a report about this listing or your shop is still open/))
    expect(toastFn.error).not.toHaveBeenCalled()
  })

  it('a HIDE because the account is under review says that instead', async () => {
    answer({ ok: true, deleted: false, hidden: true, reason: 'account_held' })
    await deleteAndCommit()
    expect(toastFn).toHaveBeenLastCalledWith(expect.stringMatching(/^Hidden, not deleted: your account is under review/))
  })

  it('a failed delete still restores with the error toast', async () => {
    answer({ error: 'x' }, false)
    const { hook } = await deleteAndCommit()
    expect(hook.result.current.gone).toBe(false)
    expect(toastFn.error).toHaveBeenCalledWith('Could not delete — listing restored.')
  })
})

/**
 * ⛔ THE DELETE IS SENT AS THE ACCOUNT THAT TAPPED (src/lib/api/acting-account.ts). The cookie is read when
 * the request goes out, five seconds after the tap; if the browser changed account in between, the route
 * answers 409 account_changed instead of acting for whoever is signed in now.
 */
describe('useListingActions.del — the account that tapped travels with the DELETE', () => {
  it('⛔ names the account signed in AT THE TAP, even when the session has changed by the time it goes out', async () => {
    answer({ ok: true })
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    act(() => { hook.result.current.del() })
    auth.user = { id: 'p2' } // another account signs in inside the window
    hook.rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetch).toHaveBeenCalledWith('/api/listings/L1', DELETE_INIT)
  })

  it('⛔ 409 account_changed → the row comes back and the reason is said, with NO refetch (it would read the other account)', async () => {
    answer({ error: 'account_changed' }, false)
    const { hook, onChanged } = await deleteAndCommit()
    expect(hook.result.current.gone).toBe(false)
    expect(toastFn.error).toHaveBeenCalledWith('This browser is now signed in to a different account, so the listing was not deleted.')
    expect(toastFn.error).toHaveBeenCalledTimes(1) // not also the "try again"-shaped restore toast
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('⛔ 409 account_changed after THIS screen has moved to the other account: the row stays out and nothing is said', async () => {
    answer({ error: 'account_changed' }, false)
    const onChanged = vi.fn()
    const hook = renderHook(() => useListingActions(listing, onChanged))
    act(() => { hook.result.current.del() })
    auth.user = { id: 'p2' }
    hook.rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(hook.result.current.gone).toBe(true)
    expect(toastFn.error).not.toHaveBeenCalled() // a toast would tell p2 what p1 tried
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('no account known at the tap → no header, so the server keeps its old behaviour', async () => {
    auth.user = null
    answer({ ok: true })
    await deleteAndCommit()
    expect(fetch).toHaveBeenCalledWith('/api/listings/L1', { method: 'DELETE', keepalive: true, headers: {} })
  })
})

/**
 * ⛔ ONE CLOCK (use-undo-window.tsx). The delete used to run its own 5s setTimeout beside a sonner toast
 * of `duration: 5000` — and sonner pauses that toast while it is touched or hovered and while the tab is
 * hidden, so the DELETE could go out with "Undo" still on screen, and the tap only un-hid the row of a
 * listing that was already deleted. The window's clock is now the hook's, and the toast is its view.
 */
describe('useListingActions.del — the undo window cannot outlive the DELETE', () => {
  const undoCall = () => toastFn.mock.calls.findIndex(([title]) => title === 'Listing deleted')
  const undoToast = () => toastFn.mock.calls[undoCall()][1] as unknown as { duration: number; action: { props: { onClick: () => void } } }

  it('⛔ the toast keeps no clock of its own: it comes down when the DELETE goes out, and a late Undo does nothing', async () => {
    answer({ ok: true })
    const { hook } = await deleteAndCommit()
    expect(undoToast().duration).toBe(Infinity)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/listings/L1', DELETE_INIT)
    expect(toastFn.dismiss).toHaveBeenCalledWith(toastFn.mock.results[undoCall()].value)
    act(() => { undoToast().action.props.onClick() })
    expect(hook.result.current.gone).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('Undo inside the window brings the row back, and the DELETE is never sent', async () => {
    answer({ ok: true })
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    act(() => { hook.result.current.del() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    act(() => { undoToast().action.props.onClick() })
    expect(hook.result.current.gone).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetch).not.toHaveBeenCalled()
  })

  // The house hook's deliberate trade (use-undo-window.tsx): a phone may discard a backgrounded tab without
  // ever firing pagehide, so the tab going HIDDEN sends what is waiting — a lost delete would resurrect a
  // listing the seller watched go. Coming back visible must not send anything.
  it('the tab going hidden inside the window sends the DELETE at once; visible sends nothing', () => {
    answer({ ok: true })
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    act(() => { hook.result.current.del() })
    const setVisibility = (v: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    act(() => { setVisibility('visible') })
    expect(fetch).not.toHaveBeenCalled()
    act(() => { setVisibility('hidden') })
    expect(fetch).toHaveBeenCalledWith('/api/listings/L1', DELETE_INIT)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('leaving inside the window (the row unmounting) sends the DELETE at once, with keepalive', () => {
    answer({ ok: true })
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    act(() => { hook.result.current.del() })
    hook.unmount()
    expect(fetch).toHaveBeenCalledWith('/api/listings/L1', DELETE_INIT)
  })
})

describe('useListingActions.setStatus — a relist refused by the account HOLD is said, not silently undone', () => {
  async function relist() {
    const onChanged = vi.fn()
    const hook = renderHook(() => useListingActions({ id: 'L1', status: 'sold' } as never, onChanged))
    act(() => { hook.result.current.setStatus('active') })
    expect(hook.result.current.status).toBe('active') // optimistic
    await act(async () => { await vi.runAllTimersAsync() })
    return { hook, onChanged }
  }

  it('account_held → rolled back, with the hold named', async () => {
    answer({ error: 'account_held' }, false)
    const { hook, onChanged } = await relist()
    expect(hook.result.current.status).toBe('sold')
    expect(onChanged).toHaveBeenCalled()
    expect(toastFn.error).toHaveBeenCalledWith(expect.stringMatching(/^Your listings are paused while your account is on hold/))
  })

  it('account_suspended → the suspension named', async () => {
    answer({ error: 'account_suspended' }, false)
    await relist()
    expect(toastFn.error).toHaveBeenCalledWith(expect.stringMatching(/^Your account is suspended, so listings can’t be put back on sale/))
  })

  it('released_charge_listing_cap → rolled back, with the limit and why', async () => {
    answer({ error: 'released_charge_listing_cap' }, false)
    const { hook } = await relist()
    expect(hook.result.current.status).toBe('sold')
    expect(toastFn.error).toHaveBeenCalledWith('Your hold was released, but the confirmed report stays on your record, so you can keep up to 10 active listings. Mark one sold or hide one before putting this back on sale.')
  })

  it('any other failure keeps its silent rollback', async () => {
    answer({ error: 'invalid_status' }, false)
    const { hook } = await relist()
    expect(hook.result.current.status).toBe('sold')
    expect(toastFn.error).not.toHaveBeenCalled()
  })
})

/**
 * useListingActions.markSold — the dashboard's "Who bought it?" write (B6). The same contract as the row's
 * other lifecycle actions: the status flips the instant it is asked, the request goes out, and a refusal
 * rolls the row back. What is new is the route (POST /sold, so the buyer rides along) and that it RESOLVES
 * whether it landed — the sheet closes on true and says why on false.
 */
describe('useListingActions.markSold — optimistic, through POST /sold, rolled back on refusal', () => {
  let calls: { url: string; method?: string; body?: unknown }[] = []
  let release: (() => void) | null = null
  function deferred(ok: boolean) {
    calls = []
    release = null
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Promise((resolve) => { release = () => resolve({ ok, json: async () => (ok ? { ok: true } : { error: 'server_error' }) }) })
    }))
  }

  it('flips to "sold" BEFORE the server answers, posts the answer to /sold, and resolves true when it lands', async () => {
    deferred(true)
    const onChanged = vi.fn()
    const hook = renderHook(() => useListingActions(listing, onChanged))
    let landed: Promise<boolean> = Promise.resolve(false)
    act(() => { landed = hook.result.current.markSold({ buyerProfileId: 'p1', salePrice: 11_000_000 }) })
    expect(hook.result.current.status).toBe('sold') // instant
    expect(calls).toEqual([{ url: '/api/listings/L1/sold', method: 'POST', body: { buyerProfileId: 'p1', salePrice: 11_000_000 } }])
    await act(async () => { release!() })
    await expect(landed).resolves.toBe(true)
    expect(hook.result.current.status).toBe('sold')
    expect(onChanged).toHaveBeenCalled()
  })

  it('⛔ a refusal ROLLS BACK to the server\'s status and resolves false (the sheet then says why) — no toast of its own', async () => {
    deferred(false)
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    let landed: Promise<boolean> = Promise.resolve(true)
    act(() => { landed = hook.result.current.markSold({ channel: 'external', salePrice: null }) })
    expect(hook.result.current.status).toBe('sold')
    await act(async () => { release!() })
    await expect(landed).resolves.toBe(false)
    expect(hook.result.current.status).toBe('active')
    expect(toastFn.error).not.toHaveBeenCalled()
  })

  it('⛔ a dropped connection rolls back too', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const hook = renderHook(() => useListingActions(listing, vi.fn()))
    let landed: Promise<boolean> = Promise.resolve(true)
    await act(async () => { landed = hook.result.current.markSold({ channel: 'external', salePrice: 1 }) })
    await expect(landed).resolves.toBe(false)
    expect(hook.result.current.status).toBe('active')
  })
})
