// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CALL SESSION AGAINST A REAL POSTGRES — the casts, the advisory locks, the one-winner UPDATEs and the
 * freshness predicate only prove themselves on a database (a mocked one would agree with whatever SQL it is shown).
 *
 * ⛔ OPT-IN, AND ONLY ON A THROWAWAY DATABASE. CALLS_PG_TESTS=1, a loopback host, never port 5433 (this repo's SSH
 * tunnel to production), and a database NAME ending in `_it` — checked again with current_database() before the
 * first write. Setup (scripts/calls-ddl.mjs needs the anon/authenticated/service_role roles and a realtime.send):
 *   createdb calls_it; psql calls_it -c "create schema realtime; create table realtime.sent (id bigserial, topic text,
 *     event text, payload jsonb, private boolean, at timestamptz default now()); create function realtime.send(payload
 *     jsonb, event text, topic text, private boolean default true) returns void language sql as
 *     \$\$ insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private) \$\$"
 *   DIRECT_URL=postgresql://…/calls_it node scripts/calls-ddl.mjs
 *   CALLS_PG_TESTS=1 DATABASE_URL=postgresql://…/calls_it npx vitest run src/lib/calls/server/session.pg.test.ts
 * The stub realtime.send RECORDS each broadcast, so the tests also pin what left, on which topic, in which transaction.
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.CALLS_PG_TESTS === '1' && loopback && parsed?.port !== '5433' && /_it$/.test(parsed?.pathname ?? '')

const NONCE_A = 'a'.repeat(64)
const NONCE_B = 'b'.repeat(64)
const COMMIT = 'c'.repeat(64)

describe.skipIf(!live)('call session SQL against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let s: typeof import('./session')

  const people = { alice: randomUUID(), bob: randomUUID(), carol: randomUUID(), dave: randomUUID() }
  const convo = { ab: `convo-ab-${randomUUID().slice(0, 8)}`, cb: `convo-cb-${randomUUID().slice(0, 8)}`, ad: `convo-ad-${randomUUID().slice(0, 8)}` }

  const start = (caller: string, callee: string, conversationId: string, tab = 'tab-caller') => s.startCall({
    conversationId, callerId: caller, calleeId: callee, media: 'audio', protocolVersion: 1, edition: 'marketplace',
    relay: 'cloudflare', callerTab: tab, commit: COMMIT, callerCaps: { v: 1 }, callerRelayUser: `relay-${randomUUID()}`,
  })
  const accept = (callId: string, callee: string, tabId = 'tab-callee') => s.acceptCall({
    callId, calleeId: callee, tabId, nonce: NONCE_B, calleeCaps: { v: 1 }, calleeRelayUser: `relay-${randomUUID()}`,
  })
  const ev = (callId: string, tabId: string, key: string, body: Record<string, unknown>) =>
    ({ v: 1, callId, idempotencyKey: key, tabId, ...body }) as never
  const sent = async (callId: string) => (await db.$queryRaw<{ topic: string; kind: string }[]>`
    SELECT topic, payload->>'kind' AS kind FROM realtime.sent WHERE payload->>'callId' = ${callId} ORDER BY id`)

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    s = await import('./session')
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write to ${name}`)
  }, 60_000)

  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM public.call_lock`
    await db.$executeRaw`DELETE FROM public.call_negotiation`
    await db.$executeRaw`DELETE FROM public.call_signal_key`
    await db.$executeRaw`DELETE FROM public.call_session`
    await db.$executeRaw`DELETE FROM realtime.sent`
    // Everyone allows everyone in every test thread — startCall re-checks consent inside its transaction.
    await db.$executeRaw`DELETE FROM public.call_consent`
    for (const c of Object.values(convo)) {
      for (const g of Object.values(people)) {
        for (const e of Object.values(people)) {
          if (g !== e) await db.$executeRaw`INSERT INTO public.call_consent (conversation_id, granter_id, grantee_id, copy_version) VALUES (${c}, ${g}::uuid, ${e}::uuid, 'test')`
        }
      }
    }
  })
  afterAll(async () => { await db?.$disconnect() })

  it('start: rings the callee on ring:<callee>, holds the caller, and refuses the caller a second fresh call', async () => {
    const r = await start(people.alice, people.bob, convo.ab)
    expect(r.kind).toBe('ringing')
    const callId = (r as { callId: string }).callId
    const row = await s.loadCall(callId)
    expect(row).toMatchObject({ state: 'ringing', caller_id: people.alice, callee_id: people.bob, caller_commit: COMMIT, media: 'audio' })
    expect(row!.caller_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row!.caller_hash).not.toContain(people.alice)
    expect(await sent(callId)).toEqual([{ topic: `ring:${people.bob}`, kind: 'ring' }])
    expect((await start(people.alice, people.carol, convo.ad)).kind).toBe('busy_self')
  })

  it('cross-call merge: the callee calling back in the same thread while rung is told to answer that call', async () => {
    const r = await start(people.alice, people.bob, convo.ab)
    const merged = await start(people.bob, people.alice, convo.ab)
    expect(merged).toEqual({ kind: 'merge', callId: (r as { callId: string }).callId })
  })

  it('busy: a callee already ringing reads as unavailable, logged as an ended call, nothing rung', async () => {
    await start(people.alice, people.bob, convo.ab)
    const r = await start(people.carol, people.bob, convo.cb)
    expect(r.kind).toBe('unavailable')
    const row = await s.loadCall((r as { callId: string }).callId)
    expect(row).toMatchObject({ state: 'ended', end_reason: 'unavailable', caller_relay_user: null })
    // ⛔ born ended, so written already clean — no safety-code material on a call that never rang (round-5 review)
    expect(row).toMatchObject({ caller_commit: '0'.repeat(64), caller_tag: null, callee_tag: null, caller_caps: null })
    expect(await sent(row!.id)).toEqual([])
  })

  it('⛔ two simultaneous starts to one callee: exactly one rings', async () => {
    const [a, b] = await Promise.all([start(people.alice, people.bob, convo.ab), start(people.carol, people.bob, convo.cb)])
    expect([a.kind, b.kind].sort()).toEqual(['ringing', 'unavailable'])
  })

  it('accept: binds the tab, stores nB, tells the caller (with nB) and the callee\'s other tabs in the same commit', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    const r = await accept(callId, people.bob)
    expect(r.ok).toBe(true)
    const row = await s.loadCall(callId)
    expect(row).toMatchObject({ state: 'accepted', callee_tab: 'tab-callee', callee_nonce: NONCE_B })
    const kinds = await sent(callId)
    expect(kinds).toEqual([
      { topic: `ring:${people.bob}`, kind: 'ring' },
      { topic: `ring:${people.bob}`, kind: 'answered_elsewhere' },
      { topic: `call:${convo.ab}`, kind: 'accepted' },
    ])
    const [acceptedPayload] = await db.$queryRaw<{ p: { payload: { calleeNonce: string; calleeTabId: string } } }[]>`
      SELECT payload AS p FROM realtime.sent WHERE payload->>'kind' = 'accepted' AND payload->>'callId' = ${callId}`
    expect(acceptedPayload.p.payload).toMatchObject({ calleeNonce: NONCE_B, calleeTabId: 'tab-callee' })
  })

  it('⛔ two devices accept at once: exactly one wins, the other is call_gone', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    const [x, y] = await Promise.all([accept(callId, people.bob, 'tab-1'), accept(callId, people.bob, 'tab-2')])
    expect([x.ok, y.ok].sort()).toEqual([false, true])
    expect([x, y].find((r) => !r.ok)).toEqual({ ok: false, error: 'call_gone' })
  })

  it('a ring past 45 s cannot be accepted, and the sweep ends it as missed', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await db.$executeRaw`UPDATE public.call_session SET ringing_at = now() - interval '46 seconds' WHERE id = ${callId}::uuid`
    expect(await accept(callId, people.bob)).toEqual({ ok: false, error: 'call_gone' })
    const swept = await s.sweepStale({ onlyCall: callId })
    expect(swept.map((x) => x.reason)).toEqual(['missed'])
    expect((await s.loadCall(callId))!.state).toBe('ended')
  })

  it('relay: roles and the bound tab are enforced; keys are deduplicated PER SENDER', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    expect(await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-caller', 'k-00000001', { kind: 'hold', payload: { seq: 1 } }))).toBe('gone') // still ringing
    await accept(callId, people.bob)
    expect(await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', 'k-00000001', { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n' } }))).toBe('wrong_tab')
    expect(await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-other', 'k-00000001', { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n' } }))).toBe('wrong_tab')
    expect(await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', 'k-00000001', { kind: 'ready', payload: {} }))).toBe('relayed')
    expect((await s.loadCall(callId))!.state).toBe('ready')
    // The SAME key from the other side is a different send — a key the peer saw cannot pre-empt this side's.
    expect(await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-caller', 'k-00000001', { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n' } }))).toBe('relayed')
    expect(await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-caller', 'k-00000001', { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n' } }))).toBe('duplicate')
    expect((await sent(callId)).filter((x) => x.kind === 'offer')).toHaveLength(1)
  })

  it('negotiation rows: offers and answers per negId, candidates appended per side and capped, hold by seq only', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    const cand = (n: number) => ({ candidate: `candidate:${n} 1 udp 1 203.0.113.${n} 3478 typ relay raddr 0.0.0.0 rport 0`, sdpMid: '0', sdpMLineIndex: 0 })
    let k = 0
    const key = () => `key-${String(++k).padStart(8, '0')}`
    await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-caller', key(), { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\no=offer\r\n', codecPlan: { x: 1 } } }))
    await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', key(), { kind: 'answer', negId: 1, payload: { sdp: 'v=0\r\no=answer\r\n' } }))
    const outcomes: string[] = []
    for (let i = 0; i < 4; i++) {
      outcomes.push(await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', key(), { kind: 'candidates', negId: 1, payload: { candidates: Array.from({ length: 20 }, (_, j) => cand(i * 20 + j)) } })))
    }
    // ⛔ The batch past the cap is refused, not broadcast (round-6 review): nothing reaches a live peer that a resyncing
    // one could not read back — three candidate broadcasts, not four.
    expect(outcomes).toEqual(['relayed', 'relayed', 'relayed', 'full'])
    expect((await sent(callId)).filter((e) => e.kind === 'candidates')).toHaveLength(3)
    await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', key(), { kind: 'hold', payload: { seq: 5 } }))
    await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', key(), { kind: 'resume', payload: { seq: 4 } })) // older: ignored
    const row = (await s.loadCall(callId))!
    expect(row).toMatchObject({ callee_hold: true, callee_hold_seq: 5 })
    const snap = await s.snapshotFor(row, 'caller')
    expect(snap.latestOffer).toMatchObject({ negId: 1, codecPlan: { x: 1 } })
    expect(snap.latestAnswer).toEqual({ negId: 1, sdp: 'v=0\r\no=answer\r\n' })
    expect(snap.candidates).toHaveLength(1)
    expect(snap.candidates[0].candidates).toHaveLength(60) // 3 batches of 20 fit under the 64 cap; the 4th is refused whole
    expect(snap.peerHold).toEqual({ held: true, seq: 5 })
    expect(snap.calleeNonce).toBe(NONCE_B)
    const calleeView = await s.snapshotFor(row, 'callee')
    expect(calleeView.candidates).toEqual([]) // its own candidates are useless to it
    expect(calleeView.peerTabId).toBe('tab-caller')
  })

  it('reveal: first write wins; the same nonce again is a quiet retry, a different one a conflict', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    expect(await s.recordReveal(callId, people.alice, 'tab-caller', NONCE_A)).toBe('gone') // not answered yet
    await accept(callId, people.bob)
    expect(await s.recordReveal(callId, people.alice, 'tab-caller', NONCE_A)).toBe('stored')
    expect(await s.recordReveal(callId, people.alice, 'tab-caller', NONCE_A)).toBe('same')
    expect(await s.recordReveal(callId, people.alice, 'tab-caller', NONCE_B)).toBe('conflict')
    expect(await s.recordReveal(callId, people.bob, 'tab-callee', NONCE_A)).toBe('gone') // not the caller
    expect((await sent(callId)).filter((x) => x.kind === 'reveal')).toHaveLength(1)
  })

  it('heartbeat: only the bound tab counts; the first connection is stamped once', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    expect(await s.heartbeat({ callId, profileId: people.bob, tabId: 'tab-elsewhere', connected: true })).toBeNull()
    const r = await s.heartbeat({ callId, profileId: people.bob, tabId: 'tab-callee', connected: true })
    expect(r).toMatchObject({ state: 'connected' })
    const first = r!.connected_at!.getTime()
    const again = await s.heartbeat({ callId, profileId: people.alice, tabId: 'tab-caller', connected: true })
    expect(again!.connected_at!.getTime()).toBe(first)
  })

  it('a side that stops beating ends the call as lost; past the 2 h cap as cap_reached', async () => {
    const one = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(one.callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET callee_heartbeat_at = now() - interval '46 seconds' WHERE id = ${one.callId}::uuid`
    expect((await s.sweepStale({ onlyCall: one.callId })).map((x) => x.reason)).toEqual(['lost'])
    const two = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(two.callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET state = 'connected', connected_at = now() - interval '2 hours 1 second' WHERE id = ${two.callId}::uuid`
    expect((await s.sweepStale({ onlyCall: two.callId })).map((x) => x.reason)).toEqual(['cap_reached'])
  })

  it('end: one winner; locks, negotiation rows, keys and safety-code material go; the metadata stays', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await s.relayClientEvent(callId, people.alice, ev(callId, 'tab-caller', 'key-end-0001', { kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n' } }))
    await s.recordReveal(callId, people.alice, 'tab-caller', NONCE_A)
    const [x, y] = await Promise.all([s.endCall({ callId, reason: 'hangup' }), s.endCall({ callId, reason: 'lost' })])
    expect([x, y].filter(Boolean)).toHaveLength(1)
    const winner = (x ?? y)!
    expect(winner.state).toBe('accepted') // the row AS IT WAS, for the card
    expect(winner.caller_reveal).toBe(NONCE_A)
    const after = (await s.loadCall(callId))!
    expect(after).toMatchObject({ state: 'ended', callee_nonce: null, caller_reveal: null, caller_caps: null, caller_relay_user: null, callee_relay_user: null })
    expect(after.caller_id).toBe(people.alice)
    const counts = await db.$queryRaw<{ l: number; n: number; k: number }[]>`
      SELECT (SELECT count(*)::int FROM public.call_lock WHERE call_id = ${callId}::uuid) AS l,
             (SELECT count(*)::int FROM public.call_negotiation WHERE call_id = ${callId}::uuid) AS n,
             (SELECT count(*)::int FROM public.call_signal_key WHERE call_id = ${callId}::uuid) AS k`
    expect(counts[0]).toEqual({ l: 0, n: 0, k: 0 })
    expect((await sent(callId)).filter((e) => e.kind === 'ended')).toHaveLength(1)
    // Freed: both can call again at once.
    expect((await start(people.bob, people.alice, convo.ab)).kind).toBe('ringing')
  })

  it('the connected time is measured in SQL at the end (no app clock involved); a call that never connected has none', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET state = 'connected', connected_at = now() - interval '75 seconds' WHERE id = ${callId}::uuid`
    const ended = await s.endCall({ callId, reason: 'hangup' })
    expect(ended!.connected_secs).toBeGreaterThanOrEqual(75)
    expect(ended!.connected_secs).toBeLessThan(80)
    const two = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    expect((await s.endCall({ callId: two.callId, reason: 'cancelled' }))!.connected_secs).toBeNull()
  })

  it('⛔ a decline tells the caller only "unavailable" — in the broadcast AND the snapshot — and stops the other devices', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    expect(await s.endCall({ callId, reason: 'declined', fromStates: ['ringing'], profileId: people.bob })).not.toBeNull()
    const kinds = (await sent(callId)).map((e) => `${e.topic.split(':')[0]}:${e.kind}`)
    expect(kinds).toEqual(['ring:ring', 'call:ended', 'ring:cancel'])
    const [ended] = await db.$queryRaw<{ reason: string }[]>`
      SELECT payload->'payload'->>'reason' AS reason FROM realtime.sent WHERE payload->>'callId' = ${callId} AND payload->>'kind' = 'ended'`
    expect(ended.reason).toBe('unavailable')
    const row = (await s.loadCall(callId))!
    expect(row.end_reason).toBe('declined') // the record keeps the truth
    expect((await s.snapshotFor(row, 'caller')).endReason).toBe('unavailable')
    expect((await s.snapshotFor(row, 'callee')).endReason).toBe('declined')
  })

  it('⛔ a block that committed before the start or the accept transaction stops it (re-checked under the lock)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    try {
      await db.$executeRaw`INSERT INTO "ForumUserBlock" ("blockerProfileId", "blockedProfileId") VALUES (${people.bob}::uuid, ${people.alice}::uuid)`
      expect((await start(people.alice, people.bob, convo.ab)).kind).toBe('blocked')
      await db.$executeRaw`DELETE FROM "ForumUserBlock"`
      const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
      await db.$executeRaw`INSERT INTO "ForumUserBlock" ("blockerProfileId", "blockedProfileId") VALUES (${people.alice}::uuid, ${people.bob}::uuid)`
      expect(await accept(callId, people.bob)).toEqual({ ok: false, error: 'call_gone' })
    } finally {
      await db.$executeRaw`DELETE FROM "ForumUserBlock"`
      vi.unstubAllEnvs()
    }
  })

  it('⛔ a heartbeat cannot revive a call that already went stale — it can only be ended', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET callee_heartbeat_at = now() - interval '50 seconds' WHERE id = ${callId}::uuid`
    expect(await s.heartbeat({ callId, profileId: people.bob, tabId: 'tab-callee', connected: true })).toBeNull()
  })

  it('a side ON HOLD is not lost after 45 s of silence — only after the hold window', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET callee_hold = true, callee_hold_seq = 1, callee_heartbeat_at = now() - interval '90 seconds' WHERE id = ${callId}::uuid`
    expect(await s.sweepStale({ onlyCall: callId })).toEqual([])
    await db.$executeRaw`UPDATE public.call_session SET callee_heartbeat_at = now() - interval '160 seconds' WHERE id = ${callId}::uuid`
    expect((await s.sweepStale({ onlyCall: callId })).map((x) => x.reason)).toEqual(['lost'])
  })

  it('⛔ consent withdrawn after the route checked it still stops the ring (re-checked under the lock)', async () => {
    await db.$executeRaw`UPDATE public.call_consent SET revoked_at = now() WHERE conversation_id = ${convo.ab} AND granter_id = ${people.bob}::uuid AND grantee_id = ${people.alice}::uuid`
    expect((await start(people.alice, people.bob, convo.ab)).kind).toBe('consent_required')
  })

  it('a stale call cannot keep signalling — it can only be ended', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET caller_heartbeat_at = now() - interval '50 seconds' WHERE id = ${callId}::uuid`
    expect(await s.relayClientEvent(callId, people.bob, ev(callId, 'tab-callee', 'k-stale-001', { kind: 'ready', payload: {} }))).toBe('gone')
  })

  it('the commitment ids are stored at start, for the callee to read back exactly', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    const row = (await s.loadCall(callId))!
    expect(row.caller_tag).toBe(s.commitTag(people.alice, convo.ab))
    expect(row.callee_tag).toBe(s.commitTag(people.bob, convo.ab))
  })

  it('⛔ erasure: every live call of ONE person ends under their lock — the peer told and freed, nobody else touched', async () => {
    const a = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    const c = (await start(people.carol, people.dave, convo.cb)) as { callId: string }
    const ended = await db.$transaction((tx) => s.endCallsOfIn(tx, people.bob, 'hangup'))
    expect(ended.map((r) => [r.id, r.state])).toEqual([[a.callId, 'ringing']])
    expect(await s.loadCall(a.callId)).toMatchObject({ state: 'ended', end_reason: 'hangup', caller_relay_user: null, caller_tag: null })
    expect((await s.loadCall(c.callId))!.state).toBe('ringing')
    expect(await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM public.call_lock WHERE call_id = ${a.callId}::uuid`).toEqual([{ n: 0 }])
    expect((await sent(a.callId)).map((x) => [x.topic, x.kind])).toEqual(expect.arrayContaining([
      [`call:${convo.ab}`, 'ended'], [`ring:${people.bob}`, 'cancel'],
    ]))
    // alice is free again: a new call of hers is judged on its callee, not refused as her own second call
    expect((await start(people.alice, people.dave, convo.ad)).kind).not.toBe('busy_self')
  })

  it('the sweep stamp: created \'off\' when there is no switch row, fresh after a run, stale after 5 minutes', async () => {
    await db.$executeRaw`DELETE FROM public.call_config`
    expect(await s.sweepIsFresh()).toBe(false)
    await s.stampSweep()
    expect(await db.$queryRaw<{ mode: string }[]>`SELECT mode FROM public.call_config WHERE id = 1`).toEqual([{ mode: 'off' }])
    expect(await s.sweepIsFresh()).toBe(true)
    await db.$executeRaw`UPDATE public.call_config SET swept_at = now() - interval '6 minutes'`
    expect(await s.sweepIsFresh()).toBe(false)
    await db.$executeRaw`UPDATE public.call_config SET mode = 'staff'`
    await s.stampSweep() // never touches the switch itself
    expect(await db.$queryRaw<{ mode: string }[]>`SELECT mode FROM public.call_config WHERE id = 1`).toEqual([{ mode: 'staff' }])
    await db.$executeRaw`DELETE FROM public.call_config`
  })

  it('⛔ an answered call that never connects is over after the connect deadline, however hard both sides beat (round-7 review)', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET accepted_at = now() - make_interval(secs => ${s.CONNECT_DEADLINE_S + 5}),
      caller_heartbeat_at = now(), callee_heartbeat_at = now() WHERE id = ${callId}::uuid`
    // no longer fresh: a beat cannot keep it, the people are free, and the sweep ends it as a call that never connected
    expect(await s.heartbeat({ callId, profileId: people.alice, tabId: 'tab-caller', connected: false })).toBeNull()
    expect((await start(people.carol, people.bob, convo.cb)).kind).toBe('ringing')
    const ended = await s.sweepStale({ onlyCall: callId })
    expect(ended.map((x) => x.reason)).toEqual(['media_failed'])
  })

  it('a CONNECTED call answers to the 2 h cap, not the connect deadline', async () => {
    const { callId } = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    await accept(callId, people.bob)
    await db.$executeRaw`UPDATE public.call_session SET state = 'connected', connected_at = now() - interval '10 minutes',
      accepted_at = now() - interval '11 minutes', caller_heartbeat_at = now(), callee_heartbeat_at = now() WHERE id = ${callId}::uuid`
    expect(await s.sweepStale({ onlyCall: callId })).toEqual([])
  })

  it('the pair cooldown counts every unanswered call — a call to a BUSY person too (round-7 review)', async () => {
    await start(people.carol, people.bob, convo.cb) // bob is being rung: busy
    for (let i = 0; i < 2; i++) expect((await start(people.alice, people.bob, convo.ab)).kind).toBe('unavailable')
    expect(await s.pairCallCounts(people.alice, people.bob)).toEqual({ unanswered: 2, inbound: 2, known: 2 })
    expect(await s.pairCallCounts(people.dave, people.bob)).toMatchObject({ unanswered: 0, known: 0 })
  })

  it('⛔ an IMPLIED grant never overwrites the person\'s own word — an explicit "Allow" keeps its evidence, a withdrawal stays (round-8 review)', async () => {
    const e = await import('./eligibility')
    const row = async (g: string, r: string) => (await db.$queryRaw<{ copy_version: string; revoked: boolean }[]>`
      SELECT copy_version, revoked_at IS NOT NULL AS revoked FROM public.call_consent
       WHERE conversation_id = ${convo.ab} AND granter_id = ${g}::uuid AND grantee_id = ${r}::uuid`)[0]
    await db.$executeRaw`DELETE FROM public.call_consent WHERE conversation_id = ${convo.ab}`
    await e.setCallConsent(convo.ab, people.alice, people.bob, true) // an explicit tap
    await e.setCallConsent(convo.ab, people.alice, people.bob, true, e.CALL_CONSENT_IMPLIED_VERSION)
    expect(await row(people.alice, people.bob)).toEqual({ copy_version: e.CALL_CONSENT_COPY_VERSION, revoked: false })
    await e.setCallConsent(convo.ab, people.bob, people.alice, true)
    await e.setCallConsent(convo.ab, people.bob, people.alice, false) // withdrawn
    await e.setCallConsent(convo.ab, people.bob, people.alice, true, e.CALL_CONSENT_IMPLIED_VERSION)
    expect(await row(people.bob, people.alice)).toMatchObject({ revoked: true })
    // nothing there yet: the implied grant is recorded, as implied
    await e.setCallConsent(convo.ab, people.dave, people.carol, true, e.CALL_CONSENT_IMPLIED_VERSION)
    expect(await row(people.dave, people.carol)).toEqual({ copy_version: e.CALL_CONSENT_IMPLIED_VERSION, revoked: false })
  })

  it('the kill switch ends every live call; a block ends the calls between two people only', async () => {
    const a = (await start(people.alice, people.bob, convo.ab)) as { callId: string }
    const c = (await start(people.carol, people.dave, convo.cb)) as { callId: string }
    expect((await s.endCallsBetween(people.bob, people.alice, 'blocked')).map((r) => r.id)).toEqual([a.callId])
    expect((await s.loadCall(c.callId))!.state).toBe('ringing')
    expect((await s.sweepStale({ killAll: true })).map((x) => [x.row.id, x.reason])).toEqual([[c.callId, 'kill_switch']])
  })
})
