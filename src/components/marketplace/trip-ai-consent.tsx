'use client'

import { useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import type { AiConsentCopy } from '@/lib/ai-consent'
import { AiFamilySwitchRow } from '@/components/marketplace/ai-family-switch-row'

/**
 * The TRIP family's words for the Google AI notice and its Settings row — App Store gate `app-ai-notice`, the `trip`
 * family in src/lib/ai-consent.ts ("Build my plan", stay and stop suggestions, the trip chat's Eno concierge).
 *
 * ⛔ A MODULE OF ITS OWN BECAUSE eno.vn MAY NOT EVEN MENTION A TRIP SERVICE. next.config.ts aliases this file to
 * trip-ai-consent.stub.tsx on a marketplace build and scripts/gen-ui-strings.mjs files its strings as services-only — a
 * gate decides what renders, an alias decides what ships. The shared notice (ai-consent-host.tsx) therefore has no trip
 * words of its own: each trip call site passes these with its question, and on eno.vn the stub passes nothing, which the
 * host answers with "no" (nothing is sent).
 */
export function useTripAiConsentCopy(): AiConsentCopy | undefined {
  const { tr } = useLanguage()
  return useMemo(() => {
    const off = tr(
      'Trip AI is off. A person from the desk can still help you in the trip chat, or turn it on in Settings → Preferences.',
      'AI cho chuyến đi đang tắt. Nhân viên vẫn có thể hỗ trợ bạn trong cuộc trò chuyện về chuyến đi, hoặc bật lại trong Cài đặt → Tùy chọn.',
    )
    return {
      title: tr('Use Google AI to plan your trip?', 'Dùng Google AI để lên lịch trình?'),
      body: tr(
        'To draft your trip plan, suggest stays and stops, or answer your questions in the trip chat, your trip details (cities, dates, who is travelling, budget, interests and notes) and your questions are sent to Google (Gemini). Nothing is sent until you use one of these. Not now: they are unavailable — a person from the desk can still help you in the trip chat.',
        'Để soạn lịch trình, gợi ý chỗ ở và điểm dừng, hoặc trả lời câu hỏi của bạn trong cuộc trò chuyện về chuyến đi, thông tin chuyến đi (thành phố, ngày đi, người đi cùng, ngân sách, sở thích và ghi chú) và câu hỏi của bạn được gửi đến Google (Gemini). Không có gì được gửi cho đến khi bạn dùng một trong các tính năng này. Để sau: các tính năng này không dùng được — nhân viên vẫn có thể hỗ trợ bạn trong cuộc trò chuyện về chuyến đi.',
      ),
      declined: off,
      off,
    }
  }, [tr])
}

/** Settings → Preferences → Google AI: the trip row (rendered inside AiFeaturesSetting, which owns the gate check). */
export function TripAiSetting() {
  const { tr } = useLanguage()
  return (
    <AiFamilySwitchRow
      family="trip"
      label={tr('Trip planning', 'Lên lịch trình')}
      description={tr(
        'Your trip details and questions are sent to Google (Gemini) to draft plans, suggest stays and stops, and answer in the trip chat. Off: these are unavailable; a person from the desk can still help.',
        'Thông tin chuyến đi và câu hỏi của bạn được gửi đến Google (Gemini) để soạn lịch trình, gợi ý chỗ ở và điểm dừng, và trả lời trong cuộc trò chuyện về chuyến đi. Khi tắt: các tính năng này không dùng được; nhân viên vẫn có thể hỗ trợ.',
      )}
    />
  )
}
