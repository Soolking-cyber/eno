import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ EVERY CONCIERGE ROUTE ASKS THE SWITCH WITH ITS OWN REQUEST'S USER AGENT (owner, 2026-10-29: "also ios android apps add
 * the live concierge to them too"). The apps that ship today (iOS build 4, Android vc4/vc5) send `EnoNativeApp/1` alone and
 * must never get the guide — no microphone permission (Android), a purpose string that names only videos (iOS), no consent
 * step — whatever the switch says; the binaries built for it add `EnoVoice/1`. config.test.ts holds the rule itself; this
 * holds every route to it: the config look, the session start, the live-listening key and its check, and the turn.
 * The switch's own module is real; what lies around it (the session store, Soniox, the brain) is mocked.
 */
const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  me: { id: 'p-member' } as { id: string } | null,
  /** start.ts warmOpening — the opening's voice made ahead (a billed Soniox line in most languages). */
  warm: vi.fn(),
  lists: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => {
  const json = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
  return {
    rateLimit: async () => ({ success: true, resetSec: 0 }),
    kv: {
      get: async (k: string) => (h.store.has(k) ? json(h.store.get(k)) : null),
      set: async (k: string, v: unknown) => { h.store.set(k, json(v)); return 'OK' },
      incrby: async (k: string, by: number) => { const n = Number(h.store.get(k) ?? 0) + by; h.store.set(k, n); return n },
      del: async (k: string) => { h.store.delete(k) },
    },
  }
})
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/log', () => ({ logInfo: () => {}, logWarn: () => {}, logError: () => {} }))
vi.mock('@/lib/user-blocks', () => ({ isStaffProfile: async (id: string) => id.startsWith('staff-'), hiddenSellerIdsFor: async () => [] }))
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), EDITION: 'marketplace', IS_SERVICES: false, IS_MARKETPLACE: true, SITE_NAME: 'eno.vn',
}))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => null }))
vi.mock('@/lib/concierge/start', () => ({
  conciergeFace: () => null, warmOpening: (...a: unknown[]) => h.warm(...a), openingLine: () => 'Hi.', openingAudio: async () => null, conciergeSpeaker: () => null,
}))
vi.mock('@/lib/concierge/brain', () => ({ warmConciergeBrain: () => {} }))
vi.mock('@/lib/concierge/i18n', async (orig) => ({ ...(await orig<Record<string, unknown>>()), warmLanguageLists: (...a: unknown[]) => h.lists(...a) }))
vi.mock('@/lib/classroom/soniox', () => ({
  sonioxConfig: () => ({ ws: 'wss://stt.example', model: 'm' }), mintSttKey: async () => 'temp-key', sttSettingsFor: () => ({}),
}))
vi.mock('@/lib/concierge/page-state', () => ({
  pageStateFor: async (href: string) => ({ href, kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: 'Page: /' }),
}))
vi.mock('@/lib/concierge/turn', () => ({
  conciergeTurn: () => ({ lines: (async function* () { yield { kind: 'end' } })(), stop: () => {}, done: Promise.resolve() }),
}))

const { GET: config } = await import('./config/route')
const { POST: start } = await import('./start/route')
const { POST: sttToken, GET: sttCheck } = await import('./stt-token/route')
const { POST: turn } = await import('./turn/route')
const { MODE_KEY, resetConciergeModeCache, startSession } = await import('@/lib/concierge/config')

const OLD_IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const OLD_ANDROID_APP = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 EnoNativeApp/1'
const VOICE_APP = `${OLD_ANDROID_APP} EnoVoice/1`
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const json = { 'content-type': 'application/json' }
const at = (path: string, ua: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), 'user-agent': ua } })

/** Every route the guide uses, as a client with this user agent: what each answered. */
async function everyRoute(ua: string) {
  const body = (b: unknown) => ({ method: 'POST', headers: json, body: JSON.stringify(b) })
  const cfg = ((await (await config(at('/api/concierge/config?lang=en', ua))).json()) as { open: boolean }).open
  const started = await start(at('/api/concierge/start?lang=en', ua, { method: 'POST' }))
  // The session the start made — or, where it was refused, one made beside it, so the later routes are asked at all.
  const session = started.status === 200
    ? ((await started.json()) as { session: string }).session
    : (await startSession('p-member', Date.now()))!.id
  return {
    config: cfg,
    start: started.status,
    sttToken: (await sttToken(at('/api/concierge/stt-token', ua, body({ session, lang: 'en' })))).status,
    sttCheck: (await sttCheck(at(`/api/concierge/stt-token?session=${session}`, ua))).status,
    turn: (await turn(at('/api/concierge/turn', ua, body({ session, transcript: 'hi', href: '/', lang: 'en', history: [] })))).status,
  }
}

beforeEach(() => {
  h.store.clear()
  h.me = { id: 'p-member' }
  resetConciergeModeCache()
  h.store.set(MODE_KEY, 'all')
})

describe('⛔ an app binary without EnoVoice — every route closed, the switch at `all`', () => {
  it.each([['iOS build 4', OLD_IOS_APP], ['Android vc4/vc5', OLD_ANDROID_APP]])('%s', async (_name, ua) => {
    expect(await everyRoute(ua)).toEqual({ config: false, start: 403, sttToken: 403, sttCheck: 403, turn: 403 })
  })
})

describe('the same routes open for a browser and for an app built for the guide (the website\'s own rule)', () => {
  it.each([['a browser', BROWSER], ['an EnoVoice app', VOICE_APP]])('%s', async (_name, ua) => {
    expect(await everyRoute(ua)).toEqual({ config: true, start: 200, sttToken: 200, sttCheck: 204, turn: 200 })
  })

  it('the opening\'s voice is made ahead for a browser — never for an app, where the person has not agreed yet (round 3); the language lists for both, nothing leaves the box for them (round 6)', async () => {
    h.warm.mockClear(); h.lists.mockClear()
    await config(at('/api/concierge/config?lang=en', BROWSER))
    expect(h.warm).toHaveBeenCalledTimes(1)
    expect(h.lists).toHaveBeenCalledTimes(1)
    h.warm.mockClear(); h.lists.mockClear()
    await config(at('/api/concierge/config?lang=en', VOICE_APP))
    expect(h.warm).not.toHaveBeenCalled()
    expect(h.lists).toHaveBeenCalledTimes(1)
  })
})
