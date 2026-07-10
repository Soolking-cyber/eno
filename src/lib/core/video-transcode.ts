import 'server-only'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

// Self-hosted ffmpeg transcode of an uploaded listing clip → one lean, universally-playable
// H.264 MP4. Runs inside the Vercel function (ffmpeg-static binary; externalized + traced in
// next.config). Purpose:
//   • fix HEVC/.mov (decoded here, re-encoded H.264 → no more black video on Android buyers)
//   • compress a raw 20–50MB phone clip to a few MB (cuts Supabase egress — the real cost)
//   • faststart so it streams progressively; cap the long edge at 720 and the duration at 62s.
// The caller streams the raw object to a temp FILE (never the whole thing on the heap) and hands
// the path here. Never throws — returns null so the caller can fall open to the raw clip
// (H.264) or reject (HEVC).

const OUT_MAX_MS = 210_000 // hard wall well under the route's 300s maxDuration (leaves margin for download+upload)
// Cap width ≤720, force BOTH dimensions even (libx264+yuv420p require it; `-2` alone only fixes
// height, so an odd-width ≤720 source would otherwise fail the encode).
const SCALE = "scale='trunc(min(720,iw)/2)*2':-2"

let chmodDone = false
async function ensureExecutable(p: string): Promise<void> {
  if (chmodDone) return
  chmodDone = true
  // Tracing can drop the executable bit; restore it once (idempotent, best-effort).
  await chmod(p, 0o755).catch(() => {})
}

export async function transcodeToMp4(inputPath: string): Promise<Buffer | null> {
  if (!ffmpegPath) { console.error('[transcode] ffmpeg binary missing'); return null }
  await ensureExecutable(ffmpegPath)
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'xcode-'))
    const outPath = join(dir, 'out.mp4')

    const args = [
      '-nostdin', '-y',
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
      '-vf', SCALE,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '96k',
      '-t', '62', // duration ceiling (the client already gates ≤60s; belt + suspenders)
      outPath,
    ]

    const code = await new Promise<number>((resolve) => {
      const p = spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'ignore'] })
      const kill = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* ignore */ } }, OUT_MAX_MS)
      p.on('error', () => { clearTimeout(kill); resolve(-1) })
      p.on('close', (c) => { clearTimeout(kill); resolve(c ?? -1) })
    })
    if (code !== 0) { console.error('[transcode] ffmpeg exit', code); return null }

    const out = await readFile(outPath)
    // Sanity: a real MP4 (ISO-BMFF ftyp at offset 4) with non-trivial size.
    if (out.length < 1024 || out.subarray(4, 8).toString('latin1') !== 'ftyp') {
      console.error('[transcode] output not a valid mp4')
      return null
    }
    return out
  } catch (e) {
    console.error('[transcode]', e)
    return null
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
