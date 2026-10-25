'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Check, Copy, Share2 } from '@/components/ui/icons'
import { copyText } from '@/lib/copy-text'
import { classroomAddress } from '@/lib/classroom/host'

/**
 * A seat's invite: the link on the classroom's own address (classroom.<base>/join/<code> — it 302s into the app), a copy
 * button, the phone's share sheet (Zalo, Messenger, SMS — whatever the parent uses) and a QR code for a printed sheet or
 * a screen in class.
 */
export function InviteShare({ seatId, code, seatName }: { seatId: string; code: string; seatName: string }) {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState(false)
  const link = `${classroomAddress()}/join/${code}`
  // The QR is drawn on the SERVER (qr-svg.ts is server-only — importing it here failed the build: found by the 390px UI
  // check) and shown as a same-origin image; the code in the query re-draws it after a re-invite.
  const qr = `/api/classroom/seats/${encodeURIComponent(seatId)}/qr?c=${encodeURIComponent(code)}`
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const message = tr(
    'Practise English at home with my AI avatar. Open this link to join:',
    'Luyện nói tiếng Anh tại nhà với avatar AI của tôi. Mở link này để tham gia:',
  )
  return (
    <div className="flex flex-col items-center gap-4">
      {/* A plain <img>: a same-origin SVG from our own route, which next/image would add nothing to. */}
      <img src={qr} alt={tr('Invite QR code', 'Mã QR mời')} width={176} height={176} className="size-44 rounded-2xl bg-white p-3" />
      <p className="text-center text-sm font-semibold text-ink">{seatName}</p>
      <p className="w-full break-all rounded-xl bg-tint px-4 py-3 text-center text-sm text-ink-2" translate="no">{link}</p>
      <div className="flex w-full gap-3">
        <Button variant="outline" className="flex-1" onClick={async () => setCopied(await copyText(link))}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? tr('Copied', 'Đã chép') : tr('Copy link', 'Chép link')}
        </Button>
        {/* The link in the text AND as the url: some share targets keep only one of the two, and a link shown twice is
            cosmetic where a lost one breaks the only way to join (C3c reviews argued both ways). */}
        {canShare && (
          <Button variant="cta" className="flex-1" onClick={() => navigator.share({ text: `${message} ${link}`, url: link }).catch(() => {})}>
            <Share2 aria-hidden />
            {tr('Share', 'Chia sẻ')}
          </Button>
        )}
      </div>
    </div>
  )
}
