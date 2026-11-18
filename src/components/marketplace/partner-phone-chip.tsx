'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Phone } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { phoneShareText, typedPhone } from '@/lib/partner-welcome-line'

/**
 * The answer to a partner shop's welcome (src/lib/partner-welcome.ts), on the CUSTOMER's side only, under the newest welcome,
 * until a number of theirs is in the thread (the thread page decides). One send per chip: it hides itself on the tap, so a
 * double tap never sends the number twice; a send that fails is retried from its failed bubble, like any message.
 *
 * · A number on the account (Profile.phone — only ever a VERIFIED one, from phone sign-in) → one tap sends it.
 * · No number → one tap opens a field, Send sends what they typed. ⛔ It is NOT saved to the account: Profile.phone is
 *   verified-only and storefront claims match on it, and the app has no add-a-phone flow.
 * Either way it is an ordinary chat message through the thread's own send (`onSend`) — the same route, guards and
 * idempotency as typing it — so the shop's admins read it with the usual Zalo / WhatsApp chips.
 */
export function PartnerPhoneChip({ myPhone, onSend }: { myPhone: string | null; onSend: (text: string) => void }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  // One send per chip: a second tap before the thread shows the first bubble would send the number twice (gate review).
  const [sent, setSent] = useState(false)
  const sendOnce = (text: string) => { if (sent) return; setSent(true); onSend(text) }

  if (sent) return null
  if (myPhone) {
    return (
      <div className="mt-1 flex items-center gap-2 px-1">
        <Button size="sm" variant="cta" onClick={() => sendOnce(phoneShareText(myPhone))}>
          <Phone className="h-4 w-4" /> {tr('Send my number', 'Gửi số của tôi')} <span dir="ltr">{myPhone}</span>
        </Button>
      </div>
    )
  }
  if (!open) {
    return (
      <div className="mt-1 flex items-center gap-2 px-1">
        <Button size="sm" variant="cta" onClick={() => setOpen(true)}>
          <Phone className="h-4 w-4" /> {tr('Add my number', 'Thêm số của tôi')}
        </Button>
      </div>
    )
  }
  const submit = () => {
    const phone = typedPhone(value)
    if (!phone) { setInvalid(true); return }
    sendOnce(phoneShareText(phone))
  }
  return (
    <form className="mt-1 flex items-center gap-2 px-1" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        enterKeyHint="send"
        aria-label={tr('Your phone number', 'Số điện thoại của bạn')}
        aria-invalid={invalid || undefined}
        placeholder="090 123 4567"
        value={value}
        onChange={(e) => { setValue(e.target.value); setInvalid(false) }}
        className="h-8 max-w-48"
      />
      <Button size="sm" variant="cta" type="submit">{tr('Send', 'Gửi')}</Button>
      {invalid && <span role="alert" className="text-t-meta text-destructive">{tr('Check the number', 'Kiểm tra lại số')}</span>}
    </form>
  )
}
