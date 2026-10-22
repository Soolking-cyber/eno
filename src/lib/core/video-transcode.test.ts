import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The server's encode, by kind (2026-10-18 — a teacher's intro video up to five minutes). A listing's clip keeps its
// arguments, plus a set 30 fps (WebKit's recordings otherwise encode as ONE frame — measured on the box); an intro video
// is cut at 330 s on four threads at nice 10 with a bitrate cap — and one the cut reached is refused ('too_long'), never
// kept short.
const h = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: string[] }>, encodeExit: 0, outSeconds: '00:04:59.90' as string | null }))
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    h.calls.push({ cmd, args })
    const p = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => true })
    const probe = !args.includes('-c:v')
    setTimeout(() => {
      if (probe) {
        if (h.outSeconds) p.stderr.emit('data', Buffer.from(`Input #0, mov,mp4, from 'out.mp4':\n  Duration: ${h.outSeconds}, start: 0.000000, bitrate: 900 kb/s\n`))
        p.emit('close', 1)
        return
      }
      // A real encode writes an MP4 (ftyp at offset 4, over 1 KB) to its last argument.
      if (h.encodeExit === 0) { const b = Buffer.alloc(2048); b.write('ftyp', 4, 'latin1'); writeFileSync(args[args.length - 1], b) }
      p.emit('close', h.encodeExit)
    }, 0)
    return p
  },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { transcodeArgs, transcodeToMp4, TRANSCODE_PLAN } = await import('./video-transcode')
const SCALE = "scale='trunc(min(720,iw)/2)*2':-2"

beforeEach(() => { h.calls = []; h.encodeExit = 0; h.outSeconds = '00:04:59.90' })

describe('transcodeArgs', () => {
  it('⛔ a listing\'s clip: the arguments it always had — plus the set frame rate', () => {
    expect(transcodeArgs('/in', '/out.mp4', 'listing')).toEqual([
      '-nostdin', '-y',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', // security review item 22
      '-i', '/in',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
      '-r', '30',
      '-vf', SCALE,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '96k',
      '-t', '62',
      '/out.mp4',
    ])
    expect(TRANSCODE_PLAN.listing).toEqual({ cutSeconds: 62, wallMs: 210_000 })
  })

  it('an intro video: cut at 330 s (half a minute of slack for a recording\'s stretch), four threads (filter, decoder, encoder), capped at 1.0 Mbit/s', () => {
    expect(transcodeArgs('/in', '/out.mp4', 'teacher_intro')).toEqual([
      '-nostdin', '-y',
      '-filter_threads', '4', '-threads', '4',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', // security review item 22
      '-i', '/in',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
      '-maxrate', '1000k', '-bufsize', '2000k', '-threads', '4',
      '-r', '30',
      '-vf', SCALE,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '96k',
      '-t', '330',
      '/out.mp4',
    ])
    expect(TRANSCODE_PLAN.teacher_intro).toEqual({ cutSeconds: 330, wallMs: 540_000 })
    // 1.0 Mbit/s of picture + 96 kbit/s of sound over the 330 s cut fits the 50 MB bucket with room to spare.
    expect(((1_000_000 + 96_000) * 330) / 8).toBeLessThan(0.9 * 50 * 1024 * 1024)
  })
})

describe('transcodeToMp4', () => {
  it('a listing\'s clip runs ffmpeg itself and is never probed', async () => {
    const out = await transcodeToMp4('/in', 'listing')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].cmd).toMatch(/ffmpeg$/)
    expect(h.calls[0].args).toContain('62')
  })

  it('an intro video runs under nice -n 10 (which execs ffmpeg — one pid for the wall to kill), then its length is read', async () => {
    const out = await transcodeToMp4('/in', 'teacher_intro')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(h.calls[0].cmd).toBe('nice')
    expect(h.calls[0].args.slice(0, 2)).toEqual(['-n', '10'])
    expect(h.calls[0].args[2]).toMatch(/ffmpeg$/)
    // the length probe reads the same untrusted input, so it carries the same input guard (item 22)
    expect(h.calls[1].args.slice(0, 7)).toEqual(['-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-i'])
  })

  it('⛔ an intro video the cut reached is refused — too_long — and one short of it is kept (a stretched 4:59 recording too)', async () => {
    h.outSeconds = '00:05:30.01'
    expect(await transcodeToMp4('/in', 'teacher_intro')).toBe('too_long')
    h.outSeconds = '00:05:29.60'
    expect(await transcodeToMp4('/in', 'teacher_intro')).toBe('too_long')
    for (const ok of ['00:05:29.40', '00:05:02.00', '00:05:00.95', '00:00:42.10']) {
      h.outSeconds = ok
      expect(Buffer.isBuffer(await transcodeToMp4('/in', 'teacher_intro'))).toBe(true)
    }
  })

  it('⛔ an intro video whose output length ffmpeg cannot read back is a FAILED encode (null) — never a pass; a failed encode is null', async () => {
    h.outSeconds = null
    expect(await transcodeToMp4('/in', 'teacher_intro')).toBeNull()
    h.outSeconds = '00:04:59.90'
    h.encodeExit = 1
    expect(await transcodeToMp4('/in', 'teacher_intro')).toBeNull()
    expect(await transcodeToMp4('/in', 'listing')).toBeNull()
  })

})
