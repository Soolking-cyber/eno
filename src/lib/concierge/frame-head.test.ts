import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONCIERGE_FRAME_ATTR, CONCIERGE_FRAME_HEAD_JS, framedByHost } from './frame-head'

/**
 * The guide's window keeps the apps' bridge out (owner, 2026-10-29: the guide in the apps). Android injects the bridge into
 * every frame of the origin: the window must stay a plain page — no second NativeBootstrap, no plugin call that hangs.
 */
describe('CONCIERGE_FRAME_HEAD_JS — the window hides the bridge from itself before first paint', () => {
  const run = (frameElement: { hasAttribute: (n: string) => boolean } | null, win: Record<string, unknown> = {}) => {
    new Function('window', CONCIERGE_FRAME_HEAD_JS)(Object.assign(win, { frameElement }))
    return win
  }

  it('in the guide\'s window: the injected bridge is gone, and one set later (@capacitor/core rebuilding it) never lands', () => {
    const win = run({ hasAttribute: (n) => n === CONCIERGE_FRAME_ATTR }, { Capacitor: { isNativePlatform: () => true } })
    expect(win.Capacitor).toBeUndefined()
    win.Capacitor = { isNativePlatform: () => true }
    expect(win.Capacitor).toBeUndefined()
  })

  it('anywhere else — the page itself, the page sheet, any other frame — the bridge is untouched', () => {
    const cap = { isNativePlatform: () => true }
    expect(run(null, { Capacitor: cap }).Capacitor).toBe(cap)
    expect(run({ hasAttribute: (n) => n === 'data-app-sheet' }, { Capacitor: cap }).Capacitor).toBe(cap)
  })

  it('the head script runs it before the native branch, and the host marks its window with the same attribute', () => {
    const layout = readFileSync('src/app/[lang]/layout.tsx', 'utf8')
    expect(layout).toContain('${APP_SHEET_HEAD_JS}${CONCIERGE_FRAME_HEAD_JS}try{var dc=document.documentElement.classList;')
    expect(readFileSync('src/components/concierge/concierge-host.tsx', 'utf8')).toContain('{...{ [CONCIERGE_FRAME_ATTR]: \'\' }}')
  })
})

describe('framedByHost — in the apps only the host\'s own window starts', () => {
  it('the host\'s iframe: yes; the page itself, the page sheet, a frame of another origin: no', () => {
    expect(framedByHost({ frameElement: { hasAttribute: (n) => n === CONCIERGE_FRAME_ATTR } })).toBe(true)
    expect(framedByHost({ frameElement: null })).toBe(false)
    expect(framedByHost({ frameElement: { hasAttribute: (n) => n === 'data-app-sheet' } })).toBe(false)
    expect(framedByHost({ get frameElement(): never { throw new Error('SecurityError') } })).toBe(false)
  })

  it('the window\'s Start asks it, with the binary\'s own word, before the microphone', () => {
    const frame = readFileSync('src/components/concierge/concierge-frame.tsx', 'utf8')
    const start = frame.indexOf('const startOnce = async () => {')
    const gate = frame.indexOf("if (isNativeAppClient() && (!isNativeVoiceClient() || !framedByHost())) { toChat(); return }", start)
    const mic = frame.indexOf('await rec.prepare(ctx)', start)
    expect(start).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(start)
    expect(gate).toBeLessThan(mic)
  })
})
