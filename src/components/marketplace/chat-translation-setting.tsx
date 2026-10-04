'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import {
  chatTranslationAskFirst,
  readChatTranslationConsent,
  writeChatTranslationConsent,
  type ChatTranslationConsent,
} from '@/lib/chat-translation-consent'

/**
 * Settings → Preferences: CHAT TRANSLATION ON/OFF — the way back after "Turn off translation" in the
 * one-time chat notice. App Store gate `app-ai-notice` (plan R8, Guideline 5.1.2(i), D14); see
 * src/lib/chat-translation-consent.ts for why the answer lives on the device.
 *
 * Renders NOTHING unless the gate is on AND this is either native app — off, Settings is unchanged on
 * the web and in both apps. The platform is only known on the client, so the row waits for mount
 * (no server/client markup disagreement); Preferences is a client tab behind sign-in anyway.
 *
 * ⚠️ ON MEANS PERMISSION GIVEN, NOTHING ELSE (codex, review of this change: an "on" switch before anyone was asked
 * claimed a consent that did not exist, and the first tap turned it OFF). Not asked yet shows OFF with a line saying
 * the chat will ask; switching it on HERE is the permission — the description says where the text goes, as the
 * notice does.
 */
export function ChatTranslationSetting() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const mounted = useMounted()
  const userId = user?.id
  const [consent, setConsent] = useState<ChatTranslationConsent>(null)
  const [readFor, setReadFor] = useState<string | null>(null)
  // Read once per account after mount — the "adjust state during render" pattern the chat hook uses.
  if (mounted && userId && readFor !== userId) {
    setReadFor(userId)
    setConsent(readChatTranslationConsent(userId))
  }
  if (!mounted || !userId || !chatTranslationAskFirst()) return null

  const label = tr('Translate chat messages', 'Dịch tin nhắn trò chuyện')
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{tr('Chat translation', 'Dịch tin nhắn')}</h2>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tr(
              'When the other person writes in another language, their messages are sent to Microsoft (Azure AI Translator) to show them in yours. Turned off, this app sends nothing to translate for you; whether your messages are translated for the other person is their choice.',
              'Khi người kia viết bằng ngôn ngữ khác, tin nhắn của họ được gửi đến Microsoft (Azure AI Translator) để hiển thị bằng ngôn ngữ của bạn. Khi tắt, ứng dụng này không gửi gì đi để dịch cho bạn; việc tin nhắn của bạn có được dịch cho người kia hay không là do họ chọn.',
            )}
          </p>
          {consent === null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {tr('Not set yet — a chat will ask you the first time it could be translated.', 'Chưa chọn — cuộc trò chuyện sẽ hỏi bạn vào lần đầu tiên có thể dịch.')}
            </p>
          )}
        </div>
        <Switch
          checked={consent === 'on'}
          onChange={(next) => {
            const value = next ? 'on' : 'off'
            setConsent(value)
            writeChatTranslationConsent(userId, value)
          }}
          label={label}
          size="md"
          className="mt-0.5"
        />
      </div>
    </section>
  )
}
