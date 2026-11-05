import 'server-only'
import { openAiConfig } from '@/lib/classroom/llm-openai'

/**
 * LUNA DOES THE IMPORT'S AI WORK, GEMINI IS ITS FALLBACK (owner, 2026-11-05, after measuring both on the same 20 listings: Luna 20 of 20 prices at about 2 s a call; Gemini 3.8 Flash 19 of 20, with 1 call in 5 hanging).
 * Reasoning low, as asked. ⚠️ THERE IS NO gpt-6.1-luna: OpenAI answers model_not_found on eno's key (measured the same day), so this is the Luna eno already runs on. The listing is DATA here as it is for Gemini:
 * no tools, and sort.ts checks every value against the taxonomy. store:false, so OpenAI keeps no copy to show later. An error carries its status, never the listing's words. /privacy names OpenAI for this.
 */
export const FB_IMPORT_MODEL = 'gpt-6-luna'
const LUNA_TIMEOUT_MS = 30_000

/** Vertex's schema in the form OpenAI's strict mode takes: lower-case types, every field required, nothing extra. Pure, for the tests. */
export function strictSchema(schema: unknown): Record<string, unknown> {
  const s = schema as { type: string; nullable?: boolean; enum?: string[]; items?: unknown; properties?: Record<string, unknown> }
  const type = String(s.type).toLowerCase()
  const out: Record<string, unknown> = { type: s.nullable ? [type, 'null'] : type }
  if (s.enum) out.enum = s.enum
  if (s.items) out.items = strictSchema(s.items)
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, strictSchema(v)]))
    out.required = Object.keys(s.properties)
    out.additionalProperties = false
  }
  return out
}

/** The model's text out of a Responses API answer, or null if it refused or ran out of room. Pure, for the tests. */
export function outputText(answer: unknown): string | null {
  const a = answer as { status?: string; output?: { type?: string; content?: { type?: string; text?: string }[] }[] } | null
  if (a?.status !== 'completed') return null
  for (const item of a.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) if (part.type === 'output_text' && part.text) return part.text
  }
  return null
}

export async function askLuna(systemInstruction: string, responseSchema: object, listing: string, photo: string | null): Promise<string> {
  const cfg = openAiConfig()
  if (!cfg) throw new Error('luna_off')
  const res = await fetch(`${cfg.url}/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: FB_IMPORT_MODEL,
      instructions: systemInstruction,
      input: [{ role: 'user', content: [...(photo ? [{ type: 'input_image', image_url: `data:image/jpeg;base64,${photo}` }] : []), { type: 'input_text', text: listing }] }],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'answer', strict: true, schema: strictSchema(responseSchema) } },
      max_output_tokens: 4096,
      store: false,
    }),
    signal: AbortSignal.timeout(LUNA_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`luna_${res.status}`)
  const text = outputText(await res.json())
  if (!text) throw new Error('luna_no_answer')
  return text
}
