// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE FACE, DRAWN BEFORE START (owner, 2026-10-26: "make sure all ai avatar voice etc loads at once when its ready") — with
 * a fake AvatarKit: drawn with no token and no session; primed in the tap; connected by the session; and taken down
 * without ever disposing a view mid-init (the owner's "getBackend of null").
 */
const kit = vi.hoisted(() => {
  class Controller {
    audioInits = 0
    started = 0
    closed = 0
    sent: [number, boolean][] = []
    frameStarvationMode = ''
    onConversationState: ((s: string) => void) | null = null
    onConnectionState: ((s: string) => void) | null = null
    onError: ((e: unknown) => void) | null = null
    onPlaybackStall: ((s: boolean) => void) | null = null
    initializeAudioContext() { this.audioInits += 1; return Promise.resolve() }
    start() { this.started += 1; return Promise.resolve() }
    close() { this.closed += 1 }
    send(buf: ArrayBuffer, last: boolean) { this.sent.push([buf.byteLength, last]) }
    interrupt() {}
  }
  class AvatarView {
    static views: AvatarView[] = []
    controller = new Controller()
    disposed = 0
    isInitialized = false
    onFirstRendering: (() => void) | null = null
    constructor() { AvatarView.views.push(this) }
    dispose() { this.disposed += 1 }
  }
  const AvatarSDK = { appId: '', initialize: async (id: string) => { AvatarSDK.appId = id }, setSessionToken: (t: string) => { tokens.push(t) } }
  const tokens: string[] = []
  return {
    AvatarSDK, AvatarView, tokens,
    AvatarManager: { shared: { load: async () => ({}) } },
    DrivingServiceMode: { direct: 'direct' }, LogLevel: { error: 'error' },
    FrameStarvationMode: { strictSync: 'strictSync', audioIndependent: 'audioIndependent' },
    ConnectionState: { failed: 'failed' }, ConversationState: { playing: 'playing' },
  }
})
vi.mock('@spatius/avatarkit', () => kit)

import { AvatarStage, type StageHandle } from './avatar-stage'

const FACE = { avatarId: 'av-1', appId: 'app-1', region: 'ap-northeast' }
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const ua = (s: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(s)
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

function mount(o: { onFallback?: () => void } = {}) {
  const ref = createRef<StageHandle>()
  const calls = { drawn: 0, fallback: 0, playing: [] as boolean[] }
  const r = render(<AvatarStage ref={ref} mode="avatar" face={FACE} photoUrl={null} name="Alex" speaking={false}
    onDrawn={() => { calls.drawn += 1 }} onFallback={() => { calls.fallback += 1; o.onFallback?.() }} onPlaying={(p) => calls.playing.push(p)} />)
  return { ref, calls, ...r }
}
const view = () => kit.AvatarView.views.at(-1)!
const drawFirstFrame = async () => { await act(async () => { view().onFirstRendering?.() }); await flush() }

beforeEach(() => {
  kit.AvatarView.views.length = 0
  kit.tokens.length = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => (type === 'webgl2' ? {} : null)) as never)
  ua(CHROME)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AvatarStage', () => {
  it('draws BEFORE any session: no token, no websocket — then says it is drawn; the SDK never sees WebGPU', async () => {
    const fetches = vi.fn()
    vi.stubGlobal('fetch', fetches)
    const m = mount()
    await flush()
    expect(kit.AvatarSDK.appId).toBe('app-1')
    expect(kit.AvatarView.views).toHaveLength(1)
    expect(m.calls.drawn).toBe(0)
    await drawFirstFrame()
    expect(m.calls.drawn).toBe(1)
    expect(fetches).not.toHaveBeenCalled()
    expect(view().controller.started).toBe(0)
    expect((navigator as unknown as { gpu?: unknown }).gpu).toBeUndefined()
  })
  it('prime() starts its audio in the tap; connect() takes the token, then the websocket; replies go to the face', async () => {
    const fetches = vi.fn(async () => new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetches)
    const m = mount()
    await flush()
    await drawFirstFrame()
    expect(m.ref.current!.prime()).toBe(true)
    expect(view().controller.audioInits).toBe(1)
    let live = false
    await act(async () => { live = await m.ref.current!.connect('s-1') })
    expect(live).toBe(true)
    expect(String((fetches.mock.calls[0] as unknown[])[0])).toBe('/api/classroom/sessions/s-1/token')
    expect(kit.tokens).toEqual(['tok-1'])
    expect(view().controller.audioInits).toBe(1) // not started again
    expect(view().controller.started).toBe(1)
    expect(m.ref.current!.speakPcm(new Int16Array(240), true)).toBe(true)
    expect(view().controller.sent).toEqual([[480, true]])
  })
  it('⛔ taken down before the first frame: the load\'s own wait ends too (nothing of it is left waiting — review, codex + opus)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const m = mount()
    await flush()
    expect(kit.AvatarView.views).toHaveLength(1)
    m.unmount()
    await flush()
    expect(info.mock.calls.some((c) => String(c[0]).includes('face: load failed · taken_down'))).toBe(true)
    expect(m.calls.fallback).toBe(0) // taken down on purpose: no fallback
  })
  it('⛔ taken down mid-draw: connect() ends at once, its token request is aborted, and the view is disposed only once its init is over', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}) }))
    const m = mount()
    await flush()
    let result: boolean | null = null
    void m.ref.current!.connect('s-1').then((r) => { result = r })
    await flush()
    m.unmount()
    await flush()
    expect(result).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(view().disposed).toBe(0) // still initializing: never disposed mid-init
    await act(async () => { view().onFirstRendering?.() })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(view().disposed).toBe(1)
  })
  it('⛔ taken down when live: the websocket closes and the session token is cleared at once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'tok-2' }), { status: 200 })))
    const m = mount()
    await flush()
    await drawFirstFrame()
    m.ref.current!.prime()
    await act(async () => { await m.ref.current!.connect('s-2') })
    m.unmount()
    await flush()
    expect(view().controller.closed).toBeGreaterThanOrEqual(1)
    expect(kit.tokens.at(-1)).toBe('')
    expect(view().disposed).toBe(1)
  })
  it('⛔ iPhone/Safari: audio not started in a tap → no face at all (never lips without a voice)', async () => {
    ua(IPHONE)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'tok-3' }), { status: 200 })))
    const m = mount()
    await flush()
    await drawFirstFrame()
    let live = true
    await act(async () => { live = await m.ref.current!.connect('s-3') })
    expect(live).toBe(false)
    expect(view().controller.started).toBe(0)
    expect(m.calls.fallback).toBe(1)
  })
  it('a refused token is voice-only (onFallback), never a half-started face', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"avatar_unavailable"}', { status: 409 })))
    const m = mount()
    await flush()
    await drawFirstFrame()
    m.ref.current!.prime()
    let live = true
    await act(async () => { live = await m.ref.current!.connect('s-4') })
    expect(live).toBe(false)
    expect(view().controller.started).toBe(0)
    expect(m.calls.fallback).toBe(1)
  })
})
