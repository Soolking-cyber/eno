import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { GoogleGenAI } from '@google/genai'
import { CLAUDE_FAST_MODEL, CLAUDE_JUDGE_MODEL, GEMINI_MODEL } from '@/lib/gemini-model'

/**
 * ⛔ CLAUDE FIRST, GEMINI AS THE BACKUP (owner, 2026-11-26: "replace all gemini models in app with claude api key choose best
 * model with lowest pricing for each job" → "gemini fallback").
 *
 * Every AI call in the app goes through getGemini() / getGeminiVertex() (src/lib/gemini.ts) and uses three methods of the
 * Gemini client — models.generateContent, models.generateContentStream, models.countTokens (measured 2026-11-26: nothing
 * else). This module is a stand-in for that client: it translates each Gemini-shaped request to the Claude Messages API,
 * and on any Claude failure (an error, a refusal, an input Claude cannot take) it sends the ORIGINAL request to Gemini,
 * unchanged. So no call site changes, and a Claude outage costs Gemini money rather than a broken feature.
 *
 * Which Claude model: the client's own default — CLAUDE_FAST_MODEL (Haiku 5.5, $0.10 / $0.50 per 1M tokens) for every job,
 * or CLAUDE_JUDGE_MODEL (Sonnet 5.5, $2 / $10) where asJudge() says so (moderation, admin review, CV import, the photo
 * checks' second opinion — owner's pick). The Gemini model id a call names stays its identity (photo checks record it);
 * only the Gemini backup uses it.
 *
 * Straight to Gemini, never Claude: a call with Gemini tools (googleSearch — the forum's itinerary routes), a part Claude
 * cannot read (video, audio, a file URI), or an assistant turn last (prefill).
 */

type GenParams = Parameters<GoogleGenAI['models']['generateContent']>[0]
type StreamParams = Parameters<GoogleGenAI['models']['generateContentStream']>[0]
type CountParams = Parameters<GoogleGenAI['models']['countTokens']>[0]
type GenResponse = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>

type Part = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string }; fileData?: unknown; functionCall?: unknown; functionResponse?: unknown; executableCode?: unknown; codeExecutionResult?: unknown; videoMetadata?: unknown }
type Content = { role?: string; parts?: Part[] }

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Gemini's many content shapes (string | Part | Part[] | Content | Content[]) → Claude messages, or null when Claude cannot take them. */
export function toClaudeMessages(contents: unknown): Anthropic.MessageParam[] | null {
  const list: Content[] = []
  const asContent = (c: unknown): Content => (typeof c === 'string' ? { role: 'user', parts: [{ text: c }] } : (c as Content).parts ? (c as Content) : { role: 'user', parts: [c as Part] })
  if (Array.isArray(contents)) {
    // Part[] (no roles) is ONE user turn; Content[] is a conversation.
    if (contents.every((c) => typeof c === 'string' || !(c as Content).parts)) list.push({ role: 'user', parts: contents.map((c) => (typeof c === 'string' ? { text: c } : (c as Part))) })
    else for (const c of contents) list.push(asContent(c))
  } else if (contents != null) list.push(asContent(contents))
  const out: Anthropic.MessageParam[] = []
  for (const c of list) {
    const role = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user'
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const p of c.parts || []) {
      if (p.thought) continue
      if (p.fileData || p.functionCall || p.functionResponse || p.executableCode || p.codeExecutionResult || p.videoMetadata) return null
      if (typeof p.text === 'string') { if (p.text.trim()) blocks.push({ type: 'text', text: p.text }); continue }
      if (p.inlineData) {
        const mime = (p.inlineData.mimeType || '').toLowerCase()
        const data = p.inlineData.data || ''
        if (!data) continue
        if (role !== 'user') return null
        if (IMAGE_TYPES.has(mime)) blocks.push({ type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg', data } })
        else if (mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
        else if (mime.startsWith('text/')) blocks.push({ type: 'text', text: Buffer.from(data, 'base64').toString('utf8') })
        else return null // video, audio, an office document: Gemini reads those
        continue
      }
    }
    if (!blocks.length) continue
    const last = out[out.length - 1]
    if (last && last.role === role) (last.content as Anthropic.ContentBlockParam[]).push(...blocks)
    else out.push({ role, content: blocks })
  }
  if (!out.length || out[0].role !== 'user' || out[out.length - 1].role !== 'user') return null
  return out
}

function systemText(si: unknown): string | undefined {
  if (si == null) return undefined
  if (typeof si === 'string') return si
  const parts: Part[] = Array.isArray(si) ? (si as Part[]) : (si as Content).parts || [si as Part]
  const t = parts.map((p) => (typeof p === 'string' ? p : p.text || '')).filter(Boolean).join('\n')
  return t || undefined
}

const FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'])

/** A Gemini response schema (Type.OBJECT … or plain JSON Schema) → the JSON Schema Claude's structured outputs accept. */
export function toJsonSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== 'object') return {}
  const src = s as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const t = typeof src.type === 'string' ? src.type.toLowerCase() : Array.isArray(src.type) ? undefined : undefined
  if (t && t !== 'type_unspecified') out.type = t
  if (Array.isArray(src.type)) out.type = (src.type as string[]).map((x) => String(x).toLowerCase())
  if (typeof src.description === 'string') out.description = src.description
  if (Array.isArray(src.enum)) out.enum = src.enum
  if (typeof src.format === 'string' && FORMATS.has(src.format)) out.format = src.format
  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) props[k] = toJsonSchema(v)
    out.properties = props
    if (!out.type) out.type = 'object'
  }
  if (out.type === 'object' || out.properties) {
    out.additionalProperties = false
    if (!out.properties) out.properties = {}
    if (Array.isArray(src.required)) out.required = (src.required as string[]).filter((k) => k in (out.properties as object))
  }
  if (src.items) out.items = toJsonSchema(src.items)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) if (Array.isArray(src[key])) out[key === 'oneOf' ? 'anyOf' : key] = (src[key] as unknown[]).map(toJsonSchema)
  if (src.nullable === true && out.type && !Array.isArray(out.type)) return { anyOf: [out, { type: 'null' }] }
  return out
}

type Config = {
  systemInstruction?: unknown; maxOutputTokens?: number; responseMimeType?: string; responseSchema?: unknown; responseJsonSchema?: unknown
  thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number; includeThoughts?: boolean }; tools?: unknown[]
  httpOptions?: { timeout?: number }; abortSignal?: AbortSignal; stopSequences?: string[]
}

type Plan = { body: Anthropic.MessageCreateParamsNonStreaming; options: { timeout?: number; signal?: AbortSignal; maxRetries: number }; json: 'schema' | 'free' | null }

/** The Claude request for a Gemini one, or null when only Gemini can answer it. */
export function planFor(params: { model?: string; contents?: unknown; config?: unknown }, claudeModel: string): Plan | null {
  const config = (params.config || {}) as Config
  if (Array.isArray(config.tools) && config.tools.length) return null
  const messages = toClaudeMessages(params.contents)
  if (!messages) return null
  const wantsJson = (config.responseMimeType || '').includes('json')
  const schema = config.responseJsonSchema ?? config.responseSchema
  const json: Plan['json'] = wantsJson ? (schema ? 'schema' : 'free') : null
  let system = systemText(config.systemInstruction)
  if (json === 'free') system = `${system ? `${system}\n\n` : ''}Answer with one JSON value only — no prose, no code fence.`
  // A quick-thinking ask (thinkingLevel LOW/MINIMAL, or a zero budget) → the least thinking: off on Haiku (accepted at effort
  // high or below), low effort on Sonnet (which refuses "disabled"). No ask → the model's own adaptive default.
  const tc = config.thinkingConfig
  const quick = !!tc && (tc.thinkingBudget === 0 || /^(low|minimal)$/i.test(tc.thinkingLevel || ''))
  const isHaiku = claudeModel.includes('haiku')
  const thinkingOff = quick && isHaiku
  // Room for thinking on top of the answer budget the caller sized for Gemini: an unused token costs nothing.
  const answer = config.maxOutputTokens && config.maxOutputTokens > 0 ? config.maxOutputTokens : 8192
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: claudeModel,
    max_tokens: Math.min(64_000, thinkingOff ? answer : answer + 4096),
    messages,
    ...(system ? { system } : {}),
    ...(thinkingOff ? { thinking: { type: 'disabled' } } : {}),
    ...(quick || json === 'schema' ? { output_config: { ...(quick ? { effort: 'low' as const } : {}), ...(json === 'schema' ? { format: { type: 'json_schema' as const, schema: toJsonSchema(schema) } } : {}) } } : {}),
    ...(config.stopSequences?.length ? { stop_sequences: config.stopSequences } : {}),
  }
  // No time limit of the caller's own: Claude still gets a bounded one (the SDK's default is minutes), so the backup is reached.
  return { body, options: { timeout: config.httpOptions?.timeout ?? CLAUDE_DEFAULT_TIMEOUT_MS, signal: config.abortSignal, maxRetries: 0 }, json }
}

// A call with no limit of its own (moderation, the admin review): Claude's share before the Gemini backup is asked.
const CLAUDE_DEFAULT_TIMEOUT_MS = 45_000

const FINISH: Record<string, string> = { end_turn: 'STOP', stop_sequence: 'STOP', max_tokens: 'MAX_TOKENS', refusal: 'SAFETY' }

/** Strip a ```json fence a free-JSON answer may still wrap itself in. */
const unfence = (t: string) => t.replace(/^\s*```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/, '')

/** A Claude message as the Gemini response shape the call sites read: .text, candidates[0].finishReason, usageMetadata. */
export function asGeminiResponse(msg: Anthropic.Message, json: Plan['json']): GenResponse {
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const text = json === 'free' ? unfence(raw) : raw
  const finishReason = FINISH[msg.stop_reason || ''] || 'OTHER'
  const prompt = (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0)
  return {
    text,
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: msg.usage.output_tokens, totalTokenCount: prompt + msg.usage.output_tokens },
    modelVersion: msg.model,
  } as unknown as GenResponse
}

const isAbort = (e: unknown, signal?: AbortSignal) => !!signal?.aborted || (e instanceof Error && (e.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError))

function noteFallback(model: string, why: string) {
  console.warn('[ai] claude → gemini fallback', JSON.stringify({ model, why: why.slice(0, 160) }))
}

/** The Gemini backup's model when a call named a Claude model directly. */
const geminiFor = (model: string | undefined) => (model && !model.startsWith('claude') ? model : GEMINI_MODEL)

class ClaudeFirstModels {
  constructor(private claude: Anthropic, private gemini: GoogleGenAI | null, readonly claudeModel: string) {}

  /** The original request to Gemini, within what is LEFT of the caller's own time limit (never a second full one). */
  private backup(params: GenParams, why: string, started: number) {
    if (!this.gemini) throw new Error(`Claude could not answer (${why}) and no Gemini backup is configured.`)
    noteFallback(this.claudeModel, why)
    const config = (params.config || {}) as Config
    const limit = config.httpOptions?.timeout
    const left = limit ? Math.max(2_000, limit - (Date.now() - started)) : undefined
    const next = left ? { ...params, config: { ...params.config, httpOptions: { ...config.httpOptions, timeout: left } } } : params
    return this.gemini.models.generateContent({ ...next, model: geminiFor(params.model) } as GenParams)
  }

  async generateContent(params: GenParams): Promise<GenResponse> {
    const plan = planFor(params, this.claudeModel)
    if (!plan) {
      if (!this.gemini) throw new Error('This request needs Gemini (tools, video or another input Claude cannot read), and Gemini is not configured.')
      return this.gemini.models.generateContent({ ...params, model: geminiFor(params.model) })
    }
    const started = Date.now()
    let msg: Anthropic.Message
    try {
      msg = await this.claude.messages.create(plan.body, plan.options)
    } catch (e) {
      if (isAbort(e, plan.options.signal)) throw e
      return this.backup(params, e instanceof Error ? `${e.name}: ${e.message}` : String(e), started)
    }
    if (msg.stop_reason === 'refusal') return this.backup(params, 'refusal', started)
    const out = asGeminiResponse(msg, plan.json)
    // A JSON answer that is not JSON (an "I can't" in prose) goes to Gemini too; a truncated one (MAX_TOKENS) stays the
    // caller's, which already re-asks with more room.
    if (plan.json && msg.stop_reason !== 'max_tokens') {
      try { JSON.parse(out.text || '') } catch { return this.backup(params, 'not JSON', started) }
    }
    return out
  }

  async generateContentStream(params: StreamParams): Promise<AsyncGenerator<GenResponse>> {
    const plan = planFor(params, this.claudeModel)
    const gemini = this.gemini
    const viaGemini = () => {
      if (!gemini) throw new Error('This request needs Gemini, and Gemini is not configured.')
      return gemini.models.generateContentStream({ ...params, model: geminiFor(params.model) }) as Promise<AsyncGenerator<GenResponse>>
    }
    if (!plan) return viaGemini()
    const stream = this.claude.messages.stream(plan.body, plan.options)
    const iterator = stream[Symbol.asyncIterator]()
    // Read up to the first word before answering: a Claude failure that early still falls back; a later one is the caller's.
    const head: string[] = []
    let first: IteratorResult<Anthropic.MessageStreamEvent> | null = null
    try {
      for (;;) {
        first = await iterator.next()
        if (first.done) break
        const ev = first.value
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { head.push(ev.delta.text); break }
        if (ev.type === 'message_delta' && ev.delta.stop_reason === 'refusal') throw new Error('refusal')
      }
    } catch (e) {
      if (isAbort(e, plan.options.signal)) throw e
      if (!gemini) throw e
      noteFallback(this.claudeModel, e instanceof Error ? e.message : String(e))
      return viaGemini()
    }
    const chunk = (text: string, finishReason?: string) => ({ text, candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finishReason ? { finishReason } : {}), index: 0 }] }) as unknown as GenResponse
    async function* rest(): AsyncGenerator<GenResponse> {
      if (head.length) yield chunk(head.join(''))
      if (first?.done) return
      for (;;) {
        const r = await iterator.next()
        if (r.done) break
        const ev = r.value
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield chunk(ev.delta.text)
        else if (ev.type === 'message_delta' && ev.delta.stop_reason) yield chunk('', FINISH[ev.delta.stop_reason] || 'OTHER')
      }
    }
    return rest()
  }

  async countTokens(params: CountParams) {
    const messages = toClaudeMessages(params.contents)
    if (messages) {
      try {
        const sys = systemText((params.config as Config | undefined)?.systemInstruction)
        const r = await this.claude.messages.countTokens({ model: this.claudeModel, messages, ...(sys ? { system: sys } : {}) })
        return { totalTokens: r.input_tokens } as Awaited<ReturnType<GoogleGenAI['models']['countTokens']>>
      } catch (e) {
        if (!this.gemini) throw e
      }
    }
    if (!this.gemini) throw new Error('Gemini is not configured.')
    return this.gemini.models.countTokens({ ...params, model: geminiFor(params.model) })
  }
}

let anthropic: Anthropic | null | undefined
function claudeClient(): Anthropic | null {
  if (anthropic !== undefined) return anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  anthropic = apiKey ? new Anthropic({ apiKey, maxRetries: 0 }) : null
  return anthropic
}

const MARK = Symbol.for('eno.claudeFirst')
type ClaudeFirst = GoogleGenAI & { [MARK]: { claude: Anthropic; gemini: GoogleGenAI | null } }

/** The app's AI client: Claude first (`model`), the given Gemini client as backup — or that Gemini client alone without a key. */
export function claudeFirst(gemini: GoogleGenAI | null, model: string = CLAUDE_FAST_MODEL): GoogleGenAI | null {
  const claude = claudeClient()
  if (!claude) return gemini
  const models = new ClaudeFirstModels(claude, gemini, model)
  return { models, [MARK]: { claude, gemini } } as unknown as ClaudeFirst
}

/** The same client answering with the JUDGE model (Sonnet 5.5) — for the calls where judgment matters more than cost. A plain
 *  Gemini client (no Anthropic key, or a test double) is returned as it is. */
export function asJudge<T extends GoogleGenAI | null>(ai: T): T {
  const inner = (ai as unknown as Partial<ClaudeFirst> | null)?.[MARK]
  if (!ai || !inner) return ai
  return { models: new ClaudeFirstModels(inner.claude, inner.gemini, CLAUDE_JUDGE_MODEL), [MARK]: inner } as unknown as T
}

/** Whether Claude answers first (the Anthropic key is set). */
export const claudeConfigured = () => claudeClient() !== null

/** Who receives what a consent record covers, and where — as configured NOW (a box without the key sends to Google alone). */
export function aiRecipient(): { recipient: string; location: string } {
  const google = process.env.GEMINI_LOCATION || 'global'
  return claudeConfigured()
    ? { recipient: 'Anthropic (Claude); Google Cloud (Vertex AI, Gemini) as backup', location: `United States (Anthropic); Google ${google} (backup)` }
    : { recipient: 'Google Cloud (Vertex AI, Gemini)', location: google }
}
