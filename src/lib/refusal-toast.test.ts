import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastFn }))

const { refusalToast } = await import('./refusal-toast')
const { readingTimeMs } = await import('./toast-timing')

beforeEach(() => { toastFn.mockClear(); toastFn.error.mockClear() })

describe('refusalToast', () => {
  it('with a next step: long enough to read AND reach for it — bounded, never parked until closed', () => {
    const step = { label: 'Verify', onClick: () => {} }
    refusalToast('Verify your identity to put this back on sale.', { id: 'relist-refusal:L1', step })
    expect(toastFn.error).toHaveBeenCalledWith('Verify your identity to put this back on sale.', { id: 'relist-refusal:L1', action: step, duration: 8000 })
    const long = 'x'.repeat(400)
    refusalToast(long, { id: 'relist-refusal:L1', step })
    expect((toastFn.error.mock.lastCall![1] as { duration: number }).duration).toBe(15_000) // capped
  })

  it('without one: the reading time, 4–10s', () => {
    refusalToast('Not sent.', { id: 'chat-refusal:c1' })
    expect(toastFn.error).toHaveBeenLastCalledWith('Not sent.', { id: 'chat-refusal:c1', action: undefined, duration: 4000 })
    const long = 'Your message wasn’t sent: it contains language we don’t allow (slurs, threats of violence, sexual solicitation or sexual content involving minors). Please rephrase it.'
    refusalToast(long, { id: 'chat-refusal:c1' })
    expect((toastFn.error.mock.lastCall![1] as { duration: number }).duration).toBe(readingTimeMs(long, 4000, 10_000))
  })

  it('⚠️ always passes `action`, undefined without a step — sonner merges an update by id, and a missing key would keep the old button', () => {
    refusalToast('Refused.', { id: 'offer-refusal:c1:m1', step: { label: 'Open chat', onClick: () => {} } })
    refusalToast('Refused.', { id: 'offer-refusal:c1:m1' })
    const last = toastFn.error.mock.lastCall![1] as Record<string, unknown>
    expect('action' in last).toBe(true)
    expect(last.action).toBeUndefined()
  })
})

describe('readingTimeMs', () => {
  it('≈60ms a character, between the floor and the cap', () => {
    expect(readingTimeMs('Saved', 2000, 8000)).toBe(2000)
    expect(readingTimeMs('x'.repeat(100), 2000, 8000)).toBe(6000)
    expect(readingTimeMs('x'.repeat(1000), 2000, 8000)).toBe(8000)
  })
})
