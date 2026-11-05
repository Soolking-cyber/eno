// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const cfg = vi.hoisted(() => ({ value: { key: 'sk-test', url: 'https://api.openai.com' } as { key: string; url: string } | null }))
vi.mock('@/lib/classroom/llm-openai', () => ({ openAiConfig: () => cfg.value }))

const { askLuna, outputText, strictSchema } = await import('./luna')
const done = (text: string) => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] })

afterEach(() => { vi.unstubAllGlobals(); cfg.value = { key: 'sk-test', url: 'https://api.openai.com' } })

describe('strictSchema', () => {
  it('turns Vertex’s shape into OpenAI’s strict one', () => {
    expect(strictSchema({ type: 'OBJECT', properties: { unit: { type: 'STRING', enum: ['a', 'b'] }, year: { type: 'NUMBER', nullable: true }, tags: { type: 'ARRAY', items: { type: 'STRING', enum: ['x'] } } }, required: ['unit'] })).toEqual({
      type: 'object',
      properties: { unit: { type: 'string', enum: ['a', 'b'] }, year: { type: ['number', 'null'] }, tags: { type: 'array', items: { type: 'string', enum: ['x'] } } },
      required: ['unit', 'year', 'tags'],
      additionalProperties: false,
    })
  })
})

describe('outputText', () => {
  it('finds the message past the reasoning', () => expect(outputText(done('{}'))).toBe('{}'))
  it.each([[{ status: 'incomplete', output: [] }], [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }], [null]])('%j is no answer', (a) => expect(outputText(a)).toBeNull())
})

describe('askLuna', () => {
  it('asks Luna on low, keeps nothing at OpenAI, and sends the photo beside the text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(done('{"a":1}')), { status: 200 }))
    vi.stubGlobal('fetch', f)
    expect(await askLuna('sys', { type: 'OBJECT', properties: {} }, 'listing', 'AAA')).toBe('{"a":1}')
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ model: 'gpt-6-luna', instructions: 'sys', reasoning: { effort: 'low' }, store: false, text: { format: { type: 'json_schema', strict: true } } })
    expect(body.input[0].content).toEqual([{ type: 'input_image', image_url: 'data:image/jpeg;base64,AAA' }, { type: 'input_text', text: 'listing' }])
  })
  it('no key: says so, sends nothing', async () => {
    cfg.value = null
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(askLuna('s', {}, 'l', null)).rejects.toThrow('luna_off')
    expect(f).not.toHaveBeenCalled()
  })
  it('an error names its status and never the listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret words', { status: 500 })))
    await expect(askLuna('s', {}, 'secret words', null)).rejects.toThrow(/^luna_500$/)
  })
})
