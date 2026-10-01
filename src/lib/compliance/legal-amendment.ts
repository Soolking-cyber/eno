// ── The October 2026 amendment of the published legal texts — its two dates, typed ONCE ──────────
//
// ⛔ `published` MUST BE THE DAY THE AMENDMENT IS ACTUALLY DEPLOYED, NOT THE DAY IT WAS WRITTEN.
// Deploys happen only on the owner's word (CLAUDE.md), so both dates are set on the deploy day, here
// and nowhere else: /regulations (META + Article 17), /terms ("Last updated" + the change note),
// /returns (meta, intro, changes section), /prohibited and /legal/ranking ("Last updated") read them.
// A page that typed its own date drifted from the others the first time one was corrected.
//
// ⛔ `inForce` IS ALSO A RUNTIME SWITCH, NOT ONLY A PRINTED DATE. src/lib/site-legal.ts derives
// TOS_EFFECTIVE_AT from it (midnight Vietnam time), and that instant decides which Terms version
// onboarding stamps on Profile.tosVersion (tosVersionInForce), what /terms and /md/terms headline as
// "in force", and when the site-wide notice (tos-change-notice.tsx) disappears. Moving it moves all
// of those at once — which is the point, and also why it must never be edited casually.
//
// ⚠️ inForce ≥ published + 6 CALENDAR DAYS. The texts promise at least 5 days' notice, and under the
// Civil Code 2015 Art 147–148 the day of publication is not counted: published 01/10 → notice runs
// 02/10–06/10 → in force 07/10. legal-amendment.test.ts fails on a shorter gap.
//
// ⚠️ TYPED, NEVER READ FROM THE CLOCK: these pages prerender, and a build-time date moves with every
// rebuild.

export const LEGAL_AMENDMENT = {
  published: '2026-10-01',
  inForce: '2026-10-07',
} as const

/** The advance notice the texts promise (Quy chế Art 15, Terms "Changes"). */
export const MIN_NOTICE_DAYS = 5

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parts(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`legal-amendment: not an ISO date: ${iso}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 2026-10-07 → "07/10/2026" — the Vietnamese legal form. */
export function dateVi(iso: string): string {
  const [y, mo, d] = parts(iso)
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

/** 2026-10-07 → "7 October 2026". */
export function dateEn(iso: string): string {
  const [y, mo, d] = parts(iso)
  return `${d} ${MONTHS_EN[mo - 1]} ${y}`
}

export const AMENDED = {
  publishedVi: dateVi(LEGAL_AMENDMENT.published),
  publishedEn: dateEn(LEGAL_AMENDMENT.published),
  inForceVi: dateVi(LEGAL_AMENDMENT.inForce),
  inForceEn: dateEn(LEGAL_AMENDMENT.inForce),
} as const
