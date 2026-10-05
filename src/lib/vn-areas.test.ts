import { afterEach, describe, expect, it, vi } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { VN_PROVINCES, __resetAreaCachesForTests, peekWard, provinceByCode, rememberWard, resolveWard } from './vn-areas'

type Unit = { code: string; name: string; nameEn: string; wards?: { code: string; name: string; nameEn: string }[] }
const UNITS = vnUnits as Unit[]

afterEach(() => {
  __resetAreaCachesForTests()
  vi.unstubAllGlobals()
})

describe('VN_PROVINCES is data/vn-units.json, not a copy that drifts', () => {
  it('holds exactly the dataset\'s provinces — code, Vietnamese name and English name — in both directions', () => {
    expect(VN_PROVINCES.map((p) => [p.code, p.name, p.nameEn])).toEqual(UNITS.map((u) => [u.code, u.name, u.nameEn]))
  })
})

describe('provinceByCode', () => {
  it('turns a URL code into the area the explorer holds', () => {
    expect(provinceByCode('79')).toEqual({ code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' })
  })

  it('answers null for anything that is not a known code', () => {
    for (const v of [null, undefined, '', '7', '999', 'Ho Chi Minh', '79;drop', ' 79']) expect(provinceByCode(v), String(v)).toBeNull()
  })
})

describe('wards', () => {
  const hcmc = UNITS.find((u) => u.code === '79')!
  const ward = hcmc.wards![0]

  it('resolves a ward code through /api/geo once per province, and remembers it for the document', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ wards: hcmc.wards }) }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    expect(peekWard('79', ward.code)).toBeNull()
    expect(await resolveWard('79', ward.code)).toEqual({ code: ward.code, name: ward.name, nameEn: ward.nameEn })
    expect(await resolveWard('79', hcmc.wards![1].code)).toMatchObject({ code: hcmc.wards![1].code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(peekWard('79', ward.code)).toMatchObject({ code: ward.code })
  })

  it('a ward the panel applied is known without any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    rememberWard('79', ward)
    expect(peekWard('79', ward.code)).toMatchObject({ name: ward.name })
    expect(await resolveWard('79', ward.code)).toMatchObject({ code: ward.code })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a non-OK answer (500/503) is a failure too: forgotten, so the next resolve asks again (codex, gate)', async () => {
    let status = 503
    const fetchMock = vi.fn(async () => (status === 200
      ? { ok: true, status, json: async () => ({ wards: hcmc.wards }) }
      : { ok: false, status, json: async () => ({}) }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveWard('79', ward.code)).toBeNull()
    status = 200
    expect(await resolveWard('79', ward.code)).toMatchObject({ code: ward.code })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('an unknown or malformed code resolves to null, and a failed request can be retried', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fail) throw new Error('offline')
      return { ok: true, json: async () => ({ wards: hcmc.wards }) } as unknown as Response
    }))
    expect(await resolveWard('79', ward.code)).toBeNull()
    fail = false
    expect(await resolveWard('79', ward.code)).toMatchObject({ code: ward.code })
    expect(await resolveWard('79', '99999999')).toBeNull()
    expect(await resolveWard('x', ward.code)).toBeNull()
  })
})
