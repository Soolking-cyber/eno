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

const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastFn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

const { useListingActions } = await import('./use-listing-actions')

const listing = { id: 'L1', status: 'active' } as never

function answer(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))
}

beforeEach(() => {
  vi.useFakeTimers()
  toastFn.mockClear(); toastFn.error.mockClear()
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
