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
export function CategoryLede({ name, nameVi }: { name: string; nameVi: string }) {
  const { lang } = useLanguage()
  if (lang === 'vi') {
    return <>{`Mỗi tin đăng ${nameVi.toLowerCase()} trên ${SITE_NAME} đều đến từ người bán có điểm uy tín công khai, và tin xấu sẽ bị báo cáo — ít hàng giả, ít giá mồi hơn.`}</>
  }
  return (
    <>
      <Tr text="Every" /> <Tr text={name.toLowerCase()} /> <Tr text="listing on eno.vn comes from a seller with a public trust score, and bad listings get reported — fewer fakes, fewer bait prices." />
    </>
  )
}
