import 'server-only'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegPath from 'ffmpeg-static'
import { logError } from '@/lib/log'
import { VIDEO_CUT_SECONDS } from '@/lib/video-length'

/**
 * HOW LOUD A CLIP'S SOUND IS — ffmpeg's volumedetect over the whole clip (a listing video is ≤ 60 s, a teacher's intro video
 * ≤ 5 minutes since 2026-10-18 — read to 330 s, its transcode's cut, so a long intro is never judged on its first minute
 * alone: 0.6 s for five minutes of sound, measured), by URL.
 * Built 2026-10-17 for /api/cron/video-reupload-ask: until db7eac156 every clip the browser compressed went up with an
 * AAC track of DIGITAL SILENCE (−91 dB measured, or −inf for exact zero), and only a measurement tells such a clip from one
 * that has sound (−10 to −35 dB for speech, measured on the site's 51 good clips).
 * ⛔ ONLY eno's OWN VIDEO STORAGE, OVER HTTPS (gate review, 2026-10-17): the URL comes from a listing row. Anything else is
 * null.
 * ⛔ NODE FETCHES IT, ffmpeg READS A LOCAL FILE — never a URL: the box's ffmpeg-static (7.0.2, johnvansickle's fully static
 * build) SEGFAULTS on any hostname lookup inside the container (static glibc has no working DNS; measured 2026-10-17, the
 * first dry run came back unchecked: 4). The transcode route already works this way (src/app/api/upload/video/transcode).
 * `null` — the clip could not be read (not ours, gone, too big, ffmpeg failed or timed out): never a guess.
 */
export type ClipAudioLevel = { hasAudio: false } | { hasAudio: true; meanDb: number }

/** At or below this mean the track is silence: the broken uploads measured −91 dB / −inf, the quietest real speech −35 dB. */
export const SILENT_MEAN_DB = -80

/** The download and ffmpeg get 30 s each — a clip's whole measurement stays within a minute (gate review, 2026-10-17). */
const TIMEOUT_MS = 30_000
/** A stored listing video is ≤ 50 MB (the upload ceiling); anything bigger is not one of ours — stop reading it. */
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
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
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'alevel-'))
    const inPath = join(dir, 'in')
    // ⛔ redirect: 'error' — the storage check covers the URL asked for; a 30x could send Node anywhere (an internal host,
    // a metadata address). eno's public storage never redirects, so a redirect is refused outright (gate review).
    const res = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok || !res.body) return null
    let seen = 0
    const cap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        seen += chunk.length
        done(seen > MAX_DOWNLOAD_BYTES ? new Error('too_big') : null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), cap, createWriteStream(inPath))
    if ((await stat(inPath)).size === 0) return null
    // A local file only, and only the video containers we store — a file that is secretly a playlist (HLS, concat) is
    // refused as a format, so nothing in it can send ffmpeg anywhere (gate review, 2026-10-17).
    const args = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-t', String(VIDEO_CUT_SECONDS.teacher_intro), '-i', inPath, '-map', '0:a:0?', '-af', 'volumedetect', '-f', 'null', '-']
    const out = await new Promise<{ code: number; stderr: string }>((resolve) => {
      let stderr = ''
      const p = spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      p.stderr?.on('data', (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString('utf8') })
      const kill = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* gone */ } }, TIMEOUT_MS)
      p.on('error', () => { clearTimeout(kill); resolve({ code: -1, stderr }) })
      p.on('close', (c) => { clearTimeout(kill); resolve({ code: c ?? -1, stderr }) })
    })
    return parseVolumedetect(out.code, out.stderr)
  } catch (e) {
    logError(e, { op: 'video-audio-level.read' })
    return null
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch((e) => logError(e, { op: 'video-audio-level.rm' }))
  }
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
