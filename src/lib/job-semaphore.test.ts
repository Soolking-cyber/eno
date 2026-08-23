import { describe, it, expect } from 'vitest'
import { createJobSemaphore } from './job-semaphore'

describe('job semaphore', () => {
  it('admits up to the cap and refuses beyond it', async () => {
    const s = createJobSemaphore(2)
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const a = s.run(() => held.then(() => 'a'))
    const b = s.run(() => held.then(() => 'b'))
    expect(s.inFlight).toBe(2)
    expect(await s.run(async () => 'c')).toBeNull() // refused, and NOT run
    release()
    expect(await a).toBe('a'); expect(await b).toBe('b')
  })

  it('⛔ RELEASES ON THROW — a counter that only climbs is worse than no semaphore', async () => {
    // The bug this exists to prevent: without a finally the route refuses every job
    // for the life of the instance after `max` failures.
    const s = createJobSemaphore(1)
    await expect(s.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(s.inFlight).toBe(0)
    expect(await s.run(async () => 'ok')).toBe('ok')
  })

  it('releases on an early return too', async () => {
    const s = createJobSemaphore(1)
    expect(await s.run(async () => 'early')).toBe('early')
    expect(s.inFlight).toBe(0)
  })

  it('a refused job does not consume a slot', async () => {
    const s = createJobSemaphore(1)
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const a = s.run(() => held.then(() => 1))
    expect(await s.run(async () => 2)).toBeNull()
    expect(s.inFlight).toBe(1) // still just the one holder
    release(); await a
    expect(s.inFlight).toBe(0)
  })
})

describe('tryAcquire — for work that outlives the request', () => {
  it('⛔ HOLDS THE SLOT UNTIL RELEASED, NOT UNTIL THE HANDLER RETURNS', async () => {
    // The production failure this exists for: the transcode is scheduled with after()
    // and continues past the response, so a run()-style release frees the slot before
    // ffmpeg starts and the limit counts request handling instead of encoding.
    const { createJobSemaphore } = await import('./job-semaphore')
    const s = createJobSemaphore(1)
    const release = s.tryAcquire()!
    expect(s.busy).toBe(true)
    expect(s.tryAcquire()).toBeNull()   // a second caller is refused meanwhile
    release()
    expect(s.busy).toBe(false)
    expect(s.tryAcquire()).not.toBeNull()
  })

  it('⚠️ RELEASE IS IDEMPOTENT — a double release must not invent a slot', async () => {
    const { createJobSemaphore } = await import('./job-semaphore')
    const s = createJobSemaphore(1)
    const release = s.tryAcquire()!
    release(); release(); release()
    expect(s.inFlight).toBe(0)
  })
})
