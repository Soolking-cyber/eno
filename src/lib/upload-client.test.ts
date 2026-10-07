import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadInBatches } from './upload-client'

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
