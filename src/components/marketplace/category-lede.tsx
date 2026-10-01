'use client'

import { Tr, useLanguage } from '@/context/language-context'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { Bilingual } from './bilingual'
import { formatCountFull, joinList } from '@/app/[lang]/c/[category]/category-copy'

/**
 * The category page's lede, per language: what the category holds, then where it comes from.
 *
 * ⚠️ THE COUNT SENTENCE OPENS IT (C1-LEDE, 2026-09-29): "63,730 listings in Electronics, including
 * Phones (…), Laptops (…) and TVs (…)." For a linked tier the lede used to BE the provenance sentence,
 * with the count trailing it as a raw "63730 listings available." — ungrouped, and the reader learned
 * where the stock came from before what it was. Every number is a live count (`total`, and the
 * busiest subcategories from loadTopSubcategories), so it claims only what the counts support.
 *
 * ⛔ A CLIENT COMPONENT SO IT CANNOT END UP IN THE OTHER LANGUAGE FROM THE REST OF THE PAGE. The
 * Vietnamese sentence cannot be built from the three `<Tr>` fragments the English one uses — "Every"
 * + name + rest has no Vietnamese word order — so it is written out whole. As server text it could not
 * follow a client-side language change, which happens whenever a visitor's choice cannot be persisted
 * (cookies blocked): English labels around a Vietnamese sentence (a reviewer's catch). Reading the
 * language from context instead means the sentence always matches the page.
 *
 * ⚠️ THE ENGLISH BRANCH KEEPS THE FRAGMENTS, because the nine machine-translated languages render from
 * the English variant and their dictionaries are keyed on those exact strings.
 */
export function CategoryLede({
  name,
  nameVi,
  slug,
  linked = 'none',
  total = 0,
  top = [],
}: {
  name: string
  nameVi: string
  slug?: string
  /** How much of the category links out (c/[category]/category-copy.ts `linkedTier`); default: none. */
  linked?: 'all' | 'most' | 'some' | 'none'
  /** The category's live count; 0 (an empty category) prints no count sentence at all. */
  total?: number
  /** Its busiest subcategories, busiest first (category-data.ts `loadTopSubcategories`). */
  top?: { name: string; nameVi: string; count: number }[]
}) {
  return (
    <>
      {total > 0 && (
        <>
          <CountSentence name={name} nameVi={nameVi} total={total} top={top} />{' '}
        </>
      )}
      <Provenance name={name} nameVi={nameVi} slug={slug} linked={linked} />
    </>
  )
}

/**
 * "63,730 listings in Electronics, including Phones (41,002), Laptops (9,114) and TVs (3,508)." /
 * "63.730 tin đăng điện tử, gồm Điện thoại (41.002), Laptop (9.114) và Tivi (3.508)."
 * ⚠️ ENGLISH IN LITERAL `tr()` FRAGMENTS, VIETNAMESE WHOLE — category-text.tsx's rule: the nine
 * machine-translated languages render from the English variant, and Vietnamese word order is not
 * English's. Singular at exactly 1. "0 listings" is never printed (the caller passes no sentence).
 */
function CountSentence({ name, nameVi, total, top }: { name: string; nameVi: string; total: number; top: { name: string; nameVi: string; count: number }[] }) {
  const { lang, tr } = useLanguage()
  const n = (v: number) => formatCountFull(v, lang)
  if (lang === 'vi') {
    const parts = top.map((t) => `${t.nameVi} (${n(t.count)})`)
    // The category lower-cased mid-sentence, as the trust sentence below and districtMetadata write it
    // ("tin đăng điện tử"); the subcategories keep their label case (acronyms: "SIM", "TV").
    return <>{`${n(total)} tin đăng ${nameVi.toLowerCase()}${parts.length ? `, gồm ${joinList(parts, 'vi')}` : ''}.`}</>
  }
  return (
    <>
      {n(total)} {total === 1 ? tr('listing in') : tr('listings in')} <Bilingual en={name} vi={nameVi || name} />
      {top.length > 0 && (
        <>
          , {tr('including')}{' '}
          {top.map((t, i) => (
            <span key={t.name}>
              {i > 0 && (i === top.length - 1 ? <> {tr('and')} </> : <>, </>)}
              <Bilingual en={t.name} vi={t.nameVi || t.name} /> ({n(t.count)})
            </span>
          ))}
        </>
      )}
      .
    </>
  )
}

/** The second sentence: where the stock comes from, or — only where none of it is linked — the trust claim. */
function Provenance({ name, nameVi, slug, linked }: { name: string; nameVi: string; slug?: string; linked: 'all' | 'most' | 'some' | 'none' }) {
  const { lang, tr } = useLanguage()
  /**
   * ⛔ NOT THE TRUST CLAIM ON JOBS. Most jobs are LINKED postings (scripts/import-jobs.ts) whose "seller"
   * is the job board and whom eno.vn never vetted — "every listing comes from a seller with a public
   * trust score" would be false there, on the vertical where job scams live.
   */
  // Teachers (2026-09-30): people, not listings — no seller-trust or bait-price claim.
  if (slug === 'teachers') {
    return (
      <>
        {tr('English and subject teachers looking for work in Vietnam. Schools and companies can message a teacher; their phone, email and CV are shared only when the teacher chooses to. ', 'Giáo viên tiếng Anh và các môn học đang tìm việc tại Việt Nam. Trường học và công ty có thể nhắn tin cho giáo viên; số điện thoại, email và CV chỉ được chia sẻ khi giáo viên đồng ý. ')}
        <Link href="/teachers/join" className="font-semibold text-brand underline">{tr('Teachers: create your free profile', 'Giáo viên: tạo hồ sơ miễn phí')}</Link>
      </>
    )
  }
  if (slug === 'jobs') {
    return <>{tr('Most jobs here link to the original posting, where you apply. eno.vn does not handle applications and never charges a fee — never pay to get a job.', 'Phần lớn việc làm ở đây dẫn link tới tin tuyển dụng gốc, nơi bạn ứng tuyển. eno.vn không xử lý hồ sơ và không bao giờ thu phí — đừng bao giờ trả tiền để có việc làm.')}</>
  }
  /**
   * ⛔ NOR ON A SHELF THAT LINKS OUT. Electronics and furniture printed "every listing comes from a
   * seller with a public trust score" over stock in which every sampled row (100/100, 2026-09-27)
   * opens on a source shop — the score belongs to listings posted here, not to a copied one. The
   * page counts the linked rows at render and passes the tier; the trust sentence below survives only
   * where that count is zero. The pairs equal CATEGORY_LINKED_SENTENCE (category-copy.ts).
   * ⛔ "A SOURCE SITE", NOT "A PARTNER SITE" (2026-10-01): "partner" now means a signed agreement
   * (partner-badge.tsx), which none of these shops has — CATEGORY_LINKED_SENTENCE has the note.
   */
  if (linked === 'all') return <>{tr('Every listing here links to its original on a source site.', 'Mỗi tin ở đây đều dẫn tới tin gốc trên trang nguồn.')}</>
  if (linked === 'most') return <>{tr('Most listings here link to their original on a source site.', 'Phần lớn tin ở đây dẫn tới tin gốc trên trang nguồn.')}</>
  if (linked === 'some') return <>{tr('Some listings here link to their original on a source site.', 'Một số tin ở đây dẫn tới tin gốc trên trang nguồn.')}</>
  if (lang === 'vi') {
    return <>{`Mỗi tin đăng ${nameVi.toLowerCase()} trên ${SITE_NAME} đều đến từ người bán có điểm uy tín công khai, và tin xấu sẽ bị báo cáo — ít hàng giả, ít giá mồi hơn.`}</>
  }
  return (
    <>
      <Tr text="Every" /> <Tr text={name.toLowerCase()} /> <Tr text="listing on eno.vn comes from a seller with a public trust score, and bad listings get reported — fewer fakes, fewer bait prices." />
    </>
  )
}
