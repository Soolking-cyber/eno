import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * public/sw.js — an in-app call's RING stays on screen until acted on and vibrates; its replacement ("answered" /
 * "call ended", silent) and the missed-call push do not, and no other push changes. The real file runs in a sandbox
 * (the worker is plain JS no bundler touches — sw-push-click.test.ts does the same).
 */
type PushEvent = { data: { json: () => unknown }; waitUntil: (p: Promise<unknown>) => void }

async function show(payload: Record<string, unknown>) {
  const handlers: Record<string, (e: PushEvent) => void> = {}
  const shown: { title: string; options: Record<string, unknown> }[] = []
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: {
      addEventListener: (type: string, fn: (e: PushEvent) => void) => { handlers[type] = fn },
      location: { hostname: 'eno.vn' },
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }) } },
      navigator: {},
    },
    clients: {},
  })
  let done: Promise<unknown> = Promise.resolve()
  handlers.push({ data: { json: () => payload }, waitUntil: (p) => { done = p } })
  await done
  return shown[0].options
}

describe('public/sw.js — the call ring', () => {
  it('a ring (call-* tag, ring: true) requires interaction and vibrates', async () => {
    const o = await show({ title: 'Lan', body: 'Incoming call', tag: 'call-abc', ring: true })
    expect(o.requireInteraction).toBe(true)
    expect(o.vibrate).toEqual([400, 200, 400, 200, 400])
  })

  it('its silent replacement and the missed-call push are ordinary notifications', async () => {
    for (const p of [{ title: 'eno', tag: 'call-abc', silent: true }, { title: 'Lan', tag: 'call-abc' }, { title: 'eno', tag: 'call-abc', ring: true, silent: true }]) {
      const o = await show(p)
      expect(o.requireInteraction, JSON.stringify(p)).toBe(false)
      expect(o.vibrate, JSON.stringify(p)).toBeUndefined()
    }
  })

  it('`ring` on any other tag changes nothing', async () => {
    const o = await show({ title: 'x', tag: 'convo-1', ring: true })
    expect(o.requireInteraction).toBe(false)
    expect(o.vibrate).toBeUndefined()
  })
})
