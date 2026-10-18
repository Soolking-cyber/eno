import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VIDEO_CUT_SECONDS, VIDEO_MAX_SECONDS, isVideoUploadKind } from './video-length'
import { TRANSCODE_WAIT_MS } from './video-upload-client'
import { TRANSCODE_PLAN } from './core/video-transcode'

// ⛔ A teacher's intro video is up to FIVE minutes, a listing's clip ONE (owner, 2026-10-18: "the teacher profile video is at
// 1 minute now make it 5 but the size limit stays the same"). The copy says the number in words, so it is pinned here
// against the constant — and every timer down the chain is pinned against the next.
const read = (p: string) => readFileSync(join(__dirname, p), 'utf8')

describe('video lengths', () => {
  it('a listing keeps a minute, a teacher intro video five; anything else is not a kind', () => {
    expect(VIDEO_MAX_SECONDS).toEqual({ listing: 60, teacher_intro: 300 })
    expect(isVideoUploadKind('teacher_intro')).toBe(true)
    expect(isVideoUploadKind('listing')).toBe(true)
    for (const v of ['teacher', 'TEACHER_INTRO', '', null, undefined, 300, {}]) expect(isVideoUploadKind(v)).toBe(false)
  })

  it('the transcode cuts past each limit: a listing\'s by 2 s (the browser allows 1, for rounding), an intro video\'s by 30 s', () => {
    // An intro video is refused when the cut reaches it, and a compressed recording runs a little past its source (a stall
    // stretches it): half a minute keeps a 4:59 clip from ever coming back "too long" (gate review, 2026-10-18).
    expect(VIDEO_CUT_SECONDS).toEqual({ listing: VIDEO_MAX_SECONDS.listing + 2, teacher_intro: VIDEO_MAX_SECONDS.teacher_intro + 30 })
    expect(TRANSCODE_PLAN.listing.cutSeconds).toBe(VIDEO_CUT_SECONDS.listing)
    expect(TRANSCODE_PLAN.teacher_intro.cutSeconds).toBe(VIDEO_CUT_SECONDS.teacher_intro)
  })

  it('⛔ the client waits past the server\'s lease, and the lease outlives the encode by its download/upload margin', () => {
    // The route's lease is wall + 150 s (transcode/route.ts claimTtlS): a poll must never meet a 404 while the job could still
    // finish, and the client must not give up while the server is still allowed to (plan review, 2026-10-18).
    for (const kind of ['listing', 'teacher_intro'] as const) {
      expect(TRANSCODE_PLAN[kind].wallMs / 1000 + 120).toBeLessThanOrEqual(TRANSCODE_WAIT_MS[kind] / 1000)
    }
    expect(TRANSCODE_PLAN.teacher_intro.wallMs / 1000 + 150).toBeLessThanOrEqual(TRANSCODE_WAIT_MS.teacher_intro / 1000)
    // A listing's numbers are what they always were.
    expect(TRANSCODE_PLAN.listing.wallMs).toBe(210_000)
    expect(TRANSCODE_WAIT_MS.listing).toBe(330_000)
    expect(read('../app/api/upload/video/transcode/route.ts')).toMatch(/const claimTtlS = \(kind: VideoUploadKind\) => TRANSCODE_PLAN\[kind\]\.wallMs \/ 1000 \+ 150/)
  })

  it('the teacher form says five minutes, in both languages, wherever it states the limit — and a minute nowhere', () => {
    expect(VIDEO_MAX_SECONDS.teacher_intro / 60).toBe(5)
    const finish = read('../components/teachers/steps/finish-step.tsx')
    const shared = read('../components/teachers/steps/shared.tsx')
    const form = read('../components/teachers/teacher-form.tsx')
    expect(finish).toContain("tr('Up to 5 minutes: say hello and show how you teach.', 'Tối đa 5 phút: chào hỏi và cho thấy cách bạn dạy.')")
    expect(shared).toContain("tr('Please add a short intro video (up to 5 minutes) — say hello and show how you teach.', 'Vui lòng thêm một video giới thiệu ngắn (tối đa 5 phút) — chào hỏi và cho thấy cách bạn dạy.')")
    expect(form).toContain("case 'too_long': return tr('Your intro video must be 5 minutes or less.', 'Video giới thiệu phải dài tối đa 5 phút.')")
    for (const src of [finish, shared, form]) expect(src).not.toMatch(/60 seconds|60 giây/)
    // The upload names its kind — without it the server keeps a listing's minute.
    expect(form).toMatch(/uploadListingVideo\(prepared\.file, \{ hevc: prepared\.hevc, kind: 'teacher_intro' \}\)/)
  })
})
