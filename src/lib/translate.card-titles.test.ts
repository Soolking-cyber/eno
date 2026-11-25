import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A CARD TITLE NOT WRITTEN IN ENGLISH REACHES THE ENGLISH PAGE'S HTML IN ENGLISH (Seobility, 2026-11-25: "4 text
 * blocks invisible to AI bots"). localizeListingTitles embedded every language but `en`, on the rule "the source title
 * covers English" — so a seller's "Căn Hộ 1 Phòng Ngủ Ngay Landmark 81" was served in Vietnamese and turned English only in
 * the browser (listing-content.tsx useMachineEn), and a crawler that runs no script read Vietnamese. The English is
 * embedded from the cache (no engine call) exactly when the card would show it (listing-content.tsx localizedPlan).
 */

type Row = { hash: string; target: string; value: string }
const state = { rows: [] as Row[], reads: 0 }
const sha1 = (t: string) => crypto.createHash('sha1').update(t).digest('hex')

vi.mock('./db', () => ({
  db: {
    translation: {
      findMany: async (args: { where?: { hash?: { in?: string[] }; target?: { in?: string[] } } }) => {
        state.reads++
        const hashes = args?.where?.hash?.in ?? []
        const targets = args?.where?.target?.in
        return state.rows.filter((r) => hashes.includes(r.hash) && (!targets || targets.includes(r.target)))
      },
    },
  },
}))
vi.mock('./i18n/gemini-translate', () => ({ geminiTranslate: vi.fn(async () => null), geminiTranslateConfigured: () => false }))
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no engine call from an embed') }))

const { localizeListingTitles } = await import('./translate')

const VI_TITLE = 'Căn Hộ 1 Phòng Ngủ Ngay Landmark 81'
const EN_OF_VI = '1-Bedroom Apartment Right at Landmark 81'
// The English slot of a bilingual row: a ward's letter, a different titleVi beside it (listing-content.tsx).
const SLOT = '1-bedroom apartment, 55 m² · Nassim Thảo Điền, District 2'
const EN_TITLE = 'Sofa for sale'

beforeEach(() => {
  state.reads = 0
  state.rows = [
    { hash: sha1(VI_TITLE), target: 'en', value: EN_OF_VI },
    { hash: sha1(VI_TITLE), target: 'ko', value: '랜드마크 81 원룸' },
    { hash: sha1(VI_TITLE), target: 'vi', value: VI_TITLE },
    { hash: sha1(SLOT), target: 'en', value: 'an English→English row from before' },
    { hash: sha1(SLOT), target: 'ko', value: '방 1개 아파트' },
    { hash: sha1(EN_TITLE), target: 'en', value: EN_TITLE },
  ]
})

const cards = () => [
  { id: 'a', title: VI_TITLE, titleVi: null },
  { id: 'b', title: SLOT, titleVi: 'Căn hộ 1 phòng ngủ 55 m² · Nassim Thảo Điền, Quận 2' },
  { id: 'c', title: EN_TITLE, titleVi: 'Bán sofa' },
]

describe('localizeListingTitles embeds English for a title not written in English', () => {
  it('a page render (/en ISR): only en, for the Vietnamese title — no machine-translated language (owner 2026-11-25), never vi', async () => {
    const [a, b, c] = await localizeListingTitles(cards())
    expect(a.titleI18n).toEqual({ en: EN_OF_VI })
    expect(b.titleI18n).toBeUndefined()
    expect(c.titleI18n).toBeUndefined()
  })

  it('an API answer for one machine-translated reader (onlyLang ko): that language, for every title', async () => {
    const [a, b] = await localizeListingTitles(cards(), 'ko')
    expect(a.titleI18n).toEqual({ ko: '랜드마크 81 원룸' })
    expect(b.titleI18n).toEqual({ ko: '방 1개 아파트' })
  })

  it('onlyLang en (a feed for an English reader): just the en of the Vietnamese title, one read', async () => {
    const [a, b, c] = await localizeListingTitles(cards(), 'en')
    expect(a.titleI18n).toEqual({ en: EN_OF_VI })
    expect(b.titleI18n).toBeUndefined()
    expect(c.titleI18n).toBeUndefined()
    expect(state.reads).toBe(1)
  })

  it('onlyLang en with no title that needs it, and onlyLang vi: no read at all', async () => {
    expect(await localizeListingTitles([cards()[2]], 'en')).toEqual([cards()[2]])
    expect(await localizeListingTitles(cards(), 'vi')).toEqual(cards())
    expect(state.reads).toBe(0)
  })

  it('a Vietnamese title whose titleVi is the same text still gets its English', async () => {
    const [a] = await localizeListingTitles([{ id: 'a', title: VI_TITLE, titleVi: VI_TITLE }], 'en')
    expect(a.titleI18n).toEqual({ en: EN_OF_VI })
  })
})
