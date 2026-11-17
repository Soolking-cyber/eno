import { randomUUID } from 'node:crypto'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'
import { COMPANY } from '@/lib/site-legal'
import { formatMoneyFull } from '@/lib/vnd'
import { SEARCH_TOOLS_BY_NAME, SearchToolError } from '@/app/api/mcp/search/tools'

/**
 * ── THE A2A AGENT (owner, 2026-11-17: "full agent readiness") ─────────────────────────────────────────────────────────
 *
 * An Agent2Agent (A2A, a2a-protocol.org) server over the JSON-RPC binding, at /api/a2a, described by the Agent Card at
 * /.well-known/agent-card.json. It is the public search MCP server (/api/mcp/search) spoken in A2A: the same three
 * tools, the same handlers, the same visibility (a visitor's), so an A2A client and an MCP client get the same answer.
 *
 * ⛔ EVERY CLAIM IN THE CARD IS TRUE OF THIS FILE. No streaming, no push notifications, no extended card, no tasks:
 * SendMessage answers with a direct Message (spec §3.1.1 allows it "for simple interactions"), so there is no task to
 * get, list, cancel or subscribe to, and those methods answer with the spec's own errors. No sign-in: nothing here
 * reads or writes an account. Acting for a signed-in person is the signed-in MCP server's job (/api/mcp).
 *
 * VERSIONS: 1.0 (PascalCase methods, `{ text }` parts, ROLE_AGENT, result `{ message }`) and 0.3 (slash methods,
 * `{ kind: 'text' }` parts, role 'agent', result = the Message). §3.6.2: an absent A2A-Version means 0.3. Requests are
 * read leniently (either part shape, either method name); the ANSWER follows the version asked for.
 */

export const A2A_PATH = '/api/a2a'
export const A2A_URL = `${OAUTH_ISSUER}${A2A_PATH}`
export type A2AVersion = '0.3' | '1.0'

/** Bumped when a skill or the card's behaviour changes; clients cache the card by it (ETag). */
export const AGENT_VERSION = '1.0.0'

const SKILLS = [
  {
    id: 'find-listings',
    name: 'Find listings',
    description: `Search what is for sale or rent in Vietnam on ${SITE_NAME}: apartments and rooms, motorbikes and cars, electronics, furniture, jobs, services. Send the request as text in English or Vietnamese (a district in the words narrows to it), or as a data part with the search_listings fields (q, category, subcategory, province, type, condition, price_min, price_max, sort, lang, limit, offset). Returns up to 20 live listings with VND prices and each listing's page.`,
    tags: ['marketplace', 'classifieds', 'vietnam', 'search', 'rentals', 'second-hand'],
    examples: ['2 bedroom apartment district 7 under 20 million', 'xe máy honda vision quận 3', '{"q":"macbook","price_max":25000000,"sort":"price-low"}'],
  },
  {
    id: 'listing-details',
    name: 'Listing details',
    description: 'One listing in full: title, price, the seller\'s description, photos, location and its page, where a person contacts the seller. Send the listing\'s page URL or id as text, or a data part {"id": "..."}.',
    tags: ['marketplace', 'listing', 'details'],
    examples: [`${OAUTH_ISSUER}/listings/cmumdd7j604h49tq4ipbjg8w8`, '{"id":"cmumdd7j604h49tq4ipbjg8w8"}'],
  },
  {
    id: 'categories',
    name: 'Categories',
    description: 'The categories and subcategories to search in, with their slugs (English and Vietnamese names). Send "categories" as text, or a data part {"skill": "categories"}.',
    tags: ['marketplace', 'taxonomy'],
    examples: ['categories'],
  },
] as const

type SkillId = (typeof SKILLS)[number]['id']
const SKILL_TOOL: Record<SkillId, string> = { 'find-listings': 'search_listings', 'listing-details': 'get_listing_details', categories: 'list_categories' }

const MODES = ['text/plain', 'application/json']

/** The Agent Card (A2A 1.0 §4.4.1), with the 0.3 card's fields alongside so a 0.3 client finds its interface too (§5.7: unknown fields are ignored). */
export function agentCard(): Record<string, unknown> {
  return {
    name: `${SITE_NAME} marketplace search`,
    description: `Finds what is for sale or rent in Vietnam on ${SITE_NAME}, a classifieds marketplace for expats and locals, and returns live listings with VND prices and links. Read-only and public: it signs nobody in, contacts no seller and takes no payment. To act for a signed-in person, use the MCP server described at ${OAUTH_ISSUER}/.well-known/mcp/server-card.json.`,
    supportedInterfaces: [
      { url: A2A_URL, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: A2A_URL, protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
    ],
    provider: { organization: COMPANY.nameEn, url: OAUTH_ISSUER },
    version: AGENT_VERSION,
    documentationUrl: `${OAUTH_ISSUER}/developers`,
    iconUrl: `${OAUTH_ISSUER}/icon-512.png`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: MODES,
    defaultOutputModes: MODES,
    skills: SKILLS.map((s) => ({ ...s, tags: [...s.tags], examples: [...s.examples], inputModes: MODES, outputModes: MODES })),
    // A2A 0.3 card fields (protocolVersion, url, preferredTransport) for clients that predate supportedInterfaces.
    protocolVersion: '0.3.0',
    url: A2A_URL,
    preferredTransport: 'JSONRPC',
  }
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
type Id = string | number | null

/** §5.4: the A2A errors' JSON-RPC codes. */
export const A2A_ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  pushNotSupported: -32003,
  unsupported: -32004,
  contentType: -32005,
  extendedCardNotConfigured: -32007,
  version: -32009,
} as const

export const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result })

/** The version the client asked for: header (or `A2A-Version` query parameter, §3.6.1), Major.Minor. Empty = 0.3
 *  (§3.6.2) — unless the method is a 1.0 name (PascalCase), which no 0.3 client sends: an SDK that leaves the header
 *  out still gets the shape it can parse. */
export function requestedVersion(req: Request, method?: unknown): A2AVersion | { unsupported: string } {
  const raw = (req.headers.get('a2a-version') ?? new URL(req.url).searchParams.get('A2A-Version') ?? '').trim()
  if (!raw) return typeof method === 'string' && /^[A-Z]/.test(method) ? '1.0' : '0.3'
  const mm = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(raw)
  const v = mm ? `${Number(mm[1])}.${Number(mm[2])}` : raw
  if (v === '0.3' || v === '1.0') return v
  return { unsupported: raw.slice(0, 20) }
}

/** Method names in both spellings, mapped to what this agent does with them. */
const METHODS: Record<string, 'send' | 'stream' | 'getTask' | 'listTasks' | 'cancelTask' | 'subscribe' | 'push' | 'extendedCard'> = {
  SendMessage: 'send', 'message/send': 'send',
  SendStreamingMessage: 'stream', 'message/stream': 'stream',
  GetTask: 'getTask', 'tasks/get': 'getTask',
  ListTasks: 'listTasks', 'tasks/list': 'listTasks',
  CancelTask: 'cancelTask', 'tasks/cancel': 'cancelTask',
  SubscribeToTask: 'subscribe', 'tasks/resubscribe': 'subscribe',
  CreateTaskPushNotificationConfig: 'push', GetTaskPushNotificationConfig: 'push', ListTaskPushNotificationConfigs: 'push', DeleteTaskPushNotificationConfig: 'push',
  'tasks/pushNotificationConfig/set': 'push', 'tasks/pushNotificationConfig/get': 'push', 'tasks/pushNotificationConfig/list': 'push', 'tasks/pushNotificationConfig/delete': 'push',
  GetExtendedAgentCard: 'extendedCard', 'agent/getAuthenticatedExtendedCard': 'extendedCard',
}

type Part = { text?: unknown; data?: unknown; url?: unknown; raw?: unknown; kind?: unknown; file?: unknown }
type Incoming = { messageId?: unknown; contextId?: unknown; taskId?: unknown; role?: unknown; parts?: unknown }

/** What one incoming message asks for: a skill and the arguments of the search tool behind it. */
type Ask = { skill: SkillId; args: Record<string, unknown> } | { error: number; message: string }

/** A listing page on THIS site (any other site's /listings/ link is just words to search for). */
const OWN_HOST = new URL(OAUTH_ISSUER).hostname.replace(/^www\./, '').replace(/[.]/g, '\\.')
const LISTING_URL = new RegExp(`(?:^|[\\s(])(?:https?://)?(?:www\\.)?${OWN_HOST}/listings/([a-z0-9]{20,40})(?:[/?#)\\s.,;:!]|$)`, 'i')
/** A bare listing id (a cuid: "c" + 24–25 characters, digits among them), not a long word typed without spaces. */
const LISTING_ID = /^c(?=(?:[a-z]*\d){3})[a-z0-9]{23,26}$/i
const CATEGORIES_TEXT = /^(?:list |show )?(?:all )?(?:categories|category list|danh mục)[.?!]*$/i

export function readAsk(message: Incoming): Ask {
  const parts = Array.isArray(message.parts) ? (message.parts as Part[]) : null
  if (!parts || parts.length === 0) return { error: A2A_ERR.invalidParams, message: 'message.parts: at least one part is required.' }
  if (parts.length > 8) return { error: A2A_ERR.invalidParams, message: 'message.parts: at most 8 parts.' }
  let text = ''
  let data: Record<string, unknown> | null = null
  for (const p of parts) {
    if (!p || typeof p !== 'object') return { error: A2A_ERR.invalidParams, message: 'message.parts: each part is an object.' }
    if (typeof p.text === 'string') text += (text ? '\n' : '') + p.text
    else if (p.data !== undefined) {
      if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data)) return { error: A2A_ERR.invalidParams, message: 'A data part must hold a JSON object.' }
      if (data) return { error: A2A_ERR.invalidParams, message: 'Send at most one data part.' }
      data = p.data as Record<string, unknown>
    } else if (p.url !== undefined || p.raw !== undefined || p.file !== undefined || p.kind === 'file') {
      return { error: A2A_ERR.contentType, message: 'This agent reads text and JSON data parts only, not files.' }
    }
  }
  if (data) {
    const { skill, ...rest } = data
    // Own keys only: `in` would accept "constructor" or "toString" from the prototype.
    if (skill !== undefined && !(typeof skill === 'string' && Object.prototype.hasOwnProperty.call(SKILL_TOOL, skill))) {
      return { error: A2A_ERR.invalidParams, message: `Unknown skill. Skills are: ${SKILLS.map((s) => s.id).join(', ')}.` }
    }
    const chosen = (skill as SkillId | undefined) ?? (typeof rest.id === 'string' ? 'listing-details' : 'find-listings')
    // A text part beside a search's data part is the words to look for, unless the data names its own `q`.
    if (chosen === 'find-listings' && rest.q === undefined && text.trim()) rest.q = text.trim().slice(0, 120)
    return { skill: chosen, args: chosen === 'categories' ? {} : rest }
  }
  const t = text.trim()
  if (!t) return { error: A2A_ERR.invalidParams, message: 'Send what to look for as a text part, or a data part.' }
  const fromUrl = LISTING_URL.exec(t)
  if (fromUrl) return { skill: 'listing-details', args: { id: fromUrl[1] } }
  if (LISTING_ID.test(t)) return { skill: 'listing-details', args: { id: t } }
  if (CATEGORIES_TEXT.test(t)) return { skill: 'categories', args: {} }
  return { skill: 'find-listings', args: { q: t.slice(0, 120) } }
}

type Row = { title?: string; price?: number | null; price_unit?: string | null; url?: string; sponsored?: boolean; district?: string | null; city?: string | null }

function priceText(r: Row): string {
  if (typeof r.price !== 'number' || r.price <= 0) return 'price on request'
  const unit = r.price_unit || 'VND'
  // "VND", "VND/month" → "18,500,000 đ", "5,000,000 đ/month"; any other currency keeps its own code after the amount.
  if (/^VND\b/.test(unit)) return `${formatMoneyFull(r.price, '₫')}${unit.slice(3)}`
  return `${formatMoneyFull(r.price, '')} ${unit}`
}

/** The human-readable part of the answer; the data part beside it carries the full result. */
export function summarize(skill: SkillId, args: Record<string, unknown>, result: Record<string, unknown>): string {
  if (skill === 'categories') {
    const cats = (result.categories as { name: string; slug: string }[] | undefined) ?? []
    return `Categories on ${SITE_NAME}: ${cats.map((c) => `${c.name} (${c.slug})`).join(', ')}.`
  }
  if (skill === 'listing-details') {
    const l = result.listing as (Row & { description?: string; status?: string }) | null | undefined
    if (!l) return 'That listing is not on the site any more, or is not public.'
    const where = [l.district, l.city].filter(Boolean).join(', ')
    const lines = [`${l.title} — ${priceText(l)}${where ? ` — ${where}` : ''}${l.status === 'sold' ? ' (sold)' : ''}${l.sponsored ? ' (sponsored)' : ''}`]
    if (l.description) lines.push(l.description.slice(0, 500))
    lines.push(`See the photos and contact the seller: ${l.url}`)
    return lines.join('\n')
  }
  const rows = (result.listings as Row[] | undefined) ?? []
  const q = typeof args.q === 'string' && args.q ? ` for “${args.q}”` : ''
  if (rows.length === 0) return `No live listings on ${SITE_NAME}${q} right now. Try fewer or different words, or a wider price range.`
  const total = typeof result.total === 'number' ? result.total : rows.length
  const head = `About ${total} live listing${total === 1 ? '' : 's'} on ${SITE_NAME}${q}. ${rows.length === total ? 'All' : `The first ${rows.length}`}:`
  const list = rows.map((r, i) => `${i + 1}. ${r.title} — ${priceText(r)}${r.sponsored ? ' (sponsored)' : ''} — ${r.url}`)
  return [head, ...list].join('\n')
}

function agentMessage(v: A2AVersion, contextId: string, text: string, data: Record<string, unknown>, extra: { taskId?: string } = {}) {
  const messageId = randomUUID()
  if (v === '1.0') {
    return { messageId, contextId, role: 'ROLE_AGENT', parts: [{ text }, { data, mediaType: 'application/json' }], ...extra }
  }
  return { kind: 'message', messageId, contextId, role: 'agent', parts: [{ kind: 'text', text }, { kind: 'data', data }], ...extra }
}

export type Runner = { tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>; allowCall: () => Promise<boolean> }

/** The default runner: the search MCP server's own handlers, validated by their own input schemas. */
export const searchRunner = (allowCall: () => Promise<boolean>): Runner => ({
  allowCall,
  tool: async (name, args) => {
    const tool = SEARCH_TOOLS_BY_NAME.get(name)
    if (!tool) throw new SearchToolError('internal_error', 'Unknown tool.')
    const parsed = tool.input.safeParse(args)
    if (!parsed.success) {
      throw new SearchToolError('invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
    }
    return tool.handler(parsed.data as Record<string, unknown>)
  },
})

/** One JSON-RPC request → its response (null for a notification, which gets no answer). */
export async function handleA2A(msg: Rpc, v: A2AVersion, run: Runner): Promise<object | null> {
  const validId = (id: unknown): id is Id => id === undefined || id === null || typeof id === 'string' || typeof id === 'number'
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || !validId(msg.id)) {
    const id = msg && typeof msg === 'object' && !Array.isArray(msg) && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null
    return rpcError(id, A2A_ERR.invalidRequest, 'Invalid Request')
  }
  if (msg.id === undefined) return null // a notification: JSON-RPC sends no response
  const id = msg.id as Id
  const kind = Object.prototype.hasOwnProperty.call(METHODS, msg.method) ? METHODS[msg.method] : undefined
  switch (kind) {
    case undefined: return rpcError(id, A2A_ERR.methodNotFound, `Method not found: ${String(msg.method).slice(0, 60)}`)
    case 'stream':
    case 'subscribe': return rpcError(id, A2A_ERR.unsupported, 'This agent does not stream: use SendMessage.')
    case 'push': return rpcError(id, A2A_ERR.pushNotSupported, 'This agent does not send push notifications.')
    case 'extendedCard': return rpcError(id, A2A_ERR.extendedCardNotConfigured, 'This agent has no extended card: the public card is all of it.')
    case 'getTask':
    case 'cancelTask': return rpcError(id, A2A_ERR.taskNotFound, 'Task not found: this agent answers each message directly and keeps no tasks.')
    case 'listTasks': return rpcResult(id, { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 })
    case 'send': break
  }
  const params = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? (msg.params as Record<string, unknown>) : null
  const message = params?.message && typeof params.message === 'object' && !Array.isArray(params.message) ? (params.message as Incoming) : null
  if (!message) return rpcError(id, A2A_ERR.invalidParams, 'params.message is required.')
  if (message.taskId !== undefined && message.taskId !== null && message.taskId !== '') {
    return rpcError(id, A2A_ERR.taskNotFound, 'Task not found: this agent keeps no tasks. Send a new message without taskId.')
  }
  const accepted = (params?.configuration as { acceptedOutputModes?: unknown } | undefined)?.acceptedOutputModes
  if (Array.isArray(accepted) && accepted.length > 0 && !accepted.some((m) => m === 'text/plain' || m === 'application/json' || m === '*/*' || m === 'text/*')) {
    return rpcError(id, A2A_ERR.contentType, 'This agent answers in text/plain and application/json.')
  }
  const ask = readAsk(message)
  if ('error' in ask) return rpcError(id, ask.error, ask.message)
  const contextId = typeof message.contextId === 'string' && message.contextId && message.contextId.length <= 128 ? message.contextId : randomUUID()
  if (!(await run.allowCall())) return rpcError(id, A2A_ERR.internal, 'Too many searches right now. Wait a minute and try again.')
  try {
    const result = await run.tool(SKILL_TOOL[ask.skill], ask.args)
    const reply = agentMessage(v, contextId, summarize(ask.skill, ask.args, result), { skill: ask.skill, ...result })
    return rpcResult(id, v === '1.0' ? { message: reply } : reply)
  } catch (e) {
    if (e instanceof SearchToolError) {
      // A listing that is gone is an answer, not a failure: the client asked a fair question.
      if (e.code === 'not_found' && ask.skill === 'listing-details') {
        const gone = { listing: null }
        const reply = agentMessage(v, contextId, summarize(ask.skill, ask.args, gone), { skill: ask.skill, ...gone })
        return rpcResult(id, v === '1.0' ? { message: reply } : reply)
      }
      const asked = e.code === 'invalid_input' || e.code === 'not_available'
      return rpcError(id, asked ? A2A_ERR.invalidParams : A2A_ERR.internal, e.message)
    }
    console.error('[a2a] skill failed', ask.skill, e)
    return rpcError(id, A2A_ERR.internal, 'The search failed. Try again shortly.')
  }
}
