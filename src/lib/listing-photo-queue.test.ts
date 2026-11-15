import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { enqueuePhotoChecks, pendingPhotoKey, PENDING_PHOTO_TTL_S } from './listing-photo-queue'

// The script side of the photo check's queue (listing-photo-queue.ts): the app's key and TTL, deduped, batched, and a
// failure that never fails the import (the cron's weekly full pass covers it).
const client = (fail = false) => {
  const calls: unknown[][] = []
  return { calls, $queryRaw: async (_q: TemplateStringsArray, ...v: unknown[]) => { if (fail) throw new Error('db down'); calls.push(v) } }
}

describe('enqueuePhotoChecks (scripts)', () => {
  it('queues each id once, under the app’s key and TTL, 1,000 per statement', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const c = client()
    const ids = [...Array.from({ length: 1500 }, (_, i) => `L${i}`), 'L0']
    expect(await enqueuePhotoChecks(c, ids)).toBe(1500)
    expect(c.calls).toHaveLength(2)
    expect(c.calls[0][0]).toBe(PENDING_PHOTO_TTL_S)
    expect((c.calls[0][1] as string[])[0]).toBe('listing-photo:pending:L0')
    expect((c.calls[1][1] as string[])).toHaveLength(500)
    expect(pendingPhotoKey('x')).toBe('listing-photo:pending:x')
  })
  it('nothing to queue is no statement; a failure is a warning, never a throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = client()
    expect(await enqueuePhotoChecks(c, [])).toBe(0)
    expect(c.calls).toEqual([])
    expect(await enqueuePhotoChecks(client(true), ['L1'])).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('weekly full pass'))
  })
})

// ⛔ O6: an importer queues its rows in a `finally` (only on --apply), so a throw out of its loop still queues the rows it
// already wrote. Saigon Moving queues each row as it is created, inside its loop.
describe('importers queue the photo check in a finally', () => {
  const dir = new URL('../../scripts/', import.meta.url)
  const PER_ROW = new Set(['import-saigonmoving.ts'])
  /** Whether the code at `at` sits inside a `finally { … }` block (a brace walk outwards). */
  const inFinally = (src: string, at: number) => {
    let depth = 0
    for (let i = at; i >= 0; i--) {
      if (src[i] === '}') depth++
      else if (src[i] === '{') {
        if (depth > 0) { depth--; continue }
        if (/finally\s*$/.test(src.slice(Math.max(0, i - 20), i))) return true
      }
    }
    return false
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !PER_ROW.has(f) && readFileSync(new URL(f, dir), 'utf8').includes('enqueuePhotoChecks(db'))
  it('finds the importers', () => expect(files.length).toBeGreaterThanOrEqual(12))
  it.each(files)('%s', (f) => {
    const src = readFileSync(new URL(f, dir), 'utf8')
    const calls = [...src.matchAll(/enqueuePhotoChecks\(db/g)].map((c) => c.index!)
    expect(calls.length).toBeGreaterThan(0)
    for (const at of calls) {
      const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at))
      expect(inFinally(src, at), line).toBe(true)
      expect(src.slice(0, at).endsWith('if (APPLY) await '), line).toBe(true)
    }
  })
})
