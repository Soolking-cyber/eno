/**
 * WHICH REVIEW / HELP COMMENT / HELP POST A REPORT IS ABOUT — the content pointer (App Store Guideline 1.2,
 * plan R5; filed only while the `ugc-safety` review gate is on — src/lib/reported-content.ts).
 *
 * ⛔ WHY A DISPUTE MESSAGE AND NOT A COLUMN. `Report` can point at a listing, a conversation, a profile or
 * a storefront and at nothing else, and this change adds no DDL. A content report therefore carries its
 * target as the case's first SYSTEM row (DisputeMessage, senderRole 'system'), written by the server in
 * the same statement as the report:
 *     [[reported review cm123…]] Review on “Minh Tuấn Mobile”, 1/5, by Lan: “…the whole review…”
 * System rows are server-only and never edited, so the pointer cannot be forged or lost, and the readable
 * half keeps the content as it read when it was reported — for the moderator, and as the record once a
 * confirmed review is deleted.
 * ⛔ A PARTY SEES ONLY THE KIND OF CONTENT. The case room renders this row on BOTH editions (one
 * database), and the reported text can carry anything — on eno.forum, visa wording the licensed
 * marketplace must never show (opus, gate round 1). So disputeTimeline gives a party only `about: kind`
 * (the case page words it in the viewer's language) and only the admin room the description; the
 * reporter knows what they reported.
 *
 * Pure (no imports) so the dispute timeline can strip the token without importing the database layer.
 */

export const CONTENT_KINDS = ['review', 'help-comment', 'help-post'] as const
export type ContentKind = (typeof CONTENT_KINDS)[number]

/** cuid-shaped ids only — the token is matched by prefix in SQL, so nothing in it may be a LIKE wildcard. */
const ID_RE = /^[a-z0-9]{8,40}$/
const TOKEN_RE = /^\[\[reported (review|help-comment|help-post) ([a-z0-9]{8,40})\]\]\s?/

export function isContentId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

/** `[[reported <kind> <id>]]` — the exact prefix a pointer row starts with (and the dedupe key). */
export function contentToken(kind: ContentKind, id: string): string {
  return `[[reported ${kind} ${id}]]`
}

/** The pointer in a system row's body, or null when the row is not a pointer. */
export function parseContentPointer(body: string | null | undefined): { kind: ContentKind; id: string } | null {
  const m = TOKEN_RE.exec(body ?? '')
  return m ? { kind: m[1] as ContentKind, id: m[2] } : null
}

/** The body as a MODERATOR reads it: the token removed, the human description kept. */
export function stripContentPointer(body: string): string {
  return body.replace(TOKEN_RE, '')
}
