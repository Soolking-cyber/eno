import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'
import { parseEvent, type CallEvent } from '../protocol'
import { fromBroadcast } from './broadcast'

/**
 * In-app calls — the two Realtime channels a phone listens on (src/lib/calls/server/events.ts):
 *   ring:<myProfileId>      ring / cancel / answered_elsewhere — every tab of mine, for as long as calls are on;
 *   call:<conversationId>   everything inside one call — joined by the tab that is in it, left when it ends.
 * Both are PRIVATE (receive-only RLS policies; nobody can send on them but the box) and carry one Realtime event,
 * 'call_event', whose payload is a protocol.ts event — parsed here, so a malformed or other-version event never
 * reaches the engine as anything but a version notice.
 *
 * ⚠️ OWN TOPICS, OWN CHANNELS. chat-context owns 'user:<id>' and tears it down on token refreshes and pagehide;
 * a call must not live or die with that, so nothing here touches it. The Supabase client is the page's singleton
 * (src/lib/supabase/browser.ts), which re-arms Realtime auth on every token refresh for every channel.
 * ⚠️ Realtime is a HINT. A status other than SUBSCRIBED means "you may have missed something": the engine refetches
 * the snapshot on every (re)subscribe — onStatus is how it hears about one.
 */

export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
export type EventHandler = (event: CallEvent) => void
export type VersionHandler = (version: number) => void

let clientPromise: Promise<SupabaseClient> | null = null
function client(): Promise<SupabaseClient> {
  // Lazy, like chat-context: supabase-js stays out of the first-load bundle of a signed-out visitor.
  if (!clientPromise) clientPromise = import('@/lib/supabase/browser').then((m) => m.createSupabaseBrowser())
  return clientPromise
}

export interface CallChannel {
  close(): void
}

/**
 * Join one private call topic. `onEvent` gets each parsed event; `onVersion` an event from a build this one cannot
 * read ("reload to call"); `onStatus` every channel status (SUBSCRIBED again after a drop = resync); `onUnreadable` an
 * event that does not parse — something DID happen, so the caller asks the box (Postgres is the truth), never drops it.
 */
export async function joinChannel(
  topic: string,
  handlers: { onEvent: EventHandler; onVersion?: VersionHandler; onStatus?: (s: ChannelStatus) => void; onUnreadable?: () => void },
): Promise<CallChannel> {
  const supabase = await client()
  const { data } = await supabase.auth.getSession()
  if (data.session) await supabase.realtime.setAuth(data.session.access_token)
  // ⚠️ realtime-js hands back an EXISTING channel for the same topic (RealtimeClient.channel) — one still closing from
  // the last call in this thread would refuse a second subscribe (client review). Remove it first.
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  if (stale) await supabase.removeChannel(stale)
  // A handler's error is logged, never rethrown — not into realtime-js's dispatch, where it would cost the other
  // listeners the message, nor out of a timer (commit-gate review, codex).
  const contained = (run: () => void) => {
    try {
      run()
    } catch (e) {
      try { logError(e, { op: 'calls.realtimeHandler' }) } catch { /* nothing more to do */ }
    }
  }
  // At most one onUnreadable per UNREADABLE_GAP_MS, plus one trailing call so the last of a burst is still answered
  // (commit-gate review: a burst of unreadable candidates must not become a burst of snapshot reads).
  let unreadableAt = 0
  let unreadableTimer: ReturnType<typeof setTimeout> | undefined
  const unreadable = () => {
    // Never longer than the gap: a clock set back after the last answer must not hold the next one for hours (codex).
    const wait = Math.min(UNREADABLE_GAP_MS, unreadableAt + UNREADABLE_GAP_MS - Date.now())
    if (wait <= 0) {
      // A trailing call already due but not yet run would answer a second time (commit-gate review, codex).
      clearTimeout(unreadableTimer)
      unreadableTimer = undefined
      unreadableAt = Date.now()
      handlers.onUnreadable?.()
    } else if (unreadableTimer === undefined) {
      unreadableTimer = setTimeout(() => {
        unreadableTimer = undefined
        unreadableAt = Date.now()
        if (channel) contained(() => handlers.onUnreadable?.())
      }, wait)
    }
  }
  let reported = false
  let channel: RealtimeChannel | null = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'call_event' }, ({ payload }) => contained(() => {
      // Closed: a message still in flight while removeChannel finishes reaches nobody (commit-gate review).
      if (!channel) return
      const parsed = parseEvent(fromBroadcast(payload))
      if (parsed.ok) handlers.onEvent(parsed.value)
      else if (parsed.error === 'unsupported_version') handlers.onVersion?.(parsed.version)
      else {
        // The recovery first, and the log line whatever the recovery does (commit-gate review).
        try {
          unreadable()
        } finally {
          if (!reported) {
            reported = true
            const issues = parsed.issues.slice(0, 3).map(loggableIssue)
            try {
              logError(new Error(`calls: unreadable ${topic.split(':')[0]} event — ${issues.join('; ')}`), { op: 'calls.unreadableEvent' })
            } catch { /* the log never costs the call */ }
          }
        }
      }
    }))
  channel.subscribe((status) => handlers.onStatus?.(status as ChannelStatus))
  return {
    close() {
      if (!channel) return
      const c = channel
      channel = null
      clearTimeout(unreadableTimer)
      void supabase.removeChannel(c)
    },
  }
}

/** The least time between two "ask the box" answers to unreadable events on one channel. */
export const UNREADABLE_GAP_MS = 2_000

/**
 * One parse issue, fit for the log. Measured 2026-10-22: zod's messages carry the path, what OUR schema expected, and
 * an unrecognised key's NAME — never a received value. Only the box publishes on these topics (receive-only RLS), so
 * a key name is the box's own; still, a quoted name that is not a plain identifier is masked (an email, a phone), and
 * so is any run of 12+ word characters holding a digit (a uuid, a cuid). Plain names stay: `Unrecognized key: "id"`
 * is the line that would have named this bug at once (broadcast.ts).
 */
function loggableIssue(issue: string): string {
  return issue
    .replace(/"([^"]*)"/g, (quoted, name: string) => (/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) ? quoted : '"…"'))
    .replace(/(?=[\w-]*\d)[\w-]{12,}/g, '…')
    .slice(0, 80)
}

export const ringTopic = (profileId: string) => `ring:${profileId}`
export const callTopic = (conversationId: string) => `call:${conversationId}`
