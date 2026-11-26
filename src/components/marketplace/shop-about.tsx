import { Bilingual } from '@/components/marketplace/bilingual'
import { cn } from '@/lib/utils'
import type { StorefrontIntro } from '@/lib/storefront-intro'
import { ReportNote } from '@/components/marketplace/grid-about'

/**
 * ⛔ "ABOUT <SHOP>" UNDER THE SHOP'S OWN GRID (owner, 2026-11-26: "Add below the cards"). Two short paragraphs of the shop's own
 * facts and how a deal works here, off the first screen: the shop's one-line intro moved down into it (it sat under the header,
 * 2026-11-25). Both storefront bodies draw it — seller-storefront.tsx (eno.vn/<handle>, /sellers/<id>) and s/[handle]/page.tsx
 * (<handle>.eno.vn) — right after the shop's grid, before "More from other sellers".
 *
 * WHY THREE PARAGRAPHS OF 20+ WORDS (the third, ReportNote, since the short footer took the registration line off every page
 * but home — grid-about.tsx): Seobility's "Pages with only a few paragraphs" (crawl 10: 181 shop pages, the heaviest Content
 * check) wants three blocks of about 20 words or more, and the footer's registration line is the only one a shop page had; a block
 * under ~20 words (the 9-word intro) is not counted. So each paragraph here is 20+ words in both languages for any shop name.
 * Nothing invented: the count and categories are the grid's own ("including": the most common among the rows the page loaded).
 * ⚠️ The second paragraph claims nothing a shop may not do or be: no chat (affiliate-only shops have none), no price or payment
 * (job posts, teacher profiles), and not that the shop posted each row or agreed to the posting rules (imported and linked rows
 * were not posted here — commit gate 2026-11-26) — only that the offer and its terms are the shop's, and the deal is with it.
 * The sentences are literals so the string harvest (gen-ui-strings) and the curated Vietnamese see them; both languages use one
 * placeholder set, each with its own values (`valuesVi`: a pair whose placeholders differ falls back to the English).
 */
export function ShopAbout({ intro, className }: { intro: StorefrontIntro; className?: string }) {
  const { values, valuesVi } = intro
  return (
    <section aria-labelledby="shop-about" className={cn('max-w-2xl space-y-2', className)}>
      <h2 id="shop-about" className="text-base font-semibold text-foreground">
        <Bilingual en="About {name}" vi="Về {name}" values={values} valuesVi={valuesVi} />
      </h2>
      <p className="text-sm text-body">
        {intro.withCats ? (intro.one
          ? <Bilingual en="{name} has 1 listing on {site}, in {cats}. It opens its own page with all its details, so you can read everything before you ask." vi="{name} có 1 tin đăng trên {site}, trong mục {cats}. Tin này mở ra trang riêng với đầy đủ thông tin, để bạn đọc hết trước khi hỏi." values={values} valuesVi={valuesVi} />
          : <Bilingual en="{name} has {n} listings on {site}, including {cats}. Each one opens its own page with all its details, so you can read everything before you ask." vi="{name} có {n} tin đăng trên {site}, gồm cả mục {cats}. Mỗi tin mở ra trang riêng với đầy đủ thông tin, để bạn đọc hết trước khi hỏi." values={values} valuesVi={valuesVi} />
        ) : (intro.one
          ? <Bilingual en="{name} has 1 listing on {site}. It opens its own page with all its details, so you can read everything before you ask." vi="{name} có 1 tin đăng trên {site}. Tin này mở ra trang riêng với đầy đủ thông tin, để bạn đọc hết trước khi hỏi." values={values} valuesVi={valuesVi} />
          : <Bilingual en="{name} has {n} listings on {site}. Each one opens its own page with all its details, so you can read everything before you ask." vi="{name} có {n} tin đăng trên {site}. Mỗi tin mở ra trang riêng với đầy đủ thông tin, để bạn đọc hết trước khi hỏi." values={values} valuesVi={valuesVi} />
        )}
      </p>
      <p className="text-sm text-body">
        <Bilingual
          en="What each listing offers, and on what terms, is up to {name}: ask them about anything its page does not answer. Any deal is made directly between you and {name}."
          vi="Nội dung và điều kiện của từng tin do {name} quyết định: hãy hỏi họ về những gì trang tin chưa trả lời. Mọi giao dịch là trực tiếp giữa bạn và {name}."
          values={values}
          valuesVi={valuesVi}
        />
      </p>
      <ReportNote className="text-sm text-body" />
    </section>
  )
}
