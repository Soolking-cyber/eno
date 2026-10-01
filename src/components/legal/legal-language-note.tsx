import { Bilingual } from '@/components/marketplace/bilingual'
import { LEGAL_VI_APPROVED } from '@/lib/site-legal'
import { cn } from '@/lib/utils'

/**
 * WHICH LANGUAGE OF A LEGAL PAGE GOVERNS — one line under the title of /privacy, /terms, /returns and
 * /prohibited, so the four pages can never say four different things about it. Read from
 * LEGAL_VI_APPROVED (src/lib/site-legal.ts).
 *
 * ⛔ WHILE `LEGAL_VI_APPROVED` IS FALSE IT DECLARES NO PREVAILING LANGUAGE AT ALL. Those pages carry a
 * curated Vietnamese body that counsel has not signed off. Declaring the English authoritative would
 * contradict Law 122/2025's requirement that the terms exist in Vietnamese; declaring an unreviewed
 * Vietnamese authoritative would make any translation error the contract. So until counsel signs, the
 * line says the Vietnamese is eno's translation under review and that neither version prevails.
 * ⚠️ WHEN THE FLAG FLIPS it says the Vietnamese is the legally binding text — the same rule the Quy
 * chế (/regulations) states for itself. Do not add a sentence here naming the English as
 * authoritative; that was removed from /privacy on purpose.
 *
 * A server component: the words reach the HTML in the reader's language through <Bilingual> (tr with
 * an authored Vietnamese), never through machine translation.
 */
export function LegalLanguageNote({ className }: { className?: string }) {
  return (
    <p className={cn('mt-2 max-w-[70ch] text-xs text-muted-foreground italic', className)}>
      {LEGAL_VI_APPROVED ? (
        <Bilingual en="The Vietnamese text is the authoritative one." vi="Bản tiếng Việt là bản có giá trị pháp lý." />
      ) : (
        <Bilingual
          en="The Vietnamese text of this page is a translation prepared by eno that our lawyers are still reviewing. Until they sign it off, neither language version prevails over the other."
          vi="Bản tiếng Việt của trang này là bản dịch do eno biên soạn và đang được luật sư rà soát. Cho đến khi việc rà soát hoàn tất, chưa có bản ngôn ngữ nào được xác định là có giá trị ưu tiên."
        />
      )}
    </p>
  )
}
