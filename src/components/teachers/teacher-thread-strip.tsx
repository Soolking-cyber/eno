'use client'

// The contact strip of a TEACHER thread (2026-09-30), replacing the product "Request number" strip.
//   · teacher (seller side): "Share my phone, email & CV" / "Stop sharing" — their explicit tap, not
//     any reply, is what unlocks their details (owner decision; "no thanks" must unlock nothing);
//   · recruiter (buyer side): the shared phone, email and CV once shared, else a waiting hint.
// Its second row (2026-10-07, owner: "hide and send upon request") is the intro video a teacher keeps private:
//   · teacher: "Send my intro video" / "Stop sharing video", with the school's ask shown when there is one;
//   · school: "Ask for their intro video" → asked (a day later: "Ask again") → "Watch intro video", inline, on a 10-minute link.
// Only a school or company buyer is offered any of it (`forBusiness`, gate review 2026-10-08).
// The server re-derives every rule from the conversation row (src/lib/teachers/share.ts).
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { FileText, Phone, Play, Video } from '@/components/ui/icons'
import { isNativeShell, openExternal } from '@/lib/native-browser'

type Contact = { phone: string | null; email: string | null; hasCv: boolean }
/**
 * The thread payload's `teacher.video` (api/conversations/[id] → teacherVideoState). A payload without the last two reads
 * as `forBusiness` true and `askAgain` false.
 */
export type TeacherVideoFlags = { available: boolean; shareOn: boolean; shared: boolean; requested: boolean; askAgain?: boolean; forBusiness?: boolean }

/** A playback error re-mints the link at most this many times per Watch (an expired link mid-seek, not a loop). */
const MAX_REMINTS = 2
/** Only a link this close to its end is re-minted on an error: expiry is the one failure a new link fixes. */
const REMINT_WITHIN_MS = 60_000

/**
 * `closed` — the thread is CLOSED by a block (App Store gate `ugc-safety`). The page then mounts the strip
 * for the TEACHER only, and only so a share made before the block can be WITHDRAWN: the strip shows "Stop
 * sharing" while a share stands and nothing otherwise — a Share button there could only be refused
 * (codex, gate round 3). The video row follows the same rule.
 * `videoReadAt` — when the page's read that brought `video` STARTED (performance.now(), readThread); absent = now.
 */
export function TeacherThreadStrip({ conversationId, iAmTeacher, shared: sharedProp, live = true, shareSignal, closed = false, video: videoProp = null, videoReadAt, videoSignal = 0 }: { conversationId: string; iAmTeacher: boolean; shared: boolean; live?: boolean; shareSignal: number; closed?: boolean; video?: TeacherVideoFlags | null; videoReadAt?: number; videoSignal?: number }) {
  const { tr } = useLanguage()
  const [shared, setShared] = useState(sharedProp)
  const [busy, setBusy] = useState(false)
  const [contact, setContact] = useState<Contact | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setShared(sharedProp) }, [sharedProp])

  // ⚠️ THE RECRUITER'S SIDE ASKS THE SERVER on mount and whenever `shareSignal` moves — the count of
  // share/revoke ANNOUNCEMENTS in the thread, not of all messages. A share or revoke arrives as a
  // realtime message, never as a new thread payload, so a prop-driven strip showed a revoked phone
  // until reload; refetching on EVERY message instead drained the rate limit in a busy chat and then
  // hid details that were shared (agy + Opus, commit gate 09-30). Only `share_required` clears.
  useEffect(() => {
    if (iAmTeacher) { setContact(null); return }
    let alive = true
    fetch(`/api/teachers/contact?conversationId=${encodeURIComponent(conversationId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.ok) { setContact(d as Contact); setShared(true); setError('') }
        else if (r.status === 429) setError(tr('Too many requests — the contact details will load again in a few minutes.', 'Quá nhiều yêu cầu — thông tin liên hệ sẽ tải lại sau vài phút.'))
        // Any REFUSAL (403/404: not shared, not business, suspended, gone) clears what is on screen.
        // Only a rate limit or a network failure keeps it — those are not a change of permission.
        else if (r.status === 403 || r.status === 404) {
          setContact(null)
          if (d.error === 'share_required' || d.error === 'not_found') setShared(false)
          if (d.error === 'business_only') setError(tr('Only school and company accounts can see teacher contact details.', 'Chỉ tài khoản trường học hoặc công ty mới xem được liên hệ của giáo viên.'))
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [conversationId, iAmTeacher, shareSignal])

  // ── The intro video (2026-10-07) ────────────────────────────────────────────────────────────────
  // ⚠️ ONE STRIP PER THREAD: Next 16.3 mounts a NEW [id] page instance per conversation (layout-router keys a dynamic segment
  // by its value — measured 2026-10-06), so none of this state, nor a late answer, ever crosses into another thread.
  const [video, setVideoState] = useState<TeacherVideoFlags | null>(videoProp)
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [watchUrl, setWatchUrl] = useState<string | null>(null)
  const remints = useRef(0)
  const resumeAt = useRef(0)
  const linkExpiresAt = useRef(0)
  // ⛔ EVERY WATCH TAKES A TICKET; Close, a stop and a refresh take a newer one, so an answer for an older ticket never
  // reopens the player (gate review, 2026-10-07: a slow Watch answering after a Stop or a Close brought it back).
  const watchSeq = useRef(0)
  const playerRef = useRef<HTMLVideoElement>(null)
  const closePlayer = () => { watchSeq.current += 1; setWatchUrl(null); remints.current = 0; resumeAt.current = 0 }
  /**
   * ⛔ THE SERVER'S FLAGS ARE THE STATE, AND THE NEWEST WORD ON THEM IS WHAT SHOWS (gate reviews, 2026-10-07/08). Three
   * sources speak: the thread payload (the page's poll, focus and realtime reads), the 🎬 re-read below, and this strip's
   * own actions and refusals. ONE clock orders them all — `performance.now()`, the page's and this strip's: a server read
   * counts from when it STARTED, an action or a state-changing refusal from when it ENDED (`shownAt`). So a poll that left
   * before a Send ended is older than the Send and is dropped — ordering only the re-read let such a poll flip the teacher
   * back to "Send" for up to 15s and close a school's open player (three review rounds, 2026-10-08).
   * An alert describes the state it was raised in, so it goes only when an applied answer DIFFERS from what is shown: a
   * poll repeating that state keeps it ("stopped sharing" stays while sharing is stopped), a re-send clears it.
   */
  // ⛔ THE STATE AS LAST SET, written by every change as it happens — never only at the next render: a refusal's patch and
  // the read that confirms it can both land before React renders, and the alert rule below must compare against the
  // patch, not the state before it (gate review, 2026-10-08 — an alert outlived the state it described). The form's
  // setT pattern; functional updates build on this, so an answer landing meanwhile is built on, never overwritten.
  const shownFlags = useRef(videoProp)
  const setVideo = (u: TeacherVideoFlags | null | ((v: TeacherVideoFlags | null) => TeacherVideoFlags | null)) => {
    const next = typeof u === 'function' ? u(shownFlags.current) : u
    shownFlags.current = next
    setVideoState(next)
  }
  /**
   * When a word on the state was spoken: a time on the shared clock, and its place among THIS strip's own events — the
   * tie-break a coarse clock needs (browsers round performance.now(); Firefox's resistFingerprinting to 100 ms), where a
   * poll's start and an action's end can read the same. On a tie the strip's later event wins, and a page read (seq 0) is
   * never taken over one of them: it may have left before the action ended (gate review, 2026-10-08).
   */
  type Stamp = { t: number; seq: number }
  const eventSeq = useRef(0)
  const stamp = (): Stamp => ({ t: performance.now(), seq: ++eventSeq.current })
  const isOlder = (a: Stamp, b: Stamp) => a.t < b.t || (a.t === b.t && a.seq < b.seq)
  const shownAt = useRef<Stamp>({ t: -Infinity, seq: 0 })
  /** An action or a state-changing refusal just landed: the newest word — only a read that starts after it is newer. */
  const actionLanded = () => { shownAt.current = stamp() }
  // As shown: a missing flag reads as its default, and `askAgain` counts only while an ask stands.
  const flagsKey = (f: TeacherVideoFlags | null) => (f ? `${+f.available}${+f.shareOn}${+f.shared}${+f.requested}${+(f.requested && f.askAgain === true)}${+(f.forBusiness !== false)}` : '-')
  const applyServerFlags = (next: TeacherVideoFlags | null, at: Stamp) => {
    if (isOlder(at, shownAt.current)) return // began before the newest word shown: older, dropped
    shownAt.current = at
    if (flagsKey(next) !== flagsKey(shownFlags.current)) setVideoError('')
    setVideo(next)
  }
  // EVERY payload, not only one whose flags differ from the last payload: after a local refusal the shown state differs
  // from both, and a newer poll repeating the earlier payload must still bring it back (gate review, 2026-10-08).
  useEffect(() => { applyServerFlags(videoProp, { t: videoReadAt ?? performance.now(), seq: 0 }) }, [videoProp, videoReadAt])
  // Not watchable any more — by a 🎬 line, a refused Watch, or a payload refresh (hiding a profile sends no line, nor does
  // the buyer's account ceasing to be a business): the player goes, and coming back starts from a fresh Watch.
  const watchable = !!video?.shared && video.forBusiness !== false
  useEffect(() => { if (!watchable) closePlayer() }, [watchable])
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  /**
   * A FRESH READ of the state, counted from when it STARTS (an action that ends meanwhile is newer: dropped there). Run after
   * a 🎬 line, and after this strip's own action or state-changing refusal: that answer is only what its request saw, so a
   * change made elsewhere meanwhile — the teacher's other tab — shows within this one read, not at the next poll (gate
   * review, 2026-10-08). Only a real flags answer applies.
   */
  const rereadFlags = () => {
    const at = stamp()
    fetch(`/api/teachers/video-share?conversationId=${encodeURIComponent(conversationId)}`)
      .then(async (r) => {
        if (!r.ok || !mounted.current) return
        const d = (await r.json().catch(() => null)) as TeacherVideoFlags | null
        if (d && typeof d.available === 'boolean' && mounted.current) applyServerFlags(d, at)
      })
      .catch(() => {})
  }
  // ⚠️ A SEND, A STOP AND AN ASK ARRIVE AS 🎬 LINES (api/teachers/video-share, video-request), never as a new payload —
  // so the row re-reads its state when their count moves, the contact strip's pattern. Not on mount: the payload is fresh.
  const seenVideoSignal = useRef(videoSignal)
  useEffect(() => {
    if (seenVideoSignal.current === videoSignal) return
    seenVideoSignal.current = videoSignal
    rereadFlags()
  }, [conversationId, videoSignal])

  const videoErrText = (code: string, status: number): string => {
    if (status === 429) return tr('Too many requests — please try again in a few minutes.', 'Quá nhiều yêu cầu — vui lòng thử lại sau vài phút.')
    if (code === 'blocked') return tr('This conversation is closed — the intro video can’t be shared here.', 'Cuộc trò chuyện này đã đóng — không thể chia sẻ video giới thiệu ở đây.')
    if (code === 'profile_hidden') return iAmTeacher
      ? tr('Show your profile again before sending your video.', 'Hãy hiển thị lại hồ sơ trước khi gửi video.')
      : tr('This teacher’s profile isn’t visible right now, so the video can’t be watched.', 'Hồ sơ của giáo viên này hiện không hiển thị nên không xem được video.')
    // School side: never "no video" — a teacher who just made it PUBLIC still has one, on their profile.
    if (code === 'video_missing' || code === 'video_not_on_request') return iAmTeacher
      ? tr('There is no private intro video on your profile to send. Add one in your teacher profile.', 'Hồ sơ của bạn chưa có video giới thiệu riêng tư để gửi. Hãy thêm video trong hồ sơ giáo viên.')
      : tr('This teacher no longer sends their video on request — if they show it, it’s on their profile.', 'Giáo viên này không còn gửi video theo yêu cầu — nếu họ công khai, video sẽ có trên hồ sơ của họ.')
    if (code === 'business_only') return iAmTeacher
      ? tr('Only school and company accounts can receive your intro video.', 'Chỉ tài khoản trường học hoặc công ty mới nhận được video giới thiệu của bạn.')
      : tr('Only school and company accounts can ask for a teacher’s intro video.', 'Chỉ tài khoản trường học hoặc công ty mới đề nghị xem được video giới thiệu của giáo viên.')
    if (code === 'share_required') return tr('The teacher stopped sharing their intro video.', 'Giáo viên đã ngừng chia sẻ video giới thiệu.')
    if (code === 'account_suspended') return tr('Your account can’t do this right now.', 'Tài khoản của bạn hiện chưa thể thực hiện thao tác này.')
    return tr('Something went wrong. Please try again.', 'Đã có lỗi. Vui lòng thử lại.')
  }

  /**
   * A refusal that says what the state now is hides the action it refused, rather than leave it there to fail again (gate
   * review, 2026-10-08). Each patch keeps the server's derivation: `shared` needs shareOn, available and forBusiness.
   * Any other refusal (a rate limit, a block, a suspension) changes no flag.
   */
  const refusalPatch = (code: string): Partial<TeacherVideoFlags> | null => {
    // Not watchable or sendable for a reason that is not a stop (a hidden profile, a video now public or gone): the
    // teacher's grant may well stand, so only availability goes — and no Ask or Send is offered over it.
    if (code === 'video_missing' || code === 'video_not_on_request' || code === 'profile_hidden') return { available: false, shared: false }
    // The buyer is not a school or company account: the video row is not for this thread at all.
    if (code === 'business_only') return { forBusiness: false, shared: false }
    // Watch: the teacher's grant is what is missing. A stop answers the school's ask too, so it may ask again.
    if (code === 'share_required') return { shareOn: false, shared: false, requested: false }
    return null
  }
  /** Says why, and applies what the refusal revealed — the newest word on the state (actionLanded). */
  const refused = (code: string, status: number) => {
    setVideoError(videoErrText(code, status))
    const patch = refusalPatch(code)
    if (patch) { actionLanded(); setVideo((v) => v && { ...v, ...patch }); rereadFlags() }
  }

  /** Teacher: send or stop. The server answers with the grant as it now stands. */
  const toggleVideo = async (next: boolean) => {
    if (videoBusy || !video) return
    setVideoBusy(true); setVideoError('')
    try {
      const r = await fetch('/api/teachers/video-share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, share: next }) })
      const d = await r.json().catch(() => ({}))
      // Functional updates: a 🎬 re-read landing while this was in flight is built on, never overwritten (gate review).
      if (r.ok) {
        const on = d.shared === true
        actionLanded()
        // A stop answers the school's ask too: it may ask again (teacherVideoState `requested`).
        setVideo((v) => v && { ...v, shareOn: on, shared: on && v.available && v.forBusiness !== false, requested: on ? v.requested : false })
        rereadFlags()
      } else refused(String(d.error ?? ''), r.status)
    } catch {
      setVideoError(videoErrText('', 0))
    } finally { setVideoBusy(false) }
  }

  /** School: ask (again a day later). The teacher is told in the thread and rung; a request alone unlocks nothing. */
  const askVideo = async () => {
    if (videoBusy || !video) return
    setVideoBusy(true); setVideoError('')
    try {
      const r = await fetch('/api/teachers/video-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) })
      const d = await r.json().catch(() => ({}))
      // The answer is the newest word — so an ask that finds the video already sent (its 🎬 line still on the way, and the
      // re-read it starts older than this) shows Watch now, not "You asked…" until the next poll.
      if (r.ok) { actionLanded(); setVideo((v) => v && (d.shared === true ? { ...v, shareOn: true, shared: true } : { ...v, requested: true, askAgain: false })); rereadFlags() }
      else refused(String(d.error ?? ''), r.status)
    } catch {
      setVideoError(videoErrText('', 0))
    } finally { setVideoBusy(false) }
  }

  /** School: a fresh 10-minute link per Watch; `resume` re-mints after an expiry and picks up where it was. */
  const watchVideo = async (resume = false) => {
    if (videoBusy || !video) return
    const ticket = ++watchSeq.current
    if (!resume) { remints.current = 0; resumeAt.current = 0 } // never seek to an earlier attempt's position
    setVideoBusy(true); setVideoError('')
    try {
      const r = await fetch(`/api/teachers/video?conversationId=${encodeURIComponent(conversationId)}`)
      const d = await r.json().catch(() => ({}))
      if (ticket !== watchSeq.current) return // closed, stopped or superseded meanwhile
      if (r.ok && typeof d.url === 'string') {
        linkExpiresAt.current = Date.now() + (typeof d.expiresIn === 'number' ? d.expiresIn : 600) * 1000
        setWatchUrl(d.url)
        return
      }
      // Refused: no player stays up on a link that no longer works — Watch comes back for a fresh try, unless the refusal
      // says what changed (a stop, a hidden profile, not a business): then that state shows instead (refusalPatch).
      closePlayer()
      refused(String(d.error ?? ''), r.status)
    } catch {
      // The network failed — a re-mint included: the expiring player goes too, never left up with no Watch (gate review).
      if (ticket === watchSeq.current) { closePlayer(); setVideoError(videoErrText('', 0)) }
    } finally { setVideoBusy(false) }
  }
  /**
   * The link lives 10 minutes: a pause past that, then a seek into what is not buffered, fails here — and that is the one
   * failure a new link fixes. Re-mint only a link at (or within a minute of) its end, at most MAX_REMINTS times; a fresh link
   * that fails is something else (a format this browser cannot play, the network), so say so instead of minting links that
   * fail the same way (gate review, 2026-10-07). A refusal (a stop, a block) answers the re-mint with its own reason.
   */
  const onPlayerError = () => {
    if (videoBusy) return // a re-mint is already out — a second error event for the same failure spends nothing
    const expiring = Date.now() >= linkExpiresAt.current - REMINT_WITHIN_MS
    if (!expiring || remints.current >= MAX_REMINTS) {
      closePlayer()
      setVideoError(tr('The video could not be played here. Please try again, or on another device.', 'Không phát được video ở đây. Vui lòng thử lại hoặc dùng thiết bị khác.'))
      return
    }
    remints.current += 1
    resumeAt.current = playerRef.current?.currentTime ?? 0
    void watchVideo(true)
  }

  const cvHref = `/api/teachers/cv?conversationId=${encodeURIComponent(conversationId)}`
  const openCvInApp = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setError('')
    try {
      const r = await fetch(`${cvHref}&format=json`)
      const d = await r.json().catch(() => ({}))
      if (r.ok && typeof d.url === 'string') { await openExternal(d.url); return }
      setError(r.status === 429
        ? tr('Too many downloads — try again in a few minutes.', 'Tải quá nhiều lần — hãy thử lại sau vài phút.')
        : tr('Could not open the CV. Please try again.', 'Không mở được CV. Vui lòng thử lại.'))
    } catch {
      setError(tr('Could not open the CV. Please try again.', 'Không mở được CV. Vui lòng thử lại.'))
    }
  }

  const toggle = async (next: boolean) => {
    // `loading` keeps the button focusable (aria-disabled), so the double-tap guard lives here.
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/teachers/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, share: next }) })
      if (r.ok) setShared(next)
      else {
        const code = (await r.json().catch(() => ({}))).error
        setError(code === 'profile_hidden'
          ? tr('Show your profile again before sharing your contact details.', 'Hãy hiển thị lại hồ sơ trước khi chia sẻ thông tin liên hệ.')
          // App Store gate `ugc-safety`: a block refuses a new share (the thread shows it is closed too).
          // Names the conversation, never the person.
          : code === 'blocked'
            ? tr('This conversation is closed — contact details can’t be shared here.', 'Cuộc trò chuyện này đã đóng — không thể chia sẻ thông tin liên hệ ở đây.')
            : tr('Could not update sharing. Please try again.', 'Không cập nhật được. Vui lòng thử lại.'))
      }
    } finally { setBusy(false) }
  }

  const videoShareOn = !!video?.shareOn
  // The thread's buyer is a school or company account: anyone else is sent nothing and asks for nothing (gate review, 2026-10-08).
  const videoForBusiness = video?.forBusiness !== false
  if (closed && (!iAmTeacher || (!shared && !videoShareOn))) return null

  // The video row: closed → only a standing share, to withdraw it; otherwise what each side can do now.
  const videoRow = !video ? null : iAmTeacher ? (
    videoShareOn ? (
      <>
        <p className="text-2xs text-body">{closed
          ? tr('Your intro video is still shared, but this school can’t watch it while the conversation is closed.', 'Video giới thiệu vẫn đang được chia sẻ, nhưng trường không xem được khi cuộc trò chuyện đang đóng.')
          // Before availability, which is about the teacher's PROFILE: this share can't reach this buyer at all.
          : !videoForBusiness ? tr('This account is no longer a school or company, so it can’t watch your video.', 'Tài khoản này không còn là trường học hoặc công ty nên không xem được video của bạn.')
          // ⚠️ Said where the teacher decides to stop: a link already handed out is a 10-minute bearer URL — stopping ends
          // new views, not one already open (api/teachers/video; gate review, 2026-10-07).
          // `!available` while the share stands = the profile is not live: removing or publishing the private video revokes
          // every sent grant server-side (publish.ts), so the share would be off.
          : video.available ? tr('This school can watch your intro video. If you stop, a video they already opened can keep playing for up to 10 minutes.', 'Trường này xem được video giới thiệu của bạn. Nếu bạn ngừng, video trường đã mở vẫn có thể phát thêm tối đa 10 phút.') : tr('Paused while your profile is hidden — the school can’t watch your video until it is visible again.', 'Tạm dừng khi hồ sơ bị ẩn — trường không xem được video cho đến khi hồ sơ hiển thị lại.')}</p>
        <Button variant="ghost" size="sm" onClick={() => toggleVideo(false)} loading={videoBusy}>{tr('Stop sharing video', 'Ngừng chia sẻ video')}</Button>
      </>
    ) : !closed && video.available && videoForBusiness ? (
      <>
        <Button variant="secondary" size="sm" onClick={() => toggleVideo(true)} loading={videoBusy}>
          <Video className="size-4" />
          {tr('Send my intro video', 'Gửi video giới thiệu')}
        </Button>
        {video.requested && <p className="text-2xs font-semibold text-foreground">{tr('This school asked to see your intro video.', 'Trường này muốn xem video giới thiệu của bạn.')}</p>}
      </>
    ) : null
  ) : !videoForBusiness ? null : video.shared ? (
    watchUrl ? (
      <div className="w-full space-y-2">
        <video
          ref={playerRef}
          src={watchUrl}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => { if (resumeAt.current > 0) { e.currentTarget.currentTime = resumeAt.current; resumeAt.current = 0 } }}
          onError={onPlayerError}
          className="aspect-video w-full max-w-sm rounded-xl bg-black"
        />
        <Button variant="ghost" size="sm" onClick={closePlayer}>{tr('Close video', 'Đóng video')}</Button>
      </div>
    ) : (
      <Button variant="secondary" size="sm" onClick={() => watchVideo()} loading={videoBusy}>
        <Play className="size-4" />
        {tr('Watch intro video', 'Xem video giới thiệu')}
      </Button>
    )
  ) : video.available ? (
    video.requested && !video.askAgain ? (
      <p className="flex items-center gap-1.5 text-2xs text-body">
        <Video className="h-3.5 w-3.5 shrink-0 text-ink-4" />
        {tr('You asked for the intro video — it appears here if the teacher sends it.', 'Bạn đã đề nghị xem video giới thiệu — video sẽ hiện ở đây nếu giáo viên gửi.')}
      </p>
    ) : (
      // Not asked yet — or asked a day ago, when the server takes a new ask (teacherVideoState `askAgain`).
      <Button variant="secondary" size="sm" onClick={askVideo} loading={videoBusy}>
        <Video className="size-4" />
        {video.requested
          ? tr('Ask again for their intro video', 'Đề nghị lại xem video giới thiệu')
          : tr('Ask for their intro video', 'Đề nghị xem video giới thiệu')}
      </Button>
    )
  ) : null

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-2">
      {closed && !shared ? null : iAmTeacher ? (
        shared ? (
          <>
            <p className="text-2xs text-body">{closed
              ? tr('Your details are still shared, but this school can’t see them while the conversation is closed.', 'Thông tin của bạn vẫn đang được chia sẻ, nhưng trường không xem được khi cuộc trò chuyện đang đóng.')
              : live ? tr('This school can see your phone, email and CV.', 'Trường này xem được số điện thoại, email và CV của bạn.') : tr('Paused while your profile is hidden — the school sees nothing until it is visible again.', 'Tạm dừng khi hồ sơ bị ẩn — trường không xem được gì cho đến khi hồ sơ hiển thị lại.')}</p>
            <Button variant="ghost" size="sm" onClick={() => toggle(false)} loading={busy}>{tr('Stop sharing', 'Ngừng chia sẻ')}</Button>
          </>
        ) : (
          <>
            <Button variant="cta" size="sm" onClick={() => toggle(true)} loading={busy}>
              <Phone className="h-3.5 w-3.5" />
              {tr('Share my phone, email & CV', 'Chia sẻ số điện thoại, email và CV')}
            </Button>
            <p className="text-2xs text-muted-foreground">{tr('Only this school sees them, and you can stop any time.', 'Chỉ trường này xem được, và bạn có thể ngừng bất cứ lúc nào.')}</p>
          </>
        )
      ) : contact ? (
        <>
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"><Phone className="h-3.5 w-3.5" /> {contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} className="rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted">{contact.email}</a>}
          {/* ⚠️ NATIVE SHELL: never a navigation. A target=_blank link goes to Safari, which has no eno session
              (401); a same-window load resets Capacitor's bridge. So the app asks for the signed link as JSON
              and opens it in the in-app browser; a refusal stays here as the strip's alert. Web: unchanged.
              `contact` only ever comes from the client fetch above, so this never renders on the server. */}
          {contact.hasCv && <a href={cvHref} {...(isNativeShell() ? { onClick: openCvInApp } : { target: '_blank', rel: 'noopener' })} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"><FileText className="h-3.5 w-3.5" /> {tr('Download CV', 'Tải CV')}</a>}
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-2xs text-body">
          <Phone className="h-3.5 w-3.5 shrink-0 text-ink-4" />
          {tr('The teacher’s phone, email and CV appear here if they choose to share them with you.', 'Số điện thoại, email và CV của giáo viên sẽ hiện ở đây nếu họ đồng ý chia sẻ.')}
        </p>
      )}
      {error && <p role="alert" className="w-full text-2xs text-destructive">{error}</p>}
      {videoRow && <div className="flex w-full flex-wrap items-center gap-2">{videoRow}</div>}
      {videoError && <p role="alert" className="w-full text-2xs text-destructive">{videoError}</p>}
    </div>
  )
}
