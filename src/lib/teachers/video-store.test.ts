import { describe, expect, it, vi } from 'vitest'

// The keys video-store mints (2026-10-07). A public key must have the shape every stored listing video is checked
// against (media.ts VIDEO_PATH_RE via isCanonicalVideoUrl) — or the next save IGNORES the stored URL and drops the video.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/core/video-owner', () => ({ recordVideoOwner: async () => {}, videoOwner: async () => null }))
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({}), LISTING_VIDEOS_BUCKET: 'listing-videos', TEACHER_VIDEOS_BUCKET: 'teacher-videos' }))

const { publicVideoKeyFor, privateVideoPathFor } = await import('./video-store')
const { VIDEO_PATH_RE } = await import('@/lib/core/media')

describe('minted video keys', () => {
  it('every public key matches VIDEO_PATH_RE — thousands of draws, every extension', () => {
    for (const src of ['p1/a.mp4', 'p1/b.webm', 'p1/c.mov', 'p1/d.MOV', 'p1/no-ext']) {
      for (let i = 0; i < 2000; i++) expect(publicVideoKeyFor(src)).toMatch(VIDEO_PATH_RE)
    }
  })
  it('a private path is the owner\'s folder, a fresh uuid, and the source extension', () => {
    expect(privateVideoPathFor('p1', '1700000000000-abcd12.webm')).toMatch(/^p1\/[0-9a-f-]{36}\.webm$/)
  })
})
