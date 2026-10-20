import { beforeEach, describe, expect, it, vi } from 'vitest'

// Live chat through translateBatch, with the setup prod had on 2026-10-20: an Azure key that answers 401 on every
// call, and the box model (eno-mt) up. Keys are read at MODULE LOAD, so the env is set before the dynamic import.
process.env.AZURE_TRANSLATOR_KEY = 'test-key-not-a-real-credential'
process.env.AZURE_TRANSLATOR_REGION = 'southeastasia'
process.env.MT_LOCAL_URL = 'http://eno-mt:8088'

vi.mock('./db', () => ({
  db: { translation: { findMany: async () => [], upsert: async () => ({}) } },
}))

const azure: string[] = []
const box: Array<{ texts: string[]; source: string; target: string }> = []
// The box model's answers; a string mapped to '' comes back empty, which the gate refuses.
let boxAnswers: Record<string, string> = {}
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
  if (String(url).includes('cognitive.microsofttranslator.com')) {
    azure.push(String(url))
    return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '{"error":{"code":401001}}' }
  }
  const req = JSON.parse(String(init?.body ?? '{}')) as { texts: string[]; source: string; target: string }
  box.push(req)
  return { ok: true, status: 200, json: async () => ({ translations: req.texts.map((t) => boxAnswers[t] ?? `EN:${t}`) }) }
}))

const { translateBatch, azureUsable } = await import('./translate')

beforeEach(() => { azure.length = 0; box.length = 0; boxAnswers = {} })

describe('a refused Azure key is benched, not retried on every message', () => {
  it('the first 401 benches Azure; the next chat goes straight to the box model, and the bench expires', async () => {
    expect(azureUsable()).toBe(true)
    const stats = { providerFailed: false }
    const out = await translateBatch(['Is the room still free?'], 'vi', { source: 'chat', skipWrite: true, stats })
    expect(out).toEqual(['EN:Is the room still free?'])
    expect(azure).toHaveLength(1) // asked once, refused
    expect(azureUsable()).toBe(false)
    expect(stats.providerFailed).toBe(false)

    await translateBatch(['Can I see it tomorrow?'], 'vi', { source: 'chat', skipWrite: true })
    expect(azure).toHaveLength(1) // not asked again
    expect(azureUsable(Date.now() + 61 * 60 * 1000)).toBe(true)
  })
})

describe('chat decides the source language itself', () => {
  it('a hinted source wins over detection — restored Vietnamese reaches the box AS Vietnamese', async () => {
    // detectContentLang reads 'xin chào' (shared marks only) as unknown → assumed English → "English to English", skipped.
    const unhinted = await translateBatch(['xin chào'], 'en', { source: 'chat', skipWrite: true })
    expect(unhinted).toEqual(['xin chào'])
    expect(box).toHaveLength(0)

    const out = await translateBatch(['xin chào'], 'en', { source: 'chat', skipWrite: true, sourceHint: new Map([['xin chào', 'vi']]) })
    expect(out).toEqual(['EN:xin chào'])
    expect(box[0]).toMatchObject({ source: 'vi', target: 'en' })
  })

  it('failedTexts names exactly the strings that did not translate', async () => {
    boxAnswers = { 'Không biết nữa': '' } // refused by the gate (empty)
    const stats = { providerFailed: false, failedTexts: new Set<string>() }
    const out = await translateBatch(['Không biết nữa', 'Phòng còn trống không?'], 'en', {
      source: 'chat', skipWrite: true, stats, sourceHint: new Map([['Không biết nữa', 'vi'], ['Phòng còn trống không?', 'vi']]),
    })
    expect(out).toEqual(['Không biết nữa', 'EN:Phòng còn trống không?'])
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts]).toEqual(['Không biết nữa'])
  })
})
