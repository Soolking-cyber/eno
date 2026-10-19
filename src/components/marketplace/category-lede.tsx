'use client'

import { useLanguage } from '@/context/language-context'
import Link from 'next/link'
import { IS_SERVICES } from '@/lib/edition'
import { Bilingual } from './bilingual'
import { LocalizedLink } from './localized-link'
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
 * ⛔ A CLIENT COMPONENT SO IT CANNOT END UP IN THE OTHER LANGUAGE FROM THE REST OF THE PAGE. As server
 * text it could not follow a client-side language change, which happens whenever a visitor's choice
 * cannot be persisted (cookies blocked): English labels around a Vietnamese sentence (a reviewer's
 * catch). Reading the language from context instead means the sentence always matches the page.
 *
 * ⚠️ EVERY ENGLISH STRING IS A LITERAL `tr()`, because the nine machine-translated languages render from
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
          <CountSentence name={name} nameVi={nameVi} slug={slug} total={total} top={top} />{' '}
        </>
      )}
      <Provenance slug={slug} linked={linked} total={total} />
    </>
  )
}

/**
 * The /c/teachers H1 (teacher visibility plan B3, approved in the plan, 2026-10-18): category-copy.ts `TEACHERS_H1` as a
 * literal `tr()` pair, so the harvester pre-translates it for the nine machine-translated languages; category-lede.test.tsx
 * holds the two equal, and the `<title>` is built from the same map (category-copy.ts teachersTitle). The Vietnamese is
 * an interim, literal translation until counsel's wording — TEACHERS_H1 says why it carries no "nước ngoài".
 * ⚠️ A CLIENT COMPONENT FOR CategoryLede's REASON (above): `(index)/layout.tsx` is server code, and a heading rendered
 * there as text could not follow a client-side language change. No props — the layout picks it from the category row
 * it already has, so it awaits nothing new (the layout's contract test; category-copy.test.ts pins the branch).
 */
export function TeachersHeading() {
  const { tr } = useLanguage()
  return <>{tr('Find English teachers in Vietnam', 'Tìm giáo viên tiếng Anh tại Việt Nam')}</>
}

/**
 * "63,730 listings in Electronics, including Phones (41,002), Laptops (9,114) and TVs (3,508)." /
 * "63.730 tin đăng điện tử, gồm Điện thoại (41.002), Laptop (9.114) và Tivi (3.508)."
 * ⚠️ ENGLISH IN LITERAL `tr()` FRAGMENTS, VIETNAMESE WHOLE — category-text.tsx's rule: the nine
 * machine-translated languages render from the English variant, and Vietnamese word order is not
 * English's. Singular at exactly 1. "0 listings" is never printed (the caller passes no sentence).
 * ⛔ TEACHERS ARE COUNTED AS TEACHERS, THEIR SUBJECTS AFTER A COLON (plan B3, approved in the plan, 2026-10-18):
 * "93 teachers: IELTS & exams (60), English (24) and Subjects in English (9)." / "93 giáo viên: IELTS & luyện thi (60),
 * Tiếng Anh (24) và Môn học bằng tiếng Anh (9)." It read "93 listings in Teachers" — people counted as listings, the
 * wording the owner had already ruled out for this category (2026-09-30). Same live count (one teacher, one profile
 * listing), new noun. Not "including" / "gồm": those make the subjects kinds of teacher ("teachers, including English").
 * The labels are the subcategories' own (taxonomy.ts), as on every other shelf.
 * ⛔ THE COLON LIST ONLY WHEN IT ADDS UP TO THE COUNT (review round 2, owner 2026-10-18: "go with recommended"). A colon
 * presents the subjects as the whole breakdown, but they are topSubcategories' (category-copy.ts): at most three, never
 * "Other languages", never one holding the whole category. So one Chinese-only teacher (profile.ts teacherSubcategory
 * files a teacher of other languages only under "other-languages") would have it read "94 teachers: IELTS & exams (60),
 * English (24) and Subjects in English (9)." — which sum to 93. Whenever the listed counts do not sum to the total, the
 * line is the count alone — "94 teachers." / "94 giáo viên.", the path every category takes with no subcategory to name.
 * It adds up today: 60 + 24 + 9 = 93 (the live lede and GET /api/listings?category=teachers, 2026-10-18).
 */
function CountSentence({ name, nameVi, slug, total, top }: { name: string; nameVi: string; slug?: string; total: number; top: { name: string; nameVi: string; count: number }[] }) {
  const { lang, tr } = useLanguage()
  const n = (v: number) => formatCountFull(v, lang)
  const teachers = slug === 'teachers'
  // Teachers: the whole breakdown after the colon, or no list at all (above). Other shelves keep their "including …".
  const listed = teachers && top.reduce((sum, t) => sum + t.count, 0) !== total ? [] : top
  if (lang === 'vi') {
    const parts = listed.map((t) => `${t.nameVi} (${n(t.count)})`)
    // The category lower-cased mid-sentence, as districtMetadata writes it ("tin đăng điện tử"); the subcategories keep their label case (acronyms: "SIM", "TV").
    const what = teachers ? 'giáo viên' : `tin đăng ${nameVi.toLowerCase()}`
    return <>{`${n(total)} ${what}${parts.length ? `${teachers ? ':' : ', gồm'} ${joinList(parts, 'vi')}` : ''}.`}</>
  }
  return (
    <>
      {n(total)}{' '}
      {teachers ? (
        total === 1 ? tr('teacher') : tr('teachers')
      ) : (
        <>
          {total === 1 ? tr('listing in') : tr('listings in')} <Bilingual en={name} vi={nameVi || name} />
        </>
      )}
      {listed.length > 0 && (
        <>
          {teachers ? ':' : <>, {tr('including')}</>}{' '}
          {listed.map((t, i) => (
            <span key={t.name}>
              {i > 0 && (i === listed.length - 1 ? <> {tr('and')} </> : <>, </>)}
              <Bilingual en={t.name} vi={t.nameVi || t.name} /> ({n(t.count)})
            </span>
          ))}
        </>
      )}
      .
    </>
  )
}

/**
 * Cover lessons (2026-10-07): the school-side door — the explorer with "Available for cover" already on, where the
 * district and free-period filters follow. ⛔ ITS OWN LINE UNDER THE LEDE, never inside it: the lede is clamped to two
 * lines on a phone, and the link sat on lines 4–6, hidden behind "Show more" (preview check, 2026-10-07).
 * rel="nofollow" + prefetch={false}: the house rule for links into `/?category=` (category-filters-link.tsx).
 */
export function TeacherCoverLink({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={className}>
      {/* LocalizedLink: `/` is the English-pinned home, so a Vietnamese reader must land on its `/vi` twin. */}
      <LocalizedLink href="/?category=teachers&attr_cover=open" rel="nofollow" prefetch={false} className="font-semibold text-brand underline">{tr('Need a cover teacher? See who is free', 'Cần giáo viên dạy thay? Xem ai đang rảnh')}</LocalizedLink>
    </p>
  )
}

/** The second sentence: where the stock comes from, or — only where none of it is linked — the report sentence. */
function Provenance({ slug, linked, total }: { slug?: string; linked: 'all' | 'most' | 'some' | 'none'; total: number }) {
  const { tr } = useLanguage()
  /**
   * ⛔ NOT THE TRUST CLAIM ON JOBS. Most jobs are LINKED postings (scripts/import-jobs.ts) whose "seller"
   * is the job board and whom eno.vn never vetted — "every listing comes from a seller with a public
   * trust score" would be false there, on the vertical where job scams live.
   */
  // Teachers (2026-09-30): people, not listings — no seller-trust or bait-price claim. Written for the people hiring
  // (plan B3, approved in the plan, 2026-10-18): what a profile shows, then who may write and what stays private, then
  // the teachers' own door. The two sentences are category-copy.ts TEACHERS_PROFILE_SENTENCE (the description says it
  // too; the claims are checked there) and TEACHERS_CONTACT_SENTENCE (the district ledes'), each a literal pair the tests
  // hold equal to its map. ⛔ THE PROFILE SENTENCE ONLY OVER LIVE PROFILES (total > 0), like the count before it: on an
  // empty page it would describe what nobody shows. The meta description follows the same count (category-copy.ts
  // teachersDescription). Who may write, and the door, stay true at zero.
  if (slug === 'teachers') {
    return (
      <>
        {total > 0 && (
          <>
            {tr('Profiles show experience and qualifications; some have an intro video.', 'Hồ sơ nêu kinh nghiệm, bằng cấp và chứng chỉ; một số có video giới thiệu.')}{' '}
          </>
        )}
        {tr('Schools, companies and other members can message a teacher; their phone, email and CV are shared only when the teacher chooses to.', 'Trường học, công ty và các thành viên khác có thể nhắn tin cho giáo viên; số điện thoại, email và CV chỉ được chia sẻ khi giáo viên đồng ý.')}{' '}
        <Link href="/teachers/join" className="font-semibold text-brand underline">{tr('Teachers: create your free profile', 'Giáo viên: tạo hồ sơ miễn phí')}</Link>
        {/* The schools' cover-lesson door is NOT here: this paragraph is clamped on a phone — TeacherCoverLink below. */}
      </>
    )
  }
  /**
   * ⛔ THE SITE'S OWN NAME, PER EDITION — TWO LITERAL tr() PAIRS BEHIND THE TERNARY, never
   * `tr(\`${SITE_NAME} does not…\`)`: eno.forum printed "eno.vn does not handle applications" about
   * itself, and gen-ui-strings harvests literals only (footer.tsx and sign-in-card.tsx spell out the
   * same trap). The eno.forum pair is the eno.vn pair with the name swapped, word for word.
   */
  if (slug === 'jobs') {
    return (
      <>
        {IS_SERVICES
          ? tr('Most jobs here link to the original posting, where you apply. eno.forum does not handle applications and never charges a fee — never pay to get a job.', 'Phần lớn việc làm ở đây dẫn link tới tin tuyển dụng gốc, nơi bạn ứng tuyển. eno.forum không xử lý hồ sơ và không bao giờ thu phí — đừng bao giờ trả tiền để có việc làm.')
          : tr('Most jobs here link to the original posting, where you apply. eno.vn does not handle applications and never charges a fee — never pay to get a job.', 'Phần lớn việc làm ở đây dẫn link tới tin tuyển dụng gốc, nơi bạn ứng tuyển. eno.vn không xử lý hồ sơ và không bao giờ thu phí — đừng bao giờ trả tiền để có việc làm.')}
      </>
    )
  }
  /**
   * ⛔ NOR ON A SHELF THAT LINKS OUT. Electronics and furniture printed "every listing comes from a
   * seller with a public trust score" over stock in which every sampled row (100/100, 2026-09-27)
   * opens on a source shop — the score belongs to listings posted here, not to a copied one. The
   * page counts the linked rows at render and passes the tier; the report sentence below closes only
   * the tier where that count is zero. The pairs equal CATEGORY_LINKED_SENTENCE (category-copy.ts).
   * ⛔ "A SOURCE SITE", NOT "A PARTNER SITE" (2026-10-01): "partner" now means a signed agreement
   * (partner-badge.tsx), which none of these shops has — CATEGORY_LINKED_SENTENCE has the note.
   */
  if (linked === 'all') return <>{tr('Every listing here links to its original on a source site.', 'Mỗi tin ở đây đều dẫn tới tin gốc trên trang nguồn.')}</>
  if (linked === 'most') return <>{tr('Most listings here link to their original on a source site.', 'Phần lớn tin ở đây dẫn tới tin gốc trên trang nguồn.')}</>
  if (linked === 'some') return <>{tr('Some listings here link to their original on a source site.', 'Một số tin ở đây dẫn tới tin gốc trên trang nguồn.')}</>
  /**
   * ⛔ NO TRUST-SCORE CLAIM (owner 2026-10-04): "every listing comes from a seller with a public trust
   * score" was untrue wherever an official partner (partner badge instead) or an ownerless storefront
   * (no score) holds the shelf, and "— fewer fakes, fewer bait prices" is a comparison no code measures
   * (CS-3 claim 3). The pair is REPORT_SENTENCE (category-copy.ts), the category and district
   * descriptions' own sentence — the test holds the two equal. It also drops the English "on eno.vn",
   * which eno.forum printed about itself.
   */
  return <>{tr('Members can report any listing that breaks the rules.', 'Thành viên có thể báo cáo bất kỳ tin vi phạm nào.')}</>
}
