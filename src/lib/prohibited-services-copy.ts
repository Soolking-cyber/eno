/**
 * THE SERVICES-EDITION ADDENDUM TO /prohibited — the visa & immigration listing rules, in ONE module
 * so it can be aliased away on a marketplace build.
 *
 * ⚠️ /prohibited IS A SHARED PAGE. A single file — src/app/prohibited/page.tsx — renders on eno.vn
 * AND on eno.forum, so a marketplace build genuinely compiles it and everything it imports. The
 * `IS_SERVICES` gate at the call site stops this block RENDERING; only next.config.ts's resolveAlias
 * to ./prohibited-services-copy.stub.ts stops the vocabulary being in the artifact eno.vn ships.
 * Keep BOTH — src/lib/edition.ts carries the measurement behind that sentence (a gate leaves the
 * strings in the chunk; an alias is the only thing that removes them).
 *
 * ⚠️ THESE ARE OBLIGATIONS IMPOSED ON WHOEVER POSTS, NOT CLAIMS ABOUT WHAT WE HAVE ALREADY CHECKED.
 * Read every sentence twice for that distinction before editing one. "The business must give us a
 * copy of its licence before the listing goes live" is a rule; "we hold a copy of every provider's
 * licence" would be a statement of fact, and it is not true yet — see PROVIDER_LICENCE_ON_FILE in
 * src/lib/visa-provider.ts, which is `false` precisely so that duty is a value in the code rather
 * than a promise in a meeting.
 *
 * ⚠️ NO COMPANY NAME, NO LICENCE NUMBER, NO PARTNER NAME HERE. The provider of record is named once,
 * in src/lib/visa-provider.ts, and the operator once, in src/lib/site-legal.ts. A page that restates
 * either goes stale silently — and a number typed into policy prose is a legal defect no lint sees.
 * This module deliberately describes the RULE ("the licence holder must be named on the listing")
 * and never who currently satisfies it.
 *
 * ⚠️ DO NOT MIRROR THESE PHRASES INTO THE PUBLISH-TIME WORD FILTER. src/lib/publish-guard.ts's
 * BANNED_WORDS list was collision-checked as a set against real listings ("bang gia", "lam bang" and
 * "ruou vang" are all excluded because they hit ordinary Vietnamese), and adding a term to it spends
 * a false-positive budget at the publish moment — where a false positive blocks an honest seller.
 * The rules below are enforced by review, reports and removal, which is why the page never claims
 * they are caught automatically.
 */

export type ProhibitedServicesSection = {
  /** Anchor id, shared by the section and its left-rail entry. */
  id: string
  /** Short left-rail label — the rail is 210px, so it is not the section title. */
  label: string
  title: string
  intro: string
  items: string[]
}

/**
 * The extra rules that apply only to visa/immigration listings.
 *
 * Written in the same register as the rest of the page: a plain-language rule first, then the reason
 * it exists. The three the brief names — licence, no guaranteed approval, government fee shown
 * separately — are items 1, 2 and 4; the others close the routes a reader would otherwise find open
 * (impersonating an official channel, working around the process, and moving documents or money off
 * the route the listing describes).
 */
export const PROHIBITED_SERVICES_SECTION: ProhibitedServicesSection = {
  id: 'visa-services',
  label: 'Visa & immigration rules',
  title: 'Visa & immigration services — extra rules',
  intro:
    'Vietnam e-visa and immigration services are listed here by licensed third-party providers: the provider named on a listing does the work under its own licence, and this site is the platform the listing sits on. A mistake in this category costs someone a trip or an entry refusal, so these listings carry rules on top of everything above — and the rules apply to the listing, its photos, its price and to what is said in chat.',
  items: [
    'Only a licensed business may list them. Vietnam visa, immigration, residence-card and work-permit services may be listed only by a business holding the Vietnamese licence that work requires — for visa and travel services, a valid international travel-service licence. That business must be named as the provider on the listing itself and must give us a copy of its licence and its business registration before the listing goes live. Individuals, unlicensed "visa agents" and resellers may not offer these services here, and a listing we cannot tie to a current licence is removed.',
    'No promised outcome. No listing, title, photo or chat message may claim a guaranteed result — "guaranteed visa", "100% approval", "bao đậu" / "bảo đậu", "no refusal" or anything equivalent. Only the Vietnamese immigration authorities decide an application, and nobody on this platform can promise, buy or hurry that decision. Offering to refund the service fee if an application is refused is a different thing and is allowed; claiming the decision itself is certain is not.',
    'No pretending to be an official channel. A listing, storefront name, logo or photo may not present itself as a government body, an official e-visa portal, an embassy or a consulate, and may not use a state emblem or an official seal. Claiming to have contacts inside an immigration office, or to be able to reach one, is banned outright.',
    'The government fee must be shown separately. A visa listing must state the official government fee and the service fee charged by the provider as two separate amounts, before anyone pays anything. The government fee is set by the State and is paid for the application itself; it is generally not refundable once an application has been submitted. A listing must not fold it into one unexplained total, present it as the provider’s own charge, or reveal it only at checkout — and it must say what the service fee actually buys.',
    'Nothing that works around the process instead of going through it. Arranging or covering up an overstay other than by paying the official penalty, obtaining a stamp, approval letter or entry record outside the official process, or paying an official to move a file, may not be offered, advertised or hinted at. Forged and altered documents are already banned further up this page; this is the same rule applied to the process itself.',
    'Documents and payment stay on the route the listing describes. A provider may not ask you to send passport scans, portrait photos or personal details through a private channel outside the application flow shown on the listing, and may not ask you to pay by a route the listing does not describe. If someone asks you to do either, report the listing — that request is the most reliable scam signal there is.',
  ],
}

export type ProhibitedServicesCrosslink = {
  lead: string
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
 * the fact a reader of THIS page actually wants: the marketplace next door carries none of this.
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
    'eno.vn is a related classifieds marketplace in the same brand family — housing, vehicles, jobs and secondhand goods, with no visa or immigration services on it at all. It publishes its own copy of this policy and enforces it on its own listings:',
  href: 'https://eno.vn/prohibited',
  label: 'eno.vn/prohibited',
}
