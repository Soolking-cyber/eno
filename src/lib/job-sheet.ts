/**
 * ⛔ A LINKED JOB'S PAGE, ON A PHONE (owner-approved 2026-11-14, cook r06 jobs: "after this cook round build all best options and
 * deploy"; stills cook/compare/r06/jobs__pdp_job.jpg, VietnamWorks' job page in eno's own system). page.tsx `isJob` (a linked
 * job: an affiliate link on a 'job' listing, so no gallery). Top to bottom, in the DOM and on screen:
 *   the role (the page's one display line, 28/34) with Share on its first line → the employer once, as a link, with the kept
 *   "Linked job posting — not verified by eno.vn" under it → a stated pay (22/28) → place and posted → the Details as tags →
 *   Apply with Save beside it and the one caption under them → ONE counsel panel (Seller information, then the safety advice
 *   and Report / Block) → "More from this employer" and "More like this" as job cards, 32px apart → the question lines last.
 * It reverses there: the compact job header and its "Job posting" kicker (P-JOB, owner 2026-09-30) — Share rides the role's
 * line and Save stands beside Apply; P-HIER's price-first head (owner 2026-09-30) — the role is the display line and a pay
 * follows the employer; batch 79's section hairlines and the phone "Hosted by" band (order-7) — Details are tags under the head
 * and the employer line is under the role; batch 70's tint well — Seller information and the safety advice are one panel.
 *
 * ⚠️ BELOW md ONLY, AND md+ IS TODAY'S PAINT. Every class here is `max-md:`, sits on an element that is display:none from md
 * (`md:hidden`), is `md:contents` (a wrapper whose children are then exactly today's flex items, gaps included —
 * LocalizedTitleHeading returns a fragment, so a block wrapper would change md+), or is an `md:`/`sm:` class that puts back
 * exactly what md+ paints today (the price row's `md:order-first`, which with the job header's restores price → title).
 * Between sm and md the page keeps its phone order with the sm type, as it does today.
 * A PLAIN MODULE (no 'use client'): page.tsx (a server component) imports the strings.
 */

/** The header row with the "Job posting" kicker, Share, Save and Edit: md+ only now; first there, before the price row. */
export const JOB_HEADER = 'max-md:hidden md:order-first'

/** The H1 below sm: the display role (28/34, −0.025em, 700), never truncated; from sm exactly PAGE_TITLE's sm paint (24px,
 *  leading-tight, no tracking — `sm:tracking-normal` stops the token's tracking, `sm:leading-tight` its 34px line). */
export const JOB_TITLE = 'text-t-display font-bold text-foreground [overflow-wrap:anywhere] sm:text-2xl sm:leading-tight sm:tracking-normal'
/** The role's line: the H1 (and its "Translated" note) beside Share (and Edit, for the owner). Both wrappers are `md:contents`. */
export const JOB_TITLE_LINE = 'flex items-start gap-2 md:contents'
export const JOB_TITLE_CELL = 'min-w-0 flex-1 md:contents'
export const JOB_TITLE_ACTIONS = 'flex shrink-0 items-center gap-2 md:hidden'

/** The employer line under the role (PdpShopLink `head`): phones only — md+ keeps the buy box's row. */
export const JOB_EMPLOYER = 'md:hidden'

/** The pay row: after the employer below md; first again from md (with the job header, which is DOM-first). */
export const JOB_PRICE_ROW = 'md:order-first'
/** A stated figure: the section role (22/28) below md; today's 30px from md. */
export const JOB_PRICE = 'text-t-h2 md:text-3xl md:tracking-tight'
export const JOB_PRICE_APPROX = 'text-sm md:text-base'
/** A stated pay in the posting's own words (salaryText): the same role below md; today's 24px from md. */
export const JOB_SALARY_TEXT = 'text-t-h2 text-price [overflow-wrap:anywhere] md:text-2xl md:font-bold md:tracking-tight'

/** Place and posted: 12px under what precedes them, 14px in body ink below md; the glyphs 18px muted. */
export const JOB_META = 'max-md:mt-1 max-md:text-body'
export const JOB_META_GLYPH = 'max-md:size-4.5 max-md:text-muted-foreground'

/**
 * Details as TAGS below md (Indeed's job tags): the same rows as the Details table (page.tsx `detailsRows`), restyled — each
 * row one field-grey tag, "English: Required" (the colon is the label's ::after), the value bold ink. Its heading is screen-reader
 * only. The table is `max-md:hidden` on a linked job, so one Details is ever displayed and read.
 */
export const JOB_TAGS = 'max-md:mt-1 md:hidden'
export const JOB_TAG_ROWS = "flex flex-wrap gap-2 text-sm [&>div]:inline-flex [&>div]:items-baseline [&>div]:justify-start [&>div]:gap-1 [&>div]:rounded-lg [&>div]:bg-muted [&>div]:px-2.5 [&>div]:py-1 [&_dt]:text-body [&_dt]:after:content-[':'] [&_dd]:min-w-0 [&_dd]:text-left [&_dd]:font-bold [&_dd]:[overflow-wrap:anywhere]"

/** Apply with Save beside it (VietnamWorks' pair): the button's column takes the rest; both wrappers `md:contents`. */
export const JOB_APPLY_ROW = 'flex items-start gap-2 md:contents'
export const JOB_APPLY_CELL = 'min-w-0 flex-1 md:contents'

/**
 * THE COUNSEL PANEL: the safety block's wrapper is the panel below md (the field grey, 12 radius, 16 padding — 4 under the
 * Report / Block row, whose 44px carries it); Seller information's phone copy opens it over a line-strong hairline, the safety
 * advice closes it in the quiet voice. Its place in the DOM is the safety block's, so DOM order is the order on screen.
 */
export const JOB_COUNSEL = 'max-md:rounded-xl max-md:bg-tint max-md:p-4 max-md:pb-1'
export const JOB_COUNSEL_INFO = 'mb-3 border-b border-line-strong pb-3 md:hidden'
export const JOB_COUNSEL_STRIP = 'max-md:border-t-0 max-md:pt-0'

/** The rails under the page: 32px over each below md (48 from md, as today). */
export const JOB_SHELF_GAP = 'mt-8 md:mt-12'

/** The question lines' phone copy, after the rails: 32px under them, the lines 12px apart; nothing when no line renders. */
export const JOB_LINES = 'mt-8 space-y-3 empty:hidden md:hidden'
