// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The `EnoSignIn` proxy (plan §7.5). The thing worth pinning: Capacitor's plugin proxy answers EVERY property
 * with a method — `then` included — so a promise that resolves to it never settles. The fake below behaves
 * exactly like registerPlugin's Proxy (a `then` that throws "not implemented" and never calls back).
 */
const h = vi.hoisted(() => ({ registered: 0, calls: [] as Array<[string, unknown]> }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => {
    h.registered++
    return new Proxy({}, {
      get(_t, prop) {
        return (...args: unknown[]) => {
          if (prop === 'then') return Promise.reject(new Error(`"${name}.then()" is not implemented`))
          h.calls.push([String(prop), args[0]])
          if (prop === 'signInWithApple') return Promise.resolve({ identityToken: 'tok', user: '001.x' })
          if (prop === 'webAuth') return Promise.resolve({ url: 'enovn://auth-callback?code=1' })
          return Promise.reject(Object.assign(new Error('nope'), { code: 'failed' }))
        }
      },
    })
  },
}))

const mod = await import('./native-sign-in-plugin')

type Cap = { getPlatform: () => string; isPluginAvailable: (n: string) => boolean }
const setApp = (platform: string | null, plugins: string[] = []) => {
  const w = window as unknown as { Capacitor?: Cap }
  if (platform === null) delete w.Capacitor
  else w.Capacitor = { getPlatform: () => platform, isPluginAvailable: (n) => plugins.includes(n) }
}

beforeEach(() => { h.registered = 0; h.calls = []; mod.__resetSignInPluginForTests() })
afterEach(() => setApp(null))

describe('EnoSignIn proxy', () => {
  it('settles despite the proxy being a thenable, and registers the plugin once', async () => {
    const settled = await Promise.race([
      mod.appleCredential('f'.repeat(64)),
      new Promise((r) => setTimeout(() => r('HUNG'), 500)),
    ])
    expect(settled).toEqual({ identityToken: 'tok', user: '001.x' })
    expect(await mod.webAuthSession('https://sb.eno.vn/auth/v1/authorize?provider=google')).toEqual({ url: 'enovn://auth-callback?code=1' })
    expect(h.registered).toBe(1)
    expect(h.calls).toEqual([
      ['signInWithApple', { nonce: 'f'.repeat(64) }],
      ['webAuth', { url: 'https://sb.eno.vn/auth/v1/authorize?provider=google', ephemeral: true }],
    ])
  })

  it('is available only in the iOS app with the plugin in the binary', () => {
    expect(mod.signInPluginAvailable()).toBe(false)
    setApp('android', ['EnoSignIn'])
    expect(mod.signInPluginAvailable()).toBe(false)
    setApp('ios', [])
    expect(mod.signInPluginAvailable()).toBe(false) // build 2
    setApp('ios', ['EnoSignIn'])
    expect(mod.signInPluginAvailable()).toBe(true)
  })

  it('reads the plugin rejection codes and nothing else', () => {
    for (const c of ['canceled', 'unavailable', 'busy', 'failed'] as const) expect(mod.signInPluginErrorCode({ code: c })).toBe(c)
    expect(mod.signInPluginErrorCode({ code: '1001' })).toBeNull()
    expect(mod.signInPluginErrorCode(new Error('x'))).toBeNull()
    expect(mod.signInPluginErrorCode(null)).toBeNull()
  })
})
