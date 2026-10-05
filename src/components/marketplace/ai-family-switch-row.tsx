'use client'

import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useAiConsent } from '@/hooks/use-ai-consent'
import { writeAiConsent, type AiFamily } from '@/lib/ai-consent'

/**
 * One Google AI family's switch in Settings → Preferences (App Store gate `app-ai-notice`, src/lib/ai-consent.ts) — the
 * way to change the one-time notice's answer. Rendered only inside AiFeaturesSetting, which shows nothing unless the gate
 * is on in either app.
 * ⚠️ ON MEANS PERMISSION GIVEN, NOTHING ELSE — the chat-translation row's rule (codex, review of that change): not asked
 * yet shows OFF with a line saying the feature will ask, and switching it on HERE is the permission, so the description
 * says who receives what, as the notice does.
 */
export function AiFamilySwitchRow({ family, label, description }: { family: AiFamily; label: string; description: string }) {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const { consent } = useAiConsent(family)
  const userId = user?.id
  if (!userId) return null
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        {consent === null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {tr('Not set yet — you will be asked the first time you use it.', 'Chưa chọn — bạn sẽ được hỏi ở lần đầu sử dụng.')}
          </p>
        )}
      </div>
      <Switch
        checked={consent === 'on'}
        onChange={(next) => writeAiConsent(family, userId, next ? 'on' : 'off')}
        label={label}
        size="md"
        className="mt-0.5"
      />
    </div>
  )
}
