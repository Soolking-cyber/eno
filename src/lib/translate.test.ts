import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Never pay to translate text into its own language ──────────────────────────────────
//
// warmTranslations pushes every listing string into each of EAGER_WARM_LANGS, and 'vi' is
// one of them — so on a Vietnamese-first marketplace the vi→vi leg was billed on every
// create and edit and handed back the input. translateBatch now resolves such a string to
// itself with no provider call — after the cache read, so a previously-cached translation
// still wins.
//
// The property these tests actually defend is narrow and two-sided, because both failure
// directions cost something real:
//   · skipping too little  → money burned on no-op translations;
//   · skipping too much    → a reader is served text in a language they did not ask for,
//     which is WORSE than the bill.
// Hence the standing rule the cases below pin down: certify the WHOLE string, or pay. A
// positive detection is only the entry condition — never enough on its own — and the
// languages whose script cannot certify them (zh, ja, ru) are not skipped at all.
//
// ⚠️ Provider keys are read at MODULE LOAD, so the env has to be set before the dynamic
// import below — a top-level `import` would bind them as undefined and every test would
// pass vacuously (no key ⇒ passthrough ⇒ "no upstream call" is trivially true).
process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key-not-a-real-credential'

type Row = { hash: string; target: string; value: string }

const state = {
  rows: [] as Row[],
  findMany: 0,
  upserts: [] as { hash: string; target: string; value: string }[],
  fetches: [] as string[],
}

vi.mock('./db', () => ({
  db: {
    translation: {
      findMany: async (args: { where?: { target?: string; hash?: { in?: string[] } } }) => {
        state.findMany++
        const target = args?.where?.target
        const hashes = args?.where?.hash?.in
        // A read that isn't scoped by BOTH would serve another language's cache.
        if (!target || !Array.isArray(hashes)) {
          throw new Error('mock: translation.findMany must be scoped by target AND hash.in')
        }
        return state.rows.filter((r) => r.target === target && hashes.includes(r.hash))
      },
      upsert: async (args: { where: { hash_target: { hash: string; target: string } }; create: Row }) => {
        state.upserts.push({ ...args.create })
        state.rows.push({ ...args.create })
        return args.create
      },
    },
  },
}))

// Stand-in provider. Marks its output so a translated string is distinguishable from a
// passthrough — otherwise "translated to itself" and "never called" look identical.
const PREFIX = '[mt]'
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  state.fetches.push(String(url))
  const q: string[] = JSON.parse(String(init?.body ?? '{}')).q ?? []
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { translations: q.map((s) => ({ translatedText: `${PREFIX}${s}` })) } }),
    text: async () => '',
  }
})
vi.stubGlobal('fetch', fetchMock)

const { translateBatch, uncachedStats } = await import('./translate')

// Vietnamese-exclusive diacritics (Đ, ạ) — detectContentLang reports 'vi'.
const VI = 'Điện thoại cũ đã qua sử dụng'
// Hangul → 'ko'.
const KO = '중고 휴대폰'
// Han, deliberately TRADITIONAL — the detector can only say 'zh', not which script.
const ZH_HANT = '二手手機'
// Plain Latin → detectContentLang returns null by design.
const EN = 'Used phone in good condition'

beforeEach(() => {
  state.rows = []
  state.findMany = 0
  state.upserts = []
  state.fetches = []
  fetchMock.mockClear()
})

describe('translateBatch · same-language is free', () => {
  it('makes NO upstream call and writes NO cache row for vi → vi', async () => {
    const out = await translateBatch([VI], 'vi', { source: 'test' })

    // The point of the change: nothing billable happens.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.fetches).toEqual([])
    // And no identity row is added to a table every page reads.
    expect(state.upserts).toEqual([])
    // The caller still gets usable text back, in order.
    expect(out).toEqual([VI])
    // ONE indexed cache read still happens, deliberately. It is the price of letting a
    // previously-cached translation win over our own same-language guess (see the
    // 'cached translation beats the skip' case below) — a free read to avoid discarding
    // paid-for work.
    expect(state.findMany).toBe(1)
  })

  it('skips ko → ko and th → th too, not just Vietnamese', async () => {
    expect(await translateBatch([KO], 'ko', { source: 'test' })).toEqual([KO])
    expect(await translateBatch(['โทรศัพท์มือสอง สภาพดี'], 'th', { source: 'test' })).toEqual([
      'โทรศัพท์มือสอง สภาพดี',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never skips ru → ru, because Cyrillic is not exclusively Russian', async () => {
    // Bulgarian shares essentially all of Russian's letters, so no letter-veto can exclude it
    // and a skip could serve Bulgarian to a Russian reader. Russian keeps paying.
    const ru = 'Телефон бывший в употреблении'
    expect(await translateBatch([ru], 'ru', { source: 'test' })).toEqual([`${PREFIX}${ru}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT report a provider failure — a same-language batch answers 200, not 503', async () => {
    const stats = { providerFailed: false }
    await translateBatch([VI], 'vi', { stats, source: 'test' })
    // This flag is the ONLY thing separating "the provider is down" from "this text
    // translates to itself" for a live caller. A skip must never trip it, or chat
    // translation would 503 on a message already in the reader's language.
    expect(stats.providerFailed).toBe(false)
  })

  it('still translates the strings that are NOT in the target, in the same batch', async () => {
    const out = await translateBatch([VI, EN], 'vi', { source: 'test' })
    expect(out[0]).toBe(VI) // skipped
    expect(out[1]).toBe(`${PREFIX}${EN}`) // translated
    // Exactly one provider call, carrying only the string that needed work.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')).q
    expect(sent).toEqual([EN])
  })
})

describe('translateBatch · the skip must not over-reach', () => {
  it('translates vi → ko (same source, different target)', async () => {
    const out = await translateBatch([VI], 'ko', { source: 'test' })
    expect(out).toEqual([`${PREFIX}${VI}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('translates plain-Latin source, because the detector cannot identify it', async () => {
    // detectContentLang returns null for Latin so it never mislabels French/Malay as
    // English. That means en-ish source is NOT skipped, even into 'en'.
    const out = await translateBatch([EN], 'en', { source: 'test' })
    expect(out).toEqual([`${PREFIX}${EN}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('translates Han → zh-Hans: the detector only knows "zh", and the text may be Traditional', async () => {
    const out = await translateBatch([ZH_HANT], 'zh-Hans', { source: 'test' })
    // Traditional → Simplified is real conversion work. Skipping it would ship
    // Traditional characters to a Simplified reader.
    expect(out).toEqual([`${PREFIX}${ZH_HANT}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('translateBatch · a positive detection must certify the WHOLE string', () => {
  // detectContentLang needs ONE diagnostic character to name a language. Reused naively as
  // "needs no translation", a single Vietnamese word in an English description would skip the
  // whole thing and serve a Vietnamese reader untranslated English — worse than paying.
  const MOSTLY_EN = [
    'Brand new sealed iPhone 15 Pro Max, worldwide shipping available, cảm ơn',
    'Professional camera kit for rent by the day or week, liên hệ ngay',
    'Free shipping nationwide for all orders over one million đồng',
  ]

  it.each(MOSTLY_EN)('translates mostly-English text carrying a Vietnamese fragment: %s', async (text) => {
    const out = await translateBatch([text], 'vi', { source: 'test' })
    expect(out).toEqual([`${PREFIX}${text}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still skips genuine Vietnamese prose that happens to contain a model name', async () => {
    // Real Vietnamese is densely diacriticked; an embedded 'iPhone 14 Pro' is a 3-word run,
    // nothing like the 8-10 word runs above.
    const text = 'Bán iPhone 14 Pro cũ, máy còn đẹp, pin 98%, đã qua sử dụng cẩn thận'
    expect(await translateBatch([text], 'vi', { source: 'test' })).toEqual([text])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not accept an English sentence with one Korean word as Korean', async () => {
    const text = 'Selling a used laptop in excellent condition 안녕'
    const out = await translateBatch([text], 'ko', { source: 'test' })
    expect(out).toEqual([`${PREFIX}${text}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never skips ja→ja at all, because Han is shared with Chinese', async () => {
    // Both of these report 'ja' from detectContentLang (it probes kana before Han), and no
    // surface test separates them: the Chinese string is 6.7% kana, the Japanese one 9%.
    // So Japanese keeps paying rather than risk serving Chinese to a Japanese reader.
    for (const text of ['中古の携帯電話、状態良好', '這是一個全新的手機，價格非常優惠 の']) {
      fetchMock.mockClear()
      expect(await translateBatch([text], 'ja', { source: 'test' })).toEqual([`${PREFIX}${text}`])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('does not accept UKRAINIAN or BULGARIAN as Russian', async () => {
    // Covered by dropping 'ru' from the skip entirely — a letter-veto would have caught
    // Ukrainian (і/ї/є/ґ) but never Bulgarian, which shares Russian's alphabet.
    for (const text of [
      'Продам вживаний телефон, стан дуже добрий, ціна договірна',
      'Продавам употребяван телефон в много добро състояние',
    ]) {
      fetchMock.mockClear()
      expect(await translateBatch([text], 'ru', { source: 'test' })).toEqual([`${PREFIX}${text}`])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })
})

describe('translateBatch · a cached translation beats the skip', () => {
  it('returns the cached value rather than the source for a same-language string', async () => {
    // An earlier pass may have produced something better than the input. The same-language
    // test runs AFTER the cache read precisely so that value is not thrown away.
    const { createHash } = await import('crypto')
    const h = createHash('sha1').update(VI).digest('hex')
    state.rows.push({ hash: h, target: 'vi', value: 'CACHED-BETTER' })

    const out = await translateBatch([VI], 'vi', { source: 'test' })
    expect(out).toEqual(['CACHED-BETTER'])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('translateBatch · skipWrite still holds', () => {
  it('translates private text but persists nothing', async () => {
    const out = await translateBatch([EN], 'vi', { skipWrite: true, source: 'chat' })
    expect(out).toEqual([`${PREFIX}${EN}`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The cache table has no owner column and is read by every page, so a written row is
    // effectively public and outlives the message.
    expect(state.upserts).toEqual([])
  })

  it('writes to the cache when skipWrite is absent', async () => {
    await translateBatch([EN], 'vi', { source: 'warm' })
    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0]?.target).toBe('vi')
  })
})

describe('uncachedStats · stays in lock-step with the paid work', () => {
  it('does not bill for a string translateBatch will skip', async () => {
    // Over-counting here would reject a batch that is in fact free.
    expect(await uncachedStats([VI], 'vi')).toEqual({ count: 0, chars: 0 })
  })

  it('still counts a string that genuinely needs translating', async () => {
    const { count, chars } = await uncachedStats([VI], 'ko')
    expect(count).toBe(1)
    expect(chars).toBe(VI.length)
  })
})
