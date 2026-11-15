import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoRefusedError, parsePhotoRefusalDetail, uploadInBatches } from './upload-client'

/** Batches of three; `onBatch` hears each one the moment it lands — before a later batch can fail. */

afterEach(() => { vi.unstubAllGlobals() })

const file = (n: number) => new File([String(n)], `p${n}.jpg`, { type: 'image/jpeg' })

describe('uploadInBatches', () => {
  it('reports each batch as it lands, in order, with its files and their URLs', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return { ok: true, status: 200, json: async () => ({ urls: call === 1 ? ['u1', 'u2', 'u3'] : ['u4'] }) }
    }))
    const files = [1, 2, 3, 4].map(file)
    const seen: [string[], string[]][] = []
    const urls = await uploadInBatches(files, (fs, us) => { seen.push([fs.map((f) => f.name), us]) })
    expect(urls).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(seen).toEqual([[['p1.jpg', 'p2.jpg', 'p3.jpg'], ['u1', 'u2', 'u3']], [['p4.jpg'], ['u4']]])
  })

  it('a later batch failing still leaves the earlier one reported — that is what a retry keeps', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return call === 1 ? { ok: true, status: 200, json: async () => ({ urls: ['u1', 'u2', 'u3'] }) } : { ok: false, status: 500, json: async () => ({}) }
    }))
    const seen: string[][] = []
    await expect(uploadInBatches([1, 2, 3, 4].map(file), (_fs, us) => { seen.push(us) })).rejects.toThrow('upload')
    expect(seen).toEqual([['u1', 'u2', 'u3']])
  })
})

/** The listing photo check (check=listing): per-file results, every batch sent, the refused thrown last. */
describe('uploadInBatches — check', () => {
  const answer = (results: unknown[], reasons: string[] = []) => ({ ok: true, status: 200, json: async () => ({ urls: [], results, reasons }) })

  it('sends check=listing and the category with every batch', async () => {
    const forms: FormData[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const form = init!.body as FormData
      forms.push(form)
      return answer(form.getAll('files').map((f) => ({ url: `https://cdn/${(f as File).name}` })))
    }))
    expect(await uploadInBatches([1, 2, 3, 4].map(file), undefined, { check: { category: 'jobs' } })).toHaveLength(4)
    expect(forms.map((f) => [f.get('check'), f.get('category')])).toEqual([['listing', 'jobs'], ['listing', 'jobs']])
    expect(forms[0].has('seller')).toBe(false)
    forms.length = 0
    await uploadInBatches([file(1)], undefined, { check: { category: 'services', subcategory: 'esim', seller: 's1' } })
    expect([forms[0].get('subcategory'), forms[0].get('seller')]).toEqual(['esim', 's1'])
  })

  it('⛔ refused photos: onBatch hears only the accepted, every batch is sent, then PhotoRefusedError keyed by File', async () => {
    const files = [1, 2, 3, 4].map(file)
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return call === 1
        ? answer([{ url: 'u1' }, { reason: 'photo_flyer' }, { url: 'u3' }], ['photo_flyer'])
        : answer([{ reason: 'photo_contact' }], ['photo_contact'])
    }))
    const seen: [string[], string[]][] = []
    const err = await uploadInBatches(files, (fs, us) => { seen.push([fs.map((f) => f.name), us]) }, { check: { category: 'rentals' } }).catch((e) => e)
    expect(err).toBeInstanceOf(PhotoRefusedError)
    expect(err.message).toBe('upload_photo_refused')
    expect([...err.refused]).toEqual([[files[1], 'flyer'], [files[3], 'contact']])
    expect(call).toBe(2)
    expect(seen).toEqual([[['p1.jpg', 'p3.jpg'], ['u1', 'u3']]])
  })

  it('a type, size or broken file keeps precedence (and the accepted beside it are still reported)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer([{ url: 'u1' }, { reason: 'photo_flyer' }, { reason: 'type' }], ['photo_flyer', 'type'])))
    const seen: string[][] = []
    await expect(uploadInBatches([1, 2, 3].map(file), (_f, us) => { seen.push(us) }, { check: { category: 'rentals' } })).rejects.toThrow('upload_type')
    expect(seen).toEqual([['u1']])
  })

  it('an answer without per-file results (an older server) falls back to the short-list rule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ urls: ['u1'], reasons: ['decode'] }) })))
    await expect(uploadInBatches([1, 2].map(file), undefined, { check: { category: 'rentals' } })).rejects.toThrow('upload_broken')
  })
})

describe('parsePhotoRefusalDetail', () => {
  it("reads the save's '<rule>:<url>' list and drops anything else", () => {
    const m = parsePhotoRefusalDetail('flyer:https://sb/x/a.webp contact:https://sb/x/b.webp junk other:https://c')
    expect([...m]).toEqual([['https://sb/x/a.webp', 'flyer'], ['https://sb/x/b.webp', 'contact']])
    expect(parsePhotoRefusalDetail(undefined).size).toBe(0)
  })
})
