'use client'

import { Tr, useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'

/**
 * The category page's one-sentence lede, per language.
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
export function CategoryLede({ name, nameVi, slug }: { name: string; nameVi: string; slug?: string }) {
  const { lang, tr } = useLanguage()
  /**
   * ⛔ NOT THE TRUST CLAIM ON JOBS. Most jobs are LINKED postings (scripts/import-jobs.ts) whose "seller"
   * is the job board and whom eno.vn never vetted — "every listing comes from a seller with a public
   * trust score" would be false there, on the vertical where job scams live.
   */
  if (slug === 'jobs') {
    return <>{tr('Most jobs here link to the original posting, where you apply. eno.vn does not handle applications and never charges a fee — never pay to get a job.', 'Phần lớn việc làm ở đây dẫn link tới tin tuyển dụng gốc, nơi bạn ứng tuyển. eno.vn không xử lý hồ sơ và không bao giờ thu phí — đừng bao giờ trả tiền để có việc làm.')}</>
  }
  if (lang === 'vi') {
    return <>{`Mỗi tin đăng ${nameVi.toLowerCase()} trên ${SITE_NAME} đều đến từ người bán có điểm uy tín công khai, và tin xấu sẽ bị báo cáo — ít hàng giả, ít giá mồi hơn.`}</>
  }
  return (
    <>
      <Tr text="Every" /> <Tr text={name.toLowerCase()} /> <Tr text="listing on eno.vn comes from a seller with a public trust score, and bad listings get reported — fewer fakes, fewer bait prices." />
    </>
  )
}
