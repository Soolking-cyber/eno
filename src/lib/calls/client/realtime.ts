import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { parseEvent, type CallEvent } from '../protocol'

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
 * read ("reload to call"); `onStatus` every channel status (SUBSCRIBED again after a drop = resync).
 */
export async function joinChannel(
  topic: string,
  handlers: { onEvent: EventHandler; onVersion?: VersionHandler; onStatus?: (s: ChannelStatus) => void },
): Promise<CallChannel> {
  const supabase = await client()
  const { data } = await supabase.auth.getSession()
  if (data.session) await supabase.realtime.setAuth(data.session.access_token)
  // ⚠️ realtime-js hands back an EXISTING channel for the same topic (RealtimeClient.channel) — one still closing from
  // the last call in this thread would refuse a second subscribe (client review). Remove it first.
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  if (stale) await supabase.removeChannel(stale)
  let channel: RealtimeChannel | null = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'call_event' }, ({ payload }) => {
      const parsed = parseEvent(payload)
      if (parsed.ok) handlers.onEvent(parsed.value)
      else if (parsed.error === 'unsupported_version') handlers.onVersion?.(parsed.version)
    })
  channel.subscribe((status) => handlers.onStatus?.(status as ChannelStatus))
  return {
    close() {
      if (!channel) return
      const c = channel
      channel = null
      void supabase.removeChannel(c)
    },
  }
}

export const ringTopic = (profileId: string) => `ring:${profileId}`
export const callTopic = (conversationId: string) => `call:${conversationId}`
