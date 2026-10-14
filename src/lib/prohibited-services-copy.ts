/**
 * eno.forum's NOTE ABOUT eno.vn ON /prohibited — in ONE module so it can be aliased away on a marketplace build.
 *
 * ⚠️ WHAT IT USED TO HOLD, AND WHY IT IS SMALL NOW (2026-10-14). Until the owner opened the e-Visa subcategory to
 * every seller on both sites ("Anyone posts, live after check"), this module also carried the six visa &
 * immigration listing rules, as a services-edition addendum. eno.vn's /prohibited publishes those rules itself now
 * (src/app/[lang]/prohibited/page.tsx VISA_RULES — both editions, curated Vietnamese, dated by PROHIBITED_AMENDMENT),
 * so only this note is left: on eno.vn it would be the page linking to itself, which is why it stays aliased.
 *
 * ⚠️ /prohibited IS A SHARED PAGE. A single file renders on eno.vn AND on eno.forum, so a marketplace build compiles
 * it and everything it imports. The `IS_SERVICES` gate at the call site stops the note RENDERING; only next.config.ts's
 * resolveAlias to ./prohibited-services-copy.stub.ts keeps eno.forum's sentence about eno.vn, and its URL, out of the
 * artifact eno.vn ships. Keep BOTH — src/lib/edition.ts carries the measurement behind that sentence.
 */

export type ProhibitedServicesCrosslink = {
  lead: string
  /** The lead's curated Vietnamese — the page prints it for `vi`. */
  leadVi: string
  href: string
  /** Visible anchor text — a bare URL, so it needs no translation. */
  label: string
}

/**
 * The related-site note, services edition only.
 *
 * ⚠️ IT MAY NOT SAY "UNRELATED". The two sites share a brand, a codebase and (today) one pending
 * operator, so the honest framing is disclosed affiliation — see AFFILIATION in
 * src/lib/site-legal.ts, which this wording is a page-local, plain-English echo of. What it adds is
 * the fact a reader of THIS page actually wants: the marketplace next door publishes the same rules, the
 * visa and immigration ones included (owner, 2026-10-14 — it used to say eno.vn had no visa services at all).
 *
 * ⚠️ THE URL LIVES HERE RATHER THAN IN src/lib/cross-site-links.ts ON PURPOSE. That module is the
 * curated SEO surface — the four keyword landing pages the promo block and the footer column render,
 * kept deliberately short so it does not read as a link farm. A legal-policy cross-reference belongs
 * to the page that makes it, and adding it there would silently put /prohibited into both of those
 * product surfaces. The anchor still borrows CROSS_SITE_REL from that module so the dofollow
 * decision stays in one place.
 *
 * ⚠️ ABSOLUTE, AND APEX (`https://eno.vn`, never `www.`). Absolute because this renders on
 * eno.forum, where a root-relative `/prohibited` resolves to eno.forum's OWN copy — the two
 * deployments are one codebase, so the path exists on both, and the link would stop being a
 * cross-site link while still looking like one. Apex because next.config.ts 301s www→apex, so `www.`
 * costs every visitor and crawler a redirect hop. `/prohibited` is a plain `page.tsx`, live on both
 * editions, so this is never the `.svc.` 404 trap cross-site-links.ts warns about.
 */
export const PROHIBITED_SERVICES_CROSSLINK: ProhibitedServicesCrosslink = {
  lead:
    'eno.vn is a related classifieds marketplace in the same brand family — housing, vehicles, jobs, secondhand goods and services. It publishes its own copy of this policy, the visa and immigration rules above included, and enforces it on its own listings:',
  leadVi:
    'eno.vn là một sàn rao vặt có liên quan, cùng hệ thống thương hiệu — nhà ở, xe cộ, việc làm, đồ cũ và dịch vụ. eno.vn công bố bản chính sách này của riêng mình, bao gồm cả các quy định về dịch vụ thị thực và xuất nhập cảnh nêu trên, và áp dụng chính sách đó cho các tin đăng trên eno.vn:',
  href: 'https://eno.vn/prohibited',
  label: 'eno.vn/prohibited',
}
