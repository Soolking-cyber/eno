'use client'

import { useEffect } from 'react'
import { SITE_NAME } from '@/lib/edition'

/**
 * WebMCP — the listing-search tools of this site, offered to a BROWSER AGENT on the page itself (ora.ai, 2026-11-15:
 * "no document.modelContext / navigator.modelContext usage found"; WebMCP is the proposed web standard for in-page
 * agent tools, in a Chrome origin trial).
 *
 * ⛔ THE SAME TOOLS AS THE PUBLIC SEARCH MCP SERVER, NOT NEW ONES. Their names, descriptions and input schemas come from
 * `tools/list` on /api/mcp/search, and every call is a `tools/call` there: read-only (search_listings,
 * get_listing_details, list_categories), the licensing filter, the rate limit and the input bounds are that endpoint's
 * own. Nothing here can do more than a stranger with curl.
 * ⛔ `credentials: 'omit'`: the calls carry no cookie, so a signed-in reader's agent sees exactly the public results —
 * never a draft, a hidden listing or anything tied to the session (plan review, codex, 2026-11-15).
 * ⚠️ NOTHING HAPPENS IN A NORMAL BROWSER: without `modelContext` the effect returns before any request, so visitors pay
 * one feature check per navigation.
 * ⛔ THE TOOLS BELONG TO THE DOCUMENT, AND SO DOES THIS JOB (commit gate rounds 4–9: every version tied to the React
 * component — re-run on navigation, latched, cleaned up on unmount, compared against the wall clock — had a state where
 * a reader was left without tools). `startWebMcp()` starts ONE loop per document, whoever calls it and however often;
 * it registers each read-only tool once, by name, and stops when all are in. ANY failure (offline, timeout, an HTTP
 * error, a reply that will not parse, a tool the browser refuses) waits and tries again — 1 minute doubling to 15 —
 * driven by `setTimeout` alone, so no navigation, remount or clock change can strand it, and a stuck visitor costs one
 * tools/list per window.
 * Listing text is written by users: an agent reading it is reading untrusted text, as on the page itself.
 */

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }
type WebMcpTool = {
  name: string
  description: string
  inputSchema: unknown
  annotations?: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
}
type ModelContext = { registerTool: (tool: WebMcpTool) => unknown | Promise<unknown> }

const ENDPOINT = '/api/mcp/search'
/** Names registered in this document (or skipped as not read-only). */
const registered = new Set<string>()
const BACKOFF_MIN_MS = 60_000
const BACKOFF_MAX_MS = 15 * 60_000
let started = false

/** The JSON-RPC reply to request id 1, from a JSON body or from Server-Sent Events. SSE is read AS IT ARRIVES (commit
 * gate, codex): each event's `data:` lines joined, the event carrying id 1 returned the moment it is complete and the rest
 * of the stream cancelled — a server that keeps the stream open after replying must not turn a reply into a timeout. */
async function message(res: Response): Promise<{ id?: unknown; result?: unknown; error?: { message?: string } }> {
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return JSON.parse(await res.text())
  const reader = res.body?.getReader()
  if (!reader) throw new Error('empty event stream')
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : events.pop() ?? ''
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n')
        if (!data) continue
        const msg = JSON.parse(data) as { id?: unknown }
        if (msg.id === 1) return msg
      }
      if (done) throw new Error('no reply in the event stream')
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}

async function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    // A request that never settles must not stall the loop: it fails after 10 s and the backoff takes over (commit gate, codex).
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await message(res)
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? `HTTP ${res.status}`)
  return body.result
}

/** `document.modelContext` first, `navigator.modelContext` as the trailing compatibility fallback (ora's guidance). */
function modelContext(): ModelContext | null {
  const usable = (mc: ModelContext | undefined) => (mc && typeof mc.registerTool === 'function' ? mc : null)
  // Each checked on its own (commit gate, codex): a document object without a usable registerTool must not hide a
  // navigator one that has it.
  return usable((document as unknown as { modelContext?: ModelContext }).modelContext)
    ?? usable((navigator as unknown as { modelContext?: ModelContext }).modelContext)
}

type ListedTool = { name: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }

/** Every page of tools/list (MCP pagination, `nextCursor`), at most 10 pages (commit gate, codex). */
async function listTools(): Promise<ListedTool[]> {
  const tools: ListedTool[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const list = (await rpc('tools/list', cursor ? { cursor } : {})) as { tools?: ListedTool[]; nextCursor?: string }
    tools.push(...(list.tools ?? []))
    cursor = typeof list.nextCursor === 'string' && list.nextCursor ? list.nextCursor : undefined
    if (!cursor) break
  }
  return tools
}

async function registerMissing(mc: ModelContext): Promise<void> {
  const tools = await listTools()
  for (const t of tools) {
    if (registered.has(t.name)) continue
    // ⛔ ONLY A TOOL THE SERVER ITSELF MARKS READ-ONLY (commit gate, opus): the label is the server's, never forced here, so
    // a writing tool added to /api/mcp/search one day is not offered to the page's agent as harmless — it is skipped.
    if (t.annotations?.readOnlyHint !== true) { registered.add(t.name); continue }
    try {
      // Awaited: an implementation whose registerTool returns a Promise and rejects it is a refusal too (commit gate, opus).
      await mc.registerTool({
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        annotations: t.annotations,
        execute: async (args) => {
          try {
            return (await rpc('tools/call', { name: t.name, arguments: args ?? {} })) as ToolResult
          } catch (e) {
            return { content: [{ type: 'text', text: `${SITE_NAME} search failed: ${(e as Error).message}` }], isError: true }
          }
        },
      })
      registered.add(t.name)
    } catch {
      /* this one tool is refused here; the others still register, and the next attempt tries it again */
    }
  }
  if (!(tools.length > 0 && tools.every((t) => registered.has(t.name)))) throw new Error('a tool was refused')
}

/** At most this many attempts per document — about 2½ hours at the backoff above — so a failure that will not change
 * (a schema the browser never accepts) ends instead of costing one request every 15 minutes for as long as the tab is
 * open (commit gate, opus). ⚖️ A DELIBERATE TRADE (the reviewers asked for both, rounds 6–11): bounded background work
 * over recovery at any hour — after the last attempt, or the last late check below, a reload starts it again. */
const MAX_ATTEMPTS = 10
/** A browser (or an agent extension) may expose `modelContext` a moment after the page loads (commit gate, codex): looked
 * for again at these delays, then never. */
const LATE_CHECKS_MS = [2_000, 10_000, 30_000]

/** One loop per document (see the header): idempotent, timer-driven, stops when every read-only tool is in. */
export function startWebMcp(): void {
  if (started) return
  started = true
  const begin = (mc: ModelContext) => {
    let failures = 0
    const attempt = async (): Promise<void> => {
      try {
        await registerMissing(mc)
      } catch {
        failures++
        if (failures >= MAX_ATTEMPTS) return
        setTimeout(() => void attempt(), Math.min(BACKOFF_MIN_MS * 2 ** (failures - 1), BACKOFF_MAX_MS))
      }
    }
    void attempt()
  }
  const now = modelContext()
  if (now) { begin(now); return }
  let found = false
  for (const delay of LATE_CHECKS_MS) {
    setTimeout(() => {
      if (found) return
      const late = modelContext()
      if (late) { found = true; begin(late) }
    }, delay)
  }
}

export function WebMcpTools() {
  useEffect(() => { startWebMcp() }, [])
  return null
}
