import 'server-only'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { logError } from '@/lib/log'
import { VIDEO_CUT_SECONDS, type VideoUploadKind } from '@/lib/video-length'

// Self-hosted ffmpeg transcode of an uploaded listing clip → one lean, universally-playable
// H.264 MP4. Runs inside the Vercel function (ffmpeg-static binary; externalized + traced in
// next.config). Purpose:
//   • fix HEVC/.mov (decoded here, re-encoded H.264 → no more black video on Android buyers)
//   • compress a raw 20–50MB phone clip to a few MB (cuts Supabase egress — the real cost)
//   • faststart so it streams progressively; cap the width at 720 and the duration at the kind's (TRANSCODE_PLAN).
// The caller streams the raw object to a temp FILE (never the whole thing on the heap) and hands
// the path here. Never throws — returns null so the caller can fall open to the raw clip
// (H.264) or reject (HEVC), or 'too_long' for an intro video longer than its five minutes.

/**
 * WHAT EACH KIND OF CLIP GETS (src/lib/video-length.ts). A listing's clip: the arguments it always had (plus the frame
 * rate below) — cut at 62 s, killed at 210 s. A teacher's intro video (up to five minutes since 2026-10-18 — the owner:
 * "make it 5 but the size limit stays the same"):
 *   · cut at 330 s, half a minute past the five — a compressed clip's recording runs a little longer than its source (a
 *     stall stretches its timeline; gate review, 2026-10-18), and a 4:59 clip must never come back "too long" after the
 *     wait — and one the cut REACHED is refused, 'too_long', never published shortened (only a clip whose length the
 *     browser could not read gets that far): the four intro videos that went up before the form read the length were cut
 *     to exactly 62.0 s and nobody was told;
 *   · killed at 540 s. Measured on the box (12 vCPU Broadwell, 2.2 GHz), 2026-10-18: 30 s of a 1080x1920 portrait clip
 *     took 6.9 s, so five minutes ≈ 70 s — ~140 s on the four threads it gets here;
 *   · four threads, at nice 10 — five minutes of encode must not take the cores the pages are served from. ⛔ No slot queue
 *     (gate rounds 2–5 grew one and found a new edge in it every round — a "busy" that stuck to the upload for two hours, a
 *     wait shorter than one job, slots one account could hold): it throttled only honest teachers, since a caller who wants
 *     the CPU names 'listing', which has always run at once, on every core, at full priority. Each intro encode is bounded
 *     by the route's strict 30/h per account, its wall, and nice;
 *   · at most 1.0 Mbit/s of picture (capped CRF), so the 330 s cut stays ≤ ~45 MB, under the 50 MB bucket limit: the live
 *     intro videos ran 0.2–1.2 Mbit/s with their sound at this CRF (18 measured), and a portrait clip is the dear one.
 */
export const TRANSCODE_PLAN = {
  listing: { cutSeconds: VIDEO_CUT_SECONDS.listing, wallMs: 210_000 },
  teacher_intro: { cutSeconds: VIDEO_CUT_SECONDS.teacher_intro, wallMs: 540_000 },
} as const satisfies Record<VideoUploadKind, { cutSeconds: number; wallMs: number }>

/** An output this long was REACHED by the cut (TRANSCODE_PLAN) — its source ran on past it. */
const cutReached = (kind: VideoUploadKind, seconds: number) => seconds > TRANSCODE_PLAN[kind].cutSeconds - 0.5

// Cap width ≤720, force BOTH dimensions even (libx264+yuv420p require it; `-2` alone only fixes
// height, so an odd-width ≤720 source would otherwise fail the encode).
const SCALE = "scale='trunc(min(720,iw)/2)*2':-2"

let chmodDone = false
async function ensureExecutable(p: string): Promise<void> {
  if (chmodDone) return
  chmodDone = true
  // Tracing can drop the executable bit; restore it once (idempotent, best-effort).
  await chmod(p, 0o755).catch((e) => logError(e, { op: 'video-transcode.chmod' }))
}

/**
 * ⛔ UNTRUSTED INPUT IS READ AS A LOCAL VIDEO CONTAINER ONLY (security review 2026-10-22, item 22). The bytes are an upload;
 * a file that is secretly a playlist (HLS .m3u8, concat) could otherwise point ffmpeg at other files or the network. Same
 * allow-lists as video-audio-level.ts: the `file` protocol only, and only the containers we store. Input options, so they
 * go BEFORE `-i`. (Modern ffmpeg does not detect HLS on an extensionless input and concat defaults to safe=1 — this makes
 * that a guarantee rather than a default.)
 */
export const FFMPEG_INPUT_GUARD = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm'] as const

/** The ffmpeg arguments for one kind — exported for the tests that pin a listing's to what it always was. */
export function transcodeArgs(inputPath: string, outPath: string, kind: VideoUploadKind): string[] {
  const long = kind === 'teacher_intro'
  return [
    '-nostdin', '-y',
    ...(long ? ['-filter_threads', '4', '-threads', '4'] : []), // the scale filter's and the decoder's
    ...FFMPEG_INPUT_GUARD, // item 22 — before -i: they are input options
    '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
    ...(long ? ['-maxrate', '1000k', '-bufsize', '2000k', '-threads', '4'] : []), // the encoder's
    // ⛔ A SET OUTPUT RATE, both kinds (2026-10-18). WebKit's recorder ends an MP4 with a NEGATIVE sample duration written
    // unsigned (≈ 2^32), so ffmpeg reads the clip's average rate as 0.0002 fps — and an MP4's constant-rate output then holds
    // ONE frame: measured with the box's own ffmpeg (7.0.2) on a WebKit 26.5 recording of 60 s — 1 frame, "Duration:
    // 01:07:42". At 30 fps the same file keeps all 1,801 frames and its 60.03 s; a normal phone clip is unchanged (1,803 /
    // 60.1 s), and a variable-rate, a 60 fps and a 24 fps source keep their length (20.01 s → 20.01 / 20.07 / 20.01 s,
    // measured) — a 60 fps one becomes 30, and Chrome's recordings stop being doubled to 60.
    '-r', '30',
    '-vf', SCALE,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k',
    '-t', String(TRANSCODE_PLAN[kind].cutSeconds), // duration ceiling (the client already gates its kind's length; belt + suspenders)
    outPath,
  ]
}

/**
 * A media file's length in seconds, from ffmpeg's own reading of its header (`Duration:` — ffmpeg -i with no output exits 1
 * after printing it); null when it gives none. ⚠️ Read only on THIS encode's output (a set 30 fps, so a sane length): a
 * WebKit recording's own header reads 7,158,338 s for 60 s (see the frame rate below).
 */
async function mediaSeconds(path: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let err = ''
    const p = spawn(ffmpegPath!, ['-hide_banner', '-nostdin', ...FFMPEG_INPUT_GUARD, '-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    const kill = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* ignore */ } }, 15_000)
    p.stderr?.on('data', (d: Buffer) => { if (err.length < 65_536) err += d.toString('latin1') })
    p.on('error', () => { clearTimeout(kill); resolve(null) })
    p.on('close', () => {
      clearTimeout(kill)
      const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

export async function transcodeToMp4(inputPath: string, kind: VideoUploadKind = 'listing'): Promise<Buffer | 'too_long' | null> {
  if (!ffmpegPath) { console.error('[transcode] ffmpeg binary missing'); return null }
  await ensureExecutable(ffmpegPath)
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'xcode-'))
    const outPath = join(dir, 'out.mp4')
    const args = transcodeArgs(inputPath, outPath, kind)

    const code = await new Promise<number>((resolve) => {
      // An intro video's encode runs under `nice -n 10` (coreutils, in node:24-slim — measured in eno-vn-app as uid 1001,
      // 2026-10-18), which EXECS ffmpeg: the same pid, so the wall's SIGKILL still reaches it. Not os.setPriority on the
      // child: on Linux a nice value is per THREAD, and ffmpeg's workers would race it (plan review, 2026-10-18).
      const p = kind === 'teacher_intro'
        ? spawn('nice', ['-n', '10', ffmpegPath!, ...args], { stdio: ['ignore', 'ignore', 'ignore'] })
        : spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'ignore'] })
      const kill = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* ignore */ } }, TRANSCODE_PLAN[kind].wallMs)
      p.on('error', () => { clearTimeout(kill); resolve(-1) })
      p.on('close', (c) => { clearTimeout(kill); resolve(c ?? -1) })
    })
    if (code !== 0) { console.error('[transcode] ffmpeg exit', code); return null }

    // An intro video the cut reached ran on past it: refused, never kept short (TRANSCODE_PLAN). An output whose length ffmpeg
    // cannot read back is a failed encode (null), never a pass (gate review, 2026-10-18).
    if (kind === 'teacher_intro') {
      const seconds = await mediaSeconds(outPath)
      if (seconds === null) { console.error('[transcode] output length unreadable'); return null }
      if (cutReached(kind, seconds)) return 'too_long'
    }

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
    if (dir) await rm(dir, { recursive: true, force: true }).catch((e) => logError(e, { op: 'video-transcode.rm' }))
  }
}
