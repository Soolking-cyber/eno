import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A PLACE NAME IS NEVER MACHINE-TRANSLATED (owner, 2026-11-11: "thu duc is german general in english").
 * Measured on the live /api/translate the same day: "Thủ Đức" alone → "The German leader", and "Thu Duc" into Vietnamese
 * stayed unaccented. These tests drive translateBatch / cachedTranslations / uncachedStats with a fake Azure that
 * translates the place the way the real one did, and pin the rule (src/lib/i18n/place-names.ts):
 *  - a text of place names only is spelled for the target — no engine call, no cache read served, no cache row;
 *  - a sentence goes to the engine exactly as before, and its answer is served and cached as it came (nothing inside a
 *    sentence is rewritten — place-names.ts says why).
 * Provider keys are read at module load, so the env is set before the dynamic import (translate.test.ts says why).
 */
process.env.AZURE_TRANSLATOR_KEY = 'test-key-not-a-real-credential'
process.env.AZURE_TRANSLATOR_REGION = 'southeastasia'

type Row = { hash: string; target: string; value: string }
const state = { rows: [] as Row[], upserts: [] as Row[], sent: [] as string[] }
const sha1 = (t: string) => crypto.createHash('sha1').update(t).digest('hex')

// Gemini is Azure's fallback (src/lib/i18n/gemini-translate.ts). Mocked so a machine with Vertex credentials never calls it from a test;
// a case that wants it answering sets geminiMock.
const geminiMock = vi.hoisted(() => vi.fn(async (_texts: string[], _target: string, _opts?: unknown): Promise<string[] | null> => null))
const geminiConfigured = vi.hoisted(() => vi.fn(() => false))
vi.mock('./i18n/gemini-translate', () => ({ geminiTranslate: geminiMock, geminiTranslateConfigured: geminiConfigured }))

vi.mock('./db', () => ({
  db: {
    translation: {
      findMany: async (args: { where?: { target?: string; hash?: { in?: string[] } } }) => {
        const target = args?.where?.target
        const hashes = args?.where?.hash?.in ?? []
        return state.rows.filter((r) => (target == null || r.target === target) && hashes.includes(r.hash))
      },
      upsert: async (args: { where: { hash_target: { hash: string; target: string } }; create: Row }) => {
        state.upserts.push({ ...args.create })
        state.rows = state.rows.filter((r) => !(r.hash === args.create.hash && r.target === args.create.target))
        state.rows.push({ ...args.create })
        return args.create
      },
    },
  },
}))

// A fake engine with the real one's habits: a name alone is read word by word ("The German leader"), and English → Vietnamese
// leaves names unmarked or half-marked ("Bình Thanh"), as measured live.
const VI_EN: Record<string, string> = { 'Căn hộ': 'Apartment', 'gần': 'near', 'chợ': 'the market', 'Thủ Đức': 'The German leader' }
const EN_VI: Record<string, string> = { Apartment: 'Căn hộ', near: 'gần', in: 'ở', 'Room for rent': 'Phòng cho thuê', 'Binh Thanh': 'Bình Thanh', '{0}': '{0}' }
function fakeTranslate(text: string, target: string): string {
  let out = text
  const words = target === 'vi' ? EN_VI : VI_EN
  for (const [a, b] of Object.entries(words).sort((x, y) => y[0].length - x[0].length)) out = out.split(a).join(b)
  return out
}
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
  const items: { Text: string }[] = JSON.parse(String(init?.body ?? '[]'))
  const target = new URL(String(url)).searchParams.get('to') ?? ''
  state.sent.push(...items.map((i) => i.Text))
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => items.map((it) => ({ translations: [{ text: fakeTranslate(it.Text, target) }] })), text: async () => '' }
}))

const { translateBatch, cachedTranslations, uncachedStats } = await import('./translate')

beforeEach(() => {
  state.rows = []
  state.upserts = []
  state.sent = []
})

describe('a text of place names only is spelled, never translated', () => {
  it('"Thủ Đức" → "Thu Duc" in English, "Thủ Đức" in Vietnamese — no engine, no cache row', async () => {
    expect(await translateBatch(['Thủ Đức'], 'en', { source: 'api' })).toEqual(['Thu Duc'])
    expect(await translateBatch(['Thu Duc'], 'vi', { source: 'api' })).toEqual(['Thủ Đức'])
    expect(await translateBatch(['Gò Vấp, TP. Hồ Chí Minh'], 'en', { source: 'api' })).toEqual(['Go Vap, Ho Chi Minh City'])
    expect(await translateBatch(['Quận 7, TP.HCM'], 'en', { source: 'api' })).toEqual(['District 7, HCM City'])
    expect(state.sent).toEqual([])
    expect(state.upserts).toEqual([])
  })

  it('a bad row already in the cache is never served for it', async () => {
    state.rows.push({ hash: sha1('Thủ Đức'), target: 'en', value: 'The German leader' })
    expect(await translateBatch(['Thủ Đức'], 'en', { source: 'api' })).toEqual(['Thu Duc'])
  })

  it('a text over 120 characters is never looked at as a location, even a list of real places', async () => {
    const long = Array(12).fill('Thủ Đức, Gò Vấp').join(', ')
    expect(long.length).toBeGreaterThan(120)
    await translateBatch([long, 'Thủ Đức, Gò Vấp'], 'en', { source: 'api' })
    expect(state.sent).toEqual([long])
  })

  it('a list of English districts alone goes to the engine (it may be two film titles: "District 9 / District 13")', async () => {
    await translateBatch(['District 2, District 7'], 'vi', { source: 'api' })
    expect(state.sent).toEqual(['District 2, District 7'])
  })

  it('is not billed (uncachedStats counts nothing for it)', async () => {
    expect(await uncachedStats(['Thủ Đức', 'Bình Thạnh'], 'en')).toEqual({ count: 0, chars: 0 })
    expect(await uncachedStats(['Căn hộ Thủ Đức gần chợ'], 'en')).toEqual({ count: 1, chars: 'Căn hộ Thủ Đức gần chợ'.length })
  })
})

describe('a sentence goes to the engine as before', () => {
  it('vi → en: sent as written and served as answered — the engine is trusted inside a sentence (measured right live)', async () => {
    // This fake engine reads "Thủ Đức" word by word even in a sentence; the live one did not ("Căn hộ Thủ Đức" → "Thu Duc
    // Apartment"). Pinned so the scope is explicit: inside a sentence nothing is rewritten.
    expect(await translateBatch(['Căn hộ Thủ Đức gần chợ'], 'en', { source: 'api' })).toEqual(['Apartment The German leader near the market'])
    expect(state.sent).toEqual(['Căn hộ Thủ Đức gần chợ'])
    expect(state.upserts.length).toBe(1)
  })

  it('other languages: even a place-only text goes to the engine (their own script)', async () => {
    await translateBatch(['Thảo Điền, Thủ Đức'], 'ko', { source: 'api' })
    expect(state.sent).toEqual(['Thảo Điền, Thủ Đức'])
  })

  it('en → vi: served as the engine answered', async () => {
    expect(await translateBatch(['Room for rent Binh Thanh'], 'vi', { source: 'api' })).toEqual(['Phòng cho thuê Bình Thanh'])
  })
})

describe('cachedTranslations (what a page embeds)', () => {
  it('spells a place-only text for en and vi over a bad row, and leaves every other row as stored', async () => {
    state.rows.push({ hash: sha1('Thủ Đức'), target: 'en', value: 'The German leader' })
    state.rows.push({ hash: sha1('Thủ Đức'), target: 'ja', value: 'トゥードゥック' })
    state.rows.push({ hash: sha1('Apartment in Thao Dien'), target: 'vi', value: 'Căn hộ tại Thao Dien' })
    const out = await cachedTranslations(['Thủ Đức', 'Apartment in Thao Dien'])
    expect(out['Thủ Đức']).toEqual({ en: 'Thu Duc', vi: 'Thủ Đức', ja: 'トゥードゥック' })
    expect(out['Apartment in Thao Dien']).toEqual({ vi: 'Căn hộ tại Thao Dien' })
  })
})
