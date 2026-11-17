import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { AGENT_GRANT_FAMILY, GRANT_MAX_AGE_SECONDS, GRANT_PREFIX } from '@/lib/api/oauth-grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connected-apps — Settings › Privacy › Connected apps (2026-11-17, owner "ok to agents for all"): every app
 * and AI agent connected to THIS account by a sign-in (Sign in with eno, or an agent's code), shop or chat-only, so any
 * account can see and end what it allowed — the revocation home eligibleShop's business-only rule existed for.
 *
 * One row per APP: a grant's prefix carries the app's 10-hex client binding (oauth-grant.ts clientBinding; an agent
 * registration's family tag), and a person may hold up to LIVE_GRANTS_PER_APP live grants of one app (two devices).
 * Live = not revoked, not a pending sign-in, inside the 180-day limit. API keys (eno_live_) are not here: they belong to
 * Dashboard › Developers. Names are the app's own claim at sign-in, shown as "<name> (signed in <day>)" there.
 */
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const rows = await db.apiKey.findMany({
    where: {
      profileId: userId,
      prefix: { startsWith: GRANT_PREFIX },
      revokedAt: null,
      createdAt: { gt: new Date(Date.now() - GRANT_MAX_AGE_SECONDS * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    // revokedAt: null already leaves out a pending sign-in (its revokedAt is PENDING_AT, the epoch).
    select: { prefix: true, name: true, scopes: true, sellerId: true, createdAt: true, lastUsedAt: true },
    take: 200,
  })
  const apps = new Map<string, { id: string; name: string; scopes: Set<string>; shop: boolean; connectedAt: Date; lastUsedAt: Date | null }>()
  for (const r of rows) {
    // An app's grants share its client binding; every agent registration shares the agent family's, so each one is its own
    // row (its whole prefix), never merged with another agent's under one name and one Disconnect.
    const id = r.prefix.startsWith(AGENT_GRANT_FAMILY) ? r.prefix.slice(GRANT_PREFIX.length) : r.prefix.slice(GRANT_PREFIX.length, GRANT_PREFIX.length + 10)
    const a = apps.get(id) ?? { id, name: r.name.replace(/ \((signed in|sign-in pending)[^)]*\)$/, ''), scopes: new Set<string>(), shop: false, connectedAt: r.createdAt, lastUsedAt: null }
    for (const s of r.scopes.split(/\s+/).filter(Boolean)) a.scopes.add(s)
    a.shop ||= !!r.sellerId
    if (r.createdAt < a.connectedAt) a.connectedAt = r.createdAt
    if (r.lastUsedAt && (!a.lastUsedAt || r.lastUsedAt > a.lastUsedAt)) a.lastUsedAt = r.lastUsedAt
    apps.set(id, a)
  }
  return {
    apps: [...apps.values()].map((a) => ({
      id: a.id, name: a.name, scopes: [...a.scopes], shop: a.shop,
      connectedAt: a.connectedAt.toISOString(), lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
    })),
  }
})
