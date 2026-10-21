'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { BadgeCheck, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, ShieldAlert, ShieldCheck, SwitchCamera, Video } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { callEngine, type CallView } from '@/lib/calls/client/engine'
import { callsWorkHere } from '@/lib/calls/client/media'
import { callEndText, callErrorText, callerRoleLine } from './call-copy'

/** A translated template with a {year} slot, filled; a translation that lost the slot keeps the year at the end. */
const withYear = (template: string, year: number) => (template.includes('{year}') ? template.replace('{year}', String(year)) : `${template} ${year}`)

/**
 * In-app calls — the one full-screen surface for a call's whole life: ringing in, calling out, in the call, and the
 * end card. A Base UI Dialog (focus held inside, the page behind inert, Escape ignored — a call is ended with the red
 * button, never by a stray key). Dark in both themes (`brand-deeper`), like every phone's call screen.
 *
 * What it shows, from the design (DESIGN.md v3 §3.2 step 5, §4):
 *   · who: name, avatar, verified mark, and which side of which listing — a stranger cannot pose as "eno support"
 *     here, and the fixed line says eno never calls anyone;
 *   · the safety code: 4 emoji with their names, to compare by voice or on video — "End-to-end encrypted" only once
 *     the code is up; a mismatch ends the call with a warning, never a quiet note;
 *   · video: the camera starts OFF; the other person's video arrives BLURRED until tapped, and blurs again after any
 *     gap in it;
 *   · 1:55 into a call, a warning that the 2 h cap is near.
 */
export function CallScreen({ view }: { view: CallView }) {
  const { tr } = useLanguage()
  const open = view.phase !== 'idle'
  if (!open) return null
  return (
    <Dialog open onOpenChange={() => { /* only the buttons end or dismiss a call */ }}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-brand-deeper p-0 text-white sm:max-w-none"
      >
        <DialogTitle className="sr-only">{view.phase === 'incoming' ? tr('Incoming call', 'Cuộc gọi đến') : tr('Call', 'Cuộc gọi')}</DialogTitle>
        <DialogDescription className="sr-only">{view.peer?.name ?? ''}</DialogDescription>
        {view.phase === 'incoming' ? <Incoming view={view} /> : view.phase === 'ended' ? <Ended view={view} /> : <InCall view={view} />}
      </DialogContent>
    </Dialog>
  )
}

function PeerHeader({ view, status }: { view: CallView; status: string }) {
  const { tr } = useLanguage()
  const role = callerRoleLine(view.peer?.side ?? null, view.listing?.title ?? null, tr)
  // How long they have been on eno — part of telling a real member from someone posing as one (§4).
  const since = view.peer?.memberSince ? new Date(view.peer.memberSince).getUTCFullYear() : null
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-[max(2rem,env(safe-area-inset-top))] text-center">
      <Avatar name={view.peer?.name ?? undefined} url={view.peer?.avatarUrl ?? undefined} size="lg" />
      <div className="flex items-center gap-1.5 text-xl font-bold">
        <span className="max-w-[16rem] truncate">{view.peer?.name ?? tr('eno member', 'Thành viên eno')}</span>
        {view.peer?.verified && <BadgeCheck aria-label={tr('Identity verified', 'Đã xác minh danh tính')} className="h-5 w-5 shrink-0 text-white/80" />}
      </div>
      {role && <p className="max-w-[20rem] truncate text-sm text-white/70">{role}</p>}
      {since && <p className="text-xs text-white/60">{withYear(tr('On eno since {year}', 'Tham gia eno từ {year}'), since)}</p>}
      <p className="text-sm text-white/80" role="status" aria-live="polite">{status}</p>
    </div>
  )
}

function Incoming({ view }: { view: CallView }) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)
  // The Android shell and the in-app browsers cannot take a call (media.ts callsWorkHere — the buttons' rule too).
  const cannotAnswerHere = !callsWorkHere()
  return (
    <div className="flex h-full flex-col justify-between pb-[max(2rem,env(safe-area-inset-bottom))]">
      <PeerHeader view={view} status={view.media === 'video' ? tr('Incoming video call…', 'Cuộc gọi video đến…') : tr('Incoming call…', 'Cuộc gọi đến…')} />
      <p className="mx-auto max-w-xs px-6 text-center text-xs text-white/60">
        {tr('eno never calls you. This call is from the person above, about this conversation.', 'eno không bao giờ gọi cho bạn. Cuộc gọi này đến từ người ở trên, về cuộc trò chuyện này.')}
      </p>
      {cannotAnswerHere ? (
        <div className="flex flex-col items-center gap-4 px-6">
          <p className="text-center text-sm text-white/80">{tr('Answer on another device — calls cannot be taken here yet.', 'Hãy nghe trên thiết bị khác — chưa nhận cuộc gọi ở đây được.')}</p>
          {/* A LOCAL dismiss (client review): Decline would end the call on every device, including the one this
              screen just told them to answer on. */}
          <Button variant="secondary" onClick={() => callEngine.dismissRing()}>{tr('Dismiss', 'Ẩn')}</Button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-16">
          <div className="flex flex-col items-center gap-2">
            <IconButton aria-label={tr('Decline', 'Từ chối')} onClick={() => void callEngine.decline()} className="h-16 w-16 bg-destructive text-destructive-foreground">
              <PhoneOff className="h-7 w-7" />
            </IconButton>
            <span className="text-xs text-white/80">{tr('Decline', 'Từ chối')}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <IconButton
              aria-label={tr('Answer', 'Trả lời')}
              disabled={busy}
              onClick={() => { setBusy(true); void callEngine.accept().finally(() => setBusy(false)) }}
              className="h-16 w-16 bg-success text-success-foreground"
            >
              {view.media === 'video' ? <Video className="h-7 w-7" /> : <PhoneIncoming className="h-7 w-7" />}
            </IconButton>
            <span className="text-xs text-white/80">{tr('Answer', 'Trả lời')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function useClock(since: number | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const t = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(t)
  }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.floor((now - since) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function InCall({ view }: { view: CallView }) {
  const { tr } = useLanguage()
  const clock = useClock(view.connectedAt)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const remoteAudio = useRef<HTMLAudioElement>(null)
  const localVideo = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (remoteAudio.current && remoteAudio.current.srcObject !== view.remoteStream) remoteAudio.current.srcObject = view.remoteStream
    if (remoteVideo.current && remoteVideo.current.srcObject !== view.remoteStream) remoteVideo.current.srcObject = view.remoteStream
  }, [view.remoteStream])
  useEffect(() => {
    if (localVideo.current && localVideo.current.srcObject !== view.localStream) localVideo.current.srcObject = view.localStream
  }, [view.localStream, view.cameraOn])

  const status =
    view.phase === 'preparing' ? tr('Starting…', 'Đang chuẩn bị…')
    : view.phase === 'outgoing' ? tr('Ringing…', 'Đang đổ chuông…')
    : view.phase === 'connecting' ? tr('Connecting…', 'Đang kết nối…')
    : view.phase === 'reconnecting' ? tr('Reconnecting…', 'Đang kết nối lại…')
    : view.peerOnHold ? tr('On another call — please wait', 'Đang bận cuộc gọi khác — vui lòng chờ')
    : clock
  const capSoon = view.capAt !== null && view.capAt - Date.now() < 5 * 60_000
  const showVideo = view.media === 'video' && view.remoteVideoLive

  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <audio ref={remoteAudio} autoPlay playsInline />
      {view.media === 'video' && (
        <>
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            muted
            className={cn('absolute inset-0 h-full w-full object-cover transition-[filter]', !showVideo && 'hidden', !view.remoteVideoRevealed && 'blur-2xl')}
          />
          {showVideo && !view.remoteVideoRevealed && (
            <Button variant="secondary" className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" onClick={() => callEngine.revealRemoteVideo()}>
              {tr('Tap to show video', 'Chạm để xem video')}
            </Button>
          )}
          {view.cameraOn && (
            // Mirrored for the FRONT camera only, as every phone shows a selfie; the back camera shows the world as is.
            <video ref={localVideo} autoPlay playsInline muted className={cn('absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-36 w-24 rounded-2xl object-cover', view.facing === 'user' && '-scale-x-100')} />
          )}
        </>
      )}

      <div className="relative z-10">
        {!showVideo && <PeerHeader view={view} status={status} />}
        {showVideo && <p className="px-6 pt-[max(1rem,env(safe-area-inset-top))] text-sm text-white/90" role="status">{view.peer?.name} · {status}</p>}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-6">
        <SafetyCode view={view} />
        {capSoon && <p className="text-xs text-white/80">{tr('Calls end after 2 hours — this one ends in a few minutes.', 'Cuộc gọi tự kết thúc sau 2 giờ — cuộc gọi này sắp kết thúc.')}</p>}
        {view.error && <p className="text-center text-xs text-white/80">{callErrorText(view.error, tr)}</p>}
        <div className="flex items-center justify-center gap-6">
          <IconButton
            aria-label={view.muted ? tr('Unmute', 'Bật micro') : tr('Mute', 'Tắt micro')}
            aria-pressed={view.muted}
            onClick={() => callEngine.toggleMute()}
            className={cn('h-14 w-14', view.muted ? 'bg-white text-ink' : 'bg-white/15 text-white')}
          >
            {view.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </IconButton>
          {view.media === 'video' && (
            <IconButton
              aria-label={view.cameraOn ? tr('Turn camera off', 'Tắt camera') : tr('Turn camera on', 'Bật camera')}
              aria-pressed={view.cameraOn}
              onClick={() => void callEngine.toggleCamera()}
              className={cn('h-14 w-14', view.cameraOn ? 'bg-white text-ink' : 'bg-white/15 text-white')}
            >
              <Video className="h-6 w-6" />
            </IconButton>
          )}
          {view.media === 'video' && view.cameraOn && view.canSwitchCamera && (
            <IconButton aria-label={tr('Switch camera', 'Đổi camera')} onClick={() => void callEngine.switchCamera()} className="h-14 w-14 bg-white/15 text-white">
              <SwitchCamera className="h-6 w-6" />
            </IconButton>
          )}
          <IconButton aria-label={tr('End call', 'Kết thúc')} onClick={() => callEngine.hangup()} className="h-14 w-14 bg-destructive text-destructive-foreground">
            <PhoneOff className="h-6 w-6" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

/** The 4 emoji, or what stands in for them. "End-to-end encrypted" is claimed only once the code is up (owner decision 4). */
function SafetyCode({ view }: { view: CallView }) {
  const { tr } = useLanguage()
  if (view.phase !== 'connected' && view.phase !== 'reconnecting') return null
  if (view.sas.state === 'ready') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
          <ShieldCheck className="h-4 w-4" /> {tr('End-to-end encrypted', 'Mã hóa đầu cuối')}
        </p>
        <div className="flex gap-3" aria-label={tr('Safety code', 'Mã an toàn')}>
          {view.sas.emoji.map((e, i) => (
            // BOTH names, whatever this phone's language: the two people often read the app in different languages
            // and must say the same words to each other — the alphabet's EN + VI names are the shared vocabulary.
            <div key={i} className="flex w-16 flex-col items-center gap-1">
              <span className="text-3xl leading-none" aria-hidden>{e.char}</span>
              <span className="text-center text-2xs leading-tight text-white/90">{e.en}</span>
              <span className="text-center text-2xs leading-tight text-white/70">{e.vi}</span>
            </div>
          ))}
        </div>
        <p className="max-w-xs text-center text-2xs text-white/70">
          {tr('Check that the other person sees the same 4 pictures. If they differ, hang up.', 'Hãy kiểm tra người kia thấy đúng 4 hình này. Nếu khác, hãy cúp máy.')}
        </p>
      </div>
    )
  }
  if (view.sas.state === 'cannot_verify') {
    return <p className="flex items-center gap-1.5 text-xs text-white/70"><ShieldAlert className="h-4 w-4" /> {tr('This device cannot show a safety code for this call.', 'Thiết bị này không hiển thị được mã an toàn cho cuộc gọi này.')}</p>
  }
  return <p className="text-xs text-white/60">{tr('Checking the safety code…', 'Đang kiểm tra mã an toàn…')}</p>
}

function Ended({ view }: { view: CallView }) {
  const { tr } = useLanguage()
  const mismatch = view.sas.state === 'mismatch' || view.endReason === 'sas_mismatch'
  const text = view.error ? callErrorText(view.error, tr) : callEndText(view.endReason, view.role, tr)
  useEffect(() => {
    if (mismatch || view.error) return
    const t = window.setTimeout(() => callEngine.reset(), 2_500)
    return () => window.clearTimeout(t)
  }, [mismatch, view.error])
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <Avatar name={view.peer?.name ?? undefined} url={view.peer?.avatarUrl ?? undefined} size="lg" />
      {mismatch ? (
        <div className="flex max-w-sm flex-col items-center gap-2">
          <ShieldAlert className="h-8 w-8 text-white" />
          <p className="text-lg font-bold">{tr('The safety check failed', 'Kiểm tra an toàn không đạt')}</p>
          <p className="text-sm text-white/80">{tr('The two phones did not agree on the safety code, so the call was ended. Someone may have tried to listen in. Please report this conversation to eno.', 'Hai điện thoại không khớp mã an toàn nên cuộc gọi đã kết thúc. Có thể ai đó đã cố nghe lén. Hãy báo cáo cuộc trò chuyện này cho eno.')}</p>
        </div>
      ) : (
        <p className="text-lg font-bold" role="status">{text}</p>
      )}
      <Button variant="secondary" onClick={() => callEngine.reset()}>
        <Phone className="h-4 w-4" /> {tr('Close', 'Đóng')}
      </Button>
    </div>
  )
}
