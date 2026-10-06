'use client'

import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { aiConsentAskFirst } from '@/lib/ai-consent'
import { AiFamilySwitchRow } from '@/components/marketplace/ai-family-switch-row'
import { TripAiSetting } from '@/components/marketplace/trip-ai-consent'
import { VisaPhotoCheckAiSetting } from '@/components/marketplace/visa-ai-consent'

/**
 * Settings → Preferences → GOOGLE AI — one switch per feature family, beside Chat translation. App Store gate
 * `app-ai-notice` (Guideline 5.1.2(i)); what each family sends and what "off" leaves working is in src/lib/ai-consent.ts,
 * and why the answers live on the device is in src/lib/chat-translation-consent.ts.
 *
 * Renders NOTHING unless the gate is on AND this is either native app — off, Settings is unchanged on the web and in both
 * apps. The platform is only known on the client, so the section waits for mount (Preferences is a client tab behind
 * sign-in anyway). The trip row comes from trip-ai-consent.tsx, which eno.vn's build replaces with a stub that renders
 * nothing (eno.vn may not mention a trip service).
 */
export function AiFeaturesSetting() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const mounted = useMounted()
  if (!mounted || !user || !aiConsentAskFirst()) return null
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{tr('Google AI', 'Google AI')}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr(
          'These features send what you type, or the photo you choose, to Google. Each one asks you the first time; you can change your answer here.',
          'Các tính năng này gửi nội dung bạn nhập, hoặc ảnh bạn chọn, đến Google. Mỗi tính năng sẽ hỏi bạn ở lần đầu; bạn có thể đổi lựa chọn tại đây.',
        )}
      </p>
      <div className="mt-3 space-y-4">
        <AiFamilySwitchRow
          family="assistant"
          label={tr('eno AI assistant', 'Trợ lý eno AI')}
          description={tr(
            'What you type to eno AI, with the last few messages of that chat, goes to Google (Gemini), and your search words to Google (Vertex AI Search). Off: eno AI answers with a simple keyword search.',
            'Nội dung bạn nhập cho eno AI, cùng vài tin nhắn gần nhất của cuộc trò chuyện đó, được gửi đến Google (Gemini), và từ khóa tìm kiếm được gửi đến Google (Vertex AI Search). Khi tắt: eno AI trả lời bằng tìm kiếm từ khóa đơn giản.',
          )}
        />
        <AiFamilySwitchRow
          family="listing"
          label={tr('AI help when posting', 'Trợ giúp AI khi đăng tin')}
          description={tr(
            '“Autofill from photo” sends your cover photo, and “Polish with AI” your description, to Google (Gemini). Off: these two buttons are unavailable.',
            '“Tự điền từ ảnh” gửi ảnh bìa, và “Chỉnh bằng AI” gửi phần mô tả của bạn, đến Google (Gemini). Khi tắt: không dùng được hai nút này.',
          )}
        />
        <AiFamilySwitchRow
          family="photo_search"
          label={tr('Search by photo', 'Tìm bằng ảnh')}
          description={tr(
            'The photo you choose is sent to Google (Gemini) to recognise the item. Off: search by photo is unavailable; typing a search still works.',
            'Ảnh bạn chọn được gửi đến Google (Gemini) để nhận diện món đồ. Khi tắt: không dùng được tìm bằng ảnh; bạn vẫn có thể gõ để tìm.',
          )}
        />
        <TripAiSetting />
        <VisaPhotoCheckAiSetting />
      </div>
    </section>
  )
}
