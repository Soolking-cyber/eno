import { beforeEach, describe, expect, it, vi } from 'vitest'

// The chat lane: a second eno-mt instance only interactive callers use, so a chat line never queues behind a
// listing import on the shared server's single inference lock. Env is read at MODULE LOAD — set it first.
process.env.MT_LOCAL_URL = 'http://eno-mt:8088'
process.env.MT_CHAT_URL = 'http://eno-mt-chat:8088'

const calls: string[] = []
let laneDown = false
let laneHung = false
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
  calls.push(String(url))
  if (laneDown && String(url).startsWith('http://eno-mt-chat')) return { ok: false, status: 502, json: async () => ({}) }
  if (laneHung && String(url).startsWith('http://eno-mt-chat')) {
    // A wedged lane: answers only by being aborted.
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  const { texts } = JSON.parse(String(init?.body ?? '{}')) as { texts: string[] }
  return { ok: true, status: 200, json: async () => ({ translations: texts.map((t) => `EN:${t}`) }) }
}))

const { localTranslate } = await import('./mt-local')

beforeEach(() => { calls.length = 0; laneDown = false; laneHung = false })

describe('localTranslate — the chat lane', () => {
  it('an interactive caller uses the chat lane', async () => {
    const r = await localTranslate(['xin chào bạn'], 'vi', 'en', 5_000, { interactive: true })
    expect(r?.values).toEqual(['EN:xin chào bạn'])
    expect(calls).toEqual(['http://eno-mt-chat:8088/translate'])
  })

  it('bulk work never touches it', async () => {
    await localTranslate(['Máy lạnh Daikin 1.0HP'], 'vi', 'en')
    expect(calls).toEqual(['http://eno-mt:8088/translate'])
  })

  it('a dead chat lane falls back to the shared server instead of failing the chat', async () => {
    laneDown = true
    const r = await localTranslate(['xin chào bạn'], 'vi', 'en', 5_000, { interactive: true })
    expect(r?.values).toEqual(['EN:xin chào bạn'])
    expect(calls).toEqual(['http://eno-mt-chat:8088/translate', 'http://eno-mt:8088/translate'])
  })
})

describe('a hung chat lane still leaves time for the shared server', () => {
  it('the lane gets at most half the budget, then the shared server answers', async () => {
    laneHung = true
    const started = Date.now()
    const r = await localTranslate(['xin chào bạn'], 'vi', 'en', 2_400, { interactive: true })
    expect(r?.values).toEqual(['EN:xin chào bạn'])
    expect(calls).toEqual(['http://eno-mt-chat:8088/translate', 'http://eno-mt:8088/translate'])
    expect(Date.now() - started).toBeLessThan(2_400)
  })
})
