/**
 * eno-agent-search-guard — keeps Cloudflare "Search for Agents" on eno.vn inside AI Search's free monthly allowance, by
 * itself, with no alerts (owner 2026-11-27: "make it available for whole site but after free quota ends offer free mcp
 * connection or any alternative free we have for ais to continue" + "no alert make it automatic switch").
 *
 * Every 15 minutes (a cron schedule every 15 minutes, set on the Worker through the API at deploy; no wrangler config), from 1 Dec 2026 (AI Search billing starts then; November usage is not billed):
 *  - QUERIES: month-to-date semantic OR full-text queries ≥ QUERY_SWITCH (90 % of the 1,000 included each; semantic and full-text are separate allowances) → turn ON the
 *    single redirect that sends GET/POST https://eno.vn/.well-known/search to eno.vn's own free search
 *    (/api/agent-search, Markdown, with the free MCP / NLWeb pointers in its footer). Measured 2026-11-27: a redirect rule
 *    runs BEFORE Cloudflare's /.well-known/search handler. Below the line (a new month) → the rule is turned OFF again.
 *  - INGESTION: month-to-date ingestion tokens ≥ INGEST_SWITCH (95 % of 5M) → the AI Search instance is `paused`
 *    (no more crawling or embedding) AND the redirect goes on, so agents get the live site rather than a frozen index.
 *    A new month → unpaused, redirect off (unless queries are over).
 * The month is the calendar month in UTC. Counts come from the account's GraphQL analytics (aiSearch*AdaptiveGroups),
 * the same meters billing uses.
 *
 * Needs the secret CF_GUARD_TOKEN, an API token the OWNER creates (Claude never creates or enters tokens) with:
 *   Account › Account Analytics › Read, Account › AI Search › Edit, Zone (eno.vn) › Single Redirect › Edit.
 * Without it the guard logs "inert" and changes nothing. Every run logs one JSON line (Workers Logs).
 * FAILS CLOSED (commit gate, opus): from 1 Dec, if the usage cannot be read, the redirect goes on and ingestion pauses —
 * the free search keeps answering and nothing can be billed unseen. The redirect and the pause are set independently, so
 * one failing call never skips the other.
 */
const ACCOUNT = 'c91cf27edd31b01aba677ac9e007d569'
const ZONE = '55e558b62f68a44f8177d7d98cb5369e'
const INSTANCE = 'search-for-agents-55e558b62f68a44f8177d7d98cb5369e'
const BILLING_START = Date.parse('2026-12-01T00:00:00Z')
export const QUERY_SWITCH = 900
export const INGEST_SWITCH = 4_750_000
const MARK = 'agent-search-guard: free quota used → eno.vn free search'
const RULE = {
  description: MARK,
  expression: '(http.host eq "eno.vn" and http.request.uri.path eq "/.well-known/search")',
  action: 'redirect',
  // 307 keeps the method and body (a POST/QUERY caller re-sends them); the query string (?q=) is kept.
  action_parameters: { from_value: { status_code: 307, target_url: { value: 'https://eno.vn/api/agent-search' }, preserve_query_string: true } },
}

const api = async (env, method, path, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${env.CF_GUARD_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 300)}`)
  return j
}

export async function usage(env, now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const query = `query($a: String!, $s: Time!, $e: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    sem: aiSearchSemanticQueriesAdaptiveGroups(limit: 50, filter: { datetime_geq: $s, datetime_lt: $e }) { count }
    ft: aiSearchFulltextQueriesAdaptiveGroups(limit: 50, filter: { datetime_geq: $s, datetime_lt: $e }) { count }
    ing: aiSearchIngestionTokensAdaptiveGroups(limit: 50, filter: { datetime_geq: $s, datetime_lt: $e }) { sum { tokens } }
  } } }`
  // Two half-month windows, summed: an adaptive dataset may cap one query's range below a month (commit gate, opus).
  const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 16)).toISOString()
  const windows = now.toISOString() > mid ? [[start, mid], [mid, now.toISOString()]] : [[start, now.toISOString()]]
  const total = { semantic: 0, fulltext: 0, tokens: 0 }
  for (const [s, e] of windows) {
    const j = await api(env, 'POST', '/graphql', { query, variables: { a: ACCOUNT, s, e } })
    if (j.errors?.length) throw new Error(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`)
    const a = j.data?.viewer?.accounts?.[0]
    if (!a) throw new Error('graphql: no account in the answer')
    const sumCount = (rows) => (rows ?? []).reduce((n, r) => n + Number(r.count || 0), 0)
    total.semantic += sumCount(a.sem)
    total.fulltext += sumCount(a.ft)
    total.tokens += (a.ing ?? []).reduce((n, r) => n + Number(r.sum?.tokens || 0), 0)
  }
  return total
}

/** The decision, pure: what the redirect and the pause should be for this usage at this time. */
export function decide(u, now) {
  if (now.getTime() < BILLING_START) return { redirect: false, paused: false, why: 'before billing starts (1 Dec 2026)' }
  return {
    // A paused index goes stale (a listing taken down after the pause would still be found), so a pause also sends agents
    // to eno.vn's live search (commit gate, opus).
    redirect: u.semantic >= QUERY_SWITCH || u.fulltext >= QUERY_SWITCH || u.tokens >= INGEST_SWITCH,
    paused: u.tokens >= INGEST_SWITCH,
    why: 'month-to-date usage',
  }
}

async function setRedirect(env, on) {
  const ep = (await api(env, 'GET', `/zones/${ZONE}/rulesets/phases/http_request_dynamic_redirect/entrypoint`)).result
  const rule = ep.rules?.find((r) => r.description === MARK)
  if (!rule && !on) return 'absent'
  if (!rule) { await api(env, 'POST', `/zones/${ZONE}/rulesets/${ep.id}/rules`, { ...RULE, enabled: true }); return 'added' }
  if (rule.enabled === on) return on ? 'on' : 'off'
  await api(env, 'PATCH', `/zones/${ZONE}/rulesets/${ep.id}/rules/${rule.id}`, { ...RULE, enabled: on })
  return on ? 'turned on' : 'turned off'
}

async function setPaused(env, paused) {
  const cur = (await api(env, 'GET', `/accounts/${ACCOUNT}/ai-search/instances/${INSTANCE}`)).result
  if (Boolean(cur.paused) === paused) return paused ? 'paused' : 'running'
  // Measured 2026-11-27: a PUT with only `paused` changes that field and nothing else.
  await api(env, 'PUT', `/accounts/${ACCOUNT}/ai-search/instances/${INSTANCE}`, { paused })
  return paused ? 'now paused' : 'now running'
}

const attempt = async (f) => { try { return await f() } catch (e) { return `error: ${String(e?.message ?? e).slice(0, 200)}` } }

export async function run(env, now = new Date()) {
  if (!env.CF_GUARD_TOKEN) { console.log(JSON.stringify({ guard: 'inert', why: 'no CF_GUARD_TOKEN secret yet' })); return }
  let u = null, d
  try {
    u = await usage(env, now)
    d = decide(u, now)
  } catch (e) {
    const billed = now.getTime() >= BILLING_START
    d = { redirect: billed, paused: billed, why: `usage unreadable (${String(e?.message ?? e).slice(0, 120)})${billed ? ': failing closed' : ''}` }
  }
  const redirect = await attempt(() => setRedirect(env, d.redirect))
  const paused = await attempt(() => setPaused(env, d.paused))
  console.log(JSON.stringify({ guard: 'ok', at: now.toISOString(), usage: u, want: d, redirect, paused }))
}

const worker = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).catch((e) => console.error(JSON.stringify({ guard: 'error', message: String(e?.message ?? e) }))))
  },
  async fetch() {
    return new Response('eno-agent-search-guard: cron only\n', { status: 404 })
  },
}
export default worker
