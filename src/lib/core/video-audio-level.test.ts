import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('ffmpeg-static', () => ({ default: '/bin/false' }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
const { parseVolumedetect, SILENT_MEAN_DB } = await import('./video-audio-level')

// ffmpeg's own stderr shapes (volumedetect over a URL), as measured on the site's clips on 2026-10-17.
const withAudio = (mean: string) => [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://sb.eno.vn/storage/v1/object/public/listing-videos/x.mp4':",
  '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 720x1280',
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)',
  `[Parsed_volumedetect_0 @ 0x7f] mean_volume: ${mean} dB`,
  '[Parsed_volumedetect_0 @ 0x7f] max_volume: -0.5 dB',
].join('\n')

describe('parseVolumedetect — how loud a clip is', () => {
  it('the broken uploads: −91 dB, or −inf for exact zero — both at or below the silence line', () => {
    expect(parseVolumedetect(0, withAudio('-91.0'))).toEqual({ hasAudio: true, meanDb: -91 })
    expect(parseVolumedetect(0, withAudio('-inf'))).toEqual({ hasAudio: true, meanDb: -Infinity })
    expect(-91).toBeLessThanOrEqual(SILENT_MEAN_DB)
  })
  it('real speech (−10 to −35 dB on the site\'s good clips) is above it', () => {
    const r = parseVolumedetect(0, withAudio('-34.0'))
    expect(r).toEqual({ hasAudio: true, meanDb: -34 })
    expect(-34).toBeGreaterThan(SILENT_MEAN_DB)
  })
  it('a clip with no sound track at all is told apart from a silent one — whatever ffmpeg exits with', () => {
    const videoOnly = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://sb.eno.vn/x.mp4':\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 720x1280"
    // Measured: ffmpeg 8 exits 0 here (it maps the video instead); a build that refuses an output with no stream exits 1 —
    // either way the clip opened and had no sound track, so it is never "unchecked" forever (gate review, 2026-10-17).
    expect(parseVolumedetect(0, videoOnly)).toEqual({ hasAudio: false })
    expect(parseVolumedetect(1, `${videoOnly}\nOutput file #0 does not contain any stream`)).toEqual({ hasAudio: false })
  })
  it('⛔ only eno\'s own video storage, over https — never a file, another host or another bucket', async () => {
    const { isStorageVideoUrl } = await import('./video-audio-level')
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/listing-videos/1792228925408-wjgrm4.mp4')).toBe(true)
    expect(isStorageVideoUrl('file:///etc/passwd')).toBe(false)
    expect(isStorageVideoUrl('http://sb.eno.vn/storage/v1/object/public/listing-videos/a.mp4')).toBe(false)
    expect(isStorageVideoUrl('https://127.0.0.1:8000/storage/v1/object/public/listing-videos/a.mp4')).toBe(false)
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/teacher-videos/a.mp4')).toBe(false)
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/listing-videos/../x/a.mp4')).toBe(false)
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/listing-videos/a.m3u8?x=1')).toBe(false)
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/listing-videos/a.m3u8')).toBe(false)
    expect(isStorageVideoUrl('https://sb.eno.vn/storage/v1/object/public/listing-videos/.mp4')).toBe(false)
  })
  it('⛔ a read that failed before its streams were listed is "could not read" — never "no sound track"', () => {
    expect(parseVolumedetect(1, "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://sb.eno.vn/x.mp4':\nConnection reset by peer")).toBeNull()
  })
  it('⛔ never a guess: ffmpeg failing, or no level printed, is null', () => {
    expect(parseVolumedetect(1, withAudio('-20.0'))).toBeNull()
    expect(parseVolumedetect(0, '  Stream #0:1: Audio: aac, 48000 Hz')).toBeNull()
  })
})
