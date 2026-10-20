import { beforeEach, describe, expect, it, vi } from 'vitest'

// Live chat through translateBatch, with the setup prod had on 2026-10-20: an Azure key that answers 401 on every
// call (unless a test says otherwise — `azureDoes`), and the box model (eno-mt) up. Keys are read at MODULE LOAD, so
// the env is set before the dynamic import.
process.env.AZURE_TRANSLATOR_KEY = 'test-key-not-a-real-credential'
process.env.AZURE_TRANSLATOR_REGION = 'southeastasia'
process.env.MT_LOCAL_URL = 'http://eno-mt:8088'

// Every write to the shared Translation table.
const dbWrites = vi.hoisted(() => [] as unknown[])
vi.mock('./db', () => ({
  db: {
    translation: { findMany: async () => [], upsert: async (args: unknown) => { dbWrites.push(args); return {} } },
  },
}))

const azure: string[] = []
// What Azure does with a call: 401 (the dead key prod had), 'throws' (a network error — DNS, a reset connection: thrown
// fast) or 'translates' (a working key).
let azureDoes: 401 | 'throws' | 'translates' = 401
const box: Array<{ texts: string[]; source: string; target: string }> = []
// The box model's answers; a string mapped to '' comes back empty, which the gate refuses.
let boxAnswers: Record<string, string> = {}
// A source language whose box request fails: 'reject' = the fetch itself throws (the container is gone), 500 = the
// server answered with an error. Either is an OUTAGE — nothing answered — never a refusal.
let boxDown: Record<string, 'reject' | 500> = {}
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
  if (String(url).includes('cognitive.microsofttranslator.com')) {
    azure.push(String(url))
    if (azureDoes === 'throws') throw new TypeError('fetch failed')
    if (azureDoes === 'translates') {
      const sent = JSON.parse(String(init?.body ?? '[]')) as Array<{ Text: string }>
      const json = async () => sent.map((s) => ({ translations: [{ text: `AZ:${s.Text}` }] }))
      return { ok: true, status: 200, headers: { get: () => null }, json }
    }
    return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '{"error":{"code":401001}}' }
  }
  const req = JSON.parse(String(init?.body ?? '{}')) as { texts: string[]; source: string; target: string }
  box.push(req)
  if (boxDown[req.source] === 'reject') throw new TypeError('fetch failed')
  if (boxDown[req.source] === 500) return { ok: false, status: 500, json: async () => ({ error: 'translate_failed' }) }
  return { ok: true, status: 200, json: async () => ({ translations: req.texts.map((t) => boxAnswers[t] ?? `EN:${t}`) }) }
}))

const { translateBatch, azureUsable } = await import('./translate')

beforeEach(() => {
  azure.length = 0; azureDoes = 401
  box.length = 0; boxAnswers = {}; boxDown = {}; dbWrites.length = 0
})

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

describe('a refusal is final, an outage is not', () => {
  // What the box model answered to the owner's "hey" on 2026-10-21 — refused by the gate (length-ratio).
  const HEY = 'hhhhhhhhhhhhhhhhhhhhhhhhhh'
  const chatStats = () => ({ providerFailed: false, failedTexts: new Set<string>(), refusedTexts: new Set<string>() })
  const asEnglish = (...lines: string[]) => new Map(lines.map((l) => [l, 'en']))

  it('a lone refused line is served as its source and named a REFUSAL — not reported as a dead provider', async () => {
    boxAnswers = { hey: HEY }
    const stats = chatStats()
    const out = await translateBatch(['hey'], 'vi', {
      source: 'chat', skipWrite: true, stats, sourceHint: asEnglish('hey'),
    })
    expect(out).toEqual(['hey'])
    expect(box).toHaveLength(1) // the model was asked, and answered
    // providerFailed and failedTexts exactly as before; refusedTexts says which kind of failure it was
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts]).toEqual(['hey'])
    expect([...stats.refusedTexts]).toEqual(['hey'])
  })

  it.each([
    ['its fetch rejects', 'reject' as const],
    ['it answers 500', 500 as const],
  ])('the box DOWN (%s) is an outage: failed, never refused', async (_label, how) => {
    boxDown = { en: how }
    const stats = chatStats()
    const out = await translateBatch(['hey'], 'vi', {
      source: 'chat', skipWrite: true, stats, sourceHint: asEnglish('hey'),
    })
    expect(out).toEqual(['hey'])
    expect(box).toHaveLength(1)
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts]).toEqual(['hey'])
    expect(stats.refusedTexts.size).toBe(0)
  })

  it('a refusal beside a translation: the translation is kept, only the refused line is named', async () => {
    boxAnswers = { hey: HEY }
    const stats = chatStats()
    const out = await translateBatch(['hey', 'Is the room still free?'], 'vi', {
      source: 'chat', skipWrite: true, stats, sourceHint: asEnglish('hey', 'Is the room still free?'),
    })
    expect(out).toEqual(['hey', 'EN:Is the room still free?'])
    expect([...stats.failedTexts]).toEqual(['hey'])
    expect([...stats.refusedTexts]).toEqual(['hey'])
  })

  it('mixed groups: refused where the server answered, an outage where it did not', async () => {
    boxAnswers = { 'Không biết nữa': '' } // refused by the gate (empty)
    boxDown = { fr: 'reject' }
    const stats = chatStats()
    const out = await translateBatch(['Không biết nữa', 'Bonjour, merci beaucoup'], 'en', {
      source: 'chat', skipWrite: true, stats,
      sourceHint: new Map([['Không biết nữa', 'vi'], ['Bonjour, merci beaucoup', 'fr']]),
    })
    expect(out).toEqual(['Không biết nữa', 'Bonjour, merci beaucoup'])
    expect(box.map((r) => r.source).sort()).toEqual(['fr', 'vi'])
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts].sort()).toEqual(['Bonjour, merci beaucoup', 'Không biết nữa'])
    expect([...stats.refusedTexts]).toEqual(['Không biết nữa'])
  })

  it('a caller that does not ask sees no change: providerFailed, failedTexts, no cache row for the refusal', async () => {
    boxAnswers = { 'Máy lạnh còn mới': '' }
    const stats = { providerFailed: false, failedTexts: new Set<string>() }
    const lines = ['Máy lạnh còn mới', 'Phòng rất đẹp và sạch sẽ']
    const out = await translateBatch(lines, 'en', { source: 'warm', stats })
    expect(out).toEqual(['Máy lạnh còn mới', 'EN:Phòng rất đẹp và sạch sẽ'])
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts]).toEqual(['Máy lạnh còn mới'])
    // only the real translation reaches the shared table — the refusal is not "translates to itself"
    const written = { target: 'en', value: 'EN:Phòng rất đẹp và sạch sẽ' }
    expect(dbWrites).toEqual([expect.objectContaining({ create: expect.objectContaining(written) })])
  })

  it('a chunk where EVERY line was refused — once a null chunk — gives such a caller the same output and stats', async () => {
    const lines = ['Máy lạnh còn mới', 'Phòng rất đẹp và sạch sẽ']
    boxAnswers = Object.fromEntries(lines.map((l) => [l, '']))
    const stats = { providerFailed: false, failedTexts: new Set<string>() }
    const out = await translateBatch(lines, 'en', { source: 'warm', stats })
    expect(out).toEqual(lines)
    expect(box).toHaveLength(1) // the model answered both, and both were refused
    expect(stats.providerFailed).toBe(true)
    expect([...stats.failedTexts].sort()).toEqual([...lines].sort())
    expect(dbWrites).toEqual([])
  })

  // Everything above runs with Azure benched by the first test's 401 — the state prod is in. Chat is built for a
  // WORKING key (Azure first, the box model when Azure fails), so these two move the fake clock past any bench.
  const keyWorks = () => {
    vi.useFakeTimers()
    let t = Date.now()
    while (!azureUsable(t)) t += 60 * 60 * 1000
    vi.setSystemTime(t)
  }
  const sayHey = (stats?: ReturnType<typeof chatStats>) =>
    translateBatch(['hey'], 'vi', { source: 'chat', skipWrite: true, stats, sourceHint: asEnglish('hey') })

  it('a working key that failed THIS time: no refusal but an outage — the retry asks Azure first', async () => {
    keyWorks()
    try {
      azureDoes = 'throws'
      boxAnswers = { hey: HEY }
      const stats = chatStats()
      const first = sayHey(stats)
      await vi.runAllTimersAsync() // azureTranslate's backoff between attempts
      expect(await first).toEqual(['hey'])
      expect(box).toHaveLength(1) // the box model answered, and was refused...
      expect(azureUsable()).toBe(true) // ...while the paid provider is still there to ask
      expect(stats.providerFailed).toBe(true)
      expect([...stats.failedTexts]).toEqual(['hey'])
      expect(stats.refusedTexts.size).toBe(0) // so the route retries it rather than banking the original
      azureDoes = 'translates' // what the retry meets once Azure is back
      expect(await sayHey()).toEqual(['AZ:hey'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 401 in the same request: the refusal is final — the bench keeps every retry from Azure', async () => {
    keyWorks()
    try {
      boxAnswers = { hey: HEY }
      const stats = chatStats()
      expect(await sayHey(stats)).toEqual(['hey'])
      expect(azure).toHaveLength(1) // asked first, refused the key, benched — never asked again
      expect(azureUsable()).toBe(false)
      expect([...stats.refusedTexts]).toEqual(['hey'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('no paid key at all — a deploy without one, or local dev', () => {
  it('a refusal is final there too: no provider to ask, so refusedTexts names it and Azure is never called', async () => {
    const saved = process.env.AZURE_TRANSLATOR_KEY
    delete process.env.AZURE_TRANSLATOR_KEY
    vi.resetModules() // the key is read at module load
    try {
      const fresh = await import('./translate')
      expect(fresh.azureUsable()).toBe(false)
      boxAnswers = { hey: 'hhhhhhhhhhhhhhhhhhhhhhhhhh' } // the live answer to "hey", refused (length-ratio)
      const stats = { providerFailed: false, failedTexts: new Set<string>(), refusedTexts: new Set<string>() }
      const out = await fresh.translateBatch(['hey'], 'vi', {
        source: 'chat', skipWrite: true, stats, sourceHint: new Map([['hey', 'en']]),
      })
      expect(out).toEqual(['hey'])
      expect(box).toHaveLength(1)
      expect(azure).toHaveLength(0)
      expect([...stats.refusedTexts]).toEqual(['hey'])
    } finally {
      process.env.AZURE_TRANSLATOR_KEY = saved
    }
  })
})
