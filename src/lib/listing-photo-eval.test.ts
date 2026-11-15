import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PHOTO_MODELS, type PhotoFacts, type PhotoRead } from '@/lib/listing-photo-check'
import { gate, loadPhotos, type Photo } from '../../scripts/listing-photo-eval'

// scripts/listing-photo-eval.ts, the eval gate before the photo check is wired: it refuses to score a set it cannot
// measure (no photo, a labelled photo missing), and the two models agreeing — the pass's own decision — is part of the bar.

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'photo-eval-'))
  mkdirSync(join(dir, 'img'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })

const facts = (o: Partial<PhotoFacts> = {}): PhotoFacts => ({ kind: 'camera_photo', advertises: false, overlayText: 'none', contact: [], websites: [], ...o })
const FLYER = facts({ kind: 'designed_graphic', advertises: true })
const [A, B] = PHOTO_MODELS
const read = (model: string, f: PhotoFacts): PhotoRead => ({ model, facts: f })

describe('listing-photo-eval', () => {
  it('⛔ C3: no photo loaded is refused, not a pass', () => {
    writeFileSync(join(dir, 'labels.json'), '{}')
    expect(() => loadPhotos(dir)).toThrow(/no photos loaded/)
  })

  it('⛔ C3: a labelled photo with no image behind it is refused', () => {
    writeFileSync(join(dir, 'labels.json'), JSON.stringify({ L1: { 0: 'F', 1: 'C' } }))
    writeFileSync(join(dir, 'img', '001_L1_0.jpg'), '')
    expect(() => loadPhotos(dir)).toThrow(/L1 #1/)
    writeFileSync(join(dir, 'img', '002_L1_1.jpg'), '')
    expect(loadPhotos(dir).map((p) => p.label)).toEqual(['F', 'C'])
  })

  it('⛔ C4: each model missing two different flyers passes alone, but the two agreeing miss four — the gate fails', () => {
    const photos: Photo[] = Array.from({ length: 6 }, (_, i) => ({ file: `${i}.jpg`, listingId: 'L', index: i, label: 'F', flyerRule: true }))
    // A misses 0 and 1, B misses 2 and 3: a refusal stands only where both refuse (4 and 5).
    const reads = photos.map((_, i) => [read(A, i < 2 ? facts() : FLYER), read(B, i === 2 || i === 3 ? facts() : FLYER)])
    expect(gate(photos, reads)).toBe(false)
    // Both refusing every flyer passes.
    expect(gate(photos, photos.map(() => [read(A, FLYER), read(B, FLYER)]))).toBe(true)
  })
})
