/**
 * GET /api/agent-search?q=… — eno.vn's own free stand-in for Cloudflare "Search for Agents" (/.well-known/search), the
 * target of the redirect the guard Worker turns on once the month's free AI Search allowance is nearly used
 * (src/lib/agent-search.ts says why). Markdown passages; also POST with text/plain or JSON {"q": "…"}. The redirect is a
 * 307, so a POST stays a POST; Cloudflare's QUERY form gets 405 here (Next route handlers cannot export QUERY) — GET is
 * the form Cloudflare's own agent:method meta tag advertises. Reads no cookie, changes nothing, answers only
 * what the anonymous MCP search answers, rate-limited like /ask.
 */
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { SEARCH_TOOLS_BY_NAME, SearchToolError } from '@/app/api/mcp/search/tools'
import { matchGuides, readCapped, readQuery, renderAnswer, type AgentListing } from '@/lib/agent-search'

export const dynamic = 'force-dynamic'

const PER_IP_PER_MIN = 20
const GLOBAL_PER_MIN = 300
const BODY_MAX = 4096
const HEAD = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex' }
const md = (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { ...HEAD, ...extra } })

const busy = () => md('Too many searches right now. Wait a minute and try again.\n', 429, { 'retry-after': '60' })
/** Per address, BEFORE any body is read (commit gate, opus). */
const perIp = async (req: Request) => (await rateLimit('agent-search-ip', clientIp(req), PER_IP_PER_MIN, '1 m')).success

async function answer(q: string | null): Promise<Response> {
  if (!q) return md('Add your search as ?q=… (for example /api/agent-search?q=studio%20district%201).\n', 400)
  if (!(await rateLimit('agent-search-all', 'all', GLOBAL_PER_MIN, '1 m')).success) return busy()
  const lang = /[ăâđêôơư]/i.test(q) ? 'vi' : 'en'
  let listings: AgentListing[] = [], total = 0
  const tool = SEARCH_TOOLS_BY_NAME.get('search_listings')!
  const args = tool.input.safeParse({ q, lang, limit: 8 })
  if (args.success) {
    try {
      const r = (await tool.handler(args.data as Record<string, unknown>)) as { total?: unknown; listings?: unknown }
      if (Array.isArray(r.listings)) { listings = r.listings as AgentListing[]; total = Number(r.total) || listings.length }
    } catch (e) {
      // An outage is not "no match": an agent would take that as the answer (commit gate, opus).
      if (!(e instanceof SearchToolError)) { console.error('[agent-search] listing search failed', e); return md('The search is unavailable right now. Try again shortly, or use the MCP server at https://eno.vn/api/mcp/search.\n', 503, { 'retry-after': '60' }) }
    }
  }
  return md(renderAnswer(q, listings, total, matchGuides(q)))
}

export async function GET(req: Request) {
  try {
    if (!(await perIp(req))) return busy()
    return await answer(readQuery(new URL(req.url).searchParams.get('q')))
  } catch (e) {
    console.error('[agent-search] failed', e)
    return md('The search failed. Try again shortly.\n', 500)
  }
}

export async function POST(req: Request) {
  try {
    if (!(await perIp(req))) return busy()
    const text = Number(req.headers.get('content-length') ?? 0) > BODY_MAX ? null : await readCapped(req, BODY_MAX)
    if (text === null) return md('The body is too large.\n', 413)
    return await answer(readQuery(new URL(req.url).searchParams.get('q'), { type: req.headers.get('content-type') ?? '', text }))
  } catch (e) {
    console.error('[agent-search] failed', e)
    return md('The search failed. Try again shortly.\n', 500)
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } })
}
