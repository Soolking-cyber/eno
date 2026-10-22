/**
 * In-app calls — what a Realtime broadcast carries, back to a protocol event.
 *
 * ⛔ realtime.send() ADDS AN `id` TO EVERY PAYLOAD THAT HAS NONE. Measured on the box 2026-10-22: the database's
 * realtime.send(jsonb, …) sets payload.id to the message row's own uuid ("if payload ? 'id' … else jsonb_set(payload,
 * '{id}', generated_id)"). A call event has no `id` and every protocol schema is STRICT, so until this was stripped every
 * broadcast — ring, cancel, accepted, offer, candidates — failed to parse and was dropped: on the owner's first
 * two-device test the callee's phone never rang, and a call that did connect took 18 s on the snapshot poll alone.
 * The two-browser harness never saw it: its stand-in for Realtime sent the event as published.
 * The `id` is the transport's, not the protocol's (which has idempotencyKey), so it goes; nothing else is touched.
 * ⛔ So the protocol must never grow a top-level `id`: it would be stripped here. broadcast.test.ts fails first — its
 * "refused as delivered" case stops holding the moment `id` becomes a known key.
 */
export function fromBroadcast(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const event: Record<string, unknown> = { ...payload }
  delete event.id
  return event
}
