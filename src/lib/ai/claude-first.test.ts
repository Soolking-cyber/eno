import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in Anthropic SDK: each test sets what messages.create does.
const create = vi.fn()
const countTokens = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class APIUserAbortError extends Error {}
  class Anthropic {
    static APIUserAbortError = APIUserAbortError
    messages = { create, countTokens, stream: vi.fn() }
  }
  return { default: Anthropic }
})

process.env.ANTHROPIC_API_KEY = 'test-key'
const { asGeminiResponse, asJudge, claudeFirst, planFor, toClaudeMessages, toJsonSchema } = await import('./claude-first')

const claudeAnswer = (text: string, stop = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason: stop, model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5 } })
const geminiDouble = () => ({ models: { generateContent: vi.fn(async () => ({ text: 'from gemini' })), countTokens: vi.fn(async () => ({ totalTokens: 7 })) } })

beforeEach(() => { create.mockReset(); countTokens.mockReset() })

describe('the Gemini request, as Claude reads it', () => {
  it('a photo and a question become one user turn; the system text and the answer budget carry over', () => {
    const plan = planFor({
      model: 'gemini-4-hydrogen',
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'What is this?' }] }],
      config: { systemInstruction: 'You classify photos.', maxOutputTokens: 256, temperature: 0.2 },
    }, 'claude-haiku-5-5')!
    expect(plan.body.messages).toEqual([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'What is this?' }] }])
    expect(plan.body.system).toBe('You classify photos.')
    expect(plan.body).not.toHaveProperty('temperature') // these models refuse sampling settings
    expect(plan.body.max_tokens).toBe(256 + 4096) // room for thinking
  })
  it('a quick-thinking ask turns thinking off on Haiku and lowers effort on Sonnet (which refuses "disabled")', () => {
    const p = { contents: 'hi', config: { thinkingConfig: { thinkingLevel: 'LOW' }, maxOutputTokens: 100 } }
    const haiku = planFor(p, 'claude-haiku-5-5')!.body
    expect(haiku.thinking).toEqual({ type: 'disabled' })
    expect(haiku.max_tokens).toBe(100)
    const sonnet = planFor(p, 'claude-sonnet-5-5')!.body
    expect(sonnet.thinking).toBeUndefined()
    expect(sonnet.output_config).toEqual({ effort: 'low' })
  })
  it('a response schema becomes a strict JSON schema', () => {
    const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, tags: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1 }, note: { type: 'STRING', nullable: true } }, required: ['ok'], propertyOrdering: ['ok'] }
    expect(toJsonSchema(schema)).toEqual({
      type: 'object', additionalProperties: false, required: ['ok'],
      properties: { ok: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } }, note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    })
    const plan = planFor({ contents: 'x', config: { responseMimeType: 'application/json', responseSchema: schema } }, 'claude-haiku-5-5')!
    expect(plan.body.output_config?.format?.type).toBe('json_schema')
  })
  it('what only Gemini can do stays with Gemini: tools, video, a file URI, a prefilled answer', () => {
    expect(planFor({ contents: 'x', config: { tools: [{ googleSearch: {} }] } }, 'claude-haiku-5-5')).toBeNull()
    expect(toClaudeMessages([{ inlineData: { mimeType: 'video/mp4', data: 'AAAA' } }])).toBeNull()
    expect(toClaudeMessages([{ fileData: { fileUri: 'gs://x' } }])).toBeNull()
    expect(toClaudeMessages([{ role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'b' }] }])).toBeNull()
  })
  it('a conversation keeps its turns, model → assistant, and a PDF is a document', () => {
    expect(toClaudeMessages([
      { role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'b' }] },
      { role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'JVBE' } }] },
    ])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }] }, { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      { role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } }] },
    ])
  })
  it('the answer reads like Gemini\'s: text, finish reason, usage; a free-JSON fence is stripped', () => {
    const r = asGeminiResponse(claudeAnswer('```json\n{"a":1}\n```', 'max_tokens') as never, 'free')
    expect(r.text).toBe('{"a":1}')
    expect(r.candidates?.[0]?.finishReason).toBe('MAX_TOKENS')
    expect(r.usageMetadata?.totalTokenCount).toBe(15)
  })
})

describe('Claude first, Gemini as the backup', () => {
  it('answers from Claude when Claude answers', async () => {
    create.mockResolvedValue(claudeAnswer('hello'))
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    expect((await ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi' })).text).toBe('hello')
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-5-5')
    expect(gemini.models.generateContent).not.toHaveBeenCalled()
  })
  it('falls back to Gemini, with the call\'s own Gemini model, on an error or a refusal', async () => {
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    create.mockRejectedValueOnce(new Error('overloaded'))
    expect((await ai.models.generateContent({ model: 'gemini-3.5-flash-lite', contents: 'hi' })).text).toBe('from gemini')
    expect(gemini.models.generateContent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite' }))
    create.mockResolvedValueOnce(claudeAnswer('', 'refusal'))
    expect((await ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi' })).text).toBe('from gemini')
  })
  it('a JSON ask answered in prose goes to Gemini; a truncated JSON answer stays the caller\'s', async () => {
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    const ask = { model: 'gemini-4-hydrogen', contents: 'hi', config: { responseMimeType: 'application/json' } }
    create.mockResolvedValueOnce(claudeAnswer('I cannot help with that.'))
    expect((await ai.models.generateContent(ask)).text).toBe('from gemini')
    create.mockResolvedValueOnce(claudeAnswer('{"a":', 'max_tokens'))
    expect((await ai.models.generateContent(ask)).candidates?.[0]?.finishReason).toBe('MAX_TOKENS')
  })
  it('the Gemini backup gets what is left of the caller\'s time limit, not a second full one', async () => {
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    create.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50)))
    await ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi', config: { httpOptions: { timeout: 10_000 } } })
    const sent = (gemini.models.generateContent.mock.calls[0] as unknown as [{ config: { httpOptions: { timeout: number } } }])[0]
    expect(sent.config.httpOptions.timeout).toBeLessThan(10_000)
    expect(sent.config.httpOptions.timeout).toBeGreaterThan(9_000)
  })
  it('never falls back on the caller\'s own abort', async () => {
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    const ctl = new AbortController(); ctl.abort()
    create.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi', config: { abortSignal: ctl.signal } })).rejects.toThrow('aborted')
    expect(gemini.models.generateContent).not.toHaveBeenCalled()
  })
  it('sends what Claude cannot read straight to Gemini, without asking Claude', async () => {
    const gemini = geminiDouble()
    const ai = claudeFirst(gemini as never)!
    await ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'x', config: { tools: [{ googleSearch: {} }] } })
    expect(create).not.toHaveBeenCalled()
    expect(gemini.models.generateContent).toHaveBeenCalledOnce()
  })
  it('asJudge answers with Sonnet; a plain Gemini client passes through untouched', async () => {
    create.mockResolvedValue(claudeAnswer('ok'))
    const ai = claudeFirst(geminiDouble() as never)!
    await asJudge(ai)!.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi' })
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5-5')
    const plain = geminiDouble()
    expect(asJudge(plain as never)).toBe(plain)
  })
  it('works with no Gemini at all; says so plainly when Claude then fails', async () => {
    const ai = claudeFirst(null)!
    create.mockResolvedValueOnce(claudeAnswer('only claude'))
    expect((await ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi' })).text).toBe('only claude')
    create.mockRejectedValueOnce(new Error('down'))
    await expect(ai.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi' })).rejects.toThrow(/no Gemini backup/)
  })
})
