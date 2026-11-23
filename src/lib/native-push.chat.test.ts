// @vitest-environment node
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * iOS 1.3 — a THREAD push (tag `convo-<id>` opening `/messages/<id>`) carries the Reply category, its reader's id and,
 * with a photo, `mutable-content` + `image` for the EnoNotify extension (native-push.ts apnsBody). Everything else is
 * byte-for-byte what 1.2 received. ⛔ The server change ships BEFORE the 1.3 binary: older binaries ignore the new keys.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  tokens: [] as Array<{ token: string; platform: string }>,
  bodies: [] as Array<Record<string, unknown>>,
  photo: vi.fn(async (_id: string): Promise<string | null> => null),
}))
vi.mock('./db', () => ({ db: { nativePushToken: { findMany: vi.fn(async () => h.tokens), deleteMany: vi.fn() } } }))
vi.mock('./unread', () => ({ badgeCountFor: vi.fn(async () => 2) }))
vi.mock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('@/lib/native-surfaces', () => ({ chatPushPhoto: h.photo }))
vi.mock('node:http2', () => ({
  default: {
    connect: () => {
      const client = new EventEmitter() as EventEmitter & { request: () => unknown; close: () => void }
      client.close = () => {}
      client.request = () => {
        const req = new EventEmitter() as EventEmitter & { setEncoding: () => void; end: (b: string) => void }
        req.setEncoding = () => {}
        req.end = (b: string) => {
          h.bodies.push(JSON.parse(b))
          queueMicrotask(() => { req.emit('response', { ':status': 200 }); req.emit('end') })
        }
        return req
      }
      return client
    },
  },
}))

const PHOTO = 'https://eno.vn/_next/image?url=x&w=640&q=60'

beforeEach(() => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  vi.stubEnv('APNS_KEY_ID', 'KEY1234567'); vi.stubEnv('APNS_TEAM_ID', 'DTP9SKVFMQ'); vi.stubEnv('APNS_BUNDLE_ID', 'vn.eno.app')
  vi.stubEnv('APNS_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  h.tokens = [{ token: 'ios-1', platform: 'ios' }]
  h.bodies = []
  h.photo.mockReset()
  h.photo.mockResolvedValue(PHOTO)
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('threadOf — which pushes are a thread\'s', () => {
  it('a convo tag that opens exactly that thread', async () => {
    const { threadOf } = await import('./native-push')
    expect(threadOf({ tag: 'convo-c1', url: '/messages/c1' })).toBe('c1')
  })

  it('not a call ring, a missed call, another url or a bell push', async () => {
    const { threadOf } = await import('./native-push')
    expect(threadOf({ tag: 'call-k1', url: '/messages/c1?call=k1' })).toBeNull()
    expect(threadOf({ tag: 'convo-c1', url: '/messages/c2' })).toBeNull()
    expect(threadOf({ tag: 'convo-c1', url: '/messages/c1?call=k1' })).toBeNull()
    expect(threadOf({ tag: 'price-drop-l1', url: '/listings/l1' })).toBeNull()
    expect(threadOf({ url: '/messages/c1' })).toBeNull()
  })
})

describe('apnsBody', () => {
  it('no thread: exactly the 1.2 payload', async () => {
    const { apnsBody } = await import('./native-push')
    expect(apnsBody({ title: 'T', body: 'B', url: '/listings/l1' }, 3, null)).toEqual({
      aps: { alert: { title: 'T', body: 'B' }, sound: 'default', badge: 3 },
      url: '/listings/l1',
    })
  })

  it('a thread with a photo: category, mutable-content, image and the reader', async () => {
    const { apnsBody } = await import('./native-push')
    expect(apnsBody({ title: 'An', body: 'Offer', url: '/messages/c1', tag: 'convo-c1' }, null, { to: 'p1', photo: PHOTO })).toEqual({
      aps: { alert: { title: 'An', body: 'Offer' }, sound: 'default', category: 'eno.chat', 'mutable-content': 1 },
      url: '/messages/c1',
      to: 'p1',
      image: PHOTO,
    })
  })

  it('a thread without a photo: the Reply category, and no mutable-content (the extension would have nothing to do)', async () => {
    const { apnsBody } = await import('./native-push')
    const body = apnsBody({ title: 'An', url: '/messages/c1', tag: 'convo-c1' }, 1, { to: 'p1', photo: null })
    expect(body.aps).toEqual({ alert: { title: 'An', body: '' }, sound: 'default', badge: 1, category: 'eno.chat' })
    expect(body).not.toHaveProperty('image')
    expect(body.to).toBe('p1')
  })
})

describe('sendNativePushToProfile → APNs', () => {
  it('a thread push reaches the iPhone with the photo of its listing, read once for the fan-out', async () => {
    h.tokens = [{ token: 'ios-1', platform: 'ios' }, { token: 'ios-2', platform: 'ios' }]
    const { sendNativePushToProfile } = await import('./native-push')
    expect(await sendNativePushToProfile('p1', { title: 'An', body: 'Offer', url: '/messages/c1', tag: 'convo-c1' })).toBe(2)
    expect(h.photo).toHaveBeenCalledTimes(1)
    expect(h.photo).toHaveBeenCalledWith('c1')
    for (const b of h.bodies) {
      expect(b).toMatchObject({ aps: { category: 'eno.chat', 'mutable-content': 1, badge: 2 }, image: PHOTO, to: 'p1', url: '/messages/c1' })
    }
  })

  it('any other push: no photo read, no new key', async () => {
    const { sendNativePushToProfile } = await import('./native-push')
    await sendNativePushToProfile('p1', { title: 'Price drop', url: '/listings/l1', tag: 'price-drop-l1' })
    expect(h.photo).not.toHaveBeenCalled()
    expect(h.bodies[0]).toEqual({ aps: { alert: { title: 'Price drop', body: '' }, sound: 'default', badge: 2 }, url: '/listings/l1' })
  })

  it('a failed photo read costs the photo, never the push', async () => {
    h.photo.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendNativePushToProfile } = await import('./native-push')
    expect(await sendNativePushToProfile('p1', { title: 'An', url: '/messages/c1', tag: 'convo-c1' })).toBe(1)
    expect(h.bodies[0]).toMatchObject({ aps: { category: 'eno.chat' }, to: 'p1' })
    expect(h.bodies[0]).not.toHaveProperty('image')
    expect(h.bodies[0].aps).not.toHaveProperty('mutable-content')
  })

  it('a photo read that hangs does not hold the push back: it goes without the photo after the wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    h.photo.mockImplementation(() => new Promise(() => {}))
    const { sendNativePushToProfile } = await import('./native-push')
    const sending = sendNativePushToProfile('p1', { title: 'An', url: '/messages/c1', tag: 'convo-c1' })
    await vi.advanceTimersByTimeAsync(2_000)
    vi.useRealTimers()
    expect(await sending).toBe(1)
    expect(h.bodies[0]).toMatchObject({ aps: { category: 'eno.chat' }, to: 'p1' })
    expect(h.bodies[0]).not.toHaveProperty('image')
  })

  it('no iPhone among the devices: no photo read', async () => {
    h.tokens = [{ token: 'and-1', platform: 'android' }]
    const { sendNativePushToProfile } = await import('./native-push')
    await sendNativePushToProfile('p1', { title: 'An', url: '/messages/c1', tag: 'convo-c1' })
    expect(h.photo).not.toHaveBeenCalled()
  })
})
