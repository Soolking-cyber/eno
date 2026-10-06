'use client'

import { useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import type { AiConsentCopy } from '@/lib/ai-consent'
import { AiFamilySwitchRow } from '@/components/marketplace/ai-family-switch-row'

/**
 * The `document_check` family's words for the Google AI notice and its Settings row — App Store gate `app-ai-notice`
 * (src/lib/ai-consent.ts): the e-Visa photo check (passport data page + portrait → Gemini, POST
 * /api/visa/applications/[id]/extract). Owner, 2026-10-06: the e-Visa flow is in both apps, so this check is reachable
 * from them, and Guideline 5.1.2(i) wants the question before the photos go to Google.
 *
 * ⛔ ITS OWN MODULE, LIKE trip-ai-consent.tsx: the words name a passport, so next.config.ts aliases this file to
 * visa-ai-consent.stub.tsx on a marketplace build WITHOUT MARKETPLACE_HOSTS_SERVICES. eno.vn builds with the flag, so
 * this is the real module there. With no words (the stub) the notice answers "no" and nothing reaches Google.
 */
export function useVisaPhotoCheckAiCopy(): AiConsentCopy | undefined {
  const { tr } = useLanguage()
  return useMemo(() => {
    const off = tr(
      'The automatic photo check is off, so your photos go to the seller unchecked and the seller checks them by hand. You can turn it on in Settings → Preferences.',
      'Kiểm tra ảnh tự động đang tắt, nên ảnh của bạn được gửi cho người bán mà chưa kiểm tra và người bán sẽ tự kiểm tra. Bạn có thể bật lại trong Cài đặt → Tùy chọn.',
    )
    return {
      title: tr('Use Google AI to check your photos?', 'Dùng Google AI để kiểm tra ảnh của bạn?'),
      body: tr(
        'Before your passport photo and portrait go to the seller, we can check them against the e-Visa photo rules: both images are sent to Google (Gemini), which also reads the details printed on the passport page. Not now: the photos are saved and sent to the seller unchecked, and the seller checks them by hand.',
        'Trước khi ảnh hộ chiếu và ảnh chân dung được gửi cho người bán, chúng tôi có thể kiểm tra theo yêu cầu ảnh e-Visa: cả hai ảnh được gửi đến Google (Gemini), đồng thời Google đọc các thông tin in trên trang hộ chiếu. Để sau: ảnh vẫn được lưu và gửi cho người bán mà chưa kiểm tra, người bán sẽ tự kiểm tra.',
      ),
      declined: off,
      off,
    }
  }, [tr])
}

/** Settings → Preferences → Google AI: the e-Visa photo-check row (rendered inside AiFeaturesSetting, which owns the gate check). */
export function VisaPhotoCheckAiSetting() {
  const { tr } = useLanguage()
  return (
    <AiFamilySwitchRow
      family="document_check"
      label={tr('e-Visa photo check', 'Kiểm tra ảnh e-Visa')}
      description={tr(
        'Your passport photo and portrait are sent to Google (Gemini) to check them against the e-Visa photo rules and read the passport details. Off: they go to the seller unchecked.',
        'Ảnh hộ chiếu và ảnh chân dung của bạn được gửi đến Google (Gemini) để kiểm tra theo yêu cầu ảnh e-Visa và đọc thông tin hộ chiếu. Khi tắt: ảnh được gửi cho người bán mà chưa kiểm tra.',
      )}
    />
  )
}
