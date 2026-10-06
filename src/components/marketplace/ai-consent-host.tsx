'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { appReviewGate } from '@/lib/app-review-gates'
import {
  readAiConsent,
  registerAiConsentAsker,
  setAiConsentAccount,
  writeAiConsent,
  type AiConsent,
  type AiConsentCopy,
  type AiFamily,
} from '@/lib/ai-consent'

/**
 * THE ONE-TIME GOOGLE AI NOTICE — App Store gate `app-ai-notice` (Guideline 5.1.2(i)); the families, what each sends and
 * what "Not now" leaves working are in src/lib/ai-consent.ts. Mounted once, globally (providers.tsx), so any call site —
 * a component or a plain lib function — can `await askAiConsent(family)` and get the person's answer.
 *
 * ⚠️ BUILD-TIME OFF SWITCH: with the gate off this renders null and registers nothing, so askAiConsent() never reaches it
 * (it answers true before asking). With the gate on it still shows nothing on the web: askAiConsent asks only in the apps.
 * ⚠️ A MODAL, UNLIKE THE CHAT-TRANSLATION NOTICE, AND THAT IS DELIBERATE: that one would have opened on ARRIVAL in a thread
 * whose composer owns the keyboard, so it is inline; this one opens only on a TAP that is about to send something to
 * Google — the moment to ask, and the request waits for the answer.
 * ⚠️ BOTH ANSWERS CARRY EQUAL WEIGHT — two outline buttons of one size (the chat notice's and the cookie banner's rule): a
 * permission request with a primary "Allow" beside a ghost "Not now" would be a nudge.
 * ⚠️ PLAIN BUTTONS, NOT AlertDialogAction/Cancel. Those are Base UI Close parts: they fire onOpenChange(false) after our
 * onClick, which here means "dismissed" — it would have answered the NEXT queued question too.
 * ⚠️ Escape (a hardware keyboard; an alert dialog has no outside-tap dismiss) is "not answered": nothing is stored,
 * nothing is sent — not even the assistant's keyword-only request (askAiConsentAnswer answers null, not 'off') — and the
 * next tap asks again. A question voided by a page change or an account change answers null the same way.
 */
export function AiConsentHost() {
  return appReviewGate('app-ai-notice') ? <AiConsentHostOn /> : null
}

type Pending = { key: string; family: AiFamily; userId: string; copy: AiConsentCopy }

function AiConsentHostOn() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [queue, setQueue] = useState<Pending[]>([])
  // Everyone waiting on a family's answer (a second tap while the first is open shares it). A ref, not state: the
  // resolvers must be the CURRENT list when the answer lands, not the one the last render closed over.
  const waiting = useRef(new Map<string, { userId: string; resolvers: Array<(answer: AiConsent) => void> }>())
  // The account the open questions may be answered for — read in handlers, so a ref (set in the effect below).
  const accountRef = useRef(userId)

  /** Answer "no" to every open question `drop` matches — nothing is stored, and the requests waiting on them never go. */
  const voidQuestions = useCallback((drop: (w: { userId: string }) => boolean) => {
    const voided = new Set<string>()
    for (const [key, w] of waiting.current) {
      if (!drop(w)) continue
      waiting.current.delete(key)
      for (const resolve of w.resolvers) resolve(null)
      voided.add(key)
    }
    if (voided.size) setQueue((q) => q.filter((p) => !voided.has(p.key)))
  }, [])

  useEffect(() => {
    accountRef.current = userId
    setAiConsentAccount(userId)
    /**
     * ⛔ A QUESTION ASKED FOR ANOTHER ACCOUNT IS VOID (codex + opus, review). The provider outlives a sign-out or a switch,
     * so a notice opened for account A could be answered after B signed in: "Allow" was stored under A, and the request
     * that had been waiting — A's photo, description, trip details or question — went out on B's session. Now every
     * question for any other account is answered "no" here, nothing is stored, and its request is never sent.
     */
    voidQuestions((w) => w.userId !== userId)
    return () => setAiConsentAccount(null)
  }, [userId, voidQuestions])

  /**
   * ⛔ SO IS A QUESTION LEFT BEHIND BY NAVIGATION (codex, review). The host is global, so the notice stays up while a
   * back-swipe takes the person to another page — and "Allow" there resumed the request of a page they had left: the
   * description, photo or trip question it closed over still went to Google, for a result nobody would see. A new path
   * answers every open question "no"; the person asks again where they are.
   */
  const pathname = usePathname()
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (pathname === lastPath.current) return
    lastPath.current = pathname
    voidQuestions(() => true)
  }, [pathname, voidQuestions])

  const builtIn = useCallback((family: AiFamily): AiConsentCopy | undefined => {
    switch (family) {
      case 'assistant':
        return {
          title: tr('Use Google AI for eno AI?', 'Dùng Google AI cho eno AI?'),
          body: tr(
            'eno AI sends what you type here, with the last few messages of this chat, to Google (Gemini) to understand what you are looking for, and your search words to Google (Vertex AI Search) to find listings. Not now: eno AI still answers, with a simple keyword search and no Google AI.',
            'eno AI gửi nội dung bạn nhập ở đây, cùng vài tin nhắn gần nhất của cuộc trò chuyện này, đến Google (Gemini) để hiểu bạn đang tìm gì, và gửi từ khóa tìm kiếm đến Google (Vertex AI Search) để tìm tin đăng. Để sau: eno AI vẫn trả lời, bằng tìm kiếm từ khóa đơn giản, không dùng Google AI.',
          ),
          declined: tr('eno AI will answer with a simple keyword search. You can turn Google AI on in Settings → Preferences.', 'eno AI sẽ trả lời bằng tìm kiếm từ khóa đơn giản. Bạn có thể bật Google AI trong Cài đặt → Tùy chọn.'),
          off: null, // works without AI — the page says so (messages/ai)
        }
      case 'listing': {
        const off = tr('AI help is off. Fill in the details yourself, or turn it on in Settings → Preferences.', 'Trợ giúp AI đang tắt. Bạn tự điền thông tin, hoặc bật lại trong Cài đặt → Tùy chọn.')
        return {
          title: tr('Use Google AI to help with your listing?', 'Dùng Google AI để hỗ trợ tin đăng?'),
          body: tr(
            '“Autofill from photo” sends your cover photo, and “Polish with AI” sends your description, to Google (Gemini) to suggest the details and tidy the wording. Nothing is sent until you tap one of them. Not now: you fill in the listing yourself; everything else works the same.',
            '“Tự điền từ ảnh” gửi ảnh bìa của bạn, và “Chỉnh bằng AI” gửi phần mô tả của bạn, đến Google (Gemini) để gợi ý thông tin và chỉnh câu chữ. Không có gì được gửi cho đến khi bạn nhấn một trong hai nút. Để sau: bạn tự điền tin đăng; mọi thứ khác vẫn như cũ.',
          ),
          declined: off,
          off,
        }
      }
      case 'photo_search': {
        const off = tr('Search by photo is off. Type what you are looking for, or turn it on in Settings → Preferences.', 'Tìm bằng ảnh đang tắt. Hãy gõ món bạn cần tìm, hoặc bật lại trong Cài đặt → Tùy chọn.')
        return {
          title: tr('Use Google AI to search by photo?', 'Dùng Google AI để tìm bằng ảnh?'),
          body: tr(
            'Search by photo sends the photo you choose to Google (Gemini) to recognise the item and turn it into a search. Not now: search by photo is unavailable; typing a search still works.',
            'Tìm bằng ảnh gửi ảnh bạn chọn đến Google (Gemini) để nhận diện món đồ và chuyển thành từ khóa tìm kiếm. Để sau: không dùng được tìm bằng ảnh; bạn vẫn có thể gõ để tìm.',
          ),
          declined: off,
          off,
        }
      }
      default:
        return undefined // trip: its words travel with the call (trip-cards.tsx) — they may not ship in eno.vn's build
    }
  }, [tr])

  useEffect(() => {
    registerAiConsentAsker((family, uid, copy) => new Promise<AiConsent>((resolve) => {
      if (uid !== accountRef.current) { resolve(null); return } // asked on behalf of an account that is not signed in here
      const words = copy ?? builtIn(family)
      // Nothing to show ⇒ nothing is sent. Say so (2026-10-06): the apps render eno.vn, whose build stubs the trip
      // family's words, so a partner trip's AI buttons would otherwise do nothing at all in the apps. The sentence
      // names no service, so it may ship on either edition.
      if (!words) { toast(tr('This AI feature isn’t available in the app.', 'Tính năng AI này không có trong ứng dụng.')); resolve(null); return }
      if (readAiConsent(family, uid) === 'off') {
        if (words.off) toast(words.off)
        resolve('off')
        return
      }
      const key = `${family}:${uid}`
      const w = waiting.current.get(key)
      if (w) { w.resolvers.push(resolve); return }
      waiting.current.set(key, { userId: uid, resolvers: [resolve] })
      setQueue((q) => [...q, { key, family, userId: uid, copy: words }])
    }))
    return () => registerAiConsentAsker(null)
  }, [builtIn, tr])

  // Unmounting with a question open answers "not now, nothing stored" — never a promise left hanging.
  useEffect(() => {
    const map = waiting.current
    return () => {
      for (const w of map.values()) for (const resolve of w.resolvers) resolve(null)
      map.clear()
    }
  }, [])

  const head = queue[0]
  const answer = (value: 'on' | 'off' | null) => {
    if (!head) return
    // Answered already — a second tap that landed before the re-render (opus, review: it stored the answer and toasted
    // "Not now" twice).
    const w = waiting.current.get(head.key)
    if (!w) return
    waiting.current.delete(head.key)
    // Belt and braces for the effect above: an answer is only ever stored for, and released to, the signed-in account.
    const current = head.userId === accountRef.current
    if (value && current) writeAiConsent(head.family, head.userId, value)
    if (value === 'off' && current) toast(head.copy.declined)
    for (const resolve of w.resolvers) resolve(current ? value : null)
    setQueue((q) => q.filter((p) => p.key !== head.key))
  }

  return (
    <AlertDialog open={!!head} onOpenChange={(open) => { if (!open) answer(null) }}>
      {head && (
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{head.copy.title}</AlertDialogTitle>
            {/* ONE Description (it is what aria-describedby points at), holding both sentences. */}
            <AlertDialogDescription render={<div />} className="space-y-2">
              <p>{head.copy.body}</p>
              <p>{tr('Your answer is kept in this app on this device. You can change it any time in Settings → Preferences.', 'Lựa chọn của bạn được lưu trong ứng dụng này trên thiết bị này. Bạn có thể thay đổi bất cứ lúc nào trong Cài đặt → Tùy chọn.')}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => answer('off')}>{tr('Not now', 'Để sau')}</Button>
            <Button variant="outline" onClick={() => answer('on')}>{tr('Allow', 'Cho phép')}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
