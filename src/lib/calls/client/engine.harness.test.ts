// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CALL ENGINE IN TWO REAL BROWSERS — opt-in, never part of the normal suite.
 *
 * Two isolated Chromium contexts (fake camera + microphone) play the caller and the callee. Everything a phone runs is
 * REAL: the engine, api.ts's fetches, the negotiation reducer, the safety code, the codec plan, the ladder, the SDP
 * guard, telemetry and RTCPeerConnection itself — through a REAL relay (Cloudflare Realtime TURN, relay-only as in
 * production). What is stood in for is the box: this file serves the same /api/calls* shapes from memory, using the
 * box's own pure modules (protocol.ts parsing, signal.ts sanitising against Cloudflare's ranges, session.ts's
 * snapshot builder, events.ts box events), and Supabase Realtime is replaced by server-sent events on the same topics.
 * The SQL layer has its own real-Postgres test (session.pg.test.ts); sign-in is a cookie naming the person.
 *
 * Run it (needs the Cloudflare TURN key in ~/.eno-turn-id and ~/.eno-turn-token — infra/vn-node/apply-calls-relay.sh):
 *   CALLS_HARNESS=1 npx vitest run src/lib/calls/client/engine.harness.test.ts
 */
const ID_FILE = join(homedir(), '.eno-turn-id')
const TOKEN_FILE = join(homedir(), '.eno-turn-token')
const live = process.env.CALLS_HARNESS === '1'
/** Without the key there is no relay: everything up to ICE still runs (ring, accept, offer/answer through the guard). */
const relay = existsSync(ID_FILE) && existsSync(TOKEN_FILE)

// session.ts builds the snapshot; its Prisma client is never used here.
vi.mock('@/lib/db', () => ({ db: {} }))

const PEOPLE = { alice: '11111111-1111-4111-8111-111111111111', bob: '22222222-2222-4222-8222-222222222222' } as const
type Who = keyof typeof PEOPLE
const CONVO = 'convo-harness-1'

describe.skipIf(!live)('the call engine between two real browsers, through the real relay', () => {
  let base = ''
  let server: ReturnType<typeof createServer>
  let boxState: () => { state: string; endReason: string | null; negs: { id: number; offer: boolean; answer: boolean; offerSdp: string; answerSdp: string }[] }[] = () => []
  let browser: import('playwright').Browser
  const pages: Partial<Record<Who, import('playwright').Page>> = {}
  // Test levers on the in-memory box: a slow start, and the starts its phone gave up (session.ts abandonStart).
  let startDelayMs = 0
  const abandoned = new Set<string>()

  beforeAll(async () => {
    const protocol = await import('../protocol')
    const { sanitizeClientEvent } = await import('../server/signal')
    const { buildSnapshot, endReasonFor } = await import('../server/session')
    const { boxEvent } = await import('../server/events')
    const { relayServersFrom, CLOUDFLARE_IPV4_RANGES } = await import('../server/relay')
    const esbuild = await import('esbuild')
    const { chromium } = await import('playwright')

    // ── the box, in memory ──────────────────────────────────────────────────────────────────────────────────────
    type Row = Record<string, any>
    const calls = new Map<string, { row: Row; negs: Map<number, Row>; keys: Set<string> }>()
    const subscribers = new Map<string, Set<ServerResponse>>()
    const publish = (topic: string, event: unknown) => {
      for (const res of subscribers.get(topic) ?? []) res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    const allow = new Set(CLOUDFLARE_IPV4_RANGES)
    const keyId = relay ? readFileSync(ID_FILE, 'utf8').trim() : ''
    const token = relay ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''
    const mint = async () => {
      if (!relay) return { provider: 'cloudflare', iceServers: [], iceTransportPolicy: 'relay', expiresAt: Date.now() + 600_000 }
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 600 }),
      })
      const servers = relayServersFrom(await res.json())
      if (!servers) throw new Error(`relay mint failed: ${res.status}`)
      return { provider: 'cloudflare', iceServers: servers.iceServers, iceTransportPolicy: 'relay', expiresAt: Date.now() + 600_000 }
    }
    const json = (res: ServerResponse, status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const readBody = async (req: IncomingMessage) => {
      let s = ''
      for await (const c of req) s += c
      return s ? JSON.parse(s) : null
    }
    const who = (req: IncomingMessage): Who | null => {
      const m = /(?:^|;\s*)who=(alice|bob)/.exec(req.headers.cookie ?? '')
      return m ? (m[1] as Who) : null
    }
    const roleOf = (row: Row, id: string) => (row.caller_id === id ? 'caller' : row.callee_id === id ? 'callee' : null)
    const end = (c: { row: Row }, reason: string) => {
      const r = c.row
      if (r.state === 'ended') return
      const wasRinging = r.state === 'ringing'
      r.state = 'ended'; r.end_reason = reason
      const told = endReasonFor({ end_reason: reason as never, accepted_at: wasRinging ? null : new Date() }, 'caller') ?? reason
      publish(`call:${CONVO}`, boxEvent(r.id, { kind: 'ended', payload: { reason: told as never } }))
      if (wasRinging) publish(`ring:${r.callee_id}`, boxEvent(r.id, { kind: 'cancel', payload: {} }))
    }

    boxState = () => [...calls.values()].map((c) => ({ state: c.row.state, endReason: c.row.end_reason, negs: [...c.negs.entries()].map(([id, n]) => ({ id, offer: !!n.offer_sdp, answer: !!n.answer_sdp, offerSdp: n.offer_sdp ?? '', answerSdp: n.answer_sdp ?? '' })) }))
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x')
        const me = who(req)
        const meId = me ? PEOPLE[me] : null
        if (url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          return res.end('<!doctype html><meta charset="utf-8"><body><script src="/app.js"></script></body>')
        }
        if (url.pathname === '/app.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript' })
          return res.end(appJs)
        }
        if (url.pathname === '/rt') {
          const topic = url.searchParams.get('topic') ?? ''
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          res.write(': open\n\n')
          if (!subscribers.has(topic)) subscribers.set(topic, new Set())
          subscribers.get(topic)!.add(res)
          req.on('close', () => subscribers.get(topic)?.delete(res))
          return
        }
        if (!meId) return json(res, 401, { error: 'auth_required' })
        const peerId = meId === PEOPLE.alice ? PEOPLE.bob : PEOPLE.alice
        if (url.pathname === '/api/calls/config') return json(res, 200, { enabled: true, video: true, protocolVersion: 1 })
        if (url.pathname === `/api/conversations/${CONVO}/call` && req.method === 'GET') {
          return json(res, 200, { protocolVersion: 1, audio: 'ok', video: 'ok', consent: { theyAllowMe: true, iAllowThem: true }, commitIds: { caller: meId, callee: peerId } })
        }
        if (url.pathname === `/api/conversations/${CONVO}/call` && req.method === 'DELETE') {
          // like session.ts abandonStart: a tombstone for the start, and its call ended if it was made
          const body = await readBody(req)
          abandoned.add(body.startId)
          for (const c of calls.values()) {
            if (c.row.start_id === body.startId && c.row.caller_id === meId && c.row.state !== 'ended') end(c, c.row.state === 'ringing' ? 'cancelled' : 'hangup')
          }
          return json(res, 200, { ended: 0 })
        }
        if (url.pathname === `/api/conversations/${CONVO}/call` && req.method === 'POST') {
          const body = await readBody(req)
          // a slow start (the relay mint on a bad day): the phone may give up while this is still on its way
          if (startDelayMs) await new Promise((r) => setTimeout(r, startDelayMs))
          if (abandoned.has(body.startId)) return json(res, 409, { error: 'call_gone' })
          const id = randomUUID()
          const row: Row = {
            id, conversation_id: CONVO, caller_id: meId, callee_id: peerId, media: body.media, state: 'ringing', end_reason: null,
            protocol_version: 1, caller_tab: body.tabId, callee_tab: null, caller_commit: body.commit, callee_nonce: null, caller_reveal: null,
            caller_hold: null, caller_hold_seq: null, callee_hold: null, callee_hold_seq: null, caller_caps: body.capabilities, callee_caps: null,
            connected_at: null, accepted_at: null, start_id: body.startId,
          }
          calls.set(id, { row, negs: new Map(), keys: new Set() })
          publish(`ring:${peerId}`, boxEvent(id, { kind: 'ring', payload: { media: body.media } }))
          return json(res, 200, { kind: 'ringing', callId: id, relay: await mint(), ringTimeoutSec: 45 })
        }
        const m = /^\/api\/calls\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(url.pathname)
        const c = m ? calls.get(m[1]) : undefined
        if (!m || !c) return json(res, 404, { error: 'not_found' })
        const r = c.row
        const role = roleOf(r, meId)
        if (!role) return json(res, 404, { error: 'not_found' })
        const tail = m[2] ?? ''
        if (tail === '' && req.method === 'GET') {
          return json(res, 200, {
            callId: r.id, conversationId: CONVO, media: r.media, role, state: r.state, endReason: r.end_reason, protocolVersion: 1,
            ringingAt: new Date().toISOString(), ringTimeoutSec: 45, ringRemainingMs: 45_000, connectedAt: null,
            commit: role === 'callee' && r.state === 'ringing' ? r.caller_commit : null,
            commitIds: { caller: r.caller_id, callee: r.callee_id },
            peer: { name: role === 'caller' ? 'Bob' : 'Alice', avatarUrl: null, verified: true, memberSince: null, side: role === 'caller' ? 'seller' : 'buyer' },
            listing: { id: 'l1', title: 'Studio D3' },
          })
        }
        const body = req.method === 'POST' ? await readBody(req) : null
        if (tail === '/accept') {
          if (r.state !== 'ringing') return json(res, 409, { error: 'call_gone' })
          Object.assign(r, { state: 'accepted', accepted_at: new Date(), callee_tab: body.tabId, callee_nonce: body.nonce, callee_caps: body.capabilities })
          publish(`ring:${r.callee_id}`, boxEvent(r.id, { kind: 'answered_elsewhere', payload: { calleeTabId: body.tabId } }))
          publish(`call:${CONVO}`, boxEvent(r.id, { kind: 'accepted', payload: { calleeTabId: body.tabId, capabilities: body.capabilities, calleeNonce: body.nonce } }))
          return json(res, 200, { relay: await mint(), conversationId: CONVO, media: r.media })
        }
        if (tail === '/decline') {
          if (body?.reason === 'media') return json(res, 200, { ended: false }) // like decline/route.ts: keeps ringing
          end(c, 'declined')
          return json(res, 200, { ended: true })
        }
        if (tail === '/end') { end(c, r.state === 'ringing' ? (role === 'caller' ? 'cancelled' : 'declined') : 'hangup'); return json(res, 200, { ended: true }) }
        if (tail === '/reveal') {
          if (!r.caller_reveal) { r.caller_reveal = body.nonce; publish(`call:${CONVO}`, boxEvent(r.id, { kind: 'reveal', payload: { callerNonce: body.nonce } })) }
          return json(res, 200, { stored: true })
        }
        if (tail === '/heartbeat') {
          if (r.state === 'ended') return json(res, 409, { error: 'call_gone' })
          if (body.connected && !r.connected_at) { r.connected_at = new Date(); r.state = 'connected' }
          return json(res, 200, { state: r.state, capInMs: null })
        }
        if (tail === '/telemetry') return json(res, 200, { ok: true })
        if (tail === '/state') {
          const negs = [...c.negs.entries()].map(([neg_id, n]) => ({ neg_id, offer_sdp: n.offer_sdp ?? null, offer_meta: n.offer_meta ?? null, answer_sdp: n.answer_sdp ?? null, caller_candidates: n.caller ?? [], callee_candidates: n.callee ?? [] }))
          return json(res, 200, buildSnapshot(r as never, role, negs))
        }
        if (tail === '/signal') {
          const parsed = protocol.parseEvent(body)
          if (!parsed.ok || protocol.isServerEventKind(parsed.value.kind)) return json(res, 400, { error: 'bad_request' })
          const ev = parsed.value as any
          if (ev.kind === 'end') { end(c, r.state === 'ringing' ? (role === 'caller' ? 'cancelled' : 'declined') : (protocol.PEER_END_REASONS.has(ev.payload.reason) ? ev.payload.reason : 'hangup')); return json(res, 200, { ok: true }) }
          if (r.state === 'ended' || r.state === 'ringing') return json(res, 409, { error: 'call_gone' })
          if (ev.tabId !== (role === 'caller' ? r.caller_tab : r.callee_tab)) return json(res, 409, { error: 'wrong_tab' })
          const clean = sanitizeClientEvent(ev, allow)
          if (!clean.ok) return json(res, 400, { error: 'invalid_sdp' })
          if (clean.lostAll) throw new Error(`every candidate was dropped by the Cloudflare allow-list (${clean.before}) — the relay ranges are wrong`)
          if (!clean.event) return json(res, 200, { ok: true, dropped: true })
          const key = `${role} ${ev.idempotencyKey}`
          if (c.keys.has(key)) return json(res, 200, { ok: true, duplicate: true })
          c.keys.add(key)
          const out = clean.event as any
          const neg = (id: number) => { if (!c.negs.has(id)) c.negs.set(id, {}); return c.negs.get(id)! }
          if (out.kind === 'ready' && r.state === 'accepted') r.state = 'ready'
          if (out.kind === 'offer') Object.assign(neg(out.negId), { offer_sdp: out.payload.sdp, offer_meta: { codecPlan: out.payload.codecPlan, capabilities: out.payload.capabilities } })
          if (out.kind === 'answer') neg(out.negId).answer_sdp = out.payload.sdp
          if (out.kind === 'candidates') { const n = neg(out.negId); n[role] = [...(n[role] ?? []), ...out.payload.candidates] }
          if (out.kind === 'hold' || out.kind === 'resume') { r[`${role}_hold`] = out.kind === 'hold'; r[`${role}_hold_seq`] = out.payload.seq }
          publish(`call:${CONVO}`, out)
          return json(res, 200, { ok: true })
        }
        return json(res, 404, { error: 'not_found' })
      } catch (e) {
        console.error('[harness box]', e)
        json(res, 500, { error: 'internal_error' })
      }
    })

    // ── the phone, bundled: the real engine and api.ts; Realtime → server-sent events ─────────────────────────
    const src = join(process.cwd(), 'src')
    const fakeRealtime = `
      import { parseEvent } from '@/lib/calls/protocol'
      export const ringTopic = (id) => 'ring:' + id
      export const callTopic = (id) => 'call:' + id
      export async function joinChannel(topic, handlers) {
        const es = new EventSource('/rt?topic=' + encodeURIComponent(topic))
        es.onopen = () => handlers.onStatus && handlers.onStatus('SUBSCRIBED')
        es.onmessage = (m) => {
          const parsed = parseEvent(JSON.parse(m.data))
          if (parsed.ok) handlers.onEvent(parsed.value)
          else if (parsed.error === 'unsupported_version' && handlers.onVersion) handlers.onVersion(parsed.version)
        }
        return { close() { es.close() } }
      }`
    const entry = `
      import { callEngine } from '@/lib/calls/client/engine'
      import { joinChannel, ringTopic } from '@/lib/calls/client/realtime'
      const me = document.cookie.match(/who=(alice|bob)/)[1]
      const ids = { alice: '${PEOPLE.alice}', bob: '${PEOPLE.bob}' }
      window.callEngine = callEngine
      joinChannel(ringTopic(ids[me]), { onEvent: (ev) => {
        if (ev.kind === 'ring') callEngine.onRing(ev.callId)
        else if (ev.kind === 'cancel') callEngine.stopRinging(ev.callId, 'cancelled')
        else if (ev.kind === 'answered_elsewhere') callEngine.stopRinging(ev.callId, 'answered_elsewhere')
      }, onStatus: () => { window.harnessReady = true } })`
    const built = await esbuild.build({
      stdin: { contents: entry, resolveDir: src, loader: 'ts' },
      bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
      plugins: [{
        name: 'harness',
        setup(b) {
          b.onResolve({ filter: /(^|\/)realtime$/ }, (a) => (a.path.endsWith('client/realtime') || (a.path === './realtime' && a.importer.includes('/calls/client/')) ? { path: 'fake-realtime', namespace: 'harness' } : undefined))
          b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: src, kind: a.kind }))
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'harness' }))
          b.onLoad({ filter: /.*/, namespace: 'harness' }, (a) => ({ contents: a.path === 'fake-realtime' ? fakeRealtime : '', loader: 'ts', resolveDir: src }))
        },
      }],
    })
    const appJs = built.outputFiles[0].text

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`
    browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    })
    for (const name of ['alice', 'bob'] as const) {
      const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] })
      await ctx.addCookies([{ name: 'who', value: name, url: base }])
      const page = await ctx.newPage()
      page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[${name}]`, msg.text()) })
      await page.goto(base)
      await page.waitForFunction(() => (window as any).harnessReady === true, null, { timeout: 15_000 })
      pages[name] = page
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    // The in-memory realtime is SSE: its streams stay open until dropped, and close() waits for every connection.
    server?.closeAllConnections?.()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }, 60_000)

  const view = (p: import('playwright').Page) => p.evaluate(() => {
    const v = (window as any).callEngine.getView()
    return { phase: v.phase, endReason: v.endReason, error: v.error, sas: v.sas.state, emoji: v.sas.emoji?.map((e: any) => e.char).join('') ?? null, remoteVideoLive: v.remoteVideoLive, cameraOn: v.cameraOn, role: v.role, peerName: v.peer?.name ?? null }
  })
  const waitPhase = (p: import('playwright').Page, phase: string, timeout = 30_000) =>
    p.waitForFunction((ph) => (window as any).callEngine.getView().phase === ph, phase, { timeout })
  const reset = async () => { for (const p of Object.values(pages)) await p!.evaluate(() => (window as any).callEngine.reset()) }

  it('ring → accept → a REAL Chrome offer and answer pass the box\'s guard and each phone\'s own (no relay needed)', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'video', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await bob.evaluate(() => (window as any).callEngine.accept())
    const deadline = Date.now() + 20_000
    let negs: { id: number; offer: boolean; answer: boolean; offerSdp: string; answerSdp: string }[] = []
    while (Date.now() < deadline) {
      negs = boxState().at(-1)?.negs ?? []
      if (negs.some((n) => n.offer && n.answer)) break
      await new Promise((r) => setTimeout(r, 200))
    }
    const done = negs.find((n) => n.offer && n.answer)
    expect(done, 'an offer and its answer reached the box').toBeTruthy()
    const { validateRemoteSdp } = await import('../sdp-guard')
    expect(validateRemoteSdp(done!.offerSdp).ok).toBe(true)
    expect(validateRemoteSdp(done!.answerSdp).ok).toBe(true)
    expect(done!.offerSdp).toMatch(/a=fingerprint:sha-256 /)
    for (const p of [alice, bob]) expect((await view(p)).error).toBeNull()
    await alice.evaluate(() => (window as any).callEngine.hangup())
    await waitPhase(bob, 'ended', 15_000)
    await reset()
  }, 120_000)

  it.skipIf(!relay)('an audio call connects through the relay; both phones show the SAME safety code; a hang-up ends both', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'audio', { name: 'Bob', avatarUrl: null, verified: true, memberSince: null, side: 'seller' }, { id: 'l1', title: 'Studio D3' }), CONVO)
    await waitPhase(bob, 'incoming')
    await bob.evaluate(() => (window as any).callEngine.accept())
    await waitPhase(alice, 'connected')
    await waitPhase(bob, 'connected')
    await alice.waitForFunction(() => (window as any).callEngine.getView().sas.state !== 'waiting', null, { timeout: 20_000 })
    await bob.waitForFunction(() => (window as any).callEngine.getView().sas.state !== 'waiting', null, { timeout: 20_000 })
    const [a, b] = [await view(alice), await view(bob)]
    expect(a.sas).toBe('ready')
    expect(b.sas).toBe('ready')
    expect(a.emoji).toBe(b.emoji)
    expect(a.emoji).toMatch(/^\p{Extended_Pictographic}/u)
    await alice.evaluate(() => (window as any).callEngine.hangup())
    await waitPhase(alice, 'ended')
    await waitPhase(bob, 'ended', 15_000)
    expect((await view(bob)).endReason).toBe('hangup')
    await reset()
  }, 120_000)

  it.skipIf(!relay)('a video call starts camera-off; turning the camera on reaches the other side', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'video', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await bob.evaluate(() => (window as any).callEngine.accept())
    await waitPhase(alice, 'connected')
    expect((await view(alice)).cameraOn).toBe(false)
    // ⛔ Camera off sends NO video (client review): connected for a few seconds, bob still sees no live video — so the
    // name, verified mark and listing stay on his screen.
    await bob.waitForTimeout(3_000)
    expect((await view(bob)).remoteVideoLive).toBe(false)
    await alice.evaluate(() => (window as any).callEngine.toggleCamera())
    await bob.waitForFunction(() => (window as any).callEngine.getView().remoteVideoLive === true, null, { timeout: 20_000 })
    expect((await view(bob)).remoteVideoLive).toBe(true)
    // and off again: the frames stop, and within a few seconds bob's screen goes back to the header
    await alice.evaluate(() => (window as any).callEngine.toggleCamera())
    await bob.waitForFunction(() => (window as any).callEngine.getView().remoteVideoLive === false, null, { timeout: 10_000 })
    await bob.evaluate(() => (window as any).callEngine.hangup())
    await waitPhase(alice, 'ended', 15_000)
    await reset()
  }, 120_000)

  it('⛔ End on "Starting…" abandons the attempt — and ends a call the box already rings (client review)', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => { void (window as any).callEngine.startCall(convo, 'audio', null, null) }, CONVO)
    await alice.evaluate(() => (window as any).callEngine.hangup())
    expect((await view(alice)).phase).toBe('idle')
    // whatever the start had reached, nothing is left ringing: bob is not rung, or his ring is cancelled at once
    await bob.waitForFunction(() => (window as any).callEngine.getView().phase !== 'incoming', null, { timeout: 15_000 })
    await alice.waitForTimeout(500)
    expect((await view(alice)).phase).toBe('idle')
    await reset()
  }, 120_000)

  it('⛔ End while the start is still on its way gives it up AT ONCE — the slow start then never rings (client review)', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    startDelayMs = 3_000
    try {
      await alice.evaluate((convo) => { void (window as any).callEngine.startCall(convo, 'audio', null, null) }, CONVO)
      // past the microphone and the certificate: the start request is out, the box still busy with it
      await alice.waitForTimeout(1_000)
      await alice.evaluate(() => (window as any).callEngine.hangup())
      expect((await view(alice)).phase).toBe('idle')
      await alice.waitForTimeout(3_500) // the slow start has answered by now
      expect(abandoned.size).toBeGreaterThan(0) // the give-up went out before the start's answer came back
      expect((await view(bob)).phase).not.toBe('incoming') // and nothing rang
      expect((await view(alice)).phase).toBe('idle')
    } finally {
      startDelayMs = 0
    }
    await reset()
  }, 120_000)

  it('a ring dismissed on a page that cannot answer stays dismissed there — and keeps ringing for the caller', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'audio', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await bob.evaluate(() => (window as any).callEngine.dismissRing())
    expect((await view(bob)).phase).toBe('idle')
    expect((await view(alice)).phase).toBe('outgoing') // nothing was declined
    await alice.evaluate(() => (window as any).callEngine.hangup())
    await waitPhase(alice, 'ended', 15_000)
    await reset()
  }, 120_000)

  it('⛔ a change of account ends the call this page holds — the other side is told (client review)', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'audio', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await alice.evaluate(() => (window as any).callEngine.shutdown())
    expect((await view(alice)).phase).toBe('idle')
    await bob.waitForFunction(() => (window as any).callEngine.getView().phase !== 'incoming', null, { timeout: 15_000 })
    expect((await view(bob)).endReason).toBe('cancelled')
    await reset()
  }, 120_000)

  it('a decline reads as "unavailable" to the caller; a cancel stops the callee ringing', async () => {
    const alice = pages.alice!; const bob = pages.bob!
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'audio', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await bob.evaluate(() => (window as any).callEngine.decline())
    await waitPhase(alice, 'ended', 15_000)
    expect((await view(alice)).endReason).toBe('unavailable')
    await reset()
    await alice.evaluate((convo) => (window as any).callEngine.startCall(convo, 'audio', null, null), CONVO)
    await waitPhase(bob, 'incoming')
    await alice.evaluate(() => (window as any).callEngine.hangup())
    await bob.waitForFunction(() => (window as any).callEngine.getView().phase !== 'incoming', null, { timeout: 15_000 })
    // the callee's end card: their role kept (so it reads "Missed call"), and who rang (client review)
    expect(await view(bob)).toMatchObject({ endReason: 'cancelled', role: 'callee', peerName: 'Alice' })
    await reset()
  }, 120_000)
})
