import 'server-only'
import { z } from 'zod'
import { SITE_NAME } from '@/lib/edition'
import type { ToolAnnotations } from '@/lib/mcp/tools'

/**
 * The DOCS MCP server's tools (src/app/api/mcp/docs/route.ts; owner 2026-11-16 "Build it": ora's product + docs MCP
 * coverage). Two read-only tools over the documents this site already publishes for agents — nothing new is written:
 * `/llms.txt`, `/agents.md`, `/auth.md` and `/pricing.md`, each built by its own route's GET (so each says exactly what
 * that URL says, on this edition). `search_docs` finds the sections that match a question; `get_doc` returns one whole.
 * ⛔ PUBLIC DOCUMENTS ONLY: every one is served to anyone at its own URL, so this server reveals nothing they do not.
 * Cached in memory for 10 minutes: /llms.txt reads live site counts, and a docs question must not cost a query each time.
 */

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export type Doc = { id: string; title: string; url: string; text: string }

type Source = { id: string; path: string; load: () => Promise<Response | null> }

/** Each route's GET takes no request: src/app/md/agent-discovery.test.ts calls the real /agents.md and /auth.md handlers
 * exactly so, and /llms.txt's builder and /pricing.md's GET take none either. */
const SOURCES: Source[] = [
  { id: 'llms', path: '/llms.txt', load: async () => (await import('@/lib/llms-txt')).llmsIndexResponse() },
  { id: 'agents', path: '/agents.md', load: async () => (await import('@/app/md/agents/route')).GET() },
  { id: 'auth', path: '/auth.md', load: async () => (await import('@/app/md/auth/route')).GET() },
  { id: 'pricing', path: '/pricing.md', load: async () => (await import('@/app/md/pricing/route')).GET() },
]

const TTL_MS = 10 * 60_000
/** After a document FAILED to load (an error, not a 404), the set is kept only this long (commit gate, opus): one
 * database hiccup must not read as "no such document" for ten minutes. */
const TTL_AFTER_FAILURE_MS = 30_000
let cache: { at: number; ttl: number; docs: Doc[] } | null = null
/** One load at a time: calls that arrive on a cold or expired cache share it (commit gate, opus: no stampede). */
let loading: Promise<Doc[]> | null = null

/** The published documents, as their URLs serve them now (a document its route does not serve here — 404 — is left out). */
export async function loadDocs(origin: string, now = Date.now()): Promise<Doc[]> {
  if (cache && now - cache.at < cache.ttl) return cache.docs
  if (loading) return loading
  loading = fetchDocs(origin, now).finally(() => { loading = null })
  return loading
}

async function fetchDocs(origin: string, now: number): Promise<Doc[]> {
  const docs: Doc[] = []
  let failed = false
  for (const s of SOURCES) {
    const res = await s.load().catch((e) => {
      failed = true
      console.error('[mcp-docs] could not load', s.path, e)
      return null
    })
    if (!res) continue
    if (res.status !== 200) { if (res.status >= 500) failed = true; continue }
    // A body that fails while streaming drops that one document, never the others (commit gate, opus).
    const text = await res.text().catch((e) => {
      failed = true
      console.error('[mcp-docs] could not read', s.path, e)
      return null
    })
    if (text === null) continue
    const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? s.path
    docs.push({ id: s.id, title, url: `${origin}${s.path}`, text })
  }
  cache = { at: now, ttl: failed ? TTL_AFTER_FAILURE_MS : TTL_MS, docs }
  return docs
}

/** Test seam: forget the cached documents. */
export function resetDocsCache() {
  cache = null
  loading = null
}

type Section = { doc: Doc; heading: string; body: string }

function sections(doc: Doc): Section[] {
  const out: Section[] = []
  let heading = doc.title
  let body: string[] = []
  let fenced = false
  for (const line of doc.text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    // A `# comment` inside a code block is code, not a heading (commit gate, opus).
    const h = fenced ? null : /^#{1,4} (.+)$/.exec(line)
    if (h) {
      if (body.join('').trim()) out.push({ doc, heading, body: body.join('\n').trim() })
      heading = h[1].trim()
      body = []
    } else body.push(line)
  }
  if (body.join('').trim()) out.push({ doc, heading, body: body.join('\n').trim() })
  return out
}

const terms = (q: string) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))]

/** The best-matching sections: a term in the heading counts three, each occurrence in the body once. */
export function searchDocs(docs: Doc[], query: string, limit = 5) {
  const ts = terms(query)
  if (!ts.length) return []
  const scored = docs.flatMap(sections).map((s) => {
    const head = s.heading.toLowerCase()
    const body = s.body.toLowerCase()
    let score = 0
    for (const t of ts) {
      if (head.includes(t)) score += 3
      score += body.split(t).length - 1
    }
    return { s, score }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ s }) => {
    const lower = s.body.toLowerCase()
    // Around the first match in the body; from the top when only the heading matched.
    const hits = ts.map((t) => lower.indexOf(t)).filter((i) => i >= 0)
    const at = hits.length ? Math.max(0, Math.min(...hits) - 80) : 0
    return { doc_id: s.doc.id, doc_title: s.doc.title, section: s.heading, url: s.doc.url, snippet: s.body.slice(at, at + 400).trim() }
  })
}

export class DocsToolError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

/** Longest document text returned by get_doc; /llms.txt is under 30,000 characters by design. */
const DOC_MAX = 60_000

export type DocsTool = {
  name: string
  title: string
  description: string
  annotations: ToolAnnotations
  input: z.ZodType
  output: z.ZodType
  handler: (args: Record<string, unknown>, origin: string) => Promise<Record<string, unknown>>
}

export const DOCS_TOOLS: DocsTool[] = [
  {
    name: 'search_docs',
    title: 'Search the docs',
    description: `Search ${SITE_NAME}'s documentation for agents and developers: what the site is, the Partner API and MCP servers, how to authenticate, rate limits, rules and pricing. Returns up to 5 matching sections, each with its document's url.`,
    annotations: READ,
    input: z.object({
      query: z.string().min(1).max(200).describe('What to look up, in a few words, e.g. "rate limits" or "OAuth scopes"'),
    }),
    output: z.looseObject({
      results: z.array(z.object({
        doc_id: z.string().describe('Pass to get_doc for the whole document'),
        doc_title: z.string(),
        section: z.string().describe('The heading of the matching section'),
        url: z.string().describe('The document\'s public URL'),
        snippet: z.string().describe('Up to 400 characters of the section, around the first match'),
      })).describe('Best match first; empty when nothing matches'),
    }),
    handler: async (args, origin) => ({ results: searchDocs(await loadDocs(origin), String(args.query)) }),
  },
  {
    name: 'get_doc',
    title: 'Get a doc',
    description: `Get one of ${SITE_NAME}'s published documents in full, as markdown: "llms" (/llms.txt, what the site is), "agents" (/agents.md, its interfaces), "auth" (/auth.md, authentication) or "pricing" (/pricing.md, where this site publishes one).`,
    annotations: READ,
    input: z.object({
      id: z.string().min(1).max(20).describe('The document id: "llms", "agents", "auth" or "pricing"'),
    }),
    output: z.looseObject({
      id: z.string(),
      title: z.string(),
      url: z.string().describe('The document\'s public URL'),
      text: z.string().describe('The document as markdown'),
      truncated: z.boolean().describe('true when the text was cut at 60,000 characters; the url has it whole'),
    }),
    handler: async (args, origin) => {
      const doc = (await loadDocs(origin)).find((d) => d.id === String(args.id))
      if (!doc) throw new DocsToolError('not_found', 'No such document here right now. The ids are "llms", "agents", "auth" and, where this site publishes one, "pricing".')
      return { id: doc.id, title: doc.title, url: doc.url, text: doc.text.slice(0, DOC_MAX), truncated: doc.text.length > DOC_MAX }
    },
  },
]

export const DOCS_TOOLS_BY_NAME = new Map(DOCS_TOOLS.map((t) => [t.name, t]))

export function docsToolDescriptors() {
  return DOCS_TOOLS.map((t) => {
    const { $schema: _dialect, ...outputSchema } = z.toJSONSchema(t.output) as Record<string, unknown>
    void _dialect
    return { name: t.name, title: t.title, description: t.description, inputSchema: z.toJSONSchema(t.input), outputSchema, annotations: { title: t.title, ...t.annotations } }
  })
}
