import type { Metadata } from 'next'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { POSTING_IS_FREE } from '@/lib/site-identity'

/**
 * THE HOME PAGE'S OWN METADATA, BY `[lang]` VARIANT (SEO wave B, V2; copy sheet CS-3, approved by the
 * owner 2026-10-01). Pure, so the variants are testable without the page's data (home-metadata.test.ts).
 *
 * ⛔ ONLY THE MARKETPLACE'S VIETNAMESE VARIANT SETS A TITLE AND DESCRIPTION, the pattern of `/about`
 * (about/page.tsx). The English variant, and eno.forum in both, keep the root layout's title and
 * description (layout.tsx) byte for byte. A Vietnamese reader of `/` got the English title.
 * ⚠️ `openGraph` / `twitter` STAY THE LAYOUT'S ENGLISH ON BOTH VARIANTS, as /about decided: a share scraper
 * sends no language, so the card must not depend on which variant it happened to hit.
 * ⚠️ "MIỄN PHÍ" ONLY THROUGH `POSTING_IS_FREE` (site-identity.ts), which cites the legal clauses it rests
 * on; it is rendered from the flag, never typed. "cho người nước ngoài và người Việt" is the site's
 * positioning, word for word from the live /about title. No "trusted" (CS-3 claim 1).
 * ⚠️ THE TITLE IS AT 60 CHARACTERS WITH THE FLAG ON. Do not lengthen it.
 */
export const HOME_TITLE_VI = `${SITE_NAME} — ${POSTING_IS_FREE ? 'rao vặt miễn phí' : 'rao vặt'} cho người nước ngoài và người Việt`
/** The four shelves are the English description's typed list (layout.tsx SITE_DESCRIPTION); they change together. */
export const HOME_DESCRIPTION_VI = `${SITE_NAME} là chợ rao vặt${POSTING_IS_FREE ? ' miễn phí' : ''} cho người nước ngoài và người Việt tại Việt Nam: nhà cho thuê, việc làm, nội thất, đồ điện tử và nhiều hơn nữa.`

/** Self-canonical so Google attributes ranking signals to the no-redirect www host. */
export function homeMetadata(lang: string): Metadata {
  const base: Metadata = { alternates: { canonical: '/' } }
  if (IS_SERVICES || lang !== 'vi') return base
  return { ...base, title: HOME_TITLE_VI, description: HOME_DESCRIPTION_VI }
}
