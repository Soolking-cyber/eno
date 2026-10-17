import 'server-only'
import { spawn } from 'node:child_process'
import { chmod } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import { logError } from '@/lib/log'

/**
 * HOW LOUD A CLIP'S SOUND IS — ffmpeg's volumedetect over the whole clip (a listing video is ≤ 60 s; capped at 62), by URL.
 * Built 2026-10-17 for /api/cron/video-reupload-ask: until db7eac156 every clip the browser compressed went up with an
 * AAC track of DIGITAL SILENCE (−91 dB measured, or −inf for exact zero), and only a measurement tells such a clip from one
 * that has sound (−10 to −35 dB for speech, measured on the site's 51 good clips).
 * ⛔ ONLY eno's OWN VIDEO STORAGE, OVER HTTPS (gate review, 2026-10-17): the URL comes from a listing row, and ffmpeg will
 * open anything it is handed — file:, concat:, an internal host, an HLS playlist pointing at one. Anything else is null.
 * `null` — the clip could not be read (not ours, gone, ffmpeg failed or timed out): never a guess.
 */
export type ClipAudioLevel = { hasAudio: false } | { hasAudio: true; meanDb: number }

/** At or below this mean the track is silence: the broken uploads measured −91 dB / −inf, the quietest real speech −35 dB. */
export const SILENT_MEAN_DB = -80

const TIMEOUT_MS = 60_000
let chmodDone = false

/**
 * The public listing-video bucket, and nothing else: https on eno's storage host, this bucket's path, a plain file name
 * ending in a video container — never a playlist (.m3u8), whose entries could send ffmpeg to any host (gate review).
 */
const STORAGE_VIDEO_URL = /^https:\/\/sb\.eno\.vn\/storage\/v1\/object\/public\/listing-videos\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(mp4|mov|m4v|webm)$/

export function isStorageVideoUrl(url: string): boolean {
  return STORAGE_VIDEO_URL.test(url)
}

export async function clipAudioLevel(url: string): Promise<ClipAudioLevel | null> {
  if (!isStorageVideoUrl(url)) return null
  if (!ffmpegPath) { console.error('[video-audio-level] ffmpeg binary missing'); return null }
  if (!chmodDone) {
    // Tracing can drop the executable bit; restore it (as video-transcode.ts does) — and only a chmod that worked counts as
    // done, so one transient failure does not leave every later run of this process unable to start ffmpeg (gate review).
    await chmod(ffmpegPath, 0o755).then(() => { chmodDone = true }, (e) => logError(e, { op: 'video-audio-level.chmod' }))
  }
  // And at the ffmpeg level: https only, and only the video containers we store — a file that is secretly a playlist (HLS,
  // concat) is refused as a format, so its entries can never send ffmpeg to another host (gate review, 2026-10-17).
  const args = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'https,tls,tcp', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-t', '62', '-i', url, '-map', '0:a:0?', '-af', 'volumedetect', '-f', 'null', '-']
  const out = await new Promise<{ code: number; stderr: string }>((resolve) => {
    let stderr = ''
    const p = spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    p.stderr?.on('data', (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString('utf8') })
    const kill = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* gone */ } }, TIMEOUT_MS)
    p.on('error', () => { clearTimeout(kill); resolve({ code: -1, stderr }) })
    p.on('close', (c) => { clearTimeout(kill); resolve({ code: c ?? -1, stderr }) })
  })
  return parseVolumedetect(out.code, out.stderr)
}

/**
 * The parse, apart for tests. A clip that OPENED with no audio stream is `hasAudio: false` whatever the exit code — with no
 * stream to map, ffmpeg exits non-zero ("does not contain any stream"), so reading the code first would leave such a clip
 * "unchecked" forever (gate review, 2026-10-17). A mean of "-inf" is digital zero.
 */
export function parseVolumedetect(code: number, stderr: string): ClipAudioLevel | null {
  // Opened AND its streams listed — a read that failed before the listing is "could not read", never "no sound track".
  const listed = /Input #0,/.test(stderr) && /Stream #0:\d+[^\n]*: Video:/.test(stderr)
  const hasAudio = /Stream #0:\d+[^\n]*: Audio:/.test(stderr)
  if (listed && !hasAudio) return { hasAudio: false }
  if (code !== 0 || !hasAudio) return null
  const m = stderr.match(/mean_volume:\s*(-?inf|-?[\d.]+)\s*dB/)
  if (!m) return null
  return { hasAudio: true, meanDb: m[1].endsWith('inf') ? -Infinity : Number(m[1]) }
}
