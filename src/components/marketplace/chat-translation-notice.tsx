'use client'

import { toast } from 'sonner'
import { Languages } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/**
 * THE ONE-TIME CHAT TRANSLATION NOTICE — App Store gate `app-ai-notice` (plan R8, Guideline 5.1.2(i),
 * decision D14; src/lib/chat-translation-consent.ts). Rendered by the thread page in place of the
 * "Translate messages" strip, and only while `useChatTranslation().needsNotice` — the gate is on, this
 * is either native app, a translation would apply in this thread, and the person has not answered yet.
 * Until they do, the hook sends nothing to the translation endpoint.
 *
 * ⚠️ INLINE, NOT A DIALOG. The composer owns focus on this page (the keyboard stays up while you type —
 * see ChatSendButton's note in the thread page), and a modal opening on arrival would steal it; reading
 * and replying need no answer, only translating does.
 * ⚠️ BOTH ANSWERS CARRY EQUAL WEIGHT (two outline buttons, as the cookie banner does): this is a
 * permission request, and a primary-coloured OK beside a ghost "off" would be a nudge.
 * ⚠️ NAMES THE PROVIDER. "Microsoft (Azure AI Translator)" is the paid provider chat asks first
 * (src/lib/translate.ts); the same name is on /privacy's recipients table. Change all three together.
 * ⚠️ AND SAYS WHAT THE ANSWER COVERS, both ways round (codex + opus, review of this change): it is ONE answer for every
 * chat IN THIS APP (this account on this device — the web and another phone do not know it), and it governs the requests
 * THIS person's app makes — the messages they receive.
 * What they send is translated, or not, by the other person's own setting; nothing on the server knows this answer
 * (src/lib/chat-translation-consent.ts says why), so the sentence must not promise more.
 */
export function ChatTranslationNotice({ onAnswer }: { onAnswer: (value: 'on' | 'off') => void }) {
  const { tr } = useLanguage()
  const turnOff = () => {
    onAnswer('off')
    toast(tr('Chat translation is off. You can turn it back on in Settings → Preferences.', 'Đã tắt dịch tin nhắn. Bạn có thể bật lại trong Cài đặt → Tùy chọn.'))
  }
  return (
    <section aria-labelledby="chat-tr-notice-title" className="border-t border-border bg-background px-4 py-3">
      {/* A <p>, not a heading: the thread page has no heading outline for this to slot into; the
          section is still named by it (aria-labelledby). */}
      <p id="chat-tr-notice-title" className="flex items-center gap-2 text-xs font-bold text-foreground">
        <Languages className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
        {tr('Chat translation', 'Dịch tin nhắn')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr(
          'To translate your chats, messages are sent to Microsoft (Azure AI Translator). Your answer applies to all your chats in this app: turning it off stops this for the messages you receive; the other person decides for the messages you send them. You can change it any time in Settings → Preferences.',
          'Để dịch các cuộc trò chuyện của bạn, tin nhắn được gửi đến Microsoft (Azure AI Translator). Lựa chọn của bạn áp dụng cho mọi cuộc trò chuyện trong ứng dụng này: tắt dịch sẽ ngừng việc này đối với tin nhắn bạn nhận; với tin nhắn bạn gửi, người kia tự quyết định. Bạn có thể thay đổi bất cứ lúc nào trong Cài đặt → Tùy chọn.',
        )}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={turnOff}>
          {tr('Turn off translation', 'Tắt dịch tin nhắn')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAnswer('on')}>
          {tr('OK', 'Đồng ý')}
        </Button>
      </div>
    </section>
  )
}
