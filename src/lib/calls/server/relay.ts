import 'server-only'
import { z } from 'zod'
import { logError, logWarn } from '@/lib/log'
import type { RelayProvider } from './config'

/**
 * In-app calls — the RELAY (TURN) a call's media goes through (DESIGN.md v3 §3.4–§3.5). Calls are relay-only
 * (iceTransportPolicy 'relay' on both phones), so this is the only network path media has: the relay sees encrypted
 * packets and both IPs, never content.
 *
 * Phase 1 = Cloudflare Realtime TURN (owner decision 1, 2026-10-21): POST …/credentials/generate-ice-servers with
 * the key's bearer token returns { iceServers: [{urls}, {urls, username, credential}] }, and POST
 * …/credentials/<username>/revoke ends a credential early (developers.cloudflare.com/realtime/turn, read
 * 2026-10-21). The in-country relay on the box ('eno') comes later; until its env exists it mints nothing.
 *
 * ⚠️ ONE PROVIDER PER CALL, CHOSEN BY THE BOX, IDENTICAL FOR BOTH PHONES (§3.4). Two phones on different relays can
 * only meet if each relay may forward to the other's addresses, and a relay that refuses its own provider's peers
 * (the self-only peering every TURN hardening guide recommends) cannot reach another provider's at all.
 * ⚠️ ONE CREDENTIAL PER PARTICIPANT, minted when that person joins (start for the caller, accept for the callee),
 * with a TTL that outlives the call's 2 h cap — Cloudflare allows 48 h, and an allocation cannot be refreshed once
 * its credential has expired, so a TTL shorter than the call would cut the call. It is REVOKED when the call ends or
 * a block lands (the handle is the generated username, kept in call_session.<role>_relay_user; never the secret).
 * ⚠️ STUN AND PORT 53 ARE DROPPED. A relay-only phone gathers no server-reflexive candidates, so a STUN entry is
 * dead weight; and Cloudflare documents that browsers block port 53, where the URL just times out.
 * ⚠️ NO SECRET IN LOGS. Errors carry the HTTP status only — never the token, the username or the credential.
 */

/** The 2 h call cap (§3.2 step 9) plus ringing and slack — under Cloudflare's 48 h ceiling. */
export const RELAY_CREDENTIAL_TTL_S = 2 * 3600 + 15 * 60

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys'
const MINT_TIMEOUT_MS = 4_000

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface RelayGrant {
  provider: RelayProvider
  iceServers: IceServer[]
  /** The provider's handle for this credential, for revocation. Opaque; never shown to the other phone. */
  handle: string
  /** Epoch ms after which the provider refuses the credential. */
  expiresAt: number
}

/**
 * The IPv4 ranges a Cloudflare-relayed candidate may carry: Cloudflare's published ranges (cloudflare.com/ips-v4, read
 * 2026-10-21) PLUS the block its Realtime TURN actually relays from. ⛔ THAT BLOCK IS NOT PUBLISHED, AND IT IS NOT IN
 * THE LIST ABOVE IT: measured 2026-10-21 against the live key — 36 relay candidates over three credentials, every one in
 * 104.30.136–149.x — the first real-relay run of the call harness had every candidate dropped and no call could have
 * connected. 104.30.0.0/16 sits inside Cloudflare's own ARIN allocation (104.16.0.0/12, CLOUDFLARENET). Cloudflare
 * documents its TURN SERVER addresses (141.101.90.1, 162.159.207.1 — inside the published ranges) and says the relay
 * issues IPv4 only. Everything here is an address CLOUDFLARE operates — a WARP or Private Relay user's egress among
 * them, never their ISP's — and sdp-guard keeps a candidate only if it is `typ relay` (sanitizeCandidateLine), so a
 * srflx or host line carrying any address is dropped before this list is consulted. If calls ever connect nowhere with
 * every candidate dropped, the route logs 'calls.relay.candidates_dropped': measure again (a relay-policy gather, as
 * ~/eno-calls-research-2026-10/relay-probe.mjs does) and extend this list — or CALLS_RELAY_EXTRA_RANGES on the box.
 */
export const CLOUDFLARE_IPV4_RANGES: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '104.30.0.0/16', // Realtime TURN's relayed addresses — measured, see above
]

function envList(name: string): string[] {
  return (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * The relay addresses a candidate of this call may carry (src/lib/calls/sdp-guard.ts RelayFilterOptions). sdp-guard
 * ignores any entry it cannot parse or that is broader than /8, so a typo in the env fails closed.
 */
export function relayAllowList(provider: RelayProvider): ReadonlySet<string> {
  const extra = envList('CALLS_RELAY_EXTRA_RANGES')
  if (provider === 'cloudflare') return new Set([...CLOUDFLARE_IPV4_RANGES, ...extra])
  return new Set([...envList('ENO_TURN_RELAY_IPS'), ...extra])
}

const cfResponse = z.object({
  iceServers: z.array(z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })),
})

/** Pure: Cloudflare's answer → the TURN entries a relay-only phone can use, or null when it holds none. */
export function relayServersFrom(raw: unknown): { iceServers: IceServer[]; handle: string } | null {
  const parsed = cfResponse.safeParse(raw)
  if (!parsed.success) return null
  const out: IceServer[] = []
  let handle: string | null = null
  for (const s of parsed.data.iceServers) {
    if (!s.username || !s.credential) continue // STUN: no allocation, nothing for a relay-only phone
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^turns?:/i.test(u) && !/:53(?:[?/]|$)/.test(u))
    if (urls.length === 0) continue
    if (handle !== null && handle !== s.username) continue // one credential per grant — the one we can revoke
    handle = s.username
    out.push({ urls, username: s.username, credential: s.credential })
  }
  return handle === null ? null : { iceServers: out, handle }
}

/** Is a provider configured on this deployment? (No env = no calls through it; the config route says so.) */
export function relayConfigured(provider: RelayProvider): boolean {
  if (provider === 'cloudflare') return !!(process.env.CF_TURN_KEY_ID && process.env.CF_TURN_KEY_API_TOKEN)
  return false
}

/** Mint one participant's credential. null = the relay is unavailable (the route answers relay_unavailable). */
export async function mintRelayCredential(provider: RelayProvider, now = Date.now()): Promise<RelayGrant | null> {
  if (provider !== 'cloudflare' || !relayConfigured('cloudflare')) return null
  const keyId = encodeURIComponent(process.env.CF_TURN_KEY_ID as string)
  try {
    const res = await fetch(`${CF_API}/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CF_TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: RELAY_CREDENTIAL_TTL_S }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      logWarn('calls.relay.mint_failed', { provider, status: res.status })
      return null
    }
    const servers = relayServersFrom(await res.json())
    if (!servers) {
      logWarn('calls.relay.mint_unusable', { provider })
      return null
    }
    return { provider, ...servers, expiresAt: now + RELAY_CREDENTIAL_TTL_S * 1000 }
  } catch (e) {
    logError(e, { op: 'calls.relay.mint', provider })
    return null
  }
}

/** End a credential early (call over, block, kill switch). Best-effort: the TTL is the backstop. */
export async function revokeRelayCredential(provider: RelayProvider, handle: string | null | undefined): Promise<void> {
  if (!handle || provider !== 'cloudflare' || !relayConfigured('cloudflare')) return
  const keyId = encodeURIComponent(process.env.CF_TURN_KEY_ID as string)
  try {
    const res = await fetch(`${CF_API}/${keyId}/credentials/${encodeURIComponent(handle)}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CF_TURN_KEY_API_TOKEN}` },
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok && res.status !== 404) logWarn('calls.relay.revoke_failed', { provider, status: res.status })
  } catch (e) {
    logError(e, { op: 'calls.relay.revoke', provider })
  }
}
