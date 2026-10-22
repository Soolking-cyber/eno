'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { IconButton } from '@/components/ui/icon-button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Phone } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { runtimeMounted, subscribeRuntime } from '@/lib/calls/client/presence'
import type { CallMedia } from '@/lib/calls/types'
import { callErrorText, withName } from './call-copy'

/**
 * In-app calls — the ONE call button in a thread's header (owner, 2026-10-22: "it should be 1 icon button for call and
 * they can enable video inside if they want audio will already be there"; DESIGN.md v3 §3.2 step 1, §4). Every call
 * starts as voice; where this pair may use video (state.video 'ok') it is placed as a video-capable call with the
 * camera OFF, so the camera button is right there on the call screen — no second button, no renegotiation. It renders
 * nothing at all unless calls are on for this person (GET /api/calls/config), this page can capture audio, and this
 * thread can carry a call (GET /api/conversations/:id/call). Then:
 *   · allowed, and the other person has allowed calls from me → call (the engine takes over the screen);
 *   · allowed but no consent yet → "Ask to call" sends the request card ("<name> would like to call you");
 *   · not verified → the reason, with the way to verify;
 *   · anything else (a desk thread, a block, the beta) → no buttons.
 * In Facebook / Zalo / Instagram in-app browsers the buttons stay hidden: capture is unreliable there (§5).
 */
type ThreadState = Awaited<ReturnType<typeof import('@/lib/calls/client/api').getThreadCallState>>

const SHOWN = new Set(['ok', 'calls_not_verified', 'calls_peer_not_verified'])

/** Video-capable (camera off) where the pair may use video, voice-only otherwise — the box re-checks it at the start. */
const callMediaFor = (s: ThreadState): CallMedia => (s.video === 'ok' ? 'video' : 'audio')

export function CallButtons({ conversationId, peer, listing }: {
  conversationId: string
  peer: { name: string | null; avatarUrl: string | null }
  listing: { id: string; title: string } | null
}) {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const router = useRouter()
  const [state, setState] = useState<ThreadState | null>(null)
  // No call screen, no call (client review): the runtime is what draws it, rings, and hangs up on pagehide.
  const screenReady = useSyncExternalStore(subscribeRuntime, runtimeMounted, () => false)
  const [askOpen, setAskOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  // Still this account's button? The thread view remounts per account; a tap whose reads finish after that must not
  // start a call — or send a request — for whoever is signed in now (client review).
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    let cancelled = false
    setState(null)
    void (async () => {
      if (!userId) return
      // The Android shell and the in-app browsers cannot place a call (media.ts — the ring screen's rule too).
      const { callsWorkHere } = await import('@/lib/calls/client/media')
      if (!callsWorkHere()) return
      const { getCallsConfig, getThreadCallState } = await import('@/lib/calls/client/api')
      const config = await getCallsConfig(userId)
      if (!config.enabled || cancelled) return
      try {
        const s = await getThreadCallState(conversationId)
        if (!cancelled) setState(s)
      } catch { /* no buttons */ }
    })()
    return () => { cancelled = true }
  }, [conversationId, userId])

  // Voice is what every call needs; video only adds the camera button inside the call.
  if (!state || !screenReady || !SHOWN.has(state.audio)) return null

  const place = async () => {
    const code = state.audio
    if (code === 'calls_not_verified') return setVerifyOpen(true)
    if (code !== 'ok') return void toast(callErrorText(code, tr))
    let current = state
    if (!current.consent.theyAllowMe) {
      // Read again before asking (client review): they may have tapped Allow since this page loaded.
      try {
        const { getThreadCallState } = await import('@/lib/calls/client/api')
        current = await getThreadCallState(conversationId)
        if (!alive.current) return
        setState(current)
      } catch { /* ask on what we had */ }
      if (!current.consent.theyAllowMe) return setAskOpen(true)
    }
    const { callEngine } = await import('@/lib/calls/client/engine')
    if (!alive.current) return
    // The server's card for the other person (verified mark, side, member since — the same one THEIR screen gets of
    // me); the thread's name and avatar only stand in if it is missing (client review: the caller saw no verified mark).
    void callEngine.startCall(conversationId, callMediaFor(current), current.peer ?? {
      name: peer.name, avatarUrl: peer.avatarUrl, verified: false, memberSince: null, side: null,
    }, listing)
  }

  const ask = async () => {
    setAskOpen(false)
    try {
      const { requestCall } = await import('@/lib/calls/client/api')
      if (!alive.current) return
      const r = await requestCall(conversationId)
      if (!alive.current) return
      if (r.alreadyAllowed) {
        // They allowed it in the meantime: just call (no second tap).
        setState({ ...state, consent: { ...state.consent, theyAllowMe: true } })
        const { callEngine } = await import('@/lib/calls/client/engine')
        if (!alive.current) return
        void callEngine.startCall(conversationId, callMediaFor(state), state.peer ?? {
          name: peer.name, avatarUrl: peer.avatarUrl, verified: false, memberSince: null, side: null,
        }, listing)
        return
      }
      toast.success(tr('Asked. You can call as soon as they allow it.', 'Đã gửi lời đề nghị. Bạn có thể gọi ngay khi họ cho phép.'))
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
      toast(code === 'call_request_cooldown'
        ? tr('You asked recently — they will see your request in the chat.', 'Bạn vừa đề nghị — họ sẽ thấy lời đề nghị trong cuộc trò chuyện.')
        : callErrorText(code, tr))
    }
  }

  return (
    <>
      <IconButton aria-label={tr('Start a call', 'Gọi')} onClick={() => void place()} className="text-muted-foreground hover:bg-tint hover:text-foreground">
        <Phone className="h-5 w-5" />
      </IconButton>
      <AlertDialog open={askOpen} onOpenChange={setAskOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Ask to call?', 'Đề nghị gọi?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {withName(
                tr(
                  '{name} has not allowed calls from you yet. We will ask in the chat; once they tap Allow, you can call.',
                  '{name} chưa cho phép bạn gọi. Chúng tôi sẽ hỏi trong cuộc trò chuyện; khi họ bấm Cho phép, bạn có thể gọi.',
                ),
                '{name} has not allowed calls from you yet. We will ask in the chat; once they tap Allow, you can call.',
                peer.name ?? tr('This person', 'Người này'),
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancel', 'Hủy')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void ask()}>{tr('Ask to call', 'Gửi đề nghị')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Verify to call', 'Xác minh để gọi')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Calls are open to members who verified their identity. It takes a few minutes and keeps strangers honest.', 'Tính năng gọi dành cho thành viên đã xác minh danh tính. Chỉ mất vài phút và giúp mọi người an tâm hơn.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Not now', 'Để sau')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push('/dashboard/verification')}>{tr('Verify', 'Xác minh')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
