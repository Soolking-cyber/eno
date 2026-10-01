// ── The ARCHIVED versions of the Terms of Service and the Quy chế — where they live, and what replaced them ──
//
// ⛔ WHY ARCHIVES EXIST AT ALL (2026-10-01 review). Quy chế Article 15 promises "Bản Quy chế đang áp dụng
// luôn được đăng tại /regulations kèm số phiên bản". From LEGAL_AMENDMENT.published /regulations and /terms
// show version 2, which binds only from LEGAL_AMENDMENT.inForce — so during the notice window the text IN
// FORCE was published nowhere ("write to us for a copy"). And everyone who accepts before the in-force
// instant is stamped Profile.tosVersion '1' (tosVersionInForce, src/lib/site-legal.ts): a text they must be
// able to read for as long as that acceptance record matters. So version 1 stays published, permanently,
// at the two paths below (src/app/[lang]/terms/v1, src/app/[lang]/regulations/v1).
//
// ⛔ THE SUPERSEDING DATES ARE BORROWED FROM LEGAL_AMENDMENT ONLY WHILE IT STILL DESCRIBES VERSION 2.
// The next amendment re-uses LEGAL_AMENDMENT (site-legal.ts says how), and from that moment these dates
// must be LITERALS — the days version 2 really shipped and took effect — or the version-1 archive starts
// printing the version-3 dates. legal-archive.test.ts fails until that is done.

import { LEGAL_AMENDMENT, dateEn, dateVi } from './legal-amendment'

/** Version 1's number. A literal on purpose: TOS_PREVIOUS_VERSION moves on with the next amendment. */
export const V1 = '1'

/**
 * Where an archived version of a document is published: src/app/[lang]/<doc>/v<N>/page.tsx.
 * linkifyLegal (legal-linkify.tsx) links these paths inside legal prose. legal-archive.test.ts holds
 * that the version a notice-window line calls "still in force" (TOS_PREVIOUS_VERSION) has both pages.
 */
export const archivedPath = (doc: 'terms' | 'regulations', version: string) => `/${doc}/v${version}`

/** Where version 1 is published — for copy that is about the 1 → 2 amendment specifically. */
export const V1_PATHS = { terms: archivedPath('terms', V1), regulations: archivedPath('regulations', V1) } as const

/** The amendment that replaced version 1. See the ⛔ above before touching LEGAL_AMENDMENT. */
export const V1_SUPERSEDED_BY = {
  version: '2',
  published: LEGAL_AMENDMENT.published,
  inForce: LEGAL_AMENDMENT.inForce,
} as const

export const V1_SUPERSEDED = {
  publishedVi: dateVi(V1_SUPERSEDED_BY.published),
  publishedEn: dateEn(V1_SUPERSEDED_BY.published),
  inForceVi: dateVi(V1_SUPERSEDED_BY.inForce),
  inForceEn: dateEn(V1_SUPERSEDED_BY.inForce),
} as const
