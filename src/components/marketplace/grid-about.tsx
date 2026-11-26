import { Bilingual } from '@/components/marketplace/bilingual'

/**
 * ⛔ THE CATEGORY AND DISTRICT PAGES' WORDS UNDER THE GRID (owner, 2026-11-26: "Add below the cards"). Seobility's "Pages with
 * only a few paragraphs" (crawl 10: 68 /c pages) counts a paragraph at ~20+ words and wants three; these pages had the footer's
 * one and a lede of 10–16 words. So the lede gains one sentence (`GridLedeTail`, inside its own <p>: 20+ words alone, whatever
 * the lede says) and a paragraph on how a deal works follows (`GridDealsNote`, 20+ words). Shops have theirs in shop-about.tsx,
 * model price pages in model-price-page.tsx.
 * ⚠️ Worded for every category but teachers (profiles, not listings — the callers skip it): "whoever posted it", never "the seller"
 * (jobs); no claim about chat or payment (linked listings open their source site), nor that a poster agreed to eno's rules (an
 * imported row's poster never did — commit gate 2026-11-26).
 */
export function GridLedeTail() {
  return (
    <Bilingual
      en="Each listing opens its own page with all the details it carries, and new listings are added here as they are posted."
      vi="Mỗi tin mở ra trang riêng với đầy đủ thông tin của tin, và khi có tin mới, tin sẽ được thêm vào đây."
    />
  )
}

export function GridDealsNote({ className }: { className?: string }) {
  return (
    <p className={className}>
      <Bilingual
        en="What each listing offers, and on what terms, is up to whoever posted it: ask them about anything its page does not answer. Any deal is made directly between you and them."
        vi="Nội dung và điều kiện của từng tin do người đăng quyết định: hãy hỏi họ về những gì trang tin chưa trả lời. Mọi giao dịch là trực tiếp giữa bạn và người đăng."
      />
    </p>
  )
}
