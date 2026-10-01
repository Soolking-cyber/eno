import { Bilingual } from '@/components/marketplace/bilingual'
import { LEGAL_VI_APPROVED } from '@/lib/site-legal'
import { cn } from '@/lib/utils'

/**
 * WHICH LANGUAGE OF A LEGAL PAGE GOVERNS — one line under the title of /privacy, /terms, /returns and
 * /prohibited, so the four pages can never say four different things about it.
 *
 * ⛔ WHILE `LEGAL_VI_APPROVED` IS FALSE IT DECLARES NO PREVAILING LANGUAGE AT ALL. Those pages now
 * carry a curated Vietnamese body that counsel has not signed off (src/lib/site-legal.ts). Declaring
 * the English authoritative would contradict Law 122/2025's requirement that the terms exist in
 * Vietnamese; declaring an unreviewed Vietnamese authoritative would make any translation error the
 * contract. So until counsel signs, the line only says the Vietnamese is under review.
 * ⚠️ WHEN THE FLAG FLIPS it says the Vietnamese is the legally binding text — the same rule the Quy
 * chế (/regulations) states for itself. Do not add a sentence here naming the English as
 * authoritative; that was removed from /privacy on purpose.
 *
 * A server component: the words reach the HTML in the reader's language through <Bilingual> (tr with
 * an authored Vietnamese), never through machine translation.
 */
export function LegalLanguageNote({ className }: { className?: string }) {
  return (
    <p className={cn('mt-2 max-w-[70ch] text-xs text-muted-foreground', className)}>
      {LEGAL_VI_APPROVED ? (
        <Bilingual en="The Vietnamese text is the legally binding version." vi="Bản tiếng Việt là bản có giá trị pháp lý." />
      ) : (
        <Bilingual en="The Vietnamese text is under review by counsel." vi="Bản tiếng Việt đang được luật sư rà soát." />
      )}
    </p>
  )
}
