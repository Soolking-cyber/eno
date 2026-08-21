// @vitest-environment jsdom
//
// ⚠️ ITS OWN FILE, AND ITS OWN ENVIRONMENT. google-identity.test.ts runs under `node` because it
// exercises crypto.subtle; these need a real DOM to assert on what GIS drew into the container.
// The repo's convention is a per-file docblock (see vitest.config.ts:30), not a global override.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── the rendered button ─────────────────────────────────────────────────────────────────────────
//
// ⛔ WHY THESE EXIST. The button is the ONLY path that puts our name on the consent screen, and
// every one of its failure modes is SILENT: an unregistered origin makes GIS log and draw nothing,
// a second initialize() replaces the first's nonce with no error, and a stale nonce is rejected by
// Supabase rather than by Google. None of that surfaces to a visitor — they just get the unbranded
// redirect, and nobody finds out. So the invariants are pinned here.
describe('mountGoogleButton', () => {
  type Cfg = Record<string, unknown>
  const makeApi = (onRender: (parent: HTMLElement) => void) => {
    const inits: Cfg[] = []
    const api = {
      initialize: (c: Cfg) => { inits.push(c) },
      prompt: () => {},
      cancel: () => {},
      renderButton: (parent: HTMLElement) => onRender(parent),
    }
    return { api, inits }
  }

  const install = (api: unknown) => {
    ;(globalThis as unknown as { window: unknown }).window = globalThis
    ;(globalThis as unknown as { google?: unknown }).google = { accounts: { id: api } }
  }

  const load = async () => {
    vi.resetModules()
    return import('./google-identity')
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '71068369681-test.apps.googleusercontent.com')
    ;(globalThis as unknown as { google?: unknown }).google = undefined
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('⛔ REPORTS ok:false WHEN GIS DREW NOTHING — an unregistered origin fails exactly this way', async () => {
    // GIS refuses an origin that is not on the client's Authorized JavaScript origins by logging
    // and rendering NOTHING. It does not throw. Reporting ok:true here would hide our own button
    // behind one that does not exist, leaving no way to sign in with Google at all.
    const { api } = makeApi(() => { /* draws nothing */ })
    install(api)
    const { mountGoogleButton } = await load()
    const host = document.createElement('div')
    const handle = await mountGoogleButton(host, { onCredential: () => {} })
    expect(handle.ok).toBe(false)
  })

  it('reports ok:true once a child element exists', async () => {
    const { api } = makeApi((parent) => { parent.appendChild(document.createElement('iframe')) })
    install(api)
    const { mountGoogleButton } = await load()
    const host = document.createElement('div')
    const handle = await mountGoogleButton(host, { onCredential: () => {} })
    expect(handle.ok).toBe(true)
  })

  it('⚠️ CLAMPS THE WIDTH — GIS takes pixels, ignores percentages, and caps at 400', async () => {
    const widths: unknown[] = []
    const api = {
      initialize: () => {}, prompt: () => {}, cancel: () => {},
      renderButton: (parent: HTMLElement, o: Cfg) => { widths.push(o.width); parent.appendChild(document.createElement('i')) },
    }
    install(api)
    const { mountGoogleButton } = await load()
    for (const w of [0, 50, 320, 9999]) {
      await mountGoogleButton(document.createElement('div'), { onCredential: () => {}, width: w })
    }
    // 0 and 50 floor to 200 (a 0-width button is invisible); 9999 caps at Google's 400.
    expect(widths).toEqual([200, 200, 320, 400])
  })

  it('⛔ ROTATES THE NONCE AFTER A CREDENTIAL — a persistent button must not replay one', async () => {
    // The click happens inside Google's iframe, so we cannot refresh the nonce just before it.
    // Rotating in the callback is what makes each issued token carry a nonce used exactly once.
    //
    // ⚠️ MY FIRST VERSION OF THIS TEST PROVED NOTHING. It asserted that the raw nonce handed to
    // Supabase differed from the hashed nonce given to Google — two values that differ BY DESIGN,
    // rotation or not, so the assertion passed against a broken implementation. An external
    // reviewer caught it. What actually has to hold is (a) the hash Google receives CHANGES, and
    // (b) the raw value we forward is the pre-image of the hash Google was given.
    const cb: { fire: ((r: { credential: string }) => void) | null } = { fire: null }
    const inits: Cfg[] = []
    const api = {
      initialize: (c: Cfg) => { inits.push(c); cb.fire = c.callback as typeof cb.fire },
      prompt: () => {}, cancel: () => {},
      renderButton: (parent: HTMLElement) => { parent.appendChild(document.createElement('i')) },
    }
    install(api)
    const { mountGoogleButton } = await load()
    const seen: Array<string | undefined> = []
    await mountGoogleButton(document.createElement('div'), { onCredential: (c) => seen.push(c.nonce) })

    const firstHash = inits[0]?.nonce as string
    cb.fire?.({ credential: 'tok-1' })
    await new Promise((r) => setTimeout(r, 20))

    expect(seen).toHaveLength(1)
    // (b) the forwarded value is the PRE-IMAGE of what Google was handed — the pairing Supabase
    // verifies (GoTrue hashes what we pass and compares it to the token's claim).
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seen[0] as string))
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(firstHash)
    // (a) and a genuinely different hash is installed for the next click.
    expect(inits.length).toBeGreaterThan(1)
    expect(inits[inits.length - 1]?.nonce).not.toBe(firstHash)
  })

  it('⛔ DROPS A SECOND CREDENTIAL ARRIVING MID-ROTATION', async () => {
    // makeNoncePair awaits crypto.subtle, so there is a window where GIS still holds the OLD nonce.
    // A credential minted in that window would be rejected by Supabase; the visitor is already
    // signing in, so dropping it beats forwarding one that cannot verify.
    const cb: { fire: ((r: { credential: string }) => void) | null } = { fire: null }
    const api = {
      initialize: (c: Cfg) => { cb.fire = c.callback as typeof cb.fire },
      prompt: () => {}, cancel: () => {},
      renderButton: (parent: HTMLElement) => { parent.appendChild(document.createElement('i')) },
    }
    install(api)
    const { mountGoogleButton } = await load()
    const seen: string[] = []
    await mountGoogleButton(document.createElement('div'), { onCredential: (c) => seen.push(c.token) })
    // Both fired synchronously — the second lands before makeNoncePair resolves.
    cb.fire?.({ credential: 'tok-1' })
    cb.fire?.({ credential: 'tok-2' })
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toEqual(['tok-1'])
  })

  it('destroy() empties the container so a remount cannot stack two buttons', async () => {
    const { api } = makeApi((parent) => { parent.appendChild(document.createElement('iframe')) })
    install(api)
    const { mountGoogleButton } = await load()
    const host = document.createElement('div')
    const handle = await mountGoogleButton(host, { onCredential: () => {} })
    expect(host.childElementCount).toBe(1)
    handle.destroy()
    expect(host.childElementCount).toBe(0)
  })

  it('⛔ LEAVES GOOGLE\'S BUTTON IN THE TAB ORDER', async () => {
    // It is the visible control now, not a hidden click target. An earlier version set
    // tabindex=-1 on every node — correct while it lived inside aria-hidden, and a keyboard trap
    // the moment it became the thing people actually see.
    const api = {
      initialize: () => {}, prompt: () => {}, cancel: () => {},
      renderButton: (parent: HTMLElement) => {
        const f = document.createElement('iframe')
        parent.appendChild(f)
      },
    }
    install(api)
    const { mountGoogleButton } = await load()
    const host = document.createElement('div')
    await mountGoogleButton(host, { onCredential: () => {} })
    const iframe = host.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('tabindex')).toBeNull()
  })
})
