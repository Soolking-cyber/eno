// ── The ARCHIVED versions of the Terms of Service and the Quy chế — where they live, and what replaced them ──
//
// ⛔ WHY ARCHIVES EXIST AT ALL (2026-10-01 review). Quy chế Article 15 promises "Bản Quy chế đang áp dụng
// luôn được đăng tại /regulations kèm số phiên bản". From LEGAL_AMENDMENT.published /regulations and /terms
// show the new version, which binds only from LEGAL_AMENDMENT.inForce — so during a notice window the text
// IN FORCE would be published nowhere ("write to us for a copy"). And everyone who accepted before the
// in-force instant is stamped Profile.tosVersion '1' (tosVersionInForce, src/lib/site-legal.ts): a text
// they must be able to read for as long as that acceptance record matters. So version 1 stays published,
// permanently, at the two paths below (src/app/[lang]/terms/v1, src/app/[lang]/regulations/v1).
// ⚠️ Version 2 turned out to have NO window — an immediate amendment, in force 01/10/2026, the day it was
// published (owner, 2026-10-01) — but the second reason stands: every acceptance before it names version 1.
//
// ⚠️ THE QUY CHẾ'S VERSION 2 ARCHIVE CAME FIRST (2026-10-05). The Quy chế-only amendment (version 3,
// REGULATIONS_AMENDMENT) replaced the Quy chế's version 2 while the Terms stayed at version 2, so only
// src/app/[lang]/regulations/v2 existed then. It stays published permanently too: the Terms accepted from
// 01/10/2026 incorporate the Quy chế as it then stood, and Article 15 says every text in force is published.
//
// ⚠️ THE TERMS' VERSION 2 IS ARCHIVED SINCE THE TERMS' VERSION 3 (2026-10-07 — App Store Guideline 1.2, a
// Terms-only amendment, IMMEDIATE by the owner's decision: published and in force 07/10/2026):
// src/app/[lang]/terms/v2 — every acceptance from 01/10/2026 until that instant names version 2.
// Permanently, like the others.
// ⚠️ THE TWO DOCUMENTS' VERSION NUMBERS PARTED AT 2: the Terms' version 3 (TERMS_V2_SUPERSEDED_BY, LEGAL_AMENDMENT)
// and the Quy chế's version 3 (V2_SUPERSEDED_BY, REGULATIONS_AMENDMENT) are different amendments on different
// days. Never read one's record for the other.
//
// ⛔ THE SUPERSEDING DATES ARE BORROWED FROM AN AMENDMENT RECORD ONLY WHILE THAT RECORD STILL DESCRIBES THE
// SUCCESSOR. The next amendment re-uses the record (site-legal.ts says how), and from that moment these
// dates must be LITERALS — the days the successor really shipped and took effect — or the archive starts
// printing the newer amendment's dates as its own. legal-archive.test.ts fails until that is done:
//   · V1_SUPERSEDED_BY — LITERALS since the Terms' version 3 re-used LEGAL_AMENDMENT (2026-10-07): the October
//     2026 amendment's real dates, published and in force 01/10/2026 (immediate). They are also the dates
//     of every text that amendment changed and version 3 did not — /returns, /prohibited, the Quy chế's first
//     Article 17 entry, the version-2 note in /terms' change log — so those read V1_SUPERSEDED now;
//   · TERMS_V2_SUPERSEDED_BY borrows LEGAL_AMENDMENT while TOS_VERSION is '3';
//   · V2_SUPERSEDED_BY borrows REGULATIONS_AMENDMENT while REGULATIONS_VERSION is '3'.

import { LEGAL_AMENDMENT, REGULATIONS_AMENDMENT, dateEn, dateVi } from './legal-amendment'

/** Version 1's number. A literal on purpose: TOS_PREVIOUS_VERSION moves on with the next amendment. */
export const V1 = '1'

/**
 * Where an archived version of a document is published: src/app/[lang]/<doc>/v<N>/page.tsx.
 * linkifyLegal (legal-linkify.tsx) links these paths inside legal prose. legal-archive.test.ts holds
 * that the version a notice-window line calls "still in force" (TOS_PREVIOUS_VERSION,
 * REGULATIONS_PREVIOUS_VERSION) has its page.
 */
export const archivedPath = (doc: 'terms' | 'regulations', version: string) => `/${doc}/v${version}`

/** Where version 1 is published — for copy that is about the 1 → 2 amendment specifically. */
export const V1_PATHS = { terms: archivedPath('terms', V1), regulations: archivedPath('regulations', V1) } as const

/**
 * The amendment that replaced version 1 — of the Terms AND of the Quy chế: the October 2026 amendment made
 * both version 2 on the same day, an immediate amendment (owner, 2026-10-01), published and in force
 * 01/10/2026 — prod since 86f531e1. ⛔ LITERALS: LEGAL_AMENDMENT moved on to the Terms' version 3 (see the ⛔
 * above); these are the days version 2 really shipped and took effect, and they never change again.
 */
export const V1_SUPERSEDED_BY = {
  version: '2',
  published: '2026-10-01',
  inForce: '2026-10-01',
} as const

export const V1_SUPERSEDED = {
  publishedVi: dateVi(V1_SUPERSEDED_BY.published),
  publishedEn: dateEn(V1_SUPERSEDED_BY.published),
  inForceVi: dateVi(V1_SUPERSEDED_BY.inForce),
  inForceEn: dateEn(V1_SUPERSEDED_BY.inForce),
} as const

/** Version 2's number — a literal for the same reason as V1 (TOS_PREVIOUS_VERSION and REGULATIONS_PREVIOUS_VERSION move on). */
export const V2 = '2'

/** Where version 2 of each document is published. */
export const V2_PATHS = { terms: archivedPath('terms', V2), regulations: archivedPath('regulations', V2) } as const

/**
 * The amendment that replaced the TERMS' version 2: the Terms' version 3 (App Store Guideline 1.2 — decision
 * D8). Not V2_SUPERSEDED_BY, which is the Quy chế's. See the ⛔ above before touching LEGAL_AMENDMENT.
 */
export const TERMS_V2_SUPERSEDED_BY = {
  version: '3',
  published: LEGAL_AMENDMENT.published,
  inForce: LEGAL_AMENDMENT.inForce,
} as const

export const TERMS_V2_SUPERSEDED = {
  publishedVi: dateVi(TERMS_V2_SUPERSEDED_BY.published),
  publishedEn: dateEn(TERMS_V2_SUPERSEDED_BY.published),
  inForceVi: dateVi(TERMS_V2_SUPERSEDED_BY.inForce),
  inForceEn: dateEn(TERMS_V2_SUPERSEDED_BY.inForce),
} as const

/**
 * The amendment that replaced the Quy chế's version 2: the Quy chế-only amendment (version 3). See the ⛔
 * above before touching REGULATIONS_AMENDMENT.
 */
export const V2_SUPERSEDED_BY = {
  version: '3',
  published: REGULATIONS_AMENDMENT.published,
  inForce: REGULATIONS_AMENDMENT.inForce,
} as const

export const V2_SUPERSEDED = {
  publishedVi: dateVi(V2_SUPERSEDED_BY.published),
  publishedEn: dateEn(V2_SUPERSEDED_BY.published),
  inForceVi: dateVi(V2_SUPERSEDED_BY.inForce),
  inForceEn: dateEn(V2_SUPERSEDED_BY.inForce),
} as const
